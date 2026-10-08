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
  julesSessions: JulesSessionSummary[]
): {
  state: TaskState;
  julesSession?: JulesSessionSummary;
} {
  if (runningAgentSessionIds.has(s.id)) {
    return { state: 'running_agent' };
  }

  // Find matching Jules session
  const matched = julesSessions.find((js) => {
    if (s.julesSessionId && s.julesSessionId === js.id) return true;
    if (s.title && js.title && s.title.trim().toLowerCase() === js.title.trim().toLowerCase()) return true;
    if (s.title && js.title && (s.title.includes(js.title.slice(0, 20)) || js.title.includes(s.title.slice(0, 20)))) return true;
    return s.messages?.some((m) => m.content && m.content.includes(js.id));
  });

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
    if (matched.state === 'COMPLETED') {
      return { state: 'completed', julesSession: matched };
    }
  }

  return { state: 'idle' };
}

export const Sidebar: React.FC<SidebarProps> = ({
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

  // Close menus on outside click
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (newProjectMenuRef.current && !newProjectMenuRef.current.contains(e.target as Node)) {
        setIsNewProjectMenuOpen(false);
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setActiveContextMenuFolder(null);
      }
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
      <aside className="w-64 bg-[#141517] border-r border-[#202226] flex flex-col h-full shrink-0 select-none text-[12px] text-[#8e9196]">
        {/* Top Action: + New Conversation */}
        <div className="p-3 pb-2">
          <button
            onClick={onCreateSession}
            className="w-full flex items-center space-x-2 py-2 px-3.5 bg-[#1e1f23] hover:bg-[#26282e] text-[#e3e5ec] rounded-xl border border-[#2b2d34] transition-all text-xs font-medium shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#8e9196]" />
            <span>New Conversation</span>
          </button>
        </div>

        {/* Navigation section: Conversation History & Scheduled Tasks */}
        <div className="px-2 py-1 space-y-0.5">
          <div className="flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-[#9da0a8] hover:bg-[#1c1d21] hover:text-[#e1e3ea] transition-colors cursor-pointer">
            <History className="w-4 h-4 text-[#757882]" />
            <span>Conversation History</span>
          </div>
          <div className="flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-[#9da0a8] hover:bg-[#1c1d21] hover:text-[#e1e3ea] transition-colors cursor-pointer">
            <Clock className="w-4 h-4 text-[#757882]" />
            <span>Scheduled Tasks</span>
          </div>
        </div>

        {/* Projects Section Header */}
        <div className="px-3 pt-3 pb-1 flex items-center justify-between text-[11px] font-medium text-[#737680] relative">
          <span>Projects</span>
          <div className="flex items-center space-x-1.5 text-[#5e616a]">
            <button 
              className="p-1 hover:text-[#c4c7cf] rounded hover:bg-[#1c1d21] transition-colors" 
              title="Sort / Filter"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
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
                    ? 'text-white bg-[#26282e]' 
                    : 'hover:text-[#c4c7cf] hover:bg-[#1c1d21]'
                }`}
                title="Add or Open Project"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>

              {/* Antigravity-Style New Project Dropdown (Screenshot 2) */}
              {isNewProjectMenuOpen && (
                <div 
                  className="absolute right-0 top-7 z-50 bg-[#1c1d21] border border-[#2c2e35] rounded-xl shadow-2xl py-1 text-xs min-w-[170px] animate-in fade-in zoom-in-95 duration-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => {
                      setIsNewProjectMenuOpen(false);
                      onAddProject?.();
                    }}
                    className="w-full flex items-center space-x-2.5 px-3 py-2 text-[#c4c7cf] hover:bg-[#26282e] hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <FolderPlus className="w-4 h-4 text-[#8e9196]" />
                    <span>New Project</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsNewProjectMenuOpen(false);
                      onSelectWorkspace();
                    }}
                    className="w-full flex items-center space-x-2.5 px-3 py-2 text-[#c4c7cf] hover:bg-[#26282e] hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <Compass className="w-4 h-4 text-[#8e9196]" />
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
                  className="group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[#c4c7cf] hover:bg-[#1c1d21] cursor-pointer transition-colors font-medium text-xs relative"
                >
                  <div className="flex items-center space-x-2 truncate flex-1 mr-2">
                    {isExpanded ? (
                      <FolderOpen className="w-3.5 h-3.5 text-[#8e9196] shrink-0" />
                    ) : (
                      <Folder className="w-3.5 h-3.5 text-[#8e9196] shrink-0" />
                    )}
                    <span className="truncate">{folderName}</span>
                    {isExpanded ? (
                      <ChevronDown className="w-3 h-3 text-[#5e616a] shrink-0" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-[#5e616a] shrink-0" />
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
                          ? 'text-white bg-[#282a30]' 
                          : 'text-[#6e727c] hover:text-[#e1e3ea] hover:bg-[#26282e]'
                      }`}
                      title="Project options"
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateInProject(folderName);
                      }}
                      className="w-5 h-5 flex items-center justify-center rounded bg-[#202227] hover:bg-[#2b2d35] text-[#8e9196] hover:text-[#e1e3ea] border border-[#2b2d34] transition-all cursor-pointer shadow-sm"
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
                    className="absolute right-2 top-8 z-50 bg-[#1c1d21] border border-[#2c2e35] rounded-xl shadow-2xl py-1 text-xs min-w-[190px] animate-in fade-in zoom-in-95 duration-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => handleCopyProjectName(folderName)}
                      className="w-full flex items-center space-x-2.5 px-3 py-2 text-[#c4c7cf] hover:bg-[#26282e] hover:text-white transition-colors cursor-pointer text-left"
                    >
                      {copiedFolder === folderName ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4 text-[#8e9196]" />
                      )}
                      <span>{copiedFolder === folderName ? 'Copied!' : 'Copy Project Name'}</span>
                    </button>

                    <button
                      onClick={() => handleOpenProjectSettings(folderName)}
                      className="w-full flex items-center space-x-2.5 px-3 py-2 text-[#c4c7cf] hover:bg-[#26282e] hover:text-white transition-colors cursor-pointer text-left"
                    >
                      <SettingsIcon className="w-4 h-4 text-[#8e9196]" />
                      <span>Project Settings</span>
                    </button>

                    <button
                      onClick={() => handleShowInExplorer(folderName)}
                      className="w-full flex items-center space-x-2.5 px-3 py-2 text-[#c4c7cf] hover:bg-[#26282e] hover:text-white transition-colors cursor-pointer text-left"
                    >
                      {/* Windows Yellow Folder Icon as in Screenshot 4 */}
                      <Folder className="w-4 h-4 text-amber-400 fill-amber-400/30" />
                      <span>Show in File Explorer</span>
                    </button>

                    <div className="h-[1px] bg-[#282a30] my-1" />

                    <button
                      onClick={() => handleDeleteProjectClick(folderName)}
                      className="w-full flex items-center space-x-2.5 px-3 py-2 text-red-400 hover:bg-[#26282e] hover:text-red-300 transition-colors cursor-pointer text-left"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                      <span>Delete Project</span>
                    </button>
                  </div>
                )}

                {/* Sessions indented under project */}
                {isExpanded && (
                  <div className="pl-4 space-y-0.5 border-l border-[#24262b] ml-4 my-1">
                    {folderSessions.length === 0 ? (
                      <div className="px-2 py-2 text-[11px] text-[#5e616a] italic">
                        No conversations yet
                      </div>
                    ) : (
                      <>
                        {visibleSessions.map((s) => {
                          const isActive = s.id === activeSessionId;
                          const timeStr = formatRelativeTime(s.updatedAt || s.createdAt);
                          const taskInfo = getSessionTaskState(s, runningAgentSessionIds, julesSessions);
                          const isAgentRunning = taskInfo.state === 'running_agent';
                          const isWaitingJules = taskInfo.state === 'waiting_jules';
                          const isFeedback = taskInfo.state === 'awaiting_feedback';

                          let itemStyle = 'text-[#8e9196] hover:bg-[#1a1b1f] hover:text-[#d1d4dc] border border-transparent';
                          if (isActive) {
                            itemStyle = 'bg-[#202227] text-white font-medium border border-[#2c2e35] shadow-sm';
                          }
                          if (isAgentRunning) {
                            itemStyle = isActive 
                              ? 'bg-[#14202e] text-white font-medium border border-cyan-500/50 shadow-sm shadow-cyan-950/30' 
                              : 'bg-[#101924] text-cyan-200 hover:bg-[#14202e] border border-cyan-600/30';
                          } else if (isWaitingJules) {
                            itemStyle = isActive 
                              ? 'bg-[#1f162e] text-white font-medium border border-purple-500/50 shadow-sm shadow-purple-950/30' 
                              : 'bg-[#191226] text-purple-200 hover:bg-[#1f162e] border border-purple-600/30';
                          } else if (isFeedback) {
                            itemStyle = isActive
                              ? 'bg-[#291e14] text-white font-medium border border-amber-500/50 shadow-sm shadow-amber-950/30'
                              : 'bg-[#20170f] text-amber-200 hover:bg-[#291e14] border border-amber-600/40';
                          }

                          return (
                            <div
                              key={s.id}
                              onClick={() => onSelectSession(s.id)}
                              className={`group relative flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-all overflow-hidden ${itemStyle}`}
                            >
                              <span className="truncate flex-1 mr-2 text-[11.5px]">
                                {s.title || 'Conversation'}
                              </span>

                              <div className="flex items-center space-x-1.5 shrink-0">
                                {isAgentRunning ? (
                                  <div className="flex items-center space-x-1 px-1.5 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-700/60 text-[9px] font-semibold text-cyan-300">
                                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                                    <span>Running</span>
                                  </div>
                                ) : isWaitingJules ? (
                                  <div className="flex items-center space-x-1 px-1.5 py-0.5 rounded-full bg-purple-950/80 border border-purple-700/60 text-[9px] font-semibold text-purple-300">
                                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                                    <span>Jules</span>
                                  </div>
                                ) : isFeedback ? (
                                  <div className="flex items-center space-x-1 px-1.5 py-0.5 rounded-full bg-amber-950/80 border border-amber-700/60 text-[9px] font-semibold text-amber-300">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" />
                                    <span>Needs Input</span>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-[#5e616a] group-hover:hidden">
                                    {timeStr}
                                  </span>
                                )}

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteSession(s.id);
                                  }}
                                  className="hidden group-hover:block text-[#5e616a] hover:text-red-400 p-0.5 rounded transition-colors"
                                  title="Delete Conversation"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>

                              {/* Antigravity Loading Bar: Agent Running */}
                              {isAgentRunning && (
                                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#121c27] overflow-hidden">
                                  <div className="h-full w-full bg-gradient-to-r from-transparent via-cyan-400 to-blue-500 animate-shimmer-fast" />
                                </div>
                              )}

                              {/* Antigravity Loading Bar: Waiting for Jules */}
                              {isWaitingJules && (
                                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#1a1226] overflow-hidden">
                                  <div className="h-full w-full bg-gradient-to-r from-transparent via-fuchsia-400 to-purple-500 animate-shimmer-medium" />
                                </div>
                              )}

                              {/* Antigravity Loading Bar: Jules Awaiting Direction */}
                              {isFeedback && (
                                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#24170d] overflow-hidden">
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
                            className="w-full text-left px-2.5 py-1.5 text-[11.5px] text-[#737680] hover:text-[#c4c7cf] hover:bg-[#1a1b1f] rounded-lg transition-colors cursor-pointer"
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
        <div className="p-2 border-t border-[#1e2024]">
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-[#8e9196] hover:bg-[#1c1d21] hover:text-[#e1e3ea] transition-colors cursor-pointer text-xs"
          >
            <SettingsIcon className="w-4 h-4 text-[#757882]" />
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
            className="bg-[#18191d] border border-[#2b2d35] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden text-[#e1e3ea]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#24262c]">
              <div className="flex items-center space-x-2.5">
                <Folder className="w-4 h-4 text-[#8e9196]" />
                <h3 className="font-semibold text-sm">Project Settings</h3>
              </div>
              <button 
                onClick={() => setSettingsModalProject(null)}
                className="p-1 hover:text-white rounded hover:bg-[#25272e] text-[#757882] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <label className="text-[11px] font-medium text-[#7d808b] uppercase tracking-wider block mb-1.5">
                  Project Name
                </label>
                <div className="px-3 py-2 rounded-lg bg-[#202227] border border-[#2c2e35] text-[#e3e5ec] font-medium">
                  {settingsModalProject.name}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-[#7d808b] uppercase tracking-wider block mb-1.5">
                  Directory Path
                </label>
                <div className="px-3 py-2 rounded-lg bg-[#202227] border border-[#2c2e35] font-mono text-[11px] text-[#a4a7b2] break-all select-text">
                  {settingsModalProject.path || '(Not set)'}
                </div>
              </div>

              {settingsModalProject.gitRepo && (
                <div>
                  <label className="text-[11px] font-medium text-[#7d808b] uppercase tracking-wider block mb-1.5">
                    Git Repository
                  </label>
                  <div className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-[#202227] border border-[#2c2e35] text-[#93c5fd]">
                    <GitBranch className="w-3.5 h-3.5 shrink-0 text-[#60a5fa]" />
                    <span className="truncate">{settingsModalProject.gitRepo}</span>
                    {settingsModalProject.gitBranch && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2b3547] text-[#93c5fd]">
                        {settingsModalProject.gitBranch}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center justify-between border-t border-[#24262c]">
                <button
                  onClick={() => {
                    if (settingsModalProject.path) {
                      api.showInExplorer(settingsModalProject.path);
                    }
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#22242a] hover:bg-[#2b2d35] text-[#c4c7cf] border border-[#2e3038] transition-colors cursor-pointer text-xs"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Show in File Explorer</span>
                </button>

                <button
                  onClick={() => setSettingsModalProject(null)}
                  className="px-4 py-1.5 rounded-lg bg-[#26282e] hover:bg-[#30333b] text-white font-medium transition-colors cursor-pointer text-xs"
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
};
