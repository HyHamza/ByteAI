import { describe, it, expect } from 'vitest';
import { LLMClient } from '../main/services/llm/client';
import { FreeLLMEngine } from '../main/services/freellm/engine';

describe('LLMClient and FreeLLMEngine', () => {
  it('should initialize and check isAutoModel without reference errors', async () => {
    const engine = FreeLLMEngine.getInstance();
    expect(engine).toBeDefined();

    const client = LLMClient.getInstance();
    expect(client).toBeDefined();

    try {
      const res = await client.chatStream(
        [{ role: 'user', content: 'hello' }],
        undefined,
        {
          onToken: (t) => console.log('token:', t),
        },
        { maxRetries: 0 }
      );
      console.log('chatStream result model:', res.model, 'content length:', res.content.length);
    } catch (err: any) {
      console.log('chatStream error caught:', err.message);
      expect(err.message).not.toContain('isAutoModel is not defined');
    }
  });
});
