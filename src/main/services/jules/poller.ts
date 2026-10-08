import { BrowserWindow, Notification } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JulesClient } from './client';
import type { JulesSessionSummary } from '../../../shared/types';
import { DataStore } from '../db/store';
import { AgentOrchestrator } from '../../agent/orchestrator';

const STATE_FILE = path.join(os.homedir(), '.seniorengineer', 'jules_supervisor_state.json');

interface SupervisorState {
  handledActivities: string[];
  handledCompletions: string[];
}

export class JulesPoller {
  private static instance: JulesPoller;
  private intervalId: NodeJS.Timeout | null = null;
  private handledActivities: Set<string> = new Set();
  private handledCompletions: Set<string> = new Set();
  private isProcessingTurn = false;

  private constructor() {
    this.loadState();
  }

  public static getInstance(): JulesPoller {
    if (!JulesPoller.instance) {
      JulesPoller.instance = new JulesPoller();
    }
    return JulesPoller.instance;
  }

  private loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf-8');
        const parsed: SupervisorState = JSON.parse(raw);
        if (Array.isArray(parsed.handledActivities)) {
          this.handledActivities = new Set(parsed.handledActivities);
        }
        if (Array.isArray(parsed.handledCompletions)) {
          this.handledCompletions = new Set(parsed.handledCompletions);
        }
      }
    } catch (_) {}
  }

  private saveState() {
    try {
      const data: SupervisorState = {
        handledActivities: Array.from(this.handledActivities),
        handledCompletions: Array.from(this.handledCompletions),
      };
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (_) {}
  }

  public trackSession(sessionId: string) {
    if (!this.intervalId) {
      this.startPolling();
    }
  }

  public startPolling(pollIntervalMs = 12000) {
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

  public async pollActiveSessions() {
    const store = DataStore.getInstance();
    const settings = store.getSettings();
    if (!settings.julesApiKey && !process.env.JULES_API_KEY) {
      return;
    }

    const client = JulesClient.getInstance();

    try {
      const sessions = await client.listSessions();
      if (!sessions || sessions.length === 0) return;

      // Broadcast full sessions list to UI windows
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send('jules:all-sessions', sessions);
        }
      }

      // Auto-link existing chat sessions with matching Jules session IDs
      const chatSessions = store.getSessions();
      let sessionsUpdated = false;
      for (const s of sessions) {
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send('jules:update', s);
          }
        }

        const matching = chatSessions.find(
          (cs) => !cs.julesSessionId && (
            (cs.title && s.title && (
              cs.title.toLowerCase().includes(s.title.slice(0, 25).toLowerCase()) ||
              s.title.toLowerCase().includes(cs.title.slice(0, 25).toLowerCase())
            )) ||
            cs.messages.some((m) => m.content && m.content.includes(s.id))
          )
        );
        if (matching) {
          matching.julesSessionId = s.id;
          store.saveSession(matching);
          sessionsUpdated = true;
        }
      }

      if (sessionsUpdated) {
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send('sessions:updated', store.getSessions());
          }
        }
      }

      // Find sessions requiring active intervention
      for (const s of sessions) {
        if (s.state === 'COMPLETED') {
          await this.handleSessionCompleted(s);
        } else if (s.state !== 'CANCELLED' && s.state !== 'FAILED') {
          // Check ANY active session (IN_PROGRESS, AWAITING_FEEDBACK, etc.) for unhandled agent questions
          await this.handleAwaitingFeedback(s);
        }
      }
    } catch (err: any) {
      console.warn('Error in Jules background supervisor polling:', err?.message || err);
    }
  }

  private async handleAwaitingFeedback(s: JulesSessionSummary) {
    if (this.isProcessingTurn) return; // Wait for current turn to complete

    const client = JulesClient.getInstance();
    const activities = await client.listActivities(s.id).catch(() => []);
    if (!activities || activities.length === 0) return;

    // Find the latest message or question from the agent (newest to oldest)
    const reversed = [...activities].reverse();
    const agentMsgAct = reversed.find(
      (a) =>
        (a.metadata?.originator === 'agent' || a.metadata?.agentMessaged) &&
        (a.metadata?.agentMessaged?.agentMessage || a.metadata?.agentMessaged?.message || a.type === 'AGENT_MESSAGE')
    );

    if (!agentMsgAct || !agentMsgAct.id) return;

    // Check if there is already a newer user message that answered this agent message
    const agentMsgIndex = activities.findIndex((a) => a.id === agentMsgAct.id);
    if (agentMsgIndex !== -1) {
      const subsequentUserMsg = activities.slice(agentMsgIndex + 1).find(
        (a) => a.metadata?.originator === 'user' || a.metadata?.userMessaged || a.type === 'USER_MESSAGE'
      );
      if (subsequentUserMsg) {
        return; // Already answered
      }
    }

    if (this.handledActivities.has(agentMsgAct.id)) {
      return; // Already reviewed and handled this message
    }

    this.handledActivities.add(agentMsgAct.id);
    this.saveState();

    const julesMessage = 
      agentMsgAct.metadata?.agentMessaged?.agentMessage ||
      agentMsgAct.metadata?.agentMessaged?.message ||
      agentMsgAct.description ||
      'Jules is waiting for your input to continue working.';

    // 1. Show OS native Desktop Notification (even if window is minimized or hidden)
    if (Notification.isSupported()) {
      try {
        const notif = new Notification({
          title: 'Byte - Jules Worker Update',
          body: `Task: ${s.title || s.id}\n${julesMessage.slice(0, 120)}...`,
          silent: false,
        });
        notif.show();
      } catch (_) {}
    }

    // 2. Find or create matching ChatSession in SeniorEngineer
    const store = DataStore.getInstance();
    const existing = store.getSessions();
    let chatSession = existing.find(
      (cs) =>
        (cs.julesSessionId && cs.julesSessionId === s.id) ||
        cs.messages.some((m) => m.content && m.content.includes(s.id)) ||
        (cs.title && cs.title.toLowerCase().includes((s.title || '').toLowerCase()))
    );

    if (!chatSession) {
      chatSession = store.saveSession({
        id: `ses_jules_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        workspacePath: store.getSettings().activeWorkspacePath || process.cwd(),
        title: s.title || `Jules: ${s.id.slice(0, 8)}`,
        mode: 'jules',
        julesSessionId: s.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      });
    } else if (!chatSession.julesSessionId) {
      chatSession.julesSessionId = s.id;
      store.saveSession(chatSession);
    }

    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('sessions:updated', store.getSessions());
      }
    }

    // 3. Wake up Byte (Orchestrator) in the background to formulate architectural response
    const supervisorPrompt = `[AUTONOMOUS JULES WORKER UPDATE]
Jules Session ID: ${s.id}
Task Title: ${s.title || 'Ongoing Task'}
Current Status: ${s.state || 'IN_PROGRESS'}

Jules Worker reported:
"""
${julesMessage}
"""

SUPERVISOR DIRECTIVES FOR BYTE:
1. You are the Senior Lead Architect supervising this Jules worker.
2. Review Jules' findings/report above against the user's objective.
3. IF Jules has delivered the requested analysis, report, answer, or code changes:
   - Present the COMPLETE findings, report, and breakdown directly to the USER in clean, comprehensive markdown!
   - DO NOT call 'jules_reply_question' to generate unsolicited extra plans, checklists, or work unless the user explicitly requested them.
   - Conclude by asking the user if they would like to proceed with any of the recommended updates or implementation steps.
4. ONLY IF Jules asked a specific question, is blocked, or explicitly requested user/lead direction to proceed:
   - Formulate your architectural decision.
   - Call the 'jules_reply_question' tool with session_id: "${s.id}" and your answer.
   - Provide a concise summary to the user explaining what you directed Jules to do.`;

    this.isProcessingTurn = true;
    try {
      await AgentOrchestrator.getInstance().runAutonomousTurn(chatSession.id, supervisorPrompt);
    } finally {
      this.isProcessingTurn = false;
    }
  }

  private async handleSessionCompleted(s: JulesSessionSummary) {
    if (this.handledCompletions.has(s.id)) return;

    this.handledCompletions.add(s.id);
    this.saveState();

    // OS Notification
    if (Notification.isSupported()) {
      try {
        new Notification({
          title: 'Byte - Jules Task Completed!',
          body: `Task "${s.title || s.id}" finished! ${s.prUrl ? `PR: ${s.prUrl}` : ''}`,
          silent: false,
        }).show();
      } catch (_) {}
    }

    // Broadcast to UI
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('jules:notification', {
          sessionId: s.id,
          title: s.title,
          message: `Task completed! ${s.prUrl || ''}`,
          timestamp: Date.now(),
        });
      }
    }

    // Find and update matching chat session
    const store = DataStore.getInstance();
    const existing = store.getSessions();
    const chatSession = existing.find(
      (cs) =>
        (cs.julesSessionId && cs.julesSessionId === s.id) ||
        cs.messages.some((m) => m.content && m.content.includes(s.id)) ||
        (cs.title && cs.title.toLowerCase().includes((s.title || '').toLowerCase()))
    );

    if (chatSession) {
      const summaryMsg = `[JULES TASK COMPLETED]\nTask: ${s.title || s.id}\nStatus: COMPLETED\n${s.prUrl ? `Pull Request: ${s.prUrl}` : 'The remote worker has finished the task.'}\n\nPlease inspect the final diff and provide a comprehensive completion summary to the user.`;
      AgentOrchestrator.getInstance().runAutonomousTurn(chatSession.id, summaryMsg).catch(console.error);
    }
  }
}
