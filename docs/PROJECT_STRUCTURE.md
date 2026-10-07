# Project File & Directory Structure

```text
e:\CODE\SeniorEngineer\
├── README.md                      # Project overview and quick start
├── docs/                          # Architecture & design specifications
│   ├── ARCHITECTURE.md            # High-level architecture & dual-mode design
│   ├── SPECIFICATIONS.md          # Functional & technical specifications
│   ├── JULES_SUPERVISOR_ENGINE.md # Jules API & background supervisor details
│   ├── PROJECT_STRUCTURE.md       # Directory layout (this file)
│   └── ROADMAP.md                 # Development phases & milestones
│
├── package.json                   # Dependencies, electron build scripts
├── tsconfig.json                  # Root TypeScript configuration
├── tsconfig.node.json             # TypeScript config for Electron Main
├── vite.config.ts                 # Vite bundler configuration for React
│
├── src/
│   ├── main/                      # Electron Main Process (Node.js Environment)
│   │   ├── index.ts               # App entrypoint, window creation, lifecycle
│   │   ├── ipc/                   # IPC Handlers (Renderer <-> Main)
│   │   │   ├── chat-ipc.ts        # Chat streaming and message handling
│   │   │   ├── workspace-ipc.ts   # File picker, project tree
│   │   │   ├── settings-ipc.ts    # Settings, model endpoints, API keys
│   │   │   └── jules-ipc.ts       # Jules mission control IPC channels
│   │   │
│   │   ├── agent/                 # Autonomous Agent Core
│   │   │   ├── orchestrator.ts    # Multi-turn autonomous ReAct loop
│   │   │   ├── state-machine.ts   # Mode switcher (Standard vs Jules Senior Lead)
│   │   │   ├── system-prompts.ts  # System prompts per mode
│   │   │   └── memory.ts          # Session history & .ai/ memory sync
│   │   │
│   │   ├── tools/                 # Execution Tools
│   │   │   ├── index.ts           # Tool registry and schema generator
│   │   │   ├── standard/          # Tools available in Standard Mode
│   │   │   │   ├── file-read.ts
│   │   │   │   ├── file-write.ts
│   │   │   │   ├── file-edit.ts
│   │   │   │   ├── terminal-exec.ts
│   │   │   │   └── code-search.ts
│   │   │   └── jules/             # Tools available in Jules Mode
│   │   │       ├── delegate.ts
│   │   │       ├── answer-question.ts
│   │   │       ├── inspect-diff.ts
│   │   │       └── merge-verify.ts
│   │   │
│   │   ├── services/              # Core Services
│   │   │   ├── llm/               # LLM Provider Gateway
│   │   │   │   ├── client.ts      # OpenAI-compatible streaming client
│   │   │   │   ├── freellm.ts     # FreeLLM token & proxy connector
│   │   │   │   └── auto-router.ts # Smart model router
│   │   │   ├── jules/             # Jules Native Bridge
│   │   │   │   ├── client.ts      # REST API v1alpha wrapper
│   │   │   │   ├── poller.ts      # Background daemon poller
│   │   │   │   ├── git-runner.ts  # Branch, patch, diff, and merge operations
│   │   │   │   └── loop-daemon.ts # Continuous audit loop engine
│   │   │   └── db/                # Local SQLite Storage
│   │   │       ├── database.ts    # SQLite instance setup
│   │   │       └── repository.ts  # Queries for sessions, chats, settings
│   │   │
│   │   └── preload.ts             # Preload Script (ContextBridge isolation)
│   │
│   └── renderer/                  # Electron Renderer Process (React 19 UI)
│       ├── index.html             # HTML shell
│       ├── main.tsx               # React root mount
│       ├── App.tsx                # Main application layout
│       ├── styles/
│       │   └── globals.css        # Tailwind styles & theme variables
│       ├── components/
│       │   ├── layout/
│       │   │   ├── Header.tsx     # Mode toggle, model selector, project status
│       │   │   ├── Sidebar.tsx    # Project switcher, chat session list
│       │   │   └── JulesPanel.tsx # Right sidebar: Live Jules Mission Control
│       │   ├── chat/
│       │   │   ├── ChatStream.tsx # Message list with tool-call accordion
│       │   │   ├── ChatInput.tsx  # Message input with attachments & mode badge
│       │   │   └── ToolCard.tsx   # Visual tool execution card (stdout, diff)
│       │   ├── jules/
│       │   │   ├── SessionCard.tsx    # Active session progress card
│       │   │   ├── ActivityFeed.tsx   # Live stream of Jules worker actions
│       │   │   ├── DiffViewer.tsx     # Monaco diff preview before merge
│       │   │   └── AuditLoopView.tsx  # Domain audit loop progress tracker
│       │   └── settings/
│       │       └── SettingsModal.tsx  # Base URL, API key, FreeLLM configuration
│       └── hooks/
│           ├── useAgentChat.ts    # Hook for chat state & streaming
│           ├── useJulesMonitor.ts # Hook for live Jules session telemetry
│           └── useSettings.ts     # Hook for app preferences
```
