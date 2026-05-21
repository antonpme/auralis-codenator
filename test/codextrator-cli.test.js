"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const cli = path.join(repoRoot, "bin", "codextrator.js");
const STORE_NAME = ".auralis-codextrator";
const tmpRoot = path.join(repoRoot, ".tmp-test", `run-${Date.now()}`);
const workspaceRoot = path.join(tmpRoot, "workspace");
const worktree = path.join(workspaceRoot, "worktrees", "session-01");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: {
      ...process.env,
      ...(options.env || {})
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runCodextrator(args, options = {}) {
  return run(process.execPath, [cli, ...args], options);
}

function readStatus(cwd = workspaceRoot) {
  return JSON.parse(runCodextrator(["status", "--json"], { cwd }));
}

function sessionRow(status, slot) {
  return status.rows.find((row) => row.slot === slot);
}

function readTasks(cwd = workspaceRoot) {
  return JSON.parse(runCodextrator(["task-list", "--json"], { cwd }));
}

function taskById(tasks, taskId) {
  return tasks.find((task) => task.task_id === taskId);
}

function cleanup() {
  if (!tmpRoot.startsWith(path.join(repoRoot, ".tmp-test"))) {
    throw new Error(`Refusing to clean unexpected path: ${tmpRoot}`);
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

try {
  cleanup();
  fs.mkdirSync(worktree, { recursive: true });

  runCodextrator(["init", "--root", workspaceRoot], { cwd: workspaceRoot });
  runCodextrator([
    "register",
    "session-01",
    "--project",
    "demo-project",
    "--identity",
    "worker-a",
    "--focus",
    "Memory Slice",
    "--worktree",
    worktree,
    "--branch",
    "codex/demo"
  ], { cwd: workspaceRoot });

  let status = readStatus();
  assert.strictEqual(sessionRow(status, "session-01").unread, 0);

  runCodextrator([
    "task-create",
    "session-01",
    "--task-id",
    "task-demo-1",
    "--title",
    "Round 1",
    "--message",
    "Do the focused task."
  ], { cwd: workspaceRoot });

  status = readStatus();
  assert.strictEqual(sessionRow(status, "session-01").unread, 1);
  let tasks = readTasks();
  assert.strictEqual(taskById(tasks, "task-demo-1").status, "queued");

  let slots = JSON.parse(runCodextrator(["slots", "--json"], { cwd: workspaceRoot }));
  let slot = slots.find((row) => row.slot === "session-01");
  assert.strictEqual(slot.current_task_id, "task-demo-1");
  assert.strictEqual(slot.current_task_status, "queued");

  const queuedTaskPath = path.join(workspaceRoot, STORE_NAME, "tasks", "task-demo-1.json");
  const queuedTask = JSON.parse(fs.readFileSync(queuedTaskPath, "utf8"));
  queuedTask.assigned_at = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  fs.writeFileSync(queuedTaskPath, `${JSON.stringify(queuedTask, null, 2)}\n`, "utf8");
  let recovery = JSON.parse(runCodextrator(["recovery", "--json"], { cwd: workspaceRoot }));
  let recoveryRow = recovery.find((row) => row.slot === "session-01");
  assert.strictEqual(recoveryRow.recommendation, "restart_thread");
  assert.strictEqual(recoveryRow.reason, "queued_inbox_no_heartbeat");

  runCodextrator([
    "register",
    "session-01",
    "--project",
    "demo-project",
    "--identity",
    "worker-a",
    "--focus",
    "Memory Slice Restarted",
    "--worktree",
    worktree,
    "--branch",
    "codex/demo"
  ], { cwd: workspaceRoot });
  slots = JSON.parse(runCodextrator(["slots", "--json"], { cwd: workspaceRoot }));
  slot = slots.find((row) => row.slot === "session-01");
  assert.strictEqual(slot.current_task_id, "task-demo-1");
  assert.strictEqual(slot.focus, "Memory Slice Restarted");

  const peeked = JSON.parse(runCodextrator(["inbox", "session-01", "--json", "--peek"], { cwd: workspaceRoot }));
  assert.strictEqual(peeked.length, 1);
  assert.strictEqual(peeked[0].subject, "Round 1");
  assert.strictEqual(peeked[0].type, "task.assign");
  assert.strictEqual(peeked[0].task_id, "task-demo-1");
  status = readStatus();
  assert.strictEqual(sessionRow(status, "session-01").unread, 1);

  const read = JSON.parse(runCodextrator(["inbox", "session-01", "--json"], { cwd: workspaceRoot }));
  assert.strictEqual(read.length, 1);
  status = readStatus();
  assert.strictEqual(sessionRow(status, "session-01").unread, 0);
  tasks = readTasks();
  assert.strictEqual(taskById(tasks, "task-demo-1").status, "active");

  runCodextrator([
    "send",
    "session-01",
    "--from",
    "coordinator",
    "--subject",
    "Follow-up",
    "--type",
    "task.progress",
    "--task-id",
    "task-demo-1",
    "--payload",
    "{\"note\":\"structured\"}",
    "--message",
    "Structured progress ping."
  ], { cwd: workspaceRoot });
  const progress = JSON.parse(runCodextrator(["inbox", "session-01", "--json"], { cwd: workspaceRoot }));
  assert.strictEqual(progress[0].type, "task.progress");
  assert.strictEqual(progress[0].payload.note, "structured");

  run("git", ["init"], { cwd: worktree });
  run("git", ["config", "user.email", "codextrator-test@example.invalid"], { cwd: worktree });
  run("git", ["config", "user.name", "Codenator Test"], { cwd: worktree });
  fs.writeFileSync(path.join(worktree, "README.md"), "# Demo\n", "utf8");
  run("git", ["add", "README.md"], { cwd: worktree });
  run("git", ["commit", "-m", "feat: demo commit"], { cwd: worktree });

  const env = { AURALIS_CODENATOR_ROOT: workspaceRoot };
  const reportOutput = runCodextrator(["report-commit", "--slot", "session-01"], { cwd: worktree, env });
  assert.match(reportOutput, /Reported commit/);
  const sha = run("git", ["rev-parse", "HEAD"], { cwd: worktree }).trim();

  status = readStatus();
  assert.strictEqual(sessionRow(status, "coordinator").unread, 1);
  tasks = readTasks();
  assert.strictEqual(taskById(tasks, "task-demo-1").status, "reported");
  assert.strictEqual(taskById(tasks, "task-demo-1").commit, sha);

  const duplicateOutput = runCodextrator(["report-commit", "--slot", "session-01"], { cwd: worktree, env });
  assert.match(duplicateOutput, /already reported/);
  status = readStatus();
  assert.strictEqual(sessionRow(status, "coordinator").unread, 1);

  const coordinatorInbox = JSON.parse(runCodextrator(["inbox", "coordinator", "--json", "--peek"], { cwd: workspaceRoot }));
  assert.strictEqual(coordinatorInbox.length, 1);
  assert.strictEqual(coordinatorInbox[0].type, "commit_report");
  let watchdog = JSON.parse(runCodextrator([
    "watchdog-check",
    "--json",
    "--snooze-minutes",
    "60"
  ], { cwd: workspaceRoot }));
  assert.strictEqual(watchdog.decision, "NOTIFY");
  assert.ok(watchdog.alerts.some((alert) => alert.type === "coordinator_inbox"));
  watchdog = JSON.parse(runCodextrator([
    "watchdog-check",
    "--json",
    "--snooze-minutes",
    "60"
  ], { cwd: workspaceRoot }));
  assert.strictEqual(watchdog.decision, "DONT_NOTIFY");
  assert.ok(watchdog.suppressed.some((alert) => alert.type === "coordinator_inbox"));

  runCodextrator(["inbox", "coordinator", "--json"], { cwd: workspaceRoot });
  status = readStatus();
  assert.strictEqual(sessionRow(status, "coordinator").unread, 0);

  runCodextrator([
    "heartbeat",
    "session-01",
    "--status",
    "stale",
    "--automation-id",
    "demo-heartbeat",
    "--thread-id",
    "demo-thread",
    "--error",
    "stale path"
  ], { cwd: workspaceRoot });
  recovery = JSON.parse(runCodextrator(["recovery", "--json"], { cwd: workspaceRoot }));
  assert.strictEqual(recovery.find((row) => row.slot === "session-01").recommendation, "restart_thread");

  const fakeCodexHome = path.join(tmpRoot, "codex-home");
  const fakeAutomationDir = path.join(fakeCodexHome, "automations", "demo-heartbeat");
  fs.mkdirSync(fakeAutomationDir, { recursive: true });
  fs.writeFileSync(
    path.join(fakeAutomationDir, "automation.toml"),
    'version = 1\nid = "demo-heartbeat"\ntarget_thread_id = "fresh-thread"\n',
    "utf8"
  );

  runCodextrator([
    "heartbeat",
    "session-01",
    "--status",
    "ok",
    "--automation-id",
    "demo-heartbeat"
  ], {
    cwd: workspaceRoot,
    env: { CODEX_HOME: fakeCodexHome }
  });
  status = readStatus();
  assert.strictEqual(status.registry.sessions["session-01"].thread_id, "fresh-thread");

  runCodextrator(["heartbeat", "session-01", "--status", "ok"], { cwd: workspaceRoot });
  recovery = JSON.parse(runCodextrator(["recovery", "--json"], { cwd: workspaceRoot }));
  assert.strictEqual(recovery.find((row) => row.slot === "session-01").recommendation, "await_integration");

  runCodextrator(["task-update", "task-demo-1", "--status", "integrated"], { cwd: workspaceRoot });
  tasks = readTasks();
  assert.strictEqual(taskById(tasks, "task-demo-1").status, "integrated");
  slots = JSON.parse(runCodextrator(["slots", "--json"], { cwd: workspaceRoot }));
  slot = slots.find((row) => row.slot === "session-01");
  assert.strictEqual(slot.current_task_id, null);

  runCodextrator([
    "send",
    "session-01",
    "--from",
    "coordinator",
    "--subject",
    "Plain imported task",
    "--message",
    "This came from an older plain inbox assignment."
  ], { cwd: workspaceRoot });
  let imported = JSON.parse(runCodextrator(["task-import-inbox", "session-01", "--json"], { cwd: workspaceRoot }));
  assert.strictEqual(imported.length, 1);
  assert.strictEqual(imported[0].title, "Plain imported task");
  assert.strictEqual(imported[0].status, "queued");
  const importedTaskId = imported[0].task_id;
  const upgradedInbox = JSON.parse(runCodextrator(["inbox", "session-01", "--json", "--peek"], { cwd: workspaceRoot }));
  assert.strictEqual(upgradedInbox[0].type, "task.assign");
  assert.strictEqual(upgradedInbox[0].task_id, importedTaskId);
  runCodextrator(["inbox", "session-01", "--json"], { cwd: workspaceRoot });
  tasks = readTasks();
  assert.strictEqual(taskById(tasks, importedTaskId).status, "active");
  imported = JSON.parse(runCodextrator(["task-import-inbox", "session-01", "--json"], { cwd: workspaceRoot }));
  assert.strictEqual(imported.length, 0);

  const ledger = fs.readFileSync(path.join(workspaceRoot, STORE_NAME, "messages", "ledger.jsonl"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.ok(ledger.some((message) => message.type === "task.assign"));
  assert.ok(ledger.some((message) => message.type === "commit_report"));

  console.log("codextrator-cli.test.js: PASS");
} finally {
  cleanup();
}
