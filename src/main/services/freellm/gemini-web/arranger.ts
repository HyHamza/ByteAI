export interface ArrangedOutput {
  cleanText: string;
  reasoningContent?: string;
  isToolCall: boolean;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  finishReason: string;
}

export function formatToolsInstruction(tools?: Array<Record<string, any>>): string {
  if (!tools || tools.length === 0) {
    return '';
  }

  const toolsJSON = JSON.stringify(tools, null, 2);

  return (
    '\n[AVAILABLE TOOLS]\n' +
    'You have access to the following tools that you can invoke:\n' +
    '```json\n' +
    toolsJSON +
    '\n```\n\n' +
    '[TOOL CALL INSTRUCTIONS]\n' +
    '1. If you need to call a tool to answer the user\'s request, reply ONLY with one or more `<tool_call>` blocks in this exact format:\n' +
    '<tool_call>\n' +
    '{"name": "<tool_name>", "arguments": {<json_arguments>}}\n' +
    '</tool_call>\n' +
    '2. You can invoke multiple tools by outputting multiple `<tool_call>` blocks consecutively.\n' +
    '3. Ensure the "arguments" object strictly follows the schema parameters (types, names, requirements).\n' +
    '4. If no tool is needed, or after receiving tool results, respond directly in natural language without any `<tool_call>` tags.\n' +
    '5. Do not invent tools that are not in the list.\n\n'
  );
}

const thoughtRegex = /<(?:thought|thinking)>([\s\S]*?)<\/(?:thought|thinking)>/gi;
const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
const codeFenceWithQueryRegex = /^```([a-zA-Z0-9_-]+)\?[^\n]*$/gm;
const multiNewlineRegex = /\n{3,}/g;

export function sanitizeGeminiContent(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/\0/g, '');
  cleaned = cleaned.replace(codeFenceWithQueryRegex, '```$1');
  cleaned = cleaned.replace(multiNewlineRegex, '\n\n');
  return cleaned.trim();
}

export function parseSingleToolCall(payload: string): { toolCall: any; ok: boolean } {
  let clean = payload.trim();
  clean = clean.replace(/^```(?:json)?/i, '');
  clean = clean.replace(/```$/i, '');
  clean = clean.trim();

  let obj: any;
  try {
    obj = JSON.parse(clean);
  } catch (_) {
    return {
      toolCall: { id: '', type: 'function', function: { name: '', arguments: '{}' } },
      ok: false,
    };
  }

  if (!obj || typeof obj !== 'object') {
    return {
      toolCall: { id: '', type: 'function', function: { name: '', arguments: '{}' } },
      ok: false,
    };
  }

  const name = obj.name || obj.tool || obj.function;
  if (!name || typeof name !== 'string') {
    return {
      toolCall: { id: '', type: 'function', function: { name: '', arguments: '{}' } },
      ok: false,
    };
  }

  let argsStr = '{}';
  if (obj.arguments !== undefined) {
    if (typeof obj.arguments === 'string') {
      argsStr = obj.arguments;
    } else {
      try {
        argsStr = JSON.stringify(obj.arguments);
      } catch (_) {
        argsStr = '{}';
      }
    }
  } else if (obj.parameters !== undefined) {
    if (typeof obj.parameters === 'string') {
      argsStr = obj.parameters;
    } else {
      try {
        argsStr = JSON.stringify(obj.parameters);
      } catch (_) {
        argsStr = '{}';
      }
    }
  }

  const id = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  return {
    toolCall: {
      id,
      type: 'function',
      function: {
        name,
        arguments: argsStr,
      },
    },
    ok: true,
  };
}

export function arrangeGeminiOutput(rawText: string): ArrangedOutput {
  let text = sanitizeGeminiContent(rawText);
  let reasoningContent = '';

  // Extract <thought> / <thinking> tags
  text = text.replace(thoughtRegex, (_, reasoning) => {
    if (reasoning && reasoning.trim()) {
      reasoningContent += (reasoningContent ? '\n\n' : '') + reasoning.trim();
    }
    return '';
  });

  const toolCalls: any[] = [];
  const toolCallMatches = [...text.matchAll(toolCallRegex)];

  if (toolCallMatches.length > 0) {
    for (const match of toolCallMatches) {
      const parsed = parseSingleToolCall(match[1]);
      if (parsed.ok) {
        toolCalls.push(parsed.toolCall);
      }
    }
    // Remove <tool_call> tags from text
    text = text.replace(toolCallRegex, '').trim();
  }

  const isToolCall = toolCalls.length > 0;
  return {
    cleanText: text,
    reasoningContent: reasoningContent || undefined,
    isToolCall,
    toolCalls: isToolCall ? toolCalls : undefined,
    finishReason: isToolCall ? 'tool_calls' : 'stop',
  };
}
