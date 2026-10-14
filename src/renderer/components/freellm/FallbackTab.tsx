import React, { useState, useEffect, useMemo } from 'react';
import { 
  GitBranch, 
  ArrowUp, 
  ArrowDown, 
  Sparkles, 
  Zap, 
  Scale, 
  Brain, 
  DollarSign, 
  Check,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  GripVertical,
  ChevronsUp,
  Search,
  ListOrdered
} from 'lucide-react';
import { api } from '../../api';

interface ChainItem {
  priority: number;
  chain_enabled: number;
  model_id: number;
  platform: string;
  raw_model_id: string;
  display_name: string;
  intelligence_rank: number;
  speed_rank: number;
  context_window: number;
  supports_vision: number;
  supports_tools: number;
}

const STRATEGIES = [
  {
    id: 'priority',
    name: 'Strict Priority Ladder',
    desc: 'Strictly routes top-to-bottom honoring your exact manual drag-and-drop order below.',
    icon: ListOrdered,
    color: 'text-indigo-400',
  },
  {
    id: 'balanced',
    name: 'Balanced',
    desc: 'Even blend of intelligence rank, execution speed, and rate-limit distribution.',
    icon: Scale,
    color: 'text-blue-400',
  },
  {
    id: 'smart',
    name: 'Quality & Intelligence',
    desc: 'Prefers deep reasoning and highest parameter intelligence models first.',
    icon: Brain,
    color: 'text-purple-400',
  },
  {
    id: 'fast',
    name: 'Ultra-Fast Latency',
    desc: 'Favors sub-second tokens/sec providers like Groq, Cerebras, and SambaNova.',
    icon: Zap,
    color: 'text-amber-400',
  },
  {
    id: 'cost',
    name: 'Quota Preservation',
    desc: 'Distributes load across keyless and high-capacity free endpoints.',
    icon: DollarSign,
    color: 'text-emerald-400',
  },
];

export const FallbackTab: React.FC = () => {
  const [chain, setChain] = useState<ChainItem[]>([]);
  const [strategy, setStrategy] = useState('balanced');
  const [unification, setUnification] = useState(true);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [draggedModelId, setDraggedModelId] = useState<number | null>(null);
  const [dragOverModelId, setDragOverModelId] = useState<number | null>(null);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [list, currentStrat, isUnified] = await Promise.all([
        api.freellm.getFallbackChain(),
        api.freellm.getRoutingStrategy(),
        api.freellm.getModelUnification(),
      ]);
      setChain(list);
      setStrategy(currentStrat || 'balanced');
      setUnification(Boolean(isUnified));
    } catch (err) {
      console.error('Failed to load fallback settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSelectStrategy = async (newStrat: string) => {
    try {
      setStrategy(newStrat);
      await api.freellm.setRoutingStrategy(newStrat);
    } catch (err) {
      console.error('Failed to save strategy:', err);
    }
  };

  const handleToggleUnification = async () => {
    try {
      const next = !unification;
      setUnification(next);
      await api.freellm.setModelUnification(next);
    } catch (err) {
      console.error('Failed to toggle unification:', err);
    }
  };

  const handleToggleChainItem = async (item: ChainItem) => {
    try {
      const newEnabled = item.chain_enabled === 1 ? 0 : 1;
      await api.freellm.updateFallbackPriority(item.model_id, item.priority, newEnabled === 1);
      setChain((prev) =>
        prev.map((c) => (c.model_id === item.model_id ? { ...c, chain_enabled: newEnabled } : c))
      );
    } catch (err) {
      console.error('Failed to toggle item:', err);
    }
  };

  // Reorders the full chain by moving item with modelId to targetIndex
  const reorderAndPersist = async (newChain: ChainItem[]) => {
    const reordered = newChain.map((item, idx) => ({
      ...item,
      priority: idx + 1,
    }));

    setChain(reordered);

    try {
      setIsSavingOrder(true);
      await api.freellm.reorderFallbackChain(reordered.map((c) => c.model_id));
    } catch (err) {
      console.error('Failed to save fallback chain order:', err);
      loadData();
    } finally {
      setIsSavingOrder(false);
    }
  };

  // Instant Move-to-Top (#1 priority)
  const handleMoveToTop = async (modelId: number) => {
    const fromIndex = chain.findIndex((c) => c.model_id === modelId);
    if (fromIndex <= 0) return;

    const newChain = [...chain];
    const [moved] = newChain.splice(fromIndex, 1);
    newChain.unshift(moved);

    await reorderAndPersist(newChain);
  };

  // Single-step reordering
  const handleMovePriority = async (modelId: number, direction: 'up' | 'down') => {
    const fromIndex = chain.findIndex((c) => c.model_id === modelId);
    if (fromIndex === -1) return;

    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= chain.length) return;

    const newChain = [...chain];
    const [moved] = newChain.splice(fromIndex, 1);
    newChain.splice(toIndex, 0, moved);

    await reorderAndPersist(newChain);
  };

  // HTML5 Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, modelId: number) => {
    e.dataTransfer.setData('text/plain', String(modelId));
    e.dataTransfer.effectAllowed = 'move';
    setDraggedModelId(modelId);
  };

  const handleDragOver = (e: React.DragEvent, modelId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverModelId !== modelId) {
      setDragOverModelId(modelId);
    }
  };

  const handleDragLeave = () => {
    // Only clear if we actually left
  };

  const handleDrop = async (e: React.DragEvent, targetModelId: number) => {
    e.preventDefault();
    setDragOverModelId(null);

    const sourceIdStr = e.dataTransfer.getData('text/plain');
    const sourceModelId = sourceIdStr ? parseInt(sourceIdStr, 10) : draggedModelId;
    setDraggedModelId(null);

    if (!sourceModelId || sourceModelId === targetModelId) return;

    const fromIndex = chain.findIndex((c) => c.model_id === sourceModelId);
    const toIndex = chain.findIndex((c) => c.model_id === targetModelId);
    if (fromIndex === -1 || toIndex === -1) return;

    const newChain = [...chain];
    const [moved] = newChain.splice(fromIndex, 1);
    newChain.splice(toIndex, 0, moved);

    await reorderAndPersist(newChain);
  };

  const handleDragEnd = () => {
    setDraggedModelId(null);
    setDragOverModelId(null);
  };

  // Filtered chain for search/filtering
  const filteredChain = useMemo(() => {
    if (!searchQuery.trim()) return chain;
    const query = searchQuery.toLowerCase().trim();
    return chain.filter(
      (item) =>
        item.platform.toLowerCase().includes(query) ||
        item.raw_model_id.toLowerCase().includes(query) ||
        (item.display_name && item.display_name.toLowerCase().includes(query))
    );
  }, [chain, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Strategy Selector */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-400" />
            Routing Strategy Engine
          </h3>
          <span className="text-[11px] text-[var(--text-muted)]">
            Controls how the auto-router chooses the best provider for each request
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {STRATEGIES.map((s) => {
            const Icon = s.icon;
            const isSelected = strategy === s.id;
            return (
              <button
                key={s.id}
                onClick={() => handleSelectStrategy(s.id)}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-blue-600/15 border-blue-500 shadow-md shadow-blue-500/10'
                    : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Icon className={`w-4 h-4 ${s.color}`} />
                    {isSelected && <Check className="w-3.5 h-3.5 text-blue-400" />}
                  </div>
                  <div className="font-semibold text-xs text-white mb-1">{s.name}</div>
                  <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    {s.desc}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Model Unification Banner */}
      <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-white flex items-center gap-2">
            <span>Model Unification Virtualizer</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30">
              Recommended
            </span>
          </div>
          <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
            Transparently aliases generic model requests (like <code className="text-white">gpt-4o</code>, <code className="text-white">claude-3-5-sonnet</code>) to the best connected free model in your chain.
          </p>
        </div>
        <button
          onClick={handleToggleUnification}
          className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
        >
          {unification ? (
            <ToggleRight className="w-8 h-8 text-blue-500" />
          ) : (
            <ToggleLeft className="w-8 h-8 text-[var(--text-muted)]" />
          )}
        </button>
      </div>

      {/* Fallback Priority Ladder Table */}
      <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden bg-[var(--bg-surface)]">
        <div className="px-4 py-3 bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-xs font-semibold text-white flex items-center gap-2">
              <GitBranch className="w-3.5 h-3.5 text-purple-400" />
              Auto-Failover Priority Ladder
              {isSavingOrder && (
                <span className="text-[10px] text-blue-400 font-normal animate-pulse">
                  Saving priorities...
                </span>
              )}
            </h4>
            <span className="text-[10px] text-[var(--text-muted)]">
              Drag and drop any model or click "Top" to reorder. When a provider hits 429 or quota limit, requests cascade down this ladder.
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Search filter input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter provider or model..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg pl-8 pr-3 py-1 text-xs text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500 w-48 sm:w-56"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)] hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>

            <button
              onClick={loadData}
              disabled={loading}
              className="p-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
              title="Refresh ladder"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] text-[var(--text-muted)] shadow-sm">
              <tr>
                <th className="px-3 py-2 w-10 text-center">Drag</th>
                <th className="px-3 py-2 w-16">Priority</th>
                <th className="px-3.5 py-2">Provider</th>
                <th className="px-3.5 py-2">Model</th>
                <th className="px-3.5 py-2">Intelligence</th>
                <th className="px-3.5 py-2">Speed</th>
                <th className="px-3.5 py-2">Status</th>
                <th className="px-3.5 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filteredChain.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
                    No models found matching "{searchQuery}"
                  </td>
                </tr>
              ) : (
                filteredChain.map((item) => {
                  const isTop = item.priority === 1;
                  const isDragging = draggedModelId === item.model_id;
                  const isOver = dragOverModelId === item.model_id;

                  return (
                    <tr
                      key={item.model_id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, item.model_id)}
                      onDragOver={(e) => handleDragOver(e, item.model_id)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, item.model_id)}
                      onDragEnd={handleDragEnd}
                      className={`transition-colors select-none ${
                        isDragging
                          ? 'opacity-30 bg-blue-500/10'
                          : isOver
                          ? 'border-t-2 border-blue-500 bg-blue-500/10'
                          : 'hover:bg-[var(--bg-surface-hover)]/40'
                      }`}
                    >
                      {/* Drag Handle */}
                      <td className="px-2 py-2.5 text-center">
                        <div
                          className="inline-flex p-1 rounded text-[var(--text-muted)] hover:text-white cursor-grab active:cursor-grabbing hover:bg-[var(--bg-surface-hover)]"
                          title="Drag to reorder priority"
                        >
                          <GripVertical className="w-3.5 h-3.5" />
                        </div>
                      </td>

                      {/* Priority Rank */}
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold ${
                            isTop
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm shadow-amber-500/10'
                              : item.priority <= 3
                              ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                              : 'text-white'
                          }`}
                        >
                          #{item.priority}
                        </span>
                      </td>

                      {/* Provider */}
                      <td className="px-3.5 py-2.5 font-medium text-white capitalize">
                        {item.platform}
                      </td>

                      {/* Model Raw ID */}
                      <td className="px-3.5 py-2.5 text-[var(--text-secondary)] font-mono text-[11px]">
                        {item.raw_model_id}
                      </td>

                      {/* Intelligence */}
                      <td className="px-3.5 py-2.5 text-purple-400 font-semibold text-[11px]">
                        {item.intelligence_rank}/10
                      </td>

                      {/* Speed */}
                      <td className="px-3.5 py-2.5 text-amber-400 font-semibold text-[11px]">
                        {item.speed_rank}/10
                      </td>

                      {/* Status Toggle */}
                      <td className="px-3.5 py-2.5">
                        <button
                          onClick={() => handleToggleChainItem(item)}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                            item.chain_enabled === 1
                              ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                              : 'border-gray-600 text-gray-500 bg-gray-800'
                          }`}
                        >
                          {item.chain_enabled === 1 ? 'Enabled' : 'Disabled'}
                        </button>
                      </td>

                      {/* Actions: Move to Top + Step Up/Down */}
                      <td className="px-3.5 py-2.5 text-right">
                        <div className="flex items-center justify-end space-x-1">
                          <button
                            onClick={() => handleMoveToTop(item.model_id)}
                            disabled={isTop}
                            className="px-1.5 py-1 rounded hover:bg-blue-600/20 hover:text-blue-400 text-[var(--text-secondary)] disabled:opacity-20 cursor-pointer flex items-center gap-1 text-[10px] font-semibold transition-colors"
                            title="Move directly to Priority #1"
                          >
                            <ChevronsUp className="w-3.5 h-3.5" />
                            <span>Top</span>
                          </button>
                          <button
                            onClick={() => handleMovePriority(item.model_id, 'up')}
                            disabled={isTop}
                            className="p-1 rounded hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-white disabled:opacity-20 cursor-pointer transition-colors"
                            title="Move Up One"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleMovePriority(item.model_id, 'down')}
                            disabled={item.priority >= chain.length}
                            className="p-1 rounded hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-white disabled:opacity-20 cursor-pointer transition-colors"
                            title="Move Down One"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
