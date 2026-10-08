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
  Check
} from 'lucide-react';
import type { ToolExecutionRecord } from '@/shared/types';

interface ToolCardProps {
  tool: ToolExecutionRecord;
}

export const ToolCard: React.FC<ToolCardProps> = ({ tool }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedType, setCopiedType] = useState<string | null>(null);

  const copyText = (e: React.MouseEvent, text: string, type: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  const getToolIcon = () => {
    switch (tool.toolName) {
      case 'run_terminal_command':
      case 'run_verification_test':
        return <Terminal className="w-3.5 h-3.5 text-[#fbbf24]" />;
      case 'read_file':
        return <FileText className="w-3.5 h-3.5 text-[#60a5fa]" />;
      case 'write_file':
      case 'edit_file_content':
        return <Edit3 className="w-3.5 h-3.5 text-[#34d399]" />;
      case 'list_directory':
        return <Folder className="w-3.5 h-3.5 text-[#c084fc]" />;
      case 'jules_create_task':
      case 'jules_reply_question':
      case 'jules_inspect_diff':
        return <Sparkles className="w-3.5 h-3.5 text-[#38bdf8]" />;
      default:
        return <Terminal className="w-3.5 h-3.5 text-[#9ca3af]" />;
    }
  };

  const getStatusIcon = () => {
    switch (tool.status) {
      case 'running':
        return <Loader2 className="w-3.5 h-3.5 text-[#38bdf8] animate-spin" />;
      case 'completed':
        return <CheckCircle2 className="w-3.5 h-3.5 text-[#34d399]" />;
      case 'error':
        return <AlertCircle className="w-3.5 h-3.5 text-[#f87171]" />;
      default:
        return null;
    }
  };

  return (
    <div className="my-1.5 border border-[#272930] rounded-xl bg-[#18191d] text-xs overflow-hidden transition-all shadow-sm">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[#202227] transition-colors select-none"
      >
        <div className="flex items-center space-x-2.5 min-w-0 mr-2">
          {getToolIcon()}
          <span className="font-mono font-medium text-[#e3e3e3]">{tool.toolName}</span>
          {tool.args && Object.keys(tool.args).length > 0 && (
            <span className="text-[#787c87] font-mono truncate max-w-[340px] text-[11px]">
              {tool.args.command || tool.args.path || tool.args.prompt || JSON.stringify(tool.args)}
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

      {isExpanded && (
        <div className="border-t border-[#25272e] bg-[#121316] p-3 font-mono text-[11px] overflow-x-auto space-y-3">
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
                      <span>Copy Args</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="text-[#34d399] whitespace-pre-wrap bg-[#18191d] p-2.5 rounded-lg border border-[#24262c] select-text cursor-text">
                {JSON.stringify(tool.args, null, 2)}
              </pre>
            </div>
          )}

          {tool.output && (
            <div>
              <div className="flex items-center justify-between mb-1 select-none">
                <span className="text-[#787c87] font-semibold text-[11px]">Output:</span>
                <button
                  type="button"
                  onClick={(e) => copyText(e, tool.output || '', 'output')}
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
                      <span>Copy Output</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="text-[#d1d5db] whitespace-pre-wrap max-h-72 overflow-y-auto bg-[#18191d] p-2.5 rounded-lg border border-[#24262c] select-text cursor-text">
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
