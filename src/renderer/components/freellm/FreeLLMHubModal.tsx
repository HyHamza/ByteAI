import React, { useState } from 'react';
import { 
  Key, 
  BarChart3, 
  Layers, 
  GitBranch, 
  Terminal, 
  X, 
  ShieldCheck, 
  Zap, 
  Sparkles,
  ExternalLink
} from 'lucide-react';
import { KeysTab } from './KeysTab';
import { AnalyticsTab } from './AnalyticsTab';
import { ModelsTab } from './ModelsTab';
import { FallbackTab } from './FallbackTab';
import { PlaygroundTab } from './PlaygroundTab';

interface FreeLLMHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'keys' | 'analytics' | 'models' | 'fallback' | 'playground';
}

type TabType = 'keys' | 'analytics' | 'models' | 'fallback' | 'playground';

export const FreeLLMHubModal: React.FC<FreeLLMHubModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'keys',
}) => {
  const [activeTab, setActiveTab] = useState<TabType>(defaultTab);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-5xl h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-md shadow-blue-500/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm font-bold text-white tracking-wide">
                  Free LLM Engine & Hub
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  In-Process Active
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)]">
                22+ providers • Auto-failover • Dynamic rate-limit decay • Zero external server required
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation Navigation Bar */}
        <div className="px-6 pt-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center space-x-1 shrink-0 overflow-x-auto">
          <button
            onClick={() => setActiveTab('keys')}
            className={`flex items-center space-x-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'keys'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>API Keys & Providers</span>
          </button>

          <button
            onClick={() => setActiveTab('analytics')}
            className={`flex items-center space-x-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'analytics'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Traffic & Cost Analytics</span>
          </button>

          <button
            onClick={() => setActiveTab('models')}
            className={`flex items-center space-x-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'models'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Model Catalog (85+)</span>
          </button>

          <button
            onClick={() => setActiveTab('fallback')}
            className={`flex items-center space-x-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'fallback'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Routing & Failover Ladder</span>
          </button>

          <button
            onClick={() => setActiveTab('playground')}
            className={`flex items-center space-x-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'playground'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Playground</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 p-6 overflow-y-auto bg-[var(--bg-sidebar)]">
          {activeTab === 'keys' && <KeysTab />}
          {activeTab === 'analytics' && <AnalyticsTab />}
          {activeTab === 'models' && <ModelsTab />}
          {activeTab === 'fallback' && <FallbackTab />}
          {activeTab === 'playground' && <PlaygroundTab />}
        </div>
      </div>
    </div>
  );
};
