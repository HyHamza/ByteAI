# SeniorEngineer System Architecture

## 1. High-Level Architecture Overview

SeniorEngineer is built on an **Electron Desktop Architecture** separating the **Renderer Process (UI)**, the **Preload Bridge (Secure IPC)**, and the **Main Process (Agent Runtime & Native Core)**.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            RENDERER PROCESS (UI)                            │
│  React 19 + Tailwind CSS + Lucide + Monaco Diff Viewer                      │
│                                                                             │
│  ┌───────────────┐ ┌─────────────────────────┐ ┌──────────────────────────┐ │
│  │ Workspace Nav │ │ Chat Stream & Execution │ │ Jules Mission Control    │ │
│  │ Projects list │ │ • User / AI messages    │ │ • Live task status       │ │
│  │ Session tree  │ │ • Tool call cards       │ │ • Remote VM activities   │ │
│  │ Settings modal│ │ • Senior Engineer notes │ │ • Diff review & approval │ │
│  └───────────────┘ └─────────────────────────┘ └──────────────────────────┘ │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Typed IPC (invoke / handle / on)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                            PRELOAD CONTEXT BRIDGE                           │
│  window.electronAPI: Exposes sanitized, typed methods & event listeners     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                         MAIN PROCESS (AGENT RUNTIME)                        │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     AUTONOMOUS AGENT ORCHESTRATOR                     │  │
│  │  • ReAct autonomous reasoning loop                                    │  │
│  │  • State Machine: Standard Mode ⟷ Jules Supervisor Mode               │  │
│  │  • Multi-Turn Conversation & Project Memory Store (.ai/ + SQLite)     │  │
│  └───────────┬───────────────────────────────────────────────┬───────────┘  │
│              │                                               │              │
│  ┌───────────▼──────────────┐                ┌───────────────▼───────────┐  │
│  │    LOCAL TOOL RUNNER     │                │   JULES SUPERVISOR RUNNER │  │
│  │  • File Read / Write     │                │  • Session Manager        │  │
│  │  • Multi-line edits      │                │  • Native Poller Daemon   │  │
│  │  • Shell / Terminal Exec │                │  • Diff Patch & Merge     │  │
│  │  • Ripgrep / File Search │                │  • Autonomous Audit Loop  │  │
│  └───────────┬──────────────┘                └───────────────┬───────────┘  │
│              │                                               │              │
│  ┌───────────▼───────────────────────────────────────────────▼───────────┐  │
│  │                  UNIVERSAL LLM & PROVIDER GATEWAY                     │  │
│  │  • Custom API Base URL + Key Store                                    │  │
│  │  • FreeLLM Proxy Client / OpenRouter / Ollama / Gemini API            │  │
│  │  • Intelligent Model Auto-Router (Fast routing vs. Deep reasoning)   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Process Separation & Security Boundary

1. **Renderer Process (UI):**
   - Strictly isolated with `contextIsolation: true` and `nodeIntegration: false`.
   - Never directly touches disk, shell, or remote raw APIs.
   - Communicates solely through typed Electron IPC channels (`window.electronAPI`).

2. **Main Process (Node.js & Native Services):**
   - Hosts the autonomous ReAct engine.
   - Manages subprocess execution (`child_process.spawn` for terminal commands and native tools).
   - Manages SQLite persistence and workspace file watchers.
   - Hosts the Jules daemon poller and REST API client.

---

## 3. The Dual-Mode State Machine

The core innovation of SeniorEngineer is the physical separation between standard tool-use and senior delegation:

```text
                  ┌───────────────────────┐
                  │    User Prompt Sent   │
                  └───────────┬───────────┘
                              │
               Is Jules Mode Toggled ON?
                 /                 \
             YES                    NO
             /                        \
┌─────────────────────────┐    ┌──────────────────────────┐
│   JULES SUPERVISOR MODE │    │     STANDARD MODE        │
├─────────────────────────┤    ├──────────────────────────┤
│ System Prompt:          │    │ System Prompt:           │
│ "You are Lead Architect │    │ "You are an autonomous   │
│ & Senior Engineer. You  │    │ software engineer with   │
│ delegate to Jules and   │    │ full access to local     │
│ supervise."             │    │ tools."                  │
│                         │    │                          │
│ Available Tools:        │    │ Available Tools:         │
│ • jules_create_task     │    │ • read_file              │
│ • jules_reply_question  │    │ • write_file             │
│ • jules_review_diff     │    │ • edit_file_content      │
│ • jules_merge_approve   │    │ • run_terminal_command   │
│ • jules_start_loop      │    │ • codebase_search        │
│                         │    │                          │
│ Local code edits:       │    │ Local code edits:        │
│ BLOCKED at schema layer │    │ ALLOWED                  │
└─────────────────────────┘    └──────────────────────────┘
```

### Why This Fixes AI Forgetfulness
In other tools, Jules instructions are merely prompt hints. If the chat context becomes long, the LLM hallucinates timers or directly edits local files.
In SeniorEngineer:
1. **Schema Stripping:** The tools `write_file` and `edit_file_content` are **physically not present** in the OpenAI tool definition sent to the model when Jules Mode is active. The LLM cannot write code locally because the tool does not exist.
2. **Native Daemon Polling:** Monitoring Jules is done by the application's background poller in Node.js, not by an LLM loop. No hallucinated sleep prompts or fake timers.

---

## 4. Event-Driven Wakeup Pipeline (No Polling in Chat)

When the Senior Engineer LLM creates a Jules task:
1. Agent invokes `jules_create_task`.
2. The Main Process launches the session via Jules REST API and initiates a Node.js background poller timer (`setInterval` at 20s).
3. The Chat UI marks the turn as **"Delegated to Jules (Monitoring in background...)"**.
4. The background poller receives updates and emits `jules:activity-update` to the UI to update the right sidebar.
5. When Jules hits an actionable state (`AWAITING_USER_INPUT` or `COMPLETED`):
   - The poller triggers an internal `onSessionNeedsAttention` event.
   - The agent orchestrator injects an internal event prompt to the LLM:
     ```text
     [SYSTEM EVENT] Jules has finished implementation for session {id}.
     PR branch created: jules/fix-auth-123.
     Changeset summary: 4 files modified (+140, -22).
     As Senior Engineer, inspect the diff, run local tests, and decide on approval.
     ```
   - The LLM wakes up, evaluates the diff, runs verification, and responds.
