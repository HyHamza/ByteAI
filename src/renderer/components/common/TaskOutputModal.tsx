import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, 
  X, 
  Copy, 
  Check, 
  Loader2, 
  Square, 
  ArrowDown, 
  Folder, 
  Clock, 
  Maximize2, 
  Minimize2,
  Trash2,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import type { ActiveTaskItem } from '@/shared/types';
import { api } from '@/renderer/api';

interface TaskOutputModalProps {
  task: ActiveTaskItem | null;
  isOpen: boolean;
  onClose: () => void;
  onKillTask?: (taskId: string) => Promise<void>;
}

function cleanAnsi(text: string): string {
  if (!text) return '';
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

export const TaskOutputModal: React.FC<TaskOutputModalProps> = ({
  task,
  isOpen,
  onClose,
  onKillTask,
}) => {
  const [output, setOutput] = useState<string>('');
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('running');
  const [copied, setCopied] = useState<boolean>(false);
  const [isKilling, setIsKilling] = useState<boolean>(false);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Poll logs for the task
  useEffect(() => {
    if (!isOpen || !task) {
      setOutput('');
      return;
    }

    let isMounted = true;
    const taskId = task.taskId || (task.id.startsWith('task-') ? task.id : undefined);

    const fetchLogs = async () => {
      try {
        if (taskId && api.getTaskLogs) {
          const res = await api.getTaskLogs(taskId);
          if (!isMounted) return;
          if (res) {
            setIsRunning(res.isRunning);
            setExitCode(res.exitCode);
            setStatus(res.status);
            if (res.output) {
              setOutput(cleanAnsi(res.output));
            }
          }
        } else if (task.output) {
          setOutput(cleanAnsi(task.output));
          setIsRunning(task.status === 'running' || task.status === 'pending');
        }
      } catch (_) {}
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 800);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isOpen, task]);

  // Auto-scroll terminal output to bottom
  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [output, autoScroll]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !task) return null;

  const handleCopy = async () => {
    const textToCopy = output || task.label || '';
    try {
      if (api.copyTextToClipboard) {
        await api.copyTextToClipboard(textToCopy);
      } else if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  const handleKill = async () => {
    const taskId = task.taskId || (task.id.startsWith('task-') ? task.id : undefined);
    if (!taskId) return;
    setIsKilling(true);
    try {
      if (onKillTask) {
        await onKillTask(taskId);
      } else if (api.killTask) {
        await api.killTask(taskId);
      }
      setIsRunning(false);
      setStatus('killed');
    } catch (_) {} finally {
      setIsKilling(false);
    }
  };

  const commandTitle = task.command || task.label;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div 
        className={`w-full ${isMaximized ? 'max-w-6xl h-[90vh]' : 'max-w-3xl h-[620px]'} bg-[#12141a] border border-[#262933] rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-200 select-text`}
      >
        {/* Terminal Window Titlebar */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#181a22] border-b border-[#262933] select-none">
          <div className="flex items-center space-x-3 min-w-0 flex-1 mr-3">
            {/* Window control dots */}
            <div className="flex items-center space-x-1.5 shrink-0">
              <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
            </div>

            <div className="flex items-center space-x-2 min-w-0 flex-1">
              <Terminal className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-xs font-mono font-medium text-zinc-200 truncate">
                $ {commandTitle}
              </span>
            </div>

            {/* Live Status Pill */}
            <div className="shrink-0 flex items-center space-x-1.5">
              {isRunning ? (
                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 animate-pulse">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Running</span>
                </span>
              ) : exitCode === 0 || status === 'completed' ? (
                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Completed (Exit 0)</span>
                </span>
              ) : (
                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-rose-950/80 text-rose-300 border border-rose-800/60">
                  <AlertCircle className="w-3 h-3" />
                  <span>{status === 'killed' ? 'Terminated' : `Failed (Exit ${exitCode || 1})`}</span>
                </span>
              )}
            </div>
          </div>

          {/* Right Action Tools */}
          <div className="flex items-center space-x-1.5 shrink-0">
            {/* Auto-scroll toggle */}
            <button
              type="button"
              onClick={() => setAutoScroll(!autoScroll)}
              className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                autoScroll
                  ? 'bg-zinc-800 text-cyan-300 border border-cyan-800/40'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
              title={autoScroll ? 'Auto-scroll is ON' : 'Auto-scroll is OFF'}
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>

            {/* Copy Output */}
            <button
              type="button"
              onClick={handleCopy}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors cursor-pointer text-xs"
              title="Copy terminal output"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Stop Task (if running) */}
            {isRunning && (task.taskId || task.id.startsWith('task-')) && (
              <button
                type="button"
                onClick={handleKill}
                disabled={isKilling}
                className="flex items-center space-x-1 px-2 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/50 text-[11px] font-medium transition-colors cursor-pointer"
                title="Stop / Kill this task"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>{isKilling ? 'Stopping...' : 'Stop Task'}</span>
              </button>
            )}

            {/* Maximize / Restore */}
            <button
              type="button"
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors cursor-pointer text-xs"
              title={isMaximized ? 'Restore size' : 'Maximize window'}
            >
              {isMaximized ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors cursor-pointer text-xs"
              title="Close output viewer (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Terminal Console Body */}
        <div 
          ref={terminalRef}
          className="flex-1 bg-[#090b10] p-4 font-mono text-[12.5px] leading-relaxed text-zinc-300 overflow-y-auto whitespace-pre-wrap select-text scrollbar-thin scrollbar-thumb-zinc-700"
        >
          {output ? (
            output
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-2 select-none">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
              <p className="text-xs font-mono">Listening for live process output...</p>
            </div>
          )}
        </div>

        {/* Terminal Status / Footer Bar */}
        <div className="px-4 py-2 bg-[#14161f] border-t border-[#262933] flex items-center justify-between text-[11px] text-zinc-400 font-mono select-none">
          <div className="flex items-center space-x-3">
            {task.taskId && (
              <span className="text-zinc-500">ID: {task.taskId}</span>
            )}
            {task.cwd && (
              <span className="flex items-center space-x-1 text-zinc-500 truncate max-w-[320px]">
                <Folder className="w-3 h-3 text-zinc-500" />
                <span className="truncate">{task.cwd}</span>
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <span>{output.split('\n').length} lines</span>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-400">UTF-8</span>
          </div>
        </div>
      </div>
    </div>
  );
};
