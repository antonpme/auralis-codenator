"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const storeApi = require("../src/store.js");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codextrator-focus-board-"));
const workspaceRoot = path.join(tmpRoot, "workspace");
const processWorktree = path.join(workspaceRoot, "worktrees", "process");
const catalogWorktree = path.join(workspaceRoot, "worktrees", "catalog");

try {
  fs.mkdirSync(processWorktree, { recursive: true });
  fs.mkdirSync(catalogWorktree, { recursive: true });

  const store = storeApi.ensureStore(workspaceRoot, "coordinator");

  storeApi.registerSlot(store, {
    slot: "session-02",
    identity: "elian",
    project: "auralis-os",
    focus: "Process Rails",
    worktree: processWorktree,
    branch: "codex/process"
  });
  storeApi.registerSlot(store, {
    slot: "session-04",
    identity: "elian",
    project: "auralis-os",
    focus: "Catalog",
    worktree: catalogWorktree,
    branch: "codex/catalog"
  });

  const milestone = storeApi.upsertMilestone(store, {
    milestone_id: "m1-foundation",
    title: "Foundation contracts",
    status: "active",
    description: "Prove shared Codextrator board visibility."
  });
  assert.strictEqual(milestone.milestone_id, "m1-foundation");

  storeApi.upsertLane(store, {
    lane_id: "process",
    title: "Process",
    owner_slot: "session-02",
    project: "auralis-os"
  });
  storeApi.upsertLane(store, {
    lane_id: "catalog",
    title: "Catalog",
    owner_slot: "session-04",
    project: "auralis-os"
  });

  const processTask = storeApi.createTask(store, {
    slot: "session-02",
    task_id: "task-process-1",
    title: "Process board contract",
    message: "Implement the Process-owned slice.",
    project: "auralis-os",
    lane_id: "process",
    milestone_id: "m1-foundation",
    acceptance_criteria: ["snapshot lists every lane", "worker sees own assignment"],
    required_receipts: ["focused_tests", "integration_commit"]
  }).task;
  const catalogTask = storeApi.createTask(store, {
    slot: "session-04",
    task_id: "task-catalog-1",
    title: "Catalog board contract",
    message: "Implement the Catalog-owned slice.",
    project: "auralis-os",
    lane_id: "catalog",
    milestone_id: "m1-foundation",
    dependency_ids: ["task-process-1"],
    acceptance_criteria: ["dependency is visible"],
    required_receipts: ["focused_tests"]
  }).task;

  storeApi.updateTask(store, processTask.task_id, {
    status: "integrated",
    commit: "abc123",
    tests: ["node process.test.js"]
  });
  storeApi.updateTask(store, catalogTask.task_id, {
    status: "active"
  });

  const coordinatorSnapshot = storeApi.buildFocusBoardSnapshot(store, {
    viewer_slot: "coordinator"
  });
  assert.strictEqual(coordinatorSnapshot.board.name, "Auralis Codextrator Focus Board");
  assert.strictEqual(coordinatorSnapshot.visibility.role, "coordinator");
  assert.strictEqual(coordinatorSnapshot.visibility.can_manage_backlog, true);
  assert.deepStrictEqual(coordinatorSnapshot.progress.status_counts, {
    integrated: 1,
    active: 1
  });
  assert.strictEqual(coordinatorSnapshot.milestones[0].task_counts.integrated, 1);
  assert.strictEqual(coordinatorSnapshot.milestones[0].task_counts.active, 1);
  assert.strictEqual(coordinatorSnapshot.lanes.find((lane) => lane.lane_id === "process").owner_slot, "session-02");
  assert.strictEqual(coordinatorSnapshot.assignments["session-02"].current_task_status, "integrated");
  assert.ok(coordinatorSnapshot.integration_receipts.some((receipt) => receipt.task_id === "task-process-1" && receipt.commit === "abc123"));

  const workerSnapshot = storeApi.buildFocusBoardSnapshot(store, {
    viewer_slot: "session-04"
  });
  assert.strictEqual(workerSnapshot.visibility.role, "worker");
  assert.strictEqual(workerSnapshot.visibility.can_manage_backlog, false);
  assert.deepStrictEqual(workerSnapshot.visibility.own_task_ids, ["task-catalog-1"]);
  assert.strictEqual(workerSnapshot.tasks.length, 2);
  assert.strictEqual(workerSnapshot.tasks.find((task) => task.task_id === "task-catalog-1").dependencies[0], "task-process-1");
  assert.strictEqual(workerSnapshot.tasks.find((task) => task.task_id === "task-process-1").status, "integrated");

  console.log("codextrator-focus-board.test.js: PASS");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
