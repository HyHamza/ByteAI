import { app, desktopCapturer, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';

export interface DesktopScreenshotResult {
  filePath: string;
  width: number;
  height: number;
  scaleFactor: number;
  dataUrl?: string;
  error?: string;
}

export interface DesktopWindowInfo {
  handle: string;
  pid: number;
  process: string;
  title: string;
}

export class DesktopAutomationService {
  private static instance: DesktopAutomationService;
  private helperPath: string;
  private isEmergencyStopped = false;

  private constructor() {
    // In dev: E:\CODE\ByteAI\resources\bin\ByteInputHelper.exe
    // In packaged app: process.resourcesPath/bin/ByteInputHelper.exe or resources/bin
    const isDev = app ? !app.isPackaged : true;
    const appPath = app?.getAppPath ? app.getAppPath() : process.cwd();
    const resourcesDir = (process as any).resourcesPath || path.join(appPath, 'resources');

    if (isDev) {
      this.helperPath = path.join(appPath, 'resources', 'bin', 'ByteInputHelper.exe');
    } else {
      this.helperPath = path.join(resourcesDir, 'bin', 'ByteInputHelper.exe');
      if (!fs.existsSync(this.helperPath)) {
        this.helperPath = path.join(appPath, 'resources', 'bin', 'ByteInputHelper.exe');
      }
    }
  }

  public static getInstance(): DesktopAutomationService {
    if (!DesktopAutomationService.instance) {
      DesktopAutomationService.instance = new DesktopAutomationService();
    }
    return DesktopAutomationService.instance;
  }

  public triggerEmergencyStop() {
    this.isEmergencyStopped = true;
    console.warn('[DesktopAutomation] EMERGENCY STOP TRIGGERED. All automation halted.');
  }

  public resetEmergencyStop() {
    this.isEmergencyStopped = false;
  }

  public isStopped(): boolean {
    return this.isEmergencyStopped;
  }

  private ensureNotStopped() {
    if (this.isEmergencyStopped) {
      throw new Error('Automation was cancelled by emergency kill-switch.');
    }
  }

  private runHelper(args: string[]): Promise<string> {
    this.ensureNotStopped();
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(this.helperPath)) {
        // Fallback: check workspace resources
        const fallback = path.join(process.cwd(), 'resources', 'bin', 'ByteInputHelper.exe');
        if (fs.existsSync(fallback)) {
          this.helperPath = fallback;
        } else {
          return reject(new Error(`ByteInputHelper.exe not found at ${this.helperPath}`));
        }
      }

      execFile(this.helperPath, args, { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          const errOutput = stderr?.trim() || stdout?.trim() || error.message;
          return reject(new Error(`Input helper error: ${errOutput}`));
        }
        resolve(stdout.trim());
      });
    });
  }

  /**
   * Captures the full primary desktop or specific display
   */
  public async takeScreenshot(includeBase64 = false): Promise<DesktopScreenshotResult> {
    this.ensureNotStopped();
    const primaryDisplay = screen?.getPrimaryDisplay
      ? screen.getPrimaryDisplay()
      : { size: { width: 1920, height: 1080 }, scaleFactor: 1 };
    const { width, height } = primaryDisplay.size;
    const scaleFactor = primaryDisplay.scaleFactor;

    const userDataDir = app?.getPath ? app.getPath('userData') : path.join(process.cwd(), '.data');
    const screenshotsDir = path.join(userDataDir, 'screenshots');
    fs.mkdirSync(screenshotsDir, { recursive: true });
    const filename = `screen_${Date.now()}.png`;
    const targetFile = path.join(screenshotsDir, filename);

    try {
      // Use Electron's native desktopCapturer API
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(width * scaleFactor),
          height: Math.round(height * scaleFactor),
        },
      });

      if (!sources || sources.length === 0) {
        throw new Error('No screen sources found by desktopCapturer.');
      }

      const primarySource = sources[0];
      const pngBuffer = primarySource.thumbnail.toPNG();
      fs.writeFileSync(targetFile, pngBuffer);

      let dataUrl: string | undefined;
      if (includeBase64) {
        dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
      }

      return {
        filePath: targetFile,
        width,
        height,
        scaleFactor,
        dataUrl,
      };
    } catch (err: any) {
      console.error('[DesktopAutomation] desktopCapturer screenshot error:', err);
      return {
        filePath: '',
        width,
        height,
        scaleFactor,
        error: err.message || 'Failed to capture screenshot',
      };
    }
  }

  /**
   * Executes a mouse action
   */
  public async mouseAction(params: {
    action: 'click' | 'double_click' | 'right_click' | 'move' | 'drag' | 'scroll';
    x?: number;
    y?: number;
    to_x?: number;
    to_y?: number;
    button?: 'left' | 'right' | 'middle' | 'double';
    scroll_delta?: number;
  }): Promise<string> {
    this.ensureNotStopped();
    const { action, x, y, to_x, to_y, button, scroll_delta } = params;

    switch (action) {
      case 'move': {
        if (x === undefined || y === undefined) {
          throw new Error('x and y coordinates required for mouse move');
        }
        return await this.runHelper(['mouse-move', Math.round(x).toString(), Math.round(y).toString()]);
      }
      case 'click': {
        if (x !== undefined && y !== undefined) {
          await this.runHelper(['mouse-move', Math.round(x).toString(), Math.round(y).toString()]);
        }
        const btn = button || 'left';
        return await this.runHelper(['mouse-click', btn]);
      }
      case 'double_click': {
        if (x !== undefined && y !== undefined) {
          await this.runHelper(['mouse-move', Math.round(x).toString(), Math.round(y).toString()]);
        }
        return await this.runHelper(['mouse-click', 'double']);
      }
      case 'right_click': {
        if (x !== undefined && y !== undefined) {
          await this.runHelper(['mouse-move', Math.round(x).toString(), Math.round(y).toString()]);
        }
        return await this.runHelper(['mouse-click', 'right']);
      }
      case 'drag': {
        if (x === undefined || y === undefined || to_x === undefined || to_y === undefined) {
          throw new Error('x, y, to_x, and to_y are all required for mouse drag');
        }
        return await this.runHelper([
          'mouse-drag',
          Math.round(x).toString(),
          Math.round(y).toString(),
          Math.round(to_x).toString(),
          Math.round(to_y).toString(),
        ]);
      }
      case 'scroll': {
        const delta = scroll_delta || -120;
        return await this.runHelper(['mouse-scroll', delta.toString()]);
      }
      default:
        throw new Error(`Unsupported mouse action: ${action}`);
    }
  }

  /**
   * Executes keyboard typing, key press, or hotkey
   */
  public async keyboardAction(params: {
    action: 'type' | 'key_press' | 'hotkey';
    text?: string;
    key?: string;
    keys?: string[];
  }): Promise<string> {
    this.ensureNotStopped();
    const { action, text, key, keys } = params;

    switch (action) {
      case 'type': {
        if (!text) throw new Error('text is required for typing action');
        return await this.runHelper(['type', text]);
      }
      case 'key_press': {
        if (!key) throw new Error('key is required for key_press action');
        return await this.runHelper(['key-press', key]);
      }
      case 'hotkey': {
        if (!keys || keys.length === 0) throw new Error('keys array is required for hotkey action');
        return await this.runHelper(['hotkey', ...keys]);
      }
      default:
        throw new Error(`Unsupported keyboard action: ${action}`);
    }
  }

  /**
   * Lists visible top-level windows
   */
  public async listWindows(): Promise<DesktopWindowInfo[]> {
    this.ensureNotStopped();
    const raw = await this.runHelper(['list-windows']);
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Focuses a window matching query pattern
   */
  public async focusWindow(query: string): Promise<string> {
    this.ensureNotStopped();
    return await this.runHelper(['focus-window', query]);
  }
}
