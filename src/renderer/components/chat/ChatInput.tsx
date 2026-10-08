import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus, 
  ArrowRight, 
  Square, 
  Mic, 
  ChevronDown, 
  Folder, 
  Sparkles, 
  Bot, 
  ShieldCheck 
} from 'lucide-react';
import type { AppMode } from '@/shared/types';

interface ChatInputProps {
  onSendMessage: (text: string) => void;
  onCancel: () => void;
  isStreaming: boolean;
  mode: AppMode;
  onToggleMode: (mode: AppMode) => void;
  availableModels: string[];
  selectedModel: string;
  isAutoModel: boolean;
  onChangeModel: (model: string, isAuto: boolean) => void;
  workspaceName: string;
  onSelectWorkspace: () => void;
  disabled?: boolean;
  isCenteredLayout?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  onCancel,
  isStreaming,
  mode,
  onToggleMode,
  availableModels,
  selectedModel,
  isAutoModel,
  onChangeModel,
  workspaceName,
  onSelectWorkspace,
  disabled = false,
  isCenteredLayout = false,
}) => {
  const [text, setText] = useState('');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!text.trim() || isStreaming || disabled) return;
    onSendMessage(text.trim());
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, isCenteredLayout ? 56 : 40), 200)}px`;
    }
  }, [text, isCenteredLayout]);

  const activeModelDisplay = isAutoModel ? 'Gemini 2.5 Flash Medium' : selectedModel;

  return (
    <div className={`w-full flex flex-col items-center ${isCenteredLayout ? 'px-4 py-8' : 'px-4 pb-4 pt-1 bg-gradient-to-t from-[#131314] to-transparent'}`}>
      {/* If Centered Layout: Top Workspace Chip */}
      {isCenteredLayout && (
        <button
          onClick={onSelectWorkspace}
          className="flex items-center space-x-1.5 px-3 py-1.5 mb-5 rounded-full text-xs font-medium text-[#c4c7cf] hover:text-white bg-[#1a1b1f] hover:bg-[#23242a] border border-[#2b2d34] transition-colors cursor-pointer"
        >
          <Folder className="w-3.5 h-3.5 text-[#8e9196]" />
          <span>{workspaceName || 'Select Workspace'}</span>
          <ChevronDown className="w-3 h-3 text-[#70747e]" />
        </button>
      )}

      {/* Floating Prompt Card (The Antigravity input box) */}
      <div className={`w-full ${isCenteredLayout ? 'max-w-2xl' : 'max-w-3xl'} bg-[#1c1d21] border border-[#2c2e35] rounded-2xl p-3 shadow-2xl transition-all focus-within:border-[#3d404a]`}>
        <form onSubmit={handleSubmit} className="flex flex-col">
          {/* Text input area */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything, @ to mention, / for actions"
            disabled={disabled || isStreaming}
            rows={isCenteredLayout ? 2 : 1}
            className="w-full bg-transparent text-[#e3e3e3] placeholder-[#6c707a] text-[13px] resize-none focus:outline-none p-1 font-sans leading-relaxed min-h-[44px]"
          />

          {/* Bottom Card Controls Row */}
          <div className="flex items-center justify-between pt-2 mt-1 border-t border-[#25272e]/60">
            {/* Left Tools: + attachment & Model Selector Pill */}
            <div className="flex items-center space-x-2 relative">
              {/* Context Attachment Button (+) */}
              <button
                type="button"
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#8e9196] hover:text-white hover:bg-[#26282e] transition-colors cursor-pointer"
                title="Add context or files"
              >
                <Plus className="w-4 h-4" />
              </button>

              {/* Model Pill with Shield Icon */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium text-[#c4c7cf] hover:text-white bg-[#24262b] hover:bg-[#2b2d34] border border-[#30333b] transition-colors cursor-pointer"
                >
                  <span>{activeModelDisplay}</span>
                  <ShieldCheck className="w-3.5 h-3.5 text-[#fbbf24]" />
                  <ChevronDown className="w-3 h-3 text-[#7a7e88]" />
                </button>

                {isModelDropdownOpen && (
                  <div 
                    className="absolute bottom-9 left-0 w-52 bg-[#1b1c20] border border-[#2b2d33] rounded-xl shadow-2xl py-1 text-xs text-[#c4c7cf] z-50 max-h-56 overflow-y-auto"
                    onMouseLeave={() => setIsModelDropdownOpen(false)}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onChangeModel(selectedModel, true);
                        setIsModelDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-1.5 hover:bg-[#26282e] ${isAutoModel ? 'text-[#70a6ff] font-medium' : ''}`}
                    >
                      <span>Gemini 2.5 Flash Medium (Auto)</span>
                      <ShieldCheck className="w-3.5 h-3.5 text-[#fbbf24]" />
                    </button>
                    {availableModels.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          onChangeModel(m, false);
                          setIsModelDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 hover:bg-[#26282e] ${!isAutoModel && selectedModel === m ? 'text-[#70a6ff] font-medium' : ''}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Tools: Mic & Send Arrow */}
            <div className="flex items-center space-x-2">
              <button
                type="button"
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#8e9196] hover:text-white hover:bg-[#26282e] transition-colors cursor-pointer"
                title="Voice input"
              >
                <Mic className="w-4 h-4" />
              </button>

              {isStreaming ? (
                <button
                  type="button"
                  onClick={onCancel}
                  className="w-7 h-7 rounded-full flex items-center justify-center bg-red-600 hover:bg-red-500 text-white transition-colors cursor-pointer shadow"
                  title="Stop generating"
                >
                  <Square className="w-3 h-3 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!text.trim() || disabled}
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                    text.trim() && !disabled
                      ? mode === 'jules'
                        ? 'bg-[#1a73e8] text-white hover:bg-[#165ec2] shadow-md'
                        : 'bg-[#1a73e8] text-white hover:bg-[#165ec2] shadow-md'
                      : 'bg-[#282a30] text-[#5e626a] cursor-not-allowed'
                  }`}
                  title="Send message"
                >
                  <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      {/* Under Prompt Card: Mode Chip (Local Autonomous vs Jules Lead) */}
      {isCenteredLayout && (
        <div className="mt-3 relative">
          <button
            type="button"
            onClick={() => setIsModeDropdownOpen(!isModeDropdownOpen)}
            className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium text-[#9da0a8] hover:text-[#e3e3e3] hover:bg-[#1c1d21] transition-colors cursor-pointer"
          >
            {mode === 'jules' ? (
              <>
                <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                <span>Jules Lead (Cloud)</span>
              </>
            ) : (
              <>
                <Bot className="w-3.5 h-3.5 text-emerald-400" />
                <span>Local</span>
              </>
            )}
            <ChevronDown className="w-3 h-3 text-[#70747e]" />
          </button>

          {isModeDropdownOpen && (
            <div 
              className="absolute top-8 left-1/2 -translate-x-1/2 w-48 bg-[#1b1c20] border border-[#2b2d33] rounded-xl shadow-2xl py-1 text-xs text-[#c4c7cf] z-50"
              onMouseLeave={() => setIsModeDropdownOpen(false)}
            >
              <button
                type="button"
                onClick={() => {
                  onToggleMode('standard');
                  setIsModeDropdownOpen(false);
                }}
                className={`w-full flex items-center space-x-2 px-3 py-2 hover:bg-[#26282e] ${mode === 'standard' ? 'text-emerald-400 font-medium' : ''}`}
              >
                <Bot className="w-3.5 h-3.5" />
                <span>Local Autonomous</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onToggleMode('jules');
                  setIsModeDropdownOpen(false);
                }}
                className={`w-full flex items-center space-x-2 px-3 py-2 hover:bg-[#26282e] ${mode === 'jules' ? 'text-sky-400 font-medium' : ''}`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Jules Lead (Google Labs)</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
