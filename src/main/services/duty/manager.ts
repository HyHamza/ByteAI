import { BrowserWindow, Notification } from 'electron';
import type { DutyShift, DutyShiftPhase } from '../../../shared/types';
import { DataStore } from '../db/store';
import { AgentOrchestrator } from '../../agent/orchestrator';

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
    // Periodically broadcast remaining time and check shift status every 60s
    this.heartbeatInterval = setInterval(() => {
      this.checkActiveShifts();
    }, 60000);
  }

  private checkActiveShifts() {
    const store = DataStore.getInstance();
    const active = store.getActiveDutyShift();
    if (!active) return;

    active.lastCheckAt = Date.now();
    store.saveDutyShift(active);
    this.broadcastShift(active);

    // If past end time and no task running, mark completed
    if (Date.now() >= active.targetEndAt && active.status === 'active') {
      this.completeShift(active.id);
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
90% OF THE TIME: CONTINUE IN THE SAME JULES SESSION (${julesSessionId}) using 'jules_continue_session'!
Preserve the existing container and branch. All accumulated commits will be merged when the shift concludes or when leaving the session.
Formulate the NEXT substantive phase specification and call 'jules_continue_session' NOW!`;

      // Trigger next autonomous turn on the chat session
      AgentOrchestrator.getInstance().runAutonomousTurn(active.sessionId, nextPrompt).catch((err) => {
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
    if (julesId) {
      try {
        const { syncAndMergeJulesSession } = await import('../git/merger');
        const chat = store.getSession(shift.sessionId);
        await syncAndMergeJulesSession(julesId, chat?.workspacePath || undefined);
      } catch (err: any) {
        console.warn(`[DutyManager] Final shift merge error:`, err?.message || err);
      }
    }

    const phasesLog = shift.phasesCompleted
      .map((p, idx) => `${idx + 1}. **${p.title}**${p.prUrl ? ` ([PR](${p.prUrl}))` : ''}`)
      .join('\n');

    const handoverPrompt = `[DUTY SHIFT COMPLETED — ${shift.totalHours} HOURS COMPLETED & ALL COMMITS MERGED]
Original Duty Mission: "${shift.missionPrompt}"

All Completed Phases in This Shift:
${phasesLog || '(No completed PRs recorded)'}

AUTONOMOUS LEAD DIRECTIVE FOR BYTE:
Your scheduled duty hours have concluded and all commits have been merged into the local workspace and remote repository!
Generate a comprehensive, beautifully structured **Senior Engineer Shift Handover Report** for the user summarizing:
1. Executive Summary of work accomplished across the entire duty shift.
2. All commits and features/bug fixes deployed.
3. Key architectural decisions and enhancements.
4. Next recommended steps for the user.`;

    AgentOrchestrator.getInstance().runAutonomousTurn(shift.sessionId, handoverPrompt).catch((err) => {
      console.error('[DutyManager] Error triggering handover report:', err);
    });
    return true;
  }
}
