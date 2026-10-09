import { spawn, ChildProcess, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app, BrowserWindow } from 'electron';

export interface SpeechChunkEvent {
  type: 'interim' | 'final' | 'error' | 'status';
  text: string;
  confidence?: number;
}

export class SpeechRecognizerService {
  private static instance: SpeechRecognizerService | null = null;
  private workerProcess: ChildProcess | null = null;
  private isListening: boolean = false;
  private mainWindowGetter: (() => BrowserWindow | null) | null = null;

  private constructor() {}

  public static getInstance(): SpeechRecognizerService {
    if (!SpeechRecognizerService.instance) {
      SpeechRecognizerService.instance = new SpeechRecognizerService();
    }
    return SpeechRecognizerService.instance;
  }

  public setMainWindowGetter(getter: () => BrowserWindow | null): void {
    this.mainWindowGetter = getter;
  }

  private getMainWindow(): BrowserWindow | null {
    return this.mainWindowGetter ? this.mainWindowGetter() : null;
  }

  private getWorkerBinaryPath(): string {
    const possiblePaths = [
      path.join(process.cwd(), 'resources', 'speech', 'SpeechWorker.exe'),
      path.join(app.getAppPath(), 'resources', 'speech', 'SpeechWorker.exe'),
      path.join(__dirname, '..', '..', '..', 'resources', 'speech', 'SpeechWorker.exe'),
      path.join(__dirname, '..', '..', 'resources', 'speech', 'SpeechWorker.exe'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    // Try auto-compile if source exists
    const srcPath = path.join(process.cwd(), 'resources', 'speech', 'SpeechWorker.cs');
    const outPath = path.join(process.cwd(), 'resources', 'speech', 'SpeechWorker.exe');
    const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
    const speechDll = 'C:\\Windows\\Microsoft.Net\\assembly\\GAC_MSIL\\System.Speech\\v4.0_4.0.0.0__31bf3856ad364e35\\System.Speech.dll';

    if (fs.existsSync(srcPath) && fs.existsSync(cscPath) && fs.existsSync(speechDll)) {
      try {
        execSync(`"${cscPath}" /nologo /target:exe /out:"${outPath}" /r:"${speechDll}" "${srcPath}"`, {
          windowsHide: true,
        });
        if (fs.existsSync(outPath)) {
          return outPath;
        }
      } catch (e) {
        console.error('[SpeechRecognizer] Auto-compile failed:', e);
      }
    }

    return possiblePaths[0];
  }

  public async start(lang: string = 'en-US'): Promise<{ success: boolean; error?: string }> {
    if (this.isListening && this.workerProcess) {
      return { success: true };
    }

    if (process.platform !== 'win32') {
      return { success: false, error: 'Native offline speech is currently optimized for Windows.' };
    }

    const binaryPath = this.getWorkerBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      return { success: false, error: `Speech worker binary not found at ${binaryPath}` };
    }

    try {
      this.isListening = true;
      const child = spawn(binaryPath, [lang], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.workerProcess = child;

      let buffer = '';
      child.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString('utf8');
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line.trim());
            this.handleWorkerMessage(parsed);
          } catch (_) {
            // Ignore non-json lines
          }
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        console.warn('[SpeechWorker stderr]:', data.toString());
      });

      child.on('error', (err: Error) => {
        console.error('[SpeechWorker error]:', err);
        this.emitToRenderer('speech:error', { error: err.message });
        this.stop();
      });

      child.on('close', (code: number | null) => {
        this.isListening = false;
        this.workerProcess = null;
        this.emitToRenderer('speech:status', { isListening: false, exitCode: code });
      });

      this.emitToRenderer('speech:status', { isListening: true });
      return { success: true };
    } catch (err: any) {
      this.isListening = false;
      this.workerProcess = null;
      return { success: false, error: err.message || 'Failed to spawn speech worker' };
    }
  }

  public async stop(): Promise<void> {
    if (!this.workerProcess) {
      this.isListening = false;
      this.emitToRenderer('speech:status', { isListening: false });
      return;
    }

    try {
      if (this.workerProcess.stdin && !this.workerProcess.stdin.destroyed) {
        this.workerProcess.stdin.write('stop\n');
      }

      setTimeout(() => {
        if (this.workerProcess) {
          try {
            this.workerProcess.kill('SIGTERM');
          } catch (_) {}
          this.workerProcess = null;
        }
        this.isListening = false;
        this.emitToRenderer('speech:status', { isListening: false });
      }, 300);
    } catch (_) {
      this.workerProcess = null;
      this.isListening = false;
      this.emitToRenderer('speech:status', { isListening: false });
    }
  }

  private handleWorkerMessage(msg: SpeechChunkEvent): void {
    if (msg.type === 'interim') {
      this.emitToRenderer('speech:interim', { text: msg.text });
    } else if (msg.type === 'final') {
      this.emitToRenderer('speech:final', { text: msg.text });
    } else if (msg.type === 'error') {
      this.emitToRenderer('speech:error', { error: msg.text });
    }
  }

  private emitToRenderer(channel: string, payload: any): void {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}
