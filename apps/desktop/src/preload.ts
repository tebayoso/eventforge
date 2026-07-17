import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("eventforgeDesktop", {
  localDaemonUrl: "http://127.0.0.1:4311",
  controlPlaneUrl: process.env.EVENTFORGE_API_URL ?? "http://127.0.0.1:4310"
});
