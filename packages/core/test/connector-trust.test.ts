import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DenySandboxProvider,
  approvalEligible,
  canonicalJson,
  createManifest,
  installEligible,
  manifestDigest,
  sha256,
  signManifest,
  verifyEnvelope,
} from "../src/index.js";

const keys = generateKeyPairSync("ed25519");
const subjects = Object.fromEntries(
  ["source", "build", "lock", "sbom", "validation", "scope", "compatibility", "scannerPolicy"].map(
    (name) => [name, sha256(name)],
  ),
) as any;
const manifest = createManifest({
  subjects,
  scope: {
    network: [],
    secretAliases: [],
    filesystem: [],
    providerResources: [],
    actions: [],
    runtime: { cpuMs: 1, memoryMb: 1, pidLimit: 1, timeoutMs: 1 },
  },
  provenance: "test",
  expiresAt: "2030-01-01T00:00:00.000Z",
  signerKeyId: "key-1",
});
const signers = new Map([
  [
    "key-1",
    {
      id: "key-1",
      publicKey: keys.publicKey,
      state: "active" as const,
      validUntil: "2031-01-01T00:00:00.000Z",
    },
  ],
]);
const envelope = signManifest(manifest, "key-1", keys.privateKey);
describe("connector trust", () => {
  it("canonicalizes, signs, and rejects tampering or unavailable keys", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(verifyEnvelope(envelope, signers)).toEqual(manifest);
    expect(() =>
      verifyEnvelope({ ...envelope, payload: Buffer.from("{}").toString("base64") }, signers),
    ).toThrow();
    expect(() => signManifest(manifest, "key-1")).toThrow("closed");
  });
  it("binds approval to every mutable security subject and never bypasses critical findings", () => {
    const approval = {
      artifactDigest: manifestDigest(manifest),
      scopeDigest: subjects.scope,
      validationDigest: subjects.validation,
      scannerPolicyDigest: subjects.scannerPolicy,
      compatibilityDigest: subjects.compatibility,
      ownerId: "owner",
      approvedAt: "2029-12-31T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
    expect(
      approvalEligible(manifest, approval, { id: "owner", role: "owner", mfaRecent: true }, []),
    ).toBe(true);
    expect(
      approvalEligible(manifest, approval, { id: "owner", role: "owner", mfaRecent: false }, []),
    ).toBe(false);
    expect(
      approvalEligible(manifest, approval, { id: "owner", role: "owner", mfaRecent: true }, [
        { severity: "critical", code: "malware" },
      ]),
    ).toBe(false);
    expect(
      installEligible(
        envelope,
        signers,
        approval,
        { id: "owner", role: "owner", mfaRecent: true },
        [],
        new DenySandboxProvider(),
      ),
    ).toBe(false);
  });
  it("rejects revoked signers", () => {
    signers.get("key-1")!.state = "revoked";
    expect(() => verifyEnvelope(envelope, signers)).toThrow("ineligible");
  });
});
