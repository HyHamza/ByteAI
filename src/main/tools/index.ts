import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import type { AppMode } from '../../shared/types';
import type { LLMToolDefinition } from '../services/llm/client';
import { JulesClient } from '../services/jules/client';
import { JulesPoller } from '../services/jules/poller';
import { DataStore } from '../services/db/store';
import { detectGitRepo } from '../services/git/detector';

// ─── Standard Tool Definitions (Antigravity Mode) ──────────────────────────────
export const STANDARD_TOOL_DEFS: LLMToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file at the given relative or absolute path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to read' },
          start_line: { type: 'number', description: 'Optional 1-indexed start line' },
          end_line: { type: 'number', description: 'Optional 1-indexed end line' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a new file or overwrite an existing file with the provided content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to write the file to' },
          content: { type: 'string', description: 'The entire file content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file_content',
      description: 'Replace an exact target snippet in a file with new replacement code.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path' },
          target_content: { type: 'string', description: 'Exact text segment to find and replace' },
          replacement_content: { type: 'string', description: 'The replacement text' },
        },
        required: ['path', 'target_content', 'replacement_content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_terminal_command',
      description: 'Execute a shell command in the current workspace directory and capture stdout and stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The terminal command line string to execute' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and directories in the given path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to list (defaults to workspace root)' },
        },
      },
    },
  },
];

// ─── Jules Supervisor Tool Definitions (Senior Lead Mode) ──────────────────────
export const JULES_TOOL_DEFS: LLMToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'jules_create_task',
      description: 'Formulate an architectural and technical specification and dispatch it to Jules AI.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed technical specification and instructions for Jules' },
          title: { type: 'string', description: 'Short descriptive task title' },
          repo: { type: 'string', description: 'GitHub source identifier (e.g. sources/github/Owner/Repo)' },
          branch: { type: 'string', description: 'Starting branch (default: main)' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'jules_reply_question',
      description: 'Respond to an architectural question or disambiguation query asked by Jules.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'The Jules session ID' },
          answer: { type: 'string', description: 'Your senior engineering decision or instructions' },
        },
        required: ['session_id', 'answer'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'jules_inspect_diff',
      description: 'Inspect the status and outputs of a Jules session.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'The Jules session ID' },
        },
        required: ['session_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_verification_test',
      description: 'Run project tests locally (e.g. npm test, flutter analyze) to verify changes.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Verification test command to run' },
        },
        required: ['command'],
      },
    },
  },
];

export async function executeToolCall(
  name: string,
  args: any,
  workspaceDir: string,
  sessionId?: string
): Promise<string> {
  const resolvePath = (p: string) => {
    return path.isAbsolute(p) ? p : path.join(workspaceDir, p);
  };

  try {
    switch (name) {
      // ── Standard Mode Tools
      case 'read_file': {
        const fullPath = resolvePath(args.path);
        if (!fs.existsSync(fullPath)) {
          return `Error: File not found: ${args.path}`;
        }
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');

        const start = args.start_line ? Math.max(1, args.start_line) - 1 : 0;
        const end = args.end_line ? Math.min(lines.length, args.end_line) : lines.length;

        return lines.slice(start, end).join('\n');
      }

      case 'write_file': {
        const fullPath = resolvePath(args.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, args.content, 'utf-8');
        return `Successfully wrote ${args.content.length} characters to ${args.path}`;
      }

      case 'edit_file_content': {
        const fullPath = resolvePath(args.path);
        if (!fs.existsSync(fullPath)) {
          return `Error: File not found: ${args.path}`;
        }
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (!content.includes(args.target_content)) {
          return `Error: target_content not found in ${args.path}. Ensure exact whitespace and content match.`;
        }
        const updated = content.replace(args.target_content, args.replacement_content);
        fs.writeFileSync(fullPath, updated, 'utf-8');
        return `Successfully replaced content in ${args.path}`;
      }

      case 'run_terminal_command':
      case 'run_verification_test': {
        return new Promise((resolve) => {
          exec(args.command, { cwd: workspaceDir, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            let output = stdout || '';
            if (stderr) output += `\n[STDERR]\n${stderr}`;
            if (err) output += `\n[EXIT CODE ${err.code || 1}]`;
            resolve(output.trim() || '(Command completed with no output)');
          });
        });
      }

      case 'list_directory': {
        const target = resolvePath(args.path || '.');
        if (!fs.existsSync(target)) return `Directory not found: ${args.path}`;
        const entries = fs.readdirSync(target, { withFileTypes: true });
        return entries
          .map((e) => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`)
          .join('\n');
      }

      // ── Jules Supervisor Tools
      case 'jules_create_task': {
        const client = JulesClient.getInstance();
        const gitInfo = detectGitRepo(workspaceDir);
        const repo = args.repo || gitInfo.repo;
        const branch = args.branch || gitInfo.branch || 'main';

        const res = await client.createSession({
          prompt: args.prompt,
          title: args.title,
          repo,
          branch,
        });

        // Automatically associate Jules Session ID with this Chat Session
        if (sessionId) {
          try {
            DataStore.getInstance().updateSession(sessionId, { julesSessionId: res.sessionId });
          } catch (_) {}
        }

        // Automatically track session in native background poller!
        JulesPoller.getInstance().trackSession(res.sessionId);

        return `Jules task created successfully with Session ID: ${res.sessionId} on ${repo || 'default repository'} (${branch}). Native background supervisor is now tracking execution.`;
      }

      case 'jules_reply_question': {
        const client = JulesClient.getInstance();
        await client.sendFollowup(args.session_id, args.answer);
        return `Reply sent to Jules session ${args.session_id}: "${args.answer}". Resuming tracking.`;
      }

      case 'jules_inspect_diff': {
        const client = JulesClient.getInstance();
        const session = await client.getSession(args.session_id);
        return JSON.stringify(session, null, 2);
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: any) {
    return `Error executing ${name}: ${err?.message || String(err)}`;
  }
}
