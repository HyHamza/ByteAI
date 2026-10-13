import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';

export interface CapturedConsoleMessage {
  level: 'log' | 'warn' | 'error';
  message: string;
  line: number;
  sourceId: string;
  timestamp: number;
}

export interface CapturedNetworkError {
  url: string;
  method: string;
  statusCode: number;
  statusLine: string;
  timestamp: number;
}

export class BrowserAutomationService {
  private static instance: BrowserAutomationService;
  private testWindow: BrowserWindow | null = null;
  private consoleLogs: CapturedConsoleMessage[] = [];
  private networkErrors: CapturedNetworkError[] = [];
  private loadFailures: Array<{ url: string; errorCode: number; errorDescription: string; timestamp: number }> = [];

  private constructor() {}

  public static getInstance(): BrowserAutomationService {
    if (!BrowserAutomationService.instance) {
      BrowserAutomationService.instance = new BrowserAutomationService();
    }
    return BrowserAutomationService.instance;
  }

  /**
   * Opens or navigates the automation test browser window
   */
  public async openUrl(url: string, options?: { headless?: boolean; width?: number; height?: number }): Promise<string> {
    const isHeadless = Boolean(options?.headless);
    const width = options?.width || 1280;
    const height = options?.height || 800;

    if (!this.testWindow || this.testWindow.isDestroyed()) {
      this.testWindow = new BrowserWindow({
        width,
        height,
        show: !isHeadless,
        title: 'Byte Test Browser',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
        },
      });

      this.testWindow.on('closed', () => {
        this.testWindow = null;
      });

      const contents = this.testWindow.webContents;

      // Intercept console messages
      contents.on('console-message', (_event, level, message, line, sourceId) => {
        const levelStr: 'log' | 'warn' | 'error' = level >= 2 ? 'error' : level === 1 ? 'warn' : 'log';
        this.consoleLogs.push({
          level: levelStr,
          message,
          line,
          sourceId,
          timestamp: Date.now(),
        });
      });

      // Intercept load failures
      contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        this.loadFailures.push({
          url: validatedURL,
          errorCode,
          errorDescription,
          timestamp: Date.now(),
        });
      });

      // Intercept network errors (HTTP 4xx/5xx)
      contents.session.webRequest.onCompleted((details) => {
        if (details.statusCode >= 400) {
          this.networkErrors.push({
            url: details.url,
            method: details.method,
            statusCode: details.statusCode,
            statusLine: details.statusLine || '',
            timestamp: Date.now(),
          });
        }
      });
    } else {
      if (!isHeadless && !this.testWindow.isVisible()) {
        this.testWindow.show();
      }
    }

    try {
      await this.testWindow.loadURL(url);
      return `Successfully opened ${url} in Byte Test Browser (Window ID: ${this.testWindow.id}). Monitoring console and network channels.`;
    } catch (err: any) {
      return `Failed to load URL ${url}: ${err.message}`;
    }
  }

  /**
   * Retrieves captured console logs, network errors, and runtime failures
   */
  public getLogs(options?: { filter?: 'all' | 'errors_only'; clear?: boolean }): {
    summary: string;
    errors: CapturedConsoleMessage[];
    networkErrors: CapturedNetworkError[];
    loadFailures: any[];
    totalErrors: number;
  } {
    const filter = options?.filter || 'errors_only';
    const clear = Boolean(options?.clear);

    const relevantLogs = filter === 'errors_only'
      ? this.consoleLogs.filter((l) => l.level === 'error')
      : this.consoleLogs;

    const totalErrors = relevantLogs.filter((l) => l.level === 'error').length +
      this.networkErrors.length +
      this.loadFailures.length;

    const result = {
      summary: `Captured ${totalErrors} issue(s) (${relevantLogs.filter((l) => l.level === 'error').length} console error(s), ${this.networkErrors.length} network failure(s), ${this.loadFailures.length} load error(s)).`,
      errors: [...relevantLogs],
      networkErrors: [...this.networkErrors],
      loadFailures: [...this.loadFailures],
      totalErrors,
    };

    if (clear) {
      this.consoleLogs = [];
      this.networkErrors = [];
      this.loadFailures = [];
    }

    return result;
  }

  /**
   * Interacts with DOM elements in the active browser window
   */
  public async interact(params: {
    action: 'click' | 'type' | 'wait_for_selector' | 'evaluate' | 'scroll';
    selector?: string;
    text?: string;
    script?: string;
    scroll_delta?: number;
  }): Promise<string> {
    if (!this.testWindow || this.testWindow.isDestroyed()) {
      throw new Error('No active test browser window. Call browser_open first.');
    }

    const contents = this.testWindow.webContents;
    const { action, selector, text, script, scroll_delta } = params;

    switch (action) {
      case 'click': {
        if (!selector) throw new Error('selector is required for click action');
        const code = `
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { success: false, error: "Element not found for selector: " + ${JSON.stringify(selector)} };
            el.scrollIntoView({ behavior: 'instant', block: 'center' });
            el.click();
            return { success: true, text: el.innerText || el.textContent || "" };
          })()
        `;
        const res = await contents.executeJavaScript(code);
        if (!res.success) throw new Error(res.error);
        return `Successfully clicked selector "${selector}" (Element text: "${res.text}").`;
      }

      case 'type': {
        if (!selector) throw new Error('selector is required for type action');
        if (text === undefined) throw new Error('text is required for type action');
        const code = `
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { success: false, error: "Element not found for selector: " + ${JSON.stringify(selector)} };
            el.scrollIntoView({ behavior: 'instant', block: 'center' });
            el.focus();
            if ('value' in el) {
              el.value = ${JSON.stringify(text)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              el.innerText = ${JSON.stringify(text)};
            }
            return { success: true };
          })()
        `;
        const res = await contents.executeJavaScript(code);
        if (!res.success) throw new Error(res.error);
        return `Successfully typed into selector "${selector}".`;
      }

      case 'wait_for_selector': {
        if (!selector) throw new Error('selector is required for wait_for_selector');
        const code = `
          new Promise((resolve, reject) => {
            const timeout = setTimeout(() => resolve({ success: false, error: "Timeout waiting for selector: " + ${JSON.stringify(selector)} }), 8000);
            const check = () => {
              if (document.querySelector(${JSON.stringify(selector)})) {
                clearTimeout(timeout);
                resolve({ success: true });
              } else {
                requestAnimationFrame(check);
              }
            };
            check();
          })
        `;
        const res = await contents.executeJavaScript(code);
        if (!res.success) throw new Error(res.error);
        return `Selector "${selector}" is now present in the page.`;
      }

      case 'evaluate': {
        if (!script) throw new Error('script is required for evaluate action');
        const res = await contents.executeJavaScript(`(() => { try { return { success: true, result: (${script}) }; } catch(e) { return { success: false, error: e.message }; } })()`);
        if (!res.success) throw new Error(`Script evaluation failed: ${res.error}`);
        return typeof res.result === 'object' ? JSON.stringify(res.result, null, 2) : String(res.result);
      }

      case 'scroll': {
        const delta = scroll_delta || 300;
        await contents.executeJavaScript(`window.scrollBy(0, ${delta})`);
        return `Scrolled page by ${delta}px.`;
      }

      default:
        throw new Error(`Unsupported browser action: ${action}`);
    }
  }

  /**
   * Captures a screenshot of the active browser window
   */
  public async takeScreenshot(includeBase64 = false): Promise<{ filePath: string; width: number; height: number; dataUrl?: string }> {
    if (!this.testWindow || this.testWindow.isDestroyed()) {
      throw new Error('No active test browser window. Call browser_open first.');
    }

    const image = await this.testWindow.webContents.capturePage();
    const size = image.getSize();
    const userDataDir = app?.getPath ? app.getPath('userData') : path.join(process.cwd(), '.data');
    const screenshotsDir = path.join(userDataDir, 'screenshots');
    fs.mkdirSync(screenshotsDir, { recursive: true });
    const targetFile = path.join(screenshotsDir, `browser_${Date.now()}.png`);
    const pngBuffer = image.toPNG();
    fs.writeFileSync(targetFile, pngBuffer);

    return {
      filePath: targetFile,
      width: size.width,
      height: size.height,
      dataUrl: includeBase64 ? `data:image/png;base64,${pngBuffer.toString('base64')}` : undefined,
    };
  }

  /**
   * Closes the test browser window
   */
  public close(): string {
    if (this.testWindow && !this.testWindow.isDestroyed()) {
      this.testWindow.close();
      this.testWindow = null;
      return 'Byte Test Browser closed.';
    }
    return 'No active browser window to close.';
  }
}
