# Aurona Code 0.4.12 Agent Workbench

Aurona Code 0.4.12 uses a task event model for the local Agent. A session is rebuilt from ordered `AgentEvent` records instead of a chat message list. Events cover task lifecycle, model steps, tool execution, approvals, checkpoints, artifacts, steering, and aborts.

The sidebar is the compact Agent cockpit. It shows the active task, model and permission state, the step timeline, tool progress, approval status, errors, and checkpoints. The panel can expand into a wider workbench without changing the session store.

The only active model transport is the Responses API. Rust emits normalized Responses SSE events through `ai://responses-event`; the frontend owns the reducer and tool loop. Profiles using the previous chat protocol must be migrated or reconfigured.

Before a write tool runs, the Agent captures affected file contents and fingerprints together with the active AuronaEngine view state. Restore checks all fingerprints first and refuses to overwrite externally changed files. Approval promises are cancelled when a task is stopped or its session is switched.

Editor view state is retained by file path: source or Markdown preview mode, cursor, selection, scroll offsets, and folded lines. Only the active AuronaEngine is bound to `EditorAdapter`, so Agent context and editor commands target the visible document.

This release keeps the single local Agent scope. Parallel agents, worktrees, cloud execution, Git commit orchestration, and Marketplace upgrades remain outside the 0.4.12 release gate.
