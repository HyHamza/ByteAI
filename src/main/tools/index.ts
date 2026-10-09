import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import type { AppMode } from '../../shared/types';
import type { LLMToolDefinition } from '../services/llm/client';
import { JulesClient } from '../services/jules/client';
import { JulesPoller } from '../services/jules/poller';
import { DataStore } from '../services/db/store';
import { detectGitRepo } from '../services/git/detector';
import { syncAndMergeJulesSession } from '../services/git/merger';

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
      name: 'replace_file_content',
      description: 'Replace content in a file. You can either specify target_content to match and replace, or specify start_line and end_line with replacement_content to replace specific lines.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path' },
          target_content: { type: 'string', description: 'Exact text segment to find and replace' },
          replacement_content: { type: 'string', description: 'The replacement text' },
          start_line: { type: 'number', description: 'Optional 1-indexed start line to replace' },
          end_line: { type: 'number', description: 'Optional 1-indexed end line to replace' },
        },
        required: ['path', 'replacement_content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_codebase',
      description: 'Search for a string or regex pattern across all files in the local codebase, returning matching file paths, line numbers, and contents.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The text snippet or pattern to search for' },
          file_pattern: { type: 'string', description: 'Optional filename filter (e.g. *.ts or src/)' },
          max_results: { type: 'number', description: 'Maximum number of results to return (default: 30)' },
        },
        required: ['query'],
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
  {
    type: 'function',
    function: {
      name: 'resolve_merge_conflict',
      description: 'Resolve a git merge conflict in a file by checking out ours/theirs or applying custom resolved content, staging the file, and optionally completing the merge commit and push.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the conflicted file' },
          strategy: {
            type: 'string',
            enum: ['ours', 'theirs', 'custom_content'],
            description: 'Conflict resolution strategy: "ours" (keep current branch HEAD), "theirs" (take incoming branch changes), or "custom_content" (write specified resolved content)',
          },
          custom_content: {
            type: 'string',
            description: 'The complete resolved content of the file without conflict markers (required if strategy is custom_content)',
          },
          complete_merge: {
            type: 'boolean',
            description: 'If true, stages the file with git add, and if no other conflicts exist, completes the merge with git commit and pushes to remote (default: true)',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'jules_get_status',
      description: 'Check the current progress, state, branch, and recent activities of an active or completed Jules AI task.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'Optional Jules session ID. If not specified, checks the active task for the current session.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'jules_sync_and_merge',
      description: 'Pull and merge code changes from a completed Jules AI task/PR into the local git repository and push to remote origin so both are synchronized.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'The Jules session ID to sync and merge' },
        },
        required: ['session_id'],
      },
    },
  },
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
      description: 'Inspect the pull request diff, outputs, or code changes of a COMPLETED Jules task.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'The Jules session ID' },
        },
        required: ['session_id'],
      },
    },
  },
];

// In SeniorEngineer, both modes have access to all engineering tools so Byte never lacks capabilities
export const JULES_TOOL_DEFS: LLMToolDefinition[] = STANDARD_TOOL_DEFS;

function searchCodebase(
  workspaceDir: string,
  query: string,
  patternStr?: string,
  maxResults: number = 30
): string {
  const results: Array<{ file: string; line: number; content: string }> = [];
  const fileRegex = patternStr ? new RegExp(patternStr.replace(/\*/g, '.*')) : null;

  function traverse(dir: string) {
    if (results.length >= maxResults) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const e of entries) {
      if (results.length >= maxResults) break;
      const name = e.name;
      if (
        name === 'node_modules' ||
        name === '.git' ||
        name === 'dist' ||
        name === 'build' ||
        name === '.seniorengineer' ||
        name === '.next' ||
        name === '.turbo'
      ) {
        continue;
      }

      const full = path.join(dir, name);
      if (e.isDirectory()) {
        traverse(full);
      } else if (e.isFile()) {
        if (fileRegex && !fileRegex.test(name)) continue;
        const ext = path.extname(name).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.exe', '.dll', '.woff', '.woff2', '.ttf'].includes(ext)) {
          continue;
        }
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const lines = content.split('\n');
          const lowerQ = query.toLowerCase();
          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) break;
            if (lines[i].toLowerCase().includes(lowerQ)) {
              results.push({
                file: path.relative(workspaceDir, full),
                line: i + 1,
                content: lines[i].trim(),
              });
            }
          }
        } catch (_) {}
      }
    }
  }

  traverse(workspaceDir);

  if (results.length === 0) {
    return `No matches found for "${query}" across the codebase.`;
  }
  return results.map((r) => `${r.file}:${r.line}: ${r.content}`).join('\n');
}

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
        const sliced = lines.slice(start, end);

        return sliced.map((line, idx) => `${start + idx + 1}: ${line}`).join('\n');
      }

      case 'search_codebase': {
        return searchCodebase(workspaceDir, args.query, args.file_pattern, args.max_results || 30);
      }

      case 'write_file': {
        const fullPath = resolvePath(args.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, args.content, 'utf-8');
        return `Successfully wrote ${args.content.length} characters to ${args.path}`;
      }

      case 'replace_file_content':
      case 'edit_file_content': {
        const fullPath = resolvePath(args.path);
        if (!fs.existsSync(fullPath)) {
          return `Error: File not found: ${args.path}`;
        }
        const content = fs.readFileSync(fullPath, 'utf-8');

        // Mode 1: By line numbers
        if (args.start_line && args.end_line !== undefined && args.replacement_content !== undefined) {
          const lines = content.split('\n');
          const startIdx = Math.max(1, args.start_line) - 1;
          const endIdx = Math.min(lines.length, args.end_line);
          const replacementLines = args.replacement_content.split('\n');
          lines.splice(startIdx, endIdx - startIdx, ...replacementLines);
          fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8');
          return `Successfully replaced lines ${args.start_line}-${args.end_line} in ${args.path}`;
        }

        // Mode 2: By exact target content
        const target = args.target_content;
        const replacement = args.replacement_content !== undefined ? args.replacement_content : (args.new_content || '');
        if (!target || !content.includes(target)) {
          return `Error: target_content not found in ${args.path}. Ensure exact whitespace and content match.`;
        }
        const updated = content.replace(target, replacement);
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

      case 'resolve_merge_conflict': {
        const fullPath = resolvePath(args.path);
        if (!fs.existsSync(fullPath)) {
          return `Error: File not found: ${args.path}`;
        }

        const runGit = (cmd: string): Promise<{ stdout: string; stderr: string; code: number }> => {
          return new Promise((resolve) => {
            exec(cmd, { cwd: workspaceDir, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
              const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
              resolve({ stdout: stdout?.trim() || '', stderr: stderr?.trim() || '', code });
            });
          });
        };

        let strategyApplied = '';
        if (args.strategy === 'ours') {
          const res = await runGit(`git checkout --ours -- "${args.path}"`);
          if (res.code !== 0) return `Failed to checkout ours for ${args.path}: ${res.stderr || res.stdout}`;
          strategyApplied = 'Checked out "ours" (HEAD version).';
        } else if (args.strategy === 'theirs') {
          const res = await runGit(`git checkout --theirs -- "${args.path}"`);
          if (res.code !== 0) return `Failed to checkout theirs for ${args.path}: ${res.stderr || res.stdout}`;
          strategyApplied = 'Checked out "theirs" (incoming branch version).';
        } else if (args.strategy === 'custom_content' || args.custom_content) {
          if (!args.custom_content) return `Error: custom_content is required when using custom_content strategy.`;
          fs.writeFileSync(fullPath, args.custom_content, 'utf-8');
          strategyApplied = 'Applied custom resolved content.';
        } else {
          // If no explicit strategy, check if file still contains merge conflict markers
          const currentContent = fs.readFileSync(fullPath, 'utf-8');
          if (currentContent.includes('<<<<<<<') && currentContent.includes('>>>>>>>')) {
            return `File ${args.path} still contains merge conflict markers (<<<<<<< / >>>>>>>). Please specify a strategy ('ours', 'theirs', or 'custom_content' with resolved content) or edit the file with 'replace_file_content' first.`;
          }
          strategyApplied = 'Verified file has no conflict markers.';
        }

        // Stage the resolved file
        const addRes = await runGit(`git add "${args.path}"`);
        if (addRes.code !== 0) {
          return `Error staging ${args.path}: ${addRes.stderr || addRes.stdout}`;
        }

        let output = `Conflict resolved for ${args.path}: ${strategyApplied}\nStaged with git add.`;

        // Check if merge should be completed
        if (args.complete_merge !== false) {
          const statusRes = await runGit(`git status --porcelain`);
          const hasRemainingConflicts = statusRes.stdout
            .split('\n')
            .some((line) => /^(UU|AA|UD|DU|DD)/.test(line.trim()));

          if (hasRemainingConflicts) {
            output += `\nNote: Other conflicted files remain in the repository. Resolve them before committing.`;
          } else {
            const commitRes = await runGit(`git commit -m "Resolve merge conflict in ${args.path}"`);
            if (commitRes.code === 0) {
              output += `\nMerge commit created successfully: ${commitRes.stdout.split('\n')[0]}`;
              const pushRes = await runGit(`git push`);
              if (pushRes.code === 0) {
                output += `\nSuccessfully pushed to remote origin.`;
              } else {
                output += `\nGit push output: ${pushRes.stderr || pushRes.stdout}`;
              }
            } else {
              output += `\nGit commit note: ${commitRes.stderr || commitRes.stdout}`;
            }
          }
        }

        return output;
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

        return `Jules task created successfully with Session ID: ${res.sessionId} on ${repo || 'default repository'} (${branch}). The autonomous background supervisor daemon is now tracking execution in the background and will wake you up automatically when Jules reports back. Conclude your turn immediately and do not call any more tools.`;
      }

      case 'jules_reply_question': {
        const client = JulesClient.getInstance();
        await client.sendFollowup(args.session_id, args.answer);
        return `Reply sent to Jules session ${args.session_id}: "${args.answer}". Resuming tracking.`;
      }

      case 'jules_inspect_diff': {
        const client = JulesClient.getInstance();
        const session = await client.getSession(args.session_id);
        const isRunning = 
          session.state === 'IN_PROGRESS' || 
          session.state === 'PLANNING' || 
          session.state === 'CODING' || 
          session.state === 'INITIALIZING';
        if (isRunning) {
          return `Session ${args.session_id} is currently running asynchronously in Google Cloud (${session.state}). The background supervisor will wake you up automatically when Jules replies or finishes. Do not poll.`;
        }
        return JSON.stringify(session, null, 2);
      }

      case 'jules_sync_and_merge': {
        const result = await syncAndMergeJulesSession(args.session_id, workspaceDir);
        return result.message;
      }

      case 'jules_get_status': {
        const client = JulesClient.getInstance();
        let targetId = args.session_id;
        if (!targetId && sessionId) {
          const chatSession = DataStore.getInstance().getSession(sessionId);
          targetId = chatSession?.julesSessionId;
        }
        if (!targetId) {
          const sessions = await client.listSessions();
          if (sessions.length > 0) targetId = sessions[0].id;
        }
        if (!targetId) {
          return 'No active or recent Jules task found.';
        }

        const session = await client.getSession(targetId);
        const activities = await client.listActivities(targetId).catch(() => []);
        const recent = activities.slice(-5).map(a => `- [${new Date(a.timestamp).toLocaleTimeString()}] ${a.description}`).join('\n');

        let prInfo = '';
        if (Array.isArray(session.outputs)) {
          for (const o of session.outputs) {
            if (o.pullRequest?.url) {
              prInfo = `\nPull Request: ${o.pullRequest.url}`;
              break;
            }
          }
        }

        return `Jules Task: "${session.title || targetId}" (ID: ${targetId})
Current Status: ${session.state}
Repository: ${session.sourceContext?.source || ''} (${session.sourceContext?.githubRepoContext?.startingBranch || 'main'})${prInfo}

Recent Activity:
${recent || '(No activity recorded yet)'}`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: any) {
    return `Error executing ${name}: ${err?.message || String(err)}`;
  }
}
