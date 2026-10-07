import React, { useState } from 'react';
import { X, Save, Key, Globe, Sparkles, Sliders } from 'lucide-react';
import type { AppSettings } from '@/shared/types';

interface SettingsModalProps {
  settings: AppSettings;
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: Partial<AppSettings>) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  isOpen,
  onClose,
  onSave,
}) => {
  const [form, setForm] = useState<AppSettings>({ ...settings });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-[#30363d] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">Application Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto max-h-[75vh] text-xs">
          {/* LLM API Section */}
          <div className="space-y-3">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-[#c9d1d9]">
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              <span>LLM Endpoint & Gateway (FreeLLM / OpenAI Compatible)</span>
            </div>

            <div>
              <label className="block text-[11px] text-[#8b949e] mb-1">API Base URL</label>
              <input
                type="text"
                value={form.apiBaseUrl}
                onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1 or local FreeLLM proxy"
                className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-1.5 text-[#c9d1d9] focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#8b949e] mb-1">API Key</label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-1.5 text-[#c9d1d9] focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#8b949e] mb-1">Max Autonomous Turns</label>
              <input
                type="number"
                value={form.maxAutonomousTurns}
                onChange={(e) => setForm({ ...form, maxAutonomousTurns: Number(e.target.value) || 50 })}
                min={5}
                max={200}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-1.5 text-[#c9d1d9] focus:outline-none focus:border-emerald-500 font-mono"
              />
              <span className="text-[10px] text-[#8b949e]">Max autonomous steps before requiring user check-in.</span>
            </div>
          </div>

          <div className="border-t border-[#30363d] pt-3 space-y-3">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-[#c9d1d9]">
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>Jules AI Configuration (Senior Lead Supervisor)</span>
            </div>

            <div>
              <label className="block text-[11px] text-[#8b949e] mb-1">Jules API Key</label>
              <input
                type="password"
                value={form.julesApiKey}
                onChange={(e) => setForm({ ...form, julesApiKey: e.target.value })}
                placeholder="Google Labs Jules API Key"
                className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-1.5 text-[#c9d1d9] focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#8b949e] mb-1">Default GitHub Repo Source</label>
              <input
                type="text"
                value={form.julesDefaultRepo}
                onChange={(e) => setForm({ ...form, julesDefaultRepo: e.target.value })}
                placeholder="sources/github/HyHamza/SeniorEngineer"
                className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-1.5 text-[#c9d1d9] focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#8b949e] mb-1">Default Starting Branch</label>
              <input
                type="text"
                value={form.julesDefaultBranch}
                onChange={(e) => setForm({ ...form, julesDefaultBranch: e.target.value })}
                placeholder="main"
                className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-1.5 text-[#c9d1d9] focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded bg-[#21262d] text-[#c9d1d9] hover:bg-[#30363d] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Changes</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
