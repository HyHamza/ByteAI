import React from 'react';
import { Plus, MessageSquare, Trash2, Bot, Sparkles } from 'lucide-react';
import type { ChatSession } from '@/shared/types';

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (sessionId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
}) => {
  return (
    <aside className="w-64 bg-[#161b22] border-r border-[#30363d] flex flex-col h-full shrink-0 select-none">
      {/* New Chat Button */}
      <div className="p-3 border-b border-[#30363d]">
        <button
          onClick={onCreateSession}
          className="w-full flex items-center justify-center space-x-2 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-xs font-medium transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>New Task</span>
        </button>
      </div>

      {/* Session History List */}
      <div className="flex-1 overflow-y-auto p-2 space-x-0 space-y-1">
        <div className="px-2 py-1 text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
          Recent Tasks
        </div>

        {sessions.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-[#8b949e]">
            No active tasks. Click "New Task" to begin.
          </div>
        ) : (
          sessions.map((s) => {
            const isActive = s.id === activeSessionId;
            return (
              <div
                key={s.id}
                onClick={() => onSelectSession(s.id)}
                className={`group flex items-center justify-between px-2.5 py-2 rounded-md text-xs cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-[#21262d] text-white font-medium border border-[#30363d]'
                    : 'text-[#8b949e] hover:bg-[#21262d]/60 hover:text-[#c9d1d9]'
                }`}
              >
                <div className="flex items-center space-x-2 min-w-0 flex-1 mr-2">
                  {s.mode === 'jules' ? (
                    <Sparkles className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  ) : (
                    <Bot className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  )}
                  <span className="truncate">{s.title || 'Untitled Session'}</span>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(s.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-400 p-1 rounded transition-opacity"
                  title="Delete Session"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
