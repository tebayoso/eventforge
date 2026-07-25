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
  type ConnectorSubjects,
  type Signer,
  validationGate,
  verifyEnvelope,
} from "../src/connector-trust.js";

const keys = generateKeyPairSync("ed25519");
const subjects = Object.fromEntries(
  ["source", "build", "lock", "sbom", "validation", "scope", "compatibility", "scannerPolicy"].map(
    (name) => [name, sha256(name)],
  ),
) as ConnectorSubjects;
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
const signers = new Map<string, Signer>([
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
    for (const field of [
      "artifactDigest",
      "scopeDigest",
      "validationDigest",
      "scannerPolicyDigest",
      "compatibilityDigest",
    ] as const) {
      expect(
        approvalEligible(
          manifest,
          { ...approval, [field]: sha256(`rebound-${field}`) },
          { id: "owner", role: "owner", mfaRecent: true },
          [],
        ),
        `${field} must be bound`,
      ).toBe(false);
    }
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

describe("connector trust fails closed on unusable inputs", () => {
  const activeSigners = (validUntil: string) =>
    new Map([
      ["key-1", { id: "key-1", publicKey: keys.publicKey, state: "active" as const, validUntil }],
    ]);
  const baseApproval = {
    artifactDigest: manifestDigest(manifest),
    scopeDigest: subjects.scope,
    validationDigest: subjects.validation,
    scannerPolicyDigest: subjects.scannerPolicy,
    compatibilityDigest: subjects.compatibility,
    ownerId: "owner",
    approvedAt: "2029-12-31T00:00:00.000Z",
    expiresAt: "2030-01-01T00:00:00.000Z",
  };
  const owner = { id: "owner", role: "owner", mfaRecent: true };

  it("refuses to mint a manifest whose expiry is not a parseable timestamp", () => {
    expect(() =>
      createManifest({
        subjects,
        scope: manifest.scope,
        provenance: "test",
        expiresAt: "not-a-date",
        signerKeyId: "key-1",
      }),
    ).toThrow("parseable timestamp");
  });

  it("treats an unparseable signer validity or artifact expiry as expired, not as eternal", () => {
    expect(() => verifyEnvelope(envelope, activeSigners("whenever"))).toThrow("ineligible");
    expect(() =>
      verifyEnvelope(envelope, activeSigners("2031-01-01T00:00:00.000Z"), new Date("2099-01-01Z")),
    ).toThrow("ineligible");
    const forged = signManifest({ ...manifest, expiresAt: "eventually" }, "key-1", keys.privateKey);
    expect(() => verifyEnvelope(forged, activeSigners("2031-01-01T00:00:00.000Z"))).toThrow(
      "ineligible",
    );
  });

  it("treats an unparseable approval expiry as expired, not as eternal", () => {
    expect(approvalEligible(manifest, { ...baseApproval, expiresAt: "whenever" }, owner, [])).toBe(
      false,
    );
  });

  it("rejects a signed manifest whose security subjects are absent or malformed", () => {
    for (const badSubjects of [{}, { ...subjects, scope: "short" }, "nope"]) {
      const forged = signManifest(
        { ...manifest, subjects: badSubjects } as unknown as typeof manifest,
        "key-1",
        keys.privateKey,
      );
      expect(() => verifyEnvelope(forged, activeSigners("2031-01-01T00:00:00.000Z"))).toThrow(
        "SHA-256",
      );
    }
  });

  it("never approves an artifact by matching two absent digests", () => {
    const bareManifest = { ...manifest, subjects: {} } as unknown as typeof manifest;
    const bareApproval = {
      ownerId: "owner",
      approvedAt: "2029-12-31T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z",
    } as unknown as typeof baseApproval;
    expect(approvalEligible(bareManifest, bareApproval, owner, [])).toBe(false);
    expect(
      approvalEligible(
        bareManifest,
        { ...bareApproval, artifactDigest: manifestDigest(bareManifest) },
        owner,
        [],
      ),
    ).toBe(false);
  });

  it("keeps installation closed while no sandbox provider is available", () => {
    expect(new DenySandboxProvider().available).toBe(false);
    expect(validationGate(new DenySandboxProvider(), manifest.scope).state).toBe("blocked");
    expect(
      installEligible(
        envelope,
        activeSigners("2031-01-01T00:00:00.000Z"),
        baseApproval,
        owner,
        [],
        new DenySandboxProvider(),
      ),
    ).toBe(false);
  });
});
