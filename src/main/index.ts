import { app, BrowserWindow, ipcMain, dialog, Menu, MenuItem, shell, powerSaveBlocker, clipboard, nativeImage, Tray, globalShortcut } from 'electron';
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
import { DutyManager } from './services/duty/manager';
import { AutonomousWatchdog } from './services/autonomous/watchdog';
import { FreeLLMEngine } from './services/freellm/engine';
import { DesktopAutomationService, BrowserAutomationService } from './services/automation';
import type { AppMode, ChatSession, AttachmentFile, AppSettings } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let powerSaveBlockerId: number | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Enforce single-instance lock for background-running app
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

function syncPowerSaveBlocker(enabled: boolean) {
  if (enabled) {
    if (powerSaveBlockerId === null || !powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
      console.log(`[PowerSaveBlocker] Device sleep prevention active (ID: ${powerSaveBlockerId})`);
    }
  } else {
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      console.log(`[PowerSaveBlocker] Device sleep prevention disabled (ID: ${powerSaveBlockerId})`);
    }
    powerSaveBlockerId = null;
  }
}

function syncOpenAtLogin(enabled: boolean) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true,
      path: process.execPath,
      args: ['--hidden'],
    });
    console.log(`[Startup] Auto-start on boot: ${enabled}`);
  } catch (err) {
    console.error('[Startup] Failed to configure openAtLogin:', err);
  }
}

function updateTrayContextMenu() {
  if (!tray) return;
  const store = DataStore.getInstance();
  const settings = store.getSettings();
  const runInBackground = settings.runInBackground !== false;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Byte',
      click: () => {
        if (!mainWindow) {
          createWindow();
        } else {
          mainWindow.show();
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'New Task',
      click: () => {
        if (!mainWindow) {
          createWindow();
        } else {
          mainWindow.show();
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
        mainWindow?.webContents.send('navigation:new-chat');
      },
    },
    { type: 'separator' },
    {
      label: `Background Running: ${runInBackground ? 'Active' : 'Disabled'}`,
      enabled: false,
    },
    {
      label: `Start on Startup: ${settings.openAtLogin ? 'Active' : 'Disabled'}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit Byte',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

function setupTray() {
  if (tray) return;
  const iconPath = getAppIcon();
  if (!iconPath) return;

  try {
    tray = new Tray(iconPath);
    tray.setToolTip('Byte AI - Autonomous Lead Engineer');
    updateTrayContextMenu();

    tray.on('click', () => {
      if (!mainWindow) {
        createWindow();
      } else if (mainWindow.isVisible()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
          mainWindow.focus();
        } else {
          mainWindow.focus();
        }
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    tray.on('double-click', () => {
      if (!mainWindow) {
        createWindow();
      } else {
        mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  } catch (err) {
    console.error('[Tray] Failed to initialize tray:', err);
  }
}

function getAppIcon(): string | undefined {
  const candidates = [
    path.join(__dirname, '../../build/icon.ico'),
    path.join(__dirname, '../../resources/icon.ico'),
    path.join(__dirname, '../../dist/icon.png'),
    path.join(__dirname, '../../resources/icon.png'),
    path.join(__dirname, '../../public/icon.png'),
    path.join(__dirname, '../../logo.png'),
    path.join(process.cwd(), 'build/icon.ico'),
    path.join(process.cwd(), 'resources/icon.ico'),
    path.join(process.cwd(), 'resources/icon.png'),
    path.join(process.cwd(), 'logo.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function createWindow() {
  const preloadPath = path.join(__dirname, '../preload/preload.js');
  const appIcon = getAppIcon();

  if (process.platform === 'win32') {
    app.setAppUserModelId('com.byte.ai');
  }

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#131314',
    title: 'Byte',
    icon: appIcon,
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

  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('close', (event) => {
    const settings = DataStore.getInstance().getSettings();
    const runInBackground = settings.runInBackground !== false;
    if (!isQuitting && runInBackground) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.once('ready-to-show', () => {
    const isHidden = process.argv.includes('--hidden');
    if (!isHidden) {
      mainWindow?.show();
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const distHtml = path.join(__dirname, '../../dist/index.html');
    if (fs.existsSync(distHtml)) {
      mainWindow.loadFile(distHtml);
    } else {
      mainWindow.loadFile(path.join(__dirname, '../../index.html'));
    }
  }
}

app.whenReady().then(() => {
  app.on('before-quit', () => {
    isQuitting = true;
  });

  Menu.setApplicationMenu(null);
  FreeLLMEngine.getInstance().init();
  setupIpcHandlers();
  createWindow();
  setupTray();
  JulesPoller.getInstance().startPolling(10000);
  AutonomousWatchdog.getInstance();

  // Initialize prevent sleep blocker and auto-start on boot based on persisted user preference
  const initialSettings = DataStore.getInstance().getSettings();
  syncPowerSaveBlocker(Boolean(initialSettings.preventSleep));
  syncOpenAtLogin(Boolean(initialSettings.openAtLogin));

  // Register emergency automation kill-switch shortcut (Ctrl+Alt+Escape)
  try {
    globalShortcut.register('CommandOrControl+Alt+Escape', () => {
      console.warn('[Automation] Emergency killswitch triggered via global shortcut.');
      DesktopAutomationService.getInstance().triggerEmergencyStop();
      BrowserAutomationService.getInstance().close();
      mainWindow?.webContents.send('toast:show', {
        type: 'warning',
        message: 'Emergency Kill-Switch: PC and browser automation stopped.',
      });
    });
  } catch (err) {
    console.warn('[Automation] Failed to register global killswitch shortcut:', err);
  }

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
});

app.on('window-all-closed', () => {
  const settings = DataStore.getInstance().getSettings();
  const runInBackground = settings.runInBackground !== false;
  if (!runInBackground && process.platform !== 'darwin') {
    app.quit();
  }
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
    if (partial.preventSleep !== undefined) {
      syncPowerSaveBlocker(Boolean(partial.preventSleep));
    }
    if (partial.openAtLogin !== undefined) {
      syncOpenAtLogin(Boolean(partial.openAtLogin));
    }
    updateTrayContextMenu();
    return true;
  });

  ipcMain.handle('settings:models', async () => {
    return llmClient.fetchAvailableModels();
  });

  // ── Automation & PC Control IPC
  ipcMain.handle('automation:emergency-stop', async () => {
    DesktopAutomationService.getInstance().triggerEmergencyStop();
    BrowserAutomationService.getInstance().close();
    return true;
  });

  ipcMain.handle('automation:reset-emergency-stop', async () => {
    DesktopAutomationService.getInstance().resetEmergencyStop();
    return true;
  });

  ipcMain.handle('automation:is-stopped', async () => {
    return DesktopAutomationService.getInstance().isStopped();
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

  ipcMain.handle('workspace:get-info', async (_, args?: { folderPath?: string }) => {
    const settings = store.getSettings();
    const wsPath = args?.folderPath || settings.activeWorkspacePath || process.cwd();
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

  ipcMain.handle('projects:delete', async (_, { projectPath, projectName }: { projectPath: string; projectName?: string }) => {
    return store.deleteProject(projectPath, projectName);
  });

  // ── Sessions IPC
  ipcMain.handle('sessions:list', async (_, args?: { workspacePath?: string; activeSessionId?: string }) => {
    return store.getSessions(args?.workspacePath, args?.activeSessionId);
  });

  ipcMain.handle('sessions:get', async (_, { sessionId }: { sessionId: string }) => {
    return store.getSession(sessionId) || null;
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
      autonomousMode: Boolean(settings.defaultAutonomousMode),
      messages: [],
    };
    return store.saveSession(newSession);
  });

  ipcMain.handle('sessions:update', async (_, { sessionId, updates }: { sessionId: string; updates: Partial<ChatSession> }) => {
    if (updates.autonomousMode !== undefined) {
      AutonomousWatchdog.getInstance().setAutonomousMode(sessionId, updates.autonomousMode);
    }
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
    orchestrator.runAutonomousTurn(sessionId, text, attachments, false).catch((err) => {
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

  ipcMain.handle('jules:continue-session', async (_, { prompt, sessionId }: { prompt: string; sessionId?: string }) => {
    let targetId = sessionId;
    if (!targetId) {
      const active = store.getSessions().find((s) => !!s.julesSessionId);
      targetId = active?.julesSessionId;
    }
    if (!targetId) throw new Error('No active Jules session found to continue');
    await julesClient.sendFollowup(targetId, prompt);
    JulesPoller.getInstance().trackSession(targetId);
    return true;
  });

  ipcMain.handle('jules:followup', async (_, { sessionId, prompt }) => {
    return julesClient.sendFollowup(sessionId, prompt);
  });

  ipcMain.handle('jules:merge', async (_, { sessionId }: { sessionId: string }) => {
    return syncAndMergeJulesSession(sessionId);
  });

  ipcMain.handle('jules:finalize-and-merge', async (_, { sessionId }: { sessionId?: string }) => {
    let targetId = sessionId;
    if (!targetId) {
      const active = store.getSessions().find((s) => !!s.julesSessionId);
      targetId = active?.julesSessionId;
    }
    if (!targetId) throw new Error('No active Jules session found to finalize and merge');
    return syncAndMergeJulesSession(targetId);
  });

  // ── Background Tasks IPC
  ipcMain.handle('task:get-running', async (_, { sessionId }: { sessionId?: string } = {}) => {
    return TaskManager.getInstance().getRunningTasks(sessionId);
  });

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

  // ── Duty Shifts IPC (Long-Running Tasks)
  ipcMain.handle('duty:start', async (_, { sessionId, missionPrompt, hours }: { sessionId: string; missionPrompt: string; hours: number }) => {
    return DutyManager.getInstance().startShift(sessionId, missionPrompt, hours);
  });

  ipcMain.handle('duty:stop', async (_, { shiftId }: { shiftId: string }) => {
    return DutyManager.getInstance().stopShift(shiftId);
  });

  ipcMain.handle('duty:pause', async (_, { shiftId }: { shiftId: string }) => {
    return DutyManager.getInstance().pauseShift(shiftId);
  });

  ipcMain.handle('duty:resume', async (_, { shiftId }: { shiftId: string }) => {
    return DutyManager.getInstance().resumeShift(shiftId);
  });

  ipcMain.handle('duty:get-active', async (_, { sessionId }: { sessionId?: string }) => {
    return DutyManager.getInstance().getActiveShift(sessionId);
  });

  // ── Autonomous Mode Watchdog IPC
  ipcMain.handle('autonomous:toggle', async (_, { sessionId }: { sessionId: string }) => {
    return AutonomousWatchdog.getInstance().toggleAutonomousMode(sessionId);
  });

  // ── Native OS Clipboard Image & Text Copy
  ipcMain.handle('clipboard:copy-image', async (_, { imageUrl, filePath }: { imageUrl?: string; filePath?: string }) => {
    try {
      if (imageUrl && imageUrl.startsWith('data:image')) {
        const img = nativeImage.createFromDataURL(imageUrl);
        clipboard.writeImage(img);
        return true;
      }
      if (filePath && fs.existsSync(filePath)) {
        const img = nativeImage.createFromPath(filePath);
        clipboard.writeImage(img);
        return true;
      }
      if (imageUrl && !imageUrl.startsWith('data:image')) {
        const cleanPath = imageUrl.replace(/^file:\/\/\/?/, '');
        if (fs.existsSync(cleanPath)) {
          const img = nativeImage.createFromPath(cleanPath);
          clipboard.writeImage(img);
          return true;
        }
      }
      return false;
    } catch (err) {
      console.error('[clipboard:copy-image] Error:', err);
      return false;
    }
  });

  ipcMain.handle('clipboard:copy-text', async (_, { text }: { text: string }) => {
    try {
      if (typeof text === 'string') {
        clipboard.writeText(text);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[clipboard:copy-text] Error:', err);
      return false;
    }
  });

  // ── Free LLM Engine In-Process IPC Handlers
  ipcMain.handle('freellm:keys:list', async () => {
    return FreeLLMEngine.getInstance().listKeys();
  });

  ipcMain.handle('freellm:keys:add', async (_, data) => {
    return FreeLLMEngine.getInstance().addKey(data);
  });

  ipcMain.handle('freellm:keys:update', async (_, { id, data }) => {
    return FreeLLMEngine.getInstance().updateKey(id, data);
  });

  ipcMain.handle('freellm:keys:delete', async (_, { id }) => {
    return FreeLLMEngine.getInstance().deleteKey(id);
  });

  ipcMain.handle('freellm:keys:test', async (_, { id }) => {
    return FreeLLMEngine.getInstance().testKey(id);
  });

  ipcMain.handle('freellm:analytics:summary', async () => {
    return FreeLLMEngine.getInstance().getAnalyticsSummary();
  });

  ipcMain.handle('freellm:analytics:platforms', async () => {
    return FreeLLMEngine.getInstance().getPlatformStats();
  });

  ipcMain.handle('freellm:analytics:timeline', async (_, { days }) => {
    return FreeLLMEngine.getInstance().getTimeline(days);
  });

  ipcMain.handle('freellm:analytics:logs', async (_, { limit, offset }) => {
    return FreeLLMEngine.getInstance().getRequestLogs(limit, offset);
  });

  ipcMain.handle('freellm:models:list', async () => {
    return FreeLLMEngine.getInstance().getModelListing();
  });

  ipcMain.handle('freellm:fallback:list', async () => {
    return FreeLLMEngine.getInstance().getFallbackChain();
  });

  ipcMain.handle('freellm:fallback:update', async (_, { modelDbId, priority, enabled }) => {
    return FreeLLMEngine.getInstance().updateFallbackPriority(modelDbId, priority, enabled);
  });

  ipcMain.handle('freellm:fallback:reorder', async (_, { orderedModelDbIds }) => {
    return FreeLLMEngine.getInstance().reorderFallbackChain(orderedModelDbIds);
  });

  ipcMain.handle('freellm:strategy:get', async () => {
    return FreeLLMEngine.getInstance().getRoutingStrategy();
  });

  ipcMain.handle('freellm:strategy:set', async (_, { strategy }) => {
    FreeLLMEngine.getInstance().setRoutingStrategy(strategy);
    return true;
  });

  ipcMain.handle('freellm:unify:get', async () => {
    return FreeLLMEngine.getInstance().getModelUnification();
  });

  ipcMain.handle('freellm:unify:set', async (_, { enabled }) => {
    FreeLLMEngine.getInstance().setModelUnification(enabled);
    return true;
  });

  ipcMain.handle('freellm:playground:run', async (_, { prompt, model, temperature }) => {
    const startTime = Date.now();
    const resp = await FreeLLMEngine.getInstance().chatCompletion({
      model: model || 'auto',
      messages: [{ role: 'user', content: prompt }],
      temperature: temperature ?? 0.7,
      stream: false,
    });
    return {
      content: resp.choices?.[0]?.message?.content || '',
      reasoning: (resp.choices?.[0]?.message as any)?.reasoning_content || undefined,
      routedVia: resp._routed_via,
      latencyMs: Date.now() - startTime,
    };
  });

  ipcMain.handle('freellm:media:generate-image', async (_, { prompt, options }) => {
    return FreeLLMEngine.getInstance().generateImage(prompt, options);
  });
}



