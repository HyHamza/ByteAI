import React, { useState } from 'react';
import { 
  Key, 
  BarChart3, 
  Layers, 
  GitBranch, 
  Terminal, 
  FlaskConical,
  Sparkles
} from 'lucide-react';
import { KeysTab } from './KeysTab';
import { AnalyticsTab } from './AnalyticsTab';
import { ModelsTab } from './ModelsTab';
import { FallbackTab } from './FallbackTab';
import { PlaygroundTab } from './PlaygroundTab';

export type AILabsTabType = 'keys' | 'analytics' | 'models' | 'fallback' | 'playground';

interface AILabsViewProps {
  defaultTab?: AILabsTabType;
  showHeader?: boolean;
}

export const AILabsView: React.FC<AILabsViewProps> = ({
  defaultTab = 'keys',
  showHeader = false,
}) => {
  const [activeTab, setActiveTab] = useState<AILabsTabType>(defaultTab);

  return (
    <div className="flex flex-col h-full w-full">
      {showHeader && (
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-md shadow-sky-500/20">
              <FlaskConical className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm font-bold text-white tracking-wide">
                  Byte AI Labs
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  In-Process Active
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)]">
                Native Multi-Provider Mesh • Smart Auto-Failover • Cost Analytics • 22+ Providers • Zero External Server
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation Bar */}
      <div className="px-6 pt-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center space-x-1 shrink-0 overflow-x-auto">
        <button
          onClick={() => setActiveTab('keys')}
          className={`flex items-center space-x-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'keys'
              ? 'border-sky-500 text-sky-400'
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
              ? 'border-sky-500 text-sky-400'
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
              ? 'border-sky-500 text-sky-400'
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
              ? 'border-sky-500 text-sky-400'
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
              ? 'border-sky-500 text-sky-400'
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
  );
};
