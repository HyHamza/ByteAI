import React, { useState, useEffect } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { JulesPanel } from './components/layout/JulesPanel';
import { ChatStream } from './components/chat/ChatStream';
import { ChatInput } from './components/chat/ChatInput';
import { SettingsModal } from './components/settings/SettingsModal';
import { api } from './api';
import type { AppSettings, ChatSession, ChatMessage, AppMode, StreamTokenPayload, ToolCallPayload, ToolExecutionRecord, JulesSessionSummary, ProjectInfo, AttachmentFile } from '@/shared/types';

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

export const App: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [availableModels, setAvailableModels] = useState<string[]>([
    'gpt-4o',
    'gpt-4o-mini',
    'claude-3-5-sonnet',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
  ]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string>('');
  const [gitRepo, setGitRepo] = useState<string | null>(null);
  const [gitBranch, setGitBranch] = useState<string | null>(null);

  // Background Task & Worker states
  const [runningAgentSessionIds, setRunningAgentSessionIds] = useState<Set<string>>(new Set());
  const [julesSessions, setJulesSessions] = useState<JulesSessionSummary[]>([]);

  const [isJulesPanelOpen, setIsJulesPanelOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingTools, setStreamingTools] = useState<ToolExecutionRecord[]>([]);
  const [retryStatus, setRetryStatus] = useState<{ attempt: number; maxRetries: number; delayMs: number; reason: string } | null>(null);

  // Load initial settings, workspace & sessions concurrently
  
  // Update body class based on theme
  useEffect(() => {
    if (settings.theme === 'whiteTheme') {
      document.body.classList.add('theme-white');
    } else {
      document.body.classList.remove('theme-white');
    }
  }, [settings.theme]);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        const [s, ws, sessList] = await Promise.all([
          api.getSettings().catch(() => DEFAULT_SETTINGS),
          api.getWorkspaceInfo().catch(() => null),
          api.listSessions().catch(() => []),
        ]);

        if (!isMounted) return;

        if (s) setSettings(s);
        if (ws) {
          setWorkspaceName(ws.name);
          if (ws.gitRepo) setGitRepo(ws.gitRepo);
          if (ws.gitBranch) setGitBranch(ws.gitBranch);
        }

        if (sessList && sessList.length > 0) {
          setSessions(sessList);
          setActiveSessionId(sessList[0].id);
        } else {
          const newSess = await api.createSession('Initial Task', s?.mode || 'standard');
          if (isMounted) {
            setSessions([newSess]);
            setActiveSessionId(newSess.id);
          }
        }

        // Fetch models non-blockingly
        api.getAvailableModels().then((models) => {
          if (isMounted && models && models.length > 0) {
            setAvailableModels(models);
          }
        }).catch(() => {});

        // Fetch active running agent sessions & Jules sessions
        api.getRunningSessions?.().then((ids) => {
          if (isMounted && ids) setRunningAgentSessionIds(new Set(ids));
        }).catch(() => {});

        api.getJulesSessions?.().then((jsList) => {
          if (isMounted && jsList) setJulesSessions(jsList);
        }).catch(() => {});

        api.getProjects?.().then((projs) => {
          if (isMounted && projs) setProjects(projs);
        }).catch(() => {});
      } catch (err) {
        console.error('Initialization error:', err);
      }
    };

    init();

    return () => {
      isMounted = false;
    };
  }, []);

  // Listen for IPC streaming tokens, tool calls, and background states
  useEffect(() => {
    const unsubToken = api.onStreamToken((payload: StreamTokenPayload) => {
      if (payload.sessionId === activeSessionId) {
        setIsStreaming(true);
        setRetryStatus(null);
        setStreamingContent((prev) => prev + payload.delta);
      }
    });

    const unsubRetry = api.onStreamRetry?.((payload) => {
      if (payload.sessionId === activeSessionId) {
        setRetryStatus({
          attempt: payload.attempt,
          maxRetries: payload.maxRetries,
          delayMs: payload.delayMs,
          reason: payload.reason,
        });
      }
    });

    const unsubTool = api.onToolCallUpdate((payload: ToolCallPayload) => {
      if (payload.sessionId === activeSessionId) {
        setRetryStatus(null);
        setStreamingTools((prev) => {
          const idx = prev.findIndex((t) => t.id === payload.toolCall.id);
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = payload.toolCall;
            return next;
          }
          return [...prev, payload.toolCall];
        });
      }
    });

    const unsubCompleted = api.onExecutionCompleted((sessId: string) => {
      if (sessId === activeSessionId) {
        setIsStreaming(false);
        setRetryStatus(null);
        setStreamingContent('');
        setStreamingTools([]);
        api.listSessions().then((list: ChatSession[]) => setSessions(list));
      }
    });

    const unsubTitle = api.onTitleUpdated?.(({ sessionId, title }) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title } : s))
      );
    });

    const unsubSessions = api.onSessionsUpdated?.((newList: ChatSession[]) => {
      setSessions(newList);
      setStreamingContent('');
      setStreamingTools([]);
    });

    const unsubAgent = api.onAgentStatus?.(({ sessionId, status }) => {
      setRunningAgentSessionIds((prev) => {
        const next = new Set(prev);
        if (status === 'running') next.add(sessionId);
        else next.delete(sessionId);
        return next;
      });
    });

    const unsubJulesAll = api.onJulesAllSessions?.((list) => {
      setJulesSessions(list);
    });

    const unsubJulesUpdate = api.onJulesUpdate?.((update) => {
      setJulesSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === update.id);
        if (idx !== -1) {
          const copy = [...prev];
          copy[idx] = update;
          return copy;
        }
        return [update, ...prev];
      });
    });

    return () => {
      unsubToken();
      unsubRetry?.();
      unsubTool();
      unsubCompleted();
      unsubTitle?.();
      unsubSessions?.();
      unsubAgent?.();
      unsubJulesAll?.();
      unsubJulesUpdate?.();
    };
  }, [activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const handleSelectWorkspace = async () => {
    const selected = await api.selectDirectory();
    if (selected) {
      setSettings((prev) => ({ ...prev, activeWorkspacePath: selected }));
      const ws = await api.getWorkspaceInfo();
      if (ws) {
        setWorkspaceName(ws.name);
        setGitRepo(ws.gitRepo || null);
        setGitBranch(ws.gitBranch || null);
      }
      const list = await api.listSessions(selected);
      setSessions(list);
      if (list.length > 0) setActiveSessionId(list[0].id);
    }
  };

  const handleToggleMode = async (mode: AppMode) => {
    setSettings((prev) => ({ ...prev, mode }));
    await api.saveSettings({ mode });
    if (activeSessionId) {
      await api.updateSession(activeSessionId, { mode });
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSessionId ? { ...s, mode } : s))
      );
    }
  };

  const handleChangeModel = async (model: string, isAuto: boolean) => {
    setSettings((prev) => ({ ...prev, selectedModel: model, isAutoModel: isAuto }));
    await api.saveSettings({ selectedModel: model, isAutoModel: isAuto });
  };

  const handleCreateSession = async (workspacePath?: string) => {
    const newSession = await api.createSession('New Task', settings.mode, workspacePath);
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  };

  const handleCreateSessionInProject = async (folderPath: string, projectName: string) => {
    const newSession = await api.createSession('New Conversation', settings.mode, folderPath);
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setWorkspaceName(projectName);
  };

  const handleAddProject = async (folderPath?: string) => {
    const proj = await api.addProject(folderPath);
    if (proj) {
      setProjects((prev) => {
        const filtered = prev.filter((p) => p.path !== proj.path);
        return [proj, ...filtered];
      });
      setWorkspaceName(proj.name);
      if (proj.gitRepo) setGitRepo(proj.gitRepo);
      if (proj.gitBranch) setGitBranch(proj.gitBranch);
      const newSession = await api.createSession('New Conversation', settings.mode, proj.path);
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
    }
  };

  const handleDeleteProject = async (projectPath: string) => {
    await api.deleteProject(projectPath);
    setProjects((prev) => prev.filter((p) => p.path !== projectPath));
    const refreshed = await api.listSessions();
    setSessions(refreshed);
    if (refreshed.length > 0) {
      setActiveSessionId(refreshed[0].id);
    } else {
      setActiveSessionId(null);
    }
  };

  const handleDeleteSession = async (id: string) => {
    await api.deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter((s) => s.id !== id);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const handleSendMessage = async (text: string, attachments?: AttachmentFile[]) => {
    if (!activeSessionId) return;

    const userMsg: ChatMessage = {
      id: `temp_${Date.now()}`,
      sessionId: activeSessionId,
      role: 'user' as const,
      content: text,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      timestamp: Date.now(),
    };

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const isGeneric = !s.title || 
          s.title === 'New Task' || 
          s.title === 'Initial Task' || 
          s.title === 'New Conversation' ||
          s.title.toLowerCase() === 'hi' ||
          s.title.toLowerCase() === 'hello' ||
          s.title.toLowerCase().startsWith('hello! how can i assist') ||
          s.title === 'Implement AI Chatbot';

        let newTitle = s.title;
        if (isGeneric) {
          const lower = text.trim().toLowerCase().replace(/[!.,?]/g, '');
          const isGreeting = ['hi', 'hello', 'hey', 'yo', 'sup', 'test'].includes(lower) || lower.length < 3;
          if (isGreeting) {
            newTitle = 'New Conversation';
          } else {
            const clean = text.replace(/[#*`_~\[\]]/g, '').split('\n')[0].trim();
            const shortTitle = clean.split(/\s+/).slice(0, 6).join(' ');
            newTitle = shortTitle.length > 36 ? shortTitle.slice(0, 36) + '...' : shortTitle;
          }
        }
        return { ...s, title: newTitle, messages: [...s.messages, userMsg] };
      })
    );

    setIsStreaming(true);
    setStreamingContent('');
    setStreamingTools([]);

    await api.sendMessage(activeSessionId, text, attachments);
  };

  const handleCancelExecution = async () => {
    if (!activeSessionId) return;
    await api.cancelExecution(activeSessionId);
    setIsStreaming(false);
    setStreamingTools([]);
  };

  const handleSaveSettings = async (partial: Partial<AppSettings>) => {
    await api.saveSettings(partial);
    const fresh = await api.getSettings();
    if (fresh) setSettings(fresh);
    try {
      const models = await api.getAvailableModels();
      if (models && models.length > 0) {
        setAvailableModels(models);
      }
    } catch (_) {}
  };

  const isCurrentAgentRunning = activeSessionId ? runningAgentSessionIds.has(activeSessionId) || isStreaming : false;

  const activeMatchedJules = activeSession ? julesSessions.find((js) => {
    if (activeSession.julesSessionId && activeSession.julesSessionId === js.id) return true;
    if (activeSession.title && js.title && activeSession.title.trim().toLowerCase() === js.title.trim().toLowerCase()) return true;
    if (activeSession.title && js.title && (activeSession.title.includes(js.title.slice(0, 20)) || js.title.includes(activeSession.title.slice(0, 20)))) return true;
    return activeSession.messages?.some((m) => m.content && m.content.includes(js.id));
  }) : undefined;

  const isCurrentWaitingJules = !isCurrentAgentRunning && !!activeMatchedJules && (
    activeMatchedJules.state === 'IN_PROGRESS' ||
    activeMatchedJules.state === 'PLANNING' ||
    activeMatchedJules.state === 'CODING' ||
    activeMatchedJules.state === 'INITIALIZING'
  );

  const isCurrentAwaitingFeedback = !isCurrentAgentRunning && !!activeMatchedJules && (
    activeMatchedJules.state === 'AWAITING_USER_FEEDBACK' ||
    activeMatchedJules.state === 'AWAITING_USER_INPUT' ||
    activeMatchedJules.state === 'PAUSED'
  );

  return (
    <div className="flex flex-col h-screen w-full bg-[var(--bg-canvas)] text-[var(--text-primary)] overflow-hidden font-sans">
      <Header
        settings={settings}
        availableModels={availableModels}
        workspaceName={workspaceName}
        gitRepo={gitRepo}
        gitBranch={gitBranch}
        onSelectWorkspace={handleSelectWorkspace}
        onToggleMode={handleToggleMode}
        onChangeModel={handleChangeModel}
        onOpenSettings={async () => {
          const fresh = await api.getSettings();
          if (fresh) setSettings(fresh);
          setIsSettingsOpen(true);
        }}
        isJulesPanelOpen={isJulesPanelOpen}
        onToggleJulesPanel={() => setIsJulesPanelOpen(!isJulesPanelOpen)}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        {isSidebarOpen && (
          <Sidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            workspaceName={workspaceName}
            runningAgentSessionIds={runningAgentSessionIds}
            julesSessions={julesSessions}
            projects={projects}
            activeWorkspacePath={settings.activeWorkspacePath}
            onSelectSession={setActiveSessionId}
            onCreateSession={() => handleCreateSession()}
            onCreateSessionInProject={handleCreateSessionInProject}
            onDeleteSession={handleDeleteSession}
            onAddProject={handleAddProject}
            onDeleteProject={handleDeleteProject}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onSelectWorkspace={handleSelectWorkspace}
          />
        )}

        {/* Center Main Canvas */}
        <main className="flex-1 flex flex-col bg-[var(--bg-canvas)] overflow-hidden relative">
          {/* Antigravity Loading & Activity Banner for Agent Running / Retrying */}
          {isCurrentAgentRunning && (
            <div className="shrink-0 z-10">
              {retryStatus ? (
                <>
                  <div className="w-full h-[2.5px] bg-[var(--bg-surface)] overflow-hidden">
                    <div className="h-full w-full bg-gradient-to-r from-transparent via-amber-400 to-orange-500 animate-shimmer-fast" />
                  </div>
                  <div className="px-5 py-2.5 bg-[var(--bg-card)] border-b border-[var(--border-highlight)] flex items-center justify-between text-xs text-[var(--text-secondary)]">
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div className="relative flex items-center justify-center shrink-0">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping absolute" />
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                      </div>
                      <div className="flex items-center space-x-2 truncate">
                        <span className="font-semibold text-amber-300">
                          Retrying Upstream Provider (Attempt {retryStatus.attempt} of {retryStatus.maxRetries})
                        </span>
                        <span className="text-amber-400/80 text-[11px] font-normal truncate">
                          • {retryStatus.reason} (Next attempt in {Math.round(retryStatus.delayMs / 1000)}s)
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={handleCancelExecution}
                      className="shrink-0 px-2.5 py-0.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)] text-amber-300 hover:text-[var(--text-primary)] text-[11px] rounded border border-[var(--border-card)] transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-full h-[2.5px] bg-[var(--bg-surface-hover)] overflow-hidden">
                    <div className="h-full w-full bg-gradient-to-r from-transparent via-cyan-400 to-blue-500 animate-shimmer-fast" />
                  </div>
                  <div className="px-5 py-2 bg-[var(--bg-highlight)] border-b border-[var(--border-highlight-blue)] flex items-center justify-between text-xs text-[var(--text-secondary)]">
                    <div className="flex items-center space-x-2.5">
                      <div className="relative flex items-center justify-center">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping absolute" />
                        <span className="w-2 h-2 rounded-full bg-cyan-400" />
                      </div>
                      <span className="font-semibold text-[var(--text-primary)]">Byte is running</span>
                      <span className="text-[var(--text-secondary)] text-[11px]">• Thinking & executing autonomous tools</span>
                    </div>
                    <button
                      onClick={handleCancelExecution}
                      className="px-2.5 py-0.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)] text-red-400 hover:text-red-300 text-[11px] rounded border border-[var(--border-card)] transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Antigravity Loading & Activity Banner for Waiting for Jules */}
          {isCurrentWaitingJules && (
            <div className="shrink-0 z-10">
              <div className="w-full h-[2.5px] bg-[var(--bg-surface)] overflow-hidden">
                <div className="h-full w-full bg-gradient-to-r from-transparent via-fuchsia-400 to-purple-500 animate-shimmer-medium" />
              </div>
              <div className="px-5 py-2 bg-[var(--bg-highlight-purple)] border-b border-[var(--border-highlight-purple)] flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <div className="flex items-center space-x-2.5">
                  <div className="relative flex items-center justify-center">
                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse absolute" />
                    <span className="w-2 h-2 rounded-full bg-purple-400" />
                  </div>
                  <span className="font-semibold text-[var(--text-primary)]">Waiting for Jules Worker</span>
                  <span className="text-[var(--text-secondary)] text-[11px]">• Task running remotely in Google Cloud (Byte supervising)</span>
                </div>
                {activeMatchedJules && (
                  <span className="text-[10px] font-mono text-[var(--text-secondary)] bg-[var(--bg-surface)] px-2 py-0.5 rounded border border-[var(--border-card)]">
                    Session: {activeMatchedJules.id.slice(0, 10)}...
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Antigravity Loading & Activity Banner for Jules Awaiting Direction */}
          {isCurrentAwaitingFeedback && (
            <div className="shrink-0 z-10">
              <div className="w-full h-[2.5px] bg-[var(--bg-surface)] overflow-hidden">
                <div className="h-full w-full bg-amber-400 animate-pulse" />
              </div>
              <div className="px-5 py-2 bg-[var(--bg-highlight-amber)] border-b border-[var(--border-highlight-amber)] flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <div className="flex items-center space-x-2.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                  <span className="font-semibold text-[var(--text-primary)]">Jules Worker Needs Direction</span>
                  <span className="text-[var(--text-secondary)] text-[11px]">• Byte is reviewing report / awaiting supervisor reply</span>
                </div>
                <span className="text-[10px] font-mono text-amber-300 bg-[var(--bg-surface)] px-2 py-0.5 rounded border border-[var(--border-card)]">
                  Needs Input
                </span>
              </div>
            </div>
          )}
          {(!activeSession || activeSession.messages.length === 0) && !isStreaming ? (
            <div className="flex-1 flex flex-col items-center justify-center p-4">
              <ChatInput
                onSendMessage={handleSendMessage}
                onCancel={handleCancelExecution}
                isStreaming={isStreaming}
                mode={activeSession?.mode || settings.mode}
                onToggleMode={handleToggleMode}
                availableModels={availableModels}
                selectedModel={settings.selectedModel}
                isAutoModel={settings.isAutoModel}
                onChangeModel={handleChangeModel}
                workspaceName={workspaceName}
                onSelectWorkspace={handleSelectWorkspace}
                disabled={!activeSessionId}
                isCenteredLayout={true}
                sessionId={activeSessionId || activeSession?.id}
              />
            </div>
          ) : (
            <>
              <ChatStream
                messages={activeSession?.messages || []}
                currentStreamContent={streamingContent}
                streamingTools={streamingTools}
                isStreaming={isStreaming}
                retryStatus={retryStatus}
                mode={activeSession?.mode || settings.mode}
              />
              <ChatInput
                onSendMessage={handleSendMessage}
                onCancel={handleCancelExecution}
                isStreaming={isStreaming}
                mode={activeSession?.mode || settings.mode}
                onToggleMode={handleToggleMode}
                availableModels={availableModels}
                selectedModel={settings.selectedModel}
                isAutoModel={settings.isAutoModel}
                onChangeModel={handleChangeModel}
                workspaceName={workspaceName}
                onSelectWorkspace={handleSelectWorkspace}
                disabled={!activeSessionId}
                isCenteredLayout={false}
                sessionId={activeSessionId || activeSession?.id}
              />
            </>
          )}
        </main>

        {/* Right Jules Mission Control Panel */}
        {isJulesPanelOpen && <JulesPanel onClose={() => setIsJulesPanelOpen(false)} />}
      </div>

      <SettingsModal
        settings={settings}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
        projects={projects}
        availableModels={availableModels}
        activeWorkspacePath={settings.activeWorkspacePath}
        onSelectProject={async (path) => {
          const ws = await api.getWorkspaceInfo();
          if (ws) {
            setWorkspaceName(ws.name);
            if (ws.gitRepo) setGitRepo(ws.gitRepo);
            if (ws.gitBranch) setGitBranch(ws.gitBranch);
          }
          const list = await api.listSessions(path);
          setSessions(list);
          if (list.length > 0) setActiveSessionId(list[0].id);
        }}
        onDeleteProject={handleDeleteProject}
        onAddProject={() => handleAddProject()}
      />
    </div>
  );
};

export default App;
