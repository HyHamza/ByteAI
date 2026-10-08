import React, { useState } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  PanelLeft, 
  MoreVertical, 
  Play, 
  Settings as SettingsIcon,
  Sparkles,
  Bot
} from 'lucide-react';
import type { AppMode, AppSettings } from '@/shared/types';

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

  return (
    <header className="bg-[#111214] border-b border-[#202226] select-none shrink-0 z-30">
      {/* Top Application Menu Bar (Antigravity | File | View | Window) */}
      <div className="h-6 flex items-center justify-between px-3 text-[11px] text-[#8e9196] border-b border-[#1a1b1e]">
        <div className="flex items-center space-x-4">
          <span className="font-semibold text-white tracking-wide">Byte</span>
          <button 
            onClick={onSelectWorkspace} 
            className="hover:text-white transition-colors"
          >
            File
          </button>
          <button 
            onClick={onToggleSidebar} 
            className="hover:text-white transition-colors"
          >
            View
          </button>
          <button 
            onClick={onToggleJulesPanel} 
            className="hover:text-white transition-colors"
          >
            Window
          </button>
        </div>

        {/* Git indicator subtle pill in title bar */}
        {gitRepo && (
          <div className="flex items-center space-x-1.5 text-[10px] text-[#71757e]">
            <span>repo:</span>
            <span className="text-[#a6aab4] font-mono">{gitRepo.replace('sources/github/', '')}</span>
            {gitBranch && <span>({gitBranch})</span>}
          </div>
        )}
      </div>

      {/* Main Toolbar Row */}
      <div className="h-11 flex items-center justify-between px-3">
        {/* Left: Antigravity Logo + Sidebar Toggle + History Arrows */}
        <div className="flex items-center space-x-2">
          {/* Antigravity Stylized Delta/A Logo */}
          <div className="w-7 h-7 flex items-center justify-center text-white mr-1 cursor-default">
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M12 2.5L2 20.5h4.2l1.9-3.6h7.8l1.9 3.6H22L12 2.5zm0 5.4l2.8 5.4H9.2L12 7.9z" />
            </svg>
          </div>

          {/* Sidebar Toggle Icon */}
          <button
            onClick={onToggleSidebar}
            className={`p-1.5 rounded hover:bg-[#202226] text-[#8e9196] hover:text-white transition-colors ${
              !isSidebarOpen ? 'text-[#50545c]' : ''
            }`}
            title="Toggle Sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          {/* Navigation Arrows (Back / Forward) */}
          <div className="flex items-center space-x-0.5 text-[#5e626a]">
            <button className="p-1 rounded hover:bg-[#202226] hover:text-[#c4c7cf] transition-colors" title="Back">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button className="p-1 rounded hover:bg-[#202226] hover:text-[#c4c7cf] transition-colors" title="Forward">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Center: Workspace / Mode indicator chip */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-[#18191c] rounded-full p-0.5 border border-[#27292f]">
            <button
              onClick={() => onToggleMode('standard')}
              className={`flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all ${
                settings.mode === 'standard'
                  ? 'bg-[#26282e] text-white shadow-sm'
                  : 'text-[#7e828d] hover:text-[#c4c7cf]'
              }`}
            >
              <Bot className="w-3 h-3 text-emerald-400" />
              <span>Standard</span>
            </button>
            <button
              onClick={() => onToggleMode('jules')}
              className={`flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all ${
                settings.mode === 'jules'
                  ? 'bg-[#1a73e8] text-white shadow-sm'
                  : 'text-[#7e828d] hover:text-[#c4c7cf]'
              }`}
            >
              <Sparkles className="w-3 h-3 text-sky-200" />
              <span>Jules Lead</span>
            </button>
          </div>
        </div>

        {/* Right: Blue Action Pill Button + Menu Dots + Open IDE */}
        <div className="flex items-center space-x-2">
          {/* Antigravity Blue Pill: Jules Mission Control */}
          <button
            onClick={onToggleJulesPanel}
            className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              isJulesPanelOpen
                ? 'bg-[#1a73e8] text-white shadow hover:bg-[#1558b0]'
                : 'bg-[#1e222b] text-[#70a6ff] hover:bg-[#252b37] border border-[#2e3748]'
            }`}
          >
            <span>Jules Panel</span>
            <span className="text-[11px]">→</span>
          </button>

          {/* Three Dots Menu */}
          <div className="relative">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-1.5 rounded hover:bg-[#202226] text-[#8e9196] hover:text-white transition-colors"
              title="More options"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {isMenuOpen && (
              <div 
                className="absolute right-0 mt-1 w-44 bg-[#1b1c20] border border-[#2b2d33] rounded-lg shadow-xl py-1 text-xs text-[#c4c7cf] z-50"
                onMouseLeave={() => setIsMenuOpen(false)}
              >
                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    onSelectWorkspace();
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#26282e] transition-colors"
                >
                  Change Workspace...
                </button>
                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    onOpenSettings();
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#26282e] transition-colors"
                >
                  Settings & Keys
                </button>
              </div>
            )}
          </div>

          {/* Open IDE Button (styled exactly like Antigravity's "Open IDE" with blue triangle icon) */}
          <button
            onClick={onOpenSettings}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-[#c4c7cf] hover:text-white hover:bg-[#202226] border border-[#282a30] transition-colors"
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
