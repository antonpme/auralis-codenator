# auralis-codextrator

Parallel session orchestration for Codex Desktop.

`auralis-codextrator` is a small local utility for coordinating multiple
focused Codex Desktop sessions across projects, worktrees, inboxes, hooks, and
commit reports.

It is intentionally not an agent identity system. A session slot such as
`session-01` is only a technical focus slot. Identity, project, focus, worktree,
and branch live in the registry metadata.

## MVP Features

- Local registry of focus sessions.
- Per-session inboxes.
- Lightweight direct messages.
- Durable task records.
- Slot registry view with current task and heartbeat state.
- Structured message ledger.
- Heartbeat health records and recovery summary.
- Commit reports.
- Status view with unread counts.
- Codex hook entrypoint for post-tool commit detection.
- No cloud dependency.
- No runtime dependency beyond Node.js.

## Quick Start

Initialize a shared store:

```powershell
node .\bin\codextrator.js init --root C:\workspace
```

Register a session slot:

```powershell
node .\bin\codextrator.js register session-01 `
  --project demo-project `
  --identity developer `
  --focus "Feature A" `
  --worktree C:\workspace\demo-project-feature-a `
  --branch feature/demo-a
```

Send a message:

```powershell
node .\bin\codextrator.js send coordinator `
  --from session-01 `
  --subject "Feature A ready" `
  --message "Committed the first draft for review."
```

Read inbox:

```powershell
node .\bin\codextrator.js inbox coordinator
```

Assign a structured task:

```powershell
node .\bin\codextrator.js task-create session-01 `
  --task-id session-01-round-1 `
  --title "Round 1: focused slice" `
  --message "Work only in the assigned files, test, commit, and report."
```

List tasks and slots:

```powershell
node .\bin\codextrator.js task-list
node .\bin\codextrator.js slots
```

Import already-queued inbox messages into task records without sending
duplicates:

```powershell
node .\bin\codextrator.js task-import-inbox session-01
```

Record heartbeat health:

```powershell
node .\bin\codextrator.js heartbeat session-01 `
  --status ok `
  --automation-id auralis-codextrator-session-01
```

Show recovery recommendations:

```powershell
node .\bin\codextrator.js recovery
```

Show status:

```powershell
node .\bin\codextrator.js status
```

Submit a commit report from the current worktree:

```powershell
node C:\tools\auralis-codextrator\bin\codextrator.js report-commit
```

## Codex Hooks

Codex hooks can call deterministic commands on lifecycle events. The MVP
provides a `hook-post-tool-use` entrypoint that inspects hook input and submits a
commit report when it sees a git commit command.

Print a hook template:

```powershell
node .\bin\codextrator.js hook-template
```

Then place the output in a workspace `.codex/hooks.json`, or adapt it to your
global Codex config.

## Store Layout

```text
.auralis-codextrator/
  registry.json
  inbox/
    coordinator/
    session-01/
  archive/
  heartbeat/
  messages/
  reports/
  tasks/
  hooks/
```

## Design Notes

- Keep session slots generic: `session-01`, `session-02`, etc.
- Use registry metadata for project/focus/worktree/branch.
- Keep identity separate from focus.
- Use hooks for automatic reports, not for hidden work.
- Treat inbox messages as wake/notification surfaces; task records are the
  durable work state.
- Treat heartbeat health as operational state; a failed or stale heartbeat
  means the slot thread may need a fresh Desktop session.
- MCP can wrap this same store later.
