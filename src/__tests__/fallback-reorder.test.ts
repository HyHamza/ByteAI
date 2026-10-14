import { describe, it, expect } from 'vitest';
import { FreeLLMEngine } from '../main/services/freellm/engine';

describe('Fallback Reorder and Priority Routing', () => {
  it('should reorder fallback chain atomically and retrieve in sorted priority order', async () => {
    const engine = FreeLLMEngine.getInstance();
    const chain = await engine.getFallbackChain();

    expect(Array.isArray(chain)).toBe(true);
    if (chain.length >= 2) {
      // Pick first two items and swap them
      const originalIds = chain.map((c: any) => c.model_id);
      const swappedIds = [...originalIds];
      const temp = swappedIds[0];
      swappedIds[0] = swappedIds[1];
      swappedIds[1] = temp;

      // Execute batch reorder
      const success = engine.reorderFallbackChain(swappedIds);
      expect(success).toBe(true);

      // Verify the new order
      const updatedChain = await engine.getFallbackChain();
      expect(updatedChain[0].model_id).toBe(swappedIds[0]);
      expect(updatedChain[0].priority).toBe(1);
      expect(updatedChain[1].model_id).toBe(swappedIds[1]);
      expect(updatedChain[1].priority).toBe(2);

      // Restore original order
      engine.reorderFallbackChain(originalIds);
    }
  });
});
