# SeniorEngineer 🚀
> **Autonomous AI Coding Assistant & Jules Senior Engineer Orchestrator**  
> Built with **Electron + React + TypeScript + Vite**

SeniorEngineer is a dual-mode autonomous software engineering desktop application designed to solve the two biggest problems in agentic software engineering:
1. **Uninterrupted Autonomy:** A generic AI agent (Antigravity-like) that executes multi-step coding objectives autonomously without prematurely halting or asking repetitive questions.
2. **Dedicated Jules Supervisor (Senior Staff Engineer Mode):** When delegating to Google Jules AI, the agent transitions into a strict Tech Lead supervisor state machine. It delegates tasks to Jules, monitors progress via native background processes (preventing hallucinated timers), answers architectural questions, inspects diffs, runs local test gates, and merges code automatically.

---

## 🏛️ System Modes

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                             SeniorEngineer App                              │
├──────────────────────────────────────┬──────────────────────────────────────┤
│          1. Standard Mode            │            2. Jules Mode             │
│        (Antigravity Engine)          │        (Senior Engineer Lead)        │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ • Full local codebase editing        │ • Local direct code edits disabled   │
│ • Local command execution (terminal) │ • Delegates tasks to Jules AI        │
│ • File reading, diff editing, search │ • Monitors Jules via native runtime  │
│ • Self-healing autonomous loop       │ • Answers Jules questions with specs │
│ • Multi-project & workspace context  │ • Reviews git diffs & runs test gate │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

---

## 📚 Documentation Index

All architectural blueprints, technical specifications, and guides are organized under the [`docs/`](./docs) directory:

1. [**Architecture Blueprint (`docs/ARCHITECTURE.md`)**](./docs/ARCHITECTURE.md)  
   Detailed system architecture, Electron main/preload/renderer boundaries, background service bus, and IPC event contracts.
2. [**Technical Specifications (`docs/SPECIFICATIONS.md`)**](./docs/SPECIFICATIONS.md)  
   Core capabilities, tool definitions (Antigravity tools vs. Jules Manager tools), FreeLLM/OpenAI model gateway, and workspace management.
3. [**Jules Supervisor Engine (`docs/JULES_SUPERVISOR_ENGINE.md`)**](./docs/JULES_SUPERVISOR_ENGINE.md)  
   Detailed breakdown of how `jules.js` and `jules_loop.js` are integrated directly into the Electron process, eliminating prompt amnesia and timer hallucinations.
4. [**Project Structure (`docs/PROJECT_STRUCTURE.md`)**](./docs/PROJECT_STRUCTURE.md)  
   Complete directory tree for Electron, React, Tailwind, and backend modules.
5. [**Development Roadmap (`docs/ROADMAP.md`)**](./docs/ROADMAP.md)  
   Step-by-step phased engineering plan.

---

## 🛠️ Tech Stack

* **Desktop Framework:** Electron 34+
* **Frontend:** React 19, TypeScript, Tailwind CSS, Lucide Icons, Monaco Editor / Diff Viewer
* **Build System:** Vite + `@electron-forge` or `electron-builder`
* **Agent Core:** TypeScript ReAct autonomous loop + Node.js subprocess engine
* **Jules Engine:** Native Node.js wrapper around Google Labs Jules REST API v1alpha (`jules.js` & `jules_loop.js`)
* **Local Database:** SQLite (Better-SQLite3) for workspace sessions, chat memory, and Jules run states
* **LLM Gateway:** Universal OpenAI-compatible client supporting FreeLLM, OpenRouter, Ollama, Gemini, and Auto-Routing
