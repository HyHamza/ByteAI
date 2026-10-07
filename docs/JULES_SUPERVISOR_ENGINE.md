# Jules Supervisor Engine Integration

## 1. Core Problem Statement

In the current setup (using `jules.js` through in-chat shell commands or prompts):
1. **The Polling Trap:** When the LLM runs `jules monitor <sessionId>`, it blocks or times out. When a timeout occurs, the model tries to emulate waiting by outputting hallucinated timer prompts (e.g., `<schedule>` or asking the user to ping it later).
2. **Context Dilution:** Over several turns, the agent's context window fills up with raw console output. The model forgets its original persona ("Senior Engineer") and starts directly editing local files instead of letting Jules do the work.
3. **Fragile CLI Parsing:** The LLM often misinterprets CLI flags, drops session IDs, or fails to properly resume interrupted sessions.

---

## 2. SeniorEngineer Native Solution

In **SeniorEngineer**, we do not run Jules via fragile in-chat command strings. Instead, the Node.js backend directly integrates the logic from `scripts/jules.js` and `scripts/jules_loop.js`:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        SeniorEngineer Core                             │
├──────────────────────────────────┬─────────────────────────────────────┤
│      Senior Engineer (LLM)       │        Jules Daemon (Node.js)       │
├──────────────────────────────────┼─────────────────────────────────────┤
│ 1. Receives user feature request │                                     │
│ 2. Formulates technical spec     │                                     │
│ 3. Invokes jules_create_task ───►│ 4. Calls Jules REST API v1alpha     │
│                                  │ 5. Session created (ses_4910...)    │
│    [LLM GOES TO SLEEP]           │ 6. Starts non-blocking timer poll   │
│    (No timers in chat!)          │ 7. Streams activity to UI sidebar   │
│                                  │ 8. Detects: AWAITING_USER_INPUT or  │
│                                  │    COMPLETED                        │
│                                  │                                     │
│ 9. Woken up with event payload ◄─┼─────────────────────────────────────┘
│    "Review diff: 4 files"        │
│ 10. Runs test verification       │
│ 11. Invokes jules_approve_merge  │
└──────────────────────────────────┴─────────────────────────────────────┘
```

---

## 3. Jules Module Architecture

### 3.1 Direct Client Service (`src/main/services/jules/client.ts`)
Wraps the Google Labs Jules REST API `https://jules.googleapis.com/v1alpha`:
- `createSession(repo, prompt, options)`
- `getSession(sessionId)`
- `listSessions()`
- `listActivities(sessionId)`
- `sendFollowup(sessionId, prompt)`
- `approvePlan(sessionId)`

### 3.2 Native Polling Manager (`src/main/services/jules/poller.ts`)
- Manages an active registry of in-flight sessions.
- Polls `GET /sessions/{id}` and `GET /sessions/{id}/activities` every 20 seconds.
- Emits events over the internal EventBus (`jules:status_changed`, `jules:activity_logged`, `jules:completed`, `jules:question_asked`).
- Persists session states directly into the local SQLite database so monitoring survives app restarts.

### 3.3 Git & Verification Runner (`src/main/services/jules/git-runner.ts`)
- Automatically fetches Jules remote branches (`jules/task-...`).
- Generates unified diffs for preview in the UI Monaco Diff Viewer.
- Automatically executes project verification commands (`npm test`, `flutter analyze`, etc.).
- Performs safe auto-merges into the target branch.

### 3.4 Autonomous Loop Daemon (`src/main/services/jules/loop-daemon.ts`)
- Integrates the 29 audit domains from `scripts/jules_loop.js` (`AUTH`, `SECURITY`, `PERFORMANCE`, etc.).
- Manages continuous execution cycles without user intervention.
- Updates `.ai/SESSION_STATE.json` and `.ai/FINDINGS.md` to maintain persistent project memory across runs.
