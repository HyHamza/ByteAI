import { BrowserWindow } from 'electron';
import { DataStore } from '../db/store';
import { AgentOrchestrator } from '../../agent/orchestrator';
import { JulesClient } from '../jules/client';
import { TaskManager } from '../task/manager';

export class AutonomousWatchdog {
  private static instance: AutonomousWatchdog;
  private interval: NodeJS.Timeout | null = null;
  private lastActivityMap: Map<string, number> = new Map();
  private lastNudgeMap: Map<string, number> = new Map();

  // Inactivity threshold: 2 minutes (120 seconds) of confirmed inactivity
  private static readonly INACTIVITY_THRESHOLD_MS = 120_000;

  private constructor() {
    this.start();
  }

  public static getInstance(): AutonomousWatchdog {
    if (!AutonomousWatchdog.instance) {
      AutonomousWatchdog.instance = new AutonomousWatchdog();
    }
    return AutonomousWatchdog.instance;
  }

  public start() {
    if (this.interval) clearInterval(this.interval);
    // Periodically inspect active autonomous sessions every 15 seconds
    this.interval = setInterval(() => {
      this.checkSessions().catch(console.error);
    }, 15_000);
  }

  public stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  public recordActivity(sessionId: string) {
    this.lastActivityMap.set(sessionId, Date.now());
  }

  public setAutonomousMode(sessionId: string, enabled: boolean) {
    const store = DataStore.getInstance();
    store.updateSession(sessionId, { autonomousMode: enabled });
    if (enabled) {
      this.lastActivityMap.set(sessionId, Date.now());
      this.lastNudgeMap.delete(sessionId);
    }
    this.broadcastSessionUpdate(sessionId, enabled);
  }

  public toggleAutonomousMode(sessionId: string): boolean {
    const store = DataStore.getInstance();
    const session = store.getSession(sessionId);
    const newStatus = !session?.autonomousMode;
    this.setAutonomousMode(sessionId, newStatus);
    return newStatus;
  }

  private broadcastSessionUpdate(sessionId: string, enabled: boolean) {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('session:autonomous-mode-updated', { sessionId, enabled });
      }
    }
  }

  private async checkSessions() {
    const store = DataStore.getInstance();
    const sessions = store.getSessions();
    const now = Date.now();
    const orchestrator = AgentOrchestrator.getInstance();
    const runningSessionIds = orchestrator.getRunningSessions();

    for (const session of sessions) {
      // Only monitor sessions where Autonomous Mode is enabled
      if (!session.autonomousMode) continue;

      // Skip if task has been completed, paused, cancelled, failed, or is idle
      if (
        session.taskState === 'completed' ||
        session.taskState === 'paused' ||
        session.taskState === 'cancelled' ||
        session.taskState === 'failed' ||
        session.taskState === 'idle'
      ) {
        continue;
      }

      const sessionId = session.id;

      // 1. Is Byte currently running in this session?
      if (runningSessionIds.includes(sessionId)) {
        this.lastActivityMap.set(sessionId, now);
        continue;
      }

      // 2. Are any local background terminal tasks actively running for this session?
      const runningTasks = TaskManager.getInstance().getRunningTasks(sessionId);
      if (runningTasks && runningTasks.length > 0) {
        this.lastActivityMap.set(sessionId, now);
        continue;
      }

      // 3. Is Jules currently active in Google Cloud?
      let isJulesAwaitingFeedback = false;
      const julesSessionId = session.julesSessionId;

      if (session.mode === 'jules' && julesSessionId) {
        try {
          const client = JulesClient.getInstance();
          const julesSession = await client.getSession(julesSessionId);
          const activeCodingStates = [
            'IN_PROGRESS',
            'PLANNING',
            'CODING',
            'INITIALIZING',
            'QUEUED',
            'PENDING',
          ];
          if (activeCodingStates.includes(julesSession?.state)) {
            // Jules is actively coding in cloud VM
            this.lastActivityMap.set(sessionId, now);
            continue;
          } else if (
            julesSession?.state === 'AWAITING_USER_FEEDBACK' ||
            julesSession?.state === 'AWAITING_USER_INPUT'
          ) {
            isJulesAwaitingFeedback = true;
          }
        } catch (_) {}
      }

      // 4. Calculate inactivity duration
      const lastActivity = this.lastActivityMap.get(sessionId) || session.updatedAt || session.createdAt || now;
      const idleMs = now - lastActivity;
      const lastNudge = this.lastNudgeMap.get(sessionId) || 0;
      const timeSinceLastNudge = now - lastNudge;

      // When inactive for 2 minutes and not nudged within the last 2 minutes
      if (idleMs >= AutonomousWatchdog.INACTIVITY_THRESHOLD_MS && timeSinceLastNudge >= AutonomousWatchdog.INACTIVITY_THRESHOLD_MS) {
        this.lastNudgeMap.set(sessionId, now);
        this.lastActivityMap.set(sessionId, now);

        console.log(`[AutonomousWatchdog] Inactivity (> 2m) detected on autonomous session ${sessionId} (taskState: ${session.taskState || 'unspecified'}). Waking up Byte...`);

        const isJulesMode = session.mode === 'jules';

        // Case A: The agent is waiting for user feedback, but the user has been away for > 2 minutes
        if (session.taskState === 'awaiting_feedback') {
          const prompt = `[AUTONOMOUS MODE: USER UNAVAILABLE (> 2 MINUTES) - MAKE EXECUTIVE DECISION]
Task State: awaiting_feedback
Autonomous Mode is ACTIVE for this task.
System Notice: You previously requested user feedback or presented options, but the user is currently away (> 2 minutes).

CRITICAL DIRECTIVE FOR SENIOR LEAD ENGINEER:
In Autonomous Mode, you have full ownership. You must NOT remain blocked or idle waiting indefinitely for user responses.
1. Review the question, proposal, or architectural choices you previously presented.
2. Make the optimal, production-grade engineering decision yourself.
3. Call 'set_task_state' with state: 'in_progress', summary: "<Your chosen decision>".
4. Proceed immediately with executing the implementation or next steps!`;

          orchestrator.runAutonomousTurn(sessionId, prompt, undefined, true).catch(console.error);
          continue;
        }

        // Case B: General inactivity on an in_progress task
        const prompt = `[AUTONOMOUS MODE INACTIVITY WATCHDOG: TASK NOT COMPLETED]
Autonomous Mode is ACTIVE for this task (Current state: ${session.taskState || 'in_progress'}).
System Alert: Both Byte and Jules have been inactive for over 2 minutes without completing the user's task.

CRITICAL DIRECTIVES:
1. IF ALL REQUESTED WORK IS 100% COMPLETE AND VERIFIED:
   You MUST call 'set_task_state' with state: 'completed' NOW! This permanently confirms completion and stops watchdog alerts.
2. IF WORK REMAINS:
   The user is away in Autonomous Mode and expects you to drive the task forward. Make the necessary technical decisions yourself and invoke your tools to continue!

Active Mode: ${isJulesMode ? 'Jules Lead Mode' : 'Standard Mode'}

${isJulesMode ? `Jules Mode Instructions:
${isJulesAwaitingFeedback ? `- CRITICAL: Jules is PAUSED waiting for your feedback in Google Cloud on session (${julesSessionId})! Inspect its proposal and immediately call 'jules_reply_question' with your approval/direction.` : `- If Jules finished work, inspect and call 'jules_finalize_and_merge' to merge changes into the local workspace.
- If more work is required, call 'jules_continue_session' or 'jules_create_task' with the next specification.
- If all work is verified and complete, call 'set_task_state' with state: 'completed'.`}` : `Standard Mode Instructions:
- Implement any remaining code using 'replace_file_content' or 'write_file'.
- Test and verify using 'run_terminal_command'.
- When complete, call 'set_task_state' with state: 'completed'.`}

Execute your tools NOW to continue!`;

        orchestrator.runAutonomousTurn(sessionId, prompt, undefined, true).catch(console.error);
      }
    }
  }
}
