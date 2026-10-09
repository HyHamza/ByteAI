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
  MicOff
} from 'lucide-react';
import type { AppMode, AttachmentFile } from '@/shared/types';
import { api } from '../../api';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';

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
}

export function formatModelDisplayName(modelId: string): string {
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
}) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hiddenFileInputRef = useRef<HTMLInputElement>(null);

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
    onSendMessage(text.trim(), attachments);
    setText('');
    setAttachments([]);
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
    <div className={`w-full flex flex-col items-center ${isCenteredLayout ? 'px-4 py-8' : 'px-4 pb-4 pt-1 bg-gradient-to-t from-[#131314] to-transparent'}`}>
      {/* Hidden File Input fallback */}
      <input
        ref={hiddenFileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleNativeFileInputChange}
      />

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
      <div 
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`w-full ${isCenteredLayout ? 'max-w-2xl' : 'max-w-3xl'} bg-[#1c1d21] border ${isDraggingOver ? 'border-[#38bdf8] bg-[#1e232d]' : 'border-[#2c2e35]'} rounded-2xl p-3 shadow-2xl transition-all focus-within:border-[#3d404a] relative`}
      >
        <form onSubmit={handleSubmit} className="flex flex-col">
          {/* Attachment Preview Chips */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-2 mb-1.5 border-b border-[#26282f] animate-in fade-in duration-150">
              {attachments.map((att) => (
                <div 
                  key={att.id}
                  className="flex items-center space-x-2 bg-[#25272e] border border-[#343740] hover:border-[#444754] text-[#d1d5db] px-2.5 py-1 rounded-xl text-xs group/att transition-all shadow-sm max-w-[220px]"
                >
                  {att.type === 'image' && att.dataUrl ? (
                    <img 
                      src={att.dataUrl} 
                      alt={att.name} 
                      className="w-5 h-5 rounded object-cover shrink-0 border border-white/10" 
                    />
                  ) : att.type === 'image' ? (
                    <ImageIcon className="w-4 h-4 text-sky-400 shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                  )}
                  <span className="truncate font-mono text-[11px] text-[#e2e8f0]">{att.name}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(att.id)}
                    className="text-[#8e9196] hover:text-white hover:bg-white/10 p-0.5 rounded-full transition-colors cursor-pointer"
                    title="Remove attachment"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Live Voice Dictation Streaming Pill */}
          {isListening && (
            <div className="flex items-center justify-between px-3 py-1.5 mb-2 bg-[#1c1d24] border border-[#2d313d] rounded-xl text-xs animate-in fade-in slide-in-from-bottom-1 duration-150 shadow-lg select-none">
              <div className="flex items-center space-x-2 min-w-0 flex-1 mr-2">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                <span className="text-[#9ca3af] font-medium shrink-0">Listening:</span>
                <span className="text-[#f1f3f9] font-medium truncate italic font-sans">
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
                  className="ml-2.5 text-[10px] font-medium text-[#c4c7cf] hover:text-white px-2 py-0.5 rounded bg-[#272932] hover:bg-[#343743] transition-colors cursor-pointer"
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
                className="text-xs text-rose-300 hover:text-white cursor-pointer ml-2"
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
            placeholder={attachments.length > 0 ? "Add instructions or press Enter to analyze attachments..." : "Ask anything, @ to mention, / for actions"}
            disabled={disabled || isStreaming}
            rows={isCenteredLayout ? 2 : 1}
            className="w-full bg-transparent text-[#e3e3e3] placeholder-[#6c707a] text-[13px] resize-none focus:outline-none p-1 font-sans leading-relaxed min-h-[44px]"
          />

          {/* Bottom Card Controls Row */}
          <div className="flex items-center justify-between pt-2 mt-1 border-t border-[#25272e]/60">
            {/* Left Tools: + attachment & Model Selector Pill */}
            <div className="flex items-center space-x-2 relative">
              {/* Context Attachment Button (+) with Popover Menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsAttachMenuOpen(!isAttachMenuOpen)}
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                    isAttachMenuOpen || attachments.length > 0
                      ? 'text-[#38bdf8] bg-[#38bdf8]/10 border border-[#38bdf8]/30'
                      : 'text-[#8e9196] hover:text-white hover:bg-[#26282e]'
                  }`}
                  title="Attach files, images, or code"
                >
                  <Plus className="w-4 h-4" />
                </button>

                {/* Attachment Type Menu Popover */}
                {isAttachMenuOpen && (
                  <div 
                    className="absolute bottom-9 left-0 w-48 bg-[#1a1b20] border border-[#2d2f38] rounded-2xl shadow-2xl py-1 text-xs text-[#c4c7cf] z-50 animate-in fade-in zoom-in-95 duration-100"
                    onMouseLeave={() => setIsAttachMenuOpen(false)}
                  >
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-[#6c707a] uppercase tracking-wider border-b border-[#25272e]">
                      Add Attachment
                    </div>

                    <button
                      type="button"
                      onClick={() => handlePickFiles('images')}
                      className="w-full flex items-center space-x-2.5 px-3 py-2 text-left hover:bg-[#26282f] hover:text-white transition-colors cursor-pointer"
                    >
                      <ImageIcon className="w-4 h-4 text-sky-400" />
                      <span>Upload Images</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handlePickFiles('code')}
                      className="w-full flex items-center space-x-2.5 px-3 py-2 text-left hover:bg-[#26282f] hover:text-white transition-colors cursor-pointer"
                    >
                      <Code className="w-4 h-4 text-emerald-400" />
                      <span>Code & Text Files</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handlePickFiles('all')}
                      className="w-full flex items-center space-x-2.5 px-3 py-2 text-left hover:bg-[#26282f] hover:text-white transition-colors cursor-pointer border-t border-[#25272e]"
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
                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium text-[#c4c7cf] hover:text-white bg-[#24262b] hover:bg-[#2b2d34] border border-[#30333b] transition-colors cursor-pointer"
                >
                  <span>{activeModelDisplay}</span>
                  <ShieldCheck className="w-3.5 h-3.5 text-[#fbbf24]" />
                  <ChevronDown className="w-3 h-3 text-[#7a7e88]" />
                </button>

                {isModelDropdownOpen && (
                  <div 
                    className="absolute bottom-9 left-0 w-64 bg-[#1b1c20] border border-[#2b2d33] rounded-2xl shadow-2xl py-1 text-xs text-[#c4c7cf] z-50 max-h-64 overflow-y-auto"
                    onMouseLeave={() => setIsModelDropdownOpen(false)}
                  >
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-[#6c707a] uppercase tracking-wider border-b border-[#25272e]">
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
                            className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[#26282e] transition-colors cursor-pointer ${
                              isSelected ? 'bg-[#22242b] text-[#70a6ff]' : 'text-[#c4c7cf]'
                            }`}
                          >
                            <div className="flex flex-col min-w-0 pr-2">
                              <span className="font-medium text-[12px] truncate flex items-center space-x-1.5">
                                <span>{friendlyName}</span>
                                {isAuto && <span className="text-[10px] text-[#fbbf24] font-normal">(Smart)</span>}
                              </span>
                              <span className="text-[10px] text-[#6c707a] font-mono truncate">{m}</span>
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
            </div>

            {/* Right Tools: Mic & Send Arrow */}
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={toggleListening}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isListening
                    ? 'bg-red-500/20 text-red-400 ring-2 ring-red-500/40 animate-pulse'
                    : 'text-[#8e9196] hover:text-white hover:bg-[#26282e]'
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
                  className="w-7 h-7 rounded-full flex items-center justify-center bg-red-600 hover:bg-red-500 text-white transition-colors cursor-pointer shadow"
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
                      ? 'bg-[#1a73e8] text-white hover:bg-[#165ec2] shadow-md'
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
