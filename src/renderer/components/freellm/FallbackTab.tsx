import React, { useState, useEffect } from 'react';
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
  ToggleRight
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

  const handleMovePriority = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= chain.length) return;

    const currentItem = chain[index];
    const targetItem = chain[targetIndex];

    const currentPriority = currentItem.priority;
    const targetPriority = targetItem.priority;

    try {
      await Promise.all([
        api.freellm.updateFallbackPriority(currentItem.model_id, targetPriority, currentItem.chain_enabled === 1),
        api.freellm.updateFallbackPriority(targetItem.model_id, currentPriority, targetItem.chain_enabled === 1),
      ]);
      await loadData();
    } catch (err) {
      console.error('Failed to reorder priority:', err);
    }
  };

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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {STRATEGIES.map((s) => {
            const Icon = s.icon;
            const isSelected = strategy === s.id;
            return (
              <button
                key={s.id}
                onClick={() => handleSelectStrategy(s.id)}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
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
        <div className="px-4 py-3 bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)] flex items-center justify-between">
          <div>
            <h4 className="text-xs font-semibold text-white flex items-center gap-2">
              <GitBranch className="w-3.5 h-3.5 text-purple-400" />
              Auto-Failover Priority Ladder
            </h4>
            <span className="text-[10px] text-[var(--text-muted)]">
              When a provider hits a 429 error or runs out of quota, requests cascade down this ladder.
            </span>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="p-1 rounded text-[var(--text-muted)] hover:text-white transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--bg-surface)]/50 border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
              <tr>
                <th className="px-3.5 py-2">Priority</th>
                <th className="px-3.5 py-2">Provider</th>
                <th className="px-3.5 py-2">Model</th>
                <th className="px-3.5 py-2">Intelligence</th>
                <th className="px-3.5 py-2">Speed</th>
                <th className="px-3.5 py-2">Status</th>
                <th className="px-3.5 py-2 text-right">Reorder</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {chain.map((item, idx) => (
                <tr key={item.model_id} className="hover:bg-[var(--bg-surface-hover)]/40 transition-colors">
                  <td className="px-3.5 py-2.5 font-bold text-white text-[11px]">
                    #{item.priority}
                  </td>
                  <td className="px-3.5 py-2.5 font-medium text-white capitalize">
                    {item.platform}
                  </td>
                  <td className="px-3.5 py-2.5 text-[var(--text-secondary)] font-mono text-[11px]">
                    {item.raw_model_id}
                  </td>
                  <td className="px-3.5 py-2.5 text-purple-400 font-semibold text-[11px]">
                    {item.intelligence_rank}/10
                  </td>
                  <td className="px-3.5 py-2.5 text-amber-400 font-semibold text-[11px]">
                    {item.speed_rank}/10
                  </td>
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
                  <td className="px-3.5 py-2.5 text-right">
                    <div className="flex items-center justify-end space-x-1">
                      <button
                        onClick={() => handleMovePriority(idx, 'up')}
                        disabled={idx === 0}
                        className="p-1 rounded hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-white disabled:opacity-30 cursor-pointer"
                        title="Move Up"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleMovePriority(idx, 'down')}
                        disabled={idx === chain.length - 1}
                        className="p-1 rounded hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-white disabled:opacity-30 cursor-pointer"
                        title="Move Down"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
