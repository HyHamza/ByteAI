import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, Copy, Check, Loader2 } from 'lucide-react';
import type { ChatMessage, AppMode, ToolExecutionRecord } from '@/shared/types';
import { ToolCard } from './ToolCard';

interface ChatStreamProps {
  messages: ChatMessage[];
  currentStreamContent: string;
  streamingTools?: ToolExecutionRecord[];
  isStreaming: boolean;
  mode: AppMode;
}

export const ChatStream: React.FC<ChatStreamProps> = ({
  messages,
  currentStreamContent,
  streamingTools = [],
  isStreaming,
  mode,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentStreamContent, streamingTools]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-4xl w-full mx-auto">
      {messages.map((m) => {
        const isUser = m.role === 'user';

        if (isUser) {
          return (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-2xl bg-[#1e2025] border border-[#2b2d35] text-[#f0f1f4] px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed shadow-sm">
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            </div>
          );
        }

        return (
          <div key={m.id} className="flex space-x-3.5 text-xs leading-relaxed group">
            {/* Assistant Avatar: Antigravity Delta A Icon */}
            <div className="w-7 h-7 rounded-lg bg-[#1a1b1f] border border-[#282a30] flex items-center justify-center shrink-0 text-white mt-0.5 shadow-sm">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M12 2.5L2 20.5h4.2l1.9-3.6h7.8l1.9 3.6H22L12 2.5zm0 5.4l2.8 5.4H9.2L12 7.9z" />
              </svg>
            </div>

            {/* Message Body */}
            <div className="flex-1 overflow-hidden space-y-2">
              <div className="flex items-center space-x-2">
                <span className="font-medium text-[12px] text-[#c4c7cf]">
                  {mode === 'jules' ? 'Jules Lead' : 'Antigravity'}
                </span>
                <span className="text-[10px] text-[#60646c]">
                  {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {/* Rich Markdown Formatted Content */}
              {m.content && (
                <div className="prose-antigravity">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ node, className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const codeString = String(children).replace(/\n$/, '');
                        const isInline = !match && !codeString.includes('\n');

                        if (isInline) {
                          return (
                            <code className={className} {...props}>
                              {children}
                            </code>
                          );
                        }

                        const codeId = `code_${Math.random().toString(36).substring(7)}`;

                        return (
                          <div className="relative group/code my-2 rounded-xl overflow-hidden border border-[#27292f] bg-[#111215]">
                            <div className="flex items-center justify-between px-3 py-1.5 bg-[#17181c] border-b border-[#24262b] text-[11px] text-[#787c86]">
                              <span>{match ? match[1] : 'code'}</span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(codeString, codeId)}
                                className="flex items-center space-x-1 text-[#8e9196] hover:text-white transition-colors cursor-pointer"
                              >
                                {copiedCodeId === codeId ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-400" />
                                    <span className="text-emerald-400">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <pre className="p-3 text-[12px] overflow-x-auto text-[#e2e8f0] font-mono leading-relaxed bg-[#111215] m-0">
                              <code>{children}</code>
                            </pre>
                          </div>
                        );
                      },
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                </div>
              )}

              {/* Tool Execution Cards */}
              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {m.toolCalls.map((tc: ToolExecutionRecord) => (
                    <ToolCard key={tc.id} tool={tc} />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Live Streaming Block */}
      {isStreaming && (
        <div className="flex space-x-3.5 text-xs leading-relaxed">
          <div className="w-7 h-7 rounded-lg bg-[#1a1b1f] border border-[#282a30] flex items-center justify-center shrink-0 text-white mt-0.5">
            <Loader2 className="w-4 h-4 animate-spin text-[#1a73e8]" />
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex items-center space-x-2 text-[12px] text-[#8e9196]">
              <span className="font-medium text-[#c4c7cf]">
                {mode === 'jules' ? 'Jules Lead' : 'Antigravity'}
              </span>
              <span className="text-[11px] text-[#60646c] italic">Thinking...</span>
            </div>

            {currentStreamContent && (
              <div className="prose-antigravity">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {currentStreamContent}
                </ReactMarkdown>
              </div>
            )}

            {/* Live Streaming Tool Cards */}
            {streamingTools && streamingTools.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {streamingTools.map((tc) => (
                  <ToolCard key={tc.id} tool={tc} />
                ))}
              </div>
            )}

            {!currentStreamContent && (!streamingTools || streamingTools.length === 0) && (
              <div className="text-[#6c707a] italic text-xs">Formulating response...</div>
            )}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};
