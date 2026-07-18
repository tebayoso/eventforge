# EventForge MCP server

The EventForge MCP server exposes policy-gated event, memory, agent-run, approval, and connector-forging tools to Codex.

From this repository, validate the publishable tarball with `pnpm pack:check`. After the package is published, `pnpm add --global @eventforge/mcp-server` exposes `eventforge-mcp`; the bundled Codex plugin does not require that global installation.

The stdio transport is the default and requires a local EventForge control plane at `http://127.0.0.1:4310`. Override it with `EVENTFORGE_API_URL`.

An opt-in Streamable HTTP transport is available as `eventforge-mcp-http`. It serves `/mcp` on `127.0.0.1:4312` by default so it does not collide with Electron's local-memory daemon on port 4311. Override the loopback host/port with `EVENTFORGE_MCP_HOST` and `EVENTFORGE_MCP_PORT`; `EVENTFORGE_MCP_BEARER_TOKEN` may protect loopback access. Non-loopback binding fails closed until EventForge's OAuth 2.1 authorization layer is available; a static token never enables remote access.
