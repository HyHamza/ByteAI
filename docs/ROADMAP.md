# SeniorEngineer Development Roadmap

## Phase 1: Project Scaffold & Desktop Shell
- [ ] Initialize repository with Electron + React + TypeScript + Tailwind + Vite.
- [ ] Configure `tsconfig`, `vite.config.ts`, and Electron forge/builder setup.
- [ ] Implement secure `preload.ts` context bridge with typed IPC interface.
- [ ] Set up modern dark-mode application shell with three-pane layout:
  - Left: Project Switcher & Chat History
  - Center: Conversational Feed & Tool Execution Cards
  - Right: Collapsible Jules Mission Control Panel
  - Header: Mode Switcher (Standard Mode vs. Jules Mode) & Model Selector

## Phase 2: Local SQLite Persistence & Settings Management
- [ ] Implement local database service using `better-sqlite3`.
- [ ] Store application configuration (API Base URL, Keys, default repo, polling frequency).
- [ ] Store chat sessions, messages, and tool run history per project workspace.
- [ ] Build Settings modal with support for custom endpoints, FreeLLM proxy URLs, and API keys.

## Phase 3: Universal LLM & Autonomous Agent Core
- [ ] Build universal OpenAI-compatible streaming client with tool-calling support.
- [ ] Add auto-discovery of models (`GET /v1/models`) and auto-router logic.
- [ ] Implement autonomous ReAct loop in `src/main/agent/orchestrator.ts`:
  - Receives goal $\rightarrow$ queries model with tools $\rightarrow$ executes tools locally $\rightarrow$ feeds response back.
  - Multi-step execution continues without stopping for trivial questions.
  - Circuit breakers (max turns, repeat detection, destructive command protection).

## Phase 4: Standard Mode Tool Suite (Antigravity Parity)
- [ ] `read_file` with line range slicing.
- [ ] `write_file` (safe creation / overwrite).
- [ ] `edit_file_content` (surgical multi-line text replacement).
- [ ] `run_terminal_command` (streaming PowerShell/Bash subprocess with stdout/stderr).
- [ ] `codebase_search` (Ripgrep integration for fast local search).
- [ ] Render interactive tool cards in the chat UI (showing status, diffs, collapsible stdout).

## Phase 5: Native Jules Supervisor Engine
- [ ] Port logic from `scripts/jules.js` into typed TypeScript service `src/main/services/jules/`:
  - REST client for Google Labs Jules v1alpha.
  - Session creation, status checks, and follow-up messaging.
- [ ] Implement background daemon poller (`poller.ts`) that ticks every 20 seconds:
  - Broadcasts live events to the UI via IPC.
  - Eliminates fake in-chat timer hallucinations completely.
- [ ] Implement Senior Engineer state machine:
  - When Jules Mode is active, remove local edit tools from LLM tool definitions.
  - Give LLM manager tools: `jules_create_task`, `jules_reply_question`, `jules_inspect_diff`, `jules_verify_changes`, `jules_approve_and_merge`.
- [ ] Implement automated wake-up triggers: When Jules completes or asks a question, automatically prompt the Senior Engineer LLM to review and act.

## Phase 6: Continuous Audit Loop & UI Polish
- [ ] Integrate the 29 audit domains from `scripts/jules_loop.js` into the Jules Mission Control UI.
- [ ] Embed Monaco Diff Viewer for side-by-side git inspection before one-click merges.
- [ ] Add diagnostics health check (`doctor`) for Git credentials, Flutter/Node toolchains, and Jules API connectivity.
- [ ] Build production installer executable (`.exe` / portable).
