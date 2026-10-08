import React, { useState } from 'react';
import { X, Save, Globe, Sparkles, Sliders } from 'lucide-react';
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
    <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-[#18191c] border border-[#2b2d34] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col text-xs text-[#c4c7cf]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#24262b] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-[#70a6ff]" />
            <h3 className="text-sm font-semibold text-white">Application Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#8e9196] hover:text-white hover:bg-[#24262b] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
          {/* LLM API Section */}
          <div className="space-y-3">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-[#f0f1f4]">
              <Globe className="w-3.5 h-3.5 text-[#70a6ff]" />
              <span>LLM Endpoint & Gateway (FreeLLM / OpenAI Compatible)</span>
            </div>

            <div>
              <label className="block text-[11px] text-[#8e9196] mb-1">API Base URL</label>
              <input
                type="text"
                value={form.apiBaseUrl}
                onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1 or local FreeLLM proxy"
                className="w-full bg-[#121316] border border-[#282a30] rounded-lg px-3 py-1.5 text-[#e3e3e3] focus:outline-none focus:border-[#70a6ff] font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#8e9196] mb-1">API Key</label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full bg-[#121316] border border-[#282a30] rounded-lg px-3 py-1.5 text-[#e3e3e3] focus:outline-none focus:border-[#70a6ff] font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#8e9196] mb-1">Max Autonomous Turns</label>
              <input
                type="number"
                value={form.maxAutonomousTurns}
                onChange={(e) => setForm({ ...form, maxAutonomousTurns: Number(e.target.value) || 50 })}
                min={5}
                max={200}
                className="w-full bg-[#121316] border border-[#282a30] rounded-lg px-3 py-1.5 text-[#e3e3e3] focus:outline-none focus:border-[#70a6ff] font-mono text-xs"
              />
              <span className="text-[10px] text-[#6c707a]">Max autonomous steps before requiring user check-in.</span>
            </div>
          </div>

          <div className="border-t border-[#24262b] pt-3.5 space-y-3">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-[#f0f1f4]">
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>Jules AI Configuration (Senior Lead Supervisor)</span>
            </div>

            <div>
              <label className="block text-[11px] text-[#8e9196] mb-1">Jules API Key</label>
              <input
                type="password"
                value={form.julesApiKey}
                onChange={(e) => setForm({ ...form, julesApiKey: e.target.value })}
                placeholder="Google Labs Jules API Key"
                className="w-full bg-[#121316] border border-[#282a30] rounded-lg px-3 py-1.5 text-[#e3e3e3] focus:outline-none focus:border-sky-500 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#8e9196] mb-1">Default GitHub Repo Source</label>
              <input
                type="text"
                value={form.julesDefaultRepo}
                onChange={(e) => setForm({ ...form, julesDefaultRepo: e.target.value })}
                placeholder="sources/github/HyHamza/SeniorEngineer"
                className="w-full bg-[#121316] border border-[#282a30] rounded-lg px-3 py-1.5 text-[#e3e3e3] focus:outline-none focus:border-sky-500 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#8e9196] mb-1">Default Starting Branch</label>
              <input
                type="text"
                value={form.julesDefaultBranch}
                onChange={(e) => setForm({ ...form, julesDefaultBranch: e.target.value })}
                placeholder="main"
                className="w-full bg-[#121316] border border-[#282a30] rounded-lg px-3 py-1.5 text-[#e3e3e3] focus:outline-none focus:border-sky-500 font-mono text-xs"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-[#24262b] flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-[#22242a] text-[#c4c7cf] hover:bg-[#2b2d34] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-[#1a73e8] hover:bg-[#165ec2] text-white font-medium transition-colors cursor-pointer shadow"
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
