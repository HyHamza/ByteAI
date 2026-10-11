import React, { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Terminal, 
  FileText, 
  Folder, 
  Sparkles, 
  ChevronDown, 
  ChevronRight, 
  Loader2, 
  AlertCircle,
  Copy,
  Check,
  GitMerge,
  Search,
  GitPullRequest,
  MessageSquare,
  Activity,
  Atom,
  Brain,
  FileCode
} from 'lucide-react';
import type { ToolExecutionRecord } from '@/shared/types';

export interface ToolCardProps {
  tool: ToolExecutionRecord;
}

// ── File Type Icon Helper (Antigravity Style Atom / Code Icons) ─────────────
export function getFileIcon(filePath: string) {
  if (!filePath) return <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (['tsx', 'jsx', 'ts', 'js', 'mjs', 'cjs'].includes(ext)) {
    return <Atom className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
  }
  if (['css', 'scss', 'sass', 'less'].includes(ext)) {
    return <FileCode className="w-3.5 h-3.5 text-pink-400 shrink-0" />;
  }
  if (['json', 'md', 'markdown', 'txt', 'yml', 'yaml'].includes(ext)) {
    return <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  }
  if (['py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'cs'].includes(ext)) {
    return <FileCode className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  }
  return <FileCode className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
}

// ── File Language Badge Helper ──────────────────────────────────────────────
export function getFileBadge(filePath: string): { label: string; colorClass: string } {
  if (!filePath) return { label: 'FILE', colorClass: 'text-blue-400' };
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return { label: 'TS', colorClass: 'text-[#38bdf8]' };
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return { label: 'JS', colorClass: 'text-[#facc15]' };
    case 'json':
      return { label: 'JSON', colorClass: 'text-[#fbbf24]' };
    case 'py':
      return { label: 'PY', colorClass: 'text-[#34d399]' };
    case 'css':
    case 'scss':
      return { label: 'CSS', colorClass: 'text-[#38bdf8]' };
    case 'html':
      return { label: 'HTML', colorClass: 'text-[#fb923c]' };
    case 'md':
    case 'markdown':
      return { label: 'MD', colorClass: 'text-[#c084fc]' };
    case 'rs':
      return { label: 'RS', colorClass: 'text-[#f97316]' };
    case 'go':
      return { label: 'GO', colorClass: 'text-[#22d3ee]' };
    case 'sh':
    case 'bash':
    case 'ps1':
      return { label: 'SH', colorClass: 'text-[#4ade80]' };
    default:
      return { label: (ext ? ext.toUpperCase().slice(0, 4) : 'FILE'), colorClass: 'text-[#38bdf8]' };
  }
}

// ── Calculate Added / Removed lines for edits ──────────────────────────────
export function getEditDiffStats(tool: ToolExecutionRecord): { added: number; removed: number; isCreate: boolean } {
  const { toolName, args = {} } = tool;
  if (toolName === 'write_file') {
    const lines = (args.content || '').split('\n').length;
    return { added: Math.max(1, lines), removed: 0, isCreate: true };
  }

  // replace_file_content / edit_file_content
  if (args.start_line && args.end_line !== undefined) {
    const removed = Math.max(1, args.end_line - args.start_line + 1);
    const added = args.replacement_content !== undefined 
      ? args.replacement_content.split('\n').length 
      : 0;
    return { added, removed, isCreate: false };
  }

  if (args.target_content && args.replacement_content !== undefined) {
    const removed = args.target_content.split('\n').length;
    const added = args.replacement_content.split('\n').length;
    return { added, removed, isCreate: false };
  }

  return { added: 1, removed: 0, isCreate: false };
}

function getBasename(filePath: string): string {
  if (!filePath) return 'file';
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').pop() || normalized;
}

// ── Copy Helper Hook ────────────────────────────────────────────────────────
function useCopy() {
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const copy = (e: React.MouseEvent, text: string, type: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };
  return { copiedType, copy };
}

// ── Antigravity Style File Edit Item ────────────────────────────────────────
export const AntigravityEditItem: React.FC<{ tool: ToolExecutionRecord }> = ({ tool }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { copiedType, copy } = useCopy();
  const { args = {}, status } = tool;
  const filePath = args.path || 'file';
  const filename = getBasename(filePath);
  const fileIcon = getFileIcon(filePath);
  const { added, removed, isCreate } = getEditDiffStats(tool);

  return (
    <div className="font-sans text-[13.5px] leading-relaxed select-none group/edit">
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center space-x-1.5 py-0.5 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors w-fit"
      >
        <span className="font-normal">
          {isCreate ? 'Created' : 'Edited'}
        </span>
        {fileIcon}
        <span className="font-medium text-[var(--text-primary)] hover:underline">
          {filename}
        </span>
        <span className="text-[#22c55e] font-mono text-[12px] font-medium ml-1">
          +{added}
        </span>
        <span className="text-[#ef4444] font-mono text-[12px] font-medium ml-0.5">
          -{removed}
        </span>

        {status === 'running' && (
          <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin ml-1" />
        )}
        {status === 'error' && (
          <AlertCircle className="w-4 h-4 text-rose-400 ml-1" />
        )}
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-[var(--text-muted)] ml-0.5" />
        ) : (
          <ChevronRight className="w-4 h-4 text-[var(--text-muted)] ml-0.5" />
        )}
      </div>

      {isExpanded && (
        <div className="mt-1 mb-2 pl-3 border-l border-[var(--border-subtle)] ml-1.5 space-y-2 font-mono text-[12px] animate-in fade-in duration-150">
          <div className="flex items-center justify-between text-[var(--text-muted)] text-[11px] pr-2 pt-1">
            <span>{filePath}</span>
            <button
              type="button"
              onClick={(e) => copy(e, JSON.stringify(tool.args, null, 2), 'args')}
              className="flex items-center space-x-1 hover:text-[var(--text-primary)] px-1.5 py-0.5 rounded hover:bg-[var(--bg-surface-hover)] transition-colors"
            >
              {copiedType === 'args' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedType === 'args' ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          {args.target_content && (
            <div className="bg-[var(--bg-surface-hover)] border border-rose-950/60 rounded p-2 text-rose-300 whitespace-pre-wrap select-text">
              <div className="text-[10.5px] text-rose-500 font-semibold mb-1 uppercase tracking-wider">- Original</div>
              {args.target_content}
            </div>
          )}

          {args.replacement_content !== undefined && (
            <div className="bg-[var(--bg-surface-hover)] border border-emerald-950/60 rounded p-2 text-emerald-300 whitespace-pre-wrap select-text">
              <div className="text-[10.5px] text-emerald-500 font-semibold mb-1 uppercase tracking-wider">+ Replacement</div>
              {args.replacement_content}
            </div>
          )}

          {args.content && !args.target_content && (
            <div className="bg-[var(--bg-surface-hover)] border border-emerald-950/60 rounded p-2 text-emerald-300 whitespace-pre-wrap select-text max-h-[300px] overflow-y-auto">
              <div className="text-[10.5px] text-emerald-500 font-semibold mb-1 uppercase tracking-wider">+ File Content</div>
              {args.content}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Antigravity Style Thought Item ──────────────────────────────────────────
export const AntigravityThoughtItem: React.FC<{
  content: string;
  durationSec: number;
  isIndented?: boolean;
}> = ({ content, durationSec, isIndented = false }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`font-sans text-[13.5px] leading-relaxed select-none ${isIndented ? 'pl-4' : ''}`}>
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center space-x-1 py-0.5 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors group/th w-fit"
      >
        <span>Thought for {durationSec}s</span>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-[var(--text-muted)] group-hover/th:text-[var(--text-primary)]" />
        ) : (
          <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover/th:text-[var(--text-primary)]" />
        )}
      </div>

      {isExpanded && (
        <div className="mt-1 mb-2 pl-3 border-l-2 border-purple-500/40 ml-1.5 font-mono text-[12px] text-[var(--text-secondary)] bg-[var(--bg-sidebar)]/80 p-2.5 rounded-r-lg max-h-72 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text animate-in fade-in duration-150">
          {content}
        </div>
      )}
    </div>
  );
};

// ── Antigravity Style Step Text / AI Narrative Item ─────────────────────────
export const AntigravityStepTextItem: React.FC<{
  content: string;
  isIndented?: boolean;
}> = ({ content, isIndented = false }) => {
  if (!content || !content.trim()) return null;

  return (
    <div className={`font-sans text-[13px] text-[var(--text-primary)] leading-relaxed py-1.5 select-text ${isIndented ? 'pl-4' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content.trim()}
      </ReactMarkdown>
    </div>
  );
};

// ── Antigravity Style Analyzed File Sub-Item ────────────────────────────────
export const AntigravityAnalyzedItem: React.FC<{ tool: ToolExecutionRecord }> = ({ tool }) => {
  const [showDetail, setShowDetail] = useState(false);
  const { copiedType, copy } = useCopy();
  const { toolName, args = {} } = tool;

  const filePath = args.path || args.file_path || 'file';
  const filename = getBasename(filePath);
  const fileIcon = getFileIcon(filePath);

  let verb = 'Analyzed';
  let detailRange = '';

  if (toolName === 'read_file') {
    verb = 'Analyzed';
    if (args.start_line && args.end_line) {
      detailRange = `#L${args.start_line}-${args.end_line}`;
    } else if (args.start_line) {
      detailRange = `#L${args.start_line}`;
    }
  } else if (toolName === 'search_codebase') {
    verb = 'Searched';
    detailRange = args.query ? `for "${args.query}"` : '';
  } else if (toolName === 'list_directory') {
    verb = 'Explored';
    detailRange = args.path || '.';
  }

  return (
    <div className="font-sans text-[13px] leading-relaxed select-none pl-4">
      <div
        onClick={() => setShowDetail(!showDetail)}
        className="flex items-center space-x-1.5 py-0.5 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors group/item w-fit"
      >
        <span className="font-normal">{verb}</span>
        {fileIcon}
        <span className="font-medium text-[var(--text-primary)] group-hover/item:underline">{filename}</span>
        {detailRange && (
          <span className="text-[var(--text-muted)] font-mono text-[11.5px] ml-0.5">{detailRange}</span>
        )}
        {tool.status === 'running' && (
          <Loader2 className="w-3 h-3 text-cyan-400 animate-spin ml-1" />
        )}
        {showDetail ? (
          <ChevronDown className="w-3 h-3 text-[var(--text-muted)] ml-0.5 opacity-0 group-hover/item:opacity-100" />
        ) : (
          <ChevronRight className="w-3 h-3 text-[var(--text-muted)] ml-0.5 opacity-0 group-hover/item:opacity-100" />
        )}
      </div>

      {showDetail && (
        <div className="bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] rounded p-2 my-1 text-[11px] font-mono space-y-1.5 ml-2 animate-in fade-in duration-150">
          <div className="flex items-center justify-between text-[var(--text-muted)] text-[10px]">
            <span>{filePath}</span>
            {tool.output && (
              <button
                type="button"
                onClick={(e) => copy(e, tool.output!, 'out')}
                className="hover:text-[var(--text-primary)] px-1 py-0.5 rounded hover:bg-[var(--bg-surface-hover)] transition-colors"
              >
                {copiedType === 'out' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            )}
          </div>
          <pre className="text-[var(--text-primary)] whitespace-pre-wrap max-h-[220px] overflow-y-auto select-text leading-relaxed">
            {tool.output || '(No output)'}
          </pre>
        </div>
      )}
    </div>
  );
};

// ── Antigravity Style Explored Group (Collapsed by Default) ─────────────────
export const AntigravityExploredGroup: React.FC<{
  items: (TrajectoryTool | TrajectoryThought | TrajectoryText)[];
  fileCount: number;
}> = ({ items, fileCount }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const count = fileCount || 1;
  const label = `Explored ${count} ${count === 1 ? 'file' : 'files'}`;

  return (
    <div className="font-sans text-[13.5px] leading-relaxed select-none">
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center space-x-1 py-0.5 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors group/explore w-fit"
      >
        <span>{label}</span>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-[var(--text-muted)] group-hover/explore:text-[var(--text-primary)] transition-transform" />
        ) : (
          <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover/explore:text-[var(--text-primary)] transition-transform" />
        )}
        {items.some((it) => it.type === 'tool' && it.tool.status === 'running') && (
          <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin ml-1" />
        )}
      </div>

      {isExpanded && (
        <div className="space-y-0.5 animate-in fade-in duration-150">
          {items.map((it) => {
            if (it.type === 'thought') {
              return (
                <AntigravityThoughtItem
                  key={it.id}
                  content={it.content}
                  durationSec={it.durationSec}
                  isIndented={true}
                />
              );
            }
            if (it.type === 'text') {
              return (
                <AntigravityStepTextItem
                  key={it.id}
                  content={it.content}
                  isIndented={true}
                />
              );
            }
            return <AntigravityAnalyzedItem key={it.id} tool={it.tool} />;
          })}
        </div>
      )}
    </div>
  );
};

// ── Antigravity Style Command Execution Item ────────────────────────────────
export const AntigravityCommandItem: React.FC<{ tool: ToolExecutionRecord }> = ({ tool }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { copiedType, copy } = useCopy();
  const { args = {}, status } = tool;
  const cmd = args.command || args.command_line || 'command';

  // Check if this tool spawned a background task
  const taskIdMatch = tool.output ? tool.output.match(/task id:\s*([a-zA-Z0-9_-]+)/i) : null;
  const taskId = taskIdMatch ? taskIdMatch[1] : null;

  const [liveLogs, setLiveLogs] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [taskExitCode, setTaskExitCode] = useState<number | null>(null);
  const [isLiveRunning, setIsLiveRunning] = useState<boolean>(Boolean(taskId && status === 'running'));
  const [isKilling, setIsKilling] = useState<boolean>(false);

  // Poll live logs whenever expanded and taskId is present
  useEffect(() => {
    if (!taskId) return;

    let isMounted = true;
    const fetchLogs = async () => {
      try {
        if (window.electronAPI?.getTaskLogs) {
          const res = await window.electronAPI.getTaskLogs(taskId);
          if (!isMounted) return;
          if (res) {
            setTaskStatus(res.status);
            setTaskExitCode(res.exitCode);
            setIsLiveRunning(res.isRunning);
            if (res.output && res.output.trim().length > 0) {
              setLiveLogs(res.output);
            }
          }
        }
      } catch (_) {}
    };

    fetchLogs();
    // Poll every 1000ms if expanded or running
    const interval = setInterval(fetchLogs, 1000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isExpanded, taskId]);

  const handleKill = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!taskId || !window.electronAPI?.killTask) return;
    setIsKilling(true);
    try {
      await window.electronAPI.killTask(taskId);
      setIsLiveRunning(false);
      setTaskStatus('killed');
    } catch (_) {} finally {
      setIsKilling(false);
    }
  };

  // Determine what output to display in the terminal drawer
  const displayOutput = liveLogs || tool.output || '(Running in background...)';

  return (
    <div className="font-sans text-[13.5px] leading-relaxed select-none">
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center space-x-2 py-0.5 cursor-pointer hover:opacity-90 transition-opacity"
      >
        <span className="text-[var(--text-secondary)] font-normal">
          {taskId ? 'Ran background task' : (args.is_background ? 'Ran background task' : 'Ran command')}
        </span>
        <Terminal className="w-4 h-4 text-amber-400 shrink-0" />
        <span className="font-mono text-[var(--text-primary)] text-[12.5px] truncate max-w-[460px]">
          $ {cmd}
        </span>

        {/* Live Running Spinner */}
        {(status === 'running' || isLiveRunning) && (
          <div className="flex items-center space-x-1 text-cyan-400 text-xs font-medium ml-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="text-[11.5px]">Running...</span>
          </div>
        )}

        {/* Completed status indicators */}
        {!isLiveRunning && taskExitCode !== null && (
          <span className={`text-[11px] font-mono px-1.5 py-0.2 rounded ${
            taskExitCode === 0 ? 'text-emerald-400 bg-emerald-950/40' : 'text-rose-400 bg-rose-950/40'
          }`}>
            Exit {taskExitCode}
          </span>
        )}

        {status === 'error' && !isLiveRunning && taskExitCode === null && (
          <AlertCircle className="w-4 h-4 text-rose-400 ml-1" />
        )}

        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-[var(--text-muted)] ml-1" />
        ) : (
          <ChevronRight className="w-4 h-4 text-[var(--text-muted)] ml-1" />
        )}
      </div>

      {isExpanded && (
        <div className="mt-1 mb-2 pl-3 border-l border-[var(--border-subtle)] ml-1.5 font-mono text-[12px] animate-in fade-in duration-150">
          <div className="flex items-center justify-between text-[var(--text-muted)] text-[10.5px] mb-1">
            <div className="flex items-center space-x-2">
              <span>Terminal Output:</span>
              {taskId && (
                <span className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-semibold ${
                  isLiveRunning ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/50' : 
                  taskStatus === 'completed' || taskExitCode === 0 ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/50' : 
                  'bg-zinc-800 text-zinc-300'
                }`}>
                  {isLiveRunning ? 'LIVE STREAMING' : (taskStatus || 'TASK')} {taskExitCode !== null ? `(Exit ${taskExitCode})` : ''}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2">
              {taskId && isLiveRunning && (
                <button
                  type="button"
                  onClick={handleKill}
                  disabled={isKilling}
                  className="flex items-center space-x-1 text-rose-400 hover:text-rose-200 px-1.5 py-0.5 rounded hover:bg-rose-950/50 border border-rose-900/50 transition-colors"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                  <span>{isKilling ? 'Killing...' : 'Kill Task'}</span>
                </button>
              )}
              {displayOutput && (
                <button
                  type="button"
                  onClick={(e) => copy(e, displayOutput, 'cmdOut')}
                  className="flex items-center space-x-1 hover:text-[var(--text-primary)] px-1.5 py-0.5 rounded hover:bg-[var(--bg-surface-hover)] transition-colors"
                >
                  {copiedType === 'cmdOut' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedType === 'cmdOut' ? 'Copied' : 'Copy'}</span>
                </button>
              )}
            </div>
          </div>
          <pre className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded p-2.5 text-[var(--text-primary)] whitespace-pre-wrap max-h-[350px] overflow-y-auto select-text">
            {displayOutput}
          </pre>
        </div>
      )}
    </div>
  );
};

// ── Antigravity Style Generic / Task Item ────────────────────────────────────
export const AntigravityGenericItem: React.FC<{ tool: ToolExecutionRecord }> = ({ tool }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { copiedType, copy } = useCopy();
  const { toolName, args = {}, status } = tool;

  let title = toolName.replace(/_/g, ' ');
  let icon = <Activity className="w-4 h-4 text-cyan-400 shrink-0" />;

  if (toolName === 'resolve_merge_conflict') {
    title = `Resolved conflict ${args.path ? getBasename(args.path) : ''}`;
    icon = <GitMerge className="w-4 h-4 text-amber-400 shrink-0" />;
  } else if (toolName.startsWith('jules_')) {
    if (toolName === 'jules_create_task') title = `Delegated task to Jules`;
    else if (toolName === 'jules_sync_and_merge') title = `Synced Jules task`;
    else if (toolName === 'jules_get_status') title = `Checked Jules status`;
    else if (toolName === 'jules_reply_question') title = `Replied to Jules`;
    else if (toolName === 'jules_inspect_diff') title = `Inspected PR diff`;
    icon = <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />;
  } else if (toolName === 'manage_task') {
    title = `${args.action ? args.action.charAt(0).toUpperCase() + args.action.slice(1) : 'Manage'} task ${args.task_id || ''}`;
    icon = <Activity className="w-4 h-4 text-cyan-400 shrink-0" />;
  }

  return (
    <div className="font-sans text-[13.5px] leading-relaxed select-none">
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center space-x-2 py-0.5 cursor-pointer hover:opacity-90 transition-opacity"
      >
        {icon}
        <span className="font-medium text-[var(--text-primary)]">{title}</span>
        {status === 'running' && (
          <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin ml-1" />
        )}
        {status === 'error' && (
          <AlertCircle className="w-4 h-4 text-rose-400 ml-1" />
        )}
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-[var(--text-muted)] ml-1" />
        ) : (
          <ChevronRight className="w-4 h-4 text-[var(--text-muted)] ml-1" />
        )}
      </div>

      {isExpanded && (
        <div className="mt-1 mb-2 pl-3 border-l border-[var(--border-subtle)] ml-1.5 font-mono text-[11px] animate-in fade-in duration-150 space-y-1.5">
          <div className="flex items-center justify-between text-[var(--text-muted)] text-[10px]">
            <span>Details:</span>
            {tool.output && (
              <button
                type="button"
                onClick={(e) => copy(e, tool.output!, 'genOut')}
                className="flex items-center space-x-1 hover:text-[var(--text-primary)] px-1.5 py-0.5 rounded hover:bg-[var(--bg-surface-hover)] transition-colors"
              >
                {copiedType === 'genOut' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedType === 'genOut' ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>
          <pre className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded p-2 text-[var(--text-primary)] whitespace-pre-wrap max-h-[250px] overflow-y-auto select-text">
            {tool.output || JSON.stringify(tool.args, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

// ── Antigravity Unified Trajectory Flow ─────────────────────────────────────
export interface TrajectoryThought {
  type: 'thought';
  id: string;
  content: string;
  durationSec: number;
}

export interface TrajectoryTool {
  type: 'tool';
  id: string;
  tool: ToolExecutionRecord;
}

export interface TrajectoryText {
  type: 'text';
  id: string;
  content: string;
}

export type TrajectoryItem = TrajectoryThought | TrajectoryTool | TrajectoryText;

export type TrajectoryGroup =
  | {
      type: 'explored_group';
      id: string;
      fileCount: number;
      items: (TrajectoryTool | TrajectoryThought | TrajectoryText)[];
    }
  | {
      type: 'edit';
      id: string;
      tool: ToolExecutionRecord;
    }
  | {
      type: 'command';
      id: string;
      tool: ToolExecutionRecord;
    }
  | {
      type: 'thought';
      id: string;
      thought: TrajectoryThought;
    }
  | {
      type: 'text';
      id: string;
      content: string;
    }
  | {
      type: 'other';
      id: string;
      tool: ToolExecutionRecord;
    };

export function groupTrajectoryItems(items: TrajectoryItem[]): TrajectoryGroup[] {
  const groups: TrajectoryGroup[] = [];
  let currentExploreItems: (TrajectoryTool | TrajectoryThought | TrajectoryText)[] = [];
  let currentExploreFiles = 0;

  const flushExplore = () => {
    if (currentExploreItems.length > 0) {
      const firstId = currentExploreItems[0].id;
      groups.push({
        type: 'explored_group',
        id: `exp_grp_${firstId}`,
        fileCount: currentExploreFiles,
        items: [...currentExploreItems],
      });
      currentExploreItems = [];
      currentExploreFiles = 0;
    }
  };

  const isExploreTool = (name: string) => {
    return name === 'read_file' || name === 'search_codebase' || name === 'list_directory';
  };

  const isEditTool = (name: string) => {
    return name === 'replace_file_content' || name === 'edit_file_content' || name === 'write_file';
  };

  const isCommandTool = (name: string) => {
    return name === 'run_terminal_command' || name === 'run_verification_test';
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (item.type === 'tool' && isExploreTool(item.tool.toolName)) {
      currentExploreItems.push(item);
      currentExploreFiles++;
    } else if (item.type === 'thought') {
      const nextItem = items[i + 1];
      const nextIsExplore = nextItem && nextItem.type === 'tool' && isExploreTool(nextItem.tool.toolName);

      if (currentExploreItems.length > 0 && nextIsExplore) {
        currentExploreItems.push(item);
      } else {
        flushExplore();
        groups.push({
          type: 'thought',
          id: item.id,
          thought: item,
        });
      }
    } else if (item.type === 'text') {
      flushExplore();
      groups.push({
        type: 'text',
        id: item.id,
        content: item.content,
      });
    } else {
      flushExplore();
      if (item.type === 'tool') {
        if (isEditTool(item.tool.toolName)) {
          groups.push({ type: 'edit', id: item.id, tool: item.tool });
        } else if (isCommandTool(item.tool.toolName)) {
          groups.push({ type: 'command', id: item.id, tool: item.tool });
        } else {
          groups.push({ type: 'other', id: item.id, tool: item.tool });
        }
      }
    }
  }

  flushExplore();
  return groups;
}

export const AntigravityTrajectoryFlow: React.FC<{ items: TrajectoryItem[] }> = ({ items }) => {
  if (!items || items.length === 0) return null;

  const groups = useMemo(() => groupTrajectoryItems(items), [items]);

  return (
    <div className="py-1 space-y-0.5 animate-in fade-in duration-100 font-sans">
      {groups.map((g) => {
        if (g.type === 'explored_group') {
          return (
            <AntigravityExploredGroup
              key={g.id}
              items={g.items}
              fileCount={g.fileCount}
            />
          );
        }
        if (g.type === 'edit') {
          return <AntigravityEditItem key={g.id} tool={g.tool} />;
        }
        if (g.type === 'command') {
          return <AntigravityCommandItem key={g.id} tool={g.tool} />;
        }
        if (g.type === 'thought') {
          return (
            <AntigravityThoughtItem
              key={g.id}
              content={g.thought.content}
              durationSec={g.thought.durationSec}
            />
          );
        }
        if (g.type === 'text') {
          return <AntigravityStepTextItem key={g.id} content={g.content} />;
        }
        return <AntigravityGenericItem key={g.id} tool={g.tool} />;
      })}
    </div>
  );
};

// Backwards compatibility wrapper for tools-only stream
export const AntigravityToolStream: React.FC<{ tools: ToolExecutionRecord[] }> = ({ tools }) => {
  const items: TrajectoryItem[] = useMemo(() => {
    return (tools || []).map((t) => ({ type: 'tool', id: t.id, tool: t }));
  }, [tools]);

  return <AntigravityTrajectoryFlow items={items} />;
};

// Default export / fallback for single ToolCard compatibility
export const ToolCard: React.FC<ToolCardProps> = ({ tool }) => {
  return <AntigravityToolStream tools={[tool]} />;
};
