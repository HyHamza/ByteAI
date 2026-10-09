import { BrowserWindow, Notification } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JulesClient } from './client';
import type { JulesSessionSummary } from '../../../shared/types';
import { DataStore } from '../db/store';
import { AgentOrchestrator } from '../../agent/orchestrator';
import { syncAndMergeJulesSession } from '../git/merger';
import { DutyManager } from '../duty/manager';

const STATE_FILE = path.join(os.homedir(), '.seniorengineer', 'jules_supervisor_state.json');

interface SupervisorState {
  handledActivities: string[];
  handledCompletions: string[];
}

export class JulesPoller {
  private static instance: JulesPoller;
  private intervalId: NodeJS.Timeout | null = null;
  private handledCompletions: Set<string> = new Set();
  private handledActivities: Set<string> = new Set();
  private processingActivities: Set<string> = new Set();
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
    this.handledCompletions.delete(sessionId);
    this.saveState();
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

      // Broadcast full sessions list once to UI windows
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send('jules:all-sessions', sessions);
        }
      }

      // Auto-link existing chat sessions with matching Jules session IDs (ignore generic titles)
      const chatSessions = store.getSessions();
      let sessionsUpdated = false;

      const isGeneric = (t?: string) => {
        if (!t) return true;
        const clean = t.trim().toLowerCase();
        return clean === 'new task' || clean === 'new conversation' || clean === 'initial task' || clean === 'untitled';
      };

      for (const s of sessions) {
        const matching = chatSessions.find(
          (cs) => !cs.julesSessionId && (
            (!isGeneric(cs.title) && !isGeneric(s.title) && (
              cs.title.toLowerCase().includes(s.title.slice(0, 25).toLowerCase()) ||
              s.title.toLowerCase().includes(cs.title.slice(0, 25).toLowerCase())
            )) ||
            (cs.messages && cs.messages.some((m) => m.content && m.content.includes(s.id)))
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
    if (s.state === 'COMPLETED' || s.state === 'CANCELLED' || s.state === 'FAILED') return;
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
        if (!this.handledActivities.has(agentMsgAct.id)) {
          this.handledActivities.add(agentMsgAct.id);
          this.saveState();
        }
        return; // Already answered
      }
    }

    if (this.handledActivities.has(agentMsgAct.id) || this.processingActivities.has(agentMsgAct.id)) {
      return; // Already reviewed or currently processing
    }

    const julesMessage = 
      agentMsgAct.metadata?.agentMessaged?.agentMessage ||
      agentMsgAct.metadata?.agentMessaged?.message ||
      agentMsgAct.description ||
      'Jules is waiting for your input to continue working.';

    const isAwaitingFeedback = s.state === 'AWAITING_USER_FEEDBACK';
    const isQuestion = julesMessage.includes('?') || 
      /does this sound|should i|can you confirm|how would you|do you prefer|please confirm|what do you think|your thoughts/i.test(julesMessage);

    // 1. Show OS native Desktop Notification (even if window is minimized or hidden)
    if (Notification.isSupported()) {
      try {
        const notif = new Notification({
          title: isQuestion ? 'Byte - Jules Awaiting Decision' : 'Byte - Jules Worker Update',
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

    // 3. Formulate autonomous supervisor prompt
    let supervisorPrompt = '';
    if (isAwaitingFeedback || isQuestion) {
      supervisorPrompt = `[CRITICAL ACTION REQUIRED: JULES WORKER IS BLOCKED AND WAITING FOR YOU]
Jules Session ID: ${s.id}
Task Title: ${s.title || 'Ongoing Task'}
Current Status: ${s.state || 'AWAITING_USER_FEEDBACK'}

Jules Worker asked:
"""
${julesMessage}
"""

AUTONOMOUS LEAD DIRECTIVES FOR BYTE:
1. Jules is currently PAUSED in Google Cloud and CANNOT proceed until you provide architectural direction!
2. JULES CANNOT READ CHAT TEXT. YOU MUST CALL THE 'jules_reply_question' TOOL:
   - Tool: jules_reply_question
   - session_id: "${s.id}"
   - answer: "<Your clear engineering decision, approval, or architectural directions for Jules>"
3. Review Jules' proposal above: if it is architecturally sound and aligns with the user's objective, APPROVE IT AND INSTRUCT JULES TO PROCEED IMMEDIATELY!
4. Call 'jules_reply_question' NOW to unblock Jules. Then give a concise 1-line update to the user.`;
    } else {
      supervisorPrompt = `[AUTONOMOUS JULES WORKER UPDATE]
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
3. If Jules has completed its task or phase, report the findings clearly to the user.
4. If Jules requires guidance, call 'jules_reply_question' with session_id: "${s.id}" and your answer.`;
    }

    this.isProcessingTurn = true;
    this.processingActivities.add(agentMsgAct.id);

    try {
      await AgentOrchestrator.getInstance().runAutonomousTurn(chatSession.id, supervisorPrompt);

      // Verify if Jules received a reply
      const updatedActs = await client.listActivities(s.id).catch(() => []);
      const hasReplied = updatedActs.some(
        (a) => a.metadata?.originator === 'user' || a.metadata?.userMessaged || a.type === 'USER_MESSAGE'
      );

      if (!hasReplied && (isAwaitingFeedback || isQuestion)) {
        // Fallback: If the model generated text in chat instead of calling the tool, auto-forward it to Jules!
        const refreshedSession = store.getSession(chatSession.id);
        const lastMsg = refreshedSession?.messages[refreshedSession.messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content && lastMsg.content.trim()) {
          console.log(`[JulesPoller] Auto-forwarding assistant reply to unblock Jules session ${s.id}`);
          await client.sendFollowup(s.id, lastMsg.content.trim()).catch(() => {});
          this.handledActivities.add(agentMsgAct.id);
          this.saveState();
        }
      } else if (hasReplied) {
        this.handledActivities.add(agentMsgAct.id);
        this.saveState();
      }
    } finally {
      this.processingActivities.delete(agentMsgAct.id);
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
      // Check if an autonomous Duty Shift is currently active!
      const activeShift = DutyManager.getInstance().getActiveShift(chatSession.id);
      if (activeShift && activeShift.status === 'active') {
        await DutyManager.getInstance().onJulesSessionMerged(s.id, s.title, s.prUrl);
        return;
      }

      const summaryMsg = `[JULES SESSION TURN COMPLETED]
Session ID: ${s.id}
Task: ${s.title || s.id}
Status: COMPLETED (Turn finished in Google Cloud)
${s.prUrl ? `Pull Request / Remote Branch: ${s.prUrl}` : 'Jules has finished work on this prompt.'}

CRITICAL DIRECTIVES FOR BYTE:
1. THIS PHASE/TURN IS COMPLETED. DO NOT call 'jules_reply_question' (this prompt turn is closed).
2. 90% SESSION REUSE RULE:
   Whenever working on subsequent phases, refinements, bug fixes, or further requests for this task:
   YOU MUST CONTINUE IN THIS SAME JULES SESSION (${s.id}) USING 'jules_continue_session'!
   Do NOT call 'jules_create_task' to start a new session (90% of the time you must reuse this session).
3. DEFERRED MERGING (MERGE WHEN LEAVING SESSION):
   Do not perform intermediate merges while work is actively continuing in this session.
   All accumulated commits from this session will be merged when you are LEAVING this session:
   - If more phases/work remain: formulate the next specification and call 'jules_continue_session' NOW.
   - If ALL work on this task is completely finished, or if you are leaving this session: call 'jules_finalize_and_merge' with session_id: "${s.id}" to merge all commits into the local workspace and remote origin, then present your final summary to the user.`;

      AgentOrchestrator.getInstance().runAutonomousTurn(chatSession.id, summaryMsg).catch(console.error);
    }
  }
}
