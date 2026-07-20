#!/usr/bin/env node
import { EventForgeApi } from "../src/client.js";
import { runStdioServer } from "../src/index.js";
import {
  closeEmbeddedControlPlaneOnExit,
  ensureEmbeddedControlPlane,
} from "./embedded-control-plane.js";

async function main(): Promise<void> {
  const controlPlane = await ensureEmbeddedControlPlane();
  closeEmbeddedControlPlaneOnExit(controlPlane);
  await runStdioServer(new EventForgeApi({ baseUrl: controlPlane.baseUrl }));
}

main().catch((error: unknown) => {
  console.error("EventForge MCP failed:", error);
  process.exitCode = 1;
});
