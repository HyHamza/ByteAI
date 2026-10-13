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
  resolveModelGroupCandidates,
  recordRateLimitHit, 
  recordSuccess, 
  type RouteResult, 
  type ResolvedChain,
  type ChainRow
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
import { isUnifyEnabled, setUnifyEnabled, getModelGroups, resolveRequestedIdToMembers } from './services/model-groups';
import { contentToString } from './lib/content';
import { isRetryableError, isPaymentRequiredError, isModelNotFoundError, isModelAccessForbiddenError } from './lib/error-classify';
import { sanitizeProviderErrorMessage } from './lib/error-redaction';
import { logRequest } from './lib/request-log';
import { repairToolArguments, toolSchemaMap } from './lib/tool-args';
import { rescueInlineToolCalls } from './lib/tool-call-rescue';
import { DEFAULT_STRATEGY, type RoutingStrategy } from './services/scoring';
import { resolveProvider, getProvider, hasProvider } from './providers/index';
import { runImageGeneration, runSpeech } from './services/media';
import { runEmbeddings } from './services/embeddings';

function isAutoModel(modelId: string | undefined): boolean {
  if (!modelId) return true;
  const lower = modelId.toLowerCase();
  return lower === 'auto' || lower.startsWith('auto:');
}

export interface FreeLLMStreamCallbacks {
  onToken: (token: string) => void;
  onReasoning?: (chunk: string) => void;
  onToolCallDelta?: (toolCall: any) => void;
  onModelResolved?: (model: string, platform: string) => void;
  onRetry?: (attempt: number, maxRetries: number, delayMs: number, reason: string) => void;
  signal?: AbortSignal;
}

function degradeMultimodalMessages(messages: any[]): any[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const textParts: string[] = [];
    for (const part of m.content) {
      if (typeof part === 'string') {
        textParts.push(part);
      } else if (part && part.type === 'text') {
        textParts.push(part.text || '');
      } else if (part && (part.type === 'image_url' || part.type === 'image')) {
        textParts.push('[User Attached Image: Screenshot/image provided by user. Free vision routing is currently at capacity or unconfigured on active providers; continuing turn with text analysis.]');
      }
    }
    return {
      ...m,
      content: textParts.join('\n\n'),
    };
  });
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
    this.seedKeylessProviders();
    startHealthChecker();
    startCatalogSync();
    this.initialized = true;
    console.log('[FreeLLMEngine] Engine initialized with all 22+ providers and smart routing.');
  }

  private seedKeylessProviders() {
    try {
      const db = getDb();
      const keylessSeeds = [
        { platform: 'kilo', label: 'Kilo Gateway (Keyless)' },
        { platform: 'pollinations', label: 'Pollinations AI (Keyless)' },
        { platform: 'ovh', label: 'OVHcloud AI Endpoints (Keyless)' },
        { platform: 'llm7', label: 'LLM7 Labs (Keyless)' },
      ];

      for (const item of keylessSeeds) {
        const existing = db.prepare('SELECT id FROM api_keys WHERE platform = ? LIMIT 1').get(item.platform) as any;
        if (!existing) {
          const { encrypted, iv, authTag } = encrypt('no-key');
          db.prepare(`
            INSERT INTO api_keys (platform, encrypted_key, iv, auth_tag, label, status, enabled)
            VALUES (?, ?, ?, ?, ?, 'unknown', 1)
          `).run(item.platform, encrypted, iv, authTag, item.label);
        }
      }
    } catch (err) {
      console.warn('[FreeLLMEngine] Keyless provider seeding notice:', err);
    }
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
    const provider = resolveProvider(platform as Platform, baseUrl);
    const isKeyless = ['kilo', 'pollinations', 'ovh', 'llm7', 'ollama'].includes(platform) || provider?.keyless === true;
    if (!isKeyless && !key) {
      throw new Error(`API Key is required for provider: ${platform}`);
    }

    const keyToStore = isKeyless ? (key || 'no-key') : key;

    // A keyless provider needs only one sentinel row — re-enable an existing one
    // instead of piling up duplicates each time the user clicks "Add".
    if (isKeyless) {
      const existing = db.prepare('SELECT id FROM api_keys WHERE platform = ? LIMIT 1').get(platform) as { id: number } | undefined;
      if (existing) {
        db.prepare("UPDATE api_keys SET enabled = 1, status = 'unknown', label = ?, base_url = ? WHERE id = ?").run(label, baseUrl, existing.id);
        void this.testKey(existing.id);
        return { success: true, id: existing.id };
      }
    }

    const { encrypted, iv, authTag } = encrypt(keyToStore);

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
      db.prepare("UPDATE api_keys SET status = ?, last_checked_at = datetime('now') WHERE id = ?").run(newStatus, id);
      return { success: isValid, status: newStatus };
    } catch (err: any) {
      const is429 = err?.status === 429 || /429|rate limit/i.test(err?.message || '');
      const newStatus = is429 ? 'rate_limited' : 'error';
      db.prepare("UPDATE api_keys SET status = ?, last_checked_at = datetime('now') WHERE id = ?").run(newStatus, id);
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
      FROM requests
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
      FROM requests
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
      FROM requests
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
      FROM requests
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
      FROM fallback_config fc
      JOIN models m ON fc.model_db_id = m.id
      ORDER BY fc.priority ASC
    `).all() as any[];
  }

  public updateFallbackPriority(modelDbId: number, priority: number, enabled: boolean): boolean {
    const db = getDb();
    db.prepare(`
      UPDATE fallback_config SET priority = ?, enabled = ? WHERE model_db_id = ?
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
    const schemaMap = hasTools && req.tools ? toolSchemaMap(req.tools) : undefined;

    const estimatedInputTokens = (req.messages || []).reduce((sum, m) => {
      const text = contentToString(m.content);
      return sum + Math.ceil(text.length / 4);
    }, 0);

    const hasImage = (req.messages || []).some((m) => {
      if (Array.isArray(m.content)) {
        return m.content.some((b: any) => b?.type === 'image_url' || b?.type === 'image');
      }
      return false;
    });

    const estimatedTotal = estimatedInputTokens + (req.max_tokens ?? 1000);

    let resolvedChain: ResolvedChain | undefined;
    let groupChain: ChainRow[] | undefined;
    let preferredModel: number | undefined;

    if (isAutoModel(requestedModel)) {
      resolvedChain = resolveRoutingChain(requestedModel);
    } else if (requestedModel) {
      const db = getDb();
      const members = isUnifyEnabled() ? resolveRequestedIdToMembers(requestedModel, getModelGroups()) : null;
      if (members && members.length > 0) {
        groupChain = resolveModelGroupCandidates(members);
      } else {
        const found = db.prepare('SELECT id FROM models WHERE model_id = ? AND enabled = 1 LIMIT 1').get(requestedModel) as { id: number } | undefined;
        if (found) {
          preferredModel = found.id;
        }
      }
    }

    const MAX_RETRIES = 10;
    const skipKeys = new Set<string>();
    const skipModels = new Set<number>();
    let lastError: any = null;

    let requireVision = hasImage;
    let workingMessages = req.messages;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (callbacks?.signal?.aborted) {
        throw new Error('Execution cancelled by user');
      }

      let route: RouteResult | null = null;
      try {
        route = routeRequest(
          estimatedTotal,
          skipKeys.size > 0 ? skipKeys : undefined,
          preferredModel,
          requireVision,
          hasTools,
          skipModels.size > 0 ? skipModels : undefined,
          groupChain ?? resolvedChain?.chain
        );
      } catch (err: any) {
        if (requireVision) {
          console.warn('[FreeLLMEngine] No vision model reachable for active providers. Gracefully falling back to text routing.');
          requireVision = false;
          workingMessages = degradeMultimodalMessages(req.messages);
          try {
            route = routeRequest(
              estimatedTotal,
              skipKeys.size > 0 ? skipKeys : undefined,
              preferredModel,
              false,
              hasTools,
              skipModels.size > 0 ? skipModels : undefined,
              groupChain ?? resolvedChain?.chain
            );
          } catch (fallbackErr: any) {
            lastError = fallbackErr;
            break;
          }
        } else {
          lastError = err;
          break;
        }
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
          const toolCallAcc = new Map<number, { id?: string; name: string; args: string }>();

          const stream = route.provider.streamChatCompletion(
            route.apiKey,
            workingMessages,
            route.modelId,
            {
              temperature: req.temperature,
              max_tokens: req.max_tokens,
              top_p: req.top_p,
              tools: req.tools,
              tool_choice: req.tool_choice,
              parallel_tool_calls: req.parallel_tool_calls,
              signal: callbacks?.signal,
            }
          );

          for await (const chunk of stream) {
            if (callbacks?.signal?.aborted) {
              throw new Error('Execution cancelled by user');
            }
            const anyChunk = chunk as Record<string, any>;
            if (anyChunk.error && !anyChunk.choices) {
              const msg = anyChunk.error.message ?? JSON.stringify(anyChunk.error);
              throw new Error(`In-band provider error from ${route.displayName}: ${msg}`);
            }

            const choice = anyChunk.choices?.[0];
            if (choice?.delta?.content) {
              streamedContent += choice.delta.content;
              callbacks?.onToken?.(choice.delta.content);
            }
            if ((choice?.delta as any)?.reasoning_content) {
              const reasoning = (choice?.delta as any).reasoning_content;
              streamedReasoning += reasoning;
              callbacks?.onReasoning?.(reasoning);
            }
            if (choice?.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallAcc.has(idx)) toolCallAcc.set(idx, { id: undefined, name: '', args: '' });
                const acc = toolCallAcc.get(idx)!;
                if (tc.id && !acc.id) acc.id = tc.id;
                if (tc.function?.name) acc.name += tc.function.name;
                if (tc.function?.arguments) acc.args += tc.function.arguments;
                callbacks?.onToolCallDelta?.(tc);
              }
            }
          }

          let syntheticStreamIds = 0;
          let finalToolCalls: ChatToolCall[] | undefined = toolCallAcc.size > 0
            ? [...toolCallAcc.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([, acc]) => ({
                  id: acc.id && acc.id.length > 0 ? acc.id : `call_stream_${++syntheticStreamIds}`,
                  type: 'function' as const,
                  function: {
                    name: acc.name,
                    arguments: schemaMap ? repairToolArguments(acc.args || '{}', schemaMap.get(acc.name)) : (acc.args || '{}'),
                  },
                }))
                .filter((c) => {
                  try { JSON.parse(c.function.arguments); return c.function.name.length > 0; } catch { return false; }
                })
            : undefined;

          // Inline dialect rescue if needed
          if ((!finalToolCalls || finalToolCalls.length === 0) && hasTools && req.tools && streamedContent) {
            const rescue = rescueInlineToolCalls(streamedContent, new Set((req.tools || []).map((t) => t.function.name)));
            if (rescue.detected && rescue.calls) {
              finalToolCalls = rescue.calls.map((c, i) => ({
                id: `call_rescued_${i + 1}`,
                type: 'function' as const,
                function: {
                  name: c.name,
                  arguments: schemaMap ? repairToolArguments(c.arguments, schemaMap.get(c.name)) : c.arguments,
                },
              }));
              streamedContent = rescue.cleanText;
            }
          }

          const latencyMs = Date.now() - startTime;
          const outputTokens = Math.max(1, Math.ceil(streamedContent.length / 4));

          recordRequest(route.platform, route.modelId, route.keyId);
          recordTokens(route.platform, route.modelId, route.keyId, estimatedInputTokens + outputTokens);
          recordSuccess(route.modelDbId);
          logRequest(route.platform, route.modelId, route.keyId, 'success', estimatedInputTokens, outputTokens, latencyMs, null, null, requestedModel);

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
                tool_calls: finalToolCalls && finalToolCalls.length > 0 ? finalToolCalls : undefined,
                reasoning_content: streamedReasoning || undefined,
              },
              finish_reason: finalToolCalls && finalToolCalls.length > 0 ? 'tool_calls' : 'stop',
            }],
            usage: {
              prompt_tokens: estimatedInputTokens,
              completion_tokens: outputTokens,
              total_tokens: estimatedInputTokens + outputTokens,
            },
            _routed_via: {
              platform: route.platform as Platform,
              model: route.modelId,
            },
          };
        } else {
          // Non-streaming completion
          const response = await route.provider.chatCompletion(
            route.apiKey,
            workingMessages,
            route.modelId,
            {
              temperature: req.temperature,
              max_tokens: req.max_tokens,
              top_p: req.top_p,
              tools: req.tools,
              tool_choice: req.tool_choice,
              parallel_tool_calls: req.parallel_tool_calls,
              signal: callbacks?.signal,
            }
          );

          const latencyMs = Date.now() - startTime;
          const promptTokens = response.usage?.prompt_tokens ?? estimatedInputTokens;
          const completionTokens = response.usage?.completion_tokens ?? 0;
          const totalTokens = response.usage?.total_tokens ?? (promptTokens + completionTokens);

          recordRequest(route.platform, route.modelId, route.keyId);
          recordTokens(route.platform, route.modelId, route.keyId, totalTokens);
          recordSuccess(route.modelDbId);
          logRequest(route.platform, route.modelId, route.keyId, 'success', promptTokens, completionTokens, latencyMs, null, null, requestedModel);

          response._routed_via = {
            platform: route.platform as Platform,
            model: route.modelId,
          };
          return response;
        }
      } catch (err: any) {
        const latencyMs = Date.now() - startTime;
        const safeError = sanitizeProviderErrorMessage(err?.message || String(err));
        lastError = err;

        logRequest(route.platform, route.modelId, route.keyId, 'error', estimatedInputTokens, 0, latencyMs, safeError, null, requestedModel);

        if (isRetryableError(err)) {
          if (isModelNotFoundError(err) || isModelAccessForbiddenError(err)) {
            skipModels.add(route.modelDbId);
          }
          const skipId = `${route.platform}:${route.modelId}:${route.keyId}`;
          skipKeys.add(skipId);
          setCooldown(
            route.platform,
            route.modelId,
            route.keyId,
            isPaymentRequiredError(err)
              ? PAYMENT_REQUIRED_COOLDOWN_MS
              : isModelAccessForbiddenError(err)
              ? MODEL_FORBIDDEN_COOLDOWN_MS
              : getCooldownDurationForLimit(
                  route.platform,
                  route.modelId,
                  route.keyId,
                  { rpd: route.rpdLimit, tpd: route.tpdLimit },
                  err.retryAfterMs
                )
          );
          recordRateLimitHit(route.modelDbId);
          learnLimitFromError(route.modelDbId, err);
          if (callbacks?.signal?.aborted) {
            throw new Error('Execution cancelled by user');
          }
          callbacks?.onRetry?.(attempt + 1, MAX_RETRIES, 400, `${route.displayName} hit error (${safeError}), cascading...`);
          await new Promise((r) => setTimeout(r, 300));
          if (callbacks?.signal?.aborted) {
            throw new Error('Execution cancelled by user');
          }
          continue;
        }

        throw new Error(`Provider error (${route.displayName}): ${safeError}`);
      }
    }

    throw lastError || new Error(`No available or enabled providers found to serve model "${requestedModel}". Please check your API keys and Fallback Chain.`);
  }

  // ─── Free Media Studio (FLUX Image & Speech) ─────────────────────────────

  public async generateImage(prompt: string, options?: { model?: string; size?: string }): Promise<any> {
    return runImageGeneration(options?.model, {
      prompt,
      size: options?.size,
    });
  }

  public async generateSpeech(text: string, options?: { model?: string; voice?: string }): Promise<any> {
    return runSpeech(options?.model, {
      input: text,
      voice: options?.voice,
    });
  }
}
