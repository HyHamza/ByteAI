import React, { useState } from 'react';
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
  Sparkles,
  Bot,
  Loader2,
  Clock3
} from 'lucide-react';
import type { ChatSession, JulesSessionSummary, TaskState } from '@/shared/types';

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  workspaceName: string;
  runningAgentSessionIds: Set<string>;
  julesSessions: JulesSessionSummary[];
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  onSelectWorkspace: () => void;
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
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onOpenSettings,
  onSelectWorkspace,
}) => {
  const [isProjectsExpanded, setIsProjectsExpanded] = useState<Record<string, boolean>>({
    [workspaceName || 'Default']: true,
  });

  const toggleFolder = (folderName: string) => {
    setIsProjectsExpanded((prev) => ({
      ...prev,
      [folderName]: !prev[folderName],
    }));
  };

  const currentFolder = workspaceName || 'SeniorEngineer';

  return (
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
      <div className="px-3 pt-3 pb-1 flex items-center justify-between text-[11px] font-medium text-[#737680]">
        <span>Projects</span>
        <div className="flex items-center space-x-1.5 text-[#5e616a]">
          <button 
            className="p-1 hover:text-[#c4c7cf] rounded hover:bg-[#1c1d21] transition-colors" 
            title="Sort / Filter"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
          <button 
            onClick={onSelectWorkspace}
            className="p-1 hover:text-[#c4c7cf] rounded hover:bg-[#1c1d21] transition-colors" 
            title="Open Directory / Project"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Projects Folder Tree */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
        {/* Active Project Folder */}
        <div className="space-y-0.5">
          <div
            onClick={() => toggleFolder(currentFolder)}
            className="flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-[#c4c7cf] hover:bg-[#1c1d21] cursor-pointer transition-colors font-medium text-xs"
          >
            {isProjectsExpanded[currentFolder] ? (
              <FolderOpen className="w-3.5 h-3.5 text-[#8e9196]" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-[#8e9196]" />
            )}
            <span className="truncate flex-1">{currentFolder}</span>
            {isProjectsExpanded[currentFolder] ? (
              <ChevronDown className="w-3 h-3 text-[#5e616a]" />
            ) : (
              <ChevronRight className="w-3 h-3 text-[#5e616a]" />
            )}
          </div>

          {/* Sessions indented under active project */}
          {isProjectsExpanded[currentFolder] && (
            <div className="pl-4 space-y-0.5 border-l border-[#24262b] ml-4 my-1">
              {sessions.length === 0 ? (
                <div className="px-2 py-2 text-[11px] text-[#5e616a] italic">
                  No conversations yet
                </div>
              ) : (
                sessions.map((s) => {
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
                })
              )}
            </div>
          )}
        </div>
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
  );
};
