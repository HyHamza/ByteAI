import React from 'react';
import { X, FlaskConical } from 'lucide-react';
import { AILabsView, type AILabsTabType } from './AILabsView';

interface FreeLLMHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: AILabsTabType;
}

export const FreeLLMHubModal: React.FC<FreeLLMHubModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'keys',
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-5xl h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
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

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modular View */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <AILabsView defaultTab={defaultTab} />
        </div>
      </div>
    </div>
  );
};
