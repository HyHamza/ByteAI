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
  Square,
  Zap,
  Pause,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Ban,
  ChevronDown,
  FlaskConical
} from 'lucide-react';
import type { AppMode, AppSettings, ChatSession, TaskState } from '@/shared/types';
import { useDutyShift } from '../../hooks/useDutyShift';
import { byteLogoBw } from '../../assets';

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
  isAutonomousMode?: boolean;
  onToggleAutonomousMode?: () => void;
  activeSession?: ChatSession;
  onUpdateTaskState?: (state: TaskState) => void;
  onOpenFreeLLMHub?: () => void;
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
  isAutonomousMode,
  onToggleAutonomousMode,
  activeSession,
  onUpdateTaskState,
  onOpenFreeLLMHub,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isTaskStateMenuOpen, setIsTaskStateMenuOpen] = useState(false);
  const { activeShift, remainingTimeDisplay, stopShift } = useDutyShift();

  return (
    <header className="bg-[var(--bg-sidebar)] border-b border-[var(--border-subtle)] select-none shrink-0 z-30">
      {/* Top Application Menu Bar (Antigravity | File | View | Window) */}
      <div className="h-7 flex items-center justify-between px-3.5 text-[12px] text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
        <div className="flex items-center space-x-4">
          <span className="font-semibold text-[var(--text-primary)] tracking-wide">Byte</span>
          <button 
            onClick={onSelectWorkspace} 
            className="hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            File
          </button>
          <button 
            onClick={onToggleSidebar} 
            className="hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            View
          </button>
          <button 
            onClick={onToggleJulesPanel} 
            className="hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            Window
          </button>
        </div>

        {/* Git indicator subtle pill in title bar */}
        {gitRepo && (
          <div className="flex items-center space-x-1.5 text-[11px] text-[var(--text-muted)]">
            <span>repo:</span>
            <span className="text-[var(--text-secondary)] font-mono">{gitRepo.replace('sources/github/', '')}</span>
            {gitBranch && <span>({gitBranch})</span>}
          </div>
        )}
      </div>

      {/* Main Toolbar Row */}
      <div className="h-12 flex items-center justify-between px-3.5">
        {/* Left: Antigravity Logo + Sidebar Toggle + History Arrows */}
        <div className="flex items-center space-x-2">
          {/* Byte B&W App Logo */}
          <div className="w-8 h-8 flex items-center justify-center mr-1 cursor-default" title="Byte AI">
            <img src={byteLogoBw} alt="Byte" className="w-7 h-7 object-contain select-none" />
          </div>

          {/* Sidebar Toggle Icon */}
          <button
            onClick={onToggleSidebar}
            className={`p-1.5 rounded hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer ${
              !isSidebarOpen ? 'text-[var(--text-muted)]' : ''
            }`}
            title="Toggle Sidebar"
          >
            <PanelLeft className="w-4.5 h-4.5" />
          </button>

          {/* Navigation Arrows (Back / Forward) */}
          <div className="flex items-center space-x-0.5 text-[var(--text-muted)]">
            <button className="p-1 rounded hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer" title="Back">
              <ChevronLeft className="w-4.5 h-4.5" />
            </button>
            <button className="p-1 rounded hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer" title="Forward">
              <ChevronRight className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Center: Workspace / Mode indicator chip */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-[var(--bg-sidebar)] rounded-full p-0.5 border border-[var(--border-card)]">
            <button
              onClick={() => onToggleMode('standard')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-[12px] font-medium transition-all cursor-pointer ${
                settings.mode === 'standard'
                  ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Bot className="w-3.5 h-3.5 text-emerald-400" />
              <span>Standard</span>
            </button>
            <button
              onClick={() => onToggleMode('jules')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-[12px] font-medium transition-all cursor-pointer ${
                settings.mode === 'jules'
                  ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-200" />
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

          {/* Autonomous Mode Active Badge */}
          {isAutonomousMode && (
            <button
              type="button"
              onClick={onToggleAutonomousMode}
              className="flex items-center space-x-1.5 px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 rounded-full text-xs text-amber-300 font-medium hover:bg-amber-500/20 transition-all cursor-pointer"
              title="Autonomous Mode is ON: AI works continuously without waiting for input. Click to toggle."
            >
              <Zap className="w-3 h-3 text-amber-400 fill-amber-400" />
              <span>Autonomous</span>
            </button>
          )}

          {/* Task State Pill & Status Menu */}
          {activeSession && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsTaskStateMenuOpen(!isTaskStateMenuOpen)}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
                  activeSession.taskState === 'completed'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                    : activeSession.taskState === 'paused'
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25'
                    : activeSession.taskState === 'waiting_jules'
                    ? 'bg-purple-500/15 text-purple-300 border-purple-500/40 hover:bg-purple-500/25'
                    : activeSession.taskState === 'awaiting_feedback'
                    ? 'bg-amber-500/20 text-amber-200 border-amber-500/50 hover:bg-amber-500/30 shadow-sm shadow-amber-500/10'
                    : activeSession.taskState === 'failed'
                    ? 'bg-rose-500/15 text-rose-300 border-rose-500/40 hover:bg-rose-500/25'
                    : activeSession.taskState === 'cancelled'
                    ? 'bg-gray-500/15 text-gray-300 border-gray-500/30 hover:bg-gray-500/25'
                    : activeSession.taskState === 'in_progress'
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/25'
                    : 'bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                }`}
                title="Task State: Click to change state (Pause, Resume, Complete, Cancel)"
              >
                {activeSession.taskState === 'completed' ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                ) : activeSession.taskState === 'paused' ? (
                  <Pause className="w-3 h-3 text-amber-400 fill-amber-400" />
                ) : activeSession.taskState === 'waiting_jules' ? (
                  <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                ) : activeSession.taskState === 'awaiting_feedback' ? (
                  <AlertCircle className="w-3 h-3 text-amber-400 animate-bounce" />
                ) : activeSession.taskState === 'failed' ? (
                  <XCircle className="w-3 h-3 text-rose-400" />
                ) : activeSession.taskState === 'cancelled' ? (
                  <Ban className="w-3 h-3 text-gray-400" />
                ) : activeSession.taskState === 'in_progress' ? (
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-gray-400" />
                )}
                <span className="capitalize">
                  {activeSession.taskState === 'waiting_jules'
                    ? 'Jules Working'
                    : activeSession.taskState === 'awaiting_feedback'
                    ? 'Needs Input'
                    : activeSession.taskState?.replace('_', ' ') || 'Idle'}
                </span>
                <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
              </button>

              {isTaskStateMenuOpen && (
                <div
                  className="absolute right-0 mt-1 w-48 bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] rounded-xl shadow-2xl py-1 text-xs text-[var(--text-primary)] z-50 animate-in fade-in zoom-in-95 duration-100"
                  onMouseLeave={() => setIsTaskStateMenuOpen(false)}
                >
                  <div className="px-3 py-1.5 text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider border-b border-[var(--border-subtle)]">
                    Task Status
                  </div>

                  {activeSession.taskState !== 'in_progress' && (
                    <button
                      onClick={() => {
                        onUpdateTaskState?.('in_progress');
                        setIsTaskStateMenuOpen(false);
                      }}
                      className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[var(--bg-surface-hover)] text-cyan-300 text-left transition-colors cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-cyan-400 text-cyan-400" />
                      <span>In Progress / Resume</span>
                    </button>
                  )}

                  {activeSession.taskState !== 'paused' && (
                    <button
                      onClick={() => {
                        onUpdateTaskState?.('paused');
                        setIsTaskStateMenuOpen(false);
                      }}
                      className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[var(--bg-surface-hover)] text-amber-300 text-left transition-colors cursor-pointer"
                    >
                      <Pause className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      <span>Pause Task</span>
                    </button>
                  )}

                  {activeSession.taskState !== 'completed' && (
                    <button
                      onClick={() => {
                        onUpdateTaskState?.('completed');
                        setIsTaskStateMenuOpen(false);
                      }}
                      className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[var(--bg-surface-hover)] text-emerald-300 text-left transition-colors cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Mark as Completed</span>
                    </button>
                  )}

                  {activeSession.taskState !== 'cancelled' && (
                    <button
                      onClick={() => {
                        onUpdateTaskState?.('cancelled');
                        setIsTaskStateMenuOpen(false);
                      }}
                      className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-[var(--bg-surface-hover)] text-gray-400 text-left transition-colors cursor-pointer"
                    >
                      <Ban className="w-3.5 h-3.5 text-gray-400" />
                      <span>Cancel Task</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Free LLM Hub Button */}
          {/* AI Labs Button */}
          <button
            onClick={onOpenFreeLLMHub}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-sky-900/40 to-indigo-900/40 text-sky-300 hover:text-white hover:from-sky-800/50 hover:to-indigo-800/50 border border-sky-500/30 transition-all cursor-pointer shadow-xs shadow-sky-500/10"
            title="Open Byte AI Labs (Multi-Provider Smart Routing, Keys, Catalog & Analytics)"
          >
            <FlaskConical className="w-3.5 h-3.5 text-sky-400" />
            <span>AI Labs</span>
          </button>

          {/* Antigravity Blue Pill: Jules Mission Control */}
          <button
            onClick={onToggleJulesPanel}
            className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              isJulesPanelOpen
                ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)] shadow hover:bg-[var(--bg-surface-hover)]'
                : 'bg-[var(--bg-surface-hover)] text-[#70a6ff] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)]'
            }`}
          >
            <span>Jules Panel</span>
            <span className="text-[12px]">→</span>
          </button>

          {/* Three Dots Menu */}
          <div className="relative">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-1.5 rounded hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              title="More options"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {isMenuOpen && (
              <div 
                className="absolute right-0 mt-1 w-48 bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-lg shadow-xl py-1 text-xs text-[var(--text-primary)] z-50"
                onMouseLeave={() => setIsMenuOpen(false)}
              >
                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    onOpenFreeLLMHub?.();
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-surface)] text-sky-300 flex items-center space-x-2 transition-colors cursor-pointer"
                >
                  <FlaskConical className="w-3.5 h-3.5 text-sky-400" />
                  <span>AI Labs</span>
                </button>
                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    onSelectWorkspace();
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-surface)] transition-colors"
                >
                  Change Workspace...
                </button>
                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    onOpenSettings();
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-surface)] transition-colors"
                >
                  Settings & Keys
                </button>
              </div>
            )}
          </div>

          {/* Open IDE Button (styled exactly like Antigravity's "Open IDE" with blue triangle icon) */}
          <button
            onClick={onOpenSettings}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] transition-colors cursor-pointer shadow-xs"
            title="Configure Environment & IDE"
          >
            <Play className="w-4 h-4 text-[#1a73e8] fill-[#1a73e8]" />
            <span>Open IDE</span>
          </button>
        </div>
      </div>
    </header>
  );
};
