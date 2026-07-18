import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LocalMemoryDaemon } from "./local-daemon.js";
import { isAllowedNavigation, isSafeExternalUrl } from "./security.js";

const gotSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow: BrowserWindow | undefined;
let daemon: LocalMemoryDaemon | undefined;
let quitting = false;
const controlPlaneUrl = process.env.EVENTFORGE_API_URL ?? "http://127.0.0.1:4310";

function registerIpc(): void {
  ipcMain.handle("eventforge:request", async (_event, path: unknown, init: unknown) => {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//"))
      throw new Error("Invalid EventForge API path.");
    const options =
      init && typeof init === "object"
        ? (init as { method?: unknown; body?: unknown; headers?: unknown })
        : {};
    const method = options.method === undefined ? "GET" : String(options.method).toUpperCase();
    if (method !== "GET" && method !== "POST")
      throw new Error("Unsupported EventForge API method.");
    if (options.body !== undefined && typeof options.body !== "string")
      throw new Error("Invalid EventForge API body.");
    if (typeof options.body === "string" && Buffer.byteLength(options.body) > 1_048_576)
      throw new Error("EventForge API body exceeds the 1 MiB desktop limit.");
    const suppliedHeaders =
      options.headers && typeof options.headers === "object"
        ? (options.headers as Record<string, unknown>)
        : {};
    const headers: Record<string, string> = {};
    for (const name of ["content-type", "idempotency-key"]) {
      const value = suppliedHeaders[name];
      if (typeof value === "string") headers[name] = value;
    }
    const response = await fetch(new URL(path, controlPlaneUrl), {
      method,
      body: options.body as string | undefined,
      headers,
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  });
}

function rendererPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "console", "index.html")
    : join(import.meta.dirname, "..", "..", "console", "dist", "index.html");
}

async function createWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: "#080b14",
    title: "EventForge",
    webPreferences: {
      preload: join(import.meta.dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow = window;

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url, devUrl, pathToFileURL(rendererPath()).toString())) {
      event.preventDefault();
      if (isSafeExternalUrl(url)) void shell.openExternal(url);
    }
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  if (devUrl) await window.loadURL(new URL("/console", devUrl).toString());
  else await window.loadFile(rendererPath());
}

async function start(): Promise<void> {
  registerIpc();
  daemon = new LocalMemoryDaemon(join(app.getPath("userData"), "data"));
  await daemon.start();
  await createWindow();
}

async function shutdown(): Promise<void> {
  if (quitting) return;
  quitting = true;
  await daemon?.stop();
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => void createWindow());
  app
    .whenReady()
    .then(start)
    .catch(async (error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      await dialog.showMessageBox({
        type: "error",
        title: "EventForge could not start",
        message: "The local EventForge service failed to start.",
        detail,
      });
      app.quit();
    });
  app.on("activate", () => void createWindow());
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    void shutdown().finally(() => app.quit());
  });
}
