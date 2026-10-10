import { spawn, execSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { BrowserWindow, Notification } from 'electron';

export interface BackgroundTask {
  taskId: string;
  sessionId: string;
  command: string;
  cwd: string;
  isDaemon: boolean;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed' | 'killed';
  exitCode: number | null;
  logPath: string;
  stdout: string;
  stderr: string;
  process?: ChildProcess;
}

export interface StartCommandOptions {
  command: string;
  cwd: string;
  sessionId?: string;
  isDaemon?: boolean;
  waitMsBeforeAsync?: number;
  isBackground?: boolean;
}

export interface StartCommandResult {
  isBackground: boolean;
  taskId?: string;
  logPath?: string;
  output: string;
}

const TASKS_DIR = path.join(os.homedir(), '.seniorengineer', 'tasks');

export class TaskManager {
  private static instance: TaskManager;
  private tasks: Map<string, BackgroundTask> = new Map();
  private onTaskCompletedHandler?: (task: BackgroundTask, notificationPrompt: string) => void;

  private constructor() {
    this.ensureDir();
  }

  public static getInstance(): TaskManager {
    if (!TaskManager.instance) {
      TaskManager.instance = new TaskManager();
    }
    return TaskManager.instance;
  }

  private ensureDir() {
    if (!fs.existsSync(TASKS_DIR)) {
      try {
        fs.mkdirSync(TASKS_DIR, { recursive: true });
      } catch (_) {}
    }
  }

  public setTaskCompletedHandler(handler: (task: BackgroundTask, notificationPrompt: string) => void) {
    this.onTaskCompletedHandler = handler;
  }

  public async startCommand(options: StartCommandOptions): Promise<StartCommandResult> {
    this.ensureDir();

    const {
      command,
      cwd,
      sessionId = 'default',
      isDaemon = false,
      isBackground = false,
    } = options;

    const waitMs = isBackground ? 0 : (options.waitMsBeforeAsync !== undefined ? options.waitMsBeforeAsync : 5000);
    const taskId = `task-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const logPath = path.join(TASKS_DIR, `${taskId}.log`);

    // Initialize log file
    fs.writeFileSync(logPath, `[Task Started] ${new Date().toISOString()}\nCommand: ${command}\nDirectory: ${cwd}\nDaemon: ${isDaemon}\n${'='.repeat(60)}\n\n`, 'utf-8');

    const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
    const child = spawn(command, [], {
      cwd,
      shell,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PAGER: 'cat' },
    });

    const task: BackgroundTask = {
      taskId,
      sessionId,
      command,
      cwd,
      isDaemon,
      startTime: Date.now(),
      status: 'running',
      exitCode: null,
      logPath,
      stdout: '',
      stderr: '',
      process: child,
    };

    this.tasks.set(taskId, task);

    const logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf-8' });
    const appendLog = (chunk: string) => {
      try {
        logStream.write(chunk);
      } catch (_) {}
    };

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      task.stdout += text;
      // Cap in-memory buffer to last 100KB to prevent memory leaks
      if (task.stdout.length > 100000) {
        task.stdout = task.stdout.slice(-100000);
      }
      appendLog(text);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      task.stderr += text;
      if (task.stderr.length > 100000) {
        task.stderr = task.stderr.slice(-100000);
      }
      appendLog(text);
    });

    let hasResolvedSync = false;

    // Process completion handler
    const processExitPromise = new Promise<{ code: number | null }>((resolve) => {
      child.on('close', (code) => {
        task.endTime = Date.now();
        task.exitCode = code;
        task.status = (code === 0) ? 'completed' : 'failed';
        task.process = undefined;

        appendLog(`\n${'='.repeat(60)}\n[Task Finished] ${new Date().toISOString()} Exit Code: ${code}\n`);
        try { logStream.end(); } catch (_) {}

        if (hasResolvedSync) {
          // This task was running asynchronously in the background. Trigger reactive wakeup!
          this.handleBackgroundTaskExit(task);
        }

        resolve({ code });
      });

      child.on('error', (err) => {
        task.endTime = Date.now();
        task.status = 'failed';
        task.stderr += `\nProcess error: ${err.message}`;
        task.process = undefined;
        appendLog(`\n[Process Error] ${err.message}\n`);

        if (hasResolvedSync) {
          this.handleBackgroundTaskExit(task);
        }

        resolve({ code: 1 });
      });
    });

    // If waitMs is 0 or negative, immediately send to background
    if (waitMs <= 0) {
      hasResolvedSync = true;
      const normalizedLogPath = logPath.replace(/\\/g, '/');
      return {
        isBackground: true,
        taskId,
        logPath,
        output: `Tool is running as a background task with task id: ${taskId}\nTask logs are available at: file:///${normalizedLogPath}\nYOU MUST TAKE ONE OF THE FOLLOWING TWO ACTIONS: A) either proceed to other relevant work (if any) or, B) simply update the user with a short message (that you have launched the command and will wait for it to finish) and end the turn.\nDO NOTHING ELSE.`,
      };
    }

    // Wait up to waitMs before detaching to background
    const timeoutPromise = new Promise<{ isTimeout: true }>((resolve) => {
      setTimeout(() => resolve({ isTimeout: true }), waitMs);
    });

    const raceResult = await Promise.race([processExitPromise, timeoutPromise]);

    if ('isTimeout' in raceResult && raceResult.isTimeout) {
      // Command exceeded waitMs -> send to background
      hasResolvedSync = true;
      const normalizedLogPath = logPath.replace(/\\/g, '/');
      return {
        isBackground: true,
        taskId,
        logPath,
        output: `Tool is running as a background task with task id: ${taskId}\nTask logs are available at: file:///${normalizedLogPath}\nYOU MUST TAKE ONE OF THE FOLLOWING TWO ACTIONS: A) either proceed to other relevant work (if any) or, B) simply update the user with a short message (that you have launched the command and will wait for it to finish) and end the turn.\nDO NOTHING ELSE.`,
      };
    }

    // Command completed synchronously within waitMs
    hasResolvedSync = true;
    let combinedOutput = task.stdout || '';
    if (task.stderr) {
      combinedOutput += (combinedOutput ? '\n[STDERR]\n' : '') + task.stderr;
    }
    if (task.exitCode !== 0) {
      combinedOutput += `\n[EXIT CODE ${task.exitCode || 1}]`;
    }

    return {
      isBackground: false,
      output: combinedOutput.trim() || '(Command completed with no output)',
    };
  }

  private handleBackgroundTaskExit(task: BackgroundTask) {
    if (task.isDaemon) {
      // Daemon background processes (dev servers, file watchers) are not meant to wake up the agent when they terminate
      return;
    }

    const normalizedLogPath = task.logPath.replace(/\\/g, '/');
    let outputSnippet = task.stdout.trim();
    if (task.stderr) {
      outputSnippet += (outputSnippet ? '\n[STDERR]\n' : '') + task.stderr.trim();
    }
    // Limit snippet in notification prompt to last 4000 chars
    if (outputSnippet.length > 4000) {
      outputSnippet = '... [truncated earlier output] ...\n' + outputSnippet.slice(-3500);
    }
    if (!outputSnippet) {
      outputSnippet = '(Command exited with code ' + task.exitCode + ')';
    }

    const notificationPrompt = `<SYSTEM_MESSAGE>
[Message] timestamp=${new Date().toISOString()} sender=${task.taskId} priority=MESSAGE_PRIORITY_HIGH content=Task id "${task.taskId}" finished with result:

The command exited with code ${task.exitCode ?? 0}.
Output:
${outputSnippet}

Log: file:///${normalizedLogPath}
</SYSTEM_MESSAGE>`;

    // Trigger desktop OS notification if available
    if (Notification.isSupported()) {
      try {
        const notif = new Notification({
          title: `Task Completed: ${task.taskId}`,
          body: `Command: ${task.command.slice(0, 60)}\nExit code: ${task.exitCode ?? 0}`,
          silent: false,
        });
        notif.show();
      } catch (_) {}
    }

    // Wake up agent
    if (this.onTaskCompletedHandler) {
      this.onTaskCompletedHandler(task, notificationPrompt);
    }
  }

  public listTasks(sessionId?: string): Array<Omit<BackgroundTask, 'process'>> {
    const results: Array<Omit<BackgroundTask, 'process'>> = [];
    for (const t of this.tasks.values()) {
      if (!sessionId || t.sessionId === sessionId) {
        const { process: _, ...taskData } = t;
        results.push(taskData);
      }
    }
    return results.sort((a, b) => b.startTime - a.startTime);
  }

  public getTaskLogs(taskId: string): { status: string; exitCode: number | null; output: string; logPath: string; isRunning: boolean } {
    const task = this.tasks.get(taskId);
    if (!task) {
      const logPath = path.join(TASKS_DIR, `${taskId}.log`);
      if (fs.existsSync(logPath)) {
        try {
          const content = fs.readFileSync(logPath, 'utf-8');
          return { status: 'completed', exitCode: 0, output: content, logPath, isRunning: false };
        } catch (_) {}
      }
      return { status: 'not_found', exitCode: null, output: `Task "${taskId}" not found.`, logPath: '', isRunning: false };
    }

    let output = '';
    if (fs.existsSync(task.logPath)) {
      try {
        output = fs.readFileSync(task.logPath, 'utf-8');
      } catch (_) {
        output = task.stdout + (task.stderr ? `\n[STDERR]\n${task.stderr}` : '');
      }
    } else {
      output = task.stdout + (task.stderr ? `\n[STDERR]\n${task.stderr}` : '');
    }

    return {
      status: task.status,
      exitCode: task.exitCode,
      output: output.trim(),
      logPath: task.logPath,
      isRunning: task.status === 'running',
    };
  }

  public getTaskStatus(taskId: string): string {
    const task = this.tasks.get(taskId);
    if (!task) {
      return `Error: Task with ID "${taskId}" not found.`;
    }

    const uptime = Math.round(((task.endTime || Date.now()) - task.startTime) / 1000);
    let recentOutput = task.stdout.slice(-1500);
    if (task.stderr) {
      recentOutput += '\n[STDERR]\n' + task.stderr.slice(-1000);
    }

    return `Task ID: ${task.taskId}
Command: ${task.command}
Directory: ${task.cwd}
Status: ${task.status.toUpperCase()}
Uptime: ${uptime}s
Exit Code: ${task.exitCode !== null ? task.exitCode : 'running'}
Log File: ${task.logPath}

Recent Output:
${recentOutput.trim() || '(No output yet)'}`;
  }

  public killTask(taskId: string): string {
    const task = this.tasks.get(taskId);
    if (!task) {
      return `Error: Task with ID "${taskId}" not found.`;
    }

    if (task.status !== 'running' || !task.process) {
      return `Task "${taskId}" is already ${task.status}.`;
    }

    const pid = task.process.pid;
    try {
      if (process.platform === 'win32' && pid) {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
      } else if (pid) {
        process.kill(-pid, 'SIGKILL');
      }
    } catch (_) {
      try {
        task.process.kill('SIGKILL');
      } catch (_) {}
    }

    task.status = 'killed';
    task.endTime = Date.now();
    task.process = undefined;
    return `Successfully killed task "${taskId}" (PID ${pid}).`;
  }

  public sendInput(taskId: string, input: string): string {
    const task = this.tasks.get(taskId);
    if (!task) {
      return `Error: Task with ID "${taskId}" not found.`;
    }

    if (task.status !== 'running' || !task.process || !task.process.stdin) {
      return `Error: Task "${taskId}" is not running or stdin is unavailable.`;
    }

    try {
      task.process.stdin.write(input + '\n');
      return `Sent input to task "${taskId}".`;
    } catch (err: any) {
      return `Error sending input to task "${taskId}": ${err.message}`;
    }
  }
}
