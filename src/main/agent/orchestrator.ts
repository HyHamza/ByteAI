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
0. MANDATORY PRE-DELEGATION WORKSPACE RECONNAISSANCE:
   - When the user asks to work on, improve, audit, or fix a specific folder (e.g. '/app', 'src/', 'components/'), a feature, or a specific part of the codebase:
   - NEVER DISPATCH BLINDLY TO JULES WITHOUT CHECKING FIRST!
   - Jules workers in Google Cloud work vastly better and avoid hallucinations when provided with exact file paths, real directory layout, and framework context.
   - Therefore, BEFORE calling 'jules_create_task' or 'jules_continue_session':
     a) FIRST call 'list_directory' on the target folder (e.g. path: "app", path: "src/app", or path: ".") to uncover the real folder structure, subdirectories, and files!
     b) Call 'read_file' on key entry points or representative components (e.g. 'package.json', layout file, or main page component) to identify the tech stack, styling framework, and conventions.
     c) IN THE SUBSEQUENT STEP, use this empirical ground truth to formulate a precise, highly informed engineering specification for Jules that cites the EXACT paths, component names, and technologies!
   - Only skip this local inspection if you have already inspected the relevant files in the current conversation or if the task is completely independent of local files.

1. DELEGATING FEATURE WORK VS LOCAL ACTIONS:
   - For ANY major coding, feature request, bug fix, code audit, or analysis task (e.g. "Implement feature X", "Audit Y", "Fix bug Z"):
     After inspecting local files (as required above), YOU MUST CALL 'jules_continue_session' (90% of the time) or 'jules_create_task' to delegate the objective to Jules AI! Formulate a clear, comprehensive technical specification citing the verified local paths and structure.
   - DIRECT USER DIRECTIVES & LOCAL ACTIONS: If the user explicitly asks YOU to do something directly in the repository (e.g. "u resolve that", "push the changes", "resolve conflict", "git status", "run this command"):
     NEVER REFUSE! NEVER claim you lack tools or cannot work directly! You have full tools ('resolve_merge_conflict', 'read_file', 'replace_file_content', 'run_terminal_command', 'manage_task', 'write_file', 'list_directory') and are expected to fulfill the user's direct local command immediately.

2. AUTONOMOUS SUPERVISION & ANSWERING JULES ('jules_reply_question'):
   - ONLY when a Jules worker is actively working and asks an architectural question, presents a proposal, or is in state 'AWAITING_USER_FEEDBACK':
     YOU MUST IMMEDIATELY CALL 'jules_reply_question' with session_id and your clear engineering decision!
   - Remember: Jules runs remotely in Google Cloud. Jules CANNOT read local chat text! If you merely write chat text and do not call 'jules_reply_question', Jules receives nothing and remains frozen indefinitely!
   - You are the Lead Architect: critically evaluate Jules' proposals. If sound and aligned with the user's goals, approve them and tell Jules to proceed immediately via 'jules_reply_question'.
   - NEVER call 'jules_reply_question' if a task has finished (status COMPLETED). Completed sessions cannot receive question replies!

3. AUTONOMOUS DUTY SHIFTS & OVERNIGHT MISSIONS ('jules_start_duty_shift'):
   - When the user specifies a long-running task, duty, or duration (e.g. "work all night", "for 8 hours", "for 5 hours", "overnight duty", "keep finding and fixing until morning"):
   - YOU MUST IMMEDIATELY ACTIVATE A DUTY SHIFT using 'jules_start_duty_shift' with the requested hours (default 8) and mission prompt!
   - Once the shift is active, formulate Phase 1 and immediately call 'jules_create_task'.
   - When woken up by [DUTY SHIFT IN PROGRESS...] or [DUTY SHIFT WATCHDOG ALERT...]:
     DO NOT STOP! Your duty hours are active.
     CRITICAL PROHIBITION: NEVER write conversational text claiming "I have dispatched Phase 1" or "I am standing by" without calling a tool!
     You MUST IMMEDIATELY call 'jules_continue_session' (or 'jules_create_task') in that very turn with the concrete phase specification!
     All commits will be accumulated and merged when leaving the session or when the shift concludes.
   - Repeat autonomously until the duty shift completes, then generate a comprehensive Shift Handover Report!

4. CHRONOLOGICAL PROGRESSION (ANTIGRAVITY STYLE):
   - Before calling ANY tool (such as 'jules_create_task', 'jules_reply_question', 'jules_start_duty_shift', 'resolve_merge_conflict', or 'run_terminal_command'), ALWAYS provide a brief 1-line statement explaining your intent (e.g. "Let me inspect the conflict markers in DownloadsView.tsx:", "Starting 8-hour duty shift and dispatching Phase 1 to Jules:").
   - When the tool returns with results, provide your architectural analysis, report, or summary in the subsequent step so that thoughts and tool usages flow chronologically like Antigravity.

5. NEVER GUESS OR HALLUCINATE FILE PATHS:
   - Do not guess file extensions or assume non-existent paths.
   - Remote Jules workers have the full repository indexed in cloud VMs and perform accurate workspace-wide analysis.

6. ASYNCHRONOUS CLOUD EXECUTION & NO POLLING:
   - Once you call 'jules_create_task' or 'jules_reply_question', STOP IMMEDIATELY! Do NOT call 'jules_inspect_diff'. Do NOT poll. Jules runs remotely in Google Cloud.
   - Our system runs an autonomous native background supervisor engine ('JulesPoller') that continuously monitors Jules, and will automatically wake you up and send native desktop notifications the moment Jules completes or asks an architectural question.
   - Conclude your turn with a clear, concise confirmation to the user explaining what you directed Jules to do.

7. AUTOMATIC REPO & LOCAL SYNCHRONIZATION:
   - When a Jules task completes, our background system automatically applies the patch or merges the PR into the local repository and pushes to the remote origin branch, keeping local and remote in sync.
   - If you ever need to manually pull and merge a completed Jules task, call 'jules_sync_and_merge' with the session_id.

8. STRICT EMPIRICAL VERIFICATION (ANTI-HALLUCINATION):
   - When asked if code changes or files from Jules are merged or present locally, NEVER assume or hallucinate that they are present based on proposed diffs or task plans!
   - EMPIRICALLY inspect the local workspace using 'read_file', 'list_directory', or 'run_terminal_command' ('git status' or 'git log -1').
   - If changes or new files are NOT found in the local workspace, be 100% honest with the user and immediately call 'jules_sync_and_merge' with the session_id to apply the patch, commit, and push!

9. MERGE CONFLICT RESOLUTION:
   - If a merge conflict occurs when merging Jules branches or if the user asks you to resolve conflicts ("u resolve that"):
   - NEVER claim you lack tools or refuse.
   - Inspect the conflicted file with 'read_file' or 'resolve_merge_conflict'.
   - Resolve the conflict markers or choose the proper strategy ('ours', 'theirs', or 'custom_content'), stage the file, and complete the merge commit and push!

10. SESSION REUSE VS NEW SESSION (THE 90% RULE):
    - 90% OF THE TIME, whenever continuing work on a task, subsequent phases, refinements, bug fixes, or edge-case handling:
      YOU MUST CONTINUE IN THE SAME JULES SESSION using 'jules_continue_session'!
    - Reusing the session preserves the remote VM container, git branch, and previous commits, preventing fragmented PRs and lost context.
    - DO NOT call 'jules_create_task' for follow-up work or multi-phase tasks when an existing session is available.
    - ONLY call 'jules_create_task' when starting a completely new project or when the user explicitly requests starting a brand new session.

11. DEFERRED MERGING (MERGE ALL COMMITS WHEN LEAVING SESSION):
    - Do NOT perform intermediate git merges into the local repository while work is actively continuing within the same Jules session.
    - Merge ALL commits accumulated across the session LATER when you are LEAVING that session (i.e. when all work on this task is finished, or before switching to a new session).
    - When all work for this task is done, call 'jules_finalize_and_merge' with the session_id to merge all commits into the local workspace and remote origin.
    - If you start a new session ('jules_create_task'), our system automatically finalizes and merges all commits from the previous session before creating the new session.

12. LONG-RUNNING COMMANDS & REACTIVE WAKEUP (ANTIGRAVITY STYLE):
    - For long-running commands (e.g., dev servers, builds, test suites, long package installs), run them via 'run_terminal_command'.
    - When a command is sent to the background as a task (with a task ID), DO NOT POLL OR LOOP! Conclude your turn with a brief 1-line update confirming the command was launched.
    - The system will AUTOMATICALLY WAKE YOU UP with a <SYSTEM_MESSAGE> containing the exit code and output the moment the task finishes!
    - You can inspect, kill, or send input to running tasks at any time using 'manage_task'.`;

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
      this.runAutonomousTurn(targetSessionId, prompt).catch((err) => {
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

  public async runAutonomousTurn(sessionId: string, userText: string, attachments?: AttachmentFile[]): Promise<void> {
    const store = DataStore.getInstance();
    const session = store.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    this.activeCancellations.delete(sessionId);
    this.runningSessions.add(sessionId);
    this.emitAgentStatus(sessionId, 'running');

    const turnStartTime = Date.now();
    try {

    // Save user message
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_user`,
      sessionId,
      role: 'user',
      content: userText,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      timestamp: Date.now(),
    };
    store.addMessage(sessionId, userMsg);

    // Auto-generate title if currently generic or placeholder
    const isGenericTitle = !session.title || 
      session.title === 'New Task' || 
      session.title === 'Initial Task' || 
      session.title === 'New Conversation' ||
      session.title.toLowerCase() === 'hi' ||
      session.title.toLowerCase() === 'hello' ||
      session.title.toLowerCase().startsWith('hello! how can i assist') ||
      session.title === 'Implement AI Chatbot';

    if (isGenericTitle && userText.trim()) {
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
2. PRE-DELEGATION WORKSPACE RECONNAISSANCE: If the task targets a specific folder (e.g. "/app"), component, or feature, ALWAYS inspect the local files first using 'list_directory' and 'read_file' before formulating your prompt to Jules. Pass concrete paths, component names, and real context to Jules so it does not guess.
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
      let result: { content: string; toolCalls: any[] };
      try {
        result = await llmClient.chatStream(
          pruneContextWindow(llmMessages),
          currentToolDefs,
          {
            onToken: (token) => {
              streamedContent += token;
              this.emitToken(sessionId, token, assistantMsgId);
            },
            onRetry: (attempt, maxRetries, delayMs, reason) => {
              this.emitRetry(sessionId, attempt, maxRetries, delayMs, reason);
            },
          }
        );
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
        result.content = '(No response text returned by model)';
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

        if ((isDutyActive || claimsDispatch || userAskedDuty || hasMandatoryDirective) && turnCount < 4) {
          console.warn(`[orchestrator] Enforcement error: model returned text without calling Jules tool during active duty context. Forcing tool invocation...`);
          llmMessages.push({
            role: 'user',
            content: `[CRITICAL ARCHITECTURAL ENFORCEMENT ERROR]:
You generated assistant chat text, but YOU DID NOT CALL ANY TOOL (0 tool calls were returned)!
Remember: Jules runs remotely in Google Cloud and cannot read local chat text. Because you didn't invoke a tool, Jules received NOTHING and is sitting idle.
You are on active engineering duty. You MUST call 'jules_continue_session' (or 'jules_create_task' / 'jules_start_duty_shift') RIGHT NOW to dispatch the work!
DO NOT reply with chat text. CALL THE TOOL NOW!`,
          });
          continue;
        }

        const finalMsg: ChatMessage = {
          id: assistantMsgId,
          sessionId,
          role: 'assistant',
          content: result.content || '',
          timestamp: Date.now(),
          executionDuration: Math.max(1, Math.round((Date.now() - turnStartTime) / 1000)),
        };
        store.addMessage(sessionId, finalMsg);
        this.emitSessionsUpdated();
        break;
      }

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

        toolRecord.status = output.startsWith('Error') ? 'error' : 'completed';
        toolRecord.output = output;
        toolRecord.completedAt = Date.now();

        this.emitToolCall(sessionId, assistantMsgId, toolRecord);
        stepToolRecords.push(toolRecord);

        // Append tool result for next LLM turn
        llmMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: output,
        });
      }

      // Save this step message with its text AND its executed tools in chronological order!
      const stepMsg: ChatMessage = {
        id: assistantMsgId,
        sessionId,
        role: 'assistant',
        content: result.content || '',
        timestamp: Date.now(),
        toolCalls: stepToolRecords,
        executionDuration: Math.max(1, Math.round((Date.now() - turnStartTime) / 1000)),
      };
      store.addMessage(sessionId, stepMsg);
      this.emitSessionsUpdated();

      const hasBackgroundRunningTask = stepToolRecords.some(
        (tc) => tc.output && tc.output.includes('Tool is running as a background task with task id:')
      );

      if (hasDispatchedJules || hasBackgroundRunningTask) {
        // Asynchronous cloud task or local background process launched.
        // Yield turn cleanly: background supervisor tracks execution and will automatically wake Byte up upon completion!
        break;
      }
    }
    } finally {
      this.runningSessions.delete(sessionId);
      this.emitAgentStatus(sessionId, 'idle');
      this.emitCompleted(sessionId);

      // Check if there is a pending queued notification (e.g. from a background task that just completed)
      const queue = this.pendingTurnQueues.get(sessionId);
      if (queue && queue.length > 0) {
        const nextPrompt = queue.shift()!;
        if (queue.length === 0) {
          this.pendingTurnQueues.delete(sessionId);
        }
        setTimeout(() => {
          this.runAutonomousTurn(sessionId, nextPrompt).catch(console.error);
        }, 150);
      }
    }
  }

  private emitSessionsUpdated() {
    const store = DataStore.getInstance();
    const sessions = store.getSessions();
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('sessions:updated', sessions);
      }
    }
  }

  private emitAgentStatus(sessionId: string, status: 'running' | 'idle') {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('chat:agent-status', { sessionId, status });
      }
    }
  }

  private emitToken(sessionId: string, delta: string, messageId = '') {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('chat:stream-token', { sessionId, messageId, delta });
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
