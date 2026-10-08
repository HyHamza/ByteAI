import type { 
  ElectronAPI, 
  AppSettings, 
  ChatSession, 
  JulesSessionSummary, 
  JulesActivity,
  StreamTokenPayload,
  ToolCallPayload 
} from '../shared/types';

const DEFAULT_SETTINGS: AppSettings = {
  mode: 'standard',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  selectedModel: 'gpt-4o',
  isAutoModel: true,
  julesApiKey: '',
  julesDefaultRepo: '',
  julesDefaultBranch: 'main',
  maxAutonomousTurns: 50,
  activeWorkspacePath: null,
};

// Fallback in-memory storage for web browser preview or when Electron preload isn't attached
let mockSettings: AppSettings = { ...DEFAULT_SETTINGS };
let mockSessions: ChatSession[] = [
  {
    id: 'ses_mock_initial',
    workspacePath: 'E:\\CODE\\SeniorEngineer',
    title: 'Initial Workspace Task',
    mode: 'standard',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [
      {
        id: 'msg_welcome',
        sessionId: 'ses_mock_initial',
        role: 'assistant',
        content: 'Welcome to SeniorEngineer! Select Standard AI or Jules Senior Lead mode to begin.',
        timestamp: Date.now(),
      },
    ],
  },
];

const mockAPI: ElectronAPI = {
  sendMessage: async (sessionId: string, text: string) => {
    const session = mockSessions.find((s) => s.id === sessionId);
    if (!session) return;
    session.messages.push({
      id: `msg_${Date.now()}_user`,
      sessionId,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });
    // Simulated assistant response in browser
    setTimeout(() => {
      session.messages.push({
        id: `msg_${Date.now()}_assistant`,
        sessionId,
        role: 'assistant',
        content: `Acknowledged: "${text}". Running in ${session.mode} mode.`,
        timestamp: Date.now(),
      });
    }, 500);
  },
  cancelExecution: async () => {},
  onStreamToken: () => () => {},
  onToolCallUpdate: () => () => {},
  onExecutionCompleted: () => () => {},

  listSessions: async () => [...mockSessions],
  createSession: async (title: string, mode?: any) => {
    const s: ChatSession = {
      id: `ses_${Date.now()}`,
      workspacePath: mockSettings.activeWorkspacePath || 'E:\\CODE\\SeniorEngineer',
      title: title || 'New Task',
      mode: mode || mockSettings.mode,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    mockSessions.unshift(s);
    return s;
  },
  updateSession: async (id: string, updates: Partial<ChatSession>) => {
    const s = mockSessions.find((sess) => sess.id === id);
    if (s) {
      Object.assign(s, updates);
      return s;
    }
    return null;
  },
  deleteSession: async (id: string) => {
    mockSessions = mockSessions.filter((s) => s.id !== id);
    return true;
  },

  selectDirectory: async () => 'E:\\CODE\\SeniorEngineer',
  getWorkspaceInfo: async () => ({
    path: mockSettings.activeWorkspacePath || 'E:\\CODE\\SeniorEngineer',
    name: 'SeniorEngineer',
    gitRepo: 'sources/github/HyHamza/SeniorEngineer',
    gitBranch: 'main',
  }),
  showInExplorer: async () => true,
  getProjects: async () => [],
  addProject: async (folderPath?: string) => ({
    id: folderPath || 'proj',
    name: folderPath ? folderPath.split('\\').pop() || 'Project' : 'Project',
    path: folderPath || 'E:\\CODE',
    createdAt: Date.now(),
  }),
  deleteProject: async () => ({ success: true, deletedSessionsCount: 0 }),

  getSettings: async () => ({ ...mockSettings }),
  saveSettings: async (settings) => {
    mockSettings = { ...mockSettings, ...settings };
    return true;
  },
  getAvailableModels: async () => [
    'gpt-4o',
    'gpt-4o-mini',
    'claude-3-5-sonnet',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
  ],

  getJulesSessions: async () => [
    {
      id: 'ses_sample_jules',
      title: 'Autonomous System Audit',
      state: 'CODING',
      repo: 'sources/github/HyHamza/SeniorEngineer',
      branch: 'main',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  getJulesActivities: async () => [
    {
      id: 'act_1',
      type: 'TASK_STARTED',
      description: 'Jules initialized VM and cloned repository branch.',
      timestamp: new Date().toISOString(),
    },
  ],
  julesCreateTask: async () => ({ sessionId: `ses_${Date.now()}` }),
  julesSendFollowup: async () => true,
  julesMergeSession: async () => ({ success: true, message: 'Merged successfully' }),
  getRunningSessions: async () => [],
  onAgentStatus: () => () => {},
  onJulesAllSessions: () => () => {},
  onJulesUpdate: () => () => {},
};

export const api: ElectronAPI =
  typeof window !== 'undefined' && window.electronAPI ? window.electronAPI : mockAPI;
