import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Disable analytics in the beta bundle.
//
// `public/analytics-config.json` is copied verbatim into `dist/` by Vite and is
// fetched at RUNTIME by src/analytics.ts, where it overrides the build-time
// VITE_* fallbacks. So blanking the env vars in .env.beta is not enough on its
// own — the shipped static file still carried the production PostHog key and GA4
// measurement id, and beta sessions reported into the production project.
//
// A blank field falls back to the build-time env value, which .env.beta also
// leaves blank, and both providers are gated on a non-empty key. Blank here plus
// blank there means analytics stays off on beta.

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const target = join(dist, "analytics-config.json");

const disabled = { posthogKey: "", posthogHost: "", gaMeasurementId: "" };

await writeFile(target, `${JSON.stringify(disabled, null, 2)}\n`, "utf8");

// Fail the build rather than ship a bundle that still reports to production.
const written = JSON.parse(await readFile(target, "utf8"));
const leaked = Object.entries(written).filter(([, value]) => String(value).trim() !== "");
if (leaked.length > 0) {
  throw new Error(
    `beta analytics config must be blank, found: ${leaked.map(([k]) => k).join(", ")}`,
  );
}

console.log("beta analytics config written (analytics disabled):", target);
