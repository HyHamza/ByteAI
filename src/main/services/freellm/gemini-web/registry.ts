import { ModelConfig } from './types';

export function buildHeaderValue(m: ModelConfig): string {
  if (m.header_template) {
    let s = m.header_template;
    if (s.includes('%s') && s.includes('%d')) {
      const lvl = (m.thinking_level && m.thinking_level > 0) ? m.thinking_level : 1;
      return s.replace('%s', m.mode_id).replace('%d', lvl.toString());
    }
    if (s.includes('%d')) {
      const lvl = (m.thinking_level && m.thinking_level > 0) ? m.thinking_level : 1;
      return s.replace('%d', lvl.toString());
    }
    if (s.includes('%s')) {
      return s.replace('%s', m.mode_id);
    }
    return s;
  }
  if (m.thinking_level && m.thinking_level > 0) {
    return `[1,null,null,null,"${m.mode_id}",null,null,null,[4,5,6,8,16,19,20],null,null,null,null,null,8,${m.thinking_level},null,null,null,null]`;
  }
  return `[1,null,null,null,"${m.mode_id}",null,null,0,[4],null,null,2]`;
}

export const defaultGeminiWebModels: ModelConfig[] = [
  {
    id: 'gemini-3.8-flash',
    display_name: 'Google Gemini 3.8 Flash',
    description: 'All-around help — balanced multi-modal flagship',
    mode_id: '56fdd199312815e2',
    header_template: `[1,null,null,null,"%s",null,null,0,[4],null,null,2]`,
    min_tier: 'free',
    aliases: ['3.8-flash', 'gemini-flash', 'flash', 'gemini-3.7-flash', 'default'],
    capabilities: ['chat', 'stream', 'vision', 'video', 'tools'],
    is_default: true,
    source: 'builtin',
  },
  {
    id: 'gemini-3.5-flash-lite',
    display_name: 'Google Gemini 3.5 Flash-Lite',
    description: 'Fastest answers — ultra low latency quick answers',
    mode_id: '8c46e95b1a07cecc',
    header_template: `[1,null,null,null,"%s",null,null,0,[4],null,null,2]`,
    min_tier: 'free',
    aliases: ['3.5-flash-lite', 'flash-lite', 'gemini-flash-lite', 'gemini-lite', 'lite', 'fbb127bbb056c959'],
    capabilities: ['chat', 'stream', 'vision', 'tools', 'fastest'],
    is_default: false,
    source: 'builtin',
  },
  {
    id: 'gemini-4-argon',
    display_name: 'Google Gemini 4 Argon',
    description: 'Complex tasks — next-generation frontier intelligence',
    mode_id: '95a4c0abcba24364',
    header_template: `[1,null,null,null,"%s",null,null,null,[4,5,6,8,16,19,20],null,null,null,null,null,8,1,null,null,null,null]`,
    min_tier: 'free',
    aliases: ['4-argon', 'gemini-argon', 'argon', 'gemini-4', '4', 'f44d2958d1f0189a'],
    capabilities: ['chat', 'stream', 'vision', 'tools', 'complex_tasks', 'frontier'],
    is_default: false,
    source: 'builtin',
  },
  {
    id: 'gemini-4-argon-thinking-high',
    display_name: 'Google Gemini 4 Argon (Thinking High)',
    description: 'Complex tasks with extra thorough thinking depth (High=2)',
    mode_id: '95a4c0abcba24364',
    header_template: `[1,null,null,null,"%s",null,null,null,[4,5,6,8,16,19,20],null,null,null,null,null,8,%d,null,null,null,null]`,
    thinking_level: 2,
    min_tier: 'free',
    aliases: ['argon-thinking-high', 'argon-high', 'thinking-high'],
    capabilities: ['chat', 'stream', 'thinking', 'math', 'code', 'complex_tasks'],
    is_default: false,
    source: 'builtin',
  },
  {
    id: 'gemini-4-argon-thinking-medium',
    display_name: 'Google Gemini 4 Argon (Thinking Medium)',
    description: 'Complex tasks with balanced thinking depth (Medium=4)',
    mode_id: '95a4c0abcba24364',
    header_template: `[1,null,null,null,"%s",null,null,null,[4,5,6,8,16,19,20],null,null,null,null,null,8,%d,null,null,null,null]`,
    thinking_level: 4,
    min_tier: 'free',
    aliases: ['argon-thinking-medium', 'argon-medium', 'thinking-medium'],
    capabilities: ['chat', 'stream', 'thinking', 'math', 'code', 'complex_tasks'],
    is_default: false,
    source: 'builtin',
  },
  {
    id: 'gemini-3.1-pro',
    display_name: 'Google Gemini 3.1 Pro',
    description: 'Advanced reasoning — complex coding and multi-turn problem solving',
    mode_id: 'e6fa609c3fa255c0',
    header_template: `[1,null,null,null,"%s",null,null,0,[4],null,null,2]`,
    min_tier: 'subscription',
    aliases: ['3.1-pro', 'gemini-pro', 'pro', 'gemini-3.0-pro', 'gemini-2.5-pro', 'advanced', '61530e79959ab139'],
    capabilities: ['chat', 'stream', 'vision', 'tools', 'complex_reasoning'],
    is_default: false,
    source: 'builtin',
  },
];

export class ModelRegistry {
  private static instance: ModelRegistry;
  private models: Map<string, ModelConfig> = new Map();

  constructor() {
    for (const m of defaultGeminiWebModels) {
      this.register(m);
    }
  }

  public static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry();
    }
    return ModelRegistry.instance;
  }

  public register(model: ModelConfig): void {
    this.models.set(model.id, model);
    if (model.aliases) {
      for (const a of model.aliases) {
        this.models.set(a, model);
      }
    }
  }

  public resolve(modelName?: string): ModelConfig {
    if (!modelName || modelName === 'default' || modelName.toLowerCase() === 'auto') {
      return this.models.get('gemini-3.8-flash') || defaultGeminiWebModels[0];
    }
    const clean = modelName.trim().toLowerCase();
    const hit = this.models.get(clean);
    if (hit) return hit;

    for (const m of this.models.values()) {
      if (m.id.toLowerCase() === clean || m.display_name.toLowerCase() === clean) {
        return m;
      }
    }

    // Default fallback
    return this.models.get('gemini-3.8-flash') || defaultGeminiWebModels[0];
  }

  public getAll(): ModelConfig[] {
    const set = new Set<ModelConfig>();
    for (const m of this.models.values()) {
      set.add(m);
    }
    return Array.from(set);
  }
}
