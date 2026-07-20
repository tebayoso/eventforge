#!/usr/bin/env node
import { runHttpServer } from "../src/http.js";
import {
  closeEmbeddedControlPlaneOnExit,
  ensureEmbeddedControlPlane,
} from "./embedded-control-plane.js";

async function main(): Promise<void> {
  const controlPlane = await ensureEmbeddedControlPlane();
  closeEmbeddedControlPlaneOnExit(controlPlane);
  await runHttpServer();
}

main().catch((error: unknown) => {
  console.error("EventForge MCP HTTP server failed:", error);
  process.exitCode = 1;
});
