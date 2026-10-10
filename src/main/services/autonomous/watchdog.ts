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

      // Skip if task has been explicitly completed
      if (session.taskState === 'completed') continue;

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

        console.log(`[AutonomousWatchdog] Inactivity (> 2m) detected on autonomous session ${sessionId}. Waking up Byte...`);

        const isJulesMode = session.mode === 'jules';

        const prompt = `[AUTONOMOUS MODE INACTIVITY WATCHDOG: TASK NOT COMPLETED]
Autonomous Mode is ACTIVE for this task.
System Alert: Both Byte and Jules have been inactive for over 2 minutes without completing the user's task.

CRITICAL DIRECTIVE:
In Autonomous Mode, the user is away and expects you to drive this task to 100% completion autonomously.
The user is NOT available for next instructions, answers, or step-by-step approvals.
Think carefully as a Senior Lead Software Engineer, make the technical decisions yourself, resolve any ambiguities, and continue working.

Active Mode: ${isJulesMode ? 'Jules Lead Mode' : 'Standard Mode'}

${isJulesMode ? `Jules Mode Instructions:
${isJulesAwaitingFeedback ? `- CRITICAL: Jules is PAUSED waiting for your feedback in Google Cloud on session (${julesSessionId})! You must inspect its changes and immediately call 'jules_reply_question' with your approval/direction.` : `- Check the status of your Jules task (${julesSessionId || 'none'}).
- If completed, inspect diffs and call 'jules_finalize_and_merge' to merge changes into the local workspace.
- If more work is required, call 'jules_continue_session' or 'jules_create_task' with the next specification.`}` : `Standard Mode Instructions:
- Review the user's objective and inspect the codebase.
- If you stopped because of an error or ambiguity, investigate the code, make the necessary modifications using 'replace_file_content' or 'write_file', and verify with 'run_terminal_command'.
- Do not stop to ask questions. Make sound architectural decisions and implement them.`}

Execute your tools NOW to continue making progress!`;

        orchestrator.runAutonomousTurn(sessionId, prompt, undefined, true).catch(console.error);
      }
    }
  }
}
