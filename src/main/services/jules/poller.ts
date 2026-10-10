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
  lastSupervisorTurnAt?: Record<string, number>;
}

export class JulesPoller {
  private static instance: JulesPoller;
  private intervalId: NodeJS.Timeout | null = null;
  private handledCompletions: Set<string> = new Set();
  private handledActivities: Set<string> = new Set();
  private processingActivities: Set<string> = new Set();
  private lastSupervisorTurnAt: Map<string, number> = new Map();
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
        if (parsed.lastSupervisorTurnAt && typeof parsed.lastSupervisorTurnAt === 'object') {
          this.lastSupervisorTurnAt = new Map(Object.entries(parsed.lastSupervisorTurnAt));
        }
      }
    } catch (_) {}
  }

  private saveState() {
    try {
      const turnObj: Record<string, number> = {};
      for (const [k, v] of this.lastSupervisorTurnAt.entries()) {
        turnObj[k] = v;
      }
      const data: SupervisorState = {
        handledActivities: Array.from(this.handledActivities),
        handledCompletions: Array.from(this.handledCompletions),
        lastSupervisorTurnAt: turnObj,
      };
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (_) {}
  }

  public trackSession(sessionId: string) {
    this.handledCompletions.delete(sessionId);
    this.lastSupervisorTurnAt.delete(sessionId);
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
            win.webContents.send('sessions:updated', store.getSessionSummaries());
          }
        }
      }

      // Find sessions requiring active intervention
      for (const s of sessions) {
        if (s.state === 'COMPLETED') {
          await this.handleSessionCompleted(s);
        } else if (s.state === 'AWAITING_USER_FEEDBACK' || s.state === 'AWAITING_USER_INPUT') {
          // Jules is paused in Google Cloud waiting for explicit architectural review or question reply
          await this.handleAwaitingFeedback(s);
        }
      }
    } catch (err: any) {
      console.warn('Error in Jules background supervisor polling:', err?.message || err);
    }
  }

  private async handleAwaitingFeedback(s: JulesSessionSummary) {
    if (s.state !== 'AWAITING_USER_FEEDBACK' && s.state !== 'AWAITING_USER_INPUT') return;
    if (this.isProcessingTurn) return; // Wait for current turn to complete

    // Cooldown check: Do not re-trigger an autonomous supervisor turn for the same session within 3 minutes
    const lastTurn = this.lastSupervisorTurnAt.get(s.id) || 0;
    if (Date.now() - lastTurn < 180_000) {
      return;
    }

    const client = JulesClient.getInstance();
    const activities = await client.listActivities(s.id).catch(() => []);
    if (!activities || activities.length === 0) return;

    const isUserMsg = (a: any) =>
      a.originator === 'user' ||
      a.metadata?.originator === 'user' ||
      a.userMessaged ||
      a.metadata?.userMessaged ||
      a.type === 'USER_MESSAGE';

    const isAgentMsg = (a: any) =>
      a.originator === 'agent' ||
      a.metadata?.originator === 'agent' ||
      a.agentMessaged ||
      a.metadata?.agentMessaged ||
      a.type === 'AGENT_MESSAGE';

    // Find the latest interactive message between user and agent
    const reversed = [...activities].reverse();
    const lastConversational = reversed.find((a) => isUserMsg(a) || isAgentMsg(a) || a.metadata?.planGenerated);

    // If the latest message was from user/Byte, we already answered Jules! Do not wake up Byte.
    if (lastConversational && isUserMsg(lastConversational)) {
      return;
    }

    // Find the latest agent message or plan proposal requiring review
    const targetAct = reversed.find(
      (a) =>
        (isAgentMsg(a) && (a.agentMessaged?.agentMessage || a.agentMessaged?.message || a.metadata?.agentMessaged?.agentMessage || a.metadata?.agentMessaged?.message || a.description)) ||
        a.metadata?.planGenerated
    );

    if (!targetAct || !targetAct.id) return;

    // Check if there is already a newer user message that answered this activity
    const targetActIndex = activities.findIndex((a) => a.id === targetAct.id);
    if (targetActIndex !== -1) {
      const subsequentUserMsg = activities.slice(targetActIndex + 1).find(isUserMsg);
      if (subsequentUserMsg) {
        if (!this.handledActivities.has(targetAct.id)) {
          this.handledActivities.add(targetAct.id);
          this.saveState();
        }
        return; // Already answered
      }
    }

    if (this.handledActivities.has(targetAct.id) || this.processingActivities.has(targetAct.id)) {
      return; // Already reviewed or currently processing
    }

    const julesMessage =
      targetAct.agentMessaged?.agentMessage ||
      targetAct.agentMessaged?.message ||
      targetAct.metadata?.agentMessaged?.agentMessage ||
      targetAct.metadata?.agentMessaged?.message ||
      (targetAct.metadata?.planGenerated ? 'Jules has generated an execution plan and is waiting for your review and approval.' : '') ||
      targetAct.description ||
      'Jules has updated the project in Google Cloud and is currently paused awaiting your architectural feedback / review to proceed.';

    // 1. Show OS native Desktop Notification (even if window is minimized or hidden)
    if (Notification.isSupported()) {
      try {
        const notif = new Notification({
          title: 'Byte - Jules Awaiting Decision',
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
        win.webContents.send('sessions:updated', store.getSessionSummaries());
      }
    }

    // 3. Formulate autonomous supervisor prompt (strictly for unblocking blocked workers)
    const supervisorPrompt = `[CRITICAL ACTION REQUIRED: JULES WORKER IS BLOCKED AND WAITING FOR YOU]
Jules Session ID: ${s.id}
Task Title: ${s.title || 'Ongoing Task'}
Current Status: ${s.state || 'AWAITING_USER_FEEDBACK'}

Jules Worker Status / Request:
"""
${julesMessage}
"""

AUTONOMOUS LEAD DIRECTIVES FOR BYTE:
1. Jules is currently PAUSED in Google Cloud and CANNOT proceed until you provide architectural direction!
2. JULES CANNOT READ CHAT TEXT. YOU MUST CALL THE 'jules_reply_question' TOOL:
   - Tool: jules_reply_question
   - session_id: "${s.id}"
   - answer: "<Your clear engineering decision, approval, or architectural directions for Jules>"
3. Review Jules' proposal or changes above: if sound and aligned with the user's objective, APPROVE IT AND INSTRUCT JULES TO PROCEED IMMEDIATELY!
4. Call 'jules_reply_question' NOW to unblock Jules. Then give a concise 1-line update to the user.`;

    this.isProcessingTurn = true;
    this.processingActivities.add(targetAct.id);
    this.lastSupervisorTurnAt.set(s.id, Date.now());

    try {
      await AgentOrchestrator.getInstance().runAutonomousTurn(chatSession.id, supervisorPrompt, undefined, true);

      // Verify if Jules received a reply
      const updatedActs = await client.listActivities(s.id).catch(() => []);
      const hasReplied = updatedActs.some(isUserMsg);

      if (!hasReplied) {
        // Fallback: If the model generated text in chat instead of calling the tool, auto-forward it to Jules!
        const refreshedSession = store.getSession(chatSession.id);
        const lastMsg = refreshedSession?.messages[refreshedSession.messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content && lastMsg.content.trim()) {
          console.log(`[JulesPoller] Auto-forwarding assistant reply to unblock Jules session ${s.id}`);
          await client.sendFollowup(s.id, lastMsg.content.trim()).catch(() => {});
        }
      }

      this.handledActivities.add(targetAct.id);
      this.lastSupervisorTurnAt.set(s.id, Date.now());
      this.saveState();
    } finally {
      this.processingActivities.delete(targetAct.id);
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

      AgentOrchestrator.getInstance().runAutonomousTurn(chatSession.id, summaryMsg, undefined, true).catch(console.error);
    }
  }
}
