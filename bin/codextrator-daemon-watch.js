#!/usr/bin/env node
"use strict";

const { runDaemonWatchOnceAsync } = require("../src/daemon-watch.js");
const {
  shouldStartAdminDashboard,
  startDaemonAdminDashboard
} = require("../src/daemon-admin.js");

async function main() {
  const { opts } = parseArgs(process.argv.slice(2));
  if (opts.help || opts.h) {
    printHelp();
    return;
  }

  const maxCycles = Number(opts["max-cycles"] || (opts.once === false ? 0 : 1));
  const intervalMs = Number(opts["interval-ms"] || 300000);
  const cycles = [];
  let cycle = 0;
  const admin = await startDaemonAdminDashboard({
    enabled: shouldStartAdminDashboard(opts),
    root: opts.root,
    agent: opts["admin-agent"] || opts.agent || "daemon-watch",
    host: opts["admin-host"],
    port: opts["admin-port"],
    heartbeatMaxMinutes: opts["admin-heartbeat-max-minutes"] || opts["heartbeat-max-minutes"],
    pollMs: opts["admin-poll-ms"],
    open: truthy(opts["open-admin"]) || truthy(opts["admin-open"])
  });

  try {
    do {
      cycle += 1;
      cycles.push(await runDaemonWatchOnceAsync({
        root: opts.root,
        agent: opts.agent || "daemon-watch",
        send: truthy(opts.send),
        slot: opts.slot,
        slots: opts.slots,
        prompt: opts.prompt,
        promptMode: opts["prompt-mode"] || opts.promptMode,
        port: opts.port,
        url: opts.url,
        effort: opts.effort,
        sandbox: opts.sandbox,
        timeoutMs: opts["timeout-ms"],
        approvalPolicy: opts["approval-policy"],
        heartbeatMaxMinutes: opts["heartbeat-max-minutes"]
      }));

      if (maxCycles > 0 && cycle >= maxCycles) break;
      if (truthy(opts.once) || maxCycles === 1) break;
      await sleep(intervalMs);
    } while (true);
  } finally {
    if (admin.started && maxCycles > 0) {
      await admin.close();
    }
  }

  const result = {
    ok: cycles.every((item) => item.ok),
    send: truthy(opts.send),
    admin: summarizeAdmin(admin),
    cycles
  };
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  process.exitCode = result.ok ? 0 : 1;
}

function truthy(value) {
  return value === true || value === "true" || value === "1" || value === "yes";
}

function parseArgs(argv) {
  const opts = { once: true };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (key === "loop") {
      opts.once = false;
      continue;
    }
    if (next === undefined || next.startsWith("--")) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i += 1;
    }
  }
  return { opts };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHuman(result) {
  console.log(`Codenator daemon watch: ${result.ok ? "OK" : "BLOCKED"}`);
  console.log(`send=${result.send} cycles=${result.cycles.length}`);
  if (result.admin && result.admin.enabled) {
    console.log(`admin=${result.admin.status} url=${result.admin.url || ""} opened=${result.admin.opened}`);
  }
  for (const cycle of result.cycles) {
    console.log(`${cycle.decision} planned=${cycle.summary.planned} sent=${cycle.summary.sent} blocked=${cycle.summary.blocked} failed=${cycle.summary.failed}`);
  }
}

function summarizeAdmin(admin) {
  return {
    enabled: Boolean(admin && admin.enabled),
    started: Boolean(admin && admin.started),
    status: admin && admin.status || "disabled",
    url: admin && admin.url || null,
    storeDir: admin && admin.storeDir || null,
    opened: Boolean(admin && admin.opened)
  };
}

function printHelp() {
  console.log(`codenator-daemon-watch

Usage:
  codenator-daemon-watch [--root PATH] [--json] [--once]
                           [--loop --interval-ms N --max-cycles N]
                           [--slots session-01,session-02] [--send]
                           [--prompt TEXT | --prompt-mode work]
                           [--sandbox MODE]
                           [--no-admin] [--open-admin]
                           [--admin-host 127.0.0.1] [--admin-port 8787]

Legacy alias:
  codextrator-daemon-watch [--root PATH] [--json] [--once]

Default mode is one dry-run cycle. It reads Codenator MCP wake state and
prints planned app-server wakes without mutating inboxes or tasks. With --send,
it records wake attempts and sends ready actions through app-server using
thread/resume followed by turn/start. Send mode requires either an explicit
--prompt for proof/manual use or --prompt-mode work for guarded task wakeups.

In --loop mode, the read-only Codenator admin dashboard starts automatically on
http://127.0.0.1:8787 unless --no-admin is set. Use --open-admin to open that
dashboard in the system default browser.
`);
}

main().catch((error) => {
  console.error(`codenator-daemon-watch: ${error.stack || error.message}`);
  process.exitCode = 1;
});
