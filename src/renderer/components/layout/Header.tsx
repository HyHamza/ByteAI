import React from 'react';
import { 
  FolderOpen, 
  Settings, 
  Bot, 
  Sparkles, 
  Cpu, 
  Layers 
} from 'lucide-react';
import type { AppMode, AppSettings } from '@/shared/types';

interface HeaderProps {
  settings: AppSettings;
  availableModels: string[];
  workspaceName: string;
  onSelectWorkspace: () => void;
  onToggleMode: (mode: AppMode) => void;
  onChangeModel: (model: string, isAuto: boolean) => void;
  onOpenSettings: () => void;
  isJulesPanelOpen: boolean;
  onToggleJulesPanel: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  settings,
  availableModels,
  workspaceName,
  onSelectWorkspace,
  onToggleMode,
  onChangeModel,
  onOpenSettings,
  isJulesPanelOpen,
  onToggleJulesPanel,
}) => {
  return (
    <header className="h-12 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between px-4 select-none shrink-0 z-20">
      {/* Brand & Workspace */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2 font-semibold text-sm tracking-wide text-white">
          <div className="w-6 h-6 rounded bg-gradient-to-tr from-emerald-500 to-sky-500 flex items-center justify-center text-white font-bold text-xs shadow-sm">
            SE
          </div>
          <span className="hidden sm:inline">SeniorEngineer</span>
        </div>

        {/* Workspace directory picker */}
        <button
          onClick={onSelectWorkspace}
          className="flex items-center space-x-1.5 px-2.5 py-1 text-xs font-mono bg-[#0d1117] hover:bg-[#21262d] text-[#8b949e] hover:text-[#c9d1d9] border border-[#30363d] rounded-md transition-colors"
          title={settings.activeWorkspacePath || 'Select workspace directory'}
        >
          <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
          <span className="max-w-[140px] truncate">{workspaceName || 'Select Folder'}</span>
        </button>
      </div>

      {/* Mode Switcher Toggle: Standard vs Jules Senior Lead */}
      <div className="flex items-center bg-[#0d1117] p-1 rounded-lg border border-[#30363d]">
        <button
          onClick={() => onToggleMode('standard')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
            settings.mode === 'standard'
              ? 'bg-[#21262d] text-emerald-400 shadow-sm border border-emerald-500/30'
              : 'text-[#8b949e] hover:text-white'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>Standard AI</span>
        </button>

        <button
          onClick={() => onToggleMode('jules')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
            settings.mode === 'jules'
              ? 'bg-[#0369a1] text-sky-200 shadow-sm border border-sky-400/40'
              : 'text-[#8b949e] hover:text-sky-400'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Jules Lead</span>
        </button>
      </div>

      {/* Model Selector & Jules Control Panel Toggle */}
      <div className="flex items-center space-x-2">
        <div className="relative">
          <select
            value={settings.isAutoModel ? 'auto' : settings.selectedModel}
            onChange={(e) => {
              if (e.target.value === 'auto') {
                onChangeModel(settings.selectedModel, true);
              } else {
                onChangeModel(e.target.value, false);
              }
            }}
            className="text-xs bg-[#0d1117] text-[#c9d1d9] border border-[#30363d] rounded-md px-2.5 py-1 pr-6 hover:bg-[#21262d] cursor-pointer focus:outline-none"
          >
            <option value="auto">✨ Auto Router</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* Toggle Jules Right Panel */}
        <button
          onClick={onToggleJulesPanel}
          className={`p-1.5 rounded-md border text-xs flex items-center space-x-1 transition-colors ${
            isJulesPanelOpen
              ? 'bg-[#0369a1]/20 border-sky-500/50 text-sky-400'
              : 'bg-[#0d1117] border-[#30363d] text-[#8b949e] hover:text-[#c9d1d9]'
          }`}
          title="Toggle Jules Mission Control Panel"
        >
          <Layers className="w-4 h-4" />
        </button>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-md bg-[#0d1117] hover:bg-[#21262d] border border-[#30363d] text-[#8b949e] hover:text-[#c9d1d9] transition-colors"
          title="Settings & API Endpoints"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
