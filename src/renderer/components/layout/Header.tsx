import React, { useState } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  PanelLeft, 
  MoreVertical, 
  Play, 
  Settings as SettingsIcon,
  Sparkles,
  Bot,
  Moon,
  Square
} from 'lucide-react';
import type { AppMode, AppSettings } from '@/shared/types';
import { useDutyShift } from '../../hooks/useDutyShift';

interface HeaderProps {
  settings: AppSettings;
  availableModels: string[];
  workspaceName: string;
  gitRepo?: string | null;
  gitBranch?: string | null;
  onSelectWorkspace: () => void;
  onToggleMode: (mode: AppMode) => void;
  onChangeModel: (model: string, isAuto: boolean) => void;
  onOpenSettings: () => void;
  isJulesPanelOpen: boolean;
  onToggleJulesPanel: () => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  settings,
  availableModels,
  workspaceName,
  gitRepo,
  gitBranch,
  onSelectWorkspace,
  onToggleMode,
  onChangeModel,
  onOpenSettings,
  isJulesPanelOpen,
  onToggleJulesPanel,
  isSidebarOpen = true,
  onToggleSidebar,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { activeShift, remainingTimeDisplay, stopShift } = useDutyShift();

  return (
    <header className="bg-[var(--bg-sidebar)] border-b border-[var(--border-subtle)] select-none shrink-0 z-30">
      {/* Top Application Menu Bar (Antigravity | File | View | Window) */}
      <div className="h-6 flex items-center justify-between px-3 text-[11px] text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
        <div className="flex items-center space-x-4">
          <span className="font-semibold text-[var(--text-primary)] tracking-wide">Byte</span>
          <button 
            onClick={onSelectWorkspace} 
            className="hover:text-[var(--text-primary)] transition-colors"
          >
            File
          </button>
          <button 
            onClick={onToggleSidebar} 
            className="hover:text-[var(--text-primary)] transition-colors"
          >
            View
          </button>
          <button 
            onClick={onToggleJulesPanel} 
            className="hover:text-[var(--text-primary)] transition-colors"
          >
            Window
          </button>
        </div>

        {/* Git indicator subtle pill in title bar */}
        {gitRepo && (
          <div className="flex items-center space-x-1.5 text-[10px] text-[var(--text-muted)]">
            <span>repo:</span>
            <span className="text-[var(--text-secondary)] font-mono">{gitRepo.replace('sources/github/', '')}</span>
            {gitBranch && <span>({gitBranch})</span>}
          </div>
        )}
      </div>

      {/* Main Toolbar Row */}
      <div className="h-11 flex items-center justify-between px-3">
        {/* Left: Antigravity Logo + Sidebar Toggle + History Arrows */}
        <div className="flex items-center space-x-2">
          {/* Antigravity Stylized Delta/A Logo */}
          <div className="w-7 h-7 flex items-center justify-center text-[var(--text-primary)] mr-1 cursor-default">
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M12 2.5L2 20.5h4.2l1.9-3.6h7.8l1.9 3.6H22L12 2.5zm0 5.4l2.8 5.4H9.2L12 7.9z" />
            </svg>
          </div>

          {/* Sidebar Toggle Icon */}
          <button
            onClick={onToggleSidebar}
            className={`p-1.5 rounded hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors ${
              !isSidebarOpen ? 'text-[var(--text-muted)]' : ''
            }`}
            title="Toggle Sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          {/* Navigation Arrows (Back / Forward) */}
          <div className="flex items-center space-x-0.5 text-[var(--text-muted)]">
            <button className="p-1 rounded hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors" title="Back">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button className="p-1 rounded hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors" title="Forward">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Center: Workspace / Mode indicator chip */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-[var(--bg-sidebar)] rounded-full p-0.5 border border-[var(--border-card)]">
            <button
              onClick={() => onToggleMode('standard')}
              className={`flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all ${
                settings.mode === 'standard'
                  ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Bot className="w-3 h-3 text-emerald-400" />
              <span>Standard</span>
            </button>
            <button
              onClick={() => onToggleMode('jules')}
              className={`flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all ${
                settings.mode === 'jules'
                  ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Sparkles className="w-3 h-3 text-sky-200" />
              <span>Jules Lead</span>
            </button>
          </div>
        </div>

        {/* Right: Duty Shift Badge + Blue Action Pill Button + Menu Dots + Open IDE */}
        <div className="flex items-center space-x-2">
          {/* Active Duty Shift Status Badge */}
          {activeShift && activeShift.status === 'active' && (
            <div className="flex items-center space-x-2 px-3 py-1 bg-amber-500/10 border border-amber-500/30 rounded-full text-xs animate-in fade-in duration-300">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
              <span className="font-semibold text-amber-400 flex items-center space-x-1">
                <Moon className="w-3 h-3 inline mr-1" />
                <span>Duty ({activeShift.totalHours}h):</span>
              </span>
              <span className="font-mono text-amber-200 text-[11px] font-medium">{remainingTimeDisplay || 'Calculating...'}</span>
              <button
                onClick={() => stopShift()}
                className="text-[10px] text-amber-400/80 hover:text-red-400 hover:underline ml-1 cursor-pointer font-medium"
                title="Stop active duty shift"
              >
                Stop
              </button>
            </div>
          )}

          {/* Antigravity Blue Pill: Jules Mission Control */}
          <button
            onClick={onToggleJulesPanel}
            className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              isJulesPanelOpen
                ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)] shadow hover:bg-[var(--bg-surface-hover)]'
                : 'bg-[var(--bg-surface-hover)] text-[#70a6ff] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)]'
            }`}
          >
            <span>Jules Panel</span>
            <span className="text-[11px]">→</span>
          </button>

          {/* Three Dots Menu */}
          <div className="relative">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-1.5 rounded hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title="More options"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {isMenuOpen && (
              <div 
                className="absolute right-0 mt-1 w-44 bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-lg shadow-xl py-1 text-xs text-[var(--text-primary)] z-50"
                onMouseLeave={() => setIsMenuOpen(false)}
              >
                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    onSelectWorkspace();
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-surface-hover)] transition-colors"
                >
                  Change Workspace...
                </button>
                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    onOpenSettings();
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-surface-hover)] transition-colors"
                >
                  Settings & Keys
                </button>
              </div>
            )}
          </div>

          {/* Open IDE Button (styled exactly like Antigravity's "Open IDE" with blue triangle icon) */}
          <button
            onClick={onOpenSettings}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-[var(--text-primary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] transition-colors"
            title="Configure Environment & IDE"
          >
            <Play className="w-3.5 h-3.5 text-[#1a73e8] fill-[#1a73e8]" />
            <span>Open IDE</span>
          </button>
        </div>
      </div>
    </header>
  );
};
