"use strict";

const { spawn } = require("child_process");
const { createAdminServer, DEFAULT_HOST, DEFAULT_PORT } = require("./admin-server.js");

function shouldStartAdminDashboard(options = {}) {
  if (options.enabled === false) return false;
  if (truthy(options["no-admin"]) || truthy(options.noAdmin)) return false;
  if (truthy(options.admin)) return true;
  return options.once === false;
}

async function startDaemonAdminDashboard(options = {}) {
  if (options.enabled === false) {
    return createDisabledDashboard();
  }

  const host = options.host || DEFAULT_HOST;
  const port = Number(options.port !== undefined ? options.port : DEFAULT_PORT);
  const url = `http://${host}:${port}`;
  const server = createAdminServer({
    root: options.root,
    agent: options.agent,
    host,
    port,
    heartbeatMaxMinutes: options.heartbeatMaxMinutes || options["heartbeat-max-minutes"],
    pollMs: options.pollMs || options["poll-ms"]
  });

  try {
    await listen(server, port, host);
  } catch (error) {
    if (error && error.code === "EADDRINUSE" && await isAdminAlreadyRunning(url)) {
      return {
        enabled: true,
        started: false,
        status: "already_running",
        host,
        port,
        url,
        storeDir: server.storeDir,
        opened: false,
        close: async () => {}
      };
    }
    throw error;
  }

  const address = server.address();
  const actualPort = address && address.port ? address.port : port;
  const actualUrl = `http://${host}:${actualPort}`;
  let opened = false;
  if (truthy(options.open)) {
    const opener = options.openUrl || openUrl;
    opener(actualUrl);
    opened = true;
  }

  return {
    enabled: true,
    started: true,
    status: "started",
    host,
    port: actualPort,
    url: actualUrl,
    storeDir: server.storeDir,
    opened,
    close: () => closeServer(server)
  };
}

function openUrl(url) {
  if (process.platform === "win32") {
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }).unref();
  }

  const command = process.platform === "darwin" ? "open" : "xdg-open";
  return spawn(command, [url], {
    detached: true,
    stdio: "ignore"
  }).unref();
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function isAdminAlreadyRunning(url) {
  try {
    const response = await fetch(`${url}/api/health`);
    if (!response.ok) return false;
    const health = await response.json();
    return health && health.name === "auralis-codenator-admin";
  } catch (_error) {
    return false;
  }
}

function createDisabledDashboard() {
  return {
    enabled: false,
    started: false,
    status: "disabled",
    opened: false,
    close: async () => {}
  };
}

function truthy(value) {
  return value === true || value === "true" || value === "1" || value === "yes";
}

module.exports = {
  openUrl,
  shouldStartAdminDashboard,
  startDaemonAdminDashboard
};
