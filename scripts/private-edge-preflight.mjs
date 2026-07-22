#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const blockers = [
  ["D1", "Worker CONTROL_DB and EVENTS_DB require a relational adapter with migration, tenant, audit, and evidence parity."],
  ["R2", "Worker PAYLOADS requires a tenant-scoped encrypted object-store adapter and immutable metadata contract."],
  ["Queues", "Worker INGEST_QUEUE requires a durable queue/dead-letter adapter that preserves accepted delivery."],
  ["Worker cron", "Scheduled outbox publication requires a supported maintenance workload and ownership contract."],
  ["Hosted identity", "OIDC/OAuth workspace-role and MFA request authentication is not implemented for private edge."],
];
const report = {
  status: "blocked_unsupported",
  topology: "helm-eventforge-0.2.0",
  checks: { kubernetes: "unknown", requiredApis: "unknown", storageClass: "unknown", dnsTls: "unknown", ingress: "unknown", networkPolicyEnforcement: "unknown", capacityEnvelope: "unavailable_unmeasured", dependencies: "blocked", keyReferences: "unknown", clock: "unknown", compatibility: "blocked" },
  blockers: blockers.map(([contract, remediation]) => ({ contract, remediation })),
};
if (process.argv.includes("--cluster")) {
  try {
    const version = JSON.parse(execFileSync("kubectl", ["version", "-o", "json"], { encoding: "utf8" }));
    report.checks.kubernetes = version.serverVersion?.gitVersion ?? "unknown";
    report.checks.requiredApis = "observed; private-edge contract blockers remain";
  } catch { report.checks.kubernetes = "blocked: kubectl context/version unavailable"; }
}
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`PRIVATE EDGE: ${report.status}`);
  for (const blocker of report.blockers) console.log(`- ${blocker.contract}: ${blocker.remediation}`);
  console.log("Remediation: implement and exercise every adapter, then add install/node-loss/queue/backup-restore/key/upgrade/rollback evidence.");
}
process.exitCode = 2;
