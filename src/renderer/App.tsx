import React, { useState, useEffect } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { JulesPanel } from './components/layout/JulesPanel';
import { ChatStream } from './components/chat/ChatStream';
import { ChatInput } from './components/chat/ChatInput';
import { SettingsModal } from './components/settings/SettingsModal';
import { api } from './api';
import type { AppSettings, ChatSession, AppMode, StreamTokenPayload, ToolCallPayload, ToolExecutionRecord } from '@/shared/types';

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
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string>('');
  const [gitRepo, setGitRepo] = useState<string | null>(null);
  const [gitBranch, setGitBranch] = useState<string | null>(null);

  const [isJulesPanelOpen, setIsJulesPanelOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingTools, setStreamingTools] = useState<ToolExecutionRecord[]>([]);

  // Load initial settings, workspace & sessions concurrently
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
      } catch (err) {
        console.error('Initialization error:', err);
      }
    };

    init();

    return () => {
      isMounted = false;
    };
  }, []);

  // Listen for IPC streaming tokens and tool calls
  useEffect(() => {
    const unsubToken = api.onStreamToken((payload: StreamTokenPayload) => {
      if (payload.sessionId === activeSessionId) {
        setIsStreaming(true);
        setStreamingContent((prev) => prev + payload.delta);
      }
    });

    const unsubTool = api.onToolCallUpdate((payload: ToolCallPayload) => {
      if (payload.sessionId === activeSessionId) {
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
        setStreamingContent('');
        setStreamingTools([]);
        api.listSessions().then((list: ChatSession[]) => setSessions(list));
      }
    });

    return () => {
      unsubToken();
      unsubTool();
      unsubCompleted();
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

  const handleCreateSession = async () => {
    const newSession = await api.createSession('New Task', settings.mode);
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  };

  const handleDeleteSession = async (id: string) => {
    await api.deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter((s) => s.id !== id);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!activeSessionId) return;

    const userMsg = {
      id: `temp_${Date.now()}`,
      sessionId: activeSessionId,
      role: 'user' as const,
      content: text,
      timestamp: Date.now(),
    };

    setSessions((prev) =>
      prev.map((s) => (s.id === activeSessionId ? { ...s, messages: [...s.messages, userMsg] } : s))
    );

    setIsStreaming(true);
    setStreamingContent('');
    setStreamingTools([]);

    await api.sendMessage(activeSessionId, text);
  };

  const handleCancelExecution = async () => {
    if (!activeSessionId) return;
    await api.cancelExecution(activeSessionId);
    setIsStreaming(false);
    setStreamingTools([]);
  };

  const handleSaveSettings = async (partial: Partial<AppSettings>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    await api.saveSettings(partial);
    try {
      const models = await api.getAvailableModels();
      if (models && models.length > 0) {
        setAvailableModels(models);
      }
    } catch (_) {}
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#131314] text-[#e3e3e3] overflow-hidden font-sans">
      <Header
        settings={settings}
        availableModels={availableModels}
        workspaceName={workspaceName}
        gitRepo={gitRepo}
        gitBranch={gitBranch}
        onSelectWorkspace={handleSelectWorkspace}
        onToggleMode={handleToggleMode}
        onChangeModel={handleChangeModel}
        onOpenSettings={() => setIsSettingsOpen(true)}
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
            onSelectSession={setActiveSessionId}
            onCreateSession={handleCreateSession}
            onDeleteSession={handleDeleteSession}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onSelectWorkspace={handleSelectWorkspace}
          />
        )}

        {/* Center Main Canvas */}
        <main className="flex-1 flex flex-col bg-[#131314] overflow-hidden relative">
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
              />
            </div>
          ) : (
            <>
              <ChatStream
                messages={activeSession?.messages || []}
                currentStreamContent={streamingContent}
                streamingTools={streamingTools}
                isStreaming={isStreaming}
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
      />
    </div>
  );
};

export default App;
