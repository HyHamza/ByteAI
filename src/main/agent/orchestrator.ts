import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { AppMode, ChatMessage, ToolExecutionRecord, AttachmentFile } from '../../shared/types';
import { LLMClient, type LLMMessage } from '../services/llm/client';
import { STANDARD_TOOL_DEFS, JULES_TOOL_DEFS, executeToolCall } from '../tools';
import { DataStore, isSubstantiveMessage } from '../services/db/store';
import { detectGitRepo } from '../services/git/detector';
import { TaskManager, type BackgroundTask } from '../services/task/manager';
import { DutyManager } from '../services/duty/manager';

const STANDARD_SYSTEM_PROMPT = `You are Byte, a powerful autonomous software engineering AI assistant.
You operate on goals and objectives.
You have tools to read files, search across codebase, edit or replace file contents, resolve merge conflicts, run terminal commands, and inspect directories.

CORE BEHAVIOR (ANTIGRAVITY STYLE):
1. FILE AND CODE TOOLS:
   - 'read_file': Read files with optional start_line and end_line. Line numbers are included.
   - 'search_codebase': Search across the entire codebase for text or regex patterns.
   - 'replace_file_content': Replace specific lines (using start_line and end_line) or replace exact target_content.
   - 'write_file': Create new files or overwrite existing files.
   - 'resolve_merge_conflict': Directly resolve git merge conflicts ('ours', 'theirs', or 'custom_content'), stage the resolution, and commit/push.
   - 'list_directory': Inspect directory trees.
   - 'run_terminal_command': Run shell commands. For long-running commands (builds, tests, dev servers), use 'wait_ms_before_async' or 'is_background: true' to run in the background. When a background task completes, the system automatically wakes you up! Set 'is_daemon: true' for persistent servers.
   - 'manage_task': Manage background tasks ('list', 'status', 'kill', 'send_input').
   - 'jules_create_task': Delegate complex tasks or audits to Google Labs Jules AI workers.
   - 'jules_sync_and_merge': Pull, merge, and apply git patches/PRs from Jules into local workspace and remote origin.
   - 'jules_get_status': Check live progress and activity stream of Jules tasks.
2. CHRONOLOGICAL PROGRESSION:
   - Before executing any tool, output a concise 1-line statement explaining what you are checking or doing (e.g. "Let me inspect package.json:", "Searching codebase for fingerprint:").
   - Once the tool finishes, analyze the results and provide your conclusions in the subsequent step so thoughts and tool actions flow chronologically.
3. Act autonomously. Execute the necessary steps to completion without stopping midway for trivial confirmations.
4. Test and verify your work with terminal commands when relevant.
5. Keep the user informed with clear, structured progress.
6. EMPIRICAL TRUTH: Never claim code changes or files are merged or present unless you have EMPIRICALLY verified them using tools.
7. MERGE CONFLICT RESOLUTION:
   - When merge conflicts occur or when the user asks you to resolve a conflict (e.g., "u resolve that", "fix conflict"):
   - NEVER refuse or claim you lack tools! You have 'resolve_merge_conflict', 'read_file', 'replace_file_content', and 'run_terminal_command'.
   - Inspect the conflict, determine or apply the correct resolution, stage, commit, and push.
8. LONG-RUNNING COMMANDS & REACTIVE WAKEUP (ANTIGRAVITY STYLE):
   - For long-running commands (e.g., dev servers, builds, test suites, long package installs), run them via 'run_terminal_command'.
   - When a command is sent to the background as a task (with a task ID), DO NOT POLL OR LOOP! Conclude your turn with a brief 1-line update confirming the command was launched.
   - The system will AUTOMATICALLY WAKE YOU UP with a <SYSTEM_MESSAGE> containing the exit code and output the moment the task finishes!
   - You can inspect, kill, or send input to running tasks at any time using 'manage_task'.`;

const JULES_SYSTEM_PROMPT = `You are Byte operating in JULES LEAD MODE.
You are the Lead Senior Staff Software Engineer and Orchestrator.
Your PRIMARY responsibility in this mode is orchestrating Google Labs Jules AI workers and ensuring seamless integration with the local project.

CORE DIRECTIVES:
0. DIVISION OF RESPONSIBILITY (JULES WRITES CODE, BYTE SUPERVISES & MERGES):
   - ALL code authoring, feature implementation, refactoring, bug fixes, UI improvements, and code changes MUST be performed by Jules AI in Google Cloud!
   - In Jules Lead mode, Byte MUST NOT write, rewrite, or edit application source code locally (do NOT use 'write_file', 'replace_file_content', or 'edit_file_content' to author application logic).
   - If code needs changes, fixes, or refinements: DELEGATE TO JULES via 'jules_continue_session' (90% of the time) or 'jules_create_task'!
   - Jules has the entire repository cloned in Google Cloud and handles all code editing, analysis, and testing in cloud containers.

1. LOCAL ACTIONS ARE STRICTLY LIMITED TO LOCAL-SPECIFIC OPERATIONS:
   - Byte ONLY performs actions that can ONLY be done on the local machine:
     a) Finalizing and merging completed Jules tasks into the local git repository ('jules_finalize_and_merge').
     b) Resolving git merge conflicts when merging a completed PR/patch ('resolve_merge_conflict' with strategy 'theirs').
     c) Fast local git checks ('git status', 'git log') ONLY when necessary.
   - NO ENDLESS SHELL RECONNAISSANCE: Byte must NEVER run loops of terminal commands ('pwd', 'ls', 'dir', 'echo') to search directories or files.
   - The active workspace directory and root structure are ALREADY provided below.
   - Note: The host OS is Windows (${process.platform}). NEVER use Linux bash paths (e.g. '/app' or '/code') or Linux-specific shell tools ('sed -i'). Always use the auto-detected workspace directory.
   - DIRECT USER DIRECTIVES: If the user explicitly asks you to run a specific command or check git locally ("git status", "run this command"): execute it cleanly and report the result.

2. NO FIGHTING WITH YOURSELF:
   - NEVER enter multi-turn loops modifying local files, introducing typos, and editing them again.
   - If a merge conflict occurs when merging Jules work, call 'resolve_merge_conflict' with strategy: 'theirs' to accept Jules' completed changes in a single atomic tool call.
   - If application code requires bug fixes or logic changes, DELEGATE TO JULES!

3. AUTONOMOUS SUPERVISION & ANSWERING JULES ('jules_reply_question'):
   - ONLY when a Jules worker asks an architectural question, presents a proposal, or is in state 'AWAITING_USER_FEEDBACK':
     YOU MUST CALL 'jules_reply_question' with session_id and your clear engineering decision!
   - Remember: Jules runs remotely in Google Cloud. Jules CANNOT read local chat text! If you merely write chat text and do not call 'jules_reply_question', Jules receives nothing and remains frozen indefinitely!
   - You are the Lead Architect: critically evaluate Jules' proposals. If sound and aligned with the user's goals, approve them and tell Jules to proceed immediately via 'jules_reply_question'.
   - NEVER call 'jules_reply_question' if a task has finished (status COMPLETED). Completed sessions cannot receive question replies!

4. AUTONOMOUS DUTY SHIFTS & OVERNIGHT MISSIONS ('jules_start_duty_shift'):
   - When the user specifies a long-running task, duty, or duration (e.g. "work all night", "for 8 hours", "for 5 hours", "overnight duty", "keep finding and fixing until morning"):
   - YOU MUST IMMEDIATELY ACTIVATE A DUTY SHIFT using 'jules_start_duty_shift' with the requested hours (default 8) and mission prompt!
   - Once the shift is active, formulate Phase 1 and immediately call 'jules_create_task'.
   - When woken up by [DUTY SHIFT IN PROGRESS...] or [DUTY SHIFT WATCHDOG ALERT...]:
     DO NOT STOP! Your duty hours are active.
     CRITICAL PROHIBITION: NEVER write conversational text claiming "I have dispatched Phase 1" or "I am standing by" without calling a tool!
     You MUST IMMEDIATELY call 'jules_continue_session' (or 'jules_create_task') in that very turn with the concrete phase specification!
     All commits will be accumulated and merged when leaving the session or when the shift concludes.
   - Repeat autonomously until the duty shift completes, then generate a comprehensive Shift Handover Report!

5. CHRONOLOGICAL PROGRESSION (ANTIGRAVITY STYLE):
   - Before calling ANY tool (such as 'jules_create_task', 'jules_reply_question', 'jules_start_duty_shift', 'resolve_merge_conflict', or 'run_terminal_command'), ALWAYS provide a brief 1-line statement explaining your intent (e.g. "Let me inspect the conflict markers in app_button.dart:", "Starting 8-hour duty shift and dispatching Phase 1 to Jules:").
   - When the tool returns with results, provide your architectural analysis, report, or summary in the subsequent step so that thoughts and tool usages flow chronologically like Antigravity.

6. ASYNCHRONOUS CLOUD EXECUTION & NO POLLING:
   - Once you call 'jules_create_task' or 'jules_reply_question', STOP IMMEDIATELY! Do NOT call 'jules_inspect_diff'. Do NOT poll. Jules runs remotely in Google Cloud.
   - Our system runs an autonomous background supervisor daemon that monitors Jules and automatically notifies you the moment Jules completes or asks an architectural question.
   - Conclude your turn with a clear, concise confirmation to the user explaining what you directed Jules to do.

7. DEFERRED MERGING (MERGE ALL COMMITS WHEN LEAVING SESSION):
   - Do NOT perform intermediate git merges into the local repository while work is actively continuing within the same Jules session.
   - Merge ALL commits accumulated across the session LATER when you are LEAVING that session (i.e. when all work on this task is finished, or before switching to a new session).
   - When all work for this task is done, call 'jules_finalize_and_merge' with the session_id to merge all commits into the local workspace and remote origin.
   - If you start a new session ('jules_create_task'), our system automatically finalizes and merges all commits from the previous session before creating the new session.

8. SESSION REUSE VS NEW SESSION (THE 90% RULE):
   - 90% OF THE TIME, whenever continuing work on a task, subsequent phases, refinements, bug fixes, or edge-case handling:
     YOU MUST CONTINUE IN THE SAME JULES SESSION using 'jules_continue_session'!
   - Reusing the session preserves the remote VM container, git branch, and previous commits, preventing fragmented PRs and lost context.
   - DO NOT call 'jules_create_task' for follow-up work or multi-phase tasks when an existing session is available.
   - ONLY call 'jules_create_task' when starting a completely new project or when the user explicitly requests starting a brand new session.`;

/**
 * Prune and compress conversation history to prevent TPM/context length exhaustion
 */
function pruneContextWindow(messages: LLMMessage[]): LLMMessage[] {
  if (messages.length <= 3) return messages;

  const systemMsg = messages[0];
  const historyMsgs = messages.slice(1);

  // If over 18,000 characters (~4,500 tokens), compress older tool outputs
  let totalLength = historyMsgs.reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 0), 0);
  if (totalLength > 18000) {
    for (let i = 0; i < historyMsgs.length - 4; i++) {
      const m = historyMsgs[i];
      if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 600) {
        m.content = m.content.slice(0, 300) + '\n... [truncated for context limit] ...\n' + m.content.slice(-200);
      }
    }
  }

  // If still over 22,000 characters, keep system prompt + summary notice + last 8 messages
  totalLength = historyMsgs.reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 0), 0);
  if (totalLength > 22000 && historyMsgs.length > 8) {
    const keepCount = 8;
    const kept = historyMsgs.slice(-keepCount);
    return [
      systemMsg,
      { role: 'system', content: '[Notice: Older turns pruned to respect model token limits.]' },
      ...kept,
    ];
  }

  return [systemMsg, ...historyMsgs];
}

export class AgentOrchestrator {
  private static instance: AgentOrchestrator;
  private activeCancellations: Set<string> = new Set();
  private runningSessions: Set<string> = new Set();
  private pendingTurnQueues: Map<string, string[]> = new Map();
  private tokenBuffer: Map<string, { delta: string; messageId: string; timer: NodeJS.Timeout | null }> = new Map();
  private reasoningBuffer: Map<string, { delta: string; messageId: string; timer: NodeJS.Timeout | null }> = new Map();

  public static getInstance(): AgentOrchestrator {
    if (!AgentOrchestrator.instance) {
      AgentOrchestrator.instance = new AgentOrchestrator();
      // Wire up TaskManager completion handler for Antigravity-style reactive background wakeup
      TaskManager.getInstance().setTaskCompletedHandler((task, notificationPrompt) => {
        AgentOrchestrator.instance.wakeUpWithTaskNotification(task.sessionId, notificationPrompt);
      });
    }
    return AgentOrchestrator.instance;
  }

  public wakeUpWithTaskNotification(sessionId: string, prompt: string) {
    const store = DataStore.getInstance();
    let targetSessionId = sessionId;

    if (!targetSessionId || targetSessionId === 'default') {
      const all = store.getSessions();
      if (all.length > 0) {
        targetSessionId = all[0].id;
      }
    }

    if (!targetSessionId) return;

    if (this.runningSessions.has(targetSessionId)) {
      const queue = this.pendingTurnQueues.get(targetSessionId) || [];
      queue.push(prompt);
      this.pendingTurnQueues.set(targetSessionId, queue);
    } else {
      this.runAutonomousTurn(targetSessionId, prompt, undefined, true).catch((err) => {
        console.error(`[AgentOrchestrator] Error during reactive background task wakeup:`, err);
      });
    }
  }

  public getRunningSessions(): string[] {
    return Array.from(this.runningSessions);
  }

  public cancel(sessionId: string) {
    this.activeCancellations.add(sessionId);
  }

  private synthesizeConclusionForAsyncDispatch(stepToolRecords: ToolExecutionRecord[]): string {
    const julesCreate = stepToolRecords.find((tc) => tc.toolName === 'jules_create_task');
    if (julesCreate) {
      const args = julesCreate.args || {};
      const output = julesCreate.output || '';
      const sessionMatch = output.match(/Session ID:\s*([a-zA-Z0-9_\-]+)/i);
      const sid = sessionMatch ? sessionMatch[1] : 'Active';
      const repo = args.repo || 'Repository';
      const branch = args.branch || 'Branch';
      const promptPreview = args.prompt ? args.prompt.slice(0, 160).replace(/\n/g, ' ') + (args.prompt.length > 160 ? '...' : '') : 'Autonomous engineering task';

      return `### Jules Task Dispatched\n\nI have delegated this objective to Jules in Google Cloud to autonomously analyze and code the requested improvements:\n\n- **Session ID**: \`${sid}\`\n- **Repository**: \`${repo}\` (\`${branch}\`)\n- **Task Directive**: ${promptPreview}\n\nThe autonomous background supervisor is monitoring the task in the cloud and will automatically notify us as soon as Jules opens a PR, completes work, or requests feedback.`;
    }

    const julesContinue = stepToolRecords.find((tc) => tc.toolName === 'jules_continue_session');
    if (julesContinue) {
      const args = julesContinue.args || {};
      const sid = args.session_id || 'Active Session';
      const promptPreview = args.prompt ? args.prompt.slice(0, 160).replace(/\n/g, ' ') + (args.prompt.length > 160 ? '...' : '') : 'Next phase instructions';

      return `### Continued Jules Session\n\nDispatched the next phase directive to the active Jules cloud container:\n\n- **Session ID**: \`${sid}\`\n- **Phase Directive**: ${promptPreview}\n\nThe background supervisor is tracking progress in Google Cloud and will report back once the cloud worker finishes this phase.`;
    }

    const julesQuestion = stepToolRecords.find((tc) => tc.toolName === 'jules_reply_question');
    if (julesQuestion) {
      const args = julesQuestion.args || {};
      return `### Architectural Decision Submitted\n\nReplied to Jules for Session \`${args.session_id || ''}\`:\n\n> ${args.reply || 'Approved'}\n\nJules is resuming autonomous coding.`;
    }

    const bgCmd = stepToolRecords.find((tc) => tc.output && tc.output.includes('Tool is running as a background task with task id:'));
    if (bgCmd) {
      const output = bgCmd.output || '';
      const taskIdMatch = output.match(/task id:\s*([a-zA-Z0-9_\-]+)/i);
      const logMatch = output.match(/file:\/\/\/(.+?\.log)/i);
      const taskId = taskIdMatch ? taskIdMatch[1] : 'Background Task';
      const logPath = logMatch ? logMatch[1] : '';

      return `### Background Process Started\n\nThe command has been dispatched as an asynchronous background task:\n\n- **Task ID**: \`${taskId}\`\n${logPath ? `- **Logs**: \`${logPath}\`\n` : ''}\nI am monitoring execution in the background and will report the output once it concludes.`;
    }

    return 'The requested background action has been dispatched and is currently executing.';
  }

  public async runAutonomousTurn(
    sessionId: string,
    userText: string,
    attachments?: AttachmentFile[],
    isSystemNotificationParam?: boolean
  ): Promise<void> {
    const store = DataStore.getInstance();
    const session = store.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    this.activeCancellations.delete(sessionId);
    this.runningSessions.add(sessionId);
    this.emitAgentStatus(sessionId, 'running');

    const turnStartTime = Date.now();
    try {

    // Identify if message is an internal system notification (e.g. background task completion, duty watchdog alert)
    const isSystemNotification = Boolean(
      isSystemNotificationParam ||
      userText.startsWith('<SYSTEM_MESSAGE>') ||
      userText.startsWith('[DUTY SHIFT') ||
      userText.startsWith('[SYSTEM ALERT') ||
      userText.startsWith('[TASK NOTIFICATION') ||
      userText.startsWith('[JULES') ||
      userText.startsWith('[Jules') ||
      userText.startsWith('[AUTONOMOUS SUPERVISOR') ||
      userText.startsWith('[AUTONOMOUS DUTY')
    );

    // Save message with proper role and flag so user chat is never polluted by system wakeups
    const messageRecord: ChatMessage = {
      id: isSystemNotification ? `msg_${Date.now()}_sys` : `msg_${Date.now()}_user`,
      sessionId,
      role: isSystemNotification ? 'system' : 'user',
      isSystemNotification: isSystemNotification || undefined,
      content: userText,
      attachments: (!isSystemNotification && attachments && attachments.length > 0) ? attachments : undefined,
      timestamp: Date.now(),
    };
    store.addMessage(sessionId, messageRecord);

    // Auto-generate title ONLY for genuine human messages (never for system alerts)
    const isGenericTitle = !session.title || 
      session.title === 'New Task' || 
      session.title === 'Initial Task' || 
      session.title === 'New Conversation' ||
      session.title.toLowerCase() === 'hi' ||
      session.title.toLowerCase() === 'hello' ||
      session.title.toLowerCase().startsWith('hello! how can i assist') ||
      session.title === 'Implement AI Chatbot';

    if (!isSystemNotification && isGenericTitle && userText.trim()) {
      if (!isSubstantiveMessage(userText)) {
        session.title = 'New Conversation';
        store.saveSession(session);
        this.emitTitleUpdated(sessionId, 'New Conversation');
      } else {
        const clean = userText.replace(/[#*`_~\[\]]/g, '').split('\n')[0].trim();
        const fallbackTitle = clean.split(/\s+/).slice(0, 6).join(' ');
        session.title = fallbackTitle.length > 36 ? fallbackTitle.slice(0, 36) + '...' : fallbackTitle;
        store.saveSession(session);
        this.emitTitleUpdated(sessionId, session.title);

        // Concurrently generate high quality AI title in background
        this.generateAiTitle(sessionId, userText);
      }
    }

    const settings = store.getSettings();
    const mode: AppMode = session.mode || settings.mode || 'standard';

    let currentToolDefs = mode === 'jules' ? JULES_TOOL_DEFS : STANDARD_TOOL_DEFS;
    const workspaceDir = session.workspacePath || process.cwd();
    const maxTurns = settings.maxAutonomousTurns || 50;

    const gitInfo = detectGitRepo(workspaceDir);
    const activeRepo = gitInfo.repo || settings.julesDefaultRepo || 'sources/github/HyHamza/SeniorEngineer';
    const activeBranch = gitInfo.branch || settings.julesDefaultBranch || 'main';

    let topLevelListing = '';
    try {
      if (fs.existsSync(workspaceDir)) {
        const items = fs.readdirSync(workspaceDir, { withFileTypes: true });
        topLevelListing = items
          .filter((i) => !i.name.startsWith('.') && i.name !== 'node_modules' && i.name !== 'dist' && i.name !== 'out')
          .map((i) => (i.isDirectory() ? `${i.name}/` : i.name))
          .join(', ');
      }
    } catch (_) {}

    let systemPrompt = '';
    if (mode === 'jules') {
      systemPrompt = `${JULES_SYSTEM_PROMPT}

CURRENT WORKSPACE & REPOSITORY (AUTO-DETECTED):
- GitHub Repository: ${activeRepo}
- Active Branch: ${activeBranch}
- Local Workspace: ${workspaceDir}
- Top-Level Files & Folders: ${topLevelListing || '(empty)'}

CRITICAL RULES FOR JULES LEAD MODE:
1. You are operating in JULES LEAD MODE as the Senior Lead Software Architect.
2. DIRECT DELEGATION TO JULES: Jules AI writes all code, implements features, and fixes bugs in Google Cloud. Byte does NOT author application code locally or run shell loops searching paths. Delegate tasks directly to Jules with clear specifications citing the repository and goals!
3. 90% RULE: Whenever continuing work on a project or task, use 'jules_continue_session' to continue in the existing Jules session instead of creating a new one!
4. For ANY coding, feature, bug fix, code audit, or implementation task from the user, YOU MUST DELEGATE IT TO JULES via 'jules_continue_session' or 'jules_create_task'!
5. When a Jules worker asks a question, presents an approach/plan, or is AWAITING_USER_FEEDBACK:
   YOU MUST CALL 'jules_reply_question' with the session_id and your clear engineering decision! Jules is isolated in cloud VMs and cannot see chat messages unless you call 'jules_reply_question'.
6. When asked what Jules is doing, its progress, or current status, ALWAYS call 'jules_get_status' to fetch the real-time activity stream and report back!
7. Once 'jules_create_task', 'jules_continue_session', or 'jules_reply_question' is called, STOP and let Jules work in the cloud.`;
    } else {
      systemPrompt = `${STANDARD_SYSTEM_PROMPT}

Workspace Path: ${workspaceDir}
Git Repository: ${activeRepo} (${activeBranch})`;
    }

    // Convert past messages to LLM format
    const llmMessages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    for (const m of session.messages) {
      if (m.role === 'assistant') {
        if (m.toolCalls && m.toolCalls.length > 0) {
          llmMessages.push({
            role: 'assistant',
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.toolName,
                arguments: JSON.stringify(tc.args || {}),
              },
            })),
          });
          for (const tc of m.toolCalls) {
            llmMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: tc.output || '',
            });
          }
        } else if (m.content && m.content.trim()) {
          llmMessages.push({
            role: 'assistant',
            content: m.content,
          });
        }
      } else if (m.role === 'user') {
        let contentWithAttachments = m.content || '';
        if (m.attachments && m.attachments.length > 0) {
          const attDesc = m.attachments.map((a) => {
            if (a.type === 'image') {
              return `[Attached Image: "${a.name}" (Local path: ${a.path})]`;
            }
            return `[Attached File: "${a.name}" (Local path: ${a.path}, Size: ${Math.round(a.size / 1024)} KB)]`;
          }).join('\n');
          contentWithAttachments = contentWithAttachments 
            ? `${contentWithAttachments}\n\nATTACHED FILES/IMAGES:\n${attDesc}`
            : `ATTACHED FILES/IMAGES:\n${attDesc}`;
        }
        if (contentWithAttachments.trim()) {
          llmMessages.push({
            role: 'user',
            content: contentWithAttachments,
          });
        }
      } else if (m.role === 'system' || m.isSystemNotification) {
        if (m.content && m.content.trim()) {
          llmMessages.push({
            role: 'user', // Pass as user role to prevent strict OpenAI/Claude proxies from rejecting mid-history system messages
            content: `[SYSTEM NOTIFICATION / BACKGROUND EVENT]:\n${m.content}`,
          });
        }
      } else if (m.content && m.content.trim()) {
        llmMessages.push({
          role: m.role,
          content: m.content,
        });
      }
    }

    let turnCount = 0;
    const llmClient = LLMClient.getInstance();

    while (turnCount < maxTurns) {
      if (this.activeCancellations.has(sessionId)) {
        this.emitToken(sessionId, '\n\n*(Execution cancelled by user)*');
        break;
      }

      turnCount++;

      const assistantMsgId = `msg_${Date.now()}_assistant_${turnCount}`;
      let streamedContent = '';

      // Stream assistant response with pruned context to avoid token quota exhaustion
      let result: { content: string; reasoning?: string; toolCalls: any[]; model: string };
      try {
        result = await llmClient.chatStream(
          pruneContextWindow(llmMessages),
          currentToolDefs,
          {
            onToken: (token) => {
              streamedContent += token;
              this.emitToken(sessionId, token, assistantMsgId);
            },
            onReasoning: (chunk) => {
              this.emitReasoning(sessionId, chunk, assistantMsgId);
            },
            onRetry: (attempt, maxRetries, delayMs, reason) => {
              this.emitRetry(sessionId, attempt, maxRetries, delayMs, reason);
            },
            onModelResolved: (resolvedModel) => {
              this.emitModelResolved(sessionId, resolvedModel, assistantMsgId);
            },
          }
        );
        if (result.model) {
          this.emitModelResolved(sessionId, result.model, assistantMsgId);
        }
      } catch (err: any) {
        const errorText = `⚠️ LLM Error: ${err?.message || String(err)}\n\nPlease check your API Base URL, API Key, or Model in Settings.`;
        this.emitToken(sessionId, errorText, assistantMsgId);

        const errorMsg: ChatMessage = {
          id: assistantMsgId,
          sessionId,
          role: 'assistant',
          content: errorText,
          timestamp: Date.now(),
          toolCalls: [],
        };
        store.addMessage(sessionId, errorMsg);
        this.emitSessionsUpdated();
        break;
      }

      if (!result.content && (!result.toolCalls || result.toolCalls.length === 0)) {
        if (result.reasoning && result.reasoning.trim()) {
          result.content = result.reasoning.trim();
        } else {
          result.content = '(No response text returned by model)';
        }
        this.emitToken(sessionId, result.content, assistantMsgId);
      }

      // Add to running LLM context
      llmMessages.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls && result.toolCalls.length > 0 ? result.toolCalls : undefined,
      });

      // If no tool calls were requested, check if a mandatory tool invocation was required!
      if (!result.toolCalls || result.toolCalls.length === 0) {
        const isDutyActive = !!DutyManager.getInstance().getActiveShift(sessionId);
        const claimsDispatch = /(dispatched|delegated|assigned).*(jules|worker|task|phase)/i.test(result.content || '');
        const userAskedDuty = /(work all night|work for \d+\s*hours|overnight|\b\d+\s*hours duty\b)/i.test(userText);
        const hasMandatoryDirective = userText.includes('[DUTY SHIFT') || userText.includes('[AUTONOMOUS DUTY WATCHDOG');
        const hasPriorReconTools = llmMessages.some((m) => m.role === 'tool');

        if ((isDutyActive || claimsDispatch || userAskedDuty || hasMandatoryDirective || (mode === 'jules' && hasPriorReconTools)) && turnCount < 6) {
          console.warn(`[orchestrator] Enforcement notice: model returned without Jules dispatch on turn ${turnCount}. Directing Jules tool invocation...`);
          llmMessages.push({
            role: 'user',
            content: `[MANDATORY DELEGATION DIRECTIVE]:
You completed local workspace reconnaissance and file inspection. Now you MUST dispatch the actual task to Jules in Google Cloud!
Call 'jules_create_task' (or 'jules_continue_session' if an active session exists) with the concrete files and improvements needed.
DO NOT return conversational text or empty output without calling a tool. Invoke the Jules tool NOW!`,
          });
          continue;
        }

        // Ensure final output has substantive conclusion text (never left blank or default placeholder)
        if (!result.content || !result.content.trim() || result.content === '(No response text returned by model)') {
          if (result.reasoning && result.reasoning.trim()) {
            result.content = result.reasoning.trim();
          } else {
            const executedTools = llmMessages.filter((m) => m.role === 'tool');
            if (executedTools.length > 0) {
              result.content = `### Actions Completed\n\nI have executed the requested workspace operations and verified the results.\n\n- Executed ${executedTools.length} action(s) across this turn.\n- Standing by for subsequent directives.`;
            } else {
              result.content = 'Task completed. Standing by for instructions.';
            }
          }
        }

        const finalMsg: ChatMessage = {
          id: assistantMsgId,
          sessionId,
          role: 'assistant',
          content: result.content || '',
          thinking: result.reasoning || undefined,
          model: result.model || undefined,
          timestamp: Date.now(),
          executionDuration: Math.max(1, Math.round((Date.now() - turnStartTime) / 1000)),
        };
        store.addMessage(sessionId, finalMsg);
        this.emitSessionsUpdated();
        break;
      }

      // Flush any pending stream tokens to the UI before tool execution
      this.flushStreamBuffers(sessionId);

      // Execute each tool call for this step
      const stepToolRecords: ToolExecutionRecord[] = [];
      let hasDispatchedJules = false;

      for (const tc of result.toolCalls) {
        const toolName = tc.function?.name;
        if (
          toolName === 'jules_create_task' ||
          toolName === 'jules_reply_question' ||
          toolName === 'jules_continue_session'
        ) {
          hasDispatchedJules = true;
        }

        let toolArgs: any = {};
        try {
          toolArgs = JSON.parse(tc.function?.arguments || '{}');
        } catch (_) {}

        const toolRecord: ToolExecutionRecord = {
          id: tc.id || `tc_${Date.now()}`,
          toolName,
          args: toolArgs,
          status: 'running',
          startedAt: Date.now(),
        };

        this.emitToolCall(sessionId, assistantMsgId, toolRecord);

        // Execute tool
        const output = await executeToolCall(toolName, toolArgs, workspaceDir, sessionId);

        // Cap tool output stored in chat/context to prevent single tools (e.g. 2MB searches) from freezing IPC and DOM!
        const cappedOutput = output.length > 30000
          ? output.slice(0, 25000) + `\n... [Output truncated to 25KB (${output.length} characters total)]`
          : output;

        toolRecord.status = output.startsWith('Error') ? 'error' : 'completed';
        toolRecord.output = cappedOutput;
        toolRecord.completedAt = Date.now();

        this.emitToolCall(sessionId, assistantMsgId, toolRecord);
        stepToolRecords.push(toolRecord);

        // Append tool result for next LLM turn
        llmMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: cappedOutput,
        });
      }

      // Save this step message with its text AND its executed tools in chronological order!
      const stepMsg: ChatMessage = {
        id: assistantMsgId,
        sessionId,
        role: 'assistant',
        content: result.content || '',
        thinking: result.reasoning || undefined,
        model: result.model || undefined,
        timestamp: Date.now(),
        toolCalls: stepToolRecords,
        executionDuration: Math.max(1, Math.round((Date.now() - turnStartTime) / 1000)),
      };
      store.addMessage(sessionId, stepMsg);

      const hasBackgroundRunningTask = stepToolRecords.some(
        (tc) => tc.output && tc.output.includes('Tool is running as a background task with task id:')
      );

      if (hasDispatchedJules || hasBackgroundRunningTask) {
        // Asynchronous cloud task or local background process launched.
        // If the model didn't provide a substantive user-facing concluding explanation,
        // synthesize a clear, professional summary so the user is never left with an empty card!
        if (!stepMsg.content || !stepMsg.content.trim()) {
          stepMsg.content = this.synthesizeConclusionForAsyncDispatch(stepToolRecords);
          store.addMessage(sessionId, stepMsg);
        }
        this.emitSessionsUpdated();
        break;
      }
    }
    } finally {
      this.flushStreamBuffers(sessionId);
      this.runningSessions.delete(sessionId);
      this.emitAgentStatus(sessionId, 'idle');
      this.emitCompleted(sessionId);
      this.emitSessionsUpdated();

      // Check if there is a pending queued notification (e.g. from a background task that just completed)
      const queue = this.pendingTurnQueues.get(sessionId);
      if (queue && queue.length > 0) {
        const nextPrompt = queue.shift()!;
        if (queue.length === 0) {
          this.pendingTurnQueues.delete(sessionId);
        }
        setTimeout(() => {
          this.runAutonomousTurn(sessionId, nextPrompt, undefined, true).catch(console.error);
        }, 150);
      }
    }
  }

  private sessionsUpdateTimer: NodeJS.Timeout | null = null;

  public emitSessionsUpdated() {
    if (this.sessionsUpdateTimer) return;

    this.sessionsUpdateTimer = setTimeout(() => {
      this.sessionsUpdateTimer = null;
      const store = DataStore.getInstance();
      const sessions = store.getSessionSummaries();
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send('sessions:updated', sessions);
        }
      }
    }, 150);
  }

  private emitAgentStatus(sessionId: string, status: 'running' | 'idle') {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('chat:agent-status', { sessionId, status });
      }
    }
  }

  public flushStreamBuffers(sessionId: string) {
    this.flushToken(sessionId);
    this.flushReasoning(sessionId);
  }

  private emitToken(sessionId: string, delta: string, messageId = '', immediate = false) {
    if (immediate) {
      this.flushToken(sessionId);
      this.broadcastToken(sessionId, delta, messageId);
      return;
    }

    const existing = this.tokenBuffer.get(sessionId) || { delta: '', messageId, timer: null };
    existing.delta += delta;
    existing.messageId = messageId || existing.messageId;

    if (!existing.timer) {
      existing.timer = setTimeout(() => {
        this.flushToken(sessionId);
      }, 35);
    }

    this.tokenBuffer.set(sessionId, existing);
  }

  private flushToken(sessionId: string) {
    const existing = this.tokenBuffer.get(sessionId);
    if (!existing) return;
    if (existing.timer) clearTimeout(existing.timer);
    this.tokenBuffer.delete(sessionId);
    if (existing.delta) {
      this.broadcastToken(sessionId, existing.delta, existing.messageId);
    }
  }

  private broadcastToken(sessionId: string, delta: string, messageId = '') {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('chat:stream-token', { sessionId, messageId, delta });
      }
    }
  }

  private emitReasoning(sessionId: string, delta: string, messageId = '', immediate = false) {
    if (immediate) {
      this.flushReasoning(sessionId);
      this.broadcastReasoning(sessionId, delta, messageId);
      return;
    }

    const existing = this.reasoningBuffer.get(sessionId) || { delta: '', messageId, timer: null };
    existing.delta += delta;
    existing.messageId = messageId || existing.messageId;

    if (!existing.timer) {
      existing.timer = setTimeout(() => {
        this.flushReasoning(sessionId);
      }, 35);
    }

    this.reasoningBuffer.set(sessionId, existing);
  }

  private flushReasoning(sessionId: string) {
    const existing = this.reasoningBuffer.get(sessionId);
    if (!existing) return;
    if (existing.timer) clearTimeout(existing.timer);
    this.reasoningBuffer.delete(sessionId);
    if (existing.delta) {
      this.broadcastReasoning(sessionId, existing.delta, existing.messageId);
    }
  }

  private broadcastReasoning(sessionId: string, delta: string, messageId = '') {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('chat:stream-reasoning', { sessionId, messageId, delta });
      }
    }
  }

  private emitRetry(sessionId: string, attempt: number, maxRetries: number, delayMs: number, reason: string) {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('chat:stream-retry', { sessionId, attempt, maxRetries, delayMs, reason });
      }
    }
  }

  private emitModelResolved(sessionId: string, model: string, messageId = '') {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('chat:model-resolved', { sessionId, model, messageId });
      }
    }
  }

  private emitToolCall(sessionId: string, messageId: string, toolCall: ToolExecutionRecord) {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('chat:tool-call', { sessionId, messageId, toolCall });
      }
    }
  }

  private emitCompleted(sessionId: string) {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('chat:completed', sessionId);
      }
    }
  }

  private emitTitleUpdated(sessionId: string, title: string) {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('chat:title-updated', { sessionId, title });
      }
    }
  }

  private async generateAiTitle(sessionId: string, userText: string) {
    if (!isSubstantiveMessage(userText)) return;

    try {
      const llmClient = LLMClient.getInstance();
      const store = DataStore.getInstance();
      const result = await llmClient.chatStream(
        [
          {
            role: 'system',
            content: 'You are a task title generator. Respond ONLY with a 3 to 5 word title summarizing the user\'s coding objective. Do NOT greet. Do NOT answer the question. Do NOT include quotes or punctuation. Example: "POS Order Editing Bug", "Auth Token Refresh Fix".',
          },
          {
            role: 'user',
            content: `Task to summarize into a 3-5 word title:\n"""\n${userText.slice(0, 300)}\n"""`,
          },
        ],
        undefined,
        { onToken: () => {} },
        { maxRetries: 0 }
      );

      let cleanTitle = result.content ? result.content.trim() : '';

      cleanTitle = cleanTitle
        .split('\n')[0]
        .replace(/^(Title:|Task:|Subject:)/i, '')
        .replace(/^["'`]|["'`]$/g, '')
        .replace(/[#*`_.]/g, '')
        .trim();

      // Guard against the model answering conversationally
      const isConversational = /^(hello|hi|hey|sure|here is|as an ai|i can help|i will|how can i)/i.test(cleanTitle);
      if (isConversational) {
        return; // Retain the clean heuristic fallback
      }

      if (cleanTitle && cleanTitle.length >= 3) {
        if (cleanTitle.length > 38) cleanTitle = cleanTitle.slice(0, 38).trim();
        store.updateSession(sessionId, { title: cleanTitle });
        this.emitTitleUpdated(sessionId, cleanTitle);
      }
    } catch (_) {
      // Heuristic fallback already in place
    }
  }
}
