import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, Sparkles, Bot } from 'lucide-react';
import type { AppMode } from '@/shared/types';

interface ChatInputProps {
  onSendMessage: (text: string) => void;
  onCancel: () => void;
  isStreaming: boolean;
  mode: AppMode;
  disabled?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  onCancel,
  isStreaming,
  mode,
  disabled = false,
}) => {
  const [text, setText] = useState('');
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
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [text]);

  return (
    <div className="p-4 bg-[#161b22] border-t border-[#30363d] shrink-0">
      <form onSubmit={handleSubmit} className="relative flex flex-col rounded-lg border border-[#30363d] bg-[#0d1117] p-2 focus-within:border-emerald-500/70 transition-colors">
        {/* Mode Indicator Bar */}
        <div className="flex items-center justify-between pb-1.5 px-1 border-b border-[#30363d]/50 mb-1">
          <div className="flex items-center space-x-1.5 text-[11px] font-medium text-[#8b949e]">
            {mode === 'jules' ? (
              <>
                <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                <span className="text-sky-300">Jules Senior Engineer Mode</span>
                <span className="text-[#8b949e]">(Delegating implementation)</span>
              </>
            ) : (
              <>
                <Bot className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-300">Standard Autonomous Mode</span>
                <span className="text-[#8b949e]">(Direct local execution)</span>
              </>
            )}
          </div>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === 'jules'
              ? 'Instruct Senior Lead to delegate an objective to Jules (e.g. "Fix auth token refresh bug using Jules")...'
              : 'Enter coding objective or task to execute autonomously...'
          }
          disabled={disabled || isStreaming}
          rows={2}
          className="w-full bg-transparent text-[#c9d1d9] placeholder-[#8b949e] text-xs resize-none focus:outline-none py-1 px-1 font-sans leading-relaxed"
        />

        <div className="flex items-center justify-end pt-1">
          {isStreaming ? (
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center space-x-1 px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-medium transition-colors"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!text.trim() || disabled}
              className={`flex items-center space-x-1 px-3 py-1 rounded text-xs font-medium transition-colors ${
                text.trim() && !disabled
                  ? mode === 'jules'
                    ? 'bg-sky-600 hover:bg-sky-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-[#21262d] text-[#8b949e] cursor-not-allowed'
              }`}
            >
              <Send className="w-3 h-3" />
              <span>Send</span>
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
