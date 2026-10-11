import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Plus, 
  History, 
  Clock, 
  Folder, 
  FolderOpen,
  ChevronDown, 
  ChevronRight, 
  SlidersHorizontal, 
  FolderPlus,
  Settings as SettingsIcon,
  Trash2,
  Copy,
  MoreVertical,
  Compass,
  X,
  ExternalLink,
  Check,
  GitBranch
} from 'lucide-react';
import type { ChatSession, JulesSessionSummary, TaskState, ProjectInfo } from '@/shared/types';
import { api } from '@/renderer/api';

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  workspaceName: string;
  runningAgentSessionIds: Set<string>;
  julesSessions: JulesSessionSummary[];
  projects?: ProjectInfo[];
  activeWorkspacePath?: string | null;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onCreateSessionInProject?: (folderPath: string, projectName: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onAddProject?: (folderPath?: string) => void;
  onDeleteProject?: (projectPath: string) => void;
  onOpenSettings: () => void;
  onSelectWorkspace: () => void;
}

const FOLDERS_STORAGE_KEY = 'seniorengineer:folders_expanded';

function loadFolderExpandedState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FOLDERS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveFolderExpandedState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function getSessionTaskState(
  s: ChatSession,
  runningAgentSessionIds: Set<string>,
  julesMap: Map<string, JulesSessionSummary>
): {
  state: TaskState;
  julesSession?: JulesSessionSummary;
} {
  // Respect user-specified or explicit task states (paused, completed, failed, cancelled)
  if (s.taskState === 'paused' || s.taskState === 'completed' || s.taskState === 'failed' || s.taskState === 'cancelled') {
    return { state: s.taskState };
  }

  // O(1) Fast lookup by explicit Jules session ID
  if (s.julesSessionId) {
    const matched = julesMap.get(s.julesSessionId);
    if (matched) {
      if (
        matched.state === 'AWAITING_USER_FEEDBACK' ||
        matched.state === 'AWAITING_USER_INPUT' ||
        matched.state === 'PAUSED'
      ) {
        return { state: 'awaiting_feedback', julesSession: matched };
      }
      if (
        matched.state === 'IN_PROGRESS' ||
        matched.state === 'PLANNING' ||
        matched.state === 'CODING' ||
        matched.state === 'INITIALIZING'
      ) {
        return { state: 'waiting_jules', julesSession: matched };
      }
      if (matched.state === 'COMPLETED' && !runningAgentSessionIds.has(s.id)) {
        return { state: 'completed', julesSession: matched };
      }
    }
  }

  if (runningAgentSessionIds.has(s.id)) {
    return { state: 'running_agent' };
  }

  if (s.taskState) {
    return { state: s.taskState };
  }

  return { state: 'idle' };
}

export const Sidebar: React.FC<SidebarProps> = React.memo(({
  sessions,
  activeSessionId,
  workspaceName,
  runningAgentSessionIds,
  julesSessions,
  projects = [],
  activeWorkspacePath,
  onSelectSession,
  onCreateSession,
  onCreateSessionInProject,
  onDeleteSession,
  onAddProject,
  onDeleteProject,
  onOpenSettings,
  onSelectWorkspace,
}) => {
  // Fast O(1) lookup map for Jules sessions
  const julesMap = useMemo(() => new Map(julesSessions.map((js) => [js.id, js])), [julesSessions]);

  // Folder expanded state: default is always open (true) unless explicitly set to false
  const [isProjectsExpanded, setIsProjectsExpanded] = useState<Record<string, boolean>>(() => loadFolderExpandedState());
  const [showAllFolders, setShowAllFolders] = useState<Record<string, boolean>>({});

  // Dropdown states
  const [isNewProjectMenuOpen, setIsNewProjectMenuOpen] = useState(false);
  const [activeContextMenuFolder, setActiveContextMenuFolder] = useState<string | null>(null);
  const [copiedFolder, setCopiedFolder] = useState<string | null>(null);

  // Project Settings Modal state
  const [settingsModalProject, setSettingsModalProject] = useState<{
    name: string;
    path: string;
    gitRepo?: string | null;
    gitBranch?: string | null;
  } | null>(null);

  const newProjectMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const isAnyMenuOpenRef = useRef(false);

  useEffect(() => {
    isAnyMenuOpenRef.current = isNewProjectMenuOpen || !!activeContextMenuFolder;
  }, [isNewProjectMenuOpen, activeContextMenuFolder]);

  // Close menus on outside click without triggering re-renders when menus are already closed
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (!isAnyMenuOpenRef.current) return;
      if (newProjectMenuRef.current && newProjectMenuRef.current.contains(e.target as Node)) {
        return;
      }
      if (contextMenuRef.current && contextMenuRef.current.contains(e.target as Node)) {
        return;
      }
      setIsNewProjectMenuOpen(false);
      setActiveContextMenuFolder(null);
      isAnyMenuOpenRef.current = false;
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, []);

  const toggleFolder = (folderName: string) => {
    setIsProjectsExpanded((prev) => {
      const current = prev[folderName] !== false; // default true if undefined
      const next = {
        ...prev,
        [folderName]: !current,
      };
      saveFolderExpandedState(next);
      return next;
    });
  };

  const toggleShowAll = (folderName: string) => {
    setShowAllFolders((prev) => ({
      ...prev,
      [folderName]: !prev[folderName],
    }));
  };

  // Group sessions by their workspace folder, ensuring current workspace and known projects are included
  const { groups, sortedFolderNames, folderPathMap } = useMemo(() => {
    const current = workspaceName || 'SeniorEngineer';
    const map: Record<string, ChatSession[]> = {
      [current]: [],
    };
    const pathMap: Record<string, string> = {};

    if (activeWorkspacePath) {
      pathMap[current] = activeWorkspacePath;
    }

    // Register paths from known projects
    for (const p of projects) {
      if (!map[p.name]) {
        map[p.name] = [];
      }
      pathMap[p.name] = p.path;
    }

    // Categorize sessions
    for (const s of sessions) {
      let folder = current;
      if (s.workspacePath) {
        const parts = s.workspacePath.replace(/\\/g, '/').split('/').filter(Boolean);
        if (parts.length > 0) {
          folder = parts[parts.length - 1];
        }
        if (!pathMap[folder]) {
          pathMap[folder] = s.workspacePath;
        }
      }
      if (!map[folder]) {
        map[folder] = [];
      }
      map[folder].push(s);
    }

    const sortedFolders = Object.keys(map).sort((a, b) => {
      if (a === current) return -1;
      if (b === current) return 1;
      return a.localeCompare(b);
    });

    return { groups: map, sortedFolderNames: sortedFolders, folderPathMap: pathMap };
  }, [sessions, workspaceName, projects, activeWorkspacePath]);

  // Keep folder containing the active session opened automatically
  useEffect(() => {
    if (!activeSessionId) return;
    for (const [folderName, fSessions] of Object.entries(groups)) {
      if (fSessions.some((s) => s.id === activeSessionId)) {
        if (isProjectsExpanded[folderName] === false) {
          setIsProjectsExpanded((prev) => {
            const next = { ...prev, [folderName]: true };
            saveFolderExpandedState(next);
            return next;
          });
        }
        break;
      }
    }
  }, [activeSessionId, groups]);

  const handleCopyProjectName = (folderName: string) => {
    navigator.clipboard.writeText(folderName);
    setCopiedFolder(folderName);
    setTimeout(() => setCopiedFolder(null), 1500);
    setActiveContextMenuFolder(null);
  };

  const handleShowInExplorer = async (folderName: string) => {
    const pathOnDisk = folderPathMap[folderName] || activeWorkspacePath || '';
    if (pathOnDisk) {
      await api.showInExplorer(pathOnDisk);
    }
    setActiveContextMenuFolder(null);
  };

  const handleCreateInProject = (folderName: string) => {
    const pathOnDisk = folderPathMap[folderName] || activeWorkspacePath || '';
    if (onCreateSessionInProject && pathOnDisk) {
      onCreateSessionInProject(pathOnDisk, folderName);
    } else {
      onCreateSession();
    }
    // Ensure folder is opened
    if (isProjectsExpanded[folderName] === false) {
      setIsProjectsExpanded((prev) => {
        const next = { ...prev, [folderName]: true };
        saveFolderExpandedState(next);
        return next;
      });
    }
  };

  const handleDeleteProjectClick = (folderName: string) => {
    const pathOnDisk = folderPathMap[folderName] || '';
    setActiveContextMenuFolder(null);
    if (window.confirm(`Are you sure you want to delete project "${folderName}" and its conversations?`)) {
      if (onDeleteProject && pathOnDisk) {
        onDeleteProject(pathOnDisk);
      }
    }
  };

  const handleOpenProjectSettings = (folderName: string) => {
    const pathOnDisk = folderPathMap[folderName] || activeWorkspacePath || '';
    const proj = projects.find((p) => p.name === folderName || p.path === pathOnDisk);
    setSettingsModalProject({
      name: folderName,
      path: pathOnDisk,
      gitRepo: proj?.gitRepo || null,
      gitBranch: proj?.gitBranch || null,
    });
    setActiveContextMenuFolder(null);
  };

  return (
    <>
      <aside className="w-72 bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] flex flex-col h-full shrink-0 select-none text-[13px] text-[var(--text-secondary)]">
        {/* Brand Header */}
        <div className="px-4 py-3 flex items-center space-x-2.5 border-b border-[var(--border-subtle)]">
          <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center p-1 shrink-0">
            <img src="/logo-bw.png" alt="Byte" className="w-full h-full object-contain select-none" />
          </div>
          <div className="flex items-center space-x-1.5 font-semibold text-sm text-[var(--text-primary)]">
            <span>Byte</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-neutral-300 font-normal">AI</span>
          </div>
        </div>

        {/* Top Action: + New Conversation */}
        <div className="p-3 pb-2">
          <button
            onClick={onCreateSession}
            className="w-full flex items-center space-x-2.5 py-2.5 px-3.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-primary)] rounded-xl border border-[var(--border-card)] transition-all text-[13px] font-medium shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[var(--text-secondary)]" />
            <span>New Conversation</span>
          </button>
        </div>

        {/* Navigation section: Conversation History & Scheduled Tasks */}
        <div className="px-2 py-1 space-y-0.5">
          <div className="flex items-center space-x-2.5 px-3 py-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer text-[13px]">
            <History className="w-4.5 h-4.5 text-[var(--text-secondary)]" />
            <span>Conversation History</span>
          </div>
          <div className="flex items-center space-x-2.5 px-3 py-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer text-[13px]">
            <Clock className="w-4.5 h-4.5 text-[var(--text-secondary)]" />
            <span>Scheduled Tasks</span>
          </div>
        </div>

        {/* Projects Section Header */}
        <div className="px-3.5 pt-3.5 pb-1 flex items-center justify-between text-[12px] font-semibold text-[var(--text-muted)] relative">
          <span>Projects</span>
          <div className="flex items-center space-x-1.5 text-[var(--text-muted)]">
            <button 
              className="p-1.5 hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-surface-hover)] transition-colors" 
              title="Sort / Filter"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>

            {/* FolderPlus dropdown trigger */}
            <div className="relative" ref={newProjectMenuRef}>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setIsNewProjectMenuOpen((prev) => !prev);
                }}
                className={`p-1 rounded transition-colors ${
                  isNewProjectMenuOpen 
                    ? 'text-[var(--text-primary)] bg-[var(--bg-surface-hover)]' 
                    : 'hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
                }`}
                title="Add or Open Project"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>

              {/* Antigravity-Style New Project Dropdown (Screenshot 2) */}
              {isNewProjectMenuOpen && (
                <div 
                  className="absolute right-0 top-7 z-50 bg-[var(--bg-surface-hover)] border border-[var(--border-card)] rounded-xl shadow-2xl py-1 text-xs min-w-[170px] animate-in fade-in zoom-in-95 duration-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => {
                      setIsNewProjectMenuOpen(false);
                      onAddProject?.();
                    }}
                    className="w-full flex items-center space-x-2.5 px-3 py-2 text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer text-left"
                  >
                    <FolderPlus className="w-4 h-4 text-[var(--text-secondary)]" />
                    <span>New Project</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsNewProjectMenuOpen(false);
                      onSelectWorkspace();
                    }}
                    className="w-full flex items-center space-x-2.5 px-3 py-2 text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer text-left"
                  >
                    <Compass className="w-4 h-4 text-[var(--text-secondary)]" />
                    <span>Quick Start</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Projects Folder Tree */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1.5">
          {sortedFolderNames.map((folderName) => {
            const folderSessions = groups[folderName] || [];
            const isExpanded = isProjectsExpanded[folderName] !== false;
            const isShowAll = !!showAllFolders[folderName];
            const visibleSessions = isShowAll ? folderSessions : folderSessions.slice(0, 6);
            const hasMore = folderSessions.length > 6;
            const isMenuOpen = activeContextMenuFolder === folderName;

            return (
              <div key={folderName} className="space-y-0.5 relative">
                {/* Project Header Row (Screenshot 3) */}
                <div
                  onClick={() => toggleFolder(folderName)}
                  className="group flex items-center justify-between px-3 py-2 rounded-lg text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer transition-colors font-medium text-[13px] relative"
                >
                  <div className="flex items-center space-x-2 truncate flex-1 mr-2">
                    {isExpanded ? (
                      <FolderOpen className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                    ) : (
                      <Folder className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                    )}
                    <span className="truncate">{folderName}</span>
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                    )}
                  </div>

                  {/* Right Action Icons: 3 Dots (⋮) and Plus Button ([+]) (Screenshot 3) */}
                  <div 
                    className="flex items-center space-x-1 shrink-0" 
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveContextMenuFolder(isMenuOpen ? null : folderName);
                      }}
                      className={`p-1 rounded transition-colors ${
                        isMenuOpen 
                          ? 'text-[var(--text-primary)] bg-[var(--bg-surface-hover)]' 
                          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
                      }`}
                      title="Project options"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateInProject(folderName);
                      }}
                      className="w-5.5 h-5.5 flex items-center justify-center rounded bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-card)] transition-all cursor-pointer shadow-sm"
                      title={`New conversation in ${folderName}`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Project Context Menu (Screenshot 4) */}
                {isMenuOpen && (
                  <div 
                    ref={contextMenuRef}
                    className="absolute right-2 top-8 z-50 bg-[var(--bg-surface-hover)] border border-[var(--border-card)] rounded-xl shadow-2xl py-1 text-xs min-w-[190px] animate-in fade-in zoom-in-95 duration-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => handleCopyProjectName(folderName)}
                      className="w-full flex items-center space-x-2.5 px-3 py-2 text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer text-left"
                    >
                      {copiedFolder === folderName ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4 text-[var(--text-secondary)]" />
                      )}
                      <span>{copiedFolder === folderName ? 'Copied!' : 'Copy Project Name'}</span>
                    </button>

                    <button
                      onClick={() => handleOpenProjectSettings(folderName)}
                      className="w-full flex items-center space-x-2.5 px-3 py-2 text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer text-left"
                    >
                      <SettingsIcon className="w-4 h-4 text-[var(--text-secondary)]" />
                      <span>Project Settings</span>
                    </button>

                    <button
                      onClick={() => handleShowInExplorer(folderName)}
                      className="w-full flex items-center space-x-2.5 px-3 py-2 text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer text-left"
                    >
                      {/* Windows Yellow Folder Icon as in Screenshot 4 */}
                      <Folder className="w-4 h-4 text-amber-400 fill-amber-400/30" />
                      <span>Show in File Explorer</span>
                    </button>

                    <div className="h-[1px] bg-[var(--bg-surface-hover)] my-1" />

                    <button
                      onClick={() => handleDeleteProjectClick(folderName)}
                      className="w-full flex items-center space-x-2.5 px-3 py-2 text-red-400 hover:bg-[var(--bg-surface-hover)] hover:text-red-300 transition-colors cursor-pointer text-left"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                      <span>Delete Project</span>
                    </button>
                  </div>
                )}

                {/* Sessions indented under project */}
                {isExpanded && (
                  <div className="pl-3.5 space-y-0.5 border-l border-[var(--border-subtle)] ml-4 my-1">
                    {folderSessions.length === 0 ? (
                      <div className="px-2 py-2 text-[12px] text-[var(--text-muted)] italic">
                        No conversations yet
                      </div>
                    ) : (
                      <>
                        {visibleSessions.map((s) => {
                          const isActive = s.id === activeSessionId;
                          const timeStr = formatRelativeTime(s.updatedAt || s.createdAt);
                          const taskInfo = getSessionTaskState(s, runningAgentSessionIds, julesMap);
                          const isAgentRunning = taskInfo.state === 'running_agent';
                          const isWaitingJules = taskInfo.state === 'waiting_jules';
                          const isFeedback = taskInfo.state === 'awaiting_feedback';
                          const isPaused = taskInfo.state === 'paused';
                          const isCompleted = taskInfo.state === 'completed';
                          const isFailed = taskInfo.state === 'failed';

                          let itemStyle = 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] border border-transparent';
                          if (isActive) {
                            itemStyle = 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)] font-medium border border-[var(--border-card)] shadow-sm';
                          }
                          if (isAgentRunning) {
                            itemStyle = isActive 
                              ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)] font-medium border border-cyan-500/50 shadow-sm shadow-cyan-950/30' 
                              : 'bg-[var(--bg-highlight)] text-cyan-200 hover:bg-[var(--bg-surface-hover)] border border-cyan-600/30';
                          } else if (isWaitingJules) {
                            itemStyle = isActive 
                              ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)] font-medium border border-purple-500/50 shadow-sm shadow-purple-950/30' 
                              : 'bg-[var(--bg-surface-hover)] text-purple-200 hover:bg-[var(--bg-surface-hover)] border border-purple-600/30';
                          } else if (isFeedback) {
                            itemStyle = isActive
                              ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)] font-medium border border-amber-500/50 shadow-sm shadow-amber-950/30'
                              : 'bg-[var(--bg-surface-hover)] text-amber-200 hover:bg-[var(--bg-surface-hover)] border border-amber-600/40';
                          } else if (isPaused) {
                            itemStyle = isActive
                              ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)] font-medium border border-amber-500/40 shadow-sm'
                              : 'bg-[var(--bg-surface-hover)] text-amber-300/80 hover:bg-[var(--bg-surface-hover)] border border-amber-600/30';
                          } else if (isCompleted) {
                            itemStyle = isActive
                              ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)] font-medium border border-emerald-500/40 shadow-sm'
                              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] border border-transparent';
                          }

                          return (
                            <div
                              key={s.id}
                              onClick={() => onSelectSession(s.id)}
                              className={`group relative flex items-center justify-between px-3 py-2 rounded-lg text-[13px] cursor-pointer transition-all overflow-hidden ${itemStyle}`}
                            >
                              <span className="truncate flex-1 mr-2 text-[12.5px] leading-snug">
                                {s.title || 'Conversation'}
                              </span>

                              <div className="flex items-center space-x-1.5 shrink-0">
                                {isAgentRunning ? (
                                  <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-700/60 text-[10px] font-semibold text-cyan-300">
                                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                                    <span>Running</span>
                                  </div>
                                ) : isWaitingJules ? (
                                  <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-purple-950/80 border border-purple-700/60 text-[10px] font-semibold text-purple-300">
                                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                                    <span>Jules</span>
                                  </div>
                                ) : isFeedback ? (
                                  <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-700/60 text-[10px] font-semibold text-amber-300">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" />
                                    <span>Needs Input</span>
                                  </div>
                                ) : isPaused ? (
                                  <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-950/70 border border-amber-600/50 text-[10px] font-semibold text-amber-300">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                    <span>Paused</span>
                                  </div>
                                ) : isCompleted ? (
                                  <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-600/40 text-[10px] font-semibold text-emerald-300">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                    <span>Done</span>
                                  </div>
                                ) : isFailed ? (
                                  <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-rose-950/70 border border-rose-600/50 text-[10px] font-semibold text-rose-300">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                                    <span>Failed</span>
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-[var(--text-muted)] group-hover:hidden">
                                    {timeStr}
                                  </span>
                                )}

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteSession(s.id);
                                  }}
                                  className="hidden group-hover:block text-[var(--text-muted)] hover:text-red-400 p-0.5 rounded transition-colors"
                                  title="Delete Conversation"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              {/* Antigravity Loading Bar: Agent Running */}
                              {isAgentRunning && (
                                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--bg-surface-hover)] overflow-hidden">
                                  <div className="h-full w-full bg-gradient-to-r from-transparent via-cyan-400 to-blue-500 animate-shimmer-fast" />
                                </div>
                              )}

                              {/* Antigravity Loading Bar: Waiting for Jules */}
                              {isWaitingJules && (
                                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--bg-surface)] overflow-hidden">
                                  <div className="h-full w-full bg-gradient-to-r from-transparent via-fuchsia-400 to-purple-500 animate-shimmer-medium" />
                                </div>
                              )}

                              {/* Antigravity Loading Bar: Jules Awaiting Direction */}
                              {isFeedback && (
                                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--bg-surface)] overflow-hidden">
                                  <div className="h-full w-full bg-amber-400 animate-pulse" />
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Antigravity-Style "See all (N)" / "Show less" (Screenshot 1) */}
                        {hasMore && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleShowAll(folderName);
                            }}
                            className="w-full text-left px-3 py-2 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] rounded-lg transition-colors cursor-pointer font-medium"
                          >
                            {isShowAll ? 'Show less' : `See all (${folderSessions.length})`}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Pinned Bottom: Settings */}
        <div className="p-2.5 border-t border-[var(--border-subtle)]">
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center space-x-2.5 px-3 py-2.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer text-[13px] font-medium"
          >
            <SettingsIcon className="w-4.5 h-4.5 text-[var(--text-secondary)]" />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      {/* Project Settings Modal */}
      {settingsModalProject && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setSettingsModalProject(null)}
        >
          <div 
            className="bg-[var(--bg-surface-hover)] border border-[var(--border-card)] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden text-[var(--text-primary)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-center space-x-2.5">
                <Folder className="w-4 h-4 text-[var(--text-secondary)]" />
                <h3 className="font-semibold text-sm">Project Settings</h3>
              </div>
              <button 
                onClick={() => setSettingsModalProject(null)}
                className="p-1 hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <label className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">
                  Project Name
                </label>
                <div className="px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-card)] text-[var(--text-primary)] font-medium">
                  {settingsModalProject.name}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">
                  Directory Path
                </label>
                <div className="px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-card)] font-mono text-[11px] text-[var(--text-muted)] break-all select-text">
                  {settingsModalProject.path || '(Not set)'}
                </div>
              </div>

              {settingsModalProject.gitRepo && (
                <div>
                  <label className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">
                    Git Repository
                  </label>
                  <div className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-card)] text-[#93c5fd]">
                    <GitBranch className="w-3.5 h-3.5 shrink-0 text-[#60a5fa]" />
                    <span className="truncate">{settingsModalProject.gitRepo}</span>
                    {settingsModalProject.gitBranch && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface-hover)] text-[#93c5fd]">
                        {settingsModalProject.gitBranch}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center justify-between border-t border-[var(--border-subtle)]">
                <button
                  onClick={() => {
                    if (settingsModalProject.path) {
                      api.showInExplorer(settingsModalProject.path);
                    }
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors cursor-pointer text-xs"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Show in File Explorer</span>
                </button>

                <button
                  onClick={() => setSettingsModalProject(null)}
                  className="px-4 py-1.5 rounded-lg bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-primary)] font-medium transition-colors cursor-pointer text-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
