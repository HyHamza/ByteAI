import React, { useState, useEffect } from 'react';
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
  Activity
} from 'lucide-react';
import type { ToolExecutionRecord } from '@/shared/types';

export interface ToolCardProps {
  tool: ToolExecutionRecord;
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
  const badge = getFileBadge(filePath);
  const { added, removed, isCreate } = getEditDiffStats(tool);

  return (
    <div className="font-sans text-[13px] leading-relaxed select-none group/edit">
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center space-x-2 py-0.5 cursor-pointer hover:opacity-90 transition-opacity"
      >
        <span className="text-[var(--text-secondary)] font-normal">
          {isCreate ? 'Created' : 'Edited'}
        </span>
        <span className={`${badge.colorClass} font-semibold text-[11px] tracking-wide`}>
          {badge.label}
        </span>
        <span className="font-medium text-[var(--text-primary)] hover:underline">
          {filename}
        </span>
        <span className="text-[#22c55e] font-mono text-[11.5px] font-medium">
          +{added}
        </span>
        <span className="text-[#ef4444] font-mono text-[11.5px] font-medium">
          -{removed}
        </span>

        {status === 'running' && (
          <Loader2 className="w-3 h-3 text-cyan-400 animate-spin ml-1" />
        )}
        {status === 'error' && (
          <AlertCircle className="w-3.5 h-3.5 text-rose-400 ml-1" />
        )}
      </div>

      {isExpanded && (
        <div className="mt-1 mb-2 pl-3 border-l border-[var(--border-subtle)] ml-1.5 space-y-2 font-mono text-[11px] animate-in fade-in duration-150">
          <div className="flex items-center justify-between text-[var(--text-muted)] text-[10px] pr-2 pt-1">
            <span>{filePath}</span>
            <button
              type="button"
              onClick={(e) => copy(e, JSON.stringify(tool.args, null, 2), 'args')}
              className="flex items-center space-x-1 hover:text-[var(--text-primary)] px-1.5 py-0.5 rounded hover:bg-[var(--bg-surface-hover)] transition-colors"
            >
              {copiedType === 'args' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedType === 'args' ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          {args.target_content && (
            <div className="bg-[var(--bg-surface-hover)] border border-rose-950/60 rounded p-2 text-rose-300 whitespace-pre-wrap select-text">
              <div className="text-[10px] text-rose-500 font-semibold mb-1 uppercase tracking-wider">- Original</div>
              {args.target_content}
            </div>
          )}

          {args.replacement_content !== undefined && (
            <div className="bg-[var(--bg-surface-hover)] border border-emerald-950/60 rounded p-2 text-emerald-300 whitespace-pre-wrap select-text">
              <div className="text-[10px] text-emerald-500 font-semibold mb-1 uppercase tracking-wider">+ Replacement</div>
              {args.replacement_content}
            </div>
          )}

          {args.content && !args.target_content && (
            <div className="bg-[var(--bg-surface-hover)] border border-emerald-950/60 rounded p-2 text-emerald-300 whitespace-pre-wrap select-text max-h-[300px] overflow-y-auto">
              <div className="text-[10px] text-emerald-500 font-semibold mb-1 uppercase tracking-wider">+ File Content</div>
              {args.content}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Antigravity Style Explored Group (Collapsed by Default) ─────────────────
export const AntigravityExploredGroup: React.FC<{ tools: ToolExecutionRecord[] }> = ({ tools }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const count = tools.length;
  const label = `Explored ${count} ${count === 1 ? 'file' : 'files'}`;

  return (
    <div className="font-sans text-[13px] leading-relaxed select-none">
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center space-x-1 py-0.5 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors group/explore w-fit"
      >
        <span>{label}</span>
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover/explore:text-[var(--text-primary)] transition-transform" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover/explore:text-[var(--text-primary)] transition-transform" />
        )}
        {tools.some(t => t.status === 'running') && (
          <Loader2 className="w-3 h-3 text-cyan-400 animate-spin ml-1" />
        )}
      </div>

      {isExpanded && (
        <div className="mt-1 mb-2 pl-3 border-l border-[var(--border-subtle)] ml-1.5 space-y-1 animate-in fade-in duration-150">
          {tools.map((t) => (
            <ExploredSubItem key={t.id} tool={t} />
          ))}
        </div>
      )}
    </div>
  );
};

const ExploredSubItem: React.FC<{ tool: ToolExecutionRecord }> = ({ tool }) => {
  const [showDetail, setShowDetail] = useState(false);
  const { copiedType, copy } = useCopy();
  const { toolName, args = {} } = tool;

  let title = '';
  let subdetail = '';
  let icon = <FileText className="w-3 h-3 text-blue-400 shrink-0" />;

  if (toolName === 'read_file') {
    title = args.path ? getBasename(args.path) : 'Read file';
    const range = args.start_line ? ` (L${args.start_line}${args.end_line ? `–L${args.end_line}` : ''})` : '';
    subdetail = (args.path ? `${args.path}${range}` : '');
    icon = <FileText className="w-3 h-3 text-blue-400 shrink-0" />;
  } else if (toolName === 'search_codebase') {
    title = args.query ? `Search "${args.query}"` : 'Search codebase';
    subdetail = args.file_pattern ? `Filter: ${args.file_pattern}` : '';
    icon = <Search className="w-3 h-3 text-purple-400 shrink-0" />;
  } else if (toolName === 'list_directory') {
    title = `List ${args.path || '.'}`;
    subdetail = args.path || '.';
    icon = <Folder className="w-3 h-3 text-amber-400 shrink-0" />;
  } else {
    title = toolName.replace(/_/g, ' ');
    subdetail = JSON.stringify(args);
  }

  return (
    <div className="text-xs">
      <div 
        onClick={() => setShowDetail(!showDetail)}
        className="flex items-center space-x-1.5 py-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
      >
        {icon}
        <span className="font-medium text-[var(--text-primary)]">{title}</span>
        {subdetail && title !== subdetail && (
          <span className="text-[var(--text-muted)] text-[11px] font-mono truncate max-w-[340px]">{subdetail}</span>
        )}
      </div>

      {showDetail && (
        <div className="bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] rounded p-2 my-1 text-[11px] font-mono space-y-1.5">
          <div className="flex items-center justify-between text-[#787c88]">
            <span>Output:</span>
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
          <pre className="text-[#93c5fd] whitespace-pre-wrap max-h-[220px] overflow-y-auto select-text">
            {tool.output || '(No output)'}
          </pre>
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
    <div className="font-sans text-[13px] leading-relaxed select-none">
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center space-x-2 py-0.5 cursor-pointer hover:opacity-90 transition-opacity"
      >
        <span className="text-[var(--text-secondary)] font-normal">
          {taskId ? 'Ran background task' : (args.is_background ? 'Ran background task' : 'Ran command')}
        </span>
        <Terminal className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="font-mono text-[var(--text-primary)] text-[12px] truncate max-w-[420px]">
          $ {cmd}
        </span>

        {/* Live Running Spinner */}
        {(status === 'running' || isLiveRunning) && (
          <div className="flex items-center space-x-1 text-cyan-400 text-xs font-medium ml-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-[11px]">Running...</span>
          </div>
        )}

        {/* Completed status indicators */}
        {!isLiveRunning && taskExitCode !== null && (
          <span className={`text-[10.5px] font-mono px-1 py-0.2 rounded ${
            taskExitCode === 0 ? 'text-emerald-400 bg-emerald-950/40' : 'text-rose-400 bg-rose-950/40'
          }`}>
            Exit {taskExitCode}
          </span>
        )}

        {status === 'error' && !isLiveRunning && taskExitCode === null && (
          <AlertCircle className="w-3.5 h-3.5 text-rose-400 ml-1" />
        )}

        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] ml-1" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] ml-1" />
        )}
      </div>

      {isExpanded && (
        <div className="mt-1 mb-2 pl-3 border-l border-[var(--border-subtle)] ml-1.5 font-mono text-[11px] animate-in fade-in duration-150">
          <div className="flex items-center justify-between text-[var(--text-muted)] text-[10px] mb-1">
            <div className="flex items-center space-x-2">
              <span>Terminal Output:</span>
              {taskId && (
                <span className={`px-1.5 py-0.2 rounded text-[9.5px] uppercase font-semibold ${
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
                  <AlertCircle className="w-3 h-3 text-rose-400" />
                  <span>{isKilling ? 'Killing...' : 'Kill Task'}</span>
                </button>
              )}
              {displayOutput && (
                <button
                  type="button"
                  onClick={(e) => copy(e, displayOutput, 'cmdOut')}
                  className="flex items-center space-x-1 hover:text-[var(--text-primary)] px-1.5 py-0.5 rounded hover:bg-[var(--bg-surface-hover)] transition-colors"
                >
                  {copiedType === 'cmdOut' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
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
  let icon = <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;

  if (toolName === 'resolve_merge_conflict') {
    title = `Resolved conflict ${args.path ? getBasename(args.path) : ''}`;
    icon = <GitMerge className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  } else if (toolName.startsWith('jules_')) {
    if (toolName === 'jules_create_task') title = `Delegated task to Jules`;
    else if (toolName === 'jules_sync_and_merge') title = `Synced Jules task`;
    else if (toolName === 'jules_get_status') title = `Checked Jules status`;
    else if (toolName === 'jules_reply_question') title = `Replied to Jules`;
    else if (toolName === 'jules_inspect_diff') title = `Inspected PR diff`;
    icon = <Sparkles className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
  } else if (toolName === 'manage_task') {
    title = `${args.action ? args.action.charAt(0).toUpperCase() + args.action.slice(1) : 'Manage'} task ${args.task_id || ''}`;
    icon = <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
  }

  return (
    <div className="font-sans text-[13px] leading-relaxed select-none">
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center space-x-2 py-0.5 cursor-pointer hover:opacity-90 transition-opacity"
      >
        {icon}
        <span className="font-medium text-[var(--text-primary)]">{title}</span>
        {status === 'running' && (
          <Loader2 className="w-3 h-3 text-cyan-400 animate-spin ml-1" />
        )}
        {status === 'error' && (
          <AlertCircle className="w-3.5 h-3.5 text-rose-400 ml-1" />
        )}
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] ml-1" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] ml-1" />
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

// ── Antigravity Unified Tool Stream ─────────────────────────────────────────
// Groups consecutive exploration tools (read_file, search_codebase, list_directory) into "Explored N files >"
// and renders edits as "Edited TS <filename> +<added> -<removed>"
export const AntigravityToolStream: React.FC<{ tools: ToolExecutionRecord[] }> = ({ tools }) => {
  if (!tools || tools.length === 0) return null;

  type StreamGroup = 
    | { type: 'explore'; tools: ToolExecutionRecord[] }
    | { type: 'edit'; tool: ToolExecutionRecord }
    | { type: 'command'; tool: ToolExecutionRecord }
    | { type: 'other'; tool: ToolExecutionRecord };

  const groups: StreamGroup[] = [];
  let currentExploreGroup: ToolExecutionRecord[] = [];

  const flushExplore = () => {
    if (currentExploreGroup.length > 0) {
      groups.push({ type: 'explore', tools: [...currentExploreGroup] });
      currentExploreGroup = [];
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

  for (const t of tools) {
    if (isExploreTool(t.toolName)) {
      currentExploreGroup.push(t);
    } else {
      flushExplore();
      if (isEditTool(t.toolName)) {
        groups.push({ type: 'edit', tool: t });
      } else if (isCommandTool(t.toolName)) {
        groups.push({ type: 'command', tool: t });
      } else {
        groups.push({ type: 'other', tool: t });
      }
    }
  }
  flushExplore();

  return (
    <div className="py-1 space-y-0.5 animate-in fade-in duration-100">
      {groups.map((g, idx) => {
        if (g.type === 'explore') {
          return <AntigravityExploredGroup key={`exp_${idx}_${g.tools[0].id}`} tools={g.tools} />;
        }
        if (g.type === 'edit') {
          return <AntigravityEditItem key={g.tool.id} tool={g.tool} />;
        }
        if (g.type === 'command') {
          return <AntigravityCommandItem key={g.tool.id} tool={g.tool} />;
        }
        return <AntigravityGenericItem key={g.tool.id} tool={g.tool} />;
      })}
    </div>
  );
};

// Default export / fallback for single ToolCard compatibility
export const ToolCard: React.FC<ToolCardProps> = ({ tool }) => {
  return <AntigravityToolStream tools={[tool]} />;
};
