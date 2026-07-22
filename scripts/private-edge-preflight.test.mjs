import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["scripts/private-edge-preflight.mjs", "--json"], { encoding: "utf8" });
assert.equal(result.status, 2, "unsupported private-edge must fail closed");
const report = JSON.parse(result.stdout);
assert.equal(report.status, "blocked_unsupported");
assert.equal(report.checks.capacityEnvelope, "unavailable_unmeasured");
assert.ok(report.blockers.some(({ contract }) => contract === "Hosted identity"));
assert.doesNotMatch(result.stdout, /secret|token|password/i, "report must not disclose secrets");
