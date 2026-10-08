import { BrowserWindow } from 'electron';
import type { AppMode, ChatMessage, ToolExecutionRecord } from '../../shared/types';
import { LLMClient, type LLMMessage } from '../services/llm/client';
import { STANDARD_TOOL_DEFS, JULES_TOOL_DEFS, executeToolCall } from '../tools';
import { DataStore, isSubstantiveMessage } from '../services/db/store';
import { detectGitRepo } from '../services/git/detector';

const STANDARD_SYSTEM_PROMPT = `You are Byte, a powerful autonomous software engineering AI assistant.
You operate on goals and objectives.
You have tools to read files, write files, edit file contents, run terminal commands, and inspect directories.

CORE BEHAVIOR (ANTIGRAVITY STYLE):
1. CHRONOLOGICAL PROGRESSION:
   - Before executing any tool, ALWAYS output a concise 1-line statement explaining what you are checking or doing (e.g. "Let me inspect package.json:", "Running verification tests:").
   - Once the tool finishes, analyze the results and provide your conclusions in the subsequent step so thoughts and tool actions flow chronologically.
2. Act autonomously. Execute the necessary steps to completion without stopping midway for trivial confirmations.
3. Test and verify your work with terminal commands when relevant.
4. Keep the user informed with clear, structured progress.`;

const JULES_SYSTEM_PROMPT = `You are Byte operating in JULES LEAD MODE.
You are the Lead Senior Staff Software Engineer and Orchestrator.
Your PRIMARY responsibility in this mode is orchestrating Google Labs Jules AI workers.

CORE DIRECTIVES:
1. ALWAYS DELEGATE TASKS TO JULES:
   - For ANY coding, feature request, bug fix, code audit, or analysis task (e.g. "Analyze sidebar...", "Implement X", "Audit Y", "Fix Z"):
     YOU MUST CALL 'jules_create_task' to delegate the objective to Jules AI!
   - DO NOT ATTEMPT TO EXECUTE TASKS MANUALLY. Manual local work belongs in Standard Mode. In Jules Lead mode, the user expects Jules to do the work.
   - Formulate a clear, comprehensive technical specification and call 'jules_create_task'.

2. CHRONOLOGICAL PROGRESSION (ANTIGRAVITY STYLE):
   - Before calling ANY tool (such as 'jules_create_task', 'jules_inspect_diff', or 'jules_reply_question'), ALWAYS provide a brief 1-line statement explaining your intent (e.g. "Let me check the Jules session diff:", "I will dispatch this task to the Jules worker:").
   - When the tool returns with results, provide your architectural analysis, report, or summary in the subsequent step so that thoughts and tool usages flow chronologically like Antigravity.

3. NEVER GUESS OR HALLUCINATE FILE PATHS:
   - Do not guess file extensions or assume non-existent paths.
   - Remote Jules workers have the full repository indexed in cloud VMs and perform accurate workspace-wide analysis.

4. ASYNCHRONOUS CLOUD EXECUTION & NO POLLING:
   - Once you call 'jules_create_task', STOP IMMEDIATELY! Do NOT call 'jules_inspect_diff'. Do NOT poll. Jules runs remotely in Google Cloud.
   - Our system runs an autonomous native background supervisor engine ('JulesPoller') that continuously monitors Jules, and will automatically wake you up and send native desktop notifications the moment Jules completes or asks an architectural question.
   - Conclude your turn with a clear, concise confirmation to the user that the task was dispatched to Jules and you are supervising it in the background.`;

export class AgentOrchestrator {
  private static instance: AgentOrchestrator;
  private activeCancellations: Set<string> = new Set();
  private runningSessions: Set<string> = new Set();

  public static getInstance(): AgentOrchestrator {
    if (!AgentOrchestrator.instance) {
      AgentOrchestrator.instance = new AgentOrchestrator();
    }
    return AgentOrchestrator.instance;
  }

  public getRunningSessions(): string[] {
    return Array.from(this.runningSessions);
  }

  public cancel(sessionId: string) {
    this.activeCancellations.add(sessionId);
  }

  public async runAutonomousTurn(sessionId: string, userText: string): Promise<void> {
    const store = DataStore.getInstance();
    const session = store.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    this.activeCancellations.delete(sessionId);
    this.runningSessions.add(sessionId);
    this.emitAgentStatus(sessionId, 'running');

    try {

    // Save user message
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_user`,
      sessionId,
      role: 'user',
      content: userText,
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
    // Synchronize mode: if either session or header is in jules mode, operate in jules mode!
    const isJules = session.mode === 'jules' || settings.mode === 'jules';
    const mode: AppMode = isJules ? 'jules' : 'standard';

    if (session.mode !== mode) {
      session.mode = mode;
      store.saveSession(session);
    }

    let currentToolDefs = mode === 'jules' ? JULES_TOOL_DEFS : STANDARD_TOOL_DEFS;
    const workspaceDir = session.workspacePath || process.cwd();
    const maxTurns = settings.maxAutonomousTurns || 50;

    const gitInfo = detectGitRepo(workspaceDir);
    const activeRepo = gitInfo.repo || settings.julesDefaultRepo || 'sources/github/HyHamza/SeniorEngineer';
    const activeBranch = gitInfo.branch || settings.julesDefaultBranch || 'main';

    let systemPrompt = '';
    if (mode === 'jules') {
      systemPrompt = `${JULES_SYSTEM_PROMPT}

CURRENT WORKSPACE & REPOSITORY (AUTO-DETECTED):
- GitHub Repository: ${activeRepo}
- Active Branch: ${activeBranch}
- Local Workspace: ${workspaceDir}

CRITICAL RULES FOR JULES LEAD MODE:
1. You are operating in JULES LEAD MODE.
2. For ANY coding, feature, bug fix, audit, review, or analysis task from the user, YOU MUST DELEGATE IT TO JULES via 'jules_create_task'! DO NOT ATTEMPT TO EXECUTE IT MANUALLY OR READ FILES TO DO THE TASK YOURSELF.
3. The GitHub repository '${activeRepo}' has ALREADY BEEN AUTOMATICALLY DETECTED.
4. When calling 'jules_create_task', automatically use repo: "${activeRepo}" and branch: "${activeBranch}".
5. DO NOT ask the user for the repo or branch.
6. Once 'jules_create_task' is called, STOP and let Jules work in the cloud.`;
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

      // Stream assistant response
      let result: { content: string; toolCalls: any[] };
      try {
        result = await llmClient.chatStream(
          llmMessages,
          currentToolDefs,
          {
            onToken: (token) => {
              streamedContent += token;
              this.emitToken(sessionId, token, assistantMsgId);
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

      // If no tool calls were requested, this is the concluding response!
      if (!result.toolCalls || result.toolCalls.length === 0) {
        const finalMsg: ChatMessage = {
          id: assistantMsgId,
          sessionId,
          role: 'assistant',
          content: result.content || '',
          timestamp: Date.now(),
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
        if (toolName === 'jules_create_task' || toolName === 'jules_reply_question') {
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
      };
      store.addMessage(sessionId, stepMsg);
      this.emitSessionsUpdated();

      if (hasDispatchedJules) {
        // Jules runs asynchronously in the cloud.
        // Disable tools for next LLM turn so Byte cleanly yields after reporting to user without manual polling!
        currentToolDefs = [];
      }
    }
    } finally {
      this.runningSessions.delete(sessionId);
      this.emitAgentStatus(sessionId, 'idle');
      this.emitCompleted(sessionId);
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
        { onToken: () => {} }
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
