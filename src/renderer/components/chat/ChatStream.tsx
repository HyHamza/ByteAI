import React, { useEffect, useRef, useState, useMemo } from 'react';
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
  Clock,
  Image as ImageIcon,
  FileText,
  AlertTriangle
} from 'lucide-react';
import type { ChatMessage, ToolExecutionRecord, AppMode, AttachmentFile } from '@/shared/types';
import { ToolCard, AntigravityToolStream } from './ToolCard';

interface ChatStreamProps {
  messages: ChatMessage[];
  currentStreamContent: string;
  streamingTools?: ToolExecutionRecord[];
  isStreaming: boolean;
  retryStatus?: { attempt: number; maxRetries: number; delayMs: number; reason: string } | null;
  mode: AppMode;
}

interface ConversationTurn {
  id: string;
  userMessage?: ChatMessage;
  assistantMessages: ChatMessage[];
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
  retryStatus,
  mode,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const latestUserMsgRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef<boolean>(true);

  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [copiedFullChat, setCopiedFullChat] = useState(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [expandedTrajectories, setExpandedTrajectories] = useState<Record<string, boolean>>({});
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

  // Group messages into clean conversation turns so tools and responses from the same turn are unified
  const turns = useMemo(() => {
    const list: ConversationTurn[] = [];
    let activeTurn: ConversationTurn | null = null;

    for (const m of messages) {
      if (m.role === 'user') {
        if (activeTurn) {
          list.push(activeTurn);
        }
        activeTurn = {
          id: m.id,
          userMessage: m,
          assistantMessages: [],
        };
      } else if (m.role === 'assistant') {
        if (!activeTurn) {
          activeTurn = {
            id: m.id,
            assistantMessages: [m],
          };
        } else {
          activeTurn.assistantMessages.push(m);
        }
      }
    }

    if (activeTurn) {
      list.push(activeTurn);
    }

    return list;
  }, [messages]);

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
  // Position sent message at the top of the turn smoothly ONCE without conflicting with streaming
  const prevMessagesCountRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMessagesCountRef.current) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current && latestUserMsgRef.current) {
            const container = scrollContainerRef.current;
            const targetTop = latestUserMsgRef.current.offsetTop - 16;
            container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
          }
        });
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

  const toggleTrajectory = (id: string, defaultExpanded: boolean) => {
    setExpandedTrajectories((prev) => {
      const current = prev[id] !== undefined ? prev[id] : defaultExpanded;
      return {
        ...prev,
        [id]: !current,
      };
    });
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
        className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-4xl w-full mx-auto select-text"
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

        {/* Render Conversation Turns */}
        {turns.map((turn, turnIdx) => {
          const isLatestTurn = turnIdx === turns.length - 1;
          const isLiveInThisTurn = isLatestTurn && isStreaming;

          // Gather all tool calls from all assistant steps in this turn
          const allToolCalls: ToolExecutionRecord[] = [];
          for (const am of turn.assistantMessages) {
            if (am.toolCalls && am.toolCalls.length > 0) {
              allToolCalls.push(...am.toolCalls);
            }
          }
          if (isLiveInThisTurn && streamingTools && streamingTools.length > 0) {
            allToolCalls.push(...streamingTools);
          }

          // Gather assistant content
          const messagesWithContent = turn.assistantMessages.filter((am) => am.content && am.content.trim());
          let responseText = '';
          const intermediateThoughts: string[] = [];

          if (isLiveInThisTurn) {
            // During live stream
            responseText = currentStreamContent;
            // Any prior messages with content in this turn are intermediate thoughts
            for (const am of messagesWithContent) {
              intermediateThoughts.push(am.content);
            }
          } else {
            // Completed turn
            if (messagesWithContent.length > 0) {
              // The final message content is the response
              responseText = messagesWithContent[messagesWithContent.length - 1].content;
              // Earlier messages with content are intermediate thoughts
              for (let i = 0; i < messagesWithContent.length - 1; i++) {
                intermediateThoughts.push(messagesWithContent[i].content);
              }
            }
          }

          // Calculate turn duration
          const lastAsst = turn.assistantMessages[turn.assistantMessages.length - 1];
          let duration = 0;
          if (isLiveInThisTurn) {
            duration = streamingSeconds;
          } else if (lastAsst?.executionDuration) {
            duration = lastAsst.executionDuration;
          } else if (turn.userMessage && lastAsst) {
            duration = Math.max(1, Math.round((lastAsst.timestamp - turn.userMessage.timestamp) / 1000));
          } else if (turn.assistantMessages.length > 0) {
            duration = turn.assistantMessages.length * 3;
          }

          const hasAssistantActivity = turn.assistantMessages.length > 0 || isLiveInThisTurn;
          const defaultExpanded = isLiveInThisTurn;
          const isExpanded = expandedTrajectories[turn.id] !== undefined ? expandedTrajectories[turn.id] : defaultExpanded;
          const turnTimestamp = lastAsst?.timestamp || turn.userMessage?.timestamp || Date.now();
          const timeFormatted = new Date(turnTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const asstTurnId = `asst_${turn.id}`;

          return (
            <div key={turn.id} className="w-full space-y-3">
              {/* User Message: Top-Aligned Full-Width Card (Antigravity Style) */}
              {turn.userMessage && (
                <div 
                  ref={isLatestTurn ? latestUserMsgRef : undefined}
                  className="w-full relative group/user pt-1"
                >
                  <div className="w-full bg-[#1e2025] border border-[#2b2d35] text-[#f0f1f4] px-4 py-3 rounded-2xl text-[13px] leading-relaxed shadow-sm select-text cursor-text relative space-y-2.5">
                    {/* Render message attachments if present */}
                    {turn.userMessage.attachments && turn.userMessage.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        {turn.userMessage.attachments.map((att) => (
                          <div
                            key={att.id}
                            className="flex items-center space-x-2 bg-[#262830] border border-[#373a45] rounded-xl p-1.5 pr-3 text-xs text-[#d1d5db] shadow-sm max-w-[280px]"
                          >
                            {att.type === 'image' && att.dataUrl ? (
                              <img
                                src={att.dataUrl}
                                alt={att.name}
                                className="w-8 h-8 rounded-lg object-cover border border-white/10 shrink-0"
                              />
                            ) : att.type === 'image' ? (
                              <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0">
                                <ImageIcon className="w-4 h-4 text-sky-400" />
                              </div>
                            ) : (
                              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                                <FileText className="w-4 h-4 text-amber-400" />
                              </div>
                            )}
                            <div className="flex flex-col min-w-0">
                              <span className="font-mono text-[11px] text-[#f3f4f6] truncate font-medium">{att.name}</span>
                              <span className="text-[10px] text-[#8e9196] font-mono">{Math.max(1, Math.round(att.size / 1024))} KB</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {turn.userMessage.content && (
                      <div className="whitespace-pre-wrap select-text pr-8">{turn.userMessage.content}</div>
                    )}

                    <button
                      type="button"
                      onClick={() => copyToClipboard(turn.userMessage!.content, `user_${turn.userMessage!.id}`)}
                      className="absolute top-2.5 right-2.5 opacity-0 group-hover/user:opacity-100 transition-opacity p-1.5 rounded-lg text-[#8e9196] hover:text-white hover:bg-[#282a31] cursor-pointer"
                      title="Copy message"
                    >
                      {copiedCodeId === `user_${turn.userMessage!.id}` ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Assistant Turn Response: Unified with Single "Worked for Xs >" and Content */}
              {hasAssistantActivity && (
                <div className="w-full space-y-2 text-xs leading-relaxed group/asst pt-1">
                  {/* Single Unified "Worked for Xs >" Banner for the entire turn */}
                  {(allToolCalls.length > 0 || duration > 0 || isLiveInThisTurn) && (
                    <div 
                      onClick={() => toggleTrajectory(turn.id, defaultExpanded)}
                      className="flex items-center space-x-2 text-xs text-[#8e9196] hover:text-[#c4c7cf] cursor-pointer select-none py-1 transition-colors w-fit group/trajectory font-medium"
                    >
                      {isLiveInThisTurn ? (
                        retryStatus ? (
                          <div className="flex items-center space-x-2 text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md animate-pulse">
                            <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                            <span>Retrying connection ({retryStatus.attempt}/{retryStatus.maxRetries})...</span>
                            <span className="text-[10px] text-amber-300/80 font-mono">
                              {Math.round(retryStatus.delayMs / 1000)}s backoff
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1.5 text-cyan-400">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Working for {formatDuration(duration || 1)}...</span>
                          </div>
                        )
                      ) : (
                        <span>Worked for {formatDuration(duration || 1)}</span>
                      )}
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-[#6e727c] group-hover/trajectory:text-[#c4c7cf]" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-[#6e727c] group-hover/trajectory:text-[#c4c7cf]" />
                      )}
                    </div>
                  )}

                  {/* Collapsible Tool Execution Records & Intermediate Steps */}
                  {isExpanded && (allToolCalls.length > 0 || intermediateThoughts.length > 0) && (
                    <div className="py-1 ml-0.5 animate-in fade-in duration-100">
                      {intermediateThoughts.map((thought, idx) => (
                        <div key={idx} className="text-[#a0a3ad] italic text-xs py-0.5">
                          {thought}
                        </div>
                      ))}
                      <AntigravityToolStream tools={allToolCalls} />
                    </div>
                  )}

                  {/* Response Markdown Content */}
                  {responseText ? (
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
                        {responseText}
                      </ReactMarkdown>
                    </div>
                  ) : null}

                  {/* Render prominent error notification card if turn failed */}
                  {responseText && responseText.includes('LLM Error:') && (
                    <div className="p-3.5 rounded-xl bg-red-950/25 border border-red-500/30 text-xs text-red-200 space-y-2 mt-2 shadow-sm animate-in fade-in duration-200">
                      <div className="flex items-center space-x-2 text-red-400 font-semibold text-[13px]">
                        <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                        <span>Upstream Provider / LLM Error</span>
                      </div>
                      <div className="text-red-300/90 whitespace-pre-wrap font-mono text-[11.5px] bg-[#111215]/80 p-2.5 rounded-lg border border-red-500/20 leading-relaxed overflow-x-auto">
                        {responseText.replace(/^⚠️ LLM Error:\s*/, '')}
                      </div>
                      <p className="text-[11px] text-red-400/80">
                        Check your API Base URL, API Key, or select "Auto Model" / a supported model in Settings.
                      </p>
                    </div>
                  )}

                  {/* Always visible retry banner in active turn */}
                  {isLiveInThisTurn && retryStatus && (
                    <div className="flex items-center space-x-3 text-amber-300 bg-amber-950/40 border border-amber-500/30 px-3.5 py-2.5 rounded-xl text-xs w-fit my-2 shadow-sm animate-in fade-in duration-150">
                      <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
                      <div>
                        <div className="font-semibold text-amber-200 flex items-center space-x-2">
                          <span>Upstream provider busy / retrying</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.2 bg-amber-500/20 text-amber-300 rounded border border-amber-500/30">
                            Attempt {retryStatus.attempt} of {retryStatus.maxRetries}
                          </span>
                        </div>
                        <div className="text-[11px] text-amber-300/80 mt-0.5">
                          {retryStatus.reason} • Next attempt in {Math.round(retryStatus.delayMs / 1000)}s
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Thinking indicator when streaming with no output yet */}
                  {isLiveInThisTurn && !responseText && !retryStatus && (!allToolCalls || allToolCalls.length === 0) && (
                    <div className="text-[#6c707a] italic text-xs pl-1">Thinking and analyzing...</div>
                  )}

                  {/* Single Unified Turn Footer: Timestamp + Actions */}
                  {!isLiveInThisTurn && responseText && (
                    <div className="flex items-center justify-between pt-2 select-none text-[11px] text-[#555861]">
                      <span>{timeFormatted}</span>

                      <div className="flex items-center space-x-1 opacity-0 group-hover/asst:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => copyToClipboard(responseText, asstTurnId)}
                          className="p-1 hover:text-white rounded hover:bg-[#202227] transition-colors cursor-pointer"
                          title="Copy response"
                        >
                          {copiedCodeId === asstTurnId ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => setFeedbackMap((prev) => ({ ...prev, [turn.id]: prev[turn.id] === 'up' ? undefined! : 'up' }))}
                          className={`p-1 rounded hover:bg-[#202227] transition-colors cursor-pointer ${
                            feedbackMap[turn.id] === 'up' ? 'text-cyan-400' : 'hover:text-white'
                          }`}
                          title="Good response"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setFeedbackMap((prev) => ({ ...prev, [turn.id]: prev[turn.id] === 'down' ? undefined! : 'down' }))}
                          className={`p-1 rounded hover:bg-[#202227] transition-colors cursor-pointer ${
                            feedbackMap[turn.id] === 'down' ? 'text-amber-400' : 'hover:text-white'
                          }`}
                          title="Bad response"
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* If live streaming and no turn exists yet */}
        {isStreaming && turns.length === 0 && (
          <div className="w-full space-y-2 text-xs leading-relaxed pt-1">
            {retryStatus ? (
              <div className="flex items-center space-x-2 text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md animate-pulse w-fit">
                <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                <span>Retrying connection ({retryStatus.attempt}/{retryStatus.maxRetries})...</span>
                <span className="text-[10px] text-amber-300/80 font-mono">
                  {Math.round(retryStatus.delayMs / 1000)}s backoff
                </span>
              </div>
            ) : (
              <div className="flex items-center space-x-1.5 text-cyan-400 py-1 font-medium">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Working for {formatDuration(streamingSeconds)}...</span>
              </div>
            )}
            {streamingTools && streamingTools.length > 0 && (
              <div className="py-1 ml-0.5">
                <AntigravityToolStream tools={streamingTools} />
              </div>
            )}
            {currentStreamContent && (
              <div className="prose-antigravity select-text cursor-text text-[#e3e5ec] text-[13px] leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {currentStreamContent}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating "Scroll to bottom" button */}
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
