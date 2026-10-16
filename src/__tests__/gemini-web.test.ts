import { describe, it, expect, beforeAll } from 'vitest';
import { FreeLLMEngine } from '../main/services/freellm/engine';
import { GeminiWebClient } from '../main/services/freellm/gemini-web/client';
import { GeminiWebProvider } from '../main/services/freellm/providers/gemini-web';
import { arrangeGeminiOutput, formatToolsInstruction } from '../main/services/freellm/gemini-web/arranger';
import { getDb } from '../main/services/freellm/db/index';

describe('Gemini Web Free AI Integration', () => {
  beforeAll(() => {
    FreeLLMEngine.getInstance().init();
  });

  it('should format tool call instructions and parse tool call outputs', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather for location',
          parameters: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location'],
          },
        },
      },
    ];

    const instruction = formatToolsInstruction(tools);
    expect(instruction).toContain('[AVAILABLE TOOLS]');
    expect(instruction).toContain('get_weather');

    const sampleOutput = `<thinking>Need to fetch weather for London</thinking>
<tool_call>
{"name": "get_weather", "arguments": {"location": "London"}}
</tool_call>`;

    const arranged = arrangeGeminiOutput(sampleOutput);
    expect(arranged.isToolCall).toBe(true);
    expect(arranged.reasoningContent).toBe('Need to fetch weather for London');
    expect(arranged.toolCalls).toBeDefined();
    expect(arranged.toolCalls![0].function.name).toBe('get_weather');
    expect(JSON.parse(arranged.toolCalls![0].function.arguments).location).toBe('London');
  });

  it('should validate and register gemini-free models into the database and priority ladder', async () => {
    const db = getDb();
    db.prepare("UPDATE api_keys SET enabled = 1 WHERE platform = 'gemini-free'").run();

    const engine = FreeLLMEngine.getInstance();
    const syncRes = await engine.syncGeminiWebModels();
    expect(syncRes.synced).toBeGreaterThanOrEqual(6);
    expect(syncRes.models).toContain('gemini-3.8-flash');
    expect(syncRes.models).toContain('gemini-4-argon');
    const rows = db.prepare("SELECT * FROM models WHERE platform = 'gemini-free'").all() as any[];
    expect(rows.length).toBeGreaterThanOrEqual(6);

    const flash = rows.find((r) => r.model_id === 'gemini-3.8-flash');
    expect(flash).toBeDefined();
    expect(flash.supports_tools).toBe(1);
    expect(flash.supports_vision).toBe(1);

    const listing = engine.getModelListing();
    const flashListing = listing.find((m) => m.id === 'gemini-3.8-flash' || m.id === 'google-gemini-3.8-flash');
    expect(flashListing).toBeDefined();
    expect(flashListing?.available).toBe(1);

    const argonListing = listing.find((m) => m.id === 'gemini-4-argon' || m.id === 'google-gemini-4-argon');
    expect(argonListing).toBeDefined();
    expect(argonListing?.ownedBy).toContain('Google');
  });

  it('should validate keyless connectivity with GeminiWebProvider', async () => {
    const provider = new GeminiWebProvider();
    expect(provider.platform).toBe('gemini-free');
    expect(provider.keyless).toBe(true);

    const valid = await provider.validateKey('no-key');
    expect(valid).toBe(true);
  }, 20000);

  it('should stream chat completion directly in-process with real tokens', async () => {
    const provider = new GeminiWebProvider();
    const chunks: string[] = [];

    const stream = provider.streamChatCompletion(
      'no-key',
      [{ role: 'user', content: 'Say "Byte Free Gemini is online" in exactly 5 words' }],
      'gemini-3.8-flash'
    );

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        chunks.push(delta);
      }
    }

    const fullResponse = chunks.join('');
    console.log('Streamed Response:', fullResponse);
    expect(chunks.length).toBeGreaterThan(0);
    expect(fullResponse.length).toBeGreaterThan(0);
  }, 30000);
});
