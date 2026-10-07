import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI, StreamTokenPayload, ToolCallPayload, JulesSessionSummary } from '../shared/types';

const api: ElectronAPI = {
  // Chat
  sendMessage: (sessionId, text) => ipcRenderer.invoke('chat:send-message', { sessionId, text }),
  cancelExecution: (sessionId) => ipcRenderer.invoke('chat:cancel', { sessionId }),
  
  onStreamToken: (callback) => {
    const handler = (_: any, payload: StreamTokenPayload) => callback(payload);
    ipcRenderer.on('chat:stream-token', handler);
    return () => ipcRenderer.removeListener('chat:stream-token', handler);
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

  // Sessions
  listSessions: (workspacePath) => ipcRenderer.invoke('sessions:list', { workspacePath }),
  createSession: (title, mode) => ipcRenderer.invoke('sessions:create', { title, mode }),
  deleteSession: (sessionId) => ipcRenderer.invoke('sessions:delete', { sessionId }),

  // Workspace
  selectDirectory: () => ipcRenderer.invoke('workspace:select-dir'),
  getWorkspaceInfo: () => ipcRenderer.invoke('workspace:get-info'),

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
