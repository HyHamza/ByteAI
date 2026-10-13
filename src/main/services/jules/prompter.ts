import fs from 'fs';
import path from 'path';

export interface TechStackInfo {
  role: string;
  stack: string;
  frameworks: string[];
}

/**
 * Detect the primary tech stack and specialized senior engineering role for the workspace
 */
export function detectTechStack(workspaceDir: string): TechStackInfo {
  try {
    if (!workspaceDir || !fs.existsSync(workspaceDir)) {
      return {
        role: 'Senior Staff Software Engineer & Solutions Architect',
        stack: 'Full-Stack Software Architecture',
        frameworks: [],
      };
    }

    // 1. Check package.json (Node/JS/TS/Electron/React/Next)
    const pkgPath = path.join(workspaceDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const hasElectron = Boolean(deps['electron'] || deps['electron-builder'] || deps['vite-plugin-electron']);
        const hasReact = Boolean(deps['react'] || deps['react-dom']);
        const hasNext = Boolean(deps['next']);
        const hasVue = Boolean(deps['vue']);
        const hasTailwind = Boolean(deps['tailwindcss']);
        const hasNest = Boolean(deps['@nestjs/core']);
        const hasExpress = Boolean(deps['express'] || deps['fastify']);

        const frameworks: string[] = [];
        if (hasElectron) frameworks.push('Electron');
        if (hasReact) frameworks.push('React');
        if (hasNext) frameworks.push('Next.js');
        if (hasVue) frameworks.push('Vue');
        if (hasTailwind) frameworks.push('Tailwind CSS');
        if (deps['typescript']) frameworks.push('TypeScript');

        if (hasElectron && hasReact) {
          return {
            role: 'Senior Electron & React Desktop Software Architect',
            stack: 'Electron + React + TypeScript Desktop Application',
            frameworks,
          };
        }

        if (hasElectron) {
          return {
            role: 'Senior Electron Desktop Software Architect',
            stack: 'Electron + Node.js Desktop Application',
            frameworks,
          };
        }

        if (hasNext) {
          return {
            role: 'Senior Next.js & React Full-Stack Engineer',
            stack: 'Next.js + React + TypeScript Web Application',
            frameworks,
          };
        }

        if (hasReact) {
          return {
            role: 'Senior React & Frontend Architect',
            stack: 'React + TypeScript Web Application',
            frameworks,
          };
        }

        if (hasNest || hasExpress) {
          return {
            role: 'Senior Node.js & TypeScript Backend Architect',
            stack: 'Node.js Backend Microservice',
            frameworks,
          };
        }

        return {
          role: 'Senior Full-Stack TypeScript/JavaScript Engineer',
          stack: 'Node.js / TypeScript Environment',
          frameworks,
        };
      } catch (_) {}
    }

    // 2. Check Flutter / Dart (pubspec.yaml)
    if (fs.existsSync(path.join(workspaceDir, 'pubspec.yaml'))) {
      return {
        role: 'Senior Flutter & Dart Mobile Architect',
        stack: 'Flutter & Dart Cross-Platform Mobile Application',
        frameworks: ['Flutter', 'Dart'],
      };
    }

    // 3. Check Rust (Cargo.toml)
    if (fs.existsSync(path.join(workspaceDir, 'Cargo.toml'))) {
      return {
        role: 'Senior Rust Systems Software Engineer',
        stack: 'Rust Systems Application',
        frameworks: ['Rust', 'Cargo'],
      };
    }

    // 4. Check Go (go.mod)
    if (fs.existsSync(path.join(workspaceDir, 'go.mod'))) {
      return {
        role: 'Senior Go Backend & Distributed Systems Architect',
        stack: 'Go Backend Service',
        frameworks: ['Go'],
      };
    }

    // 5. Check Python (pyproject.toml, requirements.txt)
    if (
      fs.existsSync(path.join(workspaceDir, 'pyproject.toml')) ||
      fs.existsSync(path.join(workspaceDir, 'requirements.txt')) ||
      fs.existsSync(path.join(workspaceDir, 'Pipfile'))
    ) {
      return {
        role: 'Senior Python Systems & Backend Engineer',
        stack: 'Python Application Environment',
        frameworks: ['Python'],
      };
    }
  } catch (_) {}

  return {
    role: 'Senior Staff Software Engineer & Solutions Architect',
    stack: 'Full-Stack Software Architecture',
    frameworks: [],
  };
}

/**
 * Remove conversational rambling, introspective thinking, and stream-of-consciousness filler
 * that an LLM might mistakenly prefix when delegating to Jules.
 */
export function cleanConversationalFiller(text: string): string {
  if (!text) return '';

  let cleaned = text.trim();

  // Strip common conversational intros where the AI talks to itself or talks to the user
  const conversationalPrefixes = [
    /^(?:so\s+)?(?:let\s+me|i\s+need\s+to|i\s+will|i'm\s+going\s+to|i\s+am\s+going\s+to)\s+(?:start\s+)?(?:loading|reading|checking|analyzing|inspecting|fixing)\s+(?:the\s+)?(?:codebase|files|repo|code|project)[^.\n]*[.\n]+\s*/i,
    /^(?:i\s+need\s+to\s+fix\s+this\s+issue,?\s*(?:so\s+)?let\s+me\s+start\s+loading\s+the\s+codebase[^.\n]*[.\n]+\s*)/i,
    /^(?:in\s+this\s+turn,?\s*)?(?:i\s+will|let's|let\s+us|i'm\s+going\s+to)\s+(?:now\s+)?(?:instruct|tell|ask)\s+jules\s+to\s+[^.\n]*[.\n]+\s*/i,
    /^(?:hi|hello|hey)\s+jules,?\s*(?:can\s+you\s+please|please)?\s*/i,
    /^(?:can\s+you\s+please|please)\s+(?:help\s+me\s+)?(?:fix|implement|update|check)\s+[^.\n]*[.\n]+\s*/i,
    /^(?:here\s+is\s+the\s+task\s+for\s+jules:?\s*)/i,
    /^(?:task\s+for\s+jules:?\s*)/i,
    /^(?:i\s+have\s+analyzed\s+the\s+issue\s+and\s+now\s+dispatching\s+to\s+jules:?\s*)/i,
  ];

  for (const regex of conversationalPrefixes) {
    cleaned = cleaned.replace(regex, '').trim();
  }

  // Remove leading phrases like "So, ", "Alright, ", "Now, " if left at the beginning
  cleaned = cleaned.replace(/^(?:so,?\s+|alright,?\s+|now,?\s+|okay,?\s+)/i, '');

  return cleaned.trim();
}

/**
 * Format a prompt for Jules into an elite, highly professional Senior Staff Engineer specification.
 * Injects tech stack role, clean technical requirements, and multi-issue branching safeguards.
 */
export function formatJulesPrompt(
  rawPrompt: string,
  workspaceDir: string,
  options?: {
    isMultiIssue?: boolean;
    issueNumber?: number;
    totalIssues?: number;
    feedbackContext?: string;
  }
): string {
  const cleanedText = cleanConversationalFiller(rawPrompt);
  const techInfo = detectTechStack(workspaceDir);

  // Detect if this prompt or raw text refers to a multi-issue sequence
  const isMultiIssue = Boolean(
    options?.isMultiIssue ||
    (options?.totalIssues && options.totalIssues > 1) ||
    /issue\s+\d+\s+of\s+\d+/i.test(cleanedText) ||
    /step\s+\d+\s+of\s+\d+/i.test(cleanedText) ||
    /multi-issue/i.test(cleanedText) ||
    /\b(?:issue\s+1|first\s+issue)\b/i.test(cleanedText)
  );

  // Check if prompt is already thoroughly formatted with markdown headers
  const hasStructuredHeaders = 
    /##\s+(?:ROLE|OBJECTIVE|SPECIFICATION|REQUIREMENTS)/i.test(cleanedText);

  if (hasStructuredHeaders) {
    // If already structured, ensure multi-issue directive is present if applicable
    if (isMultiIssue && !cleanedText.includes('Do NOT finalize or create a new branch')) {
      const directive = `\n\n> **CRITICAL WORKFLOW DIRECTIVE (MULTI-ISSUE TASK)**:\n> This is part of a multi-issue task. Do NOT finalize or create a new separate branch or mark the PR complete upon completing this issue. Stay within this working branch and commit your changes for this issue cleanly. We will continue this session for subsequent issues before final branch completion.`;
      return `${cleanedText}${directive}`;
    }
    return cleanedText;
  }

  // Extract a clean 1-line objective
  const firstSentenceMatch = cleanedText.match(/^([^\n.]+)[.\n]/);
  const objective = firstSentenceMatch ? firstSentenceMatch[1].trim() : cleanedText.slice(0, 120);

  const lines: string[] = [];

  // Header 1: Role & Objective
  lines.push(`## ROLE & OBJECTIVE`);
  lines.push(`- **Role**: ${techInfo.role}`);
  lines.push(`- **Objective**: ${objective}`);
  lines.push('');

  // Header 2: Tech Stack & Context
  lines.push(`## CONTEXT & TECH STACK`);
  lines.push(`- **Environment**: ${techInfo.stack}`);
  if (techInfo.frameworks.length > 0) {
    lines.push(`- **Core Technologies**: ${techInfo.frameworks.join(', ')}`);
  }
  lines.push('');

  // Header 3: Feedback Context (if user gave review/feedback on previous attempt)
  if (options?.feedbackContext) {
    lines.push(`## PREVIOUS TURN REVIEW & CORRECTIVE FEEDBACK`);
    lines.push(options.feedbackContext.trim());
    lines.push('');
  }

  // Header 4: Detailed Implementation Specification
  lines.push(`## TECHNICAL SPECIFICATION & REQUIREMENTS`);
  lines.push(cleanedText);
  lines.push('');

  // Header 5: Workflow & Branching Directives
  lines.push(`## WORKFLOW & BRANCHING DIRECTIVES`);
  if (isMultiIssue) {
    lines.push(`> **CRITICAL DIRECTIVE (MULTI-ISSUE TASK)**:`);
    lines.push(`> This is part of a multi-issue task${options?.issueNumber && options?.totalIssues ? ` (Issue ${options.issueNumber} of ${options.totalIssues})` : ''}.`);
    lines.push(`> Do NOT finalize or create a new branch or mark the PR complete upon finishing this issue.`);
    lines.push(`> Keep working within this branch and commit changes cleanly for this issue only.`);
    lines.push(`> We will continue this session for subsequent issues sequentially.`);
  } else {
    lines.push(`- Implement the requested changes with minimal, clean git commits.`);
    lines.push(`- Ensure all modifications are fully self-contained.`);
  }
  lines.push('');

  // Header 6: Quality & Verification Criteria
  lines.push(`## QUALITY & VERIFICATION CRITERIA`);
  lines.push(`- Run compilation, typecheck, or tests where applicable to ensure zero syntax or runtime regressions.`);
  lines.push(`- Preserve existing codebase conventions, architecture, and styling.`);
  lines.push(`- Handle potential edge cases and null/undefined references robustly.`);

  return lines.join('\n');
}
