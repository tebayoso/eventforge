import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { LocalMemoryDaemon } from "./local-daemon.js";

const daemon = new LocalMemoryDaemon();
let window: BrowserWindow | undefined;

async function createWindow(): Promise<void> {
  await daemon.start();
  window = new BrowserWindow({ width: 1440, height: 920, minWidth: 960, minHeight: 680, backgroundColor: "#080b14", title: "EventForge", webPreferences: { preload: join(import.meta.dirname, "preload.js"), contextIsolation: true, nodeIntegration: false } });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(join(import.meta.dirname, "../../console/dist/index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { void daemon.stop(); });
