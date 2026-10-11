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
import { TaskManager } from '../services/task/manager';
import { DutyManager } from '../services/duty/manager';

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
      description: 'Execute a shell command in the workspace directory. If the command takes longer than wait_ms_before_async (or is_background is true), it is automatically sent to the background as a task. When the background task completes, the system automatically wakes you up with the results.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The terminal command line string to execute' },
          wait_ms_before_async: {
            type: 'number',
            description: 'Milliseconds to wait before sending command to background (default: 5000, max: 15000). Set to 0 to send to background immediately.',
          },
          is_daemon: {
            type: 'boolean',
            description: 'Set to true for long-running support processes that keep running indefinitely and should not wake you up (e.g. dev servers, file watchers). Defaults to false.',
          },
          is_background: {
            type: 'boolean',
            description: 'Set to true to immediately execute this command in the background as an asynchronous task.',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_task',
      description: 'Manage background tasks. Use this tool to list running tasks, check status and logs, kill a task, or send input to a running task.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'status', 'kill', 'send_input'],
            description: "The action to perform: 'list' (list all background tasks), 'status' (check task status and recent output), 'kill' (terminate task process), or 'send_input' (send stdin to running task).",
          },
          task_id: {
            type: 'string',
            description: "The task ID to manage. Required for 'status', 'kill', and 'send_input'.",
          },
          input: {
            type: 'string',
            description: "The input string to send to the running task's stdin. Required when action is 'send_input'.",
          },
        },
        required: ['action'],
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
      name: 'jules_continue_session',
      description: 'Continue working in the SAME existing Jules session (STRONGLY RECOMMENDED 90% OF THE TIME). Dispatches subsequent phases, follow-up instructions, edge-case fixes, or testing into the existing Jules session without creating a new session. Preserves the cloud container environment, git branch, and all previously committed changes. Merge all commits together later when leaving this session.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Next phase instructions, follow-up technical specification, or revisions for Jules' },
          session_id: { type: 'string', description: 'Optional Jules session ID. If omitted, automatically continues in the active Jules session for this chat.' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'jules_finalize_and_merge',
      description: 'Finalize work from a Jules session and pull/merge ALL commits and patches accumulated across its phases into the local workspace and push to remote origin. Use this tool when you are leaving a Jules session (e.g. all work from that session is complete, or before switching to a new session).',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'Optional Jules session ID to finalize and merge. Defaults to current active session.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'jules_create_task',
      description: 'Create a BRAND NEW Jules AI cloud session. IMPORTANT: 90% of the time, you MUST use "jules_continue_session" to continue in the existing Jules session instead of creating a new one! Only use "jules_create_task" when starting a completely new project, when no prior session exists, or when the user explicitly requests a fresh session. Note: If an existing session is present, all commits from that previous session are automatically finalized and merged before the new session is created.',
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
  {
    type: 'function',
    function: {
      name: 'jules_start_duty_shift',
      description: 'Activate an autonomous continuous Duty Shift (e.g. 2h, 4h, 8h, all-night, 10h) in Jules Lead Mode. Byte will continuously supervise Jules, chain phases, and merge code without stopping until duty hours expire.',
      parameters: {
        type: 'object',
        properties: {
          hours: { type: 'number', description: 'Total duration in hours (e.g. 2, 4, 8, 10). Defaults to 8.' },
          mission_prompt: { type: 'string', description: 'The overarching mission or long-running objective to accomplish during the shift' },
        },
        required: ['mission_prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'jules_stop_duty_shift',
      description: 'Stop or end the active long-running Duty Shift.',
      parameters: {
        type: 'object',
        properties: {
          shift_id: { type: 'string', description: 'Optional ID of the duty shift to stop' },
        },
      },
    },
  },
];

// In SeniorEngineer, both modes have access to all engineering tools so Byte never lacks capabilities
export const JULES_TOOL_DEFS: LLMToolDefinition[] = STANDARD_TOOL_DEFS;

async function searchCodebase(
  workspaceDir: string,
  query: string,
  patternStr?: string,
  maxResults: number = 30
): Promise<string> {
  const results: Array<{ file: string; line: number; content: string }> = [];
  const fileRegex = patternStr ? new RegExp(patternStr.replace(/\*/g, '.*')) : null;
  const lowerQ = query.toLowerCase();

  const IGNORE_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.seniorengineer',
    '.next',
    '.turbo',
    '.dart_tool',
    '.gradle',
    'android',
    'ios',
    'pods',
    '.idea',
    '.vscode',
    '.gemini',
    'coverage',
    'vendor',
    '.cache',
    'bin',
    'obj',
    'out',
    '.output',
  ]);

  const BINARY_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.exe', '.dll',
    '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.tar', '.gz', '.7z',
    '.lock', '.bin', '.so', '.dylib', '.apk', '.aab', '.ipa'
  ]);

  let filesScanned = 0;

  async function traverse(dir: string): Promise<void> {
    if (results.length >= maxResults) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const e of entries) {
      if (results.length >= maxResults) break;
      const name = e.name;
      const lowerName = name.toLowerCase();

      if (IGNORE_DIRS.has(lowerName) || lowerName.startsWith('.')) {
        continue;
      }

      const full = path.join(dir, name);
      if (e.isDirectory()) {
        await traverse(full);
      } else if (e.isFile()) {
        if (fileRegex && !fileRegex.test(name)) continue;
        const ext = path.extname(name).toLowerCase();
        if (BINARY_EXTS.has(ext)) continue;

        filesScanned++;
        // Yield to the event loop every 20 files to keep the Electron UI completely smooth
        if (filesScanned % 20 === 0) {
          await new Promise((r) => setImmediate(r));
        }

        try {
          const stat = await fs.promises.stat(full);
          if (stat.size > 500000) continue; // Skip files > 500KB to avoid freezing on huge bundles

          const content = await fs.promises.readFile(full, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) break;
            if (lines[i].toLowerCase().includes(lowerQ)) {
              const trimmedLine = lines[i].trim();
              const cappedLine = trimmedLine.length > 250 ? trimmedLine.slice(0, 250) + '...' : trimmedLine;
              results.push({
                file: path.relative(workspaceDir, full).replace(/\\/g, '/'),
                line: i + 1,
                content: cappedLine,
              });
            }
          }
        } catch (_) {}
      }
    }
  }

  await traverse(workspaceDir);

  if (results.length === 0) {
    return `No matches found for "${query}" across the codebase.`;
  }

  const output = results.map((r) => `${r.file}:${r.line}: ${r.content}`).join('\n');
  return output.length > 25000 ? output.slice(0, 25000) + '\n... [Results truncated to 25KB for performance]' : output;
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
        const ext = path.extname(fullPath).toLowerCase();
        const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.ico'].includes(ext);
        const stat = await fs.promises.stat(fullPath);

        if (isImage) {
          return `[Image File: ${path.basename(fullPath)}] Format: ${ext.replace('.', '').toUpperCase()}, Size: ${Math.round(stat.size / 1024)} KB. This is a binary image file provided directly to the model's visual comprehension.`;
        }

        if (stat.size > 2 * 1024 * 1024) {
          return `Error: File ${args.path} is too large (${Math.round(stat.size / 1024)} KB). Use start_line and end_line to inspect specific ranges.`;
        }
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');

        const start = args.start_line ? Math.max(1, args.start_line) - 1 : 0;
        const end = args.end_line ? Math.min(lines.length, args.end_line) : lines.length;
        const sliced = lines.slice(start, end);

        const resText = sliced.map((line, idx) => `${start + idx + 1}: ${line}`).join('\n');
        return resText.length > 50000 ? resText.slice(0, 50000) + '\n... [Content truncated to 50KB]' : resText;
      }

      case 'search_codebase': {
        return await searchCodebase(workspaceDir, args.query, args.file_pattern, args.max_results || 30);
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
        const cmd = args.command || args.command_line || '';
        const waitMs = args.wait_ms_before_async !== undefined
          ? args.wait_ms_before_async
          : (args.wait_ms !== undefined ? args.wait_ms : 5000);
        const isDaemon = Boolean(args.is_daemon || args.isDaemon);
        const isBackground = Boolean(args.is_background || args.isBackground);

        const res = await TaskManager.getInstance().startCommand({
          command: cmd,
          cwd: workspaceDir,
          sessionId: sessionId || 'default',
          isDaemon,
          isBackground,
          waitMsBeforeAsync: waitMs,
        });

        return res.output;
      }

      case 'manage_task': {
        const action = args.action;
        const taskMgr = TaskManager.getInstance();

        switch (action) {
          case 'list': {
            const list = taskMgr.listTasks(sessionId);
            if (list.length === 0) return 'No background tasks currently recorded.';
            return JSON.stringify(list, null, 2);
          }
          case 'status': {
            if (!args.task_id) return 'Error: task_id is required for action "status".';
            return taskMgr.getTaskStatus(args.task_id);
          }
          case 'kill': {
            if (!args.task_id) return 'Error: task_id is required for action "kill".';
            return taskMgr.killTask(args.task_id);
          }
          case 'send_input': {
            if (!args.task_id) return 'Error: task_id is required for action "send_input".';
            if (args.input === undefined) return 'Error: input is required for action "send_input".';
            return taskMgr.sendInput(args.task_id, args.input);
          }
          default:
            return `Unknown action: "${action}". Supported actions: 'list', 'status', 'kill', 'send_input'.`;
        }
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
      case 'jules_continue_session': {
        const client = JulesClient.getInstance();
        const store = DataStore.getInstance();
        let targetJulesId = args.session_id;

        if (!targetJulesId && sessionId) {
          const chatSession = store.getSession(sessionId);
          targetJulesId = chatSession?.julesSessionId;
        }

        if (!targetJulesId) {
          const allSessions = store.getSessions();
          const recent = allSessions.find((s) => !!s.julesSessionId);
          targetJulesId = recent?.julesSessionId;
        }

        if (!targetJulesId) {
          return `Error: No active or prior Jules session found to continue. 90% of the time you should continue in an existing session, but since none exists yet, please use 'jules_create_task' to start the initial session.`;
        }

        // Check if session is already completed or closed in Google Cloud
        let sessionData: any = null;
        try {
          sessionData = await client.getSession(targetJulesId);
        } catch (_) {}

        if (sessionData && (sessionData.state === 'COMPLETED' || sessionData.state === 'CANCELLED' || sessionData.state === 'FAILED')) {
          // Jules session is already completed and cannot accept messages.
          // Seamlessly start the next phase via createSession on the same repo and branch!
          const branch = sessionData.sourceContext?.githubRepoContext?.startingBranch || 'main';
          const repo = sessionData.sourceContext?.source;
          const res = await client.createSession({
            prompt: args.prompt,
            title: `Phase in ${targetJulesId.slice(0, 8)}: ${args.prompt.slice(0, 40)}`,
            repo,
            branch,
          });
          targetJulesId = res.sessionId;
          if (sessionId) {
            try {
              store.updateSession(sessionId, { julesSessionId: targetJulesId });
              DutyManager.getInstance().recordTaskDispatched(sessionId, targetJulesId);
            } catch (_) {}
          }
          JulesPoller.getInstance().trackSession(targetJulesId);
          return `Previous Jules session was completed in Google Cloud. Automatically created next phase task ${targetJulesId} on ${repo || 'repo'} (${branch}). Jules is executing. Conclude turn immediately.`;
        }

        try {
          await client.sendFollowup(targetJulesId, args.prompt);
        } catch (err: any) {
          // If 404 or entity not found, Google Cloud session is closed or expired. Auto-create next phase!
          if (err.message && (err.message.includes('404') || err.message.includes('NOT_FOUND') || err.message.includes('not found'))) {
            const gitInfo = detectGitRepo(workspaceDir);
            const res = await client.createSession({
              prompt: args.prompt,
              title: `Follow-up: ${args.prompt.slice(0, 40)}`,
              repo: gitInfo.repo,
              branch: gitInfo.branch,
            });
            targetJulesId = res.sessionId;
            if (sessionId) {
              try {
                store.updateSession(sessionId, { julesSessionId: targetJulesId });
                DutyManager.getInstance().recordTaskDispatched(sessionId, targetJulesId);
              } catch (_) {}
            }
            JulesPoller.getInstance().trackSession(targetJulesId);
            return `Previous Jules session could not accept follow-up messages (${err.message}). Automatically started new phase task ${targetJulesId}. Jules is executing. Conclude turn immediately.`;
          }
          throw err;
        }

        // Ensure this chat session references this target Jules session
        if (sessionId) {
          try {
            store.updateSession(sessionId, { julesSessionId: targetJulesId });
            DutyManager.getInstance().recordTaskDispatched(sessionId, targetJulesId);
          } catch (_) {}
        }

        // Track in background poller (clears handledCompletions so the new turn will be supervised)
        JulesPoller.getInstance().trackSession(targetJulesId);

        return `Instruction sent to continue in Jules session ${targetJulesId}. Jules is executing the work within the same cloud VM and branch. All commits will accumulate in this session and will be merged together when leaving it. Conclude your turn immediately.`;
      }

      case 'jules_create_task': {
        const client = JulesClient.getInstance();
        const store = DataStore.getInstance();
        const gitInfo = detectGitRepo(workspaceDir);
        const repo = args.repo || gitInfo.repo;
        const branch = args.branch || gitInfo.branch || 'main';

        // Auto-finalize and merge all commits from previous session before leaving it!
        let prevMergeNote = '';
        if (sessionId) {
          const currentChat = store.getSession(sessionId);
          if (currentChat?.julesSessionId) {
            console.log(`[merger] Leaving previous Jules session ${currentChat.julesSessionId}. Merging all commits before starting new session...`);
            try {
              const mergeRes = await syncAndMergeJulesSession(currentChat.julesSessionId, workspaceDir);
              if (mergeRes.success) {
                prevMergeNote = ` (Auto-merged all commits from previous session ${currentChat.julesSessionId})`;
              }
            } catch (err: any) {
              console.warn(`[merger] Auto-merge on session exit:`, err.message || err);
            }
          }
        }

        const res = await client.createSession({
          prompt: args.prompt,
          title: args.title,
          repo,
          branch,
        });

        // Automatically associate Jules Session ID with this Chat Session
        if (sessionId) {
          try {
            store.updateSession(sessionId, { julesSessionId: res.sessionId });
            DutyManager.getInstance().recordTaskDispatched(sessionId, res.sessionId);
          } catch (_) {}
        }

        // Automatically track session in native background poller!
        JulesPoller.getInstance().trackSession(res.sessionId);

        return `Jules task created successfully with Session ID: ${res.sessionId} on ${repo || 'default repository'} (${branch})${prevMergeNote}. The autonomous background supervisor daemon is tracking execution in the background and will wake you up automatically when Jules reports back. Conclude your turn immediately.`;
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

      case 'jules_finalize_and_merge':
      case 'jules_sync_and_merge': {
        const store = DataStore.getInstance();
        let targetId = args.session_id;
        if (!targetId && sessionId) {
          const currentChat = store.getSession(sessionId);
          targetId = currentChat?.julesSessionId;
        }
        if (!targetId) {
          const allSessions = store.getSessions();
          const recent = allSessions.find((s) => !!s.julesSessionId);
          targetId = recent?.julesSessionId;
        }
        if (!targetId) {
          return `Error: No Jules session specified or found in active chat to finalize and merge.`;
        }
        const result = await syncAndMergeJulesSession(targetId, workspaceDir);
        if (!result.success) {
          return `CRITICAL_ERROR: ${result.message}\nENFORCEMENT NOTICE: Zero code changes were merged or committed locally. You are strictly forbidden from reporting to the user that changes are merged, completed, or that tests passed. Report this merge failure honestly.`;
        }
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

      case 'jules_start_duty_shift': {
        const dutyManager = DutyManager.getInstance();
        const hours = args.hours || 8;
        const shift = dutyManager.startShift(sessionId || 'default', args.mission_prompt, hours);
        return `Duty Shift activated successfully (ID: ${shift.id}) for ${hours} hours! Byte is now on continuous duty. Concurrently formulate Phase 1 and dispatch it via 'jules_create_task'.`;
      }

      case 'jules_stop_duty_shift': {
        const dutyManager = DutyManager.getInstance();
        const active = dutyManager.getActiveShift(sessionId);
        if (!active) return 'No active duty shift found to stop.';
        dutyManager.stopShift(active.id);
        return `Duty Shift ${active.id} stopped successfully.`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: any) {
    return `Error executing ${name}: ${err?.message || String(err)}`;
  }
}
