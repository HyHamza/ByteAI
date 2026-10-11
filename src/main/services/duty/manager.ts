import { BrowserWindow, Notification } from 'electron';
import type { DutyShift, DutyShiftPhase } from '../../../shared/types';
import { DataStore } from '../db/store';
import { AgentOrchestrator } from '../../agent/orchestrator';
import { JulesClient } from '../jules/client';

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0m';
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export class DutyManager {
  private static instance: DutyManager;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastWatchdogNudgeAt: number = 0;

  private constructor() {
    this.startHeartbeat();
  }

  public static getInstance(): DutyManager {
    if (!DutyManager.instance) {
      DutyManager.instance = new DutyManager();
    }
    return DutyManager.instance;
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    // Periodically broadcast remaining time and run watchdog every 30s
    this.heartbeatInterval = setInterval(() => {
      this.checkActiveShifts().catch(console.error);
    }, 30000);
  }

  private lastTaskDispatchedAt: number = 0;

  // Rate limit watchdog alert to once every 2 minutes (120s) of confirmed inactivity
  private static readonly WATCHDOG_GRACE_PERIOD_MS = 120_000;

  private async checkActiveShifts() {
    const store = DataStore.getInstance();
    const active = store.getActiveDutyShift();
    if (!active) return;

    active.lastCheckAt = Date.now();
    store.saveDutyShift(active);
    this.broadcastShift(active);

    // If past end time and no task running, mark completed
    if (Date.now() >= active.targetEndAt && active.status === 'active') {
      await this.completeShift(active.id);
      return;
    }

    if (active.status !== 'active') return;

    const now = Date.now();

    // ── Grace Period Check ────────────────────────────────────────────────
    // When a task is first created or queued in Google Cloud, it takes 1-2 minutes to provision.
    // Never trigger the watchdog during the initial setup / queue grace period!
    if (now - active.startedAt < DutyManager.WATCHDOG_GRACE_PERIOD_MS) {
      return;
    }
    if (now - this.lastTaskDispatchedAt < DutyManager.WATCHDOG_GRACE_PERIOD_MS) {
      return;
    }
    if (now - this.lastWatchdogNudgeAt < DutyManager.WATCHDOG_GRACE_PERIOD_MS) {
      return;
    }

    // ── Continuous Duty Watchdog ──────────────────────────────────────────
    // Detects when BOTH Byte and Jules are sitting idle on an active duty shift!
    const orchestrator = AgentOrchestrator.getInstance();
    const isByteRunning = orchestrator.getRunningSessions().includes(active.sessionId);

    if (!isByteRunning) {
      const chatSession = store.getSession(active.sessionId);
      const julesId =
        active.currentJulesSessionId ||
        chatSession?.julesSessionId ||
        (active.phasesCompleted.length > 0
          ? active.phasesCompleted[active.phasesCompleted.length - 1].sessionId
          : undefined);

      let isJulesRunning = false;
      let isSessionCompleted = false;
      let isAwaitingFeedback = false;

      if (julesId) {
        try {
          const client = JulesClient.getInstance();
          const session = await client.getSession(julesId);
          // Active coding / cloud provisioning states (AWAITING_USER_FEEDBACK is NOT running; it requires immediate Byte attention!)
          const activeCodingStates = [
            'IN_PROGRESS',
            'PLANNING',
            'CODING',
            'INITIALIZING',
            'QUEUED',
            'PENDING',
          ];
          if (activeCodingStates.includes(session?.state)) {
            isJulesRunning = true;
          } else if (session?.state === 'AWAITING_USER_FEEDBACK' || session?.state === 'AWAITING_USER_INPUT') {
            isAwaitingFeedback = true;
            isJulesRunning = false; // Stopped waiting for Byte's feedback!
          } else if (session?.state === 'COMPLETED') {
            isSessionCompleted = true;
          }
        } catch (_) {}
      }

      // If neither Byte nor Jules is running, both are sitting idle on duty!
      if (!isJulesRunning) {
        this.lastWatchdogNudgeAt = now;
        const remainingDisplay = formatRemaining(active.targetEndAt - now);
        console.warn(`[DutyManager] WATCHDOG: Jules (${julesId || 'none'}) and Byte are both idle on active duty shift ${active.id} (idle > 2m). Waking Byte up...`);

        const phasesSummary = active.phasesCompleted.length > 0
          ? active.phasesCompleted.map((p, idx) => `${idx + 1}. **${p.title}**`).join('\n')
          : '(No phases recorded yet)';

        const nextPhaseNumber = active.phasesCompleted.length + 1;
        const nextActionDirective = isAwaitingFeedback
          ? `CRITICAL ALERT: Jules is currently PAUSED in Google Cloud in state 'AWAITING_USER_FEEDBACK' on session (${julesId})! Jules cannot continue working until you reply! You MUST review Jules' progress/questions and call 'jules_reply_question' with session_id: "${julesId}" and your instructions, or call 'jules_continue_session' if directing the next phase. DO NOT return conversational text without calling a tool!`
          : isSessionCompleted
          ? `The previous Jules session (${julesId}) has finished. Completed sessions cannot accept messages in Google Cloud. You MUST call 'jules_create_task' to start Phase ${nextPhaseNumber} for your mission, or call 'jules_finalize_and_merge' to merge changes.`
          : julesId
          ? `Call 'jules_continue_session' with the next technical instructions (or 'jules_create_task' if starting Phase ${nextPhaseNumber}).`
          : `Call 'jules_create_task' to start Phase 1.`;

        const watchdogPrompt = `[DUTY SHIFT WATCHDOG ALERT: INACTIVITY DETECTED (> 2 MINUTES)]
Duty Shift: ${remainingDisplay} remaining of ${active.totalHours}h shift
Mission: "${active.missionPrompt}"
Alert: The system watchdog detected that Jules and Byte have both been idle for over 2 minutes without active tasks. ${isAwaitingFeedback ? 'Jules is waiting for your architectural feedback!' : ''}

Phases Completed So Far:
${phasesSummary}

MANDATORY DIRECTIVE FOR BYTE:
You are on an active engineering duty shift. Sitting idle is prohibited.
You MUST continue working on the overarching mission: "${active.missionPrompt}".
1. ${nextActionDirective}
2. CRITICAL: YOU MUST CALL THE TOOL! DO NOT return conversational text without calling a tool!
Invoke the tool NOW to continue duty!`;

        orchestrator.runAutonomousTurn(active.sessionId, watchdogPrompt, undefined, true).catch(console.error);
      }
    }
  }

  public recordTaskDispatched(sessionId: string, julesSessionId: string) {
    this.lastTaskDispatchedAt = Date.now();
    this.lastWatchdogNudgeAt = Date.now();
    const store = DataStore.getInstance();
    const active = store.getActiveDutyShift(sessionId) || store.getActiveDutyShift();
    if (active) {
      active.currentJulesSessionId = julesSessionId;
      store.saveDutyShift(active);
      this.broadcastShift(active);
    }
  }

  public broadcastShift(shift: DutyShift | null) {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('duty:updated', shift);
      }
    }
  }

  public startShift(sessionId: string, missionPrompt: string, hours: number): DutyShift {
    const store = DataStore.getInstance();
    
    // Deactivate any existing active shift for this session
    const existing = store.getActiveDutyShift(sessionId);
    if (existing) {
      existing.status = 'stopped';
      store.saveDutyShift(existing);
    }

    const durationHours = Math.max(0.5, hours || 8);
    const durationMs = Math.round(durationHours * 3600 * 1000);
    const startedAt = Date.now();
    const targetEndAt = startedAt + durationMs;

    const newShift: DutyShift = {
      id: `shift_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sessionId,
      missionPrompt: missionPrompt.trim(),
      totalHours: durationHours,
      durationMs,
      startedAt,
      targetEndAt,
      status: 'active',
      phasesCompleted: [],
      lastCheckAt: startedAt,
    };

    store.saveDutyShift(newShift);
    this.broadcastShift(newShift);

    if (Notification.isSupported()) {
      try {
        const notif = new Notification({
          title: 'Byte - Duty Shift Started',
          body: `Started ${durationHours}h continuous duty shift. Byte will actively supervise Jules until completed.`,
          silent: false,
        });
        notif.show();
      } catch (_) {}
    }

    return newShift;
  }

  public stopShift(shiftId: string): boolean {
    const store = DataStore.getInstance();
    const shift = store.getDutyShiftById(shiftId);
    if (!shift) return false;

    shift.status = 'stopped';
    store.saveDutyShift(shift);
    this.broadcastShift(shift);
    return true;
  }

  public pauseShift(shiftId: string): boolean {
    const store = DataStore.getInstance();
    const shift = store.getDutyShiftById(shiftId);
    if (!shift) return false;

    shift.status = 'paused';
    store.saveDutyShift(shift);
    this.broadcastShift(shift);
    return true;
  }

  public resumeShift(shiftId: string): boolean {
    const store = DataStore.getInstance();
    const shift = store.getDutyShiftById(shiftId);
    if (!shift) return false;

    shift.status = 'active';
    store.saveDutyShift(shift);
    this.broadcastShift(shift);
    return true;
  }

  public getActiveShift(sessionId?: string): DutyShift | null {
    return DataStore.getInstance().getActiveDutyShift(sessionId);
  }

  public async onJulesSessionMerged(julesSessionId: string, title?: string, prUrl?: string): Promise<boolean> {
    const store = DataStore.getInstance();
    const active = store.getActiveDutyShift();
    if (!active || active.status !== 'active') return false;

    const phase: DutyShiftPhase = {
      sessionId: julesSessionId,
      title: title || `Jules Task ${julesSessionId.slice(0, 8)}`,
      prUrl,
      completedAt: Date.now(),
    };

    active.phasesCompleted.push(phase);
    active.lastCheckAt = Date.now();
    store.saveDutyShift(active);
    this.broadcastShift(active);

    const remainingMs = active.targetEndAt - Date.now();

    if (remainingMs > 0) {
      const remainingDisplay = formatRemaining(remainingMs);
      const phasesLog = active.phasesCompleted
        .map((p, idx) => `${idx + 1}. **${p.title}**${p.prUrl ? ` ([PR](${p.prUrl}))` : ''}`)
        .join('\n');

      const nextPrompt = `[DUTY SHIFT IN PROGRESS — ${remainingDisplay} REMAINING OF ${active.totalHours}H SHIFT]
Original Duty Mission: "${active.missionPrompt}"

Phases Completed So Far in Cloud:
${phasesLog}

AUTONOMOUS LEAD DIRECTIVE FOR BYTE:
Your duty hours are NOT completed (${remainingDisplay} remaining).
Do NOT stop! You are on active duty.
Previous phase (${title || julesSessionId.slice(0, 8)}) was successfully completed and merged into the repository!
Formulate Phase ${active.phasesCompleted.length + 1} specification to continue the overarching mission ("${active.missionPrompt}") and call 'jules_create_task' NOW!`;

      // Trigger next autonomous turn on the chat session
      AgentOrchestrator.getInstance().runAutonomousTurn(active.sessionId, nextPrompt, undefined, true).catch((err) => {
        console.error('[DutyManager] Error triggering next duty turn:', err);
      });
      return true;
    } else {
      return this.completeShift(active.id);
    }
  }

  public async completeShift(shiftId: string): Promise<boolean> {
    const store = DataStore.getInstance();
    const shift = store.getDutyShiftById(shiftId);
    if (!shift || shift.status === 'completed') return false;

    shift.status = 'completed';
    store.saveDutyShift(shift);
    this.broadcastShift(shift);

    // Auto-finalize and merge all accumulated commits when leaving the shift!
    const lastPhase = shift.phasesCompleted[shift.phasesCompleted.length - 1];
    const julesId = shift.currentJulesSessionId || lastPhase?.sessionId;
    let mergeOutcome = 'No Jules tasks recorded to merge.';
    let isMergeSuccessful = false;

    if (julesId) {
      try {
        const { syncAndMergeJulesSession } = await import('../git/merger');
        const chat = store.getSession(shift.sessionId);
        const result = await syncAndMergeJulesSession(julesId, chat?.workspacePath || undefined);
        mergeOutcome = result.message;
        isMergeSuccessful = result.success;
      } catch (err: any) {
        mergeOutcome = `Merge error: ${err?.message || err}`;
        console.warn(`[DutyManager] Final shift merge error:`, err?.message || err);
      }
    }

    const phasesLog = shift.phasesCompleted
      .map((p, idx) => `${idx + 1}. **${p.title}**${p.prUrl ? ` ([PR](${p.prUrl}))` : ''}`)
      .join('\n');

    const handoverPrompt = `[DUTY SHIFT CONCLUDED — ${shift.totalHours} HOURS COMPLETED]
Original Duty Mission: "${shift.missionPrompt}"

Completed Phases in This Shift:
${phasesLog || '(No completed PRs recorded)'}

Local Merge Status:
${mergeOutcome}

CRITICAL DIRECTIVE FOR SHIFT HANDOVER REPORT:
1. TRUTHFUL REPORTING ONLY: You MUST report the actual, empirical status of the workspace based on the merge status above.
2. ${isMergeSuccessful ? 'Changes were successfully merged locally. Summarize the verified changes.' : 'CRITICAL ENFORCEMENT: Local merge was NOT successful or zero code changes were merged. You are STRICTLY FORBIDDEN from claiming changes are merged, that files were fixed, or that the mission is 100% complete. State the exact merge status honestly.'}
3. ZERO TEST FABRICATION: Do NOT invent or claim test metrics (e.g., claiming "75 unit tests passed") unless actual test commands were executed and verified in terminal outputs.
4. Provide an honest, transparent Senior Lead Engineer Shift Handover Report reflecting the true state of the repository.`;

    AgentOrchestrator.getInstance().runAutonomousTurn(shift.sessionId, handoverPrompt, undefined, true).catch((err) => {
      console.error('[DutyManager] Error triggering handover report:', err);
    });
    return true;
  }
}
