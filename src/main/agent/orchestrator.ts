import { BrowserWindow } from 'electron';
import type { AppMode, ChatMessage, ToolExecutionRecord } from '../../shared/types';
import { LLMClient, type LLMMessage } from '../services/llm/client';
import { STANDARD_TOOL_DEFS, JULES_TOOL_DEFS, executeToolCall } from '../tools';
import { DataStore, isSubstantiveMessage } from '../services/db/store';
import { detectGitRepo } from '../services/git/detector';

const STANDARD_SYSTEM_PROMPT = `You are Byte, a powerful autonomous software engineering AI assistant.
You operate on goals and objectives.
You have tools to read files, write files, edit file contents, run terminal commands, and inspect directories.
When given an objective:
1. Act autonomously. Execute the necessary steps to completion.
2. Do not stop midway to ask unnecessary questions when you have the tools to investigate and execute.
3. Test and verify your work with terminal commands when relevant.
4. Keep the user informed with clear, concise progress.`;

const JULES_SYSTEM_PROMPT = `You are Byte operating in JULES SUPERVISOR MODE.
You are the Lead Senior Staff Software Engineer and Architect.
You have direct native programmatic access to Google Labs Jules AI via your built-in tool 'jules_create_task'.

CORE INSTRUCTIONS:
1. YOU CAN AND MUST USE JULES: Whenever the user asks "can you use Jules?" or asks to implement, fix, refactor, or audit any code, your answer is YES!
2. HOW TO USE JULES:
   - Call the 'jules_create_task' tool immediately with detailed technical instructions, task title, and repo.
   - ASYNCHRONOUS CLOUD EXECUTION & NO POLLING: Once you call 'jules_create_task', STOP CALLING TOOLS IMMEDIATELY! Do NOT call 'jules_inspect_diff'. Do NOT poll. Jules runs remotely in Google Cloud.
   - Our system runs an autonomous native background supervisor engine ('JulesPoller') that continuously monitors Jules, and will automatically wake you up and send native desktop notifications the moment Jules completes or asks an architectural question.
   - Conclude your turn with a clear, concise confirmation to the user that the task was dispatched to Jules and you are supervising it in the background.
3. YOU DO NOT WRITE CODE LOCALLY: Direct local code editing is disabled. Implementation is executed remotely by Jules AI workers.
4. SUPERVISION: Answer Jules' architectural questions via 'jules_reply_question' and inspect final completed results via 'jules_inspect_diff'.`;

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

CRITICAL RULES:
1. The GitHub repository '${activeRepo}' has ALREADY BEEN AUTOMATICALLY DETECTED.
2. DO NOT ASK THE USER what the GitHub repository or path is. You already know it is '${activeRepo}'.
3. When delegating a task to Jules using 'jules_create_task', automatically use repo: "${activeRepo}" and branch: "${activeBranch}".`;
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
      llmMessages.push({
        role: m.role,
        content: m.content || '',
      });
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
        break;
      }

      if (!result.content && (!result.toolCalls || result.toolCalls.length === 0)) {
        result.content = '(No response text returned by model)';
        this.emitToken(sessionId, result.content, assistantMsgId);
      }

      // Save assistant message
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        sessionId,
        role: 'assistant',
        content: result.content,
        timestamp: Date.now(),
        toolCalls: [],
      };

      // Add to running LLM context
      llmMessages.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls && result.toolCalls.length > 0 ? result.toolCalls : undefined,
      });

      // If no tool calls were requested, the turn is complete!
      if (!result.toolCalls || result.toolCalls.length === 0) {
        store.addMessage(sessionId, assistantMsg);
        break;
      }

      // Execute each tool call
      const toolRecords: ToolExecutionRecord[] = [];
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

        toolRecord.status = output.startsWith('Error:') ? 'error' : 'completed';
        toolRecord.output = output;
        toolRecord.completedAt = Date.now();

        this.emitToolCall(sessionId, assistantMsgId, toolRecord);
        toolRecords.push(toolRecord);

        // Append tool result for next LLM turn
        llmMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: output,
        });
      }

      if (hasDispatchedJules) {
        // Jules runs asynchronously in the cloud.
        // Disable tools for next LLM turn so Byte cleanly yields after reporting to user without manual polling!
        currentToolDefs = [];
      }

      assistantMsg.toolCalls = toolRecords;
      store.addMessage(sessionId, assistantMsg);
    }
    } finally {
      this.runningSessions.delete(sessionId);
      this.emitAgentStatus(sessionId, 'idle');
      this.emitCompleted(sessionId);
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
