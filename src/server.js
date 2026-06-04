#!/usr/bin/env node
"use strict";

const path = require("path");
const { createRequire } = require("module");
const { startDaemonAdminDashboard } = require("./daemon-admin.js");
const store = require("./store.js");

function requireMcp(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    const siblingRequire = createRequire(path.resolve(
      __dirname,
      "..",
      "..",
      "auralis-consilium",
      "package.json"
    ));
    return siblingRequire(modulePath);
  }
}

const { Server } = requireMcp("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = requireMcp("@modelcontextprotocol/sdk/server/stdio.js");
const {
  ListToolsRequestSchema,
  CallToolRequestSchema
} = requireMcp("@modelcontextprotocol/sdk/types.js");

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    root: process.env.AURALIS_CODENATOR_ROOT || process.env.AURALIS_CODEXTRATOR_ROOT || process.cwd(),
    agent: process.env.AURALIS_CODENATOR_AGENT || process.env.AURALIS_CODEXTRATOR_AGENT || "coordinator",
    admin: !disabled(process.env.AURALIS_CODENATOR_ADMIN || process.env.AURALIS_CODEXTRATOR_ADMIN),
    adminHost: process.env.AURALIS_CODENATOR_ADMIN_HOST || process.env.AURALIS_CODEXTRATOR_ADMIN_HOST,
    adminPort: process.env.AURALIS_CODENATOR_ADMIN_PORT || process.env.AURALIS_CODEXTRATOR_ADMIN_PORT,
    adminOpen: truthy(process.env.AURALIS_CODENATOR_OPEN_ADMIN || process.env.AURALIS_CODEXTRATOR_OPEN_ADMIN)
  };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--root") config.root = args[++i];
    else if (args[i] === "--agent") config.agent = args[++i];
    else if (args[i] === "--admin") config.admin = true;
    else if (args[i] === "--no-admin") config.admin = false;
    else if (args[i] === "--admin-host") config.adminHost = args[++i];
    else if (args[i] === "--admin-port") config.adminPort = args[++i];
    else if (args[i] === "--open-admin") config.adminOpen = true;
  }
  return config;
}

function truthy(value) {
  return value === true || value === "true" || value === "1" || value === "yes";
}

function disabled(value) {
  return value === "false" || value === "0" || value === "no";
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(message) {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

function tools() {
  return [
    {
      name: "get_status",
      description: "Read Codenator slot, unread inbox, heartbeat, and task summary without resuming Codex Desktop threads. Defaults to compact summary output; pass detail=\"full\" only when full task history is needed.",
      inputSchema: {
        type: "object",
        properties: {
          detail: { type: "string", enum: ["summary", "full"] },
          recent_limit: { type: "number" }
        }
      }
    },
    {
      name: "register_slot",
      description: "Register or refresh a Codex focus slot. The slot is stable; run_id is optional and replaces Desktop thread identity.",
      inputSchema: {
        type: "object",
        properties: {
          slot: { type: "string" },
          project: { type: "string" },
          identity: { type: "string" },
          focus: { type: "string" },
          worktree: { type: "string" },
          branch: { type: "string" },
          role: { type: "string" },
          wave_id: { type: "string" },
          status: { type: "string" },
          run_id: { type: "string" },
          app_server_thread_id: { type: "string" },
          app_server_url: { type: "string" }
        },
        required: ["slot", "project", "focus", "worktree"]
      }
    },
    {
      name: "retire_slot",
      description: "Coordinator-only: retire, park, or stale a focus slot so historical ledger entries do not count as the current live wave pool.",
      inputSchema: {
        type: "object",
        properties: {
          slot: { type: "string" },
          status: { type: "string", enum: ["retired", "parked", "paused", "stale"] },
          reason: { type: "string" },
          force: { type: "boolean" }
        },
        required: ["slot"]
      }
    },
    {
      name: "send_message",
      description: "Append a durable message to the Codenator ledger. Recipients read it through cursor-based inboxes.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string" },
          from: { type: "string" },
          type: { type: "string" },
          subject: { type: "string" },
          message: { type: "string" },
          task_id: { type: "string" },
          payload: { type: "object" }
        },
        required: ["to", "message"]
      }
    },
    {
      name: "read_inbox",
      description: "Read unread messages for a slot using a durable cursor. Does not rename or delete inbox files.",
      inputSchema: {
        type: "object",
        properties: {
          slot: { type: "string" },
          mark_read: { type: "boolean" }
        },
        required: ["slot"]
      }
    },
    {
      name: "get_focus_board",
      description: "Read the shared Codenator Focus Board snapshot. Defaults to compact summary output to keep Codex Desktop responsive; pass detail=\"full\" only when full tasks, reports, and integration receipts are needed.",
      inputSchema: {
        type: "object",
        properties: {
          viewer_slot: { type: "string" },
          detail: { type: "string", enum: ["summary", "full"] },
          recent_limit: { type: "number" }
        }
      }
    },
    {
      name: "upsert_milestone",
      description: "Coordinator-only: create or update a Focus Board milestone for shared progress visibility.",
      inputSchema: {
        type: "object",
        properties: {
          milestone_id: { type: "string" },
          title: { type: "string" },
          status: { type: "string" },
          description: { type: "string" },
          order: { type: "number" }
        },
        required: ["milestone_id"]
      }
    },
    {
      name: "upsert_lane",
      description: "Coordinator-only: create or update a Focus Board module lane and owner slot.",
      inputSchema: {
        type: "object",
        properties: {
          lane_id: { type: "string" },
          title: { type: "string" },
          owner_slot: { type: "string" },
          project: { type: "string" },
          status: { type: "string" },
          description: { type: "string" },
          order: { type: "number" }
        },
        required: ["lane_id"]
      }
    },
    {
      name: "create_task",
      description: "Create a queued task for a slot and deliver a task.assign message through the MCP ledger.",
      inputSchema: {
        type: "object",
        properties: {
          slot: { type: "string" },
          task_id: { type: "string" },
          title: { type: "string" },
          subject: { type: "string" },
          message: { type: "string" },
          project: { type: "string" },
          branch: { type: "string" },
          worktree: { type: "string" },
          milestone_id: { type: "string" },
          lane_id: { type: "string" },
          dependency_ids: { type: "array", items: { type: "string" } },
          acceptance_criteria: { type: "array", items: { type: "string" } },
          required_receipts: { type: "array", items: { type: "string" } },
          visible_progress_summary: { type: "string" }
        },
        required: ["slot", "title", "message"]
      }
    },
    {
      name: "claim_next_task",
      description: "Claim the next queued task for a slot. This marks the task active and advances the slot inbox cursor.",
      inputSchema: {
        type: "object",
        properties: {
          slot: { type: "string" }
        },
        required: ["slot"]
      }
    },
    {
      name: "update_task",
      description: "Update a task status, commit, tests, or blocker. Integrated/done tasks clear the slot current task pointer.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          status: { type: "string" },
          commit: { type: "string" },
          blocker: { type: "string" },
          tests: { type: "array", items: { type: "string" } }
        },
        required: ["task_id"]
      }
    },
    {
      name: "report_commit",
      description: "Report a focus-slot commit to the coordinator. Metadata can be supplied directly or detected from worktree.",
      inputSchema: {
        type: "object",
        properties: {
          slot: { type: "string" },
          worktree: { type: "string" },
          sha: { type: "string" },
          branch: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          changed: { type: "array", items: { type: "string" } }
        },
        required: ["slot"]
      }
    },
    {
      name: "record_heartbeat",
      description: "Record slot health for the current live run. Uses run_id, not Codex Desktop target_thread_id.",
      inputSchema: {
        type: "object",
        properties: {
          slot: { type: "string" },
          status: { type: "string", enum: ["ok", "failed", "stale"] },
          run_id: { type: "string" },
          error: { type: "string" }
        },
        required: ["slot"]
      }
    },
    {
      name: "plan_wake",
      description: "Build a safe notify-only, blocked, or ready wake plan from the MCP ledger without mutating sessions, tasks, or inbox cursors.",
      inputSchema: {
        type: "object",
        properties: {
          adapter: { type: "string", enum: ["notify-only", "codex-app-server"] },
          heartbeat_max_minutes: { type: "number" },
          checked_at: { type: "string" }
        }
      }
    },
    {
      name: "record_summary_pause",
      description: "Coordinator-only: record that Ton received the periodic integration summary pause, allowing wake and assignment to resume.",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          integration_count: { type: "number" },
          subject: { type: "string" }
        }
      }
    },
    {
      name: "record_wake_attempt",
      description: "Persist the result of a planned wake attempt for audit/proof without changing task or inbox state.",
      inputSchema: {
        type: "object",
        properties: {
          slot: { type: "string" },
          action: { type: "string" },
          adapter: { type: "string" },
          status: { type: "string" },
          reason: { type: "string" },
          prompt: { type: "string" },
          result: { type: "object" },
          error: { type: "string" }
        },
        required: ["slot"]
      }
    }
  ];
}

async function main() {
  const config = parseArgs();
  const storeDir = store.ensureStore(config.root, config.agent);
  const log = (...items) => process.stderr.write(`${items.join(" ")}\n`);
  log(`[auralis-codenator] MCP starting: agent=${config.agent}`);
  log(`[auralis-codenator] Root: ${path.resolve(config.root)}`);
  await startMcpAdminDashboard(config, log);

  const mcp = new Server(
    { name: "auralis-codenator", version: "0.4.2" },
    {
      capabilities: { tools: {} },
      instructions: [
        "auralis-codenator coordinates Codex focus slots through MCP. Legacy codextrator aliases remain supported.",
        "Use cursor-based inboxes and durable task state. Do not depend on Codex Desktop automation resume.",
        "Stable slot ids identify focus lanes; optional run_id identifies the currently live Codex session.",
        `This agent: ${config.agent}.`
      ].join("\n")
    }
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools() }));

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments || {};
    try {
      switch (name) {
        case "get_status":
          return ok(store.buildStatus(storeDir, args));
        case "register_slot":
          return ok({ slot: store.registerSlot(storeDir, args) });
        case "retire_slot":
          return ok({ slot: store.retireSlot(storeDir, args) });
        case "send_message":
          return ok({
            message: store.appendLedger(storeDir, {
              ...args,
              from: args.from || config.agent
            })
          });
        case "read_inbox":
          {
            const messages = store.readInbox(storeDir, args.slot, {
              markRead: args.mark_read !== false
            });
            return ok({
              slot: args.slot,
              unread_count: messages.length,
              messages
            });
          }
        case "get_focus_board":
          return ok(store.buildFocusBoardSnapshot(storeDir, args));
        case "upsert_milestone":
          return ok({ milestone: store.upsertMilestone(storeDir, args) });
        case "upsert_lane":
          return ok({ lane: store.upsertLane(storeDir, args) });
        case "create_task":
          return ok(store.createTask(storeDir, {
            ...args,
            created_by: args.created_by || config.agent
          }));
        case "claim_next_task":
          return ok(store.claimNextTask(storeDir, args.slot));
        case "update_task":
          return ok({ task: store.updateTask(storeDir, args.task_id, args) });
        case "report_commit":
          return ok(store.reportCommit(storeDir, args));
        case "record_heartbeat":
          return ok({ heartbeat: store.recordHeartbeat(storeDir, args) });
        case "plan_wake":
          return ok(store.buildWakePlan(storeDir, args));
        case "record_summary_pause":
          return ok(store.recordSummaryPause(storeDir, {
            ...args,
            from: config.agent
          }));
        case "record_wake_attempt":
          return ok({ attempt: store.recordWakeAttempt(storeDir, args) });
        default:
          return err(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return err(error.message);
    }
  });

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

async function startMcpAdminDashboard(config, log) {
  if (!config.admin) {
    log("[auralis-codenator] Admin dashboard disabled");
    return null;
  }

  try {
    const admin = await startDaemonAdminDashboard({
      root: config.root,
      agent: config.agent,
      host: config.adminHost,
      port: config.adminPort,
      open: config.adminOpen
    });
    if (admin.enabled) {
      log(`[auralis-codenator] Admin dashboard ${admin.status}: ${admin.url}`);
    }
    return admin;
  } catch (error) {
    log(`[auralis-codenator] Admin dashboard unavailable: ${error.message}`);
    return null;
  }
}

main().catch((error) => {
  process.stderr.write(`[auralis-codenator] Fatal: ${error.stack || error.message}\n`);
  process.exit(1);
});
