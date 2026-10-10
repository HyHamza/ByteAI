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
  groqApiKey?: string;
  securityPreset?: 'turbo' | 'confirm';
  planReviewPolicy?: 'proceed' | 'review';
  queuedMessages?: 'queue' | 'immediate';
  theme?: 'obsidian' | 'contrast' | 'whiteTheme';
  vadEnabled?: boolean;
  userName?: string;
  userEmail?: string;
  preventSleep?: boolean;
  defaultAutonomousMode?: boolean;
}

export interface AttachmentFile {
  id: string;
  name: string;
  path: string;
  size: number;
  type: 'image' | 'file';
  dataUrl?: string; // base64 thumbnail for images or preview
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  attachments?: AttachmentFile[];
  toolCalls?: ToolExecutionRecord[];
  isStreaming?: boolean;
  executionDuration?: number;
  thinking?: string;
  isSystemNotification?: boolean;
  model?: string;
}

export interface ToolExecutionRecord {
  id: string;
  toolName: string;
  args: Record<string, any>;
  output?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  startedAt: number;
  completedAt?: number;
  intent?: string;
  thinking?: string;
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
  autonomousMode?: boolean;
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

export interface StreamRetryPayload {
  sessionId: string;
  attempt: number;
  maxRetries: number;
  delayMs: number;
  reason: string;
}

export interface StreamTokenPayload {
  sessionId: string;
  messageId: string;
  delta: string;
}

export interface StreamReasoningPayload {
  sessionId: string;
  messageId: string;
  delta: string;
}

export interface ModelResolvedPayload {
  sessionId: string;
  model: string;
  messageId?: string;
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
  sendMessage: (sessionId: string, text: string, attachments?: AttachmentFile[]) => Promise<void>;
  cancelExecution: (sessionId: string) => Promise<void>;
  pickFiles?: (types?: 'all' | 'images' | 'code') => Promise<AttachmentFile[]>;
  onStreamToken: (callback: (payload: StreamTokenPayload) => void) => () => void;
  onStreamReasoning?: (callback: (payload: StreamReasoningPayload) => void) => () => void;
  onStreamRetry?: (callback: (payload: StreamRetryPayload) => void) => () => void;
  onModelResolved?: (callback: (payload: ModelResolvedPayload) => void) => () => void;
  onToolCallUpdate: (callback: (payload: ToolCallPayload) => void) => () => void;
  onExecutionCompleted: (callback: (sessionId: string) => void) => () => void;
  onStreamClear?: (callback: (sessionId: string) => void) => () => void;
  onTitleUpdated?: (callback: (payload: { sessionId: string; title: string }) => void) => () => void;
  getRunningSessions?: () => Promise<string[]>;
  onAgentStatus?: (callback: (payload: { sessionId: string; status: 'running' | 'idle' }) => void) => () => void;
  onJulesAllSessions?: (callback: (sessions: JulesSessionSummary[]) => void) => () => void;

  // Sessions
  listSessions: (workspacePath?: string, activeSessionId?: string) => Promise<ChatSession[]>;
  getSession?: (sessionId: string) => Promise<ChatSession | null>;
  createSession: (title: string, mode?: AppMode, workspacePath?: string) => Promise<ChatSession>;
  updateSession: (sessionId: string, updates: Partial<ChatSession>) => Promise<ChatSession | null>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  onSessionsUpdated?: (callback: (sessions: ChatSession[]) => void) => () => void;

  // Workspace & Projects
  selectDirectory: () => Promise<string | null>;
  getWorkspaceInfo: (folderPath?: string) => Promise<WorkspaceFolderInfo | null>;
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
  julesContinueSession: (prompt: string, sessionId?: string) => Promise<boolean>;
  julesSendFollowup: (sessionId: string, prompt: string) => Promise<boolean>;
  julesMergeSession: (sessionId: string) => Promise<{ success: boolean; message: string }>;
  julesFinalizeAndMerge: (sessionId?: string) => Promise<{ success: boolean; message: string }>;
  onJulesUpdate: (callback: (update: JulesSessionSummary) => void) => () => void;

  // Background Tasks API
  getTaskLogs?: (taskId: string) => Promise<{ status: string; exitCode: number | null; output: string; logPath: string; isRunning: boolean }>;
  killTask?: (taskId: string) => Promise<string>;

  // Speech Dictation API (Groq Whisper)
  transcribeAudio?: (audioData: ArrayBuffer | Uint8Array, mimeType?: string) => Promise<{ text: string; error?: string }>;

  // Duty Shift API (Long-Running Autonomous Jules Shifts)
  startDutyShift: (sessionId: string, missionPrompt: string, hours: number) => Promise<DutyShift>;
  stopDutyShift: (shiftId: string) => Promise<boolean>;
  pauseDutyShift: (shiftId: string) => Promise<boolean>;
  resumeDutyShift: (shiftId: string) => Promise<boolean>;
  getActiveDutyShift: (sessionId?: string) => Promise<DutyShift | null>;
  onDutyShiftUpdated: (callback: (shift: DutyShift | null) => void) => () => void;

  // Autonomous Mode API (Per-Session Task Watchdog)
  toggleAutonomousMode?: (sessionId: string) => Promise<boolean>;
  onAutonomousModeUpdated?: (callback: (payload: { sessionId: string; enabled: boolean }) => void) => () => void;

  // Native Clipboard API
  copyImageToClipboard?: (payload: { imageUrl?: string; filePath?: string }) => Promise<boolean>;
}

export interface DutyShiftPhase {
  sessionId: string;
  title: string;
  prUrl?: string;
  summary?: string;
  completedAt: number;
}

export interface DutyShift {
  id: string;
  sessionId: string;
  currentJulesSessionId?: string;
  missionPrompt: string;
  totalHours: number;
  durationMs: number;
  startedAt: number;
  targetEndAt: number;
  status: 'active' | 'paused' | 'completed' | 'stopped';
  phasesCompleted: DutyShiftPhase[];
  lastCheckAt: number;
}


