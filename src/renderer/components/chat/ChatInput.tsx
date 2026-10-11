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
  ShieldCheck,
  Check,
  Image as ImageIcon,
  FileText,
  X,
  Paperclip,
  Code,
  MicOff,
  Moon,
  Clock,
  Zap
} from 'lucide-react';
import type { AppMode, AttachmentFile, TaskState } from '@/shared/types';
import { api } from '../../api';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import { useDutyShift } from '../../hooks/useDutyShift';
import { ImagePreviewModal } from '../common/ImagePreviewModal';

interface ChatInputProps {
  onSendMessage: (text: string, attachments?: AttachmentFile[]) => void;
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
  sessionId?: string;
  isAutonomousMode?: boolean;
  onToggleAutonomousMode?: () => void;
  taskState?: TaskState;
  onUpdateTaskState?: (state: TaskState) => void;
}

function formatModelDisplayName(modelId: string): string {
  if (!modelId) return 'Auto Router';
  if (modelId === 'auto') return 'Auto Router';
  
  const map: Record<string, string> = {
    'claude-opus-4-5': 'Claude Opus 4.5',
    'claude-sonnet-4-5': 'Claude Sonnet 4.5',
    'claude-haiku-4-5': 'Claude Haiku 4.5',
    'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
    'claude-3-7-sonnet': 'Claude 3.7 Sonnet',
    'qwen3.8-27b': 'Qwen 3.8 (27B)',
    'fusion': 'Fusion Multi-Model',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gpt-4-turbo': 'GPT-4 Turbo',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.0-flash': 'Gemini 2.0 Flash',
    'deepseek-chat': 'DeepSeek Chat',
    'deepseek-coder': 'DeepSeek Coder',
    'deepseek-r1': 'DeepSeek R1',
  };

  if (map[modelId]) return map[modelId];

  return modelId
    .split('-')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
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
  sessionId,
  isAutonomousMode = false,
  onToggleAutonomousMode,
  taskState,
  onUpdateTaskState,
}) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isDutyDropdownOpen, setIsDutyDropdownOpen] = useState(false);
  const [isDutyShiftEnabled, setIsDutyShiftEnabled] = useState(false);
  const [dutyHours, setDutyHours] = useState(8);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hiddenFileInputRef = useRef<HTMLInputElement>(null);
  const lastPasteTimeRef = useRef<number>(0);
  const [previewModalImg, setPreviewModalImg] = useState<{ url: string; name?: string; size?: number } | null>(null);

  const { activeShift, remainingTimeDisplay, startShift, stopShift } = useDutyShift(sessionId);

  const {
    isListening,
    audioLevel,
    interimText,
    error: voiceError,
    toggleListening,
    stopListening,
  } = useVoiceDictation({
    onFinalTranscript: (chunk) => {
      setText((prev) => {
        const trimmed = chunk.trim();
        if (!trimmed) return prev;
        return prev ? `${prev} ${trimmed}` : trimmed;
      });
    },
  });

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isListening) stopListening();
    if ((!text.trim() && attachments.length === 0) || isStreaming || disabled) return;

    const submittedText = text.trim();
    const isOvernightDetected = /work for \d+ hours|all night|overnight|\b\d+\s*hours?\s*duty\b/i.test(submittedText);

    if ((isDutyShiftEnabled || isOvernightDetected) && mode === 'jules') {
      let hoursToSet = dutyHours;
      const match = submittedText.match(/(\d+(?:\.\d+)?)\s*hours?/i);
      if (match) {
        hoursToSet = parseFloat(match[1]);
      } else if (/all night|overnight/i.test(submittedText)) {
        hoursToSet = 8;
      }
      if (sessionId) {
        startShift(sessionId, submittedText, hoursToSet);
      }
    }

    let imageCounter = 0;
    const processedAttachments = attachments.map((att) => {
      if (att.type === 'image') {
        imageCounter++;
        const rawName = att.name || `image_${imageCounter}.png`;
        const cleanBase = rawName.replace(/^screenshot_\d+[-_]?/i, '');
        const indexedName = `screenshot_${imageCounter}_${cleanBase}`;
        return {
          ...att,
          name: indexedName,
        };
      }
      return att;
    });

    onSendMessage(submittedText, processedAttachments);
    if (taskState === 'paused' || taskState === 'completed') {
      onUpdateTaskState?.('in_progress');
    }
    setText('');
    setAttachments([]);
    setIsDutyShiftEnabled(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && isListening) {
      e.preventDefault();
      stopListening();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePickFiles = async (types: 'all' | 'images' | 'code' = 'all') => {
    setIsAttachMenuOpen(false);
    try {
      if (api.pickFiles) {
        const picked = await api.pickFiles(types);
        if (picked && picked.length > 0) {
          setAttachments((prev) => [...prev, ...picked]);
        }
      } else if (hiddenFileInputRef.current) {
        hiddenFileInputRef.current.click();
      }
    } catch (err) {
      console.error('File pick failed:', err);
    }
  };

  const handleNativeFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImg = file.type.startsWith('image/');
      const reader = new FileReader();

      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        setAttachments((prev) => [
          ...prev,
          {
            id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name: file.name,
            path: (file as any).path || file.name,
            size: file.size,
            type: isImg ? 'image' : 'file',
            dataUrl: isImg ? dataUrl : undefined,
          },
        ]);
      };

      if (isImg) {
        reader.readAsDataURL(file);
      } else {
        setAttachments((prev) => [
          ...prev,
          {
            id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name: file.name,
            path: (file as any).path || file.name,
            size: file.size,
            type: 'file',
          },
        ]);
      }
    }
    e.target.value = '';
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = e.dataTransfer.files;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name);
        const reader = new FileReader();

        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          setAttachments((prev) => [
            ...prev,
            {
              id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              name: file.name,
              path: (file as any).path || file.name,
              size: file.size,
              type: isImg ? 'image' : 'file',
              dataUrl: isImg ? dataUrl : undefined,
            },
          ]);
        };

        if (isImg) {
          reader.readAsDataURL(file);
        } else {
          setAttachments((prev) => [
            ...prev,
            {
              id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              name: file.name,
              path: (file as any).path || file.name,
              size: file.size,
              type: 'file',
            },
          ]);
        }
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastPasteTimeRef.current < 400) {
      return;
    }

    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const items = clipboardData.items;
    const files = clipboardData.files;
    const newImageFiles: File[] = [];

    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) newImageFiles.push(file);
        }
      }
    } else if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name)) {
          newImageFiles.push(file);
        }
      }
    }

    if (newImageFiles.length > 0) {
      lastPasteTimeRef.current = now;
      const pastedText = clipboardData.getData('text/plain');
      // If pure image paste, prevent default placeholder text insertion
      if (!pastedText) {
        e.preventDefault();
      }

      newImageFiles.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          setAttachments((prev) => {
            const nextImgNum = prev.filter((a) => a.type === 'image').length + 1;
            const ext = file.name && file.name.includes('.') ? file.name.split('.').pop() || 'png' : 'png';
            const base = (file.name && file.name !== 'image.png' && file.name !== 'blob')
              ? file.name
              : `screenshot_${nextImgNum}.${ext}`;

            return [
              ...prev,
              {
                id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                name: base,
                path: (file as any).path || base,
                size: file.size,
                type: 'image',
                dataUrl,
              },
            ];
          });
        };
        reader.readAsDataURL(file);
      });
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, isCenteredLayout ? 56 : 40), 200)}px`;
    }
  }, [text, isCenteredLayout]);

  const currentModelId = isAutoModel ? 'auto' : (selectedModel || 'auto');
  const activeModelDisplay = formatModelDisplayName(currentModelId);

  // Real models without duplicate entries
  const modelsList = availableModels && availableModels.length > 0 
    ? Array.from(new Set(availableModels))
    : ['auto'];

  const canSubmit = (text.trim().length > 0 || attachments.length > 0) && !disabled;

  return (
    <div className={`w-full flex flex-col items-center ${isCenteredLayout ? 'px-4 py-8' : 'px-4 pb-4 pt-1 bg-gradient-to-t from-[var(--bg-canvas)] via-[var(--bg-canvas)]/80 to-transparent'}`}>
      {/* Hidden File Input fallback */}
      <input
        ref={hiddenFileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleNativeFileInputChange}
      />

      {/* If Centered Layout: Top Brand Hero + Workspace Chip */}
      {isCenteredLayout && (
        <div className="flex flex-col items-center mb-6">
          <div className="relative mb-3 flex items-center justify-center">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 p-2.5 flex items-center justify-center shadow-lg backdrop-blur-xs group">
              <img
                src="/logo-bw.png"
                alt="Byte"
                className="w-full h-full object-contain filter drop-shadow-sm select-none transition-transform duration-300 group-hover:scale-105"
              />
            </div>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)] mb-1">
            Byte AI
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mb-4">
            Autonomous Lead Engineer & Pairing Partner
          </p>
          <button
            onClick={onSelectWorkspace}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-[var(--text-primary)] hover:text-[var(--text-primary)] bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-card)] transition-colors cursor-pointer"
          >
            <Folder className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            <span>{workspaceName || 'Select Workspace'}</span>
            <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
          </button>
        </div>
      )}

      {/* Floating Prompt Card (The Antigravity input box) */}
      <div 
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`w-full ${isCenteredLayout ? 'max-w-2xl' : 'max-w-3xl'} bg-[var(--bg-surface-hover)] border ${isDraggingOver ? 'border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]' : 'border-[var(--border-card)]'} rounded-2xl p-3 shadow-2xl transition-all focus-within:border-[var(--border-subtle)] relative`}
      >
        {taskState === 'paused' && (
          <div className="mb-2.5 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs text-amber-200 animate-in fade-in duration-150">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span><strong>Task is Paused.</strong> Autonomous supervision and background turns are on hold.</span>
            </div>
            {onUpdateTaskState && (
              <button
                type="button"
                onClick={() => onUpdateTaskState('in_progress')}
                className="px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 text-[11px] font-medium transition-colors cursor-pointer"
              >
                Resume Task
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col">
          {/* Attachment Preview Chips */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-2 mb-1.5 border-b border-[var(--border-subtle)] animate-in fade-in duration-150">
              {attachments.map((att, idx) => {
                const imageIndex = att.type === 'image'
                  ? attachments.slice(0, idx + 1).filter((a) => a.type === 'image').length
                  : undefined;

                return (
                  <div 
                    key={att.id}
                    className="flex items-center space-x-2 bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-subtle)] text-[var(--text-primary)] px-2.5 py-1 rounded-xl text-xs group/att transition-all shadow-sm max-w-[240px]"
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
                        className="w-5 h-5 rounded object-cover shrink-0 border border-white/10 cursor-pointer hover:opacity-80 transition-opacity" 
                        title="Click to preview & zoom"
                      />
                    ) : att.type === 'image' ? (
                      <ImageIcon className="w-4 h-4 text-sky-400 shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <span 
                      onClick={() => {
                        if (att.type === 'image' && att.dataUrl) {
                          setPreviewModalImg({ url: att.dataUrl, name: att.name, size: att.size });
                        }
                      }}
                      className={`truncate font-mono text-[11px] text-[var(--text-primary)] ${att.type === 'image' && att.dataUrl ? 'cursor-pointer hover:underline hover:text-sky-400' : ''}`}
                      title={att.type === 'image' && att.dataUrl ? 'Click to preview & zoom' : att.name}
                    >
                      {att.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(att.id)}
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/10 p-0.5 rounded-full transition-colors cursor-pointer"
                      title="Remove attachment"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Live Voice Dictation Streaming Pill */}
          {isListening && (
            <div className="flex items-center justify-between px-3 py-1.5 mb-2 bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl text-xs animate-in fade-in slide-in-from-bottom-1 duration-150 shadow-lg select-none">
              <div className="flex items-center space-x-2 min-w-0 flex-1 mr-2">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                <span className="text-[var(--text-secondary)] font-medium shrink-0">Listening:</span>
                <span className="text-[var(--text-primary)] font-medium truncate italic font-sans">
                  {interimText ? `"${interimText}"` : 'Speak now...'}
                </span>
              </div>

              {/* Dynamic Audio Waveform Bars (reacts to voice volume) */}
              <div className="flex items-center space-x-0.5 shrink-0">
                {[0.4, 0.7, 1, 0.6, 0.3].map((factor, i) => {
                  const h = Math.max(3, Math.min(16, (audioLevel / 100) * 16 * factor + 3));
                  return (
                    <div
                      key={i}
                      style={{ height: `${h}px` }}
                      className="w-0.5 bg-red-400 rounded-full transition-all duration-75"
                    />
                  );
                })}
                <button
                  type="button"
                  onClick={stopListening}
                  className="ml-2.5 text-[10px] font-medium text-[var(--text-primary)] hover:text-[var(--text-primary)] px-2 py-0.5 rounded bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {voiceError && (
            <div className="flex items-center justify-between text-rose-400 text-[11px] px-3 py-1 mb-2 bg-rose-950/40 border border-rose-900/40 rounded-xl animate-in fade-in duration-100">
              <span>{voiceError}</span>
              <button 
                type="button"
                onClick={stopListening}
                className="text-xs text-rose-300 hover:text-[var(--text-primary)] cursor-pointer ml-2"
              >
                ✕
              </button>
            </div>
          )}

          {/* Text input area */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={attachments.length > 0 ? "Add instructions or press Enter to analyze attachments..." : "Ask anything, @ to mention, / for actions"}
            disabled={disabled || isStreaming}
            rows={isCenteredLayout ? 2 : 1}
            className="w-full bg-transparent text-[var(--text-primary)] placeholder-[#6c707a] text-[13px] resize-none focus:outline-none p-1 font-sans leading-relaxed min-h-[44px]"
          />

          {/* Bottom Card Controls Row */}
          <div className="flex items-center justify-between pt-2 mt-1 border-t border-[var(--border-subtle)]/60">
            {/* Left Tools: + attachment & Model Selector Pill */}
            <div className="flex items-center space-x-2 relative">
              {/* Context Attachment Button (+) with Popover Menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsAttachMenuOpen(!isAttachMenuOpen)}
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                    isAttachMenuOpen || attachments.length > 0
                      ? 'text-[#38bdf8] bg-[var(--bg-surface-hover)]/10 border border-[var(--border-subtle)]/30'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
                  }`}
                  title="Attach files, images, or code"
                >
                  <Plus className="w-4 h-4" />
                </button>

                {/* Attachment Type Menu Popover */}
                {isAttachMenuOpen && (
                  <div 
                    className="absolute bottom-9 left-0 w-48 bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl py-1 text-xs text-[var(--text-primary)] z-50 animate-in fade-in zoom-in-95 duration-100"
                    onMouseLeave={() => setIsAttachMenuOpen(false)}
                  >
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border-subtle)]">
                      Add Attachment
                    </div>

                    <button
                      type="button"
                      onClick={() => handlePickFiles('images')}
                      className="w-full flex items-center space-x-2.5 px-3 py-2 text-left hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                    >
                      <ImageIcon className="w-4 h-4 text-sky-400" />
                      <span>Upload Images</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handlePickFiles('code')}
                      className="w-full flex items-center space-x-2.5 px-3 py-2 text-left hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                    >
                      <Code className="w-4 h-4 text-emerald-400" />
                      <span>Code & Text Files</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handlePickFiles('all')}
                      className="w-full flex items-center space-x-2.5 px-3 py-2 text-left hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer border-t border-[var(--border-subtle)]"
                    >
                      <Paperclip className="w-4 h-4 text-amber-400" />
                      <span>Browse All Files...</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Model Pill showing active real model */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium text-[var(--text-primary)] hover:text-[var(--text-primary)] bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] transition-colors cursor-pointer"
                >
                  <span>{activeModelDisplay}</span>
                  <ShieldCheck className="w-3.5 h-3.5 text-[#fbbf24]" />
                  <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
                </button>

                {isModelDropdownOpen && (
                  <div 
                    className="absolute bottom-9 left-0 w-64 bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl py-1 text-xs text-[var(--text-primary)] z-50 max-h-64 overflow-y-auto"
                    onMouseLeave={() => setIsModelDropdownOpen(false)}
                  >
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border-subtle)]">
                      Available Models
                    </div>

                    <div className="py-1">
                      {modelsList.map((m) => {
                        const isAuto = m === 'auto';
                        const isSelected = (isAutoModel && isAuto) || (!isAutoModel && selectedModel === m);
                        const friendlyName = formatModelDisplayName(m);

                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              onChangeModel(m, isAuto);
                              setIsModelDropdownOpen(false);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer ${
                              isSelected ? 'bg-[var(--bg-surface-hover)] text-[#70a6ff]' : 'text-[var(--text-primary)]'
                            }`}
                          >
                            <div className="flex flex-col min-w-0 pr-2">
                              <span className="font-medium text-[12px] truncate flex items-center space-x-1.5">
                                <span>{friendlyName}</span>
                                {isAuto && <span className="text-[10px] text-[#fbbf24] font-normal">(Smart)</span>}
                              </span>
                              <span className="text-[10px] text-[var(--text-muted)] font-mono truncate">{m}</span>
                            </div>

                            <div className="shrink-0 flex items-center space-x-1">
                              {isAuto ? (
                                <ShieldCheck className="w-3.5 h-3.5 text-[#fbbf24]" />
                              ) : isSelected ? (
                                <Check className="w-3.5 h-3.5 text-[#70a6ff]" />
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Autonomous Mode Toggle Pill (Available in all modes) */}
              <button
                type="button"
                onClick={onToggleAutonomousMode}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition-all cursor-pointer ${
                  isAutonomousMode
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-500/10'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-surface-hover)] border-[var(--border-subtle)]'
                }`}
                title={
                  isAutonomousMode
                    ? 'Autonomous Mode is ON: Byte will drive this task to full completion without stopping. If idle for 2 minutes, the system automatically wakes Byte up to continue working.'
                    : 'Turn ON Autonomous Mode: AI will work autonomously until the task is complete without waiting for user input.'
                }
              >
                <Zap className={`w-3.5 h-3.5 ${isAutonomousMode ? 'text-amber-400 fill-amber-400' : 'text-[var(--text-muted)]'}`} />
                <span>Autonomous</span>
                <span className={`text-[9.5px] font-mono px-1 py-0.2 rounded font-semibold ${isAutonomousMode ? 'bg-amber-500/25 text-amber-200' : 'bg-black/20 text-[var(--text-muted)]'}`}>
                  {isAutonomousMode ? 'ON' : 'OFF'}
                </span>
              </button>

              {/* Duty Shift Pill & Popover (Jules Mode Only) */}
              {mode === 'jules' && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsDutyDropdownOpen(!isDutyDropdownOpen)}
                    className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition-colors cursor-pointer ${
                      activeShift && activeShift.status === 'active'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-sm'
                        : isDutyShiftEnabled
                        ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40 shadow-sm'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-surface-hover)] border-[var(--border-subtle)]'
                    }`}
                    title="Continuous Long-Running Duty Shift (Jules Lead Mode)"
                  >
                    <Moon className={`w-3.5 h-3.5 ${activeShift ? 'text-amber-400' : isDutyShiftEnabled ? 'text-indigo-400' : 'text-[var(--text-muted)]'}`} />
                    <span>
                      {activeShift && activeShift.status === 'active'
                        ? `Duty: ${remainingTimeDisplay || 'Active'}`
                        : isDutyShiftEnabled
                        ? `Duty (${dutyHours}h)`
                        : 'Duty Shift'}
                    </span>
                    <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
                  </button>

                  {isDutyDropdownOpen && (
                    <div 
                      className="absolute bottom-9 left-0 w-72 bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl p-3.5 text-xs text-[var(--text-primary)] z-50 animate-in fade-in zoom-in-95 duration-150"
                      onMouseLeave={() => setIsDutyDropdownOpen(false)}
                    >
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--border-subtle)]">
                        <div className="flex items-center space-x-1.5 font-semibold text-[12px] text-[var(--text-primary)]">
                          <Moon className="w-4 h-4 text-amber-400" />
                          <span>Autonomous Duty Shift</span>
                        </div>
                        {activeShift && activeShift.status === 'active' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono">
                            ACTIVE
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed mb-3">
                        Byte operates on continuous duty as Lead Engineer. It will supervise Jules, chain phases, and merge code without stopping.
                      </p>

                      {activeShift && activeShift.status === 'active' ? (
                        <div className="space-y-2">
                          <div className="p-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-between">
                            <span className="text-[11px] text-[var(--text-secondary)]">Remaining Duty:</span>
                            <span className="font-mono font-medium text-amber-300 text-xs">{remainingTimeDisplay}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              stopShift();
                              setIsDutyDropdownOpen(false);
                            }}
                            className="w-full py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 text-xs font-medium transition-colors cursor-pointer"
                          >
                            Stop Duty Shift
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] font-medium text-[var(--text-secondary)]">
                              Enable for this task:
                            </label>
                            <input
                              type="checkbox"
                              checked={isDutyShiftEnabled}
                              onChange={(e) => setIsDutyShiftEnabled(e.target.checked)}
                              className="rounded border-[var(--border-subtle)] text-indigo-500 focus:ring-0 cursor-pointer h-4 w-4"
                            />
                          </div>

                          <div>
                            <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                              Shift Duration
                            </div>
                            <div className="grid grid-cols-4 gap-1.5">
                              {[2, 4, 8, 12].map((h) => (
                                <button
                                  key={h}
                                  type="button"
                                  onClick={() => {
                                    setDutyHours(h);
                                    setIsDutyShiftEnabled(true);
                                  }}
                                  className={`py-1.5 rounded-lg text-center text-xs font-medium transition-colors cursor-pointer border ${
                                    dutyHours === h && isDutyShiftEnabled
                                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                                      : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-subtle)]'
                                  }`}
                                >
                                  {h === 8 ? '8h (Night)' : `${h}h`}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 pt-1">
                            <span className="text-[11px] text-[var(--text-muted)]">Custom:</span>
                            <input
                              type="number"
                              min="0.5"
                              max="24"
                              step="0.5"
                              value={dutyHours}
                              onChange={(e) => {
                                setDutyHours(parseFloat(e.target.value) || 8);
                                setIsDutyShiftEnabled(true);
                              }}
                              className="w-16 px-2 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] font-mono text-center"
                            />
                            <span className="text-[11px] text-[var(--text-muted)]">hours</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right Tools: Mic & Send Arrow */}
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={toggleListening}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isListening
                    ? 'bg-red-500/20 text-red-400 ring-2 ring-red-500/40 animate-pulse'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
                }`}
                title={isListening ? 'Stop listening (Voice dictation active)' : 'Voice dictation (click to speak)'}
              >
                {isListening ? (
                  <MicOff className="w-4 h-4 text-red-400" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>

              {isStreaming ? (
                <button
                  type="button"
                  onClick={onCancel}
                  className="w-7 h-7 rounded-full flex items-center justify-center bg-red-600 hover:bg-red-500 text-[var(--text-primary)] transition-colors cursor-pointer shadow"
                  title="Stop generating"
                >
                  <Square className="w-3 h-3 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                    canSubmit
                      ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] shadow-md'
                      : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)] cursor-not-allowed'
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
            className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer"
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
            <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
          </button>

          {isModeDropdownOpen && (
            <div 
              className="absolute top-8 left-1/2 -translate-x-1/2 w-48 bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl shadow-2xl py-1 text-xs text-[var(--text-primary)] z-50"
              onMouseLeave={() => setIsModeDropdownOpen(false)}
            >
              <button
                type="button"
                onClick={() => {
                  onToggleMode('standard');
                  setIsModeDropdownOpen(false);
                }}
                className={`w-full flex items-center space-x-2 px-3 py-2 hover:bg-[var(--bg-surface-hover)] ${mode === 'standard' ? 'text-emerald-400 font-medium' : ''}`}
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
                className={`w-full flex items-center space-x-2 px-3 py-2 hover:bg-[var(--bg-surface-hover)] ${mode === 'jules' ? 'text-sky-400 font-medium' : ''}`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Jules Lead (Google Labs)</span>
              </button>
            </div>
          )}
        </div>
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
