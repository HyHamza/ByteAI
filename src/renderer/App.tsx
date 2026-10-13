import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { JulesPanel } from './components/layout/JulesPanel';
import { ChatStream } from './components/chat/ChatStream';
import { ChatInput } from './components/chat/ChatInput';
import { SettingsModal } from './components/settings/SettingsModal';
import { FreeLLMHubModal } from './components/freellm/FreeLLMHubModal';
import { SplashScreen } from './components/common/SplashScreen';
import { api } from './api';
import type { AppSettings, ChatSession, ChatMessage, AppMode, TaskState, StreamTokenPayload, ToolCallPayload, ToolExecutionRecord, JulesSessionSummary, ProjectInfo, AttachmentFile, QueuedMessage, ActiveTaskItem } from '@/shared/types';

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
  const [isFreeLLMHubOpen, setIsFreeLLMHubOpen] = useState(false);

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [streamingTools, setStreamingTools] = useState<ToolExecutionRecord[]>([]);
  const [retryStatus, setRetryStatus] = useState<{ attempt: number; maxRetries: number; delayMs: number; reason: string } | null>(null);
  const [liveResolvedModel, setLiveResolvedModel] = useState<string | null>(null);

  // Queued Messages & Background Tasks state
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>(() => {
    try {
      const saved = localStorage.getItem('byte_queued_messages');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [runningBgTasks, setRunningBgTasks] = useState<ActiveTaskItem[]>([]);
  const isCancelledRef = useRef<boolean>(false);
  const isStreamingPrevRef = useRef<boolean>(false);
  const isDrainingQueueRef = useRef<boolean>(false);
  const queueDrainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSendMessageCallRef = useRef<{ text: string; time: number }>({ text: '', time: 0 });
  const agentIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Startup splash screen state
  const [isAppReady, setIsAppReady] = useState(false);
  const [splashStatusText, setSplashStatusText] = useState('Starting Byte AI...');

  // Update document element and body classes based on active theme
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    root.classList.remove('dark', 'light', 'theme-white', 'theme-contrast', 'theme-obsidian');
    body.classList.remove('dark', 'light', 'theme-white', 'theme-contrast', 'theme-obsidian');

    if (settings.theme === 'whiteTheme') {
      root.classList.add('light', 'theme-white');
      body.classList.add('light', 'theme-white');
    } else if (settings.theme === 'contrast') {
      root.classList.add('dark', 'theme-contrast');
      body.classList.add('dark', 'theme-contrast');
    } else {
      // Default Obsidian dark theme
      root.classList.add('dark', 'theme-obsidian');
      body.classList.add('dark', 'theme-obsidian');
    }
  }, [settings.theme]);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        setSplashStatusText('Connecting workspace & tools...');
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

        setSplashStatusText('Loading chat sessions & memory...');
        if (sessList && sessList.length > 0) {
          const firstId = sessList[0].id;
          setActiveSessionId(firstId);
          const fullFirst = await api.getSession?.(firstId).catch(() => null);
          if (isMounted) {
            setSessions(fullFirst ? sessList.map((x) => x.id === firstId ? fullFirst : x) : sessList);
          }
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

        setSplashStatusText('Ready');
        if (isMounted) setIsAppReady(true);
      } catch (err) {
        console.error('Initialization error:', err);
        if (isMounted) setIsAppReady(true);
      }
    };

    init();

    return () => {
      isMounted = false;
    };
  }, []);

  // Stable ref for activeSessionId to avoid re-subscribing IPC listeners on session switch
  const activeSessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Listen for IPC streaming tokens, tool calls, and background states
  useEffect(() => {
    let tokenBuffer = '';
    let tokenRaf: number | null = null;
    let reasoningBuffer = '';
    let reasoningRaf: number | null = null;

    const flushStreamBuffers = () => {
      if (tokenRaf) {
        cancelAnimationFrame(tokenRaf);
        tokenRaf = null;
      }
      if (tokenBuffer) {
        const chunk = tokenBuffer;
        tokenBuffer = '';
        setStreamingContent((prev) => prev + chunk);
      }
      if (reasoningRaf) {
        cancelAnimationFrame(reasoningRaf);
        reasoningRaf = null;
      }
      if (reasoningBuffer) {
        const chunk = reasoningBuffer;
        reasoningBuffer = '';
        setStreamingReasoning((prev) => prev + chunk);
      }
    };

    const unsubToken = api.onStreamToken((payload: StreamTokenPayload) => {
      if (payload.sessionId === activeSessionIdRef.current) {
        setIsStreaming(true);
        setRetryStatus(null);
        tokenBuffer += payload.delta;

        if (!tokenRaf) {
          tokenRaf = requestAnimationFrame(() => {
            tokenRaf = null;
            if (tokenBuffer) {
              const chunk = tokenBuffer;
              tokenBuffer = '';
              setStreamingContent((prev) => prev + chunk);
            }
          });
        }
      }
    });

    const unsubReasoning = api.onStreamReasoning?.((payload) => {
      if (payload.sessionId === activeSessionIdRef.current) {
        setIsStreaming(true);
        setRetryStatus(null);
        reasoningBuffer += payload.delta;

        if (!reasoningRaf) {
          reasoningRaf = requestAnimationFrame(() => {
            reasoningRaf = null;
            if (reasoningBuffer) {
              const chunk = reasoningBuffer;
              reasoningBuffer = '';
              setStreamingReasoning((prev) => prev + chunk);
            }
          });
        }
      }
    });

    const unsubRetry = api.onStreamRetry?.((payload) => {
      if (
        payload.sessionId === activeSessionIdRef.current &&
        !isCancelledRef.current &&
        runningAgentSessionIds.has(payload.sessionId)
      ) {
        setRetryStatus({
          attempt: payload.attempt,
          maxRetries: payload.maxRetries,
          delayMs: payload.delayMs,
          reason: payload.reason,
        });
      }
    });

    const unsubModelResolved = api.onModelResolved?.((payload) => {
      if (payload.sessionId === activeSessionIdRef.current) {
        setLiveResolvedModel(payload.model);
      }
    });

    const unsubTool = api.onToolCallUpdate((payload: ToolCallPayload) => {
      if (payload.sessionId === activeSessionIdRef.current) {
        flushStreamBuffers();
        setRetryStatus(null);
        // Step reasoning has finished for this step; clear live reasoning buffer so it doesn't linger
        reasoningBuffer = '';
        if (reasoningRaf) {
          cancelAnimationFrame(reasoningRaf);
          reasoningRaf = null;
        }
        setStreamingReasoning('');

        if (
          payload.toolCall.toolName === 'jules_continue_session' ||
          payload.toolCall.toolName === 'jules_create_task' ||
          payload.toolCall.toolName === 'jules_reply_question'
        ) {
          setIsStreaming(false);
        }
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

    const unsubCompleted = api.onExecutionCompleted(async (sessId: string) => {
      if (sessId === activeSessionIdRef.current) {
        if (agentIdleTimeoutRef.current) {
          clearTimeout(agentIdleTimeoutRef.current);
          agentIdleTimeoutRef.current = null;
        }
        flushStreamBuffers();
        setRetryStatus(null);
        try {
          const fullSess = await api.getSession?.(sessId);
          if (fullSess) {
            setSessions((prev) => prev.map((s) => (s.id === sessId ? fullSess : s)));
          }
        } catch (_) {}
        setIsStreaming(false);
        setStreamingContent('');
        setStreamingReasoning('');
        setStreamingTools([]);
        setLiveResolvedModel(null);
      }
    });

    const unsubClear = api.onStreamClear?.((sessId: string) => {
      if (sessId === activeSessionIdRef.current) {
        tokenBuffer = '';
        if (tokenRaf) {
          cancelAnimationFrame(tokenRaf);
          tokenRaf = null;
        }
        reasoningBuffer = '';
        if (reasoningRaf) {
          cancelAnimationFrame(reasoningRaf);
          reasoningRaf = null;
        }
        setStreamingContent('');
        setStreamingReasoning('');
      }
    });

    const unsubTitle = api.onTitleUpdated?.(({ sessionId, title }) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title } : s))
      );
    });

    const unsubSessions = api.onSessionsUpdated?.((newList: ChatSession[]) => {
      setSessions((prev) => {
        return newList.map((ns) => {
          const old = prev.find((p) => p.id === ns.id);
          if (old && old.messages && old.messages.length > 0 && (!ns.messages || ns.messages.length === 0)) {
            return { ...ns, messages: old.messages };
          }
          if (ns.messages && ns.messages.length > 1) {
            const deduped: ChatMessage[] = [];
            for (let i = 0; i < ns.messages.length; i++) {
              const m = ns.messages[i];
              const prevM = deduped[deduped.length - 1];
              if (
                prevM &&
                prevM.role === m.role &&
                prevM.content === m.content &&
                Math.abs(prevM.timestamp - m.timestamp) < 500
              ) {
                continue;
              }
              deduped.push(m);
            }
            return { ...ns, messages: deduped };
          }
          return ns;
        });
      });
    });

    const unsubAgent = api.onAgentStatus?.(({ sessionId, status }) => {
      setRunningAgentSessionIds((prev) => {
        const next = new Set(prev);
        if (status === 'running') next.add(sessionId);
        else next.delete(sessionId);
        return next;
      });
      if (sessionId === activeSessionIdRef.current) {
        if (status === 'running') {
          if (agentIdleTimeoutRef.current) {
            clearTimeout(agentIdleTimeoutRef.current);
            agentIdleTimeoutRef.current = null;
          }
          flushStreamBuffers();
          setIsStreaming(true);
          setStreamingContent('');
          setStreamingReasoning('');
          setStreamingTools([]);
          setRetryStatus(null);
          api.getSession?.(sessionId).then((full) => {
            if (full) {
              setSessions((prev) => prev.map((s) => (s.id === sessionId ? full : s)));
            }
          }).catch(() => {});
        } else {
          flushStreamBuffers();
          if (agentIdleTimeoutRef.current) {
            clearTimeout(agentIdleTimeoutRef.current);
          }
          agentIdleTimeoutRef.current = setTimeout(() => {
            agentIdleTimeoutRef.current = null;
            if (activeSessionIdRef.current === sessionId && !isDrainingQueueRef.current) {
              setIsStreaming(false);
            }
          }, 400);
        }
      }
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

    const unsubAutonomous = api.onAutonomousModeUpdated?.(({ sessionId, enabled }) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, autonomousMode: enabled } : s))
      );
    });

    return () => {
      flushStreamBuffers();
      unsubToken();
      unsubReasoning?.();
      unsubRetry?.();
      unsubModelResolved?.();
      unsubTool();
      unsubCompleted();
      unsubClear?.();
      unsubTitle?.();
      unsubSessions?.();
      unsubAgent?.();
      unsubJulesAll?.();
      unsubJulesUpdate?.();
      unsubAutonomous?.();
    };
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Automatically synchronize workspace name, git repo, and branch whenever the active session changes
  useEffect(() => {
    if (!activeSession) return;
    const wsPath = activeSession.workspacePath;
    if (!wsPath) return;

    // Fast synchronous lookup from known projects
    const proj = projects.find((p) => p.path === wsPath);
    if (proj) {
      setWorkspaceName(proj.name);
      setGitRepo(proj.gitRepo || null);
      setGitBranch(proj.gitBranch || null);
    } else {
      const folderName = wsPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace';
      setWorkspaceName(folderName);
    }

    // Refresh live git metadata for this workspace folder
    api.getWorkspaceInfo(wsPath).then((ws) => {
      if (ws) {
        setWorkspaceName(ws.name);
        setGitRepo(ws.gitRepo || null);
        setGitBranch(ws.gitBranch || null);
      }
    }).catch(() => {});
  }, [activeSession?.id, activeSession?.workspacePath, projects]);

  const handleSelectWorkspace = async () => {
    const selected = await api.selectDirectory();
    if (selected) {
      setSettings((prev) => ({ ...prev, activeWorkspacePath: selected }));
      const ws = await api.getWorkspaceInfo(selected);
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

  const handleToggleAutonomousMode = async () => {
    if (!activeSessionId) return;
    try {
      const newState = await api.toggleAutonomousMode?.(activeSessionId);
      if (typeof newState === 'boolean') {
        setSessions((prev) =>
          prev.map((s) => (s.id === activeSessionId ? { ...s, autonomousMode: newState } : s))
        );
      }
    } catch (err) {
      console.error('Failed to toggle autonomous mode:', err);
    }
  };

  const handleUpdateTaskState = async (state: TaskState) => {
    if (!activeSessionId) return;
    try {
      await api.updateSession(activeSessionId, { taskState: state });
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSessionId ? { ...s, taskState: state } : s))
      );
    } catch (err) {
      console.error('Failed to update task state:', err);
    }
  };

  const handleChangeModel = async (model: string, isAuto: boolean) => {
    setSettings((prev) => ({ ...prev, selectedModel: model, isAutoModel: isAuto }));
    await api.saveSettings({ selectedModel: model, isAutoModel: isAuto });
  };

  const resetLiveStreamingState = () => {
    setRetryStatus(null);
    setIsStreaming(false);
    setStreamingContent('');
    setStreamingReasoning('');
    setStreamingTools([]);
  };

  const handleCreateSession = async (workspacePath?: string) => {
    resetLiveStreamingState();
    const targetPath = workspacePath || activeSession?.workspacePath || settings.activeWorkspacePath || undefined;
    const newSession = await api.createSession('New Task', settings.mode, targetPath);
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  };

  const handleCreateSessionInProject = async (folderPath: string, projectName: string) => {
    resetLiveStreamingState();
    const newSession = await api.createSession('New Conversation', settings.mode, folderPath);
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setWorkspaceName(projectName);
    api.getWorkspaceInfo(folderPath).then((ws) => {
      if (ws) {
        setGitRepo(ws.gitRepo || null);
        setGitBranch(ws.gitBranch || null);
      }
    }).catch(() => {});
  };

  const handleAddProject = async (folderPath?: string) => {
    const proj = await api.addProject(folderPath);
    if (proj) {
      resetLiveStreamingState();
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
    resetLiveStreamingState();
    await api.deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter((s) => s.id !== id);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const handleSelectSession = async (id: string) => {
    resetLiveStreamingState();
    setActiveSessionId(id);
    if (runningAgentSessionIds.has(id)) {
      setIsStreaming(true);
    }
    const existing = sessions.find((s) => s.id === id);
    if (!existing || !existing.messages || existing.messages.length === 0) {
      try {
        const full = await api.getSession?.(id);
        if (full) {
          setSessions((prev) => prev.map((s) => (s.id === id ? full : s)));
        }
      } catch (_) {}
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
        // Suppress optimistic duplicate if last message is an identical user message within 2s
        const lastMsg = s.messages[s.messages.length - 1];
        if (
          lastMsg &&
          lastMsg.role === 'user' &&
          lastMsg.content === text &&
          Date.now() - lastMsg.timestamp < 2000
        ) {
          return s;
        }

        return { ...s, title: newTitle, messages: [...s.messages, userMsg] };
      })
    );

    // Guard against rapid duplicate sendMessage calls (within 1000ms)
    const now = Date.now();
    if (
      lastSendMessageCallRef.current.text === text &&
      now - lastSendMessageCallRef.current.time < 1000
    ) {
      console.warn('[App] Suppressed rapid duplicate sendMessage call within 1000ms:', text);
      return;
    }
    lastSendMessageCallRef.current = { text, time: now };

    // Clear any pending idle timeouts
    if (agentIdleTimeoutRef.current) {
      clearTimeout(agentIdleTimeoutRef.current);
      agentIdleTimeoutRef.current = null;
    }

    isCancelledRef.current = false;
    setRetryStatus(null);
    setIsStreaming(true);
    setStreamingContent('');
    setStreamingReasoning('');
    setStreamingTools([]);

    await api.sendMessage(activeSessionId, text, attachments);
  };

  const handleQueueMessage = (text: string, attachments?: AttachmentFile[]) => {
    if (!activeSessionId) return;
    setQueuedMessages((prev) => {
      // Don't add duplicate if the last message in this session's queue has identical text
      const sessionQueue = prev.filter((q) => q.sessionId === activeSessionId);
      const lastQ = sessionQueue[sessionQueue.length - 1];
      if (lastQ && lastQ.text === text && Date.now() - lastQ.createdAt < 1500) {
        return prev;
      }
      const newQueued: QueuedMessage = {
        id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        sessionId: activeSessionId,
        text,
        attachments,
        createdAt: Date.now(),
      };
      return [...prev, newQueued];
    });
  };

  const handleRemoveQueuedMessage = (id: string) => {
    setQueuedMessages((prev) => prev.filter((q) => q.id !== id));
  };

  const handleCancelExecution = async () => {
    if (!activeSessionId) return;
    const targetSessionId = activeSessionId;
    isCancelledRef.current = true;
    if (queueDrainTimerRef.current) {
      clearTimeout(queueDrainTimerRef.current);
      queueDrainTimerRef.current = null;
    }
    isDrainingQueueRef.current = false;
    resetLiveStreamingState();
    setRunningAgentSessionIds((prev) => {
      const next = new Set(prev);
      next.delete(targetSessionId);
      return next;
    });
    await api.cancelExecution(targetSessionId);
  };

  // Persist queued messages across reloads
  useEffect(() => {
    try {
      localStorage.setItem('byte_queued_messages', JSON.stringify(queuedMessages));
    } catch {}
  }, [queuedMessages]);

  // Poll active background tasks from TaskManager
  useEffect(() => {
    let isMounted = true;
    const checkBgTasks = async () => {
      try {
        if (api.getRunningTasks) {
          const tasks = await api.getRunningTasks(activeSessionId || undefined);
          if (isMounted && Array.isArray(tasks)) {
            setRunningBgTasks(
              tasks.map((t: any) => ({
                id: t.taskId || t.id,
                taskId: t.taskId || t.id,
                label: t.command || 'Background task',
                command: t.command,
                cwd: t.cwd,
                status: t.status || 'running',
                startTime: t.startTime,
              }))
            );
          }
        }
      } catch {}
    };

    checkBgTasks();
    const interval = setInterval(checkBgTasks, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [activeSessionId, isStreaming]);

  // Auto-dequeue: When agent finishes execution (isStreaming turns false), auto-send next queued message
  useEffect(() => {
    const wasStreaming = isStreamingPrevRef.current;
    isStreamingPrevRef.current = isStreaming;

    if (wasStreaming && !isStreaming && activeSessionId) {
      if (isCancelledRef.current) {
        isCancelledRef.current = false;
        return;
      }

      if (isDrainingQueueRef.current) return;

      const sessionQueue = queuedMessages.filter((q) => q.sessionId === activeSessionId);
      if (sessionQueue.length === 0) return;

      const nextMsg = sessionQueue[0];
      // Atomically mark draining and immediately remove from queue
      isDrainingQueueRef.current = true;
      setQueuedMessages((prev) => prev.filter((q) => q.id !== nextMsg.id));

      if (queueDrainTimerRef.current) clearTimeout(queueDrainTimerRef.current);
      queueDrainTimerRef.current = setTimeout(() => {
        isDrainingQueueRef.current = false;
        if (activeSessionIdRef.current === nextMsg.sessionId) {
          handleSendMessage(nextMsg.text, nextMsg.attachments);
        }
      }, 400);
    }
  }, [isStreaming, activeSessionId, queuedMessages]);

  // Active running tasks for the active session (streaming tools + background tasks)
  const activeTasks = useMemo<ActiveTaskItem[]>(() => {
    const tasks: ActiveTaskItem[] = [];
    for (const t of streamingTools) {
      if (t.status === 'running' || t.status === 'pending') {
        const cmd = t.args?.command || t.args?.CommandLine || '';
        const label = cmd || t.intent || (t.args?.path ? `${t.toolName} ${t.args.path}` : t.toolName);
        tasks.push({
          id: t.id,
          label,
          command: cmd,
          toolName: t.toolName,
          status: t.status,
          cwd: t.args?.cwd || t.args?.Cwd,
          output: t.output,
          startTime: t.startedAt,
        });
      }
    }
    for (const bt of runningBgTasks) {
      if (!tasks.some((t) => t.id === bt.taskId || t.taskId === bt.taskId)) {
        tasks.push(bt);
      }
    }
    return tasks;
  }, [streamingTools, runningBgTasks]);

  // Queued messages filtered for the currently active session
  const activeSessionQueuedMessages = useMemo(() => {
    if (!activeSessionId) return [];
    return queuedMessages.filter((q) => q.sessionId === activeSessionId);
  }, [queuedMessages, activeSessionId]);

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

  const isGenericTitle = (t?: string) => {
    if (!t) return true;
    const clean = t.trim().toLowerCase();
    return clean === 'new task' || clean === 'new conversation' || clean === 'initial task' || clean === 'untitled';
  };

  const activeMatchedJules = useMemo(() => {
    if (!activeSession) return undefined;
    // 1. Explicit link on session
    if (activeSession.julesSessionId) {
      return julesSessions.find((js) => js.id === activeSession.julesSessionId);
    }
    // 2. Referenced in messages or matched by specific non-generic title (only if session has substantive history)
    if (!activeSession.messages || activeSession.messages.length === 0) return undefined;
    return julesSessions.find((js) => {
      if (activeSession.messages.some((m) => {
        if (m.content && m.content.includes(js.id)) return true;
        if (m.toolCalls?.some((tc) => {
          if (tc.id === js.id) return true;
          if (tc.args?.session_id === js.id) return true;
          if (typeof tc.output === 'string' && tc.output.includes(js.id)) return true;
          return false;
        })) return true;
        return false;
      })) return true;
      if (activeSession.title && js.title && !isGenericTitle(activeSession.title) && !isGenericTitle(js.title)) {
        if (activeSession.title.trim().toLowerCase() === js.title.trim().toLowerCase()) return true;
        if (activeSession.title.includes(js.title.slice(0, 20)) || js.title.includes(activeSession.title.slice(0, 20))) return true;
      }
      return false;
    });
  }, [activeSession?.id, activeSession?.julesSessionId, activeSession?.title, activeSession?.messages?.length, julesSessions]);

  const isCurrentWaitingJules = !!activeMatchedJules && (
    activeMatchedJules.state === 'IN_PROGRESS' ||
    activeMatchedJules.state === 'PLANNING' ||
    activeMatchedJules.state === 'CODING' ||
    activeMatchedJules.state === 'INITIALIZING'
  );

  const isCurrentAwaitingFeedback = !isCurrentWaitingJules && !!activeMatchedJules && (
    activeMatchedJules.state === 'AWAITING_USER_FEEDBACK' ||
    activeMatchedJules.state === 'AWAITING_USER_INPUT' ||
    activeMatchedJules.state === 'PAUSED'
  );

  const isCurrentAgentRunning = !isCurrentWaitingJules && (
    activeSessionId ? (runningAgentSessionIds.has(activeSessionId) || isStreaming) : false
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
        isAutonomousMode={Boolean(activeSession?.autonomousMode)}
        onToggleAutonomousMode={handleToggleAutonomousMode}
        activeSession={activeSession}
        onUpdateTaskState={handleUpdateTaskState}
        onOpenFreeLLMHub={() => setIsFreeLLMHubOpen(true)}
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
            onSelectSession={handleSelectSession}
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
                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping absolute" />
                    <span className="w-2 h-2 rounded-full bg-purple-400" />
                  </div>
                  <span className="font-semibold text-purple-200">Jules is running in Google Cloud</span>
                  <span className="text-[var(--text-secondary)] text-[11px]">
                    • {activeMatchedJules?.state === 'PLANNING'
                        ? 'Formulating implementation plan'
                        : activeMatchedJules?.state === 'CODING'
                        ? 'Writing code & committing changes'
                        : activeMatchedJules?.state === 'INITIALIZING'
                        ? 'Initializing cloud VM & workspace'
                        : 'Working autonomously in cloud VM'} (Byte supervising)
                  </span>
                </div>
                {activeMatchedJules && (
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-semibold text-purple-300 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-800/50">
                      {activeMatchedJules.state}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)] bg-[var(--bg-surface)] px-2 py-0.5 rounded border border-[var(--border-card)]">
                      Session: {activeMatchedJules.id.slice(0, 10)}...
                    </span>
                  </div>
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
                isAutonomousMode={Boolean(activeSession?.autonomousMode)}
                onToggleAutonomousMode={handleToggleAutonomousMode}
                taskState={activeSession?.taskState}
                onUpdateTaskState={handleUpdateTaskState}
                queuedMessages={activeSessionQueuedMessages}
                onQueueMessage={handleQueueMessage}
                onRemoveQueuedMessage={handleRemoveQueuedMessage}
                queuedMessageMode={settings.queuedMessages || 'queue'}
                activeTasks={activeTasks}
              />
            </div>
          ) : (
            <>
              <ChatStream
                messages={activeSession?.messages || []}
                currentStreamContent={streamingContent}
                streamingReasoning={streamingReasoning}
                streamingTools={streamingTools}
                isStreaming={isStreaming}
                retryStatus={retryStatus}
                mode={activeSession?.mode || settings.mode}
                selectedModel={settings.selectedModel}
                liveResolvedModel={liveResolvedModel}
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
                isAutonomousMode={Boolean(activeSession?.autonomousMode)}
                onToggleAutonomousMode={handleToggleAutonomousMode}
                taskState={activeSession?.taskState}
                onUpdateTaskState={handleUpdateTaskState}
                queuedMessages={activeSessionQueuedMessages}
                onQueueMessage={handleQueueMessage}
                onRemoveQueuedMessage={handleRemoveQueuedMessage}
                queuedMessageMode={settings.queuedMessages || 'queue'}
                activeTasks={activeTasks}
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
        onOpenFreeLLMHub={() => setIsFreeLLMHubOpen(true)}
      />

      <FreeLLMHubModal
        isOpen={isFreeLLMHubOpen}
        onClose={() => setIsFreeLLMHubOpen(false)}
      />

      {/* Startup Splash Screen */}
      <SplashScreen isReady={isAppReady} statusText={splashStatusText} />
    </div>
  );
};

export default App;
