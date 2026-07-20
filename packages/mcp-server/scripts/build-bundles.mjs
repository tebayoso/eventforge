import { build } from "esbuild";

const target = process.argv[2];
if (target !== "package" && target !== "plugin") {
  throw new Error("Build target must be package or plugin.");
}

const common = {
  bundle: true,
  legalComments: "none",
  minify: true,
  platform: "node",
  sourcemap: false,
  target: "node20",
};

if (target === "package") {
  await Promise.all([
    build({
      ...common,
      entryPoints: ["scripts/standalone-entry.ts"],
      format: "cjs",
      logOverride: { "empty-import-meta": "silent" },
      outfile: "dist/standalone.cjs",
    }),
    build({
      ...common,
      entryPoints: ["scripts/http-standalone-entry.ts"],
      format: "cjs",
      logOverride: { "empty-import-meta": "silent" },
      outfile: "dist/http-standalone.cjs",
    }),
  ]);
} else {
  await Promise.all([
    build({
      ...common,
      entryPoints: ["src/index.ts"],
      format: "esm",
      outfile: "../../plugins/eventforge/server/eventforge-mcp.mjs",
    }),
    build({
      ...common,
      entryPoints: ["scripts/standalone-entry.ts"],
      format: "cjs",
      logOverride: { "empty-import-meta": "silent" },
      outfile: "../../plugins/eventforge/server/eventforge-standalone.cjs",
    }),
    build({
      ...common,
      entryPoints: ["scripts/http-standalone-entry.ts"],
      format: "cjs",
      logOverride: { "empty-import-meta": "silent" },
      outfile: "../../plugins/eventforge/server/eventforge-mcp-http.cjs",
    }),
  ]);
}
