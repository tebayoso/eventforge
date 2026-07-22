import { createHash, verify } from "node:crypto";
import type { PolicyDecision, PolicyPackManifest, PolicyRequest } from "./contracts.js";
import { POLICY_EVALUATOR_VERSION, evaluatePolicy } from "./workflows.js";

/** Canonical JSON is deliberately restricted to JSON-compatible manifest values. */
export function canonicalManifest(manifest: PolicyPackManifest): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, sort(child)]),
      );
    return value;
  };
  return JSON.stringify(sort(manifest));
}

export function manifestDigest(manifest: PolicyPackManifest): string {
  return createHash("sha256").update(canonicalManifest(manifest)).digest("hex");
}

export type TrustedSigner = { keyId: string; publicKey: string; revoked?: boolean };
export function verifyPackImport(input: {
  manifest: PolicyPackManifest;
  signature: string;
  keyId: string;
  trust: TrustedSigner[];
  now?: Date;
}): { ok: boolean; reason?: string; digest: string } {
  const digest = manifestDigest(input.manifest);
  const signer = input.trust.find((key) => key.keyId === input.keyId);
  if (!signer || signer.revoked) return { ok: false, reason: "untrusted_signer", digest };
  if (input.manifest.evaluatorVersion !== POLICY_EVALUATOR_VERSION)
    return { ok: false, reason: "incompatible_evaluator", digest };
  if (input.manifest.expiresAt && new Date(input.manifest.expiresAt) <= (input.now ?? new Date()))
    return { ok: false, reason: "expired", digest };
  return verify(
    null,
    Buffer.from(canonicalManifest(input.manifest)),
    signer.publicKey,
    Buffer.from(input.signature, "base64"),
  )
    ? { ok: true, digest }
    : { ok: false, reason: "invalid_signature", digest };
}

export type SimulationInput = {
  id: string;
  request: PolicyRequest;
  retained: boolean;
  authorized: boolean;
};
export function simulatePolicy(
  manifest: PolicyPackManifest,
  inputs: SimulationInput[],
): {
  status: "complete" | "partial" | "blocked" | "cancelled";
  evaluated: number;
  eligible: number;
  decisions: Array<{ id: string; decision?: PolicyDecision; reason?: string }>;
} {
  if (inputs.length > 10_000)
    return {
      status: "blocked",
      evaluated: 0,
      eligible: 0,
      decisions: [{ id: "job", reason: "input_limit_exceeded" }],
    };
  const decisions = inputs.map((input) => {
    if (!input.retained) return { id: input.id, reason: "evidence_not_retained" };
    if (!input.authorized) return { id: input.id, reason: "authorization_lost" };
    return { id: input.id, decision: evaluatePolicy(manifest.policy, input.request) };
  });
  const evaluated = decisions.filter((entry) => entry.decision).length;
  const eligible = inputs.filter((input) => input.retained && input.authorized).length;
  return {
    status: evaluated === inputs.length ? "complete" : evaluated ? "partial" : "blocked",
    evaluated,
    eligible,
    decisions,
  };
}
