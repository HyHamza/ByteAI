import https from 'https';
import http from 'http';
import { DataStore } from '../db/store';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface LLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface LLMStreamCallbacks {
  onToken: (token: string) => void;
  onToolCallDelta?: (toolCall: any) => void;
}

export class LLMClient {
  private static instance: LLMClient;

  public static getInstance(): LLMClient {
    if (!LLMClient.instance) {
      LLMClient.instance = new LLMClient();
    }
    return LLMClient.instance;
  }

  public async fetchAvailableModels(): Promise<string[]> {
    const settings = DataStore.getInstance().getSettings();
    const baseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/models`;

    try {
      const resp = await this.rawRequest<any>(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
        },
      });

      if (resp && Array.isArray(resp.data)) {
        return resp.data.map((m: any) => m.id || m.name);
      }
      return ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'gemini-2.5-pro', 'gemini-2.5-flash'];
    } catch (err) {
      console.warn('Could not auto-fetch models, returning defaults:', err);
      return ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'gemini-2.5-pro', 'gemini-2.5-flash'];
    }
  }

  public async chatStream(
    messages: LLMMessage[],
    tools: LLMToolDefinition[] | undefined,
    callbacks: LLMStreamCallbacks
  ): Promise<{ content: string; toolCalls: any[] }> {
    const settings = DataStore.getInstance().getSettings();
    const baseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/chat/completions`;

    // Smart Auto Router selection
    let modelToUse = settings.selectedModel;
    if (settings.isAutoModel) {
      modelToUse = 'gpt-4o'; // Default smart model for autonomous reasoning
    }

    const payload: any = {
      model: modelToUse,
      messages,
      stream: true,
      temperature: 0.2,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey || 'dummy-key'}`,
        },
      };

      let completeContent = '';
      const accumulatedToolCalls: Record<number, any> = {};

      const req = transport.request(reqOptions, (res) => {
        let buffer = '';

        if (res.statusCode && res.statusCode >= 400) {
          let errData = '';
          res.on('data', (d) => (errData += d));
          res.on('end', () => reject(new Error(`LLM API returned status ${res.statusCode}: ${errData}`)));
          return;
        }

        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (trimmed === 'data: [DONE]') continue;

            if (trimmed.startsWith('data: ')) {
              const jsonStr = trimmed.slice(6);
              try {
                const parsed = JSON.parse(jsonStr);
                const delta = parsed.choices?.[0]?.delta;
                if (!delta) continue;

                // Handle text streaming
                if (delta.content) {
                  completeContent += delta.content;
                  callbacks.onToken(delta.content);
                }

                // Handle tool calls streaming
                if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!accumulatedToolCalls[idx]) {
                      accumulatedToolCalls[idx] = {
                        id: tc.id || `call_${Date.now()}_${idx}`,
                        type: 'function',
                        function: {
                          name: tc.function?.name || '',
                          arguments: tc.function?.arguments || '',
                        },
                      };
                    } else {
                      if (tc.function?.name) {
                        accumulatedToolCalls[idx].function.name += tc.function.name;
                      }
                      if (tc.function?.arguments) {
                        accumulatedToolCalls[idx].function.arguments += tc.function.arguments;
                      }
                    }
                  }
                }
              } catch (_) {
                // Ignore incomplete SSE chunk parse errors
              }
            }
          }
        });

        res.on('end', () => {
          const finalToolCalls = Object.values(accumulatedToolCalls);
          resolve({
            content: completeContent,
            toolCalls: finalToolCalls,
          });
        });
      });

      req.on('error', (err) => reject(err));
      req.write(JSON.stringify(payload));
      req.end();
    });
  }

  private rawRequest<T>(url: string, options: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const req = transport.request(url, options, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : ({} as T));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${body}`));
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }
}
