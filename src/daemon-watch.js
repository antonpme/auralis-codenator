"use strict";

const path = require("path");
const store = require("./store.js");
const { sendTurnToThread } = require("./app-server-client.js");

function runDaemonWatchOnce(input = {}) {
  const root = path.resolve(input.root || process.env.AURALIS_CODEXTRATOR_ROOT || process.cwd());
  const storeDir = store.ensureStore(root, input.agent || "daemon-watch");
  const plan = store.buildWakePlan(storeDir, {
    adapter: "codex-app-server",
    heartbeat_max_minutes: input.heartbeatMaxMinutes || input["heartbeat-max-minutes"],
    checked_at: input.checkedAt || input["checked-at"]
  });
  const slots = parseSlots(input.slots || input.slot);
  const send = input.send === true;
  const sender = input.sendTurnToThread || sendTurnToThread;
  const actions = plan.actions
    .filter((action) => action.action === "wake_slot")
    .filter((action) => slots.size === 0 || slots.has(action.slot))
    .map((action) => withPromptOverride(action, input.prompt));

  const result = {
    ok: true,
    root,
    checked_at: plan.checked_at,
    decision: plan.decision,
    send,
    safety: plan.safety,
    summary: {
      planned: 0,
      blocked: 0,
      sent: 0,
      failed: 0
    },
    actions,
    attempts: []
  };

  for (const action of actions) {
    const request = action.adapter_request || {};
    if (isMissingThreadId(request)) {
      result.summary.blocked += 1;
      if (send) {
        result.attempts.push(store.recordWakeAttempt(storeDir, {
          slot: action.slot,
          action: action.action,
          adapter: "codex-app-server",
          status: "blocked",
          reason: "missing_app_server_thread_id",
          prompt: action.prompt
        }));
        result.ok = false;
      }
      continue;
    }

    if (!request.params || !request.params.threadId) {
      result.summary.blocked += 1;
      if (send) {
        result.attempts.push(store.recordWakeAttempt(storeDir, {
          slot: action.slot,
          action: action.action,
          adapter: "codex-app-server",
          status: "blocked",
          reason: "invalid_app_server_request",
          prompt: action.prompt
        }));
        result.ok = false;
      }
      continue;
    }

    if (!send) {
      result.summary.planned += 1;
      continue;
    }

    const turn = sender({
      url: input.url || request.app_server_url || undefined,
      port: input.port,
      cwd: action.worktree || root,
      turnCwd: action.worktree || undefined,
      threadId: request.params.threadId,
      prompt: action.prompt,
      effort: input.effort || "xhigh",
      approvalPolicy: input.approvalPolicy,
      timeoutMs: input.timeoutMs
    });

    if (turn && typeof turn.then === "function") {
      throw new Error("runDaemonWatchOnce requires a synchronous sendTurnToThread test double; use runDaemonWatchOnceAsync for async sends");
    }
    recordTurnResult(storeDir, result, action, turn);
  }

  return result;
}

async function runDaemonWatchOnceAsync(input = {}) {
  const root = path.resolve(input.root || process.env.AURALIS_CODEXTRATOR_ROOT || process.cwd());
  const storeDir = store.ensureStore(root, input.agent || "daemon-watch");
  const plan = store.buildWakePlan(storeDir, {
    adapter: "codex-app-server",
    heartbeat_max_minutes: input.heartbeatMaxMinutes || input["heartbeat-max-minutes"],
    checked_at: input.checkedAt || input["checked-at"]
  });
  const slots = parseSlots(input.slots || input.slot);
  const send = input.send === true;
  const sender = input.sendTurnToThread || sendTurnToThread;
  const actions = plan.actions
    .filter((action) => action.action === "wake_slot")
    .filter((action) => slots.size === 0 || slots.has(action.slot))
    .map((action) => withPromptOverride(action, input.prompt));

  const result = {
    ok: true,
    root,
    checked_at: plan.checked_at,
    decision: plan.decision,
    send,
    safety: plan.safety,
    summary: {
      planned: 0,
      blocked: 0,
      sent: 0,
      failed: 0
    },
    actions,
    attempts: []
  };

  for (const action of actions) {
    const request = action.adapter_request || {};
    if (isMissingThreadId(request)) {
      result.summary.blocked += 1;
      if (send) {
        result.attempts.push(store.recordWakeAttempt(storeDir, {
          slot: action.slot,
          action: action.action,
          adapter: "codex-app-server",
          status: "blocked",
          reason: "missing_app_server_thread_id",
          prompt: action.prompt
        }));
        result.ok = false;
      }
      continue;
    }

    if (!request.params || !request.params.threadId) {
      result.summary.blocked += 1;
      if (send) {
        result.attempts.push(store.recordWakeAttempt(storeDir, {
          slot: action.slot,
          action: action.action,
          adapter: "codex-app-server",
          status: "blocked",
          reason: "invalid_app_server_request",
          prompt: action.prompt
        }));
        result.ok = false;
      }
      continue;
    }

    if (!send) {
      result.summary.planned += 1;
      continue;
    }

    const turn = await sender({
      url: input.url || request.app_server_url || undefined,
      port: input.port,
      cwd: action.worktree || root,
      turnCwd: action.worktree || undefined,
      threadId: request.params.threadId,
      prompt: action.prompt,
      effort: input.effort || "xhigh",
      approvalPolicy: input.approvalPolicy,
      timeoutMs: input.timeoutMs
    });
    recordTurnResult(storeDir, result, action, turn);
  }

  return result;
}

function recordTurnResult(storeDir, result, action, turn) {
  const attempt = store.recordWakeAttempt(storeDir, {
    slot: action.slot,
    action: action.action,
    adapter: "codex-app-server",
    status: turn && turn.ok ? "completed" : "failed",
    reason: turn ? turn.reason : "missing_turn_result",
    prompt: action.prompt,
    result: turn && turn.ok ? summarizeTurnEvidence(turn.evidence) : null,
    error: turn && turn.ok ? null : ((turn && turn.evidence && turn.evidence.error) || (turn && turn.reason) || "missing_turn_result")
  });
  result.attempts.push(attempt);
  if (turn && turn.ok) result.summary.sent += 1;
  else {
    result.summary.failed += 1;
    result.ok = false;
  }
}

function isMissingThreadId(request) {
  return Boolean(request.requires && request.requires.includes("app_server_thread_id"));
}

function withPromptOverride(action, prompt) {
  if (!prompt) return action;
  const updated = {
    ...action,
    prompt
  };
  if (action.adapter_request && action.adapter_request.params) {
    updated.adapter_request = {
      ...action.adapter_request,
      params: {
        ...action.adapter_request.params,
        input: [{ type: "text", text: prompt }]
      }
    };
  }
  return updated;
}

function summarizeTurnEvidence(evidence = {}) {
  return {
    thread_id: evidence.thread_id || null,
    turn_id: evidence.turn_id || null,
    url: evidence.url || null,
    finished_at: evidence.finished_at || null,
    agent_text_tail: evidence.agent_text ? evidence.agent_text.slice(-500) : ""
  };
}

function parseSlots(value) {
  return new Set(String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean));
}

module.exports = {
  runDaemonWatchOnce,
  runDaemonWatchOnceAsync
};
