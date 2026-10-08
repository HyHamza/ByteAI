import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Bot, 
  Terminal, 
  Copy, 
  Check, 
  Loader2, 
  Sparkles,
  ChevronRight,
  ChevronDown,
  ArrowDown,
  ThumbsUp,
  ThumbsDown,
  Clock
} from 'lucide-react';
import type { ChatMessage, ToolExecutionRecord, AppMode } from '@/shared/types';
import { ToolCard } from './ToolCard';

interface ChatStreamProps {
  messages: ChatMessage[];
  currentStreamContent: string;
  streamingTools?: ToolExecutionRecord[];
  isStreaming: boolean;
  mode: AppMode;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${mins}m ${rem}s`;
}

export const ChatStream: React.FC<ChatStreamProps> = ({
  messages,
  currentStreamContent,
  streamingTools = [],
  isStreaming,
  mode,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const latestUserMsgRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef<boolean>(true);

  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [copiedFullChat, setCopiedFullChat] = useState(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [expandedTrajectories, setExpandedTrajectories] = useState<Record<string, boolean>>({});
  const [isStreamingTrajectoryExpanded, setIsStreamingTrajectoryExpanded] = useState<boolean>(true);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'up' | 'down'>>({});

  // Active streaming timer
  const [streamingSeconds, setStreamingSeconds] = useState(0);
  const streamStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (isStreaming) {
      if (!streamStartTimeRef.current) {
        streamStartTimeRef.current = Date.now();
      }
      const timer = setInterval(() => {
        if (streamStartTimeRef.current) {
          setStreamingSeconds(Math.max(1, Math.floor((Date.now() - streamStartTimeRef.current) / 1000)));
        }
      }, 1000);
      return () => clearInterval(timer);
    } else {
      streamStartTimeRef.current = null;
      setStreamingSeconds(0);
    }
  }, [isStreaming]);

  // Check if scroll container is at bottom
  const checkIsAtBottom = () => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    const threshold = 80; // px tolerance
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  };

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = checkIsAtBottom();
    isAtBottomRef.current = atBottom;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBottomBtn(!atBottom && distanceToBottom > 160);
  };

  // SMART AUTO-SCROLL:
  // When new stream tokens or messages arrive, ONLY scroll down if already at bottom!
  useEffect(() => {
    if (isAtBottomRef.current) {
      const el = scrollContainerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [messages, currentStreamContent, streamingTools]);

  // When a user message is sent:
  // Scroll so the sent message comes on top!
  const prevMessagesCountRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMessagesCountRef.current) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        setTimeout(() => {
          latestUserMsgRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 30);
        isAtBottomRef.current = true;
        setShowScrollBottomBtn(false);
      }
    }
    prevMessagesCountRef.current = messages.length;
  }, [messages]);

  const scrollToBottom = () => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      isAtBottomRef.current = true;
      setShowScrollBottomBtn(false);
    }
  };

  const toggleTrajectory = (id: string) => {
    setExpandedTrajectories((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const handleCopyFullChat = () => {
    if (messages.length === 0) return;
    const fullText = messages
      .map((m) => {
        const roleName = m.role === 'user' ? 'USER' : 'BYTE';
        const time = new Date(m.timestamp).toLocaleTimeString();
        let section = `### ${roleName} [${time}]\n${m.content || ''}`;
        if (m.toolCalls && m.toolCalls.length > 0) {
          const toolCallsFormatted = m.toolCalls
            .map((tc) => {
              const argStr = tc.args ? JSON.stringify(tc.args, null, 2) : '{}';
              const outStr = tc.output || '(no output)';
              return `\n> **Tool Call:** \`${tc.toolName}\` [Status: ${tc.status}]\n> **Args:**\n\`\`\`json\n${argStr}\n\`\`\`\n> **Output:**\n\`\`\`\n${outStr}\n\`\`\``;
            })
            .join('\n');
          section += `\n${toolCallsFormatted}`;
        }
        return section;
      })
      .join('\n\n---\n\n');

    navigator.clipboard.writeText(fullText);
    setCopiedFullChat(true);
    setTimeout(() => setCopiedFullChat(false), 2000);
  };

  return (
    <div className="relative flex-1 flex flex-col h-full overflow-hidden">
      {/* Scrollable Container with Smart Scroll */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-4xl w-full mx-auto select-text scroll-smooth"
      >
        {/* Top action bar: Copy entire chat */}
        {messages.length > 0 && (
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-[#212328] select-none">
            <span className="text-[11px] text-[#6d717b] font-mono">
              {messages.length} message{messages.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={handleCopyFullChat}
              className="flex items-center space-x-1.5 text-[11px] text-[#8e9196] hover:text-white bg-[#191a1e] hover:bg-[#25272e] border border-[#2a2c33] px-2.5 py-1 rounded-lg transition-colors cursor-pointer shadow-sm"
              title="Copy entire chat history including tool records"
            >
              {copiedFullChat ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-medium">Copied Entire Chat</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Entire Chat</span>
                </>
              )}
            </button>
          </div>
        )}

        {messages.map((m, index) => {
          const isUser = m.role === 'user';
          const isLastUser = isUser && (index === messages.length - 1 || (index === messages.length - 2 && messages[index + 1].role === 'assistant'));

          // Antigravity-Style User Message: Full Width Card at Top of Turn (Screenshot 5)
          if (isUser) {
            const userMsgId = `user_${m.id}`;
            return (
              <div 
                key={m.id} 
                ref={isLastUser ? latestUserMsgRef : undefined}
                className="w-full relative group/user pt-1"
              >
                <div className="w-full bg-[#1e2025] border border-[#2b2d35] text-[#f0f1f4] px-4 py-3 rounded-2xl text-[13px] leading-relaxed shadow-sm select-text cursor-text relative">
                  <div className="whitespace-pre-wrap select-text pr-8">{m.content}</div>

                  <button
                    type="button"
                    onClick={() => copyToClipboard(m.content, userMsgId)}
                    className="absolute top-2.5 right-2.5 opacity-0 group-hover/user:opacity-100 transition-opacity p-1.5 rounded-lg text-[#8e9196] hover:text-white hover:bg-[#282a31] cursor-pointer"
                    title="Copy message"
                  >
                    {copiedCodeId === userMsgId ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            );
          }

          // Assistant Turn
          const asstMsgId = `asst_${m.id}`;
          const prevMsg = index > 0 ? messages[index - 1] : null;
          const hasTools = !!(m.toolCalls && m.toolCalls.length > 0);
          const duration = m.executionDuration || (prevMsg && prevMsg.role === 'user' ? Math.max(1, Math.round((m.timestamp - prevMsg.timestamp) / 1000)) : 0);
          const isExpanded = !!expandedTrajectories[m.id];
          const timeFormatted = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          return (
            <div key={m.id} className="w-full space-y-2 text-xs leading-relaxed group/asst pt-1">
              {/* Antigravity Trajectory Row: "Worked for Xs >" (Screenshot 5) */}
              {(hasTools || duration > 0) && (
                <div 
                  onClick={() => toggleTrajectory(m.id)}
                  className="flex items-center space-x-1.5 text-xs text-[#8e9196] hover:text-[#c4c7cf] cursor-pointer select-none py-1 transition-colors w-fit group/trajectory font-medium"
                >
                  <span>Worked for {formatDuration(duration || 1)}</span>
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-[#6e727c] group-hover/trajectory:text-[#c4c7cf]" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-[#6e727c] group-hover/trajectory:text-[#c4c7cf]" />
                  )}
                </div>
              )}

              {/* Collapsible Tool Execution Records */}
              {isExpanded && hasTools && (
                <div className="space-y-1.5 py-1.5 pl-2 border-l border-[#272930] ml-1 animate-in fade-in duration-100">
                  {m.toolCalls!.map((tc: ToolExecutionRecord) => (
                    <ToolCard key={tc.id} tool={tc} />
                  ))}
                </div>
              )}

              {/* Response Markdown Content */}
              {m.content && (
                <div className="prose-antigravity select-text cursor-text text-[#e3e5ec] text-[13px] leading-relaxed">
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

              {/* Antigravity Turn Footer: Timestamp + Copy/Like/Dislike Actions (Screenshot 5) */}
              <div className="flex items-center justify-between pt-2 select-none text-[11px] text-[#555861]">
                <span>{timeFormatted}</span>

                <div className="flex items-center space-x-1 opacity-0 group-hover/asst:opacity-100 transition-opacity">
                  {m.content && (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(m.content, asstMsgId)}
                      className="p-1 hover:text-white rounded hover:bg-[#202227] transition-colors cursor-pointer"
                      title="Copy response"
                    >
                      {copiedCodeId === asstMsgId ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setFeedbackMap((prev) => ({ ...prev, [m.id]: prev[m.id] === 'up' ? undefined! : 'up' }))}
                    className={`p-1 rounded hover:bg-[#202227] transition-colors cursor-pointer ${
                      feedbackMap[m.id] === 'up' ? 'text-cyan-400' : 'hover:text-white'
                    }`}
                    title="Good response"
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setFeedbackMap((prev) => ({ ...prev, [m.id]: prev[m.id] === 'down' ? undefined! : 'down' }))}
                    className={`p-1 rounded hover:bg-[#202227] transition-colors cursor-pointer ${
                      feedbackMap[m.id] === 'down' ? 'text-amber-400' : 'hover:text-white'
                    }`}
                    title="Bad response"
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Live Streaming Block */}
        {isStreaming && (
          <div className="w-full space-y-2 text-xs leading-relaxed pt-1">
            {/* Live "Worked for Xs >" / "Thinking for Xs..." */}
            <div 
              onClick={() => setIsStreamingTrajectoryExpanded(!isStreamingTrajectoryExpanded)}
              className="flex items-center space-x-2 text-xs text-[#8e9196] hover:text-[#c4c7cf] cursor-pointer select-none py-1 transition-colors w-fit font-medium"
            >
              <div className="flex items-center space-x-1.5 text-cyan-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Working for {formatDuration(streamingSeconds)}...</span>
              </div>
              {isStreamingTrajectoryExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-[#6e727c]" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-[#6e727c]" />
              )}
            </div>

            {/* Live Streaming Tool Cards */}
            {isStreamingTrajectoryExpanded && streamingTools && streamingTools.length > 0 && (
              <div className="space-y-1.5 py-1.5 pl-2 border-l border-[#272930] ml-1">
                {streamingTools.map((tc) => (
                  <ToolCard key={tc.id} tool={tc} />
                ))}
              </div>
            )}

            {currentStreamContent && (
              <div className="prose-antigravity select-text cursor-text text-[#e3e5ec] text-[13px] leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {currentStreamContent}
                </ReactMarkdown>
              </div>
            )}

            {!currentStreamContent && (!streamingTools || streamingTools.length === 0) && (
              <div className="text-[#6c707a] italic text-xs pl-1">Thinking and analyzing...</div>
            )}
          </div>
        )}
      </div>

      {/* Floating "Scroll to bottom" button (appears when user scrolls up during chat) */}
      {showScrollBottomBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-[#1e2025]/95 hover:bg-[#282a32] text-xs text-[#a0a3ad] hover:text-white border border-[#2e3038] shadow-2xl backdrop-blur-md transition-all cursor-pointer animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <ArrowDown className="w-3.5 h-3.5 text-[#38bdf8]" />
          <span>Scroll to bottom</span>
        </button>
      )}
    </div>
  );
};
