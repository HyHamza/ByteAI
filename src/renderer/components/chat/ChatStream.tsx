import React, { useEffect, useRef } from 'react';
import { User, Bot, Sparkles, Loader2 } from 'lucide-react';
import type { ChatMessage, AppMode, ToolExecutionRecord } from '@/shared/types';
import { ToolCard } from './ToolCard';

interface ChatStreamProps {
  messages: ChatMessage[];
  currentStreamContent: string;
  isStreaming: boolean;
  mode: AppMode;
}

export const ChatStream: React.FC<ChatStreamProps> = ({
  messages,
  currentStreamContent,
  isStreaming,
  mode,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentStreamContent]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.length === 0 && !isStreaming && (
        <div className="h-full flex flex-col items-center justify-center text-center text-[#8b949e] py-16">
          <div className="w-12 h-12 rounded-full bg-[#161b22] border border-[#30363d] flex items-center justify-center mb-3">
            {mode === 'jules' ? (
              <Sparkles className="w-6 h-6 text-sky-400" />
            ) : (
              <Bot className="w-6 h-6 text-emerald-400" />
            )}
          </div>
          <h2 className="text-sm font-semibold text-white mb-1">
            {mode === 'jules' ? 'Jules Senior Engineer Mode' : 'Standard Autonomous AI'}
          </h2>
          <p className="text-xs max-w-sm text-[#8b949e]">
            {mode === 'jules'
              ? 'Acts strictly as Lead Tech Architect. Delegates implementation to Jules AI workers and supervises remotely.'
              : 'Direct autonomous software engineer. Reads files, executes shell commands, and modifies local code.'}
          </p>
        </div>
      )}

      {messages.map((m) => {
        const isUser = m.role === 'user';
        return (
          <div key={m.id} className="flex space-x-3 text-xs leading-relaxed">
            {/* Avatar */}
            <div
              className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 border shadow-sm ${
                isUser
                  ? 'bg-purple-950/60 border-purple-500/40 text-purple-300'
                  : mode === 'jules'
                  ? 'bg-sky-950/60 border-sky-500/40 text-sky-300'
                  : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
              }`}
            >
              {isUser ? (
                <User className="w-4 h-4" />
              ) : mode === 'jules' ? (
                <Sparkles className="w-4 h-4" />
              ) : (
                <Bot className="w-4 h-4" />
              )}
            </div>

            {/* Content & Tools */}
            <div className="flex-1 overflow-hidden space-y-2">
              <div className="font-semibold text-[11px] text-[#8b949e]">
                {isUser ? 'You' : mode === 'jules' ? 'Senior Engineer Lead' : 'SeniorEngineer AI'}
              </div>

              {m.content && (
                <div className="whitespace-pre-wrap text-[#c9d1d9] bg-[#161b22]/70 p-3 rounded-lg border border-[#30363d]/60 font-sans">
                  {m.content}
                </div>
              )}

              {/* Tool Execution Cards */}
              {m.toolCalls && m.toolCalls.map((tc: ToolExecutionRecord) => <ToolCard key={tc.id} tool={tc} />)}
            </div>
          </div>
        );
      })}

      {/* Live Streaming Block */}
      {isStreaming && (
        <div className="flex space-x-3 text-xs leading-relaxed">
          <div
            className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 border ${
              mode === 'jules'
                ? 'bg-sky-950/60 border-sky-500/40 text-sky-300'
                : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
            }`}
          >
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>

          <div className="flex-1 space-y-2">
            <div className="font-semibold text-[11px] text-[#8b949e] flex items-center space-x-1.5">
              <span>Reasoning autonomously...</span>
            </div>

            {currentStreamContent ? (
              <div className="whitespace-pre-wrap text-[#c9d1d9] bg-[#161b22]/70 p-3 rounded-lg border border-[#30363d]/60">
                {currentStreamContent}
              </div>
            ) : (
              <div className="text-[#8b949e] italic text-xs">Executing step...</div>
            )}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};
