import { app, BrowserWindow, ipcMain, dialog, Menu, MenuItem, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { DataStore } from './services/db/store';
import { LLMClient } from './services/llm/client';
import { JulesClient } from './services/jules/client';
import { JulesPoller } from './services/jules/poller';
import { AgentOrchestrator } from './agent/orchestrator';
import { detectGitRepo } from './services/git/detector';
import { syncAndMergeJulesSession } from './services/git/merger';
import { TaskManager } from './services/task/manager';
import { GroqSpeechTranscriber } from './services/speech/groq';
import type { AppMode, ChatSession, AttachmentFile } from '../shared/types';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const preloadPath = path.join(__dirname, '../preload/preload.js');

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#131314',
    title: 'Byte',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();

    if (params.selectionText && params.selectionText.trim().length > 0) {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
    }

    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
      menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
    }

    if (!params.selectionText && !params.isEditable) {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy', enabled: false }));
    }

    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));

    menu.popup();
  });

  // Automatically permit microphone access for voice dictation
  mainWindow.webContents.session.setPermissionCheckHandler((_, permission) => {
    if (permission === 'media') return true;
    return false;
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_, permission, callback) => {
    if (permission === 'media') return callback(true);
    callback(false);
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
  JulesPoller.getInstance().startPolling(10000);

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

  // ── Workspace & Projects IPC
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
    store.addProject(selected);
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

  ipcMain.handle('workspace:show-in-explorer', async (_, { folderPath }: { folderPath: string }) => {
    try {
      if (folderPath) {
        await shell.openPath(folderPath);
        return true;
      }
    } catch (e) {
      console.error('Failed to open path in explorer:', e);
    }
    return false;
  });

  ipcMain.handle('projects:get', async () => {
    return store.getProjects();
  });

  ipcMain.handle('projects:add', async (_, { folderPath }: { folderPath?: string }) => {
    let targetPath = folderPath;
    if (!targetPath) {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select or Create Project Folder',
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      targetPath = result.filePaths[0];
    }

    const gitInfo = detectGitRepo(targetPath);
    const project = store.addProject(targetPath);
    project.gitRepo = gitInfo.repo;
    project.gitBranch = gitInfo.branch;

    // Also activate it as current workspace
    store.saveSettings({
      activeWorkspacePath: targetPath,
      ...(gitInfo.repo ? { julesDefaultRepo: gitInfo.repo } : {}),
      ...(gitInfo.branch ? { julesDefaultBranch: gitInfo.branch } : {}),
    });

    return project;
  });

  ipcMain.handle('projects:delete', async (_, { projectPath }: { projectPath: string }) => {
    return store.deleteProject(projectPath);
  });

  // ── Sessions IPC
  ipcMain.handle('sessions:list', async (_, { workspacePath }) => {
    return store.getSessions(workspacePath);
  });

  ipcMain.handle('sessions:create', async (_, { title, mode, workspacePath }: { title: string; mode?: AppMode; workspacePath?: string }) => {
    const settings = store.getSettings();
    const effectiveWs = workspacePath || settings.activeWorkspacePath || process.cwd();
    const newSession: ChatSession = {
      id: `ses_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      workspacePath: effectiveWs,
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
  ipcMain.handle('chat:pick-files', async (_, { types }: { types?: 'all' | 'images' | 'code' }) => {
    if (!mainWindow) return [];

    let filters = [
      { name: 'All Files', extensions: ['*'] }
    ];

    if (types === 'images') {
      filters = [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }
      ];
    } else if (types === 'code') {
      filters = [
        { name: 'Code & Text', extensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'py', 'html', 'css', 'md', 'txt', 'rs', 'go', 'yaml', 'yml'] },
        { name: 'All Files', extensions: ['*'] }
      ];
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Attach Files or Images',
      properties: ['openFile', 'multiSelections'],
      filters,
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return [];
    }

    const attachments: AttachmentFile[] = [];

    for (const filePath of result.filePaths) {
      try {
        const stat = fs.statSync(filePath);
        const name = path.basename(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext);

        let dataUrl: string | undefined = undefined;
        if (isImage) {
          const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          const buffer = fs.readFileSync(filePath);
          dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
        }

        attachments.push({
          id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name,
          path: filePath,
          size: stat.size,
          type: isImage ? 'image' : 'file',
          dataUrl,
        });
      } catch (err) {
        console.error('Failed reading attachment:', filePath, err);
      }
    }

    return attachments;
  });

  ipcMain.handle('chat:send-message', async (_, { sessionId, text, attachments }: { sessionId: string; text: string; attachments?: AttachmentFile[] }) => {
    // Run the autonomous agent loop in the background!
    orchestrator.runAutonomousTurn(sessionId, text, attachments).catch((err) => {
      console.error('Error during autonomous agent turn:', err);
    });
  });

  ipcMain.handle('chat:cancel', async (_, { sessionId }) => {
    orchestrator.cancel(sessionId);
  });

  ipcMain.handle('chat:get-running-sessions', async () => {
    return orchestrator.getRunningSessions();
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

  ipcMain.handle('jules:merge', async (_, { sessionId }: { sessionId: string }) => {
    return syncAndMergeJulesSession(sessionId);
  });

  // ── Background Tasks IPC
  ipcMain.handle('task:get-logs', async (_, { taskId }: { taskId: string }) => {
    return TaskManager.getInstance().getTaskLogs(taskId);
  });

  ipcMain.handle('task:kill', async (_, { taskId }: { taskId: string }) => {
    return TaskManager.getInstance().killTask(taskId);
  });

  // ── Speech Dictation IPC (Groq Whisper)
  ipcMain.handle('speech:transcribe', async (_, { audioBuffer, mimeType }: { audioBuffer: ArrayBuffer | Uint8Array; mimeType?: string }) => {
    return GroqSpeechTranscriber.getInstance().transcribe(audioBuffer, mimeType);
  });
}


