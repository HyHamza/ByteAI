import https from 'https';
import http from 'http';
import { DataStore } from '../db/store';
import { FreeLLMEngine } from '../freellm/engine';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | any[];
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
  onReasoning?: (chunk: string) => void;
  onToolCallDelta?: (toolCall: any) => void;
  onRetry?: (attempt: number, maxRetries: number, delayMs: number, reason: string) => void;
  onModelResolved?: (model: string) => void;
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

    let modelToUse = settings.selectedModel || 'auto';
    if (settings.isAutoModel) {
      modelToUse = 'auto';
    }

    return { baseUrl, apiKey, modelToUse, isAutoModel: settings.isAutoModel };
  }

  public async fetchAvailableModels(): Promise<string[]> {
    const { baseUrl, apiKey } = this.getNormalizedConfig();
    const defaults = ['auto', 'gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'gemini-2.5-pro', 'gemini-2.5-flash'];
    
    // In-process FreeLLM catalog
    try {
      const listing = FreeLLMEngine.getInstance().getModelListing();
      if (listing && listing.length > 0) {
        const freeModels = listing.map((m) => m.id);
        const shouldUseFreeLLM = !apiKey || apiKey.startsWith('freellm') || baseUrl.includes('freellm') || !apiKey.startsWith('sk-');
        if (shouldUseFreeLLM) {
          return Array.from(new Set(['auto', ...freeModels]));
        }
      }
    } catch (e) {
      // Fallback
    }

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
        const availableOnly = resp.data
          .filter((m: any) => m.available !== false && m.available !== 0 && m.execution_status !== 'needsKey')
          .map((m: any) => m.id || m.name);
        return Array.from(new Set(['auto', ...(availableOnly.length > 0 ? availableOnly : resp.data.map((m: any) => m.id || m.name))]));
      }
      return defaults;
    } catch (err) {
      return defaults;
    }
  }

  /**
   * Determine whether an error is retriable (up to 9 times, Antigravity style)
   */
  private isRetriableError(error: any): { 
    isRetriable: boolean; 
    reason: string; 
    suggestedWaitSec?: number; 
    shouldSwitchModel?: boolean;
    mustUseAuto?: boolean;
    isContextOverflow?: boolean;
  } {
    const msg = String(error?.message || error || '').toLowerCase();
    
    // Check if error suggests a specific cooldown or reset countdown (e.g. "Soonest reset ~79s")
    let suggestedWaitSec: number | undefined = undefined;
    const resetMatch = msg.match(/reset\s*(?:~|in)?\s*(\d+)\s*s/i);
    if (resetMatch && resetMatch[1]) {
      suggestedWaitSec = parseInt(resetMatch[1], 10);
    }

    // Provider explicitly asks to use 'auto' or says model is not in catalog
    const mustUseAuto = 
      msg.includes('not in the catalog') ||
      msg.includes("use 'auto'") ||
      msg.includes("omit the 'model'") ||
      msg.includes('catalog entry looks stale') ||
      (msg.includes('model_not_found') && (msg.includes('catalog') || msg.includes('route')));

    // Context length or token limit exceeded
    const isContextOverflow =
      msg.includes('prompt too large') ||
      msg.includes('context_length_exceeded') ||
      msg.includes('maximum context length') ||
      msg.includes('token quota') ||
      msg.includes('too many tokens');

    // Empty completion from upstream provider
    const isEmptyCompletion =
      msg.includes('empty completion') ||
      msg.includes('0 tokens') ||
      msg.includes('no response text');

    // Model exhausted / stale catalog / route failure suggests we should attempt model fallback
    const shouldSwitchModel = 
      mustUseAuto ||
      isEmptyCompletion ||
      msg.includes('all models exhausted') ||
      msg.includes('routing_exhausted') ||
      msg.includes('model_not_found') ||
      msg.includes('catalog entry looks stale') ||
      msg.includes('pick another model') ||
      msg.includes('every routed provider reports the model as not found');

    if (isEmptyCompletion) {
      return {
        isRetriable: true,
        reason: 'Upstream returned empty response — switching candidate model',
        shouldSwitchModel: true,
      };
    }

    // HTTP Status codes that are retriable:
    // 502 (Bad Gateway / upstream error), 503 (Service Unavailable), 504 (Gateway Timeout),
    // 500 (Internal Server Error), 429 (Rate Limit / Quota), 408 (Request Timeout),
    // 404 (When upstream model routing is temporarily updating, stale catalog, or invalid model name)
    if (
      msg.includes('status 502') || 
      msg.includes('status 503') || 
      msg.includes('status 504') || 
      msg.includes('status 500') ||
      msg.includes('status 429') ||
      msg.includes('status 408') ||
      msg.includes('status 404')
    ) {
      let reason = 'Server or upstream gateway temporarily busy';
      if (mustUseAuto) {
        reason = "Model not in catalog — auto-healing with 'auto'";
      } else if (shouldSwitchModel) {
        reason = 'Upstream routes exhausted / updating';
      } else if (isContextOverflow) {
        reason = 'Context length exceeded — trimming prompt';
      }
      return { isRetriable: true, reason, suggestedWaitSec, shouldSwitchModel, mustUseAuto, isContextOverflow };
    }

    // Common upstream provider error strings
    if (
      mustUseAuto ||
      isContextOverflow ||
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
        reason: mustUseAuto 
          ? "Model not in catalog — auto-healing with 'auto'" 
          : (isContextOverflow ? 'Trimming context window' : 'Provider capacity or routing update in progress'), 
        suggestedWaitSec,
        shouldSwitchModel,
        mustUseAuto,
        isContextOverflow
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
   * adaptive cooldown parsing, automatic model fallback, and context pruning.
   */
  public async chatStream(
    messages: LLMMessage[],
    tools: LLMToolDefinition[] | undefined,
    callbacks: LLMStreamCallbacks,
    options?: { maxRetries?: number }
  ): Promise<{ content: string; reasoning?: string; toolCalls: any[]; model: string }> {
    const MAX_RETRIES = options?.maxRetries !== undefined ? options.maxRetries : 9;
    let attempt = 0;

    let workingMessages = [...messages];
    const { modelToUse, isAutoModel } = this.getNormalizedConfig();
    let activeOverrideModel: string | undefined = undefined;

    // Resilient fallback candidate ladder for auto-recovery
    const staticCandidates = ['auto', 'gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'gemini-2.5-flash'];
    let fallbackIndex = 0;
    let dynamicCatalog: string[] | null = null;

    while (attempt <= MAX_RETRIES) {
      try {
        return await this.chatStreamOnce(workingMessages, tools, callbacks, activeOverrideModel);
      } catch (err: any) {
        attempt++;
        const { isRetriable, reason, suggestedWaitSec, shouldSwitchModel, mustUseAuto, isContextOverflow } = this.isRetriableError(err);

        if (attempt > MAX_RETRIES || !isRetriable) {
          console.error(`[LLMClient] Request failed permanently after ${attempt - 1} retries. Error:`, err?.message);
          throw err;
        }

        // Automatic Model Fallback:
        // ONLY switch models if the selected model is truly invalid (404 / not in catalog) OR if isAutoModel is true!
        // Never override the user's manual selection on simple rate-limits, busy gateways, or timeouts.
        const modelActuallyNotFound = mustUseAuto || String(err?.message || '').toLowerCase().includes('model_not_found');
        if (modelActuallyNotFound || (shouldSwitchModel && isAutoModel)) {
          if (!dynamicCatalog) {
            try {
              const fetched = await this.fetchAvailableModels();
              const HIGH_PRIORITY = ['gpt-oss-120b', 'claude-sonnet-4-5', 'qwen3.8', 'codestral', 'gpt-4o', 'claude-3', 'gemini-2'];
              const filtered = fetched.filter(
                (m) => m !== 'auto' && m !== 'fusion' && !m.includes('minimax-m3') && m !== modelToUse
              );
              dynamicCatalog = filtered.sort((a, b) => {
                const aScore = HIGH_PRIORITY.some((p) => a.toLowerCase().includes(p)) ? 1 : 0;
                const bScore = HIGH_PRIORITY.some((p) => b.toLowerCase().includes(p)) ? 1 : 0;
                return bScore - aScore;
              });
            } catch (_) {
              dynamicCatalog = [];
            }
          }
          if (dynamicCatalog && dynamicCatalog.length > 0) {
            const picked = dynamicCatalog[fallbackIndex % dynamicCatalog.length];
            fallbackIndex++;
            activeOverrideModel = picked;
            console.log(`[LLMClient] Auto-healing: selecting verified available model: ${picked}`);
            callbacks.onModelResolved?.(picked);
          } else if (fallbackIndex < staticCandidates.length) {
            activeOverrideModel = staticCandidates[fallbackIndex++];
            console.log(`[LLMClient] Auto-healing from static candidates: ${activeOverrideModel}`);
            callbacks.onModelResolved?.(activeOverrideModel);
          }
        }

        // Handle context length overflow:
        // Prune older tool outputs and keep only essential recent messages
        if (isContextOverflow && workingMessages.length > 2) {
          console.warn('[LLMClient] Context length exceeded upstream limit. Pruning history...');
          const systemMsg = workingMessages[0];
          const recentMsgs = workingMessages.slice(-4).map(m => {
            if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 500) {
              return { ...m, content: m.content.slice(0, 300) + '\n... [truncated] ...\n' + m.content.slice(-200) };
            }
            return m;
          });
          workingMessages = [systemMsg, ...recentMsgs];
        }

        // Delay Calculation:
        // Adaptive cooldown wait that doesn't exhaust all 9 attempts during a known reset window
        let baseDelay = Math.min(20000, Math.floor(1500 * Math.pow(1.4, attempt - 1)));
        if (suggestedWaitSec && suggestedWaitSec > 0) {
          if (suggestedWaitSec <= 35) {
            baseDelay = (suggestedWaitSec + 1) * 1000;
          } else {
            baseDelay = Math.min(20000, Math.max(baseDelay, Math.floor(suggestedWaitSec / 3) * 1000));
          }
        }

        const jitter = Math.floor(Math.random() * 500);
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

  private async chatStreamOnce(
    messages: LLMMessage[],
    tools: LLMToolDefinition[] | undefined,
    callbacks: LLMStreamCallbacks,
    overrideModel?: string
  ): Promise<{ content: string; reasoning?: string; toolCalls: any[]; model: string }> {
    const { baseUrl, apiKey, modelToUse } = this.getNormalizedConfig();
    const effectiveModel = overrideModel || modelToUse;

    // Use native in-process FreeLLMEngine if:
    // 1) apiKey is empty
    // 2) apiKey starts with 'freellm'
    // 3) baseUrl is configured for freellm or localhost
    // 4) apiKey is not a direct third-party key (e.g. sk-...)
    const shouldUseFreeLLM = !apiKey || apiKey.startsWith('freellm') || baseUrl.includes('freellm') || baseUrl.includes('localhost:3000') || !apiKey.startsWith('sk-');

    if (shouldUseFreeLLM) {
      try {
        const response = await FreeLLMEngine.getInstance().chatCompletion(
          {
            model: effectiveModel,
            messages: messages as any,
            tools: tools as any,
            tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
            temperature: 0.2,
            stream: true,
          },
          {
            onToken: (tok) => callbacks.onToken(tok),
            onReasoning: (reasoning) => callbacks.onReasoning?.(reasoning),
            onToolCallDelta: (tc) => callbacks.onToolCallDelta?.(tc),
            onModelResolved: (model) => callbacks.onModelResolved?.(model),
            onRetry: (attempt, maxRetries, delayMs, reason) => callbacks.onRetry?.(attempt, maxRetries, delayMs, reason),
          }
        );

        const choice = response.choices?.[0];
        const content = choice?.message?.content || '';
        const reasoning = (choice?.message as any)?.reasoning_content || undefined;
        const toolCalls = choice?.message?.tool_calls || [];
        const resolvedModel = response._routed_via?.model || response.model || effectiveModel;

        return {
          content,
          reasoning,
          toolCalls,
          model: resolvedModel,
        };
      } catch (err: any) {
        throw err;
      }
    }

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
      let completeReasoning = '';
      let realModelName = '';
      const accumulatedToolCalls: Record<number, any> = {};

      const req = transport.request(reqOptions, (res) => {
        let buffer = '';

        if (res.statusCode && res.statusCode >= 400) {
          let errData = '';
          res.on('data', (d) => (errData += d));
          res.on('end', () => reject(new Error(`LLM API returned status ${res.statusCode}: ${errData}`)));
          return;
        }

        // Check response headers for upstream routed model name
        const headerModel = (
          res.headers['x-routed-via'] ||
          res.headers['x-model'] ||
          res.headers['x-selected-model'] ||
          res.headers['openai-model'] ||
          res.headers['x-routed-model']
        ) as string | undefined;

        if (headerModel && typeof headerModel === 'string' && headerModel.trim() && headerModel.toLowerCase() !== 'auto') {
          const cleanHeader = headerModel.trim().split('/').pop() || headerModel.trim();
          realModelName = cleanHeader;
          callbacks.onModelResolved?.(realModelName);
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

                // Detect actual routed model from upstream SSE payload
                const chunkModel = parsed.model || parsed.response_model || parsed.selected_model || parsed.routed_model;
                if (chunkModel && typeof chunkModel === 'string' && chunkModel.trim() && chunkModel.toLowerCase() !== 'auto') {
                  const cleanChunkModel = chunkModel.trim().split('/').pop() || chunkModel.trim();
                  if (!realModelName || realModelName === 'auto') {
                    realModelName = cleanChunkModel;
                    callbacks.onModelResolved?.(realModelName);
                  }
                }

                const delta = parsed.choices?.[0]?.delta;
                if (!delta) continue;

                // Handle text streaming
                if (delta.content) {
                  completeContent += delta.content;
                  callbacks.onToken(delta.content);
                }

                // Handle model reasoning/thinking
                const reasoningChunk = delta.reasoning || delta.thought || delta.reasoning_content;
                if (reasoningChunk) {
                  completeReasoning += reasoningChunk;
                  if (callbacks.onReasoning) {
                    callbacks.onReasoning(reasoningChunk);
                  } else {
                    callbacks.onToken(reasoningChunk);
                  }
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
          if (!completeContent.trim() && !completeReasoning.trim() && finalToolCalls.length === 0) {
            reject(new Error('Upstream model returned empty completion (0 tokens, 0 reasoning, and 0 tool calls)'));
            return;
          }

          // If the model produced reasoning but completeContent is empty and no tool calls:
          // The model concluded its output directly inside reasoning!
          if (!completeContent.trim() && completeReasoning.trim() && finalToolCalls.length === 0) {
            completeContent = completeReasoning.trim();
          }

          resolve({
            content: completeContent,
            reasoning: completeReasoning || undefined,
            toolCalls: finalToolCalls,
            model: realModelName || (effectiveModel !== 'auto' ? effectiveModel : (overrideModel || 'auto')),
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
