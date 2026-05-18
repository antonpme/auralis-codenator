#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const STORE_NAME = ".auralis-codextrator";
const MINUTE_MS = 60 * 1000;
const RECOVERY_QUEUED_STALE_MS = 15 * MINUTE_MS;
const RECOVERY_HEARTBEAT_STALE_MS = 15 * MINUTE_MS;

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const { args, opts } = parseArgs(argv.slice(1));

  try {
    switch (command) {
      case "init":
        cmdInit(opts);
        break;
      case "register":
        cmdRegister(args, opts);
        break;
      case "send":
        cmdSend(args, opts);
        break;
      case "inbox":
        cmdInbox(args, opts);
        break;
      case "status":
        cmdStatus(opts);
        break;
      case "report-commit":
        cmdReportCommit(opts);
        break;
      case "task-create":
        cmdTaskCreate(args, opts);
        break;
      case "task-list":
        cmdTaskList(opts);
        break;
      case "task-update":
        cmdTaskUpdate(args, opts);
        break;
      case "task-import-inbox":
        cmdTaskImportInbox(args, opts);
        break;
      case "slots":
        cmdSlots(opts);
        break;
      case "heartbeat":
        cmdHeartbeat(args, opts);
        break;
      case "recovery":
        cmdRecovery(opts);
        break;
      case "watchdog-check":
        cmdWatchdogCheck(opts);
        break;
      case "hook-post-tool-use":
        cmdHookPostToolUse();
        break;
      case "hook-template":
        cmdHookTemplate();
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.error(`codextrator: ${error.message}`);
    process.exitCode = 1;
  }
}

function printHelp() {
  console.log(`auralis-codextrator

Usage:
  codextrator init [--root PATH]
  codextrator register SLOT --project NAME --focus TEXT --worktree PATH [--branch BRANCH] [--identity NAME]
  codextrator send TO --from SLOT --message TEXT [--subject TEXT]
  codextrator inbox SLOT [--peek] [--json]
  codextrator status [--json]
  codextrator report-commit [--slot SLOT] [--force]
  codextrator task-create SLOT --title TEXT --message TEXT [--task-id ID] [--subject TEXT]
  codextrator task-list [--slot SLOT] [--status STATUS] [--json]
  codextrator task-update TASK_ID [--status STATUS] [--commit SHA] [--blocker TEXT]
  codextrator task-import-inbox SLOT [--dry-run] [--json]
  codextrator slots [--json]
  codextrator heartbeat SLOT --status ok|failed|stale [--automation-id ID] [--thread-id ID] [--error TEXT]
  codextrator recovery [--json]
  codextrator watchdog-check [--json] [--heartbeat-max-minutes N] [--snooze-minutes N] [--dry-run]
  codextrator hook-post-tool-use
  codextrator hook-template
`);
}

function parseArgs(argv) {
  const args = [];
  const opts = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i += 1;
    }
  }

  return { args, opts };
}

function cmdInit(opts) {
  const root = path.resolve(opts.root || process.cwd());
  const store = path.join(root, STORE_NAME);
  ensureStore(store);
  const registryPath = path.join(store, "registry.json");

  if (!fs.existsSync(registryPath)) {
    writeJson(registryPath, {
      version: 1,
      name: "auralis-codextrator",
      created_at: now(),
      updated_at: now(),
      coordinator: {
        slot: "coordinator",
        identity: "coordinator",
        status: "active"
      },
      sessions: {}
    });
  }

  ensureInbox(store, "coordinator");
  console.log(`Initialized ${store}`);
}

function cmdRegister(args, opts) {
  const slot = args[0];
  if (!slot) throw new Error("register requires SLOT");
  if (!opts.project) throw new Error("register requires --project");
  if (!opts.focus) throw new Error("register requires --focus");
  if (!opts.worktree) throw new Error("register requires --worktree");

  const store = findStore();
  const registry = readRegistry(store);
  const worktree = normalizePath(opts.worktree);
  const branch = opts.branch || detectGitBranch(worktree) || "";
  const previous = registry.sessions[slot] || {};

  registry.sessions[slot] = {
    ...previous,
    slot,
    identity: opts.identity || "developer",
    project: opts.project,
    focus: opts.focus,
    worktree,
    branch,
    status: opts.status || "active",
    inbox: `inbox/${slot}`,
    updated_at: now()
  };
  registry.updated_at = now();

  writeRegistry(store, registry);
  ensureInbox(store, slot);
  console.log(`Registered ${slot}: ${opts.project} / ${opts.focus}`);
}

function cmdSend(args, opts) {
  const to = args[0];
  if (!to) throw new Error("send requires TO");
  const store = findStore();
  const from = opts.from || inferSlot(store) || "unknown";
  const message = opts.message || readStdinIfAvailable();
  if (!message.trim()) throw new Error("send requires --message or stdin");

  const payload = {
    id: makeId(),
    type: opts.type || "message",
    from,
    to,
    subject: opts.subject || "",
    message,
    task_id: opts["task-id"] || null,
    payload: parsePayload(opts.payload),
    created_at: now(),
    cwd: normalizePath(process.cwd())
  };

  writeMessage(store, to, payload);
  console.log(`Sent ${payload.id} to ${to}`);
}

function cmdInbox(args, opts) {
  const slot = args[0] || "coordinator";
  const store = findStore();
  ensureInbox(store, slot);
  const dir = path.join(store, "inbox", slot);
  const files = listJsonFiles(dir);
  const messages = files.map((file) => readJson(path.join(dir, file)));

  if (opts.json) {
    console.log(JSON.stringify(messages, null, 2));
  } else if (messages.length === 0) {
    console.log(`Inbox ${slot}: empty`);
  } else {
    console.log(`Inbox ${slot}: ${messages.length} message(s)`);
    for (const message of messages) {
      console.log("");
      console.log(`[${message.created_at}] ${message.from} -> ${message.to}`);
      if (message.subject) console.log(`Subject: ${message.subject}`);
      console.log(message.message);
    }
  }

  if (!opts.peek) {
    for (const message of messages) {
      if (message.type === "task.assign" && message.task_id && message.to === slot) {
        claimTask(store, message.task_id, slot);
      }
    }

    const archiveDir = path.join(store, "archive", slot);
    fs.mkdirSync(archiveDir, { recursive: true });
    for (const file of files) {
      fs.renameSync(path.join(dir, file), path.join(archiveDir, file));
    }
  }
}

function cmdStatus(opts) {
  const store = findStore();
  const registry = readRegistry(store);
  const slots = ["coordinator", ...Object.keys(registry.sessions).sort()];
  const rows = slots.map((slot) => {
    const session = slot === "coordinator" ? registry.coordinator : registry.sessions[slot];
    return {
      slot,
      identity: session.identity || "",
      project: session.project || "",
      focus: session.focus || "",
      branch: session.branch || "",
      status: session.status || "",
      unread: countInbox(store, slot)
    };
  });

  if (opts.json) {
    console.log(JSON.stringify({ registry, rows }, null, 2));
    return;
  }

  console.log("Auralis Codextrator status");
  for (const row of rows) {
    console.log(
      `${row.slot.padEnd(12)} unread=${String(row.unread).padEnd(2)} ` +
      `${row.project.padEnd(12)} ${row.branch.padEnd(34)} ${row.focus}`
    );
  }
}

function cmdReportCommit(opts) {
  const store = findStore();
  const slot = opts.slot || inferSlot(store);
  if (!slot) throw new Error("Could not infer session slot. Pass --slot.");

  const sha = git(["rev-parse", "HEAD"], process.cwd()).trim();
  const branch = git(["branch", "--show-current"], process.cwd()).trim();
  const subject = git(["log", "-1", "--pretty=%s"], process.cwd()).trim();
  const body = git(["log", "-1", "--pretty=%b"], process.cwd()).trim();
  const changed = git(["diff-tree", "--no-commit-id", "--name-status", "-r", "HEAD"], process.cwd())
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  if (!opts.force && alreadyReported(store, slot, sha)) {
    console.log(`Commit ${sha.slice(0, 7)} already reported for ${slot}`);
    return;
  }

  const report = {
    id: makeId(),
    type: "commit_report",
    slot,
    sha,
    branch,
    subject,
    body,
    changed,
    worktree: normalizePath(process.cwd()),
    created_at: now()
  };

  const reportPath = path.join(store, "reports", `${safeStamp()}_${slot}_${sha.slice(0, 12)}.json`);
  writeJson(reportPath, report);
  markReported(store, slot, sha);
  markActiveTaskReported(store, slot, {
    sha,
    branch,
    subject,
    worktree: normalizePath(process.cwd())
  });

  writeMessage(store, "coordinator", {
    id: makeId(),
    type: "commit_report",
    from: slot,
    to: "coordinator",
    subject: `Commit ${sha.slice(0, 7)}: ${subject}`,
    message: renderCommitReport(report),
    report_ref: normalizePath(reportPath),
    created_at: now(),
    cwd: normalizePath(process.cwd())
  });

  console.log(`Reported commit ${sha.slice(0, 7)} from ${slot}`);
}

function cmdTaskCreate(args, opts) {
  const slot = args[0];
  if (!slot) throw new Error("task-create requires SLOT");
  if (!opts.title) throw new Error("task-create requires --title");
  const message = opts.message || readStdinIfAvailable();
  if (!message.trim()) throw new Error("task-create requires --message or stdin");

  const store = findStore();
  ensureInbox(store, slot);
  const registry = readRegistry(store);
  const session = registry.sessions[slot] || {};
  const task = normalizeTaskRecord({
    task_id: opts["task-id"] || makeTaskId(slot),
    slot,
    title: opts.title,
    status: opts.status || "queued",
    subject: opts.subject || opts.title,
    message,
    project: opts.project || session.project || "",
    branch: opts.branch || session.branch || "",
    worktree: opts.worktree ? normalizePath(opts.worktree) : (session.worktree || ""),
    assigned_at: now(),
    next_policy: opts["next-policy"] || "report_commit_then_coordinator_integrates",
    created_by: opts.from || inferSlot(store) || "coordinator"
  });

  writeTask(store, task);
  updateSlotTask(store, slot, task.task_id, task.status);
  writeMessage(store, slot, {
    id: makeId(),
    type: "task.assign",
    from: task.created_by,
    to: slot,
    subject: task.subject,
    message: task.message,
    task_id: task.task_id,
    payload: {
      task_id: task.task_id,
      title: task.title,
      status: task.status,
      branch: task.branch,
      worktree: task.worktree
    },
    created_at: now(),
    cwd: normalizePath(process.cwd())
  });

  console.log(`Created task ${task.task_id} for ${slot}`);
}

function cmdTaskList(opts) {
  const store = findStore();
  const tasks = listTasks(store)
    .filter((task) => !opts.slot || task.slot === opts.slot)
    .filter((task) => !opts.status || task.status === opts.status);

  if (opts.json) {
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }

  if (tasks.length === 0) {
    console.log("Tasks: empty");
    return;
  }

  console.log(`Tasks: ${tasks.length}`);
  for (const task of tasks) {
    console.log(`${task.task_id.padEnd(28)} ${task.slot.padEnd(12)} ${task.status.padEnd(10)} ${task.title}`);
  }
}

function cmdTaskUpdate(args, opts) {
  const taskId = args[0];
  if (!taskId) throw new Error("task-update requires TASK_ID");
  const store = findStore();
  const task = readTask(store, taskId);

  if (opts.status) task.status = opts.status;
  if (opts.commit) task.commit = opts.commit;
  if (opts.blocker) {
    task.blockers = [...(task.blockers || []), {
      message: opts.blocker,
      recorded_at: now()
    }];
    if (!opts.status) task.status = "blocked";
  }
  if (opts.tests) task.tests = opts.tests.split(",").map((item) => item.trim()).filter(Boolean);
  task.updated_at = now();

  if (task.status === "active" && !task.started_at) task.started_at = now();
  if (task.status === "reported" && !task.reported_at) task.reported_at = now();
  if (task.status === "integrated" && !task.integrated_at) task.integrated_at = now();

  writeTask(store, task);
  updateSlotTask(store, task.slot, task.task_id, task.status);
  console.log(`Updated task ${task.task_id}: ${task.status}`);
}

function cmdTaskImportInbox(args, opts) {
  const slot = args[0];
  if (!slot) throw new Error("task-import-inbox requires SLOT");

  const store = findStore();
  ensureInbox(store, slot);
  const dir = path.join(store, "inbox", slot);
  const files = listJsonFiles(dir);
  const messages = files.map((file) => ({
    file,
    message: readJson(path.join(dir, file))
  }));
  const existing = listTasks(store);
  const imported = [];

  for (const item of messages) {
    const existingTask = existing.find((task) => task.source_message_id === item.message.id);
    if (existingTask) {
      if (!opts["dry-run"]) upgradeInboxTaskMessage(store, slot, item.file, item.message, existingTask);
      continue;
    }
    if (item.message.type === "commit_report") continue;

    const task = normalizeTaskRecord({
      task_id: item.message.task_id || makeTaskId(slot),
      slot,
      title: item.message.subject || `Inbox task ${item.message.id}`,
      subject: item.message.subject || "",
      status: "queued",
      message: item.message.message || "",
      assigned_at: item.message.created_at || now(),
      created_at: item.message.created_at || now(),
      created_by: item.message.from || "coordinator",
      project: sessionProject(store, slot),
      branch: sessionBranch(store, slot),
      worktree: sessionWorktree(store, slot),
      next_policy: "claim_inbox_then_report_commit"
    });
    task.source_message_id = item.message.id;
    task.source_inbox_file = normalizePath(path.join(dir, item.file));
    imported.push(task);
  }

  if (!opts["dry-run"]) {
    for (const task of imported) {
      writeTask(store, task);
      updateSlotTask(store, slot, task.task_id, task.status);
      const messageFile = path.basename(task.source_inbox_file);
      const message = readJson(path.join(store, "inbox", slot, messageFile));
      upgradeInboxTaskMessage(store, slot, messageFile, message, task);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(imported, null, 2));
    return;
  }

  console.log(`Imported ${imported.length} task(s) from ${slot} inbox${opts["dry-run"] ? " (dry-run)" : ""}`);
  for (const task of imported) {
    console.log(`${task.task_id} ${task.title}`);
  }
}

function upgradeInboxTaskMessage(store, slot, file, message, task) {
  if (message.type === "task.assign" && message.task_id === task.task_id) return;

  writeJson(path.join(store, "inbox", slot, file), {
    ...message,
    type: "task.assign",
    task_id: task.task_id,
    payload: {
      ...(message.payload || {}),
      task_id: task.task_id,
      title: task.title,
      status: task.status,
      branch: task.branch,
      worktree: task.worktree
    }
  });
}

function cmdSlots(opts) {
  const store = findStore();
  const registry = readRegistry(store);
  const rows = buildSlotRows(store, registry);

  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log("Codextrator slots");
  for (const row of rows) {
    const heartbeat = row.heartbeat_status ? ` heartbeat=${row.heartbeat_status}` : "";
    const currentTask = row.current_task_id ? ` task=${row.current_task_id}` : "";
    console.log(`${row.slot.padEnd(12)} ${row.status.padEnd(8)} unread=${String(row.unread).padEnd(2)}${heartbeat}${currentTask} ${row.focus}`);
  }
}

function cmdHeartbeat(args, opts) {
  const slot = args[0];
  if (!slot) throw new Error("heartbeat requires SLOT");
  if (!opts.status) throw new Error("heartbeat requires --status");

  const store = findStore();
  const heartbeat = {
    slot,
    status: opts.status,
    automation_id: opts["automation-id"] || null,
    thread_id: opts["thread-id"] || null,
    checked_at: now(),
    error: opts.error || null,
    requested_path: opts["requested-path"] || null,
    active_path: opts["active-path"] || null
  };

  writeJson(path.join(store, "heartbeat", `${slot}.json`), heartbeat);
  updateSlotHeartbeat(store, slot, heartbeat);
  console.log(`Heartbeat ${slot}: ${heartbeat.status}`);
}

function cmdRecovery(opts) {
  const store = findStore();
  const registry = readRegistry(store);
  const rows = buildRecoveryRows(store, registry);

  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log("Codextrator recovery");
  for (const row of rows) {
    console.log(`${row.slot.padEnd(12)} ${row.recommendation.padEnd(22)} unread=${String(row.unread).padEnd(2)} status=${row.status}${row.reason ? ` reason=${row.reason}` : ""}`);
  }
}

function cmdWatchdogCheck(opts) {
  const store = findStore();
  const registry = readRegistry(store);
  const checkedAt = now();
  const heartbeatMaxMinutes = Number(opts["heartbeat-max-minutes"] || 6);
  const snoozeMinutes = Number(opts["snooze-minutes"] || 15);
  const rows = buildRecoveryRows(store, registry);
  const coordinator = rows.find((row) => row.slot === "coordinator");
  const alerts = buildWatchdogAlerts(rows, {
    heartbeatMaxMs: heartbeatMaxMinutes * MINUTE_MS
  });
  const previous = readWatchdogState(store, "coordinator");
  const { unsuppressed, suppressed } = applyWatchdogSnooze(alerts, previous, {
    checkedAt,
    snoozeMs: snoozeMinutes * MINUTE_MS
  });
  const decision = unsuppressed.length > 0 ? "NOTIFY" : "DONT_NOTIFY";
  const state = updateWatchdogState(previous, {
    checkedAt,
    decision,
    alerts,
    unsuppressed,
    suppressed,
    coordinator
  });

  if (!opts["dry-run"]) {
    writeWatchdogState(store, "coordinator", state);
  }

  const output = {
    decision,
    checked_at: checkedAt,
    coordinator_unread: coordinator ? coordinator.unread : null,
    alerts: unsuppressed,
    suppressed,
    total_alerts: alerts.length
  };

  if (opts.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Codextrator watchdog: ${decision}`);
  const visible = decision === "NOTIFY" ? unsuppressed : suppressed;
  if (visible.length === 0) {
    console.log("No actionable coordinator watchdog alert.");
    return;
  }
  for (const alert of visible) {
    const suffix = alert.detail ? ` ${alert.detail}` : "";
    console.log(`- ${alert.slot} ${alert.type}: ${alert.reason}${suffix}`);
  }
}

function cmdHookPostToolUse() {
  const input = readStdinIfAvailable();
  if (!input.trim()) return;

  let event;
  try {
    event = JSON.parse(input);
  } catch {
    return;
  }

  const text = JSON.stringify(event);
  const isPostToolUse = event.hook_event_name === "PostToolUse" || text.includes("PostToolUse");
  const looksLikeGitCommit = /\bgit\s+commit\b/i.test(text);
  if (!isPostToolUse || !looksLikeGitCommit) return;

  try {
    cmdReportCommit({});
  } catch (error) {
    // Hooks should not break the user turn. Persist a best-effort error.
    try {
      const store = findStore();
      const errorPath = path.join(store, "reports", `${safeStamp()}_hook_error.json`);
      writeJson(errorPath, {
        id: makeId(),
        type: "hook_error",
        message: error.message,
        created_at: now()
      });
    } catch {
      // ignore
    }
  }
}

function cmdHookTemplate() {
  const cliPath = normalizePath(__filename);
  const command = `node "${cliPath}" hook-post-tool-use`;
  const template = {
    hooks: {
      PostToolUse: [
        {
          matcher: "Bash|shell_command|functions.shell_command",
          hooks: [
            {
              type: "command",
              command
            }
          ]
        }
      ]
    }
  };

  console.log(JSON.stringify(template, null, 2));
}

function ensureStore(store) {
  fs.mkdirSync(store, { recursive: true });
  for (const name of ["inbox", "archive", "reports", "tasks", "hooks", "heartbeat", "messages", "watchdog"]) {
    fs.mkdirSync(path.join(store, name), { recursive: true });
  }
}

function ensureInbox(store, slot) {
  fs.mkdirSync(path.join(store, "inbox", slot), { recursive: true });
  fs.mkdirSync(path.join(store, "archive", slot), { recursive: true });
}

function makeTaskId(slot) {
  return `${slot}-${safeStamp().replace(/-/g, "").slice(0, 15)}-${crypto.randomBytes(3).toString("hex")}`;
}

function normalizeTaskRecord(input) {
  const createdAt = input.created_at || now();
  return {
    version: 1,
    task_id: input.task_id,
    slot: input.slot,
    title: input.title,
    subject: input.subject || input.title,
    status: input.status || "queued",
    project: input.project || "",
    branch: input.branch || "",
    worktree: input.worktree || "",
    message: input.message || "",
    created_by: input.created_by || "coordinator",
    assigned_at: input.assigned_at || createdAt,
    started_at: input.started_at || null,
    reported_at: input.reported_at || null,
    integrated_at: input.integrated_at || null,
    commit: input.commit || null,
    tests: input.tests || [],
    blockers: input.blockers || [],
    next_policy: input.next_policy || "",
    created_at: createdAt,
    updated_at: input.updated_at || createdAt
  };
}

function taskPath(store, taskId) {
  return path.join(store, "tasks", `${safeFileName(taskId)}.json`);
}

function readTask(store, taskId) {
  const file = taskPath(store, taskId);
  if (!fs.existsSync(file)) throw new Error(`task not found: ${taskId}`);
  return readJson(file);
}

function writeTask(store, task) {
  writeJson(taskPath(store, task.task_id), task);
}

function listTasks(store) {
  const dir = path.join(store, "tasks");
  return listJsonFiles(dir)
    .map((file) => readJson(path.join(dir, file)))
    .sort((left, right) => String(left.assigned_at || left.created_at).localeCompare(String(right.assigned_at || right.created_at)));
}

function claimTask(store, taskId, slot) {
  let task;
  try {
    task = readTask(store, taskId);
  } catch {
    return;
  }
  if (task.slot !== slot) return;
  if (task.status === "queued" || task.status === "assigned") {
    task.status = "active";
    task.started_at = task.started_at || now();
    task.updated_at = now();
    writeTask(store, task);
    updateSlotTask(store, slot, task.task_id, task.status);
  }
}

function markActiveTaskReported(store, slot, report) {
  const activeTasks = listTasks(store).filter((task) => task.slot === slot && task.status === "active");
  if (activeTasks.length === 0) return;

  const task = activeTasks[activeTasks.length - 1];
  task.status = "reported";
  task.reported_at = now();
  task.commit = report.sha;
  task.branch = report.branch || task.branch;
  task.worktree = report.worktree || task.worktree;
  task.report_subject = report.subject;
  task.updated_at = now();
  writeTask(store, task);
  updateSlotTask(store, slot, task.task_id, task.status);
}

function updateSlotTask(store, slot, taskId, taskStatus) {
  const registry = readRegistry(store);
  const session = slot === "coordinator" ? registry.coordinator : registry.sessions[slot];
  if (!session) return;

  session.current_task_id = taskStatus === "integrated" || taskStatus === "done" ? null : taskId;
  session.current_task_status = taskStatus;
  session.updated_at = now();
  if (slot === "coordinator") registry.coordinator = session;
  else registry.sessions[slot] = session;
  registry.updated_at = now();
  writeRegistry(store, registry);
}

function updateSlotHeartbeat(store, slot, heartbeat) {
  const registry = readRegistry(store);
  const session = slot === "coordinator" ? registry.coordinator : registry.sessions[slot];
  if (!session) return;

  session.heartbeat = heartbeat;
  session.heartbeat_status = heartbeat.status;
  session.heartbeat_checked_at = heartbeat.checked_at;
  if (heartbeat.automation_id) session.heartbeat_automation_id = heartbeat.automation_id;
  if (heartbeat.thread_id) session.thread_id = heartbeat.thread_id;
  if (heartbeat.status === "stale" || heartbeat.status === "failed") {
    session.status = "stale";
  } else if (session.status === "stale") {
    session.status = "active";
  }
  session.updated_at = now();
  if (slot === "coordinator") registry.coordinator = session;
  else registry.sessions[slot] = session;
  registry.updated_at = now();
  writeRegistry(store, registry);
}

function sessionProject(store, slot) {
  const registry = readRegistry(store);
  const session = registry.sessions[slot] || {};
  return session.project || "";
}

function sessionBranch(store, slot) {
  const registry = readRegistry(store);
  const session = registry.sessions[slot] || {};
  return session.branch || "";
}

function sessionWorktree(store, slot) {
  const registry = readRegistry(store);
  const session = registry.sessions[slot] || {};
  return session.worktree || "";
}

function buildSlotRows(store, registry) {
  const slots = ["coordinator", ...Object.keys(registry.sessions || {}).sort()];
  const tasksById = new Map(listTasks(store).map((task) => [task.task_id, task]));
  return slots.map((slot) => {
    const session = slot === "coordinator" ? registry.coordinator : registry.sessions[slot];
    const heartbeat = readHeartbeat(store, slot);
    const currentTask = session.current_task_id ? tasksById.get(session.current_task_id) : null;
    return {
      slot,
      identity: session.identity || "",
      project: session.project || "",
      focus: session.focus || "",
      branch: session.branch || "",
      status: session.status || "",
      unread: countInbox(store, slot),
      current_task_id: session.current_task_id || null,
      current_task_status: session.current_task_status || null,
      current_task_assigned_at: currentTask ? currentTask.assigned_at : null,
      current_task_updated_at: currentTask ? currentTask.updated_at : null,
      current_task_reported_at: currentTask ? currentTask.reported_at : null,
      latest_inbox_created_at: latestInboxCreatedAt(store, slot),
      heartbeat_status: heartbeat ? heartbeat.status : (session.heartbeat_status || null),
      heartbeat_checked_at: heartbeat ? heartbeat.checked_at : (session.heartbeat_checked_at || null),
      heartbeat_automation_id: heartbeat ? heartbeat.automation_id : (session.heartbeat_automation_id || null),
      thread_id: session.thread_id || (heartbeat ? heartbeat.thread_id : null)
    };
  });
}

function buildRecoveryRows(store, registry) {
  return buildSlotRows(store, registry).map((row) => {
    const recommendation = recoveryRecommendation(row);
    return {
      ...row,
      recommendation: recommendation.action,
      reason: recommendation.reason
    };
  });
}

function recoveryRecommendation(row) {
  if (row.heartbeat_status === "stale" || row.heartbeat_status === "failed") {
    return { action: "restart_thread", reason: `heartbeat_${row.heartbeat_status}` };
  }
  if (row.status === "paused") {
    return { action: "parked", reason: "slot_paused" };
  }
  const heartbeatOverdue = row.heartbeat_checked_at && isOlderThan(row.heartbeat_checked_at, RECOVERY_HEARTBEAT_STALE_MS);
  const queuedTask = row.current_task_status === "queued" || row.current_task_status === "assigned";
  const queuedSince = row.current_task_assigned_at || row.latest_inbox_created_at;
  if (row.unread > 0 && queuedTask && isOlderThan(queuedSince, RECOVERY_QUEUED_STALE_MS)) {
    if (!row.heartbeat_checked_at) {
      return { action: "restart_thread", reason: "queued_inbox_no_heartbeat" };
    }
    if (heartbeatOverdue) {
      return { action: "restart_thread", reason: "queued_inbox_heartbeat_overdue" };
    }
    return { action: "read_inbox", reason: "queued_inbox_unclaimed" };
  }
  if (row.unread > 0 && !row.current_task_id) {
    return { action: "read_inbox", reason: "queued_inbox" };
  }
  if (row.current_task_status === "active") {
    return { action: "continue_task", reason: "task_active" };
  }
  if (row.current_task_status === "reported") {
    return { action: "await_integration", reason: "task_reported" };
  }
  if (heartbeatOverdue) {
    return { action: "restart_thread", reason: "heartbeat_overdue" };
  }
  return { action: "ok", reason: "" };
}

function buildWatchdogAlerts(rows, options) {
  const heartbeatMaxMs = options.heartbeatMaxMs || 6 * MINUTE_MS;
  const alerts = [];
  const coordinator = rows.find((row) => row.slot === "coordinator");

  if (coordinator && coordinator.unread > 0) {
    alerts.push(makeWatchdogAlert("coordinator_inbox", coordinator, {
      reason: "coordinator_reports_waiting",
      detail: `${coordinator.unread} message(s) waiting`,
      ref: coordinator.latest_inbox_created_at || String(coordinator.unread)
    }));
  }

  if (coordinator && isOlderThan(coordinator.heartbeat_checked_at, heartbeatMaxMs)) {
    alerts.push(makeWatchdogAlert("coordinator_heartbeat", coordinator, {
      reason: "coordinator_heartbeat_overdue",
      detail: `last check ${coordinator.heartbeat_checked_at || "never"}`,
      ref: coordinator.heartbeat_checked_at || "missing"
    }));
  }

  for (const row of rows) {
    if (row.slot === "coordinator") continue;
    if (row.recommendation !== "restart_thread" && row.reason !== "heartbeat_stale") continue;
    alerts.push(makeWatchdogAlert("slot_recovery", row, {
      reason: row.reason || row.recommendation,
      detail: row.current_task_id ? `task=${row.current_task_id}` : "",
      ref: row.current_task_id || row.heartbeat_checked_at || row.latest_inbox_created_at || row.slot
    }));
  }

  return alerts;
}

function makeWatchdogAlert(type, row, input) {
  const key = [
    type,
    row.slot,
    input.reason || "",
    input.ref || ""
  ].join(":");
  return {
    key,
    type,
    slot: row.slot,
    reason: input.reason || "",
    detail: input.detail || "",
    ref: input.ref || "",
    unread: row.unread,
    recommendation: row.recommendation || "",
    heartbeat_checked_at: row.heartbeat_checked_at || null,
    latest_inbox_created_at: row.latest_inbox_created_at || null,
    current_task_id: row.current_task_id || null
  };
}

function applyWatchdogSnooze(alerts, previous, options) {
  const checkedAt = options.checkedAt || now();
  const snoozeMs = options.snoozeMs || 15 * MINUTE_MS;
  const lastNotified = previous.last_notified || {};
  const unsuppressed = [];
  const suppressed = [];

  for (const alert of alerts) {
    const last = lastNotified[alert.key];
    if (last && !isOlderThan(last, snoozeMs, checkedAt)) {
      suppressed.push({
        ...alert,
        suppressed_until: new Date(Date.parse(last) + snoozeMs).toISOString()
      });
    } else {
      unsuppressed.push(alert);
    }
  }

  return { unsuppressed, suppressed };
}

function updateWatchdogState(previous, input) {
  const lastNotified = { ...(previous.last_notified || {}) };
  for (const alert of input.unsuppressed) {
    lastNotified[alert.key] = input.checkedAt;
  }

  return {
    version: 1,
    checked_at: input.checkedAt,
    decision: input.decision,
    coordinator_unread: input.coordinator ? input.coordinator.unread : null,
    alerts: input.alerts,
    suppressed: input.suppressed,
    last_notified: lastNotified
  };
}

function readWatchdogState(store, name) {
  const file = path.join(store, "watchdog", `${safeFileName(name)}.json`);
  if (!fs.existsSync(file)) return {};
  try {
    return readJson(file);
  } catch {
    return {};
  }
}

function writeWatchdogState(store, name, state) {
  writeJson(path.join(store, "watchdog", `${safeFileName(name)}.json`), state);
}

function readHeartbeat(store, slot) {
  const file = path.join(store, "heartbeat", `${safeFileName(slot)}.json`);
  if (!fs.existsSync(file)) return null;
  return readJson(file);
}

function findStore() {
  const envRoot = process.env.AURALIS_CODEXTRATOR_ROOT;
  if (envRoot) {
    const store = path.join(path.resolve(envRoot), STORE_NAME);
    if (fs.existsSync(store)) return store;
  }

  let current = process.cwd();
  while (true) {
    const candidate = path.join(current, STORE_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(`Could not find ${STORE_NAME}. Run init first or set AURALIS_CODEXTRATOR_ROOT.`);
}

function readRegistry(store) {
  const registryPath = path.join(store, "registry.json");
  if (!fs.existsSync(registryPath)) throw new Error("registry.json is missing. Run init first.");
  return readJson(registryPath);
}

function writeRegistry(store, registry) {
  writeJson(path.join(store, "registry.json"), registry);
}

function inferSlot(store) {
  const registry = readRegistry(store);
  const cwd = normalizePath(process.cwd()).toLowerCase();

  for (const [slot, session] of Object.entries(registry.sessions || {})) {
    const worktree = normalizePath(session.worktree || "").toLowerCase();
    if (worktree && (cwd === worktree || cwd.startsWith(`${worktree}/`))) {
      return slot;
    }
  }

  return null;
}

function detectGitBranch(cwd) {
  try {
    return git(["branch", "--show-current"], cwd).trim();
  } catch {
    return "";
  }
}

function writeMessage(store, to, payload) {
  ensureInbox(store, to);
  const file = `${safeStamp()}_${payload.id}.json`;
  writeJson(path.join(store, "inbox", to, file), payload);
  appendJsonl(path.join(store, "messages", "ledger.jsonl"), {
    ...payload,
    inbox_file: normalizePath(path.join(store, "inbox", to, file))
  });
}

function renderCommitReport(report) {
  const changed = report.changed.length ? report.changed.map((item) => `- ${item}`).join("\n") : "- No files listed";
  return [
    `Slot: ${report.slot}`,
    `Branch: ${report.branch}`,
    `Commit: ${report.sha}`,
    `Subject: ${report.subject}`,
    "",
    "Changed files:",
    changed,
    "",
    `Report created: ${report.created_at}`
  ].join("\n");
}

function alreadyReported(store, slot, sha) {
  const file = path.join(store, "reports", "last-reported.json");
  if (!fs.existsSync(file)) return false;
  const data = readJson(file);
  return data[slot] === sha;
}

function markReported(store, slot, sha) {
  const file = path.join(store, "reports", "last-reported.json");
  const data = fs.existsSync(file) ? readJson(file) : {};
  data[slot] = sha;
  writeJson(file, data);
}

function countInbox(store, slot) {
  const dir = path.join(store, "inbox", slot);
  if (!fs.existsSync(dir)) return 0;
  return listJsonFiles(dir).length;
}

function latestInboxCreatedAt(store, slot) {
  const dir = path.join(store, "inbox", slot);
  if (!fs.existsSync(dir)) return null;

  return listJsonFiles(dir).reduce((latest, file) => {
    try {
      const message = readJson(path.join(dir, file));
      const createdAt = message.created_at || null;
      if (!createdAt) return latest;
      if (!latest || String(createdAt).localeCompare(String(latest)) > 0) return createdAt;
    } catch {
      // Ignore malformed inbox records in recovery metadata.
    }
    return latest;
  }, null);
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readStdinIfAvailable() {
  try {
    if (process.stdin.isTTY) return "";
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parsePayload(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`--payload must be valid JSON: ${error.message}`);
  }
}

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function makeId() {
  return crypto.randomBytes(6).toString("hex");
}

function now() {
  return new Date().toISOString();
}

function isOlderThan(value, ageMs, nowValue = Date.now()) {
  const time = Date.parse(value || "");
  if (Number.isNaN(time)) return false;
  const nowMs = typeof nowValue === "number" ? nowValue : Date.parse(nowValue);
  if (Number.isNaN(nowMs)) return false;
  return nowMs - time > ageMs;
}

function safeStamp() {
  return now().replace(/[:.]/g, "-");
}

function safeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, "/");
}

function appendJsonl(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(data)}\n`, "utf8");
}

main();
