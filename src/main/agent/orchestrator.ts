import { BrowserWindow } from 'electron';
import type { AppMode, ChatMessage, ToolExecutionRecord } from '../../shared/types';
import { LLMClient, type LLMMessage } from '../services/llm/client';
import { STANDARD_TOOL_DEFS, JULES_TOOL_DEFS, executeToolCall } from '../tools';
import { DataStore } from '../services/db/store';

const STANDARD_SYSTEM_PROMPT = `You are SeniorEngineer, a powerful autonomous software engineering AI assistant.
You operate on goals and objectives.
You have tools to read files, write files, edit file contents, run terminal commands, and inspect directories.
When given an objective:
1. Act autonomously. Execute the necessary steps to completion.
2. Do not stop midway to ask unnecessary questions when you have the tools to investigate and execute.
3. Test and verify your work with terminal commands when relevant.
4. Keep the user informed with clear, concise progress.`;

const JULES_SYSTEM_PROMPT = `You are the Lead Senior Staff Software Engineer and Architect.
Your role is to orchestrate, instruct, and supervise Google Labs Jules AI workers.

CORE OPERATING RULES:
1. YOU DO NOT WRITE OR EDIT CODE LOCALLY. Local code writing tools are disabled. Jules is your implementation worker.
2. Formulate clear, rigorous technical specifications and delegate tasks to Jules via 'jules_create_task'.
3. When Jules asks questions, analyze the architectural context and answer definitively via 'jules_reply_question'.
4. Do not output fake timer loops, sleep commands, or schedule markers. Monitoring is handled completely by the native application daemon.
5. Review Jules diffs critically and use 'run_verification_test' to verify changes locally before approving.`;

export class AgentOrchestrator {
  private static instance: AgentOrchestrator;
  private activeCancellations: Set<string> = new Set();

  public static getInstance(): AgentOrchestrator {
    if (!AgentOrchestrator.instance) {
      AgentOrchestrator.instance = new AgentOrchestrator();
    }
    return AgentOrchestrator.instance;
  }

  public cancel(sessionId: string) {
    this.activeCancellations.add(sessionId);
  }

  public async runAutonomousTurn(sessionId: string, userText: string): Promise<void> {
    const store = DataStore.getInstance();
    const session = store.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    this.activeCancellations.delete(sessionId);

    // Save user message
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_user`,
      sessionId,
      role: 'user',
      content: userText,
      timestamp: Date.now(),
    };
    store.addMessage(sessionId, userMsg);

    const mode: AppMode = session.mode || 'standard';
    const toolDefs = mode === 'jules' ? JULES_TOOL_DEFS : STANDARD_TOOL_DEFS;
    const systemPrompt = mode === 'jules' ? JULES_SYSTEM_PROMPT : STANDARD_SYSTEM_PROMPT;

    const workspaceDir = session.workspacePath || process.cwd();
    const settings = store.getSettings();
    const maxTurns = settings.maxAutonomousTurns || 50;

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
          toolDefs,
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

      for (const tc of result.toolCalls) {
        const toolName = tc.function?.name;
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
        const output = await executeToolCall(toolName, toolArgs, workspaceDir);

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

      assistantMsg.toolCalls = toolRecords;
      store.addMessage(sessionId, assistantMsg);
    }

    this.emitCompleted(sessionId);
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
}
