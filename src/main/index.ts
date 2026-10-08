import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { DataStore } from './services/db/store';
import { LLMClient } from './services/llm/client';
import { JulesClient } from './services/jules/client';
import { AgentOrchestrator } from './agent/orchestrator';
import { detectGitRepo } from './services/git/detector';
import type { AppMode, ChatSession } from '../shared/types';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const preloadPath = path.join(__dirname, '../preload/preload.js');

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../index.html'));
  }
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function setupIpcHandlers() {
  const store = DataStore.getInstance();
  const llmClient = LLMClient.getInstance();
  const julesClient = JulesClient.getInstance();
  const orchestrator = AgentOrchestrator.getInstance();

  // ── Settings IPC
  ipcMain.handle('settings:get', async () => {
    return store.getSettings();
  });

  ipcMain.handle('settings:save', async (_, partial) => {
    store.saveSettings(partial);
    return true;
  });

  ipcMain.handle('settings:models', async () => {
    return llmClient.fetchAvailableModels();
  });

  // ── Workspace IPC
  ipcMain.handle('workspace:select-dir', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const selected = result.filePaths[0];
    const gitInfo = detectGitRepo(selected);

    const updates: any = { activeWorkspacePath: selected };
    if (gitInfo.repo) {
      updates.julesDefaultRepo = gitInfo.repo;
      if (gitInfo.branch) updates.julesDefaultBranch = gitInfo.branch;
    }
    store.saveSettings(updates);
    return selected;
  });

  ipcMain.handle('workspace:get-info', async () => {
    const settings = store.getSettings();
    const wsPath = settings.activeWorkspacePath || process.cwd();
    const gitInfo = detectGitRepo(wsPath);
    return {
      path: wsPath,
      name: path.basename(wsPath),
      gitRepo: gitInfo.repo,
      gitBranch: gitInfo.branch,
    };
  });

  // ── Sessions IPC
  ipcMain.handle('sessions:list', async (_, { workspacePath }) => {
    return store.getSessions(workspacePath);
  });

  ipcMain.handle('sessions:create', async (_, { title, mode }: { title: string; mode?: AppMode }) => {
    const settings = store.getSettings();
    const newSession: ChatSession = {
      id: `ses_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      workspacePath: settings.activeWorkspacePath || process.cwd(),
      title: title || 'New Task',
      mode: mode || settings.mode,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    return store.saveSession(newSession);
  });

  ipcMain.handle('sessions:update', async (_, { sessionId, updates }: { sessionId: string; updates: Partial<ChatSession> }) => {
    return store.updateSession(sessionId, updates);
  });

  ipcMain.handle('sessions:delete', async (_, { sessionId }) => {
    return store.deleteSession(sessionId);
  });

  // ── Chat & Orchestrator IPC
  ipcMain.handle('chat:send-message', async (_, { sessionId, text }) => {
    // Run the autonomous agent loop in the background!
    orchestrator.runAutonomousTurn(sessionId, text).catch((err) => {
      console.error('Error during autonomous agent turn:', err);
    });
  });

  ipcMain.handle('chat:cancel', async (_, { sessionId }) => {
    orchestrator.cancel(sessionId);
  });

  // ── Jules IPC
  ipcMain.handle('jules:list-sessions', async () => {
    try {
      return await julesClient.listSessions();
    } catch (err: any) {
      console.warn('Jules listSessions error:', err.message);
      return [];
    }
  });

  ipcMain.handle('jules:list-activities', async (_, { sessionId }) => {
    return julesClient.listActivities(sessionId);
  });

  ipcMain.handle('jules:create-task', async (_, { prompt, title, repo, branch }) => {
    return julesClient.createSession({ prompt, title, repo, branch });
  });

  ipcMain.handle('jules:followup', async (_, { sessionId, prompt }) => {
    return julesClient.sendFollowup(sessionId, prompt);
  });
}
