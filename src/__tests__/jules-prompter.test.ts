import { describe, it, expect } from 'vitest';
import { cleanConversationalFiller, detectTechStack, formatJulesPrompt } from '../main/services/jules/prompter';
import path from 'path';

describe('Jules Prompt Engineering & Sanitizer', () => {
  it('strips conversational filler and self-talk intros', () => {
    const raw = 'I need to fix this issue, so let me start loading the codebase and check the components.\nThe login button is failing on submit because the onClick event is not bound.';
    const cleaned = cleanConversationalFiller(raw);
    expect(cleaned).not.toContain('let me start loading the codebase');
    expect(cleaned).toContain('The login button is failing on submit because the onClick event is not bound.');
  });

  it('strips casual AI greetings and conversational intros', () => {
    const raw = 'Hi Jules, please fix the race condition in auth.service.ts when token expires.';
    const cleaned = cleanConversationalFiller(raw);
    expect(cleaned).not.toContain('Hi Jules');
    expect(cleaned).toContain('fix the race condition in auth.service.ts');
  });

  it('detects tech stack and specialist role from workspace', () => {
    const workspaceDir = path.resolve('.');
    const tech = detectTechStack(workspaceDir);
    expect(tech.role).toContain('Electron');
    expect(tech.frameworks).toContain('React');
  });

  it('formats raw prompt into structured senior engineering markdown', () => {
    const raw = 'I need to fix this issue, so let me start loading the codebase.\nFix the null pointer exception in user profile parser when avatar is missing.';
    const formatted = formatJulesPrompt(raw, path.resolve('.'));
    expect(formatted).toContain('## ROLE & OBJECTIVE');
    expect(formatted).toContain('## CONTEXT & TECH STACK');
    expect(formatted).toContain('## TECHNICAL SPECIFICATION & REQUIREMENTS');
    expect(formatted).toContain('## QUALITY & VERIFICATION CRITERIA');
    expect(formatted).not.toContain('let me start loading the codebase');
  });

  it('enforces multi-issue workflow directive to prevent premature branching', () => {
    const raw = 'Fix Issue 1 of 5: Resolve the sqlite connection timeout in database pool.';
    const formatted = formatJulesPrompt(raw, path.resolve('.'));
    expect(formatted).toContain('CRITICAL DIRECTIVE (MULTI-ISSUE TASK)');
    expect(formatted).toContain('Do NOT finalize or create a new branch');
    expect(formatted).toContain('Keep working within this branch');
  });
});
