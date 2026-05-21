---
name: codenator-coordinator-rails
description: Process rails for Auralis Codenator coordinator cycles. Use before and during Codenator coordinator wave planning, multi-slot dispatch, agent spec preparation, autonomous "до упора" work, report verification, reviewer/audit passes, integration batches, summary pauses, or when balancing coordinator autonomy with Codex session health.
---

# Codenator Coordinator Rails

Use this skill as a gate sequence for coordinator work. It is not a report
template. It exists to prevent chaotic task creation, human transport, and
overgrown Codex sessions.

## Operating Contract

- Plan a cycle before dispatching work.
- Treat the summary-pause threshold as a guard, not a target.
- Continue autonomously while the plan is alive and no stop condition is hit.
- Preserve Ton's attention: ask only at real decision points.
- Preserve session health: write durable state before the coordinator thread
  becomes too heavy.
- Keep final responsibility with the coordinator even when helper agents write
  specs or review results.

## Phase Gates

### 1. Preflight Gate

Before any wave, check:

- Codenator status, Focus Board, coordinator inbox, and summary-pause state.
- Repo status and current heads for every touched checkout.
- Slot health: heartbeat fresh, idle, unread 0, no unintegrated report.
- Existing roadmap, handoff, and plan files relevant to the cycle.

Do not assign implementation work when:

- `plan_wake.decision` is `PAUSE`;
- summary pause is due;
- coordinator inbox has unverified reports;
- chosen slots are stale, active, unread, blocked, or missing tool access;
- the next architectural direction is not named.

### 2. Cycle Plan Gate

Create or refresh a coordinator plan before dispatch. Include:

- objective for this cycle;
- tasks/waves and intended slot ownership;
- dependency and integration order;
- required specs;
- acceptance criteria and focused tests;
- explicit non-live boundaries;
- stop conditions;
- session-health budget.

Default stop conditions:

- summary pause due;
- tests fail or integration conflicts;
- unplanned architecture fork appears;
- live daemon, production storage, Discord, user data, or destructive repo work
  becomes necessary;
- no healthy slots remain;
- Ton says pause, sleep, or stop;
- coordinator session gets heavy enough that a durable handoff is safer than
  continuing in the same thread.

### 3. Spec Gate

Every implementation task needs a usable spec. A usable spec names:

- owned files or allowed path boundary;
- behavior to add or change;
- acceptance criteria;
- required tests/checks;
- forbidden boundaries;
- expected report format.

For small tasks, the coordinator may write the spec inside the task message.

For larger cycles, create a `Spec Writer` helper task first. The spec writer
should produce or update the relevant docs/spec files and stop. Do not let the
spec writer also implement the feature unless the coordinator explicitly
changes the plan.

### 4. Dispatch Gate

Assign only when all are true:

- plan exists;
- task has a spec;
- slot is healthy, idle, unread 0;
- slot has a registered worktree and branch;
- task scope matches the slot lane;
- no unintegrated report is waiting from that slot.

Do not create tasks merely to fill the summary-pause counter. Work follows the
cycle plan, not the counter.

### 5. Verification Gate

Never trust `report_commit` alone.

For each report:

1. Verify the source worktree status and reported commit.
2. Run focused tests/checks in the source worktree.
3. Integrate in the planned order.
4. Run the focused checks again in `main`.
5. Run any cross-slice regression needed by the touched surface.
6. Only then mark the task `integrated` and clear the coordinator inbox item.

### 6. Reviewer Gate

Use a separate `Wave Reviewer` helper when the cycle is cross-repo, touches a
shared contract, or integrates more than a few tasks.

The reviewer checks:

- roadmap fit;
- task/spec compliance;
- non-live boundary compliance;
- missing tests or receipts;
- integration-order risks;
- user-visible or downstream contract drift.

The reviewer reports findings to the coordinator. The coordinator still owns
the final integration decision.

### 7. Compaction Gate

Do not wait for Codex Desktop to crash.

Use a durable pause when any of these are true:

- summary pause is due;
- the coordinator has run a long integration stretch;
- the action stream or context is getting heavy;
- the next step needs a new strategic cycle;
- Ton is going to sleep or explicitly wants a clean handoff.

A durable pause must record:

- what was planned;
- what was dispatched;
- what was verified and integrated;
- current repo states;
- Codenator inbox/task/summary-pause state;
- next safe action and boundaries.

If Ton already gave a broad green light and the plan remains alive, the pause is
for state preservation, not permission-seeking.

## Helper Roles

### Spec Writer

Use when specs are missing or thin. Assign a docs/spec task. Require source
references, task boundaries, acceptance criteria, and tests. No implementation
unless explicitly authorized.

### Wave Reviewer

Use after implementation and before or after integration for large cycles. The
reviewer audits compliance with roadmap, plan, specs, tests, and boundaries.
Findings come first; compliments are unnecessary.

## Final Rule

For Codenator coordinator work:

```text
plan -> specs -> dispatch -> verify -> integrate -> review -> crystallize
```

Autonomy means continuing through this loop without making Ton the messenger.
Discipline means stopping at real guardrails before the session or architecture
breaks.
