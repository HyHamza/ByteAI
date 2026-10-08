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
  Bot
} from 'lucide-react';
import type { ChatSession } from '@/shared/types';

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  workspaceName: string;
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

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  workspaceName,
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
                  return (
                    <div
                      key={s.id}
                      onClick={() => onSelectSession(s.id)}
                      className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-[#202227] text-white font-medium'
                          : 'text-[#8e9196] hover:bg-[#1a1b1f] hover:text-[#d1d4dc]'
                      }`}
                    >
                      <span className="truncate flex-1 mr-2 text-[11.5px]">
                        {s.title || 'Conversation'}
                      </span>

                      <div className="flex items-center space-x-1 shrink-0">
                        <span className="text-[10px] text-[#5e616a] group-hover:hidden">
                          {timeStr}
                        </span>
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
