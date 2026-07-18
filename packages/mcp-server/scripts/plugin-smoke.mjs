import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repositoryPlugin = resolve("plugins/eventforge");
const scratch = await mkdtemp(join(tmpdir(), "eventforge-plugin-"));
const installedPlugin = join(scratch, "eventforge");

try {
  await cp(repositoryPlugin, installedPlugin, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(installedPlugin, ".codex-plugin", "plugin.json"), "utf8"),
  );
  const mcpConfig = JSON.parse(await readFile(join(installedPlugin, ".mcp.json"), "utf8"));
  const configuredServer = mcpConfig.mcpServers?.eventforge;
  if (manifest.mcpServers !== "./.mcp.json" || !configuredServer) {
    throw new Error("Installed EventForge plugin does not reference its MCP configuration.");
  }

  const substitutePluginRoot = (value) => value.replaceAll("${PLUGIN_ROOT}", installedPlugin);
  const client = new Client({ name: "eventforge-plugin-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: configuredServer.command,
    args: (configuredServer.args ?? []).map(substitutePluginRoot),
    env: {
      ...process.env,
      ...configuredServer.env,
      PLUGIN_ROOT: installedPlugin,
    },
    stderr: "pipe",
  });
  await client.connect(transport);
  const result = await client.listTools();
  await client.close();

  if (result.tools.length !== 9) {
    throw new Error(
      `Installed EventForge plugin exposed ${result.tools.length} tools instead of 9.`,
    );
  }
  console.log(
    `Installed plugin initialized ${result.tools.length} MCP tools from its bundled server.`,
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
