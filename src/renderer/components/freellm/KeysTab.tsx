import React, { useState, useEffect } from 'react';
import { 
  Key, 
  Plus, 
  Trash2, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  XCircle, 
  ExternalLink,
  ShieldCheck,
  Search,
  Sparkles,
  Info
} from 'lucide-react';
import { api } from '../../api';

interface ApiKeyRow {
  id: number;
  platform: string;
  label: string;
  maskedKey: string;
  baseUrl: string | null;
  status: 'healthy' | 'rate_limited' | 'invalid' | 'unknown' | 'error';
  enabled: boolean;
  createdAt: string;
  lastCheckedAt: string | null;
}

const PROVIDERS = [
  { id: 'gemini-free', name: 'Google Gemini Free (Web)', url: 'https://gemini.google.com', keyless: true, freeQuota: '100% Free Gemini 3.8 / 4 Argon (No API Key Needed)' },
  { id: 'google', name: 'Google Gemini (API Studio)', url: 'https://aistudio.google.com/app/apikey', keyless: false, freeQuota: '15 RPM / 1M TPM free tier' },
  { id: 'groq', name: 'Groq', url: 'https://console.groq.com/keys', keyless: false, freeQuota: 'Ultra-fast Llama-3.3 & Whisper free' },
  { id: 'cerebras', name: 'Cerebras', url: 'https://cloud.cerebras.ai', keyless: false, freeQuota: 'Up to 2,000 tokens/sec free' },
  { id: 'nvidia', name: 'NVIDIA NIM', url: 'https://build.nvidia.com', keyless: false, freeQuota: '1,000 free inference credits' },
  { id: 'mistral', name: 'Mistral AI', url: 'https://console.mistral.ai', keyless: false, freeQuota: 'La Plateforme free tier' },
  { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/keys', keyless: false, freeQuota: 'Free models like DeepSeek, Qwen' },
  { id: 'github', name: 'GitHub Models', url: 'https://github.com/marketplace/models', keyless: false, freeQuota: '150 req/day free with GitHub PAT' },
  { id: 'cohere', name: 'Cohere', url: 'https://dashboard.cohere.com/api-keys', keyless: false, freeQuota: 'Trial key with Command R+' },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', url: 'https://dash.cloudflare.com', keyless: false, freeQuota: '10,000 neurons/day free' },
  { id: 'zhipu', name: 'Zhipu AI (GLM)', url: 'https://open.bigmodel.cn', keyless: false, freeQuota: 'GLM-4-Flash free API' },
  { id: 'ollama', name: 'Ollama (Local)', url: 'https://ollama.ai', keyless: true, freeQuota: '100% free local models (no key needed)' },
  { id: 'kilo', name: 'Kilo Gateway', url: 'https://kilo.ai', keyless: true, freeQuota: 'Keyless zero-config free gateway' },
  { id: 'pollinations', name: 'Pollinations AI', url: 'https://pollinations.ai', keyless: true, freeQuota: 'Keyless completely open endpoints' },
  { id: 'llm7', name: 'LLM7 Labs', url: 'https://llm7.com', keyless: true, freeQuota: 'Community open router' },
  { id: 'huggingface', name: 'HuggingFace', url: 'https://huggingface.co/settings/tokens', keyless: false, freeQuota: 'Free inference API tokens' },
  { id: 'opencode', name: 'OpenCode Zen', url: 'https://opencode.ai', keyless: false, freeQuota: 'Coding LLM free pool' },
  { id: 'ovh', name: 'OVHcloud AI Endpoints', url: 'https://endpoints.ai.cloud.ovh.net', keyless: true, freeQuota: 'Keyless Mistral & Llama European cloud' },
  { id: 'agnes', name: 'Agnes AI', url: 'https://agnes.ai', keyless: false, freeQuota: 'Free tier API' },
  { id: 'reka', name: 'Reka AI', url: 'https://chat.reka.ai', keyless: false, freeQuota: 'Free multimodal model tier' },
  { id: 'siliconflow', name: 'SiliconFlow', url: 'https://cloud.siliconflow.cn', keyless: false, freeQuota: 'Qwen & DeepSeek free tier' },
  { id: 'sambanova', name: 'SambaNova', url: 'https://cloud.sambanova.ai', keyless: false, freeQuota: 'Fast Llama 3.3 70B free tier' },
  { id: 'custom', name: 'Custom OpenAI Endpoint', url: '', keyless: false, freeQuota: 'Compatible with any v1/chat/completions server' },
];

export const KeysTab: React.FC = () => {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Add Key Form state
  const [platform, setPlatform] = useState('google');
  const [keyInput, setKeyInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const loadKeys = async () => {
    try {
      setLoading(true);
      const list = await api.freellm.listKeys();
      setKeys(list);
    } catch (err: any) {
      console.error('Failed to load FreeLLM keys:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const handleTestKey = async (id: number) => {
    try {
      setTestingId(id);
      await api.freellm.testKey(id);
      await loadKeys();
    } catch (err) {
      console.error('Key test error:', err);
    } finally {
      setTestingId(null);
    }
  };

  const handleDeleteKey = async (id: number) => {
    if (!confirm('Are you sure you want to delete this key?')) return;
    try {
      await api.freellm.deleteKey(id);
      await loadKeys();
    } catch (err) {
      console.error('Failed to delete key:', err);
    }
  };

  const handleToggleKey = async (key: ApiKeyRow) => {
    try {
      await api.freellm.updateKey(key.id, { enabled: !key.enabled });
      setKeys((prev) => prev.map((k) => (k.id === key.id ? { ...k, enabled: !k.enabled } : k)));
    } catch (err) {
      console.error('Failed to toggle key:', err);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const selectedProvider = PROVIDERS.find((p) => p.id === platform);
    if (!selectedProvider?.keyless && !keyInput.trim()) {
      setFormError('API Key is required for this provider.');
      return;
    }

    try {
      setSubmitting(true);
      await api.freellm.addKey({
        platform,
        key: keyInput.trim(),
        label: labelInput.trim() || `${selectedProvider?.name || platform} Key`,
        baseUrl: baseUrlInput.trim() || undefined,
      });
      setIsAddOpen(false);
      setKeyInput('');
      setLabelInput('');
      setBaseUrlInput('');
      await loadKeys();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to add key');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedProviderMeta = PROVIDERS.find((p) => p.id === platform);

  const filteredKeys = keys.filter((k) => 
    k.platform.toLowerCase().includes(search.toLowerCase()) ||
    k.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Add */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-gradient-to-r from-blue-900/20 via-indigo-900/10 to-transparent border border-blue-500/20">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            22+ Providers & Multi-Key Auto Failover
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Keys are encrypted locally with AES-256-GCM. When one provider hits a 429 rate-limit, Byte automatically switches to another key or provider instantly.
          </p>
        </div>
        <button
          onClick={() => setIsAddOpen(true)}
          className="flex items-center space-x-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>Add Provider Key</span>
        </button>
      </div>

      {/* Search & Actions Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter keys by provider or label..."
            className="w-full pl-9 pr-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg text-xs text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500"
          />
        </div>
        <button
          onClick={loadKeys}
          disabled={loading}
          className="p-1.5 rounded-lg border border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-white transition-colors cursor-pointer"
          title="Refresh Keys"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Keys Table */}
      {keys.length === 0 && !loading ? (
        <div className="text-center py-12 px-4 rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)]/50">
          <Key className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-3" />
          <h4 className="text-sm font-semibold text-white">No custom keys added yet</h4>
          <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto mt-1 mb-4">
            Zero-config keyless providers (Kilo, Pollinations, OVHcloud) operate automatically! Add your free Google Gemini, Groq, Cerebras, or Mistral keys to unlock full high-speed models.
          </p>
          <button
            onClick={() => setIsAddOpen(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
          >
            Add Your First Free Key
          </button>
        </div>
      ) : (
        <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden bg-[var(--bg-surface)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)] text-[var(--text-muted)] font-medium">
              <tr>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">Masked Key</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filteredKeys.map((k) => (
                <tr key={k.id} className="hover:bg-[var(--bg-surface-hover)]/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-white flex items-center space-x-2">
                    <span className="capitalize">{k.platform}</span>
                    {k.baseUrl && (
                      <span className="text-[10px] text-[var(--text-muted)] font-mono truncate max-w-[120px]">
                        ({k.baseUrl})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{k.label}</td>
                  <td className="px-4 py-3 font-mono text-[var(--text-muted)] text-[11px]">{k.maskedKey}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        k.status === 'healthy'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : k.status === 'rate_limited'
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          : k.status === 'invalid' || k.status === 'error'
                          ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          : 'bg-gray-500/15 text-gray-400 border border-gray-500/30'
                      }`}
                    >
                      {k.status === 'healthy' ? (
                        <CheckCircle2 className="w-2.5 h-2.5" />
                      ) : k.status === 'rate_limited' ? (
                        <AlertCircle className="w-2.5 h-2.5" />
                      ) : (
                        <XCircle className="w-2.5 h-2.5" />
                      )}
                      <span className="capitalize">{k.status.replace('_', ' ')}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      <button
                        onClick={() => handleToggleKey(k)}
                        className={`text-[11px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                          k.enabled
                            ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                            : 'border-gray-600 text-gray-500 hover:bg-gray-800'
                        }`}
                        title={k.enabled ? 'Click to disable' : 'Click to enable'}
                      >
                        {k.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button
                        onClick={() => handleTestKey(k.id)}
                        disabled={testingId === k.id}
                        className="p-1 rounded text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer"
                        title="Test key connection"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${testingId === k.id ? 'animate-spin text-blue-400' : ''}`} />
                      </button>
                      <button
                        onClick={() => handleDeleteKey(k.id)}
                        className="p-1 rounded text-[var(--text-secondary)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        title="Delete key"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Key Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-subtle)]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-400" />
                Add Free LLM Provider Key
              </h3>
              <button
                onClick={() => setIsAddOpen(false)}
                className="text-[var(--text-muted)] hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-4 text-xs">
              {formError && (
                <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300">
                  {formError}
                </div>
              )}

              {/* Provider Selection */}
              <div>
                <label className="block text-[var(--text-secondary)] font-medium mb-1">
                  Provider / Platform
                </label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] rounded-lg text-white focus:outline-none focus:border-blue-500"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.keyless ? '(Keyless)' : ''}
                    </option>
                  ))}
                </select>
                {selectedProviderMeta?.freeQuota && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-1 flex items-center gap-1">
                    <Info className="w-3 h-3 text-blue-400 inline" />
                    {selectedProviderMeta.freeQuota}
                  </p>
                )}
              </div>

              {/* API Key */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[var(--text-secondary)] font-medium">
                    {selectedProviderMeta?.keyless ? 'API Key (Optional for this provider)' : 'API Key *'}
                  </label>
                  {selectedProviderMeta?.url && (
                    <a
                      href={selectedProviderMeta.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-blue-400 hover:underline flex items-center gap-0.5"
                    >
                      Get free key <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder={
                    platform === 'gemini-free'
                      ? 'Not required (100% Free). Optional: Paste Google cookies for Gemini Advanced'
                      : selectedProviderMeta?.keyless
                      ? 'Not required (keyless)'
                      : 'Enter API Key (e.g. AIzaSy..., gsk_...)'
                  }
                  className="w-full px-3 py-2 bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] rounded-lg text-white font-mono placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Label */}
              <div>
                <label className="block text-[var(--text-secondary)] font-medium mb-1">
                  Label (Optional)
                </label>
                <input
                  type="text"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  placeholder={`My ${selectedProviderMeta?.name} Key #1`}
                  className="w-full px-3 py-2 bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] rounded-lg text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Custom Base URL (for Ollama or Custom) */}
              {(platform === 'ollama' || platform === 'custom') && (
                <div>
                  <label className="block text-[var(--text-secondary)] font-medium mb-1">
                    Base URL {platform === 'ollama' ? '(default: http://localhost:11434)' : ''}
                  </label>
                  <input
                    type="text"
                    value={baseUrlInput}
                    onChange={(e) => setBaseUrlInput(e.target.value)}
                    placeholder={platform === 'ollama' ? 'http://localhost:11434' : 'https://my-endpoint.com/v1'}
                    className="w-full px-3 py-2 bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] rounded-lg text-white font-mono placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold shadow-md shadow-blue-500/20 cursor-pointer disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Add Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
