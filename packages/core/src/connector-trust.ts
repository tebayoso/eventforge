import { createHash, sign, verify, type KeyObject } from "node:crypto";
import { z } from "zod";

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const ConnectorSubjectsSchema = z.object({
  source: Sha256,
  build: Sha256,
  lock: Sha256,
  sbom: Sha256,
  validation: Sha256,
  scope: Sha256,
  compatibility: Sha256,
  scannerPolicy: Sha256,
});
const ApprovalDigestsSchema = z.object({
  artifactDigest: Sha256,
  scopeDigest: Sha256,
  validationDigest: Sha256,
  scannerPolicyDigest: Sha256,
  compatibilityDigest: Sha256,
});
/**
 * Expiry gates fail closed: an absent, non-string or unparseable timestamp is
 * treated as already expired instead of as "never expires". `Date.parse` yields
 * NaN for junk input, and every NaN comparison is false, so a raw
 * `Date.parse(value) <= now` check would silently disable the gate.
 */
const validAt = (value: unknown, atMs: number): boolean => {
  if (typeof value !== "string") return false;
  const expiresAtMs = Date.parse(value);
  return Number.isFinite(expiresAtMs) && expiresAtMs > atMs;
};
export const ConnectorScopeSchema = z.object({
  network: z
    .array(
      z.object({
        destination: z.string().min(1),
        ports: z.array(z.number().int().min(1).max(65535)).min(1),
      }),
    )
    .default([]),
  secretAliases: z.array(z.string().min(1)).default([]),
  filesystem: z
    .array(z.object({ path: z.string().min(1), mode: z.enum(["read", "write"]) }))
    .default([]),
  providerResources: z
    .array(z.object({ provider: z.string().min(1), resource: z.string().min(1) }))
    .default([]),
  actions: z.array(z.string().min(1)).default([]),
  runtime: z
    .object({
      cpuMs: z.number().int().positive(),
      memoryMb: z.number().int().positive(),
      pidLimit: z.number().int().positive(),
      timeoutMs: z.number().int().positive(),
    })
    .default({ cpuMs: 0, memoryMb: 0, pidLimit: 0, timeoutMs: 0 }),
});
export type ConnectorScope = z.infer<typeof ConnectorScopeSchema>;

export type ConnectorSubjects = Record<
  "source" | "build" | "lock" | "sbom" | "validation" | "scope" | "compatibility" | "scannerPolicy",
  string
>;
export type ConnectorManifest = {
  version: 1;
  subjects: ConnectorSubjects;
  scope: ConnectorScope;
  provenance: string;
  expiresAt: string;
  signerKeyId: string;
};
export type DsseEnvelope = {
  payloadType: "application/vnd.eventforge.connector-manifest+jcs";
  payload: string;
  signatures: Array<{ keyid: string; sig: string }>;
};
export type Signer = {
  id: string;
  publicKey: string | Buffer | KeyObject;
  state: "active" | "revoked" | "compromised";
  validUntil: string;
};
export type Approval = {
  artifactDigest: string;
  scopeDigest: string;
  validationDigest: string;
  scannerPolicyDigest: string;
  compatibilityDigest: string;
  ownerId: string;
  approvedAt: string;
  expiresAt: string;
};
export type Finding = { severity: "critical" | "high" | "medium" | "low"; code: string };

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JCS rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object")
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  throw new Error("JCS rejects unsupported values");
}
export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const manifestDigest = (manifest: ConnectorManifest) => sha256(canonicalJson(manifest));

export function createManifest(input: Omit<ConnectorManifest, "version">): ConnectorManifest {
  ConnectorScopeSchema.parse(input.scope);
  for (const digest of Object.values(input.subjects)) Sha256.parse(digest);
  if (!validAt(input.expiresAt, Date.now()))
    throw new Error("Artifact expiry must be a parseable timestamp in the future");
  return { version: 1, ...input };
}
export function signManifest(
  manifest: ConnectorManifest,
  keyId: string,
  privateKey?: string | Buffer | KeyObject,
): DsseEnvelope {
  if (!privateKey) throw new Error("Managed signing key unavailable; production signing is closed");
  const payload = canonicalJson(manifest);
  return {
    payloadType: "application/vnd.eventforge.connector-manifest+jcs",
    payload: Buffer.from(payload).toString("base64"),
    signatures: [
      { keyid: keyId, sig: sign(null, Buffer.from(payload), privateKey).toString("base64") },
    ],
  };
}
export function verifyEnvelope(
  envelope: DsseEnvelope,
  signers: Map<string, Signer>,
  now = new Date(),
): ConnectorManifest {
  if (
    envelope.payloadType !== "application/vnd.eventforge.connector-manifest+jcs" ||
    envelope.signatures.length !== 1
  )
    throw new Error("Invalid connector DSSE envelope");
  const decoded: unknown = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  const payload = canonicalJson(decoded);
  if (Buffer.from(payload).toString("base64") !== envelope.payload)
    throw new Error("Manifest is not canonical JCS");
  if (!ConnectorSubjectsSchema.safeParse((decoded as ConnectorManifest | null)?.subjects).success)
    throw new Error("Manifest subjects are not complete SHA-256 digests");
  const manifest = decoded as ConnectorManifest;
  const signature = envelope.signatures[0];
  if (!signature) throw new Error("Invalid connector DSSE envelope");
  const signer = signers.get(signature.keyid);
  if (
    !signer ||
    signer.id !== manifest.signerKeyId ||
    signer.state !== "active" ||
    !validAt(signer.validUntil, now.getTime()) ||
    !validAt(manifest.expiresAt, now.getTime())
  )
    throw new Error("Signer or artifact is ineligible");
  if (!verify(null, Buffer.from(payload), signer.publicKey, Buffer.from(signature.sig, "base64")))
    throw new Error("Invalid connector signature");
  return manifest;
}
export function approvalEligible(
  manifest: ConnectorManifest,
  approval: Approval | undefined,
  actor: { id: string; role: string; mfaRecent: boolean },
  findings: Finding[],
  now = new Date(),
): boolean {
  if (findings.some((finding) => finding.severity === "critical")) return false;
  if (
    !approval ||
    actor.role !== "owner" ||
    !actor.mfaRecent ||
    approval.ownerId !== actor.id ||
    !validAt(approval.expiresAt, now.getTime())
  )
    return false;
  // Every bound digest must be a real SHA-256 value: comparing two absent
  // digests with `===` would otherwise approve an artifact vacuously.
  if (!ApprovalDigestsSchema.safeParse(approval).success) return false;
  if (!ConnectorSubjectsSchema.safeParse(manifest.subjects).success) return false;
  return (
    approval.artifactDigest === manifestDigest(manifest) &&
    approval.scopeDigest === manifest.subjects.scope &&
    approval.validationDigest === manifest.subjects.validation &&
    approval.scannerPolicyDigest === manifest.subjects.scannerPolicy &&
    approval.compatibilityDigest === manifest.subjects.compatibility
  );
}

export const ValidationStates = [
  "queued",
  "provisioning",
  "building",
  "scanning",
  "testing",
  "cleaning",
  "passed",
  "blocked",
  "failed",
  "cancelled",
  "timed-out",
  "cleanup-failed",
  "expired",
] as const;
export type ValidationState = (typeof ValidationStates)[number];
export interface SandboxProvider {
  readonly available: boolean;
  validate(scope: ConnectorScope): { state: ValidationState; log: string; cleanupProof?: string };
}
export class DenySandboxProvider implements SandboxProvider {
  readonly available = false;
  validate(): { state: ValidationState; log: string } {
    return {
      state: "blocked",
      log: "No disposable sandbox provider: network, filesystem, metadata, provider access, and execution denied.",
    };
  }
}
export function validationGate(provider: SandboxProvider, scope: ConnectorScope) {
  return provider.validate(scope);
}
export function installEligible(
  envelope: DsseEnvelope,
  signers: Map<string, Signer>,
  approval: Approval | undefined,
  actor: { id: string; role: string; mfaRecent: boolean },
  findings: Finding[],
  provider: SandboxProvider,
): boolean {
  const manifest = verifyEnvelope(envelope, signers);
  return provider.available && approvalEligible(manifest, approval, actor, findings);
}
