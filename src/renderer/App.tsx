import React, { useState, useEffect } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { JulesPanel } from './components/layout/JulesPanel';
import { ChatStream } from './components/chat/ChatStream';
import { ChatInput } from './components/chat/ChatInput';
import { SettingsModal } from './components/settings/SettingsModal';
import type { AppSettings, ChatSession, AppMode, StreamTokenPayload, ToolCallPayload } from '@/shared/types';

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
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string>('');

  const [isJulesPanelOpen, setIsJulesPanelOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');

  // Load initial settings, models & sessions
  useEffect(() => {
    const init = async () => {
      try {
        const s = await window.electronAPI.getSettings();
        setSettings(s);

        const ws = await window.electronAPI.getWorkspaceInfo();
        if (ws) setWorkspaceName(ws.name);

        const models = await window.electronAPI.getAvailableModels();
        setAvailableModels(models);

        const sessList = await window.electronAPI.listSessions(s.activeWorkspacePath || undefined);
        setSessions(sessList);

        if (sessList.length > 0) {
          setActiveSessionId(sessList[0].id);
        } else {
          // Create initial session
          const newSess = await window.electronAPI.createSession('Initial Task', s.mode);
          setSessions([newSess]);
          setActiveSessionId(newSess.id);
        }
      } catch (err) {
        console.error('Initialization error:', err);
      }
    };

    init();
  }, []);

  // Listen for IPC streaming tokens and tool calls
  useEffect(() => {
    const unsubToken = window.electronAPI.onStreamToken((payload: StreamTokenPayload) => {
      if (payload.sessionId === activeSessionId) {
        setIsStreaming(true);
        setStreamingContent((prev) => prev + payload.delta);
      }
    });

    const unsubTool = window.electronAPI.onToolCallUpdate((payload: ToolCallPayload) => {
      if (payload.sessionId === activeSessionId) {
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== payload.sessionId) return s;
            const updatedMessages = [...s.messages];
            const lastMsg = updatedMessages[updatedMessages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              const existingTools = lastMsg.toolCalls || [];
              const idx = existingTools.findIndex((t) => t.id === payload.toolCall.id);
              if (idx !== -1) {
                existingTools[idx] = payload.toolCall;
              } else {
                existingTools.push(payload.toolCall);
              }
              lastMsg.toolCalls = existingTools;
            }
            return { ...s, messages: updatedMessages };
          })
        );
      }
    });

    const unsubCompleted = window.electronAPI.onExecutionCompleted((sessId: string) => {
      if (sessId === activeSessionId) {
        setIsStreaming(false);
        setStreamingContent('');
        // Refresh session messages
        window.electronAPI.listSessions().then((list: ChatSession[]) => setSessions(list));
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
    const selected = await window.electronAPI.selectDirectory();
    if (selected) {
      setSettings((prev) => ({ ...prev, activeWorkspacePath: selected }));
      const ws = await window.electronAPI.getWorkspaceInfo();
      if (ws) setWorkspaceName(ws.name);
      const list = await window.electronAPI.listSessions(selected);
      setSessions(list);
      if (list.length > 0) setActiveSessionId(list[0].id);
    }
  };

  const handleToggleMode = async (mode: AppMode) => {
    setSettings((prev) => ({ ...prev, mode }));
    await window.electronAPI.saveSettings({ mode });
    if (activeSession) {
      activeSession.mode = mode;
    }
  };

  const handleChangeModel = async (model: string, isAuto: boolean) => {
    setSettings((prev) => ({ ...prev, selectedModel: model, isAutoModel: isAuto }));
    await window.electronAPI.saveSettings({ selectedModel: model, isAutoModel: isAuto });
  };

  const handleCreateSession = async () => {
    const newSession = await window.electronAPI.createSession('New Task', settings.mode);
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  };

  const handleDeleteSession = async (id: string) => {
    await window.electronAPI.deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter((s) => s.id !== id);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!activeSessionId) return;

    // Optimistically add user message to local state
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

    await window.electronAPI.sendMessage(activeSessionId, text);
  };

  const handleCancelExecution = async () => {
    if (!activeSessionId) return;
    await window.electronAPI.cancelExecution(activeSessionId);
    setIsStreaming(false);
  };

  const handleSaveSettings = async (partial: Partial<AppSettings>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    await window.electronAPI.saveSettings(partial);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0d1117] text-[#c9d1d9] overflow-hidden font-sans">
      <Header
        settings={settings}
        availableModels={availableModels}
        workspaceName={workspaceName}
        onSelectWorkspace={handleSelectWorkspace}
        onToggleMode={handleToggleMode}
        onChangeModel={handleChangeModel}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isJulesPanelOpen={isJulesPanelOpen}
        onToggleJulesPanel={() => setIsJulesPanelOpen(!isJulesPanelOpen)}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
        />

        {/* Center Chat Feed */}
        <main className="flex-1 flex flex-col bg-[#0d1117] overflow-hidden">
          <ChatStream
            messages={activeSession?.messages || []}
            currentStreamContent={streamingContent}
            isStreaming={isStreaming}
            mode={settings.mode}
          />
          <ChatInput
            onSendMessage={handleSendMessage}
            onCancel={handleCancelExecution}
            isStreaming={isStreaming}
            mode={settings.mode}
            disabled={!activeSessionId}
          />
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
