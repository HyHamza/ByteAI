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
  AlertCircle 
} from 'lucide-react';
import type { ToolExecutionRecord } from '@/shared/types';

interface ToolCardProps {
  tool: ToolExecutionRecord;
}

export const ToolCard: React.FC<ToolCardProps> = ({ tool }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getToolIcon = () => {
    switch (tool.toolName) {
      case 'run_terminal_command':
      case 'run_verification_test':
        return <Terminal className="w-3.5 h-3.5 text-yellow-400" />;
      case 'read_file':
        return <FileText className="w-3.5 h-3.5 text-blue-400" />;
      case 'write_file':
      case 'edit_file_content':
        return <Edit3 className="w-3.5 h-3.5 text-emerald-400" />;
      case 'list_directory':
        return <Folder className="w-3.5 h-3.5 text-purple-400" />;
      case 'jules_create_task':
      case 'jules_reply_question':
      case 'jules_inspect_diff':
        return <Sparkles className="w-3.5 h-3.5 text-sky-400" />;
      default:
        return <Terminal className="w-3.5 h-3.5 text-gray-400" />;
    }
  };

  const getStatusIcon = () => {
    switch (tool.status) {
      case 'running':
        return <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
      case 'error':
        return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
      default:
        return null;
    }
  };

  return (
    <div className="my-2 border border-[#30363d] rounded-md bg-[#161b22] text-xs overflow-hidden">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[#21262d] transition-colors select-none"
      >
        <div className="flex items-center space-x-2">
          {getToolIcon()}
          <span className="font-mono font-medium text-[#c9d1d9]">{tool.toolName}</span>
          {tool.args && Object.keys(tool.args).length > 0 && (
            <span className="text-[#8b949e] font-mono truncate max-w-[320px]">
              {tool.args.command || tool.args.path || tool.args.prompt || JSON.stringify(tool.args)}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          {getStatusIcon()}
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-[#8b949e]" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[#8b949e]" />
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-[#30363d] bg-[#0d1117] p-2.5 font-mono text-[11px] overflow-x-auto">
          {tool.args && Object.keys(tool.args).length > 0 && (
            <div className="mb-2">
              <div className="text-[#8b949e] font-semibold mb-1">Arguments:</div>
              <pre className="text-emerald-400 whitespace-pre-wrap">
                {JSON.stringify(tool.args, null, 2)}
              </pre>
            </div>
          )}

          {tool.output && (
            <div>
              <div className="text-[#8b949e] font-semibold mb-1">Output:</div>
              <pre className="text-[#c9d1d9] whitespace-pre-wrap max-h-60 overflow-y-auto">
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
