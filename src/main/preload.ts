import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI, StreamTokenPayload, ToolCallPayload, JulesSessionSummary, ChatSession } from '../shared/types';

const api: ElectronAPI = {
  // Chat
  sendMessage: (sessionId, text, attachments) => ipcRenderer.invoke('chat:send-message', { sessionId, text, attachments }),
  cancelExecution: (sessionId) => ipcRenderer.invoke('chat:cancel', { sessionId }),
  pickFiles: (types) => ipcRenderer.invoke('chat:pick-files', { types }),
  
  onStreamToken: (callback) => {
    const handler = (_: any, payload: StreamTokenPayload) => callback(payload);
    ipcRenderer.on('chat:stream-token', handler);
    return () => ipcRenderer.removeListener('chat:stream-token', handler);
  },

  onStreamReasoning: (callback) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('chat:stream-reasoning', handler);
    return () => ipcRenderer.removeListener('chat:stream-reasoning', handler);
  },

  onStreamRetry: (callback) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('chat:stream-retry', handler);
    return () => ipcRenderer.removeListener('chat:stream-retry', handler);
  },

  onModelResolved: (callback) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('chat:model-resolved', handler);
    return () => ipcRenderer.removeListener('chat:model-resolved', handler);
  },

  onToolCallUpdate: (callback) => {
    const handler = (_: any, payload: ToolCallPayload) => callback(payload);
    ipcRenderer.on('chat:tool-call', handler);
    return () => ipcRenderer.removeListener('chat:tool-call', handler);
  },

  onExecutionCompleted: (callback) => {
    const handler = (_: any, sessionId: string) => callback(sessionId);
    ipcRenderer.on('chat:completed', handler);
    return () => ipcRenderer.removeListener('chat:completed', handler);
  },

  onStreamClear: (callback) => {
    const handler = (_: any, sessionId: string) => callback(sessionId);
    ipcRenderer.on('chat:clear-stream', handler);
    return () => ipcRenderer.removeListener('chat:clear-stream', handler);
  },

  onTitleUpdated: (callback) => {
    const handler = (_: any, payload: { sessionId: string; title: string }) => callback(payload);
    ipcRenderer.on('chat:title-updated', handler);
    return () => ipcRenderer.removeListener('chat:title-updated', handler);
  },

  getRunningSessions: () => ipcRenderer.invoke('chat:get-running-sessions'),

  onAgentStatus: (callback) => {
    const handler = (_: any, payload: { sessionId: string; status: 'running' | 'idle' }) => callback(payload);
    ipcRenderer.on('chat:agent-status', handler);
    return () => ipcRenderer.removeListener('chat:agent-status', handler);
  },

  onJulesAllSessions: (callback) => {
    const handler = (_: any, sessions: JulesSessionSummary[]) => callback(sessions);
    ipcRenderer.on('jules:all-sessions', handler);
    return () => ipcRenderer.removeListener('jules:all-sessions', handler);
  },

  // Sessions
  listSessions: (workspacePath, activeSessionId) => ipcRenderer.invoke('sessions:list', { workspacePath, activeSessionId }),
  getSession: (sessionId) => ipcRenderer.invoke('sessions:get', { sessionId }),
  createSession: (title, mode, workspacePath) => ipcRenderer.invoke('sessions:create', { title, mode, workspacePath }),
  updateSession: (sessionId, updates) => ipcRenderer.invoke('sessions:update', { sessionId, updates }),
  deleteSession: (sessionId) => ipcRenderer.invoke('sessions:delete', { sessionId }),
  onSessionsUpdated: (callback) => {
    const handler = (_: any, sessions: ChatSession[]) => callback(sessions);
    ipcRenderer.on('sessions:updated', handler);
    return () => ipcRenderer.removeListener('sessions:updated', handler);
  },

  // Workspace & Projects
  selectDirectory: () => ipcRenderer.invoke('workspace:select-dir'),
  getWorkspaceInfo: (folderPath?: string) => ipcRenderer.invoke('workspace:get-info', { folderPath }),
  showInExplorer: (folderPath) => ipcRenderer.invoke('workspace:show-in-explorer', { folderPath }),
  getProjects: () => ipcRenderer.invoke('projects:get'),
  addProject: (folderPath) => ipcRenderer.invoke('projects:add', { folderPath }),
  deleteProject: (projectPath) => ipcRenderer.invoke('projects:delete', { projectPath }),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  getAvailableModels: () => ipcRenderer.invoke('settings:models'),

  // Jules
  getJulesSessions: () => ipcRenderer.invoke('jules:list-sessions'),
  getJulesActivities: (sessionId) => ipcRenderer.invoke('jules:list-activities', { sessionId }),
  julesCreateTask: (prompt, title, repo, branch) => ipcRenderer.invoke('jules:create-task', { prompt, title, repo, branch }),
  julesContinueSession: (prompt, sessionId) => ipcRenderer.invoke('jules:continue-session', { prompt, sessionId }),
  julesSendFollowup: (sessionId, prompt) => ipcRenderer.invoke('jules:followup', { sessionId, prompt }),
  julesMergeSession: (sessionId) => ipcRenderer.invoke('jules:merge', { sessionId }),
  julesFinalizeAndMerge: (sessionId) => ipcRenderer.invoke('jules:finalize-and-merge', { sessionId }),
  
  onJulesUpdate: (callback) => {
    const handler = (_: any, update: JulesSessionSummary) => callback(update);
    ipcRenderer.on('jules:update', handler);
    return () => ipcRenderer.removeListener('jules:update', handler);
  },

  // Background Tasks
  getRunningTasks: (sessionId?: string) => ipcRenderer.invoke('task:get-running', { sessionId }),
  getTaskLogs: (taskId: string) => ipcRenderer.invoke('task:get-logs', { taskId }),
  killTask: (taskId: string) => ipcRenderer.invoke('task:kill', { taskId }),

  // Speech Dictation (Groq Whisper)
  transcribeAudio: (audioBuffer: ArrayBuffer | Uint8Array, mimeType?: string) => ipcRenderer.invoke('speech:transcribe', { audioBuffer, mimeType }),

  // Duty Shifts (Long-Running Tasks)
  startDutyShift: (sessionId: string, missionPrompt: string, hours: number) => ipcRenderer.invoke('duty:start', { sessionId, missionPrompt, hours }),
  stopDutyShift: (shiftId: string) => ipcRenderer.invoke('duty:stop', { shiftId }),
  pauseDutyShift: (shiftId: string) => ipcRenderer.invoke('duty:pause', { shiftId }),
  resumeDutyShift: (shiftId: string) => ipcRenderer.invoke('duty:resume', { shiftId }),
  getActiveDutyShift: (sessionId?: string) => ipcRenderer.invoke('duty:get-active', { sessionId }),
  onDutyShiftUpdated: (callback: (shift: any) => void) => {
    const handler = (_: any, shift: any) => callback(shift);
    ipcRenderer.on('duty:updated', handler);
    return () => ipcRenderer.removeListener('duty:updated', handler);
  },

  // Autonomous Mode
  toggleAutonomousMode: (sessionId: string) => ipcRenderer.invoke('autonomous:toggle', { sessionId }),
  onAutonomousModeUpdated: (callback: (payload: { sessionId: string; enabled: boolean }) => void) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('session:autonomous-mode-updated', handler);
    return () => ipcRenderer.removeListener('session:autonomous-mode-updated', handler);
  },

  // Native Clipboard API
  copyImageToClipboard: (payload: { imageUrl?: string; filePath?: string }) => ipcRenderer.invoke('clipboard:copy-image', payload),
  copyTextToClipboard: (text: string) => ipcRenderer.invoke('clipboard:copy-text', { text }),

  // Automation & PC Control API
  automation: {
    emergencyStop: () => ipcRenderer.invoke('automation:emergency-stop'),
    resetEmergencyStop: () => ipcRenderer.invoke('automation:reset-emergency-stop'),
    isStopped: () => ipcRenderer.invoke('automation:is-stopped'),
  },

  // Free LLM In-Process Engine API
  freellm: {
    listKeys: () => ipcRenderer.invoke('freellm:keys:list'),
    addKey: (data) => ipcRenderer.invoke('freellm:keys:add', data),
    updateKey: (id, data) => ipcRenderer.invoke('freellm:keys:update', { id, data }),
    deleteKey: (id) => ipcRenderer.invoke('freellm:keys:delete', { id }),
    testKey: (id) => ipcRenderer.invoke('freellm:keys:test', { id }),
    getAnalyticsSummary: () => ipcRenderer.invoke('freellm:analytics:summary'),
    getPlatformStats: () => ipcRenderer.invoke('freellm:analytics:platforms'),
    getTimeline: (days) => ipcRenderer.invoke('freellm:analytics:timeline', { days }),
    getRequestLogs: (limit, offset) => ipcRenderer.invoke('freellm:analytics:logs', { limit, offset }),
    getModelListing: () => ipcRenderer.invoke('freellm:models:list'),
    getFallbackChain: () => ipcRenderer.invoke('freellm:fallback:list'),
    updateFallbackPriority: (modelDbId, priority, enabled) => ipcRenderer.invoke('freellm:fallback:update', { modelDbId, priority, enabled }),
    getRoutingStrategy: () => ipcRenderer.invoke('freellm:strategy:get'),
    setRoutingStrategy: (strategy) => ipcRenderer.invoke('freellm:strategy:set', { strategy }),
    getModelUnification: () => ipcRenderer.invoke('freellm:unify:get'),
    setModelUnification: (enabled) => ipcRenderer.invoke('freellm:unify:set', { enabled }),
    chatPlayground: (prompt, model, temperature) => ipcRenderer.invoke('freellm:playground:run', { prompt, model, temperature }),
    generateImage: (prompt, options) => ipcRenderer.invoke('freellm:media:generate-image', { prompt, options }),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
