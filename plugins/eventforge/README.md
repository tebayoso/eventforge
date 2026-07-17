# EventForge Codex Plugin

Install the plugin after publishing `@eventforge/mcp-server` or linking this repository's package so `eventforge-mcp` is on `PATH`. The MCP server communicates with the local EventForge daemon/control plane at `EVENTFORGE_API_URL`.

The bundled lifecycle hook is intentionally optional and side-effect free. Trust it only after reviewing `hooks/session-start.mjs`.

For a guided view of the local dashboard, GitHub event relay, and Codex review flow, watch the [EventForge demo video](https://youtu.be/pht3rrl--pE).
