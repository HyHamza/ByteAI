// ─── Shared Type Definitions for SeniorEngineer ─────────────────────────────────

export type AppMode = 'standard' | 'jules';

export interface ModelConfig {
  id: string;
  name: string;
  provider: 'freellm' | 'openai' | 'openrouter' | 'ollama' | 'gemini' | 'custom';
  endpoint?: string;
  apiKey?: string;
  isAuto?: boolean;
}

export interface AppSettings {
  mode: AppMode;
  apiBaseUrl: string;
  apiKey: string;
  selectedModel: string;
  isAutoModel: boolean;
  julesApiKey: string;
  julesDefaultRepo: string;
  julesDefaultBranch: string;
  maxAutonomousTurns: number;
  activeWorkspacePath: string | null;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolExecutionRecord[];
  isStreaming?: boolean;
}

export interface ToolExecutionRecord {
  id: string;
  toolName: string;
  args: Record<string, any>;
  output?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  startedAt: number;
  completedAt?: number;
}

export interface ChatSession {
  id: string;
  workspacePath: string;
  title: string;
  mode: AppMode;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface JulesSessionSummary {
  id: string;
  title?: string;
  state: 'STATE_UNSPECIFIED' | 'INITIALIZING' | 'PLANNING' | 'AWAITING_USER_INPUT' | 'CODING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  repo: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
  prUrl?: string;
  prNumber?: number;
}

export interface JulesActivity {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface StreamTokenPayload {
  sessionId: string;
  messageId: string;
  delta: string;
}

export interface ToolCallPayload {
  sessionId: string;
  messageId: string;
  toolCall: ToolExecutionRecord;
}

export interface WorkspaceFolderInfo {
  path: string;
  name: string;
  filesCount?: number;
}

export interface ElectronAPI {
  // Chat & Stream
  sendMessage: (sessionId: string, text: string) => Promise<void>;
  cancelExecution: (sessionId: string) => Promise<void>;
  onStreamToken: (callback: (payload: StreamTokenPayload) => void) => () => void;
  onToolCallUpdate: (callback: (payload: ToolCallPayload) => void) => () => void;
  onExecutionCompleted: (callback: (sessionId: string) => void) => () => void;

  // Sessions
  listSessions: (workspacePath?: string) => Promise<ChatSession[]>;
  createSession: (title: string, mode?: AppMode) => Promise<ChatSession>;
  deleteSession: (sessionId: string) => Promise<boolean>;

  // Workspace
  selectDirectory: () => Promise<string | null>;
  getWorkspaceInfo: () => Promise<WorkspaceFolderInfo | null>;

  // Settings
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<boolean>;
  getAvailableModels: () => Promise<string[]>;

  // Jules Operations
  getJulesSessions: () => Promise<JulesSessionSummary[]>;
  getJulesActivities: (sessionId: string) => Promise<JulesActivity[]>;
  julesCreateTask: (prompt: string, title?: string, repo?: string, branch?: string) => Promise<{ sessionId: string }>;
  julesSendFollowup: (sessionId: string, prompt: string) => Promise<boolean>;
  julesMergeSession: (sessionId: string) => Promise<{ success: boolean; message: string }>;
  onJulesUpdate: (callback: (update: JulesSessionSummary) => void) => () => void;
}
