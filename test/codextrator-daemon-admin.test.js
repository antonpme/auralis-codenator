"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  shouldStartAdminDashboard,
  startDaemonAdminDashboard
} = require("../src/daemon-admin.js");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codextrator-daemon-admin-"));
const workspaceRoot = path.join(tmpRoot, "workspace");

(async () => {
  try {
    assert.strictEqual(shouldStartAdminDashboard({ once: true }), false);
    assert.strictEqual(shouldStartAdminDashboard({ once: false }), true);
    assert.strictEqual(shouldStartAdminDashboard({ once: false, "no-admin": true }), false);

    const dashboard = await startDaemonAdminDashboard({
      root: workspaceRoot,
      host: "127.0.0.1",
      port: 0,
      open: false
    });
    try {
      assert.strictEqual(dashboard.started, true);
      assert.match(dashboard.url, /^http:\/\/127\.0\.0\.1:\d+$/);
      const health = await getJson(`${dashboard.url}/api/health`);
      assert.strictEqual(health.ok, true);
      assert.strictEqual(health.name, "auralis-codenator-admin");

      const reused = await startDaemonAdminDashboard({
        root: workspaceRoot,
        host: "127.0.0.1",
        port: dashboard.port,
        open: false
      });
      assert.strictEqual(reused.started, false);
      assert.strictEqual(reused.status, "already_running");
      assert.strictEqual(reused.url, dashboard.url);
      await reused.close();
    } finally {
      await dashboard.close();
    }

    const opened = [];
    const openedDashboard = await startDaemonAdminDashboard({
      root: workspaceRoot,
      host: "127.0.0.1",
      port: 0,
      open: true,
      openUrl: (url) => {
        opened.push(url);
        return { pid: 1234 };
      }
    });
    try {
      assert.deepStrictEqual(opened, [openedDashboard.url]);
      assert.strictEqual(openedDashboard.opened, true);
    } finally {
      await openedDashboard.close();
    }

    const disabled = await startDaemonAdminDashboard({
      enabled: false,
      root: workspaceRoot
    });
    assert.strictEqual(disabled.started, false);
    assert.strictEqual(disabled.enabled, false);

    console.log("codextrator-daemon-admin.test.js: PASS");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

async function getJson(url) {
  const response = await fetch(url);
  assert.strictEqual(response.status, 200);
  return response.json();
}
