import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  RefreshCw, 
  X,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import type { JulesSessionSummary, JulesActivity } from '@/shared/types';
import { api } from '../../api';

interface JulesPanelProps {
  onClose: () => void;
}

export const JulesPanel: React.FC<JulesPanelProps> = ({ onClose }) => {
  const [sessions, setSessions] = useState<JulesSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activities, setActivities] = useState<JulesActivity[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSessions = async () => {
    setIsLoading(true);
    try {
      const list = await api.getJulesSessions().catch(() => []);
      setSessions(list);
      if (list.length > 0 && !selectedSessionId) {
        setSelectedSessionId(list[0].id);
      }
    } catch (err) {
      console.error('Failed to load Jules sessions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchActivities = async (id: string) => {
    try {
      const acts = await api.getJulesActivities(id).catch(() => []);
      setActivities(acts);
    } catch (err) {
      console.error('Failed to load Jules activities:', err);
    }
  };

  useEffect(() => {
    fetchSessions();

    const cleanup = api.onJulesUpdate((update: JulesSessionSummary) => {
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === update.id);
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = update;
          return next;
        }
        return [update, ...prev];
      });
    });

    return () => cleanup();
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      fetchActivities(selectedSessionId);
    }
  }, [selectedSessionId]);

  const getStateBadge = (state: string) => {
    switch (state) {
      case 'COMPLETED':
        return <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-950/80 text-emerald-400 border border-emerald-500/30">COMPLETED</span>;
      case 'CODING':
        return <span className="px-2 py-0.5 rounded-full text-[10px] bg-sky-950/80 text-sky-400 border border-sky-500/30 animate-pulse">CODING</span>;
      case 'AWAITING_USER_INPUT':
        return <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-950/80 text-amber-400 border border-amber-500/30">NEEDS INPUT</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#24262b] text-[#8e9196]">{state}</span>;
    }
  };

  return (
    <aside className="w-80 bg-[#16171a] border-l border-[#202226] flex flex-col h-full shrink-0 select-none text-[12px]">
      {/* Header */}
      <div className="h-11 px-3 border-b border-[#202226] flex items-center justify-between text-[#8e9196]">
        <div className="flex items-center space-x-2 text-[#c4c7cf] font-medium text-xs">
          <Sparkles className="w-3.5 h-3.5 text-sky-400" />
          <span>Jules Mission Control</span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={fetchSessions}
            disabled={isLoading}
            className="p-1 rounded hover:bg-[#202226] text-[#8e9196] hover:text-white transition-colors cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#202226] text-[#8e9196] hover:text-white transition-colors cursor-pointer"
            title="Close panel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Session List */}
      <div className="h-48 border-b border-[#202226] overflow-y-auto p-2 space-y-1.5">
        <div className="text-[10px] font-semibold text-[#6c707a] uppercase px-1 pb-0.5 tracking-wider">
          Active Jules Tasks
        </div>
        {sessions.length === 0 ? (
          <div className="text-center text-[11px] text-[#6c707a] py-6">
            No remote sessions found.
          </div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => setSelectedSessionId(s.id)}
              className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                selectedSessionId === s.id
                  ? 'bg-[#202227] border-[#38bdf8]/40 text-white shadow-sm'
                  : 'bg-[#1a1b1f] border-[#25272e] text-[#8e9196] hover:border-[#33353d]'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-[11px] text-[#70a6ff] truncate max-w-[120px] font-medium">{s.id}</span>
                {getStateBadge(s.state)}
              </div>
              <div className="text-[11.5px] truncate text-[#d1d4dc] font-medium">{s.title || 'Untitled Jules Task'}</div>
            </div>
          ))
        )}
      </div>

      {/* Activities Feed for Selected Session */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-3 py-2 bg-[#141517] border-b border-[#202226] text-[11px] font-medium text-[#7a7e88] flex items-center justify-between">
          <span>Live Activity Stream</span>
          {selectedSessionId && (
            <span className="font-mono text-[10px] text-[#70a6ff]">{selectedSessionId}</span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {activities.length === 0 ? (
            <div className="text-center text-[11px] text-[#6c707a] py-8">
              No activity logs for this session yet.
            </div>
          ) : (
            activities.map((a) => (
              <div key={a.id} className="p-2.5 rounded-xl bg-[#191a1e] border border-[#23252a] text-[11px] space-y-1">
                <div className="flex items-center justify-between text-[10px] text-[#6c707a]">
                  <span className="font-mono uppercase font-semibold text-[#8e9196]">{a.type}</span>
                  <span>{new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </div>
                <div className="text-[#c4c7cf] whitespace-pre-wrap leading-relaxed">{a.description}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
};
