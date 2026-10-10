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
  AlertTriangle,
  Brain,
  ShieldAlert,
  Zap
} from 'lucide-react';
import type { ChatMessage, ToolExecutionRecord, AppMode, AttachmentFile } from '@/shared/types';
import { ToolCard, AntigravityToolStream, AntigravityTrajectoryFlow, TrajectoryItem } from './ToolCard';
import { ImagePreviewModal } from '../common/ImagePreviewModal';

interface ChatStreamProps {
  messages: ChatMessage[];
  currentStreamContent: string;
  streamingReasoning?: string;
  streamingTools?: ToolExecutionRecord[];
  isStreaming: boolean;
  retryStatus?: { attempt: number; maxRetries: number; delayMs: number; reason: string } | null;
  mode: AppMode;
  selectedModel?: string;
  liveResolvedModel?: string | null;
}

interface ConversationTurn {
  id: string;
  userMessage?: ChatMessage;
  assistantMessages: ChatMessage[];
  systemMessages: ChatMessage[];
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${mins}m ${rem}s`;
}

function isSystemNotificationMessage(m: ChatMessage): boolean {
  if (m.role === 'system' || m.isSystemNotification) return true;
  const content = m.content || '';
  return (
    content.startsWith('<SYSTEM_MESSAGE>') ||
    content.startsWith('[DUTY SHIFT') ||
    content.startsWith('[SYSTEM ALERT') ||
    content.startsWith('[TASK NOTIFICATION') ||
    content.startsWith('[JULES') ||
    content.startsWith('[Jules') ||
    content.startsWith('[AUTONOMOUS SUPERVISOR') ||
    content.startsWith('[AUTONOMOUS DUTY') ||
    content.startsWith('[AUTONOMOUS MODE')
  );
}

const SystemEventCard: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const text = message.content || '';
  
  const isAutonomousAlert = text.includes('AUTONOMOUS MODE');
  const isDutyAlert = text.includes('DUTY SHIFT');
  const isJulesEvent = text.includes('Jules') || text.includes('jules');
  const isTaskFinished = text.includes('Task') && text.includes('finished');

  const title = isAutonomousAlert
    ? 'Autonomous Mode Inactivity Watchdog'
    : isDutyAlert
    ? 'Autonomous Duty Shift Watchdog'
    : isJulesEvent
    ? 'Jules Cloud Supervisor Update'
    : isTaskFinished
    ? 'Background Task Completed'
    : 'System Event Notification';

  const preview = text.split('\n')[0].replace(/^<SYSTEM_MESSAGE>\s*/, '').slice(0, 100);
  const isLong = text.length > 100 || text.includes('\n');

  return (
    <div className="w-full my-2 rounded-2xl border border-[var(--border-card)] bg-[var(--bg-surface)] text-xs overflow-hidden shadow-sm select-text">
      <div 
        onClick={() => isLong && setIsExpanded(!isExpanded)}
        className={`flex items-center justify-between px-3.5 py-2.5 ${isLong ? 'cursor-pointer hover:bg-[var(--bg-surface-hover)]' : ''} transition-colors`}
      >
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
            isAutonomousAlert ? 'bg-amber-500/15 border border-amber-500/30' :
            isDutyAlert ? 'bg-amber-500/15 border border-amber-500/30' :
            isJulesEvent ? 'bg-sky-500/15 border border-sky-500/30' :
            'bg-cyan-500/15 border border-cyan-500/30'
          }`}>
            {isAutonomousAlert ? (
              <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            ) : isDutyAlert ? (
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            ) : isJulesEvent ? (
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            ) : (
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-[11.5px] text-[var(--text-primary)]">
              {title}
            </span>
            {!isExpanded && (
              <span className="text-[11px] text-[var(--text-muted)] font-mono truncate">
                {preview}
              </span>
            )}
          </div>
        </div>
        {isLong && (
          <div className="text-[var(--text-muted)] ml-2">
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </div>
        )}
      </div>
      {(!isLong || isExpanded) && (
        <div className="px-3.5 py-2.5 bg-[var(--bg-sidebar)]/80 border-t border-[var(--border-subtle)] font-mono text-[11.5px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto select-text">
          {text.replace(/^<SYSTEM_MESSAGE>\s*/, '')}
        </div>
      )}
    </div>
  );
};

export const ChatStream: React.FC<ChatStreamProps> = ({
  messages,
  currentStreamContent,
  streamingReasoning = '',
  streamingTools = [],
  isStreaming,
  retryStatus,
  mode,
  selectedModel,
  liveResolvedModel,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const latestUserMsgRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef<boolean>(true);

  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [copiedFullChat, setCopiedFullChat] = useState(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [expandedTrajectories, setExpandedTrajectories] = useState<Record<string, boolean>>({});
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'up' | 'down'>>({});
  const [previewModalImg, setPreviewModalImg] = useState<{ url: string; name?: string; size?: number } | null>(null);

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
      const isSystem = isSystemNotificationMessage(m);

      if (isSystem) {
        // If there's already an active turn with user messages or assistant activity,
        // finalize that turn so its response and tools are never swallowed or merged!
        if (activeTurn && (activeTurn.userMessage || activeTurn.assistantMessages.length > 0)) {
          list.push(activeTurn);
          activeTurn = null;
        }

        if (!activeTurn) {
          activeTurn = {
            id: m.id,
            assistantMessages: [],
            systemMessages: [m],
          };
        } else {
          activeTurn.systemMessages.push(m);
        }
      } else if (m.role === 'user') {
        if (activeTurn) {
          list.push(activeTurn);
        }
        activeTurn = {
          id: m.id,
          userMessage: m,
          assistantMessages: [],
          systemMessages: [],
        };
      } else if (m.role === 'assistant') {
        const lastMsg = activeTurn?.assistantMessages[activeTurn.assistantMessages.length - 1];
        const lastMsgHasTools = Boolean(lastMsg?.toolCalls && lastMsg.toolCalls.length > 0);
        const allToolsFinished = Boolean(
          lastMsgHasTools &&
          lastMsg?.toolCalls?.every((t) => t.status === 'completed' || t.status === 'error')
        );
        const lastMsgCompleted = Boolean(
          lastMsg &&
          (
            (!lastMsgHasTools && lastMsg.content && lastMsg.content.trim().length > 0) ||
            (allToolsFinished && lastMsg.content && lastMsg.content.trim().length > 0 && lastMsg.executionDuration)
          )
        );

        // If the active turn already concluded with a response,
        // finalize it into a completed turn so its response is never overwritten or merged into!
        if (activeTurn && lastMsgCompleted) {
          list.push(activeTurn);
          activeTurn = null;
        }

        if (!activeTurn) {
          activeTurn = {
            id: m.id,
            assistantMessages: [m],
            systemMessages: [],
          };
        } else {
          activeTurn.assistantMessages.push(m);
        }
      }
    }

    if (activeTurn) {
      list.push(activeTurn);
    }

    // If currently streaming, check if the last turn in list has already concluded its assistant response.
    // If so, append a dedicated live turn so live execution NEVER pollutes past completed turns!
    if (isStreaming && list.length > 0) {
      const lastTurn = list[list.length - 1];
      const lastAsst = lastTurn.assistantMessages[lastTurn.assistantMessages.length - 1];
      const isConcluded = Boolean(
        lastAsst &&
        lastAsst.content &&
        lastAsst.content.trim().length > 0 &&
        lastAsst.executionDuration
      );

      // If the turn already ended with a completed assistant response and has no fresh pending system message:
      if (isConcluded && (!lastTurn.systemMessages || lastTurn.systemMessages.length === 0)) {
        list.push({
          id: `live_turn_pending`,
          assistantMessages: [],
          systemMessages: [],
        });
      }
    }

    return list;
  }, [messages, isStreaming]);

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
  const scrollRafRef = useRef<number | null>(null);
  useEffect(() => {
    if (isAtBottomRef.current) {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const el = scrollContainerRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    }
    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
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
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-[var(--border-subtle)] select-none">
            <span className="text-[11px] text-[var(--text-muted)] font-mono">
              {messages.length} message{messages.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={handleCopyFullChat}
              className="flex items-center space-x-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-card)] px-2.5 py-1 rounded-lg transition-colors cursor-pointer shadow-sm"
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

          // 1. Identify concluding responseText (strictly from final assistant message)
          const finalAsstMsg = turn.assistantMessages[turn.assistantMessages.length - 1];
          let responseText = '';

          if (isLiveInThisTurn) {
            // While tools are actively running in this turn, intermediate step intent belongs in the trajectory flow,
            // never accumulating into the bottom response area. The bottom response area is reserved for the final conclusion.
            const hasRunningTool = (streamingTools && streamingTools.some((t) => t.status === 'running')) ||
              (turn.assistantMessages.some((m) => m.toolCalls && m.toolCalls.some((t) => t.status === 'running')));
            responseText = hasRunningTool ? '' : currentStreamContent;
          } else if (finalAsstMsg && finalAsstMsg.content) {
            responseText = finalAsstMsg.content.trim();
          }

          // 2. Construct Antigravity chronological trajectory items (thoughts, step intents, and tools)
          const trajectoryItems: TrajectoryItem[] = [];

          for (let amIdx = 0; amIdx < turn.assistantMessages.length; amIdx++) {
            const am = turn.assistantMessages[amIdx];
            const isLastMsg = amIdx === turn.assistantMessages.length - 1;

            // Step thinking/reasoning:
            if (am.thinking && am.thinking.trim()) {
              trajectoryItems.push({
                type: 'thought',
                id: `th_${am.id}`,
                content: am.thinking.trim(),
                durationSec: Math.max(1, Math.round(am.thinking.trim().length / 60)),
              });
            }

            // Intermediate step text where the AI talks to the user directly before tool execution
            if (!isLastMsg && am.content && am.content.trim() && am.toolCalls && am.toolCalls.length > 0) {
              trajectoryItems.push({
                type: 'text',
                id: `txt_${am.id}`,
                content: am.content.trim(),
              });
            }

            // Tools executed in this step:
            if (am.toolCalls && am.toolCalls.length > 0) {
              for (const tc of am.toolCalls) {
                // Interleave tool's specific thinking or text directly above the tool if available
                if (tc.thinking && tc.thinking.trim() && tc.thinking.trim() !== am.thinking?.trim()) {
                  trajectoryItems.push({
                    type: 'thought',
                    id: `th_tc_thk_${tc.id}`,
                    content: tc.thinking.trim(),
                    durationSec: Math.max(1, Math.round(tc.thinking.trim().length / 60)),
                  });
                }
                if (tc.intent && tc.intent.trim() && tc.intent.trim() !== am.content?.trim()) {
                  trajectoryItems.push({
                    type: 'text',
                    id: `txt_tc_${tc.id}`,
                    content: tc.intent.trim(),
                  });
                }
                trajectoryItems.push({
                  type: 'tool',
                  id: tc.id,
                  tool: tc,
                });
              }
            }
          }

          // 3. If currently live streaming in this turn:
          if (isLiveInThisTurn) {
            if (streamingTools && streamingTools.length > 0) {
              for (const tc of streamingTools) {
                if (!trajectoryItems.some((it) => it.type === 'tool' && it.tool.id === tc.id)) {
                  if (tc.thinking && tc.thinking.trim()) {
                    trajectoryItems.push({
                      type: 'thought',
                      id: `th_live_thk_${tc.id}`,
                      content: tc.thinking.trim(),
                      durationSec: Math.max(1, Math.round(tc.thinking.trim().length / 60)),
                    });
                  }
                  if (tc.intent && tc.intent.trim()) {
                    trajectoryItems.push({
                      type: 'text',
                      id: `txt_live_${tc.id}`,
                      content: tc.intent.trim(),
                    });
                  }
                  trajectoryItems.push({
                    type: 'tool',
                    id: tc.id,
                    tool: tc,
                  });
                }
              }
            }

            if (streamingReasoning && streamingReasoning.trim()) {
              trajectoryItems.push({
                type: 'thought',
                id: 'live_reasoning',
                content: streamingReasoning.trim(),
                durationSec: streamingSeconds || 1,
              });
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

          const hasAssistantActivity =
            turn.assistantMessages.length > 0 ||
            (turn.systemMessages && turn.systemMessages.length > 0) ||
            isLiveInThisTurn;
          const hasTrajectoryContent = trajectoryItems.length > 0 || duration > 0 || isLiveInThisTurn;
          const defaultExpanded = isLiveInThisTurn;
          const isExpanded = expandedTrajectories[turn.id] !== undefined ? expandedTrajectories[turn.id] : defaultExpanded;
          const turnTimestamp = lastAsst?.timestamp || turn.userMessage?.timestamp || Date.now();
          const timeFormatted = new Date(turnTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const asstTurnId = `asst_${turn.id}`;
          const persistedModel = turn.assistantMessages.find((m) => m.model && m.model !== 'auto')?.model
            || turn.assistantMessages.find((m) => m.model)?.model;
          const turnModel = (isLiveInThisTurn && liveResolvedModel)
            ? liveResolvedModel
            : (persistedModel && persistedModel !== 'auto')
              ? persistedModel
              : (isLiveInThisTurn ? (liveResolvedModel || selectedModel) : (persistedModel || undefined));

          return (
            <div key={turn.id} className="w-full space-y-3">
              {/* User Message: Top-Aligned Full-Width Card (Antigravity Style - Sticky on Scroll) */}
              {turn.userMessage && (
                <div 
                  ref={isLatestTurn ? latestUserMsgRef : undefined}
                  className="w-full sticky top-0 z-20 pt-1 pb-2 bg-[var(--bg-canvas)]/95 backdrop-blur-md group/user"
                >
                  <div className="w-full bg-[var(--bg-surface)] border border-[var(--border-card)] text-[var(--text-primary)] px-4 py-3 rounded-2xl text-[13px] leading-relaxed shadow-md select-text cursor-text relative space-y-2.5">
                    {/* Render message attachments if present */}
                    {turn.userMessage.attachments && turn.userMessage.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        {turn.userMessage.attachments.map((att, attIdx) => {
                          const imageIndex = att.type === 'image'
                            ? turn.userMessage!.attachments!.slice(0, attIdx + 1).filter((a) => a.type === 'image').length
                            : undefined;

                          return (
                            <div
                              key={att.id}
                              className="flex items-center space-x-2 bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl p-1.5 pr-3 text-xs text-[var(--text-primary)] shadow-sm max-w-[280px]"
                            >
                              {imageIndex && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30 shrink-0 font-mono">
                                  #{imageIndex}
                                </span>
                              )}
                              {att.type === 'image' && att.dataUrl ? (
                                <img
                                  src={att.dataUrl}
                                  alt={att.name}
                                  onClick={() => setPreviewModalImg({ url: att.dataUrl!, name: att.name, size: att.size })}
                                  className="w-8 h-8 rounded-lg object-cover border border-white/10 shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                                  title="Click to preview & zoom"
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
                                <span 
                                  onClick={() => {
                                    if (att.type === 'image' && att.dataUrl) {
                                      setPreviewModalImg({ url: att.dataUrl, name: att.name, size: att.size });
                                    }
                                  }}
                                  className={`font-mono text-[11px] text-[var(--text-primary)] truncate font-medium ${att.type === 'image' && att.dataUrl ? 'cursor-pointer hover:underline hover:text-sky-400' : ''}`}
                                  title={att.type === 'image' && att.dataUrl ? 'Click to preview & zoom' : att.name}
                                >
                                  {att.name}
                                </span>
                                <span className="text-[10px] text-[var(--text-secondary)] font-mono">{Math.max(1, Math.round(att.size / 1024))} KB</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {turn.userMessage.content && (
                      <div className="whitespace-pre-wrap select-text pr-8 max-h-56 overflow-y-auto">{turn.userMessage.content}</div>
                    )}

                    <button
                      type="button"
                      onClick={() => copyToClipboard(turn.userMessage!.content, `user_${turn.userMessage!.id}`)}
                      className="absolute top-2.5 right-2.5 opacity-0 group-hover/user:opacity-100 transition-opacity p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer"
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

              {/* Dedicated System Event Notifications (Background tasks, Duty alerts, Supervisor updates) */}
              {turn.systemMessages && turn.systemMessages.length > 0 && (
                <div className="space-y-1 py-0.5">
                  {turn.systemMessages.map((sm) => (
                    <SystemEventCard key={sm.id} message={sm} />
                  ))}
                </div>
              )}

              {/* Assistant Turn Response: Unified with Single "Worked for Xs >" and Content */}
              {hasAssistantActivity && (
                <div className="w-full space-y-2 text-xs leading-relaxed group/asst pt-1">
                  {/* Single Unified "Worked for Xs >" Banner for the entire turn */}
                  {hasTrajectoryContent && (
                    <div className="flex items-center space-x-2 py-1 w-fit select-none">
                      <div 
                        onClick={() => toggleTrajectory(turn.id, defaultExpanded)}
                        className="flex items-center space-x-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors group/trajectory font-medium"
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
                          <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover/trajectory:text-[var(--text-primary)]" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover/trajectory:text-[var(--text-primary)]" />
                        )}
                      </div>

                      {turnModel && (
                        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[10.5px] font-mono text-[var(--text-muted)]">
                          <Bot className="w-3 h-3 text-cyan-400/80 shrink-0" />
                          <span>{turnModel}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Collapsible Antigravity Trajectory Flow (Chronological Timeline) */}
                  {isExpanded && trajectoryItems.length > 0 && (
                    <div className="py-1 ml-0.5 animate-in fade-in duration-100">
                      <AntigravityTrajectoryFlow items={trajectoryItems} />
                    </div>
                  )}

                  {/* Response Markdown Content */}
                  {responseText ? (
                    <div className="prose-antigravity select-text cursor-text text-[var(--text-primary)] text-[13px] leading-relaxed">
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

                            const codeId = `code_${match ? match[1] : 'snippet'}_${codeString.length}_${codeString.slice(0, 10).replace(/\W/g, '')}`;

                            return (
                              <div className="relative group/code my-2 rounded-xl overflow-hidden border border-[var(--border-card)] bg-[var(--bg-sidebar)]">
                                <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)]">
                                  <span>{match ? match[1] : 'code'}</span>
                                  <button
                                    type="button"
                                    onClick={() => copyToClipboard(codeString, codeId)}
                                    className="flex items-center space-x-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
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
                                <pre className="p-3 text-[12px] overflow-x-auto text-[var(--text-primary)] font-mono leading-relaxed bg-[var(--bg-sidebar)] m-0">
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
                      <div className="text-red-300/90 whitespace-pre-wrap font-mono text-[11.5px] bg-[var(--bg-sidebar)]/80 p-2.5 rounded-lg border border-red-500/20 leading-relaxed overflow-x-auto">
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
                  {isLiveInThisTurn && !responseText && !retryStatus && trajectoryItems.length === 0 && (
                    <div className="flex items-center space-x-2 text-[var(--text-muted)] italic text-xs pl-1 animate-pulse">
                      <Brain className="w-3.5 h-3.5 text-purple-400 shrink-0 animate-spin" />
                      <span>{streamingReasoning ? 'Reasoning and analyzing...' : 'Thinking and planning...'}</span>
                    </div>
                  )}

                  {/* Single Unified Turn Footer: Timestamp + Model Name + Actions */}
                  {!isLiveInThisTurn && responseText && (
                    <div className="flex items-center justify-between pt-2 select-none text-[11px] text-[var(--text-muted)]">
                      <div className="flex items-center space-x-2">
                        <span>{timeFormatted}</span>
                        {turnModel && (
                          <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[10.5px] font-mono text-[var(--text-secondary)]">
                            <Bot className="w-3 h-3 text-cyan-400 shrink-0" />
                            <span>{turnModel}</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-1 opacity-0 group-hover/asst:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => copyToClipboard(responseText, asstTurnId)}
                          className="p-1 hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer"
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
                          className={`p-1 rounded hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer ${
                            feedbackMap[turn.id] === 'up' ? 'text-cyan-400' : 'hover:text-[var(--text-primary)]'
                          }`}
                          title="Good response"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setFeedbackMap((prev) => ({ ...prev, [turn.id]: prev[turn.id] === 'down' ? undefined! : 'down' }))}
                          className={`p-1 rounded hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer ${
                            feedbackMap[turn.id] === 'down' ? 'text-amber-400' : 'hover:text-[var(--text-primary)]'
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
            {((streamingTools && streamingTools.length > 0) || (streamingReasoning && streamingReasoning.trim())) && (
              <div className="py-1 ml-0.5">
                <AntigravityTrajectoryFlow
                  items={[
                    ...(streamingReasoning && streamingReasoning.trim()
                      ? [{ type: 'thought' as const, id: 'live_th', content: streamingReasoning.trim(), durationSec: streamingSeconds || 1 }]
                      : []),
                    ...(streamingTools || []).map((t) => ({ type: 'tool' as const, id: t.id, tool: t })),
                  ]}
                />
              </div>
            )}
            {currentStreamContent && (
              <div className="prose-antigravity select-text cursor-text text-[var(--text-primary)] text-[13px] leading-relaxed">
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
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-[var(--bg-surface)]/95 hover:bg-[var(--bg-surface-hover)] text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] shadow-2xl backdrop-blur-md transition-all cursor-pointer animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <ArrowDown className="w-3.5 h-3.5 text-[#38bdf8]" />
          <span>Scroll to bottom</span>
        </button>
      )}

      {/* Fullscreen Image Preview & Zoom Modal */}
      <ImagePreviewModal
        isOpen={Boolean(previewModalImg)}
        onClose={() => setPreviewModalImg(null)}
        imageUrl={previewModalImg?.url || ''}
        imageName={previewModalImg?.name}
        imageSize={previewModalImg?.size}
      />
    </div>
  );
};
