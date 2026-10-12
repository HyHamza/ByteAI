import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  Zap, 
  Clock, 
  DollarSign, 
  RefreshCw,
  CheckCircle2,
  XCircle,
  Database,
  Layers
} from 'lucide-react';
import { api } from '../../api';

interface Summary {
  totalRequests: number;
  successRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgLatencyMs: number;
  estimatedCostSavings: number;
}

interface PlatformStat {
  platform: string;
  requests: number;
  successRate: number;
  avgLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

interface RequestLog {
  id: number;
  platform: string;
  modelId: string;
  status: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error: string | null;
  createdAt: string;
}

export const AnalyticsTab: React.FC = () => {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [platformStats, setPlatformStats] = useState<PlatformStat[]>([]);
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);
      const [sum, platforms, recentLogs] = await Promise.all([
        api.freellm.getAnalyticsSummary(),
        api.freellm.getPlatformStats(),
        api.freellm.getRequestLogs(30, 0),
      ]);
      setSummary(sum);
      setPlatformStats(platforms);
      setLogs(recentLogs);
    } catch (err) {
      console.error('Failed to load FreeLLM analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const totalTokens = (summary?.totalInputTokens || 0) + (summary?.totalOutputTokens || 0);

  return (
    <div className="space-y-6">
      {/* Top Controls */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-emerald-400" />
          Autonomous LLM Traffic & Cost Savings
        </h3>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] text-xs text-[var(--text-secondary)] hover:text-white transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* 5 KPI Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Total Requests */}
        <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] text-[11px] mb-2">
            <span>Total Requests</span>
            <Layers className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="text-xl font-bold text-white tracking-tight">
            {(summary?.totalRequests || 0).toLocaleString()}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] mt-1">Autonomous turns & chat</div>
        </div>

        {/* Success Rate */}
        <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] text-[11px] mb-2">
            <span>Success Rate</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-400 tracking-tight">
            {summary?.successRate !== undefined ? `${summary.successRate}%` : '100%'}
          </div>
          <div className="text-[10px] text-emerald-400/80 mt-1">With auto 429 failover</div>
        </div>

        {/* Total Tokens */}
        <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] text-[11px] mb-2">
            <span>Total Tokens</span>
            <Database className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-xl font-bold text-white tracking-tight">
            {totalTokens > 1000000 
              ? `${(totalTokens / 1000000).toFixed(2)}M` 
              : totalTokens > 1000 
              ? `${(totalTokens / 1000).toFixed(1)}k` 
              : totalTokens}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] mt-1">
            In: {summary?.totalInputTokens || 0} / Out: {summary?.totalOutputTokens || 0}
          </div>
        </div>

        {/* Avg Latency */}
        <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] text-[11px] mb-2">
            <span>Avg Latency</span>
            <Clock className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-xl font-bold text-white tracking-tight">
            {summary?.avgLatencyMs || 0} <span className="text-xs font-normal text-[var(--text-muted)]">ms</span>
          </div>
          <div className="text-[10px] text-[var(--text-muted)] mt-1">In-process zero-proxy</div>
        </div>

        {/* Cost Savings */}
        <div className="p-3.5 rounded-xl bg-gradient-to-br from-emerald-950/30 to-[var(--bg-surface)] border border-emerald-500/30 flex flex-col justify-between col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-emerald-400 text-[11px] mb-2 font-medium">
            <span>Saved vs Paid APIs</span>
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-300 tracking-tight">
            ${summary?.estimatedCostSavings?.toFixed(2) || '0.00'}
          </div>
          <div className="text-[10px] text-emerald-400/80 mt-1">100% Free LLM routing</div>
        </div>
      </div>

      {/* Platform Distribution */}
      {platformStats.length > 0 && (
        <div className="border border-[var(--border-subtle)] rounded-xl bg-[var(--bg-surface)] p-4 space-y-3">
          <h4 className="text-xs font-semibold text-white flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-blue-400" />
            Platform Workload Distribution
          </h4>
          <div className="space-y-2">
            {platformStats.map((p) => {
              const maxReqs = Math.max(...platformStats.map((x) => x.requests), 1);
              const pct = Math.round((p.requests / maxReqs) * 100);
              return (
                <div key={p.platform} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-white capitalize">{p.platform}</span>
                    <span className="text-[var(--text-muted)]">
                      {p.requests} reqs • {p.successRate}% success • {p.avgLatencyMs}ms
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-[var(--bg-sidebar)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Request Logs */}
      <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden bg-[var(--bg-surface)]">
        <div className="px-4 py-3 bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)]">
          <h4 className="text-xs font-semibold text-white">Recent In-Process Request Logs</h4>
        </div>

        {logs.length === 0 ? (
          <div className="text-center py-8 text-xs text-[var(--text-muted)]">
            No request activity logged yet. Test a prompt in Playground or run an autonomous task!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--bg-surface)]/50 border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-3.5 py-2">Status</th>
                  <th className="px-3.5 py-2">Provider</th>
                  <th className="px-3.5 py-2">Model</th>
                  <th className="px-3.5 py-2">Tokens</th>
                  <th className="px-3.5 py-2">Latency</th>
                  <th className="px-3.5 py-2">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-[var(--bg-surface-hover)]/40 transition-colors">
                    <td className="px-3.5 py-2">
                      {log.status === 'success' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3 h-3" /> OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-rose-400 font-medium" title={log.error || 'Error'}>
                          <XCircle className="w-3 h-3" /> Failed
                        </span>
                      )}
                    </td>
                    <td className="px-3.5 py-2 font-medium text-white capitalize">{log.platform}</td>
                    <td className="px-3.5 py-2 text-[var(--text-secondary)] font-mono text-[11px] truncate max-w-[150px]">
                      {log.modelId}
                    </td>
                    <td className="px-3.5 py-2 text-[var(--text-muted)] text-[11px]">
                      {log.inputTokens} / {log.outputTokens}
                    </td>
                    <td className="px-3.5 py-2 text-[var(--text-muted)] text-[11px]">
                      {log.latencyMs} ms
                    </td>
                    <td className="px-3.5 py-2 text-[var(--text-muted)] text-[10px]">
                      {log.createdAt ? new Date(log.createdAt).toLocaleTimeString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
