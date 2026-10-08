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
  onRetry?: (attempt: number, maxRetries: number, delayMs: number, reason: string) => void;
}

export class LLMClient {
  private static instance: LLMClient;

  public static getInstance(): LLMClient {
    if (!LLMClient.instance) {
      LLMClient.instance = new LLMClient();
    }
    return LLMClient.instance;
  }

  private getNormalizedConfig() {
    const settings = DataStore.getInstance().getSettings();
    let baseUrl = (settings.apiBaseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
    if (!baseUrl.endsWith('/v1')) {
      baseUrl = `${baseUrl}/v1`;
    }

    let apiKey = (settings.apiKey || '').trim();
    if (apiKey.startsWith('reellmapi-')) {
      apiKey = 'f' + apiKey;
    }

    let modelToUse = settings.selectedModel;
    if (settings.isAutoModel) {
      if (baseUrl.includes('31415') || baseUrl.includes('freellm')) {
        modelToUse = 'auto';
      } else {
        modelToUse = 'gpt-4o';
      }
    }

    return { baseUrl, apiKey, modelToUse, isAutoModel: settings.isAutoModel };
  }

  public async fetchAvailableModels(): Promise<string[]> {
    const { baseUrl, apiKey } = this.getNormalizedConfig();
    const defaults = ['auto', 'gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'gemini-2.5-pro', 'gemini-2.5-flash'];
    if (!apiKey) {
      return defaults;
    }

    const url = `${baseUrl}/models`;

    try {
      const resp = await this.rawRequest<any>(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (resp && Array.isArray(resp.data)) {
        const models = resp.data.map((m: any) => m.id || m.name);
        return Array.from(new Set(['auto', ...models]));
      }
      return defaults;
    } catch (err) {
      return defaults;
    }
  }

  /**
   * Determine whether an error is retriable (up to 9 times, Antigravity style)
   */
  private isRetriableError(error: any): { isRetriable: boolean; reason: string; suggestedWaitSec?: number; shouldSwitchModel?: boolean } {
    const msg = String(error?.message || error || '').toLowerCase();
    
    // Check if error suggests a specific cooldown or reset countdown (e.g. "Soonest reset ~79s")
    let suggestedWaitSec: number | undefined = undefined;
    const resetMatch = msg.match(/reset\s*(?:~|in)?\s*(\d+)\s*s/i);
    if (resetMatch && resetMatch[1]) {
      suggestedWaitSec = parseInt(resetMatch[1], 10);
    }

    // Model exhausted / stale catalog / route failure suggests we should attempt model fallback
    const shouldSwitchModel = 
      msg.includes('all models exhausted') ||
      msg.includes('routing_exhausted') ||
      msg.includes('model_not_found') ||
      msg.includes('catalog entry looks stale') ||
      msg.includes('pick another model') ||
      msg.includes('every routed provider reports the model as not found');

    // HTTP Status codes that are retriable:
    // 502 (Bad Gateway / upstream error), 503 (Service Unavailable), 504 (Gateway Timeout),
    // 500 (Internal Server Error), 429 (Rate Limit / Quota), 408 (Request Timeout),
    // 404 (When upstream model routing is temporarily updating or stale catalog entry)
    if (
      msg.includes('status 502') || 
      msg.includes('status 503') || 
      msg.includes('status 504') || 
      msg.includes('status 500') ||
      msg.includes('status 429') ||
      msg.includes('status 408') ||
      (msg.includes('status 404') && (msg.includes('routing') || msg.includes('model') || msg.includes('unavailable') || msg.includes('provider')))
    ) {
      const reason = shouldSwitchModel 
        ? 'Upstream model routes exhausted / updating'
        : 'Server or upstream gateway temporarily busy';
      return { isRetriable: true, reason, suggestedWaitSec, shouldSwitchModel };
    }

    // Common upstream provider error strings
    if (
      msg.includes('temporarily unavailable') ||
      msg.includes('update its routing') ||
      msg.includes('upstream_failed') ||
      msg.includes('provider_error') ||
      msg.includes('rate limit') ||
      msg.includes('too many requests') ||
      msg.includes('daily_quota_exhausted') ||
      msg.includes('overloaded') ||
      msg.includes('capacity') ||
      msg.includes('try again') ||
      msg.includes('routing_exhausted')
    ) {
      return { 
        isRetriable: true, 
        reason: 'Provider capacity or routing update in progress', 
        suggestedWaitSec,
        shouldSwitchModel 
      };
    }

    // Network / Socket errors
    if (
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('socket hang up') ||
      msg.includes('network error') ||
      msg.includes('timed out') ||
      msg.includes('aborterror')
    ) {
      return { isRetriable: true, reason: 'Network connection interrupted' };
    }

    return { isRetriable: false, reason: '' };
  }

  /**
   * Streams chat completion with Antigravity-style 9-attempt retry mechanism,
   * adaptive cooldown parsing, and automatic model fallback when routes are exhausted.
   */
  public async chatStream(
    messages: LLMMessage[],
    tools: LLMToolDefinition[] | undefined,
    callbacks: LLMStreamCallbacks,
    options?: { maxRetries?: number }
  ): Promise<{ content: string; toolCalls: any[] }> {
    const MAX_RETRIES = options?.maxRetries !== undefined ? options.maxRetries : 9;
    let attempt = 0;

    // Resilient fallback candidate ladder for auto-recovery
    const fallbackCandidates = ['auto', 'gpt-4o-mini', 'claude-3-5-sonnet', 'gemini-2.5-flash', 'gpt-4o'];
    let fallbackIndex = 0;
    let activeOverrideModel: string | undefined = undefined;

    while (attempt <= MAX_RETRIES) {
      try {
        return await this.chatStreamOnce(messages, tools, callbacks, activeOverrideModel);
      } catch (err: any) {
        attempt++;
        const { isRetriable, reason, suggestedWaitSec, shouldSwitchModel } = this.isRetriableError(err);

        if (attempt > MAX_RETRIES || !isRetriable) {
          console.error(`[LLMClient] Request failed permanently after ${attempt - 1} retries. Error:`, err?.message);
          throw err;
        }

        // Automatic Model Fallback:
        // If the upstream provider says "All models exhausted" or "Every routed provider reports the model as not found",
        // automatically cycle through fallback models so the user isn't stuck waiting indefinitely!
        if (shouldSwitchModel || attempt >= 3) {
          if (fallbackIndex < fallbackCandidates.length) {
            const nextCandidate = fallbackCandidates[fallbackIndex++];
            activeOverrideModel = nextCandidate;
            console.log(`[LLMClient] Upstream routing failure detected. Automatically falling back to candidate: ${nextCandidate}`);
          }
        }

        // Delay Calculation:
        // Use exponential backoff with jitter, but if the upstream explicitly returned a soonest reset under 30s,
        // respect it up to a reasonable cap (e.g., min(suggestedWait, 15s)).
        let baseDelay = Math.min(15000, Math.floor(1500 * Math.pow(1.5, attempt - 1)));
        if (suggestedWaitSec && suggestedWaitSec > 0 && suggestedWaitSec <= 15) {
          baseDelay = Math.max(baseDelay, (suggestedWaitSec + 1) * 1000);
        }

        const jitter = Math.floor(Math.random() * 600);
        const delayMs = baseDelay + jitter;

        const effectiveReason = activeOverrideModel 
          ? `${reason} (trying ${activeOverrideModel})` 
          : reason;

        console.warn(
          `[LLMClient] Request encountered retriable error (${err?.message}). Retrying attempt ${attempt}/${MAX_RETRIES} in ${Math.round(delayMs / 1000)}s...`
        );

        if (callbacks.onRetry) {
          callbacks.onRetry(attempt, MAX_RETRIES, delayMs, effectiveReason || err?.message || 'Upstream retry');
        }

        // Wait before next attempt
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error(`LLM Request failed after ${MAX_RETRIES} attempts.`);
  }

  private chatStreamOnce(
    messages: LLMMessage[],
    tools: LLMToolDefinition[] | undefined,
    callbacks: LLMStreamCallbacks,
    overrideModel?: string
  ): Promise<{ content: string; toolCalls: any[] }> {
    const { baseUrl, apiKey, modelToUse } = this.getNormalizedConfig();
    const effectiveModel = overrideModel || modelToUse;
    const url = `${baseUrl}/chat/completions`;

    const payload: any = {
      model: effectiveModel,
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
          Authorization: `Bearer ${apiKey || 'dummy-key'}`,
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
      req.setTimeout(10000, () => {
        req.destroy(new Error('Request timed out after 10s'));
      });
      req.on('error', reject);
      req.end();
    });
  }
}
