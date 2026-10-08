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

  onStreamRetry: (callback) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('chat:stream-retry', handler);
    return () => ipcRenderer.removeListener('chat:stream-retry', handler);
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
  listSessions: (workspacePath) => ipcRenderer.invoke('sessions:list', { workspacePath }),
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
  getWorkspaceInfo: () => ipcRenderer.invoke('workspace:get-info'),
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
  julesSendFollowup: (sessionId, prompt) => ipcRenderer.invoke('jules:followup', { sessionId, prompt }),
  julesMergeSession: (sessionId) => ipcRenderer.invoke('jules:merge', { sessionId }),
  
  onJulesUpdate: (callback) => {
    const handler = (_: any, update: JulesSessionSummary) => callback(update);
    ipcRenderer.on('jules:update', handler);
    return () => ipcRenderer.removeListener('jules:update', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
