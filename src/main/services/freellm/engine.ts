import crypto from 'crypto';
import type { 
  Platform, 
  ApiKey, 
  AnalyticsSummary, 
  PlatformStats, 
  TimelinePoint, 
  RequestLog, 
  ChatCompletionRequest, 
  ChatCompletionResponse,
  ChatToolCall,
  ChatMessage
} from '@/shared/freellm';
import { initDb, getDb, getSetting, setSetting } from './db/index';
import { encrypt, decrypt, maskKey } from './lib/crypto';
import { 
  routeRequest, 
  resolveRoutingChain, 
  recordRateLimitHit, 
  recordSuccess, 
  type RouteResult, 
  type ResolvedChain 
} from './services/router';
import { 
  recordRequest, 
  recordTokens, 
  setCooldown, 
  getCooldownDurationForLimit,
  PAYMENT_REQUIRED_COOLDOWN_MS,
  MODEL_FORBIDDEN_COOLDOWN_MS,
  learnLimitFromError 
} from './services/ratelimit';
import { startHealthChecker, checkSingleKey } from './services/health';
import { startCatalogSync } from './services/catalog-sync';
import { buildModelListing, type NormalizedModel } from './services/model-listing';
import { isUnifyEnabled, setUnifyEnabled } from './services/model-groups';
import { isRetryableError, isPaymentRequiredError, isModelAccessForbiddenError } from './lib/error-classify';
import { sanitizeProviderErrorMessage } from './lib/error-redaction';
import { logRequest } from './lib/request-log';
import { repairToolArguments, toolSchemaMap } from './lib/tool-args';
import { rescueInlineToolCalls } from './lib/tool-call-rescue';
import { DEFAULT_STRATEGY, type RoutingStrategy } from './services/scoring';
import { resolveProvider, getProvider, hasProvider } from './providers/index';
import { runImageGeneration, runSpeech } from './services/media';
import { runEmbeddings } from './services/embeddings';

export interface FreeLLMStreamCallbacks {
  onToken: (token: string) => void;
  onReasoning?: (chunk: string) => void;
  onToolCallDelta?: (toolCall: any) => void;
  onModelResolved?: (model: string, platform: string) => void;
  onRetry?: (attempt: number, maxRetries: number, delayMs: number, reason: string) => void;
}

export class FreeLLMEngine {
  private static instance: FreeLLMEngine;
  private initialized = false;

  public static getInstance(): FreeLLMEngine {
    if (!FreeLLMEngine.instance) {
      FreeLLMEngine.instance = new FreeLLMEngine();
    }
    return FreeLLMEngine.instance;
  }

  public init() {
    if (this.initialized) return;
    initDb();
    startHealthChecker();
    startCatalogSync();
    this.initialized = true;
    console.log('[FreeLLMEngine] Engine initialized with all 22+ providers and smart routing.');
  }

  // ─── API Key Management ───────────────────────────────────────────────────

  public listKeys(): any[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all() as any[];

    return rows.map((row) => {
      let maskedKey = '****';
      try {
        const realKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
        maskedKey = maskKey(realKey);
      } catch {
        maskedKey = '[decrypt failed]';
      }
      return {
        id: row.id,
        platform: row.platform,
        label: row.label,
        maskedKey,
        baseUrl: row.base_url ?? null,
        status: row.status,
        enabled: row.enabled === 1,
        createdAt: row.created_at,
        lastCheckedAt: row.last_checked_at,
      };
    });
  }

  public addKey(data: { platform: Platform; key?: string; label?: string; baseUrl?: string }): { success: boolean; id: number } {
    const db = getDb();
    const platform = data.platform;
    const key = data.key?.trim() || '';
    const label = data.label?.trim() || `${platform} key`;
    const baseUrl = data.baseUrl?.trim() || null;

    // Check for keyless platforms
    const isKeyless = ['kilo', 'pollinations', 'ovh'].includes(platform);
    if (!isKeyless && !key) {
      throw new Error(`API Key is required for provider: ${platform}`);
    }

    const { encrypted, iv, authTag } = encrypt(key || 'keyless-sentinel');

    const res = db.prepare(`
      INSERT INTO api_keys (platform, encrypted_key, iv, auth_tag, label, base_url, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, 'unknown', 1)
    `).run(platform, encrypted, iv, authTag, label, baseUrl);

    const newId = Number(res.lastInsertRowid);
    // Background validation
    void this.testKey(newId);

    return { success: true, id: newId };
  }

  public updateKey(id: number, data: { enabled?: boolean; label?: string; baseUrl?: string }): { success: boolean } {
    const db = getDb();
    if (data.enabled !== undefined) {
      db.prepare('UPDATE api_keys SET enabled = ? WHERE id = ?').run(data.enabled ? 1 : 0, id);
    }
    if (data.label !== undefined) {
      db.prepare('UPDATE api_keys SET label = ? WHERE id = ?').run(data.label, id);
    }
    if (data.baseUrl !== undefined) {
      db.prepare('UPDATE api_keys SET base_url = ? WHERE id = ?').run(data.baseUrl, id);
    }
    return { success: true };
  }

  public deleteKey(id: number): { success: boolean } {
    const db = getDb();
    db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
    return { success: true };
  }

  public async testKey(id: number): Promise<{ success: boolean; status: string; error?: string }> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as any;
    if (!row) {
      return { success: false, status: 'invalid', error: 'Key not found' };
    }

    let realKey = '';
    try {
      realKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
    } catch {
      return { success: false, status: 'error', error: 'Key decryption failed' };
    }

    const provider = resolveProvider(row.platform as Platform, row.base_url);
    if (!provider) {
      return { success: false, status: 'error', error: `No provider registered for ${row.platform}` };
    }

    try {
      const isValid = await provider.validateKey(realKey);
      const newStatus = isValid ? 'healthy' : 'invalid';
      db.prepare('UPDATE api_keys SET status = ?, last_checked_at = datetime("now") WHERE id = ?').run(newStatus, id);
      return { success: isValid, status: newStatus };
    } catch (err: any) {
      const is429 = err?.status === 429 || /429|rate limit/i.test(err?.message || '');
      const newStatus = is429 ? 'rate_limited' : 'error';
      db.prepare('UPDATE api_keys SET status = ?, last_checked_at = datetime("now") WHERE id = ?').run(newStatus, id);
      return { success: false, status: newStatus, error: err?.message };
    }
  }

  // ─── Analytics & Metrics ──────────────────────────────────────────────────

  public getAnalyticsSummary(): AnalyticsSummary {
    const db = getDb();
    const row = db.prepare(`
      SELECT 
        COUNT(*) as total_requests,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_requests,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        AVG(latency_ms) as avg_latency_ms
      FROM request_logs
    `).get() as any;

    const totalRequests = Number(row?.total_requests || 0);
    const successRequests = Number(row?.success_requests || 0);
    const successRate = totalRequests > 0 ? (successRequests / totalRequests) * 100 : 100;
    const totalInputTokens = Number(row?.total_input_tokens || 0);
    const totalOutputTokens = Number(row?.total_output_tokens || 0);
    const avgLatencyMs = Math.round(Number(row?.avg_latency_ms || 0));

    // Realistic estimated cost savings calculation ($3 per 1M input, $15 per 1M output compared to frontier paid APIs)
    const estimatedCostSavings = parseFloat(((totalInputTokens * 0.000003) + (totalOutputTokens * 0.000015)).toFixed(2));

    return {
      totalRequests,
      successRate: parseFloat(successRate.toFixed(1)),
      totalInputTokens,
      totalOutputTokens,
      avgLatencyMs,
      estimatedCostSavings,
    };
  }

  public getPlatformStats(): PlatformStats[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT 
        platform,
        COUNT(*) as requests,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        AVG(latency_ms) as avg_latency_ms,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens
      FROM request_logs
      GROUP BY platform
      ORDER BY requests DESC
    `).all() as any[];

    return rows.map((r) => {
      const requests = Number(r.requests || 0);
      const successCount = Number(r.success_count || 0);
      return {
        platform: r.platform as Platform,
        requests,
        successRate: requests > 0 ? parseFloat(((successCount / requests) * 100).toFixed(1)) : 100,
        avgLatencyMs: Math.round(Number(r.avg_latency_ms || 0)),
        totalInputTokens: Number(r.total_input_tokens || 0),
        totalOutputTokens: Number(r.total_output_tokens || 0),
      };
    });
  }

  public getTimeline(days = 7): TimelinePoint[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT 
        strftime('%Y-%m-%d %H:00', created_at) as hour_bucket,
        COUNT(*) as requests,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as failure_count
      FROM request_logs
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY hour_bucket
      ORDER BY hour_bucket ASC
    `).all() as any[];

    return rows.map((r) => ({
      timestamp: r.hour_bucket,
      requests: Number(r.requests || 0),
      successCount: Number(r.success_count || 0),
      failureCount: Number(r.failure_count || 0),
    }));
  }

  public getRequestLogs(limit = 50, offset = 0): RequestLog[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, platform, model_id, status, input_tokens, output_tokens, latency_ms, error, created_at
      FROM request_logs
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as any[];

    return rows.map((r) => ({
      id: r.id,
      platform: r.platform as Platform,
      modelId: r.model_id,
      status: r.status,
      inputTokens: r.input_tokens || 0,
      outputTokens: r.output_tokens || 0,
      latencyMs: r.latency_ms || 0,
      error: r.error ?? null,
      createdAt: r.created_at,
    }));
  }

  // ─── Models, Fallback & Strategy ──────────────────────────────────────────

  public getModelListing(): NormalizedModel[] {
    return buildModelListing().models;
  }

  public getFallbackChain(): any[] {
    const db = getDb();
    return db.prepare(`
      SELECT 
        fc.priority, 
        fc.enabled as chain_enabled, 
        m.id as model_id, 
        m.platform, 
        m.model_id as raw_model_id, 
        m.display_name, 
        m.intelligence_rank, 
        m.speed_rank, 
        m.context_window, 
        m.supports_vision, 
        m.supports_tools
      FROM fallback_chain fc
      JOIN models m ON fc.model_id = m.id
      ORDER BY fc.priority ASC
    `).all() as any[];
  }

  public updateFallbackPriority(modelDbId: number, priority: number, enabled: boolean): boolean {
    const db = getDb();
    db.prepare(`
      UPDATE fallback_chain SET priority = ?, enabled = ? WHERE model_id = ?
    `).run(priority, enabled ? 1 : 0, modelDbId);
    return true;
  }

  public getRoutingStrategy(): RoutingStrategy {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'routing_strategy'").get() as any;
    return (row?.value as RoutingStrategy) || DEFAULT_STRATEGY;
  }

  public setRoutingStrategy(strategy: RoutingStrategy): void {
    setSetting('routing_strategy', strategy);
  }

  public getModelUnification(): boolean {
    return isUnifyEnabled();
  }

  public setModelUnification(enabled: boolean): void {
    setUnifyEnabled(enabled);
  }

  // ─── Core Autonomous Chat Completion Execution ──────────────────────────

  public async chatCompletion(
    req: ChatCompletionRequest,
    callbacks?: FreeLLMStreamCallbacks
  ): Promise<ChatCompletionResponse> {
    const isStream = Boolean(req.stream);
    const requestedModel = req.model || 'auto';
    const requestId = crypto.randomUUID();
    const hasTools = Boolean(req.tools && req.tools.length > 0);
    const schemaMap = hasTools ? toolSchemaMap(req.tools) : undefined;

    // Resolve candidates & fallback chain
    const chain: ResolvedChain = resolveRoutingChain(requestedModel, req.messages, {
      tools: req.tools,
      toolChoice: req.tool_choice,
    });

    if (chain.rows.length === 0) {
      throw new Error(`No available or enabled providers found to serve model "${requestedModel}". Please add API keys in Free LLM Keys Hub.`);
    }

    let lastError: any = null;
    const maxRetries = Math.min(chain.rows.length, 10);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let route: RouteResult | null = null;
      try {
        route = routeRequest(req.messages, chain, {
          tools: req.tools,
          toolChoice: req.tool_choice,
          requestId,
        });
      } catch (err: any) {
        lastError = err;
        break;
      }

      if (!route) {
        break;
      }

      const startTime = Date.now();
      callbacks?.onModelResolved?.(route.modelId, route.platform);

      try {
        if (isStream) {
          let streamedContent = '';
          let streamedReasoning = '';
          const toolCallDeltas: Map<number, ChatToolCall> = new Map();

          const stream = route.provider.chatCompleteStream({
            messages: req.messages,
            model: route.modelId,
            temperature: req.temperature,
            max_tokens: req.max_tokens,
            tools: req.tools,
            tool_choice: req.tool_choice,
          }, route.apiKey);

          for await (const chunk of stream) {
            if (chunk.content) {
              streamedContent += chunk.content;
              callbacks?.onToken?.(chunk.content);
            }
            if (chunk.reasoning_content) {
              streamedReasoning += chunk.reasoning_content;
              callbacks?.onReasoning?.(chunk.reasoning_content);
            }
            if (chunk.tool_calls && chunk.tool_calls.length > 0) {
              for (const tc of chunk.tool_calls) {
                const idx = (tc as any).index ?? 0;
                let existing = toolCallDeltas.get(idx);
                if (!existing) {
                  existing = {
                    id: tc.id || `call_${Date.now()}_${idx}`,
                    type: 'function',
                    function: { name: tc.function?.name || '', arguments: '' },
                  };
                  toolCallDeltas.set(idx, existing);
                } else if (tc.function?.name && !existing.function.name) {
                  existing.function.name = tc.function.name;
                }
                if (tc.function?.arguments) {
                  existing.function.arguments += tc.function.arguments;
                }
                callbacks?.onToolCallDelta?.(tc);
              }
            }
          }

          let finalToolCalls: ChatToolCall[] | undefined = toolCallDeltas.size > 0 
            ? Array.from(toolCallDeltas.values()) 
            : undefined;

          // Repair tool arguments if any
          if (finalToolCalls && schemaMap) {
            finalToolCalls = repairToolArguments(finalToolCalls, schemaMap);
          }

          // Tool call rescue for inline markers (XML/markdown JSON)
          if (!finalToolCalls && hasTools && req.tools) {
            const rescued = rescueInlineToolCalls(streamedContent, req.tools);
            if (rescued) {
              streamedContent = rescued.cleanedContent;
              finalToolCalls = rescued.toolCalls;
            }
          }

          const latencyMs = Date.now() - startTime;
          const inputTokens = Math.max(1, Math.round(JSON.stringify(req.messages).length / 4));
          const outputTokens = Math.max(1, Math.round((streamedContent.length + JSON.stringify(finalToolCalls || []).length) / 4));

          recordSuccess(route.modelDbId, route.keyId, latencyMs);
          recordTokens(route.platform, route.modelId, route.keyId, inputTokens, outputTokens);
          logRequest(route.platform, route.modelId, 'success', inputTokens, outputTokens, latencyMs, null);

          return {
            id: `chatcmpl-${requestId}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: route.modelId,
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: streamedContent,
                tool_calls: finalToolCalls,
                reasoning_content: streamedReasoning || undefined,
              },
              finish_reason: finalToolCalls ? 'tool_calls' : 'stop',
            }],
            usage: {
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              total_tokens: inputTokens + outputTokens,
            },
            _routed_via: {
              platform: route.platform as Platform,
              model: route.modelId,
            },
          };
        } else {
          // Non-streaming completion
          const response = await route.provider.chatComplete({
            messages: req.messages,
            model: route.modelId,
            temperature: req.temperature,
            max_tokens: req.max_tokens,
            tools: req.tools,
            tool_choice: req.tool_choice,
          }, route.apiKey);

          const latencyMs = Date.now() - startTime;
          const usage = response.usage || {
            prompt_tokens: Math.round(JSON.stringify(req.messages).length / 4),
            completion_tokens: Math.round(JSON.stringify(response.choices).length / 4),
            total_tokens: 0,
          };
          usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;

          recordSuccess(route.modelDbId, route.keyId, latencyMs);
          recordTokens(route.platform, route.modelId, route.keyId, usage.prompt_tokens, usage.completion_tokens);
          logRequest(route.platform, route.modelId, 'success', usage.prompt_tokens, usage.completion_tokens, latencyMs, null);

          response._routed_via = {
            platform: route.platform as Platform,
            model: route.modelId,
          };
          return response;
        }
      } catch (err: any) {
        const latencyMs = Date.now() - startTime;
        const errMsg = sanitizeProviderErrorMessage(err?.message || String(err));
        lastError = err;

        const is429 = err?.status === 429 || /429|rate limit|quota|exhaust/i.test(errMsg);
        if (is429) {
          recordRateLimitHit(route.modelDbId);
          setCooldown(route.platform, route.modelId, route.keyId, getCooldownDurationForLimit(route.rpdLimit, route.tpdLimit));
          learnLimitFromError(route.platform, route.modelId, route.keyId, errMsg, err?.headers || {});
        } else if (isPaymentRequiredError(err)) {
          setCooldown(route.platform, route.modelId, route.keyId, PAYMENT_REQUIRED_COOLDOWN_MS);
        } else if (isModelAccessForbiddenError(err)) {
          setCooldown(route.platform, route.modelId, route.keyId, MODEL_FORBIDDEN_COOLDOWN_MS);
        }

        logRequest(route.platform, route.modelId, 'error', 0, 0, latencyMs, errMsg);

        if (attempt < maxRetries && isRetryableError(err)) {
          callbacks?.onRetry?.(attempt, maxRetries, 500, `${route.platform} ${route.modelId} hit error (${errMsg}), cascading...`);
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }

        throw err;
      }
    }

    throw lastError || new Error(`All providers for model "${requestedModel}" failed after ${maxRetries} cascade attempts.`);
  }

  // ─── Free Media Studio (FLUX Image & Speech) ─────────────────────────────

  public async generateImage(prompt: string, options?: { model?: string; size?: string }): Promise<any> {
    return runImageGeneration({
      prompt,
      model: options?.model,
      size: options?.size,
    });
  }

  public async generateSpeech(text: string, options?: { model?: string; voice?: string }): Promise<any> {
    return runSpeech({
      text,
      model: options?.model,
      voice: options?.voice,
    });
  }
}
