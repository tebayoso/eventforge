import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld(
  "eventforgeDesktop",
  Object.freeze({
    localDaemonUrl: "http://127.0.0.1:4311",
    controlPlaneUrl: process.env.EVENTFORGE_API_URL ?? "http://127.0.0.1:4310",
    platform: process.platform,
    request: (
      path: string,
      init: { method?: string; body?: string; headers?: Record<string, string> },
    ) => ipcRenderer.invoke("eventforge:request", path, init),
  }),
);
