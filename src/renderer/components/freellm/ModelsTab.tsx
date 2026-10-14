import React, { useState, useEffect } from 'react';
import { 
  Cpu, 
  Search, 
  Zap, 
  Brain, 
  CheckCircle2, 
  Lock, 
  RefreshCw,
  Sparkles,
  Layers
} from 'lucide-react';
import { api } from '../../api';

interface ModelItem {
  id: string;
  name: string;
  ownedBy: string;
  available: number;
  enabled: number;
  contextWindow: number | null;
  intel: number;
}

export const ModelsTab: React.FC = () => {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterOwner, setFilterOwner] = useState('all');
  const [availableOnly, setAvailableOnly] = useState(true);

  const loadModels = async () => {
    try {
      setLoading(true);
      const list = await api.freellm.getModelListing();
      setModels(list);
    } catch (err) {
      console.error('Failed to load model listing:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadModels();
  }, []);

  const owners = Array.from(
    new Set(
      models.flatMap((m) =>
        m.ownedBy
          .split(',')
          .map((s) => s.trim().toLowerCase())
      )
    )
  ).filter((o) => o && o !== 'all').sort();

  const filtered = models.filter((m) => {
    if (availableOnly && m.available !== 1) return false;
    if (filterOwner !== 'all') {
      const providers = m.ownedBy.toLowerCase().split(',').map((s) => s.trim());
      if (!providers.includes(filterOwner.toLowerCase())) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.ownedBy.toLowerCase().includes(q);
    }
    return true;
  });

  const availableCount = models.filter((m) => m.available === 1).length;

  return (
    <div className="space-y-4">
      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search 85+ models (e.g. gemini, llama-3.3, qwen, deepseek)..."
            className="w-full pl-9 pr-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg text-xs text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center space-x-2">
          <select
            value={filterOwner}
            onChange={(e) => setFilterOwner(e.target.value)}
            className="px-2.5 py-1.5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg text-xs text-white focus:outline-none"
          >
            <option value="all">All Providers ({owners.length})</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o.toUpperCase()}
              </option>
            ))}
          </select>

          <button
            onClick={() => setAvailableOnly(!availableOnly)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
              availableOnly
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            Available Only ({availableCount})
          </button>

          <button
            onClick={loadModels}
            disabled={loading}
            className="p-1.5 rounded-lg border border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-white transition-colors cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Model Count Banner */}
      <div className="flex items-center justify-between text-xs text-[var(--text-muted)] px-1">
        <span>Showing {filtered.length} of {models.length} registered models</span>
        <span className="flex items-center gap-1 text-emerald-400">
          <Sparkles className="w-3 h-3" />
          {availableCount} models ready to serve requests now
        </span>
      </div>

      {/* Models Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((m) => {
          const isAvailable = m.available === 1;
          const ctxText = m.contextWindow 
            ? m.contextWindow >= 1000000 
              ? `${(m.contextWindow / 1000000).toFixed(1)}M` 
              : `${Math.round(m.contextWindow / 1000)}k` 
            : 'Standard';

          return (
            <div
              key={m.id}
              className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between ${
                isAvailable
                  ? 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-blue-500/40'
                  : 'bg-[var(--bg-surface)]/40 border-[var(--border-subtle)]/50 opacity-60'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="font-semibold text-xs text-white truncate" title={m.name}>
                    {m.name}
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      isAvailable
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-gray-500/15 text-gray-400 border border-gray-500/30'
                    }`}
                  >
                    {isAvailable ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Lock className="w-2.5 h-2.5" />}
                    {isAvailable ? 'Ready' : 'Needs Key'}
                  </span>
                </div>

                <div className="text-[11px] font-mono text-[var(--text-muted)] truncate mb-3" title={m.id}>
                  {m.id}
                </div>
              </div>

              <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                <span className="capitalize font-medium text-[var(--text-primary)]">
                  {m.ownedBy}
                </span>

                <div className="flex items-center space-x-2">
                  <span className="flex items-center gap-1 text-[var(--text-muted)]" title="Context Window">
                    <Layers className="w-3 h-3" /> {ctxText}
                  </span>
                  {m.intel > 0 && (
                    <span className="flex items-center gap-0.5 text-purple-400" title={`Intel Rank ${m.intel}/10`}>
                      <Brain className="w-3 h-3" /> {m.intel}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
