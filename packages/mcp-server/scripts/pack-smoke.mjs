import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scratch = await mkdtemp(join(tmpdir(), "eventforge-mcp-pack-"));
try {
  const output = execFileSync("pnpm", ["pack", "--pack-destination", scratch], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  const archiveName = output.trim().split("\n").at(-1);
  if (!archiveName) throw new Error("pnpm pack did not return an archive path.");
  const archive = archiveName.startsWith("/") ? archiveName : join(scratch, archiveName);

  const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
  for (const required of [
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/package.json",
  ]) {
    if (!listing.includes(required)) throw new Error(`Packed MCP server is missing ${required}.`);
  }

  const installRoot = join(scratch, "install");
  await mkdir(installRoot);
  execFileSync("pnpm", ["add", "--ignore-scripts", "--dir", installRoot, archive], {
    stdio: "pipe",
  });
  const packageJson = JSON.parse(
    await readFile(
      join(installRoot, "node_modules", "@eventforge", "mcp-server", "package.json"),
      "utf8",
    ),
  );
  if (packageJson.bin?.["eventforge-mcp"] !== "./dist/index.js") {
    throw new Error("Packed MCP server does not expose the compiled eventforge-mcp binary.");
  }

  const installedEntrypoint = join(
    installRoot,
    "node_modules",
    "@eventforge",
    "mcp-server",
    "dist",
    "index.js",
  );
  const client = new Client({ name: "eventforge-pack-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [installedEntrypoint],
    env: {
      PATH: `${join(installRoot, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`,
      EVENTFORGE_API_URL: "http://127.0.0.1:1",
    },
    stderr: "inherit",
  });
  await client.connect(transport);
  const tools = await client.listTools();
  await client.close();
  if (tools.tools.length !== 9)
    throw new Error(`Expected 9 MCP tools, found ${tools.tools.length}.`);

  console.log(`Packed and initialized ${packageJson.name}@${packageJson.version} with 9 tools.`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
