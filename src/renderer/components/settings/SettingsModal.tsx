import React, { useState, useEffect } from 'react';
import { X, Save, Globe, Sparkles, Sliders, Mic, Eye, EyeOff, Check, Loader2 } from 'lucide-react';
import type { AppSettings } from '@/shared/types';
import { api } from '../../api';

interface SettingsModalProps {
  settings: AppSettings;
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: Partial<AppSettings>) => void | Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  isOpen,
  onClose,
  onSave,
}) => {
  const [form, setForm] = useState<AppSettings>({ ...settings });
  const [showApiKey, setShowApiKey] = useState(false);
  const [showJulesKey, setShowJulesKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Sync form with latest saved settings from database whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setSavedSuccess(false);
      api.getSettings().then((latest) => {
        if (latest) {
          setForm({ ...latest });
        }
      }).catch(() => {
        setForm({ ...settings });
      });
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSavedSuccess(false);

    try {
      await onSave(form);
      setSavedSuccess(true);
      setTimeout(() => {
        setIsSaving(false);
        onClose();
      }, 700);
    } catch (err) {
      console.error('Failed to save settings:', err);
      setIsSaving(false);
    }
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
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#8e9196] hover:text-white hover:bg-[#24262b] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
          {/* Success Banner */}
          {savedSuccess && (
            <div className="flex items-center space-x-2 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-3 py-2 rounded-xl animate-in fade-in duration-150">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>All settings and keys successfully saved to database!</span>
            </div>
          )}

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
                value={form.apiBaseUrl || ''}
                onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1 or local FreeLLM proxy"
                className="w-full bg-[#121316] border border-[#282a30] rounded-lg px-3 py-1.5 text-[#e3e3e3] focus:outline-none focus:border-[#70a6ff] font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#8e9196] mb-1">API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={form.apiKey || ''}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder="freellmapi-... or sk-..."
                  className="w-full bg-[#121316] border border-[#282a30] rounded-lg pl-3 pr-9 py-1.5 text-[#e3e3e3] focus:outline-none focus:border-[#70a6ff] font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8e9196] hover:text-white transition-colors cursor-pointer"
                  title={showApiKey ? 'Hide key' : 'Show key'}
                >
                  {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-[#8e9196] mb-1">Max Autonomous Turns</label>
              <input
                type="number"
                value={form.maxAutonomousTurns || 50}
                onChange={(e) => setForm({ ...form, maxAutonomousTurns: Number(e.target.value) || 50 })}
                min={5}
                max={200}
                className="w-full bg-[#121316] border border-[#282a30] rounded-lg px-3 py-1.5 text-[#e3e3e3] focus:outline-none focus:border-[#70a6ff] font-mono text-xs"
              />
              <span className="text-[10px] text-[#6c707a]">Max autonomous steps before requiring user check-in.</span>
            </div>
          </div>

          {/* Jules AI Section */}
          <div className="border-t border-[#24262b] pt-3.5 space-y-3">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-[#f0f1f4]">
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>Jules AI Configuration (Senior Lead Supervisor)</span>
            </div>

            <div>
              <label className="block text-[11px] text-[#8e9196] mb-1">Jules API Key</label>
              <div className="relative">
                <input
                  type={showJulesKey ? 'text' : 'password'}
                  value={form.julesApiKey || ''}
                  onChange={(e) => setForm({ ...form, julesApiKey: e.target.value })}
                  placeholder="Google Labs Jules API Key (AQ....)"
                  className="w-full bg-[#121316] border border-[#282a30] rounded-lg pl-3 pr-9 py-1.5 text-[#e3e3e3] focus:outline-none focus:border-sky-500 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowJulesKey(!showJulesKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8e9196] hover:text-white transition-colors cursor-pointer"
                  title={showJulesKey ? 'Hide key' : 'Show key'}
                >
                  {showJulesKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-[#8e9196] mb-1">Default GitHub Repo Source</label>
              <input
                type="text"
                value={form.julesDefaultRepo || ''}
                onChange={(e) => setForm({ ...form, julesDefaultRepo: e.target.value })}
                placeholder="sources/github/HyHamza/SeniorEngineer"
                className="w-full bg-[#121316] border border-[#282a30] rounded-lg px-3 py-1.5 text-[#e3e3e3] focus:outline-none focus:border-sky-500 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#8e9196] mb-1">Default Starting Branch</label>
              <input
                type="text"
                value={form.julesDefaultBranch || ''}
                onChange={(e) => setForm({ ...form, julesDefaultBranch: e.target.value })}
                placeholder="main"
                className="w-full bg-[#121316] border border-[#282a30] rounded-lg px-3 py-1.5 text-[#e3e3e3] focus:outline-none focus:border-sky-500 font-mono text-xs"
              />
            </div>
          </div>

          {/* Voice Dictation (Groq Whisper) */}
          <div className="border-t border-[#24262b] pt-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-xs font-semibold text-[#f0f1f4]">
                <Mic className="w-3.5 h-3.5 text-rose-400" />
                <span>Voice Dictation (Groq Whisper AI)</span>
              </div>
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-[#70a6ff] hover:underline cursor-pointer"
              >
                Get Free API Key ↗
              </a>
            </div>

            <div>
              <label className="block text-[11px] text-[#8e9196] mb-1">Groq API Key</label>
              <div className="relative">
                <input
                  type={showGroqKey ? 'text' : 'password'}
                  value={form.groqApiKey || ''}
                  onChange={(e) => setForm({ ...form, groqApiKey: e.target.value })}
                  placeholder="gsk_..."
                  className="w-full bg-[#121316] border border-[#282a30] rounded-lg pl-3 pr-9 py-1.5 text-[#e3e3e3] focus:outline-none focus:border-rose-400 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowGroqKey(!showGroqKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8e9196] hover:text-white transition-colors cursor-pointer"
                  title={showGroqKey ? 'Hide key' : 'Show key'}
                >
                  {showGroqKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <span className="text-[10px] text-[#6c707a] mt-1 block">
                Powers ultra-fast (~200ms) OpenAI Whisper Large v3 voice transcription. 100% free with no credit card required.
              </span>
            </div>
          </div>

          {/* Bottom Actions */}
          <div className="pt-3 border-t border-[#24262b] flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-1.5 rounded-lg bg-[#22242a] text-[#c4c7cf] hover:bg-[#2b2d34] transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-[#1a73e8] hover:bg-[#165ec2] text-white font-medium transition-colors cursor-pointer shadow disabled:opacity-75"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : savedSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-white" />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
