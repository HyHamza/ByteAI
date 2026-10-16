import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
  Platform,
} from '@/shared/freellm';
import { BaseProvider, type CompletionOptions } from './base.js';
import { contentToString } from '../lib/content.js';
import { GeminiWebClient } from '../gemini-web/client.js';
import { formatToolsInstruction, arrangeGeminiOutput } from '../gemini-web/arranger.js';
import { ModelRegistry } from '../gemini-web/registry.js';
import type { QuotaObservationContext } from '../services/provider-quota.js';

class AsyncChunkQueue<T> {
  private queue: T[] = [];
  private resolvers: ((value: IteratorResult<T>) => void)[] = [];
  private finished = false;
  private error: Error | null = null;

  push(value: T) {
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value, done: false });
    } else {
      this.queue.push(value);
    }
  }

  end() {
    this.finished = true;
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: undefined as any, done: true });
    }
  }

  fail(err: Error) {
    this.error = err;
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve(Promise.reject(err) as any);
    }
  }

  async *iterator(): AsyncGenerator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.finished) {
        break;
      } else if (this.error) {
        throw this.error;
      } else {
        const next = await new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
        if (next.done) break;
        yield next.value;
      }
    }
  }
}

export class GeminiWebProvider extends BaseProvider {
  readonly platform: Platform = 'gemini-free';
  readonly name = 'Google Gemini Free (Web)';
  keyless = true;

  private clientCache = new Map<string, GeminiWebClient>();

  private getClient(apiKey?: string): GeminiWebClient {
    const key = apiKey?.trim() || 'guest';
    let client = this.clientCache.get(key);
    if (!client) {
      client = new GeminiWebClient(key);
      this.clientCache.set(key, client);
    }
    return client;
  }

  private buildPrompt(messages: ChatMessage[], options?: CompletionOptions): string {
    let prompt = '';
    let hasToolResults = false;
    let fullPrompt = '';

    for (const m of messages) {
      const contentStr = contentToString(m.content) || '';
      if (m.role === 'user') {
        prompt = contentStr;
        fullPrompt += `User: ${contentStr}\n`;
      } else if (m.role === 'assistant') {
        if (m.tool_calls && m.tool_calls.length > 0) {
          fullPrompt += `Assistant called tools: ${JSON.stringify(m.tool_calls)}\n`;
        } else if (contentStr) {
          fullPrompt += `Assistant: ${contentStr}\n`;
        }
      } else if (m.role === 'tool') {
        hasToolResults = true;
        fullPrompt += `[Tool Result for ${m.name || 'tool'}]: ${contentStr}\n`;
      } else if (m.role === 'system') {
        fullPrompt += `[System]: ${contentStr}\n`;
      }
    }

    if (!prompt && messages.length > 0) {
      const lastM = messages[messages.length - 1];
      prompt = contentToString(lastM.content) || '';
    }

    if (options?.tools && options.tools.length > 0) {
      fullPrompt += formatToolsInstruction(options.tools as any);
    }

    if (messages.length > 1 || hasToolResults || (options?.tools && options.tools.length > 0)) {
      if (hasToolResults) {
        fullPrompt += 'Assistant: ';
      }
      return fullPrompt;
    }

    return prompt;
  }

  async chatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
    _quotaContext?: QuotaObservationContext
  ): Promise<ChatCompletionResponse> {
    const client = this.getClient(apiKey);
    const prompt = this.buildPrompt(messages, options);
    const resp = await client.askModel(prompt, modelId, options?.signal);

    const arranged = arrangeGeminiOutput(resp.text);
    const completionId = this.makeId();

    const result: ChatCompletionResponse = {
      id: completionId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: arranged.cleanText || (arranged.isToolCall ? null as any : ''),
            reasoning_content: arranged.reasoningContent,
            tool_calls: arranged.isToolCall ? (arranged.toolCalls as any) : undefined,
          },
          finish_reason: arranged.finishReason,
        },
      ],
      usage: {
        prompt_tokens: Math.ceil(prompt.length / 4),
        completion_tokens: Math.ceil((resp.text || '').length / 4),
        total_tokens: Math.ceil((prompt.length + (resp.text || '').length) / 4),
      },
      _routed_via: {
        platform: this.platform,
        model: modelId,
      },
    };

    return result;
  }

  async *streamChatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
    _quotaContext?: QuotaObservationContext
  ): AsyncGenerator<ChatCompletionChunk> {
    const client = this.getClient(apiKey);
    const prompt = this.buildPrompt(messages, options);
    const completionId = this.makeId();
    const created = Math.floor(Date.now() / 1000);

    // Initial role chunk
    yield {
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model: modelId,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant' },
          finish_reason: null,
        },
      ],
    };

    const hasTools = Boolean(options?.tools && options.tools.length > 0);
    const queue = new AsyncChunkQueue<ChatCompletionChunk>();
    let accumulatedText = '';

    // Run the streaming fetch asynchronously and push to the queue
    client
      .executeStreamRequest(
        prompt,
        modelId,
        (token) => {
          accumulatedText += token;

          // If no tools, stream token immediately
          if (!hasTools) {
            queue.push({
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model: modelId,
              choices: [
                {
                  index: 0,
                  delta: { content: token },
                  finish_reason: null,
                },
              ],
            });
          }
        },
        options?.signal
      )
      .then((finalResp) => {
        const fullOutput = finalResp.text || accumulatedText;
        const arranged = arrangeGeminiOutput(fullOutput);

        if (arranged.reasoningContent) {
          queue.push({
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model: modelId,
            choices: [
              {
                index: 0,
                delta: {
                  reasoning_content: arranged.reasoningContent,
                } as any,
                finish_reason: null,
              },
            ],
          });
        }

        if (arranged.isToolCall && arranged.toolCalls) {
          queue.push({
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model: modelId,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: arranged.toolCalls as any,
                },
                finish_reason: null,
              },
            ],
          });
        } else if (hasTools && arranged.cleanText) {
          queue.push({
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model: modelId,
            choices: [
              {
                index: 0,
                delta: {
                  content: arranged.cleanText,
                },
                finish_reason: null,
              },
            ],
          });
        }

        // Final finish chunk
        queue.push({
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: modelId,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: arranged.finishReason || 'stop',
            },
          ],
        });
        queue.end();
      })
      .catch((err) => {
        queue.fail(err);
      });

    // Yield chunks as they arrive from Google
    yield* queue.iterator();
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      const client = this.getClient(apiKey);
      await client.ensureInit();
      return true;
    } catch (_) {
      return false;
    }
  }
}
