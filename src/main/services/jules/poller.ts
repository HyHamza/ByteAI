import { BrowserWindow } from 'electron';
import { JulesClient } from './client';
import type { JulesSessionSummary } from '../../../shared/types';

export class JulesPoller {
  private static instance: JulesPoller;
  private intervalId: NodeJS.Timeout | null = null;
  private activeSessionIds: Set<string> = new Set();
  private lastSessionStates: Map<string, string> = new Map();

  private constructor() {}

  public static getInstance(): JulesPoller {
    if (!JulesPoller.instance) {
      JulesPoller.instance = new JulesPoller();
    }
    return JulesPoller.instance;
  }

  public trackSession(sessionId: string) {
    this.activeSessionIds.add(sessionId);
    if (!this.intervalId) {
      this.startPolling();
    }
  }

  public untrackSession(sessionId: string) {
    this.activeSessionIds.delete(sessionId);
    if (this.activeSessionIds.size === 0 && this.intervalId) {
      this.stopPolling();
    }
  }

  public startPolling(pollIntervalMs = 20000) {
    if (this.intervalId) clearInterval(this.intervalId);

    this.intervalId = setInterval(async () => {
      await this.pollActiveSessions();
    }, pollIntervalMs);

    // Initial immediate poll
    this.pollActiveSessions();
  }

  public stopPolling() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async pollActiveSessions() {
    if (this.activeSessionIds.size === 0) return;

    const client = JulesClient.getInstance();
    for (const sessionId of Array.from(this.activeSessionIds)) {
      try {
        const raw = await client.getSession(sessionId);
        const state = raw.state || 'STATE_UNSPECIFIED';

        const summary: JulesSessionSummary = {
          id: sessionId,
          title: raw.title,
          state,
          repo: raw.sourceContext?.github?.repo || '',
          branch: raw.sourceContext?.github?.startingBranch || 'main',
          createdAt: raw.createTime,
          updatedAt: raw.updateTime,
          prUrl: raw.outputs?.pullRequest?.url,
          prNumber: raw.outputs?.pullRequest?.number,
        };

        // Notify all UI windows
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send('jules:update', summary);
          }
        }

        const previousState = this.lastSessionStates.get(sessionId);
        this.lastSessionStates.set(sessionId, state);

        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(state)) {
          this.untrackSession(sessionId);
        }
      } catch (err) {
        console.error(`Error polling Jules session ${sessionId}:`, err);
      }
    }
  }
}
