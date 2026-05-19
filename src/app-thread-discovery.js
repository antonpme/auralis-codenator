"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_LIMIT = 200;

function defaultSessionsRoot() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(codexHome, "sessions");
}

function discoverAppThreads(input = {}) {
  const sessionsRoot = path.resolve(input.sessionsRoot || defaultSessionsRoot());
  const limit = Number(input.limit || DEFAULT_LIMIT);
  const files = listJsonlFiles(sessionsRoot)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, limit);
  const candidates = files
    .map((file) => readSessionCandidate(file))
    .filter(Boolean)
    .filter((candidate) => candidate.slot);
  const bySlot = new Map();
  for (const candidate of candidates) {
    const previous = bySlot.get(candidate.slot);
    if (!previous || candidate.last_write_ms > previous.last_write_ms) {
      bySlot.set(candidate.slot, candidate);
    }
  }
  const proposals = [...bySlot.values()]
    .sort((left, right) => slotSortKey(left.slot).localeCompare(slotSortKey(right.slot)));
  return {
    sessions_root: sessionsRoot,
    scanned_files: files.length,
    candidates,
    proposals
  };
}

function listJsonlFiles(root) {
  if (!fs.existsSync(root)) return [];
  const results = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const stat = fs.statSync(full);
        results.push({
          file: full,
          mtimeMs: stat.mtimeMs,
          lastWriteTime: stat.mtime.toISOString()
        });
      }
    }
  }
  return results;
}

function readSessionCandidate(fileInfo) {
  const lines = fs.readFileSync(fileInfo.file, "utf8").split(/\r?\n/).filter(Boolean);
  const metaLine = lines.find((line) => line.includes('"session_meta"'));
  if (!metaLine) return null;
  const meta = parseJson(metaLine);
  if (!meta || !meta.payload || !isDesktopSessionSource(meta.payload.source)) return null;

  let matched = null;
  for (const line of lines.slice(0, 240)) {
    const item = parseJson(line);
    if (!item || item.type !== "response_item") continue;
    const payload = item.payload || {};
    if (payload.type !== "message" || payload.role !== "user") continue;
    const text = messageText(payload);
    const slot = detectSlot(text);
    if (slot) {
      matched = {
        slot,
        text,
        confidence: slot === "coordinator" ? "aos_coordinator" : "explicit_slot"
      };
      break;
    }
  }

  if (!matched) return null;

  return {
    slot: matched.slot,
    thread_id: meta.payload.id,
    confidence: matched.confidence,
    session_timestamp: normalizeTime(meta.payload.timestamp),
    cwd: meta.payload.cwd || "",
    worktree: detectWorktree(matched.text) || "",
    title: detectTitle(matched.text, matched.slot),
    last_write_time: fileInfo.lastWriteTime,
    last_write_ms: fileInfo.mtimeMs,
    file: path.resolve(fileInfo.file)
  };
}

function isDesktopSessionSource(source) {
  if (source === "vscode" || source === "desktop") return true;
  if (!source || typeof source !== "object") return false;
  if (source.subagent) return false;
  return false;
}

function messageText(payload) {
  return (payload.content || [])
    .map((item) => item.text || "")
    .filter(Boolean)
    .join("\n");
}

function detectSlot(text) {
  const explicit = String(text).match(/\bslot\s+(session-\d{2})\b/i);
  if (explicit) return explicit[1].toLowerCase();
  const aos = String(text).match(/\bAOS-(\d{2})\b/i);
  if (!aos) return "";
  if (aos[1] === "00" && /Coordinator/i.test(text)) return "coordinator";
  return `session-${aos[1]}`;
}

function detectWorktree(text) {
  const lines = String(text).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (/Работай в|Work in|worktree/i.test(lines[index])) {
      const inline = lines[index].match(/([A-Z]:[\\/][^\r\n]+)/i);
      if (inline) return inline[1].trim();
      for (let offset = 1; offset <= 3 && index + offset < lines.length; offset += 1) {
        const line = lines[index + offset].trim();
        if (/^[A-Z]:[\\/]/i.test(line)) return line;
      }
    }
  }
  return "";
}

function detectTitle(text, slot) {
  const firstLine = String(text).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  const title = firstLine.match(/AOS-\d{2}\s+([^,.\n]+)/i);
  if (title) return title[0].trim();
  return slot;
}

function normalizeTime(value) {
  const time = Date.parse(value || "");
  return Number.isNaN(time) ? String(value || "") : new Date(time).toISOString();
}

function slotSortKey(slot) {
  return slot === "coordinator" ? "session-00" : slot;
}

function parseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

module.exports = {
  defaultSessionsRoot,
  discoverAppThreads
};
