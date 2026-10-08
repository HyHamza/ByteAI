import React, { useState } from 'react';
import { 
  Terminal, 
  FileText, 
  Edit3, 
  Folder, 
  Sparkles, 
  ChevronDown, 
  ChevronRight, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Copy,
  Check,
  GitMerge,
  Search,
  FileCode,
  FileEdit,
  GitPullRequest,
  MessageSquare
} from 'lucide-react';
import type { ToolExecutionRecord } from '@/shared/types';

interface ToolCardProps {
  tool: ToolExecutionRecord;
}

interface ToolDisplayConfig {
  title: string;
  detail: string;
  icon: React.ReactNode;
}

function getToolDisplayConfig(tool: ToolExecutionRecord): ToolDisplayConfig {
  const { toolName, args = {} } = tool;

  switch (toolName) {
    case 'read_file': {
      const lineRange = args.start_line 
        ? ` (L${args.start_line}${args.end_line ? `–L${args.end_line}` : ''})` 
        : '';
      return {
        title: lineRange ? 'Analyze file' : 'Read file',
        detail: args.path ? `${args.path}${lineRange}` : 'Reading file content',
        icon: <FileText className="w-3.5 h-3.5 text-blue-400" />,
      };
    }

    case 'search_codebase': {
      return {
        title: 'Search codebase',
        detail: args.query ? `"${args.query}"` : 'Searching project files',
        icon: <Search className="w-3.5 h-3.5 text-purple-400" />,
      };
    }

    case 'replace_file_content':
    case 'edit_file_content': {
      const lineRange = args.start_line 
        ? ` (L${args.start_line}${args.end_line ? `–L${args.end_line}` : ''})` 
        : '';
      return {
        title: 'Edit file',
        detail: args.path ? `${args.path}${lineRange}` : 'Updating file',
        icon: <FileEdit className="w-3.5 h-3.5 text-emerald-400" />,
      };
    }

    case 'write_file': {
      return {
        title: 'Create file',
        detail: args.path || 'Writing new file',
        icon: <FileCode className="w-3.5 h-3.5 text-emerald-400" />,
      };
    }

    case 'list_directory': {
      return {
        title: 'List directory',
        detail: args.path || '.',
        icon: <Folder className="w-3.5 h-3.5 text-purple-400" />,
      };
    }

    case 'run_terminal_command':
    case 'run_verification_test': {
      return {
        title: 'Run command',
        detail: args.command ? `$ ${args.command}` : 'Running terminal command',
        icon: <Terminal className="w-3.5 h-3.5 text-amber-400" />,
      };
    }

    case 'jules_get_status': {
      return {
        title: 'Check Jules status',
        detail: args.session_id ? `Task ${args.session_id}` : 'Checking task progress & activity',
        icon: <Sparkles className="w-3.5 h-3.5 text-sky-400" />,
      };
    }

    case 'jules_create_task': {
      return {
        title: 'Delegate to Jules',
        detail: args.title || (args.prompt ? args.prompt.slice(0, 50) + '...' : 'Creating autonomous task'),
        icon: <Sparkles className="w-3.5 h-3.5 text-sky-400" />,
      };
    }

    case 'jules_sync_and_merge': {
      return {
        title: 'Sync & merge PR',
        detail: args.session_id ? `Merging task ${args.session_id}` : 'Syncing remote pull request',
        icon: <GitMerge className="w-3.5 h-3.5 text-emerald-400" />,
      };
    }

    case 'jules_inspect_diff': {
      return {
        title: 'Inspect PR diff',
        detail: args.session_id ? `Task ${args.session_id}` : 'Reviewing pull request diff',
        icon: <GitPullRequest className="w-3.5 h-3.5 text-indigo-400" />,
      };
    }

    case 'jules_reply_question': {
      return {
        title: 'Reply to Jules',
        detail: args.answer ? `"${args.answer.slice(0, 50)}..."` : 'Answering task question',
        icon: <MessageSquare className="w-3.5 h-3.5 text-sky-400" />,
      };
    }

    default: {
      return {
        title: toolName.replace(/_/g, ' '),
        detail: args ? (args.command || args.path || JSON.stringify(args)) : '',
        icon: <Terminal className="w-3.5 h-3.5 text-gray-400" />,
      };
    }
  }
}

export const ToolCard: React.FC<ToolCardProps> = ({ tool }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedType, setCopiedType] = useState<string | null>(null);

  const display = getToolDisplayConfig(tool);

  const copyText = (e: React.MouseEvent, text: string, type: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  const getStatusIcon = () => {
    switch (tool.status) {
      case 'running':
        return (
          <div className="flex items-center space-x-1 px-1.5 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-700/50 text-[9.5px] font-medium text-cyan-300">
            <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />
            <span>Running</span>
          </div>
        );
      case 'completed':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
      case 'error':
        return <AlertCircle className="w-3.5 h-3.5 text-rose-400" />;
      default:
        return null;
    }
  };

  return (
    <div className="my-1.5 border border-[#24262c] rounded-xl bg-[#16171a] text-xs overflow-hidden transition-all shadow-xs hover:border-[#2f323a]">
      {/* Tool Header (Antigravity Style) */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[#1c1d22] transition-colors select-none"
      >
        <div className="flex items-center space-x-2.5 min-w-0 mr-2 flex-1">
          {display.icon}
          <span className="font-medium text-[#e3e5ec] text-[12px] whitespace-nowrap">
            {display.title}
          </span>
          {display.detail && (
            <span className="text-[#787c88] font-mono truncate max-w-[380px] text-[11px]">
              {display.detail}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          {getStatusIcon()}
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-[#6c707a]" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[#6c707a]" />
          )}
        </div>
      </div>

      {/* Expanded Details Drawer */}
      {isExpanded && (
        <div className="border-t border-[#22242a] bg-[#121316] p-3 font-mono text-[11px] overflow-x-auto space-y-3">
          {/* Arguments */}
          {tool.args && Object.keys(tool.args).length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1 select-none">
                <span className="text-[#787c87] font-semibold text-[11px]">Arguments:</span>
                <button
                  type="button"
                  onClick={(e) => copyText(e, JSON.stringify(tool.args, null, 2), 'args')}
                  className="flex items-center space-x-1 text-[10px] text-[#8e9196] hover:text-white px-2 py-0.5 rounded hover:bg-[#25272e] cursor-pointer transition-colors"
                >
                  {copiedType === 'args' ? (
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
              <pre className="text-[#93c5fd] whitespace-pre-wrap bg-[#17181c] p-2.5 rounded-lg border border-[#23252b] select-text cursor-text">
                {JSON.stringify(tool.args, null, 2)}
              </pre>
            </div>
          )}

          {/* Output */}
          {tool.output && (
            <div>
              <div className="flex items-center justify-between mb-1 select-none">
                <span className="text-[#787c87] font-semibold text-[11px]">Output:</span>
                <button
                  type="button"
                  onClick={(e) => copyText(e, tool.output!, 'output')}
                  className="flex items-center space-x-1 text-[10px] text-[#8e9196] hover:text-white px-2 py-0.5 rounded hover:bg-[#25272e] cursor-pointer transition-colors"
                >
                  {copiedType === 'output' ? (
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
              <pre className="text-[#c4c7cf] whitespace-pre-wrap bg-[#17181c] p-2.5 rounded-lg border border-[#23252b] select-text cursor-text max-h-[360px] overflow-y-auto">
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
