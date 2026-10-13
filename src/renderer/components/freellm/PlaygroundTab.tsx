import React, { useState, useEffect } from 'react';
import { 
  Send, 
  Sparkles, 
  Clock, 
  Zap, 
  Brain, 
  Terminal, 
  RefreshCw,
  Copy,
  Check
} from 'lucide-react';
import { api } from '../../api';

export const PlaygroundTab: React.FC = () => {
  const [models, setModels] = useState<string[]>(['auto']);
  const [selectedModel, setSelectedModel] = useState('auto');
  const [temperature, setTemperature] = useState(0.7);
  const [prompt, setPrompt] = useState('Write a concise 3-bullet summary of quantum computing and why it matters for cryptography.');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string>('');
  const [reasoning, setReasoning] = useState<string>('');
  const [routedVia, setRoutedVia] = useState<{ platform?: string; model?: string } | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCatalog = async () => {
      try {
        const listing = await api.freellm.getModelListing();
        const available = listing.filter((m: any) => m.available === 1).map((m: any) => m.id);
        setModels(['auto', ...available]);
      } catch (err) {
        console.error('Failed to load models for playground:', err);
      }
    };
    fetchCatalog();
  }, []);

  const handleRun = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResponse('');
    setReasoning('');
    setRoutedVia(null);
    setLatencyMs(null);

    try {
      const res = await api.freellm.chatPlayground(prompt.trim(), selectedModel, temperature);
      setResponse(res.content);
      if (res.reasoning) setReasoning(res.reasoning);
      if (res.routedVia) setRoutedVia(res.routedVia);
      setLatencyMs(res.latencyMs);
    } catch (err: any) {
      setError(err?.message || 'Chat completion failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!response) return;
    navigator.clipboard.writeText(response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Top Controls Bar */}
      <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center space-x-3">
          <div>
            <label className="text-[var(--text-muted)] block text-[10px] uppercase font-bold mb-1">
              Target Model
            </label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="px-2.5 py-1.5 bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] rounded-lg text-white font-mono text-xs focus:outline-none focus:border-blue-500"
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m === 'auto' ? '✨ auto (Smart Cascade Router)' : m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[var(--text-muted)] block text-[10px] uppercase font-bold mb-1">
              Temperature: {temperature.toFixed(1)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-24 accent-blue-500"
            />
          </div>
        </div>

        <button
          onClick={handleRun}
          disabled={loading || !prompt.trim()}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-semibold shadow-md shadow-blue-500/20 transition-all cursor-pointer"
        >
          {loading ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          <span>{loading ? 'Executing...' : 'Run Test'}</span>
        </button>
      </div>

      {/* Prompt Editor */}
      <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden bg-[var(--bg-surface)]">
        <div className="px-3.5 py-2 bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-secondary)] flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-blue-400" />
            Prompt Input
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">
            Press &quot;Run Test&quot; to test in-process response & fallback
          </span>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Enter prompt here..."
          className="w-full p-3.5 bg-transparent text-xs text-white placeholder-[var(--text-muted)] focus:outline-none resize-none font-sans"
        />
      </div>

      {/* Result Display */}
      {(response || reasoning || error || loading) && (
        <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden bg-[var(--bg-surface)] space-y-0">
          <div className="px-3.5 py-2.5 bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)] flex items-center justify-between text-xs">
            <div className="flex items-center space-x-3">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                Response
              </span>

              {routedVia && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-blue-500/15 text-blue-300 border border-blue-500/30 font-mono">
                  <Zap className="w-2.5 h-2.5" />
                  Routed to {routedVia.platform?.toUpperCase()} ({routedVia.model})
                </span>
              )}

              {latencyMs !== null && (
                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                  <Clock className="w-3 h-3" />
                  {latencyMs}ms
                </span>
              )}
            </div>

            {response && (
              <button
                onClick={handleCopy}
                className="flex items-center space-x-1 text-[11px] text-[var(--text-secondary)] hover:text-white transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>

          <div className="p-4 text-xs text-[var(--text-primary)] leading-relaxed space-y-3 font-sans max-h-96 overflow-y-auto">
            {error ? (
              <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300">
                {error}
              </div>
            ) : null}

            {reasoning && (
              <div className="p-3 rounded-lg bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] text-[var(--text-secondary)] space-y-1">
                <div className="text-[10px] font-bold uppercase text-purple-400 flex items-center gap-1">
                  <Brain className="w-3 h-3" /> Model Thoughts / Reasoning
                </div>
                <div className="whitespace-pre-wrap font-mono text-[11px] opacity-80">
                  {reasoning}
                </div>
              </div>
            )}

            {response ? (
              <div className="whitespace-pre-wrap">{response}</div>
            ) : loading ? (
              <div className="flex items-center space-x-2 text-[var(--text-muted)] animate-pulse">
                <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                <span>Generating in-process via Byte AI Labs...</span>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
