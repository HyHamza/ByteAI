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
  executionDuration?: number;
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

export type TaskState = 'idle' | 'running_agent' | 'waiting_jules' | 'awaiting_feedback' | 'completed';

export interface ChatSession {
  id: string;
  workspacePath: string;
  title: string;
  mode: AppMode;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  julesSessionId?: string;
  taskState?: TaskState;
}

export interface JulesSessionSummary {
  id: string;
  title?: string;
  state: 'STATE_UNSPECIFIED' | 'INITIALIZING' | 'PLANNING' | 'AWAITING_USER_INPUT' | 'AWAITING_USER_FEEDBACK' | 'CODING' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
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
  gitRepo?: string | null;
  gitBranch?: string | null;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  gitRepo?: string | null;
  gitBranch?: string | null;
  createdAt: number;
}

export interface ElectronAPI {
  // Chat & Stream
  sendMessage: (sessionId: string, text: string) => Promise<void>;
  cancelExecution: (sessionId: string) => Promise<void>;
  onStreamToken: (callback: (payload: StreamTokenPayload) => void) => () => void;
  onToolCallUpdate: (callback: (payload: ToolCallPayload) => void) => () => void;
  onExecutionCompleted: (callback: (sessionId: string) => void) => () => void;
  onTitleUpdated?: (callback: (payload: { sessionId: string; title: string }) => void) => () => void;
  getRunningSessions?: () => Promise<string[]>;
  onAgentStatus?: (callback: (payload: { sessionId: string; status: 'running' | 'idle' }) => void) => () => void;
  onJulesAllSessions?: (callback: (sessions: JulesSessionSummary[]) => void) => () => void;

  // Sessions
  listSessions: (workspacePath?: string) => Promise<ChatSession[]>;
  createSession: (title: string, mode?: AppMode, workspacePath?: string) => Promise<ChatSession>;
  updateSession: (sessionId: string, updates: Partial<ChatSession>) => Promise<ChatSession | null>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  onSessionsUpdated?: (callback: (sessions: ChatSession[]) => void) => () => void;

  // Workspace & Projects
  selectDirectory: () => Promise<string | null>;
  getWorkspaceInfo: () => Promise<WorkspaceFolderInfo | null>;
  showInExplorer: (folderPath: string) => Promise<boolean>;
  getProjects: () => Promise<ProjectInfo[]>;
  addProject: (folderPath?: string) => Promise<ProjectInfo | null>;
  deleteProject: (projectPath: string) => Promise<{ success: boolean; deletedSessionsCount: number }>;

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
