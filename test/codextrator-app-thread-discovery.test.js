"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const store = require("../src/store.js");
const { discoverAppThreads } = require("../src/app-thread-discovery.js");

const repoRoot = path.resolve(__dirname, "..");
const cli = path.join(repoRoot, "bin", "codextrator-app-thread-discover.js");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codextrator-app-thread-discovery-"));
const sessionsRoot = path.join(tmpRoot, "codex-home", "sessions");
const workspaceRoot = path.join(tmpRoot, "workspace");
const worktree01 = path.join(workspaceRoot, "worktrees", "memory-knowledge");
const worktree02 = path.join(workspaceRoot, "worktrees", "process-orchestration");

function writeSession(fileName, input) {
  const file = path.join(sessionsRoot, fileName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [
    {
      timestamp: input.timestamp,
      type: "session_meta",
      payload: {
        id: input.id,
        timestamp: input.timestamp,
        cwd: input.cwd || workspaceRoot,
        originator: "Codex Desktop",
        source: input.source === undefined ? "vscode" : input.source
      }
    },
    {
      timestamp: input.timestamp,
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: input.text }]
      }
    }
  ];
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  fs.utimesSync(file, new Date(input.mtime), new Date(input.mtime));
  return file;
}

function runCli(args) {
  return JSON.parse(execFileSync(process.execPath, [cli, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }));
}

try {
  fs.mkdirSync(worktree01, { recursive: true });
  fs.mkdirSync(worktree02, { recursive: true });

  writeSession("2026/05/19/rollout-older-session-01.jsonl", {
    id: "older-session-01",
    timestamp: "2026-05-19T08:00:00.000Z",
    mtime: "2026-05-19T08:30:00.000Z",
    text: `AOS-01 Memory Kernel, slot session-01.\nРаботай в:\n${worktree01}`
  });
  writeSession("2026/05/19/rollout-session-01.jsonl", {
    id: "thread-session-01",
    timestamp: "2026-05-19T09:00:00.000Z",
    mtime: "2026-05-19T09:30:00.000Z",
    text: `Элиан, это AOS-01 Memory Kernel, slot session-01.\nРаботай в:\n${worktree01}`
  });
  writeSession("2026/05/19/rollout-session-02.jsonl", {
    id: "thread-session-02",
    timestamp: "2026-05-19T09:05:00.000Z",
    mtime: "2026-05-19T09:20:00.000Z",
    text: `Элиан, это AOS-02 Process Rails, slot session-02.\nРаботай в:\n${worktree02}`
  });
  writeSession("2026/05/19/rollout-coordinator.jsonl", {
    id: "thread-coordinator",
    timestamp: "2026-05-19T09:10:00.000Z",
    mtime: "2026-05-19T09:40:00.000Z",
    text: "Элиан, это новая свежая сессия AOS-00 Coordinator для Auralis Codextrator."
  });
  writeSession("2026/05/19/rollout-guardian.jsonl", {
    id: "thread-guardian",
    timestamp: "2026-05-19T09:15:00.000Z",
    mtime: "2026-05-19T09:50:00.000Z",
    source: { subagent: { other: "guardian" } },
    text: "Guardian transcript mentions slot session-03 but must not be registered."
  });

  const discovered = discoverAppThreads({ sessionsRoot });
  assert.strictEqual(discovered.proposals.length, 3);
  assert.deepStrictEqual(discovered.proposals.map((item) => item.slot), ["coordinator", "session-01", "session-02"]);
  const session01 = discovered.proposals.find((item) => item.slot === "session-01");
  assert.strictEqual(session01.thread_id, "thread-session-01");
  assert.strictEqual(session01.worktree.replace(/\\/g, "/"), worktree01.replace(/\\/g, "/"));
  assert.strictEqual(session01.confidence, "explicit_slot");

  const storeDir = store.ensureStore(workspaceRoot, "coordinator");
  store.registerSlot(storeDir, {
    slot: "session-01",
    project: "auralis-os",
    focus: "Memory",
    worktree: worktree01,
    branch: "codex/memory"
  });
  store.registerSlot(storeDir, {
    slot: "session-02",
    project: "auralis-os",
    focus: "Process",
    worktree: worktree02,
    branch: "codex/process"
  });

  const dryRun = runCli([
    "--root",
    workspaceRoot,
    "--sessions-root",
    sessionsRoot,
    "--json"
  ]);
  assert.strictEqual(dryRun.applied.length, 0);
  assert.ok(dryRun.proposals.some((item) => item.slot === "session-01"));

  const applied = runCli([
    "--root",
    workspaceRoot,
    "--sessions-root",
    sessionsRoot,
    "--slots",
    "session-01,session-02",
    "--apply",
    "--json"
  ]);
  assert.deepStrictEqual(applied.applied.map((item) => item.slot), ["session-01", "session-02"]);
  const status = store.buildStatus(storeDir);
  assert.strictEqual(status.slots.find((slot) => slot.slot === "session-01").app_server_thread_id, "thread-session-01");
  assert.strictEqual(status.slots.find((slot) => slot.slot === "session-02").app_server_thread_id, "thread-session-02");
  assert.strictEqual(status.slots.find((slot) => slot.slot === "coordinator").app_server_thread_id, null);

  console.log("codextrator-app-thread-discovery.test.js: PASS");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
