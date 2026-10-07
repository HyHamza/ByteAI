import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  ExternalLink, 
  RefreshCw, 
  GitPullRequest, 
  Terminal, 
  CheckCircle2, 
  Clock, 
  AlertCircle 
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

    // Listen for live updates
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
        return <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-500/40">COMPLETED</span>;
      case 'CODING':
        return <span className="px-2 py-0.5 rounded text-[10px] bg-sky-950 text-sky-400 border border-sky-500/40 animate-pulse">CODING</span>;
      case 'AWAITING_USER_INPUT':
        return <span className="px-2 py-0.5 rounded text-[10px] bg-yellow-950 text-yellow-400 border border-yellow-500/40">NEEDS INPUT</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] bg-gray-800 text-gray-300">{state}</span>;
    }
  };

  return (
    <aside className="w-80 bg-[#161b22] border-l border-[#30363d] flex flex-col h-full shrink-0 select-none">
      {/* Header */}
      <div className="p-3 border-b border-[#30363d] flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-semibold text-white">Jules Mission Control</span>
        </div>
        <button
          onClick={fetchSessions}
          disabled={isLoading}
          className="p-1 text-[#8b949e] hover:text-[#c9d1d9] rounded hover:bg-[#21262d] transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Session List */}
      <div className="h-44 border-b border-[#30363d] overflow-y-auto p-2 space-y-1">
        <div className="text-[10px] font-semibold text-[#8b949e] uppercase px-1 pb-1">
          Active Jules Tasks
        </div>
        {sessions.length === 0 ? (
          <div className="text-center text-[11px] text-[#8b949e] py-4">
            No remote sessions found.
          </div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => setSelectedSessionId(s.id)}
              className={`p-2 rounded border cursor-pointer transition-colors text-xs ${
                selectedSessionId === s.id
                  ? 'bg-[#21262d] border-sky-500/50 text-white'
                  : 'bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:border-[#484f58]'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[11px] text-sky-400 truncate max-w-[120px]">{s.id}</span>
                {getStateBadge(s.state)}
              </div>
              <div className="text-[11px] truncate text-[#c9d1d9] font-medium">{s.title}</div>
            </div>
          ))
        )}
      </div>

      {/* Activities Feed for Selected Session */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-2 bg-[#0d1117] border-b border-[#30363d] text-[11px] font-semibold text-[#8b949e] flex items-center justify-between">
          <span>Live Activity Stream</span>
          {selectedSessionId && (
            <span className="font-mono text-[10px] text-sky-400">{selectedSessionId}</span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {activities.length === 0 ? (
            <div className="text-center text-[11px] text-[#8b949e] py-6">
              No activity logs for this session yet.
            </div>
          ) : (
            activities.map((a) => (
              <div key={a.id} className="p-2 rounded bg-[#0d1117] border border-[#30363d] text-[11px] space-y-1">
                <div className="flex items-center justify-between text-[10px] text-[#8b949e]">
                  <span className="font-mono uppercase">{a.type}</span>
                  <span>{new Date(a.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="text-[#c9d1d9] whitespace-pre-wrap">{a.description}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
};
