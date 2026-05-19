"use strict";

function buildWorkPrompt(action) {
  const worktree = action.worktree || "(registered worktree missing)";
  const runId = action.run_id || `${action.slot}-app-server-wake`;
  const subjects = extractUnreadSubjects(action.prompt);
  return [
    `Codextrator work wake for ${action.slot}.`,
    "You are a registered Codex focus slot, not the coordinator.",
    "Use the auralis-codextrator MCP tools for coordination.",
    `First record_heartbeat for ${action.slot} with status ok and run_id ${JSON.stringify(runId)}.`,
    `Then read your inbox for ${action.slot} with mark_read=false.`,
    "If and only if a task.assign is present for your slot, call claim_next_task for your slot.",
    "If no task.assign is present, reply that no task is waiting and stop.",
    `Work only inside your registered worktree: ${worktree}.`,
    "Do not touch live/v1 roots, Discord, production storage, unrelated worktrees, or other slots.",
    "Keep the slice narrow, run focused tests, commit meaningful work, and report_commit back to coordinator.",
    "If blocked, update the task with a blocker and stop.",
    subjects ? `Unread subjects: ${subjects}` : "Unread subjects: none listed."
  ].join("\n");
}

function extractUnreadSubjects(prompt) {
  const match = String(prompt || "").match(/Unread subjects:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

module.exports = {
  buildWorkPrompt
};
