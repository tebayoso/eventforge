import { describe, expect, it } from "vitest";
import {
  ConnectorManifestSchema,
  PublisherApplicationSchema,
  canInstall,
  canRunDuringMarketplaceOutage,
  evaluateInstall,
  requiresFreshConsent,
  type InstallDenialReason,
  type InstallInput,
  type RevocationEvidence,
  type TrustServices,
} from "../src/index.js";

const NOW = new Date("2026-07-22T12:00:00.000Z");
const digest = (character: string) => `sha256:${character.repeat(64)}`;

const manifest = ConnectorManifestSchema.parse({
  sdkSchemaVersion: "1",
  packageId: "acme.github",
  version: "1.0.0",
  publisherId: "acme",
  entrypoint: "dist/index.js",
  entrypointDigest: digest("a"),
  capabilities: ["source.ingest.v1"],
  capabilityVersions: { "source.ingest.v1": "1" },
  scope: {
    resources: ["github:repo:acme/app"],
    destinations: [],
    dataClasses: ["operational"],
    secrets: ["github-webhook"],
  },
  dataHandling: { classification: ["operational"], retention: "30d" },
  eventforge: { min: "1.0.0", max: "1.0.0" },
  providerCompatibility: { github: "2022-11-28" },
  dependencies: [],
  provenance: { sourceDigest: digest("b"), buildDigest: digest("c") },
  support: {
    channel: "mailto:support@acme.test",
    changelog: "https://acme.test/changelog",
  },
  signatureRef: "sigstore://acme.github/1.0.0",
});

const review = {
  state: "reviewed" as const,
  reviewedAt: "2026-07-22T00:00:00.000Z",
  expiresAt: "2027-07-22T00:00:00.000Z",
  reviewerId: "security",
};
const runtime = {
  coreVersion: "1.0.0",
  capabilities: ["source.ingest.v1"] as const,
};
const liveTrust: TrustServices = {
  artifactTrustAvailable: true,
  signatureValid: true,
  revocation: { source: "marketplace-live", revoked: false },
};
const validInstall: InstallInput = {
  manifest,
  review,
  runtime,
  ownerRecentMfa: true,
  exactDigestApproved: true,
  trust: liveTrust,
};

function expectDenied(input: InstallInput, reason: InstallDenialReason): void {
  const decision = evaluateInstall(input, NOW);
  expect(decision.allowed).toBe(false);
  expect(decision.reasons).toContain(reason);
  expect(canInstall(input, NOW)).toBe(false);
}

function snapshotTrust(
  ageMinutes: number,
  overrides: Partial<Extract<RevocationEvidence, { source: "signed-snapshot" }>> = {},
): TrustServices {
  return {
    artifactTrustAvailable: true,
    signatureValid: true,
    revocation: {
      source: "signed-snapshot",
      revoked: false,
      signatureValid: true,
      ageMinutes,
      ...overrides,
    },
  };
}

function canRunDuringOutage(trust: TrustServices, existingExactInstallation = true): boolean {
  return canRunDuringMarketplaceOutage({
    existingExactInstallation,
    trust,
  });
}

describe("governed SDK installation", () => {
  it("returns an affirmative structured decision only when every gate passes", () => {
    expect(evaluateInstall(validInstall, NOW)).toEqual({
      allowed: true,
      reasons: [],
    });
    expect(canInstall(validInstall, NOW)).toBe(true);
  });

  it("reports artifact trust, signature, and live revocation failures", () => {
    expectDenied(
      {
        ...validInstall,
        trust: { ...liveTrust, artifactTrustAvailable: false },
      },
      "artifact-trust-unavailable",
    );
    expectDenied(
      { ...validInstall, trust: { ...liveTrust, signatureValid: false } },
      "signature-invalid",
    );
    expectDenied(
      {
        ...validInstall,
        trust: {
          ...liveTrust,
          revocation: { source: "marketplace-live", revoked: true },
        },
      },
      "artifact-revoked",
    );
    expectDenied(
      {
        ...validInstall,
        trust: {
          ...liveTrust,
          revocation: { source: "unavailable" },
        },
      },
      "revocation-status-unavailable",
    );
    expectDenied({ ...validInstall, trust: snapshotTrust(0) }, "revocation-status-unavailable");
  });

  it("reports publisher review state, activation, and expiry failures at the injected time", () => {
    expectDenied(
      {
        ...validInstall,
        review: { ...review, state: "suspended" },
      },
      "publisher-not-reviewed",
    );
    expectDenied(
      {
        ...validInstall,
        review: {
          ...review,
          reviewedAt: "2026-07-22T12:00:00.001Z",
        },
      },
      "publisher-review-not-yet-valid",
    );
    expectDenied(
      {
        ...validInstall,
        review: { ...review, expiresAt: NOW.toISOString() },
      },
      "publisher-review-expired",
    );
  });

  it("requires recent Owner MFA and approval of the exact digest", () => {
    expectDenied({ ...validInstall, ownerRecentMfa: false }, "owner-recent-mfa-required");
    expectDenied({ ...validInstall, exactDigestApproved: false }, "exact-digest-approval-required");
  });

  it("rejects out-of-range core versions and missing runtime capabilities", () => {
    expectDenied(
      {
        ...validInstall,
        runtime: { ...runtime, coreVersion: "0.9.9" },
      },
      "runtime-incompatible",
    );
    expectDenied(
      {
        ...validInstall,
        runtime: { ...runtime, coreVersion: "1.0.1" },
      },
      "runtime-incompatible",
    );
    expectDenied(
      {
        ...validInstall,
        runtime: { ...runtime, capabilities: [] },
      },
      "runtime-incompatible",
    );
    expectDenied(
      {
        ...validInstall,
        runtime: { ...runtime, coreVersion: "invalid" },
      },
      "runtime-incompatible",
    );
  });

  it("returns denial reasons in deterministic gate order", () => {
    expect(
      evaluateInstall(
        {
          ...validInstall,
          trust: {
            artifactTrustAvailable: false,
            signatureValid: false,
            revocation: { source: "unavailable" },
          },
          ownerRecentMfa: false,
          exactDigestApproved: false,
        },
        NOW,
      ),
    ).toEqual({
      allowed: false,
      reasons: [
        "artifact-trust-unavailable",
        "signature-invalid",
        "revocation-status-unavailable",
        "owner-recent-mfa-required",
        "exact-digest-approval-required",
      ],
    });
  });

  it("fails closed when the caller supplies an invalid evaluation time", () => {
    expect(evaluateInstall(validInstall, new Date(Number.NaN))).toEqual({
      allowed: false,
      reasons: ["evaluation-time-invalid"],
    });
  });
});

describe("manifest validation and consent", () => {
  it("treats reordered set-like scope and capability arrays as equivalent", () => {
    const previous = ConnectorManifestSchema.parse({
      ...manifest,
      capabilities: ["source.ingest.v1", "context.read.v1"],
      capabilityVersions: {
        "source.ingest.v1": "1",
        "context.read.v1": "1",
      },
      scope: {
        resources: ["github:repo:acme/app", "github:repo:acme/api"],
        destinations: ["https://audit.acme.test", "https://ops.acme.test"],
        dataClasses: ["operational", "audit"],
        secrets: ["github-app", "github-webhook"],
      },
    });
    const reordered = ConnectorManifestSchema.parse({
      ...previous,
      capabilities: ["context.read.v1", "source.ingest.v1"],
      scope: {
        resources: [...previous.scope.resources].reverse(),
        destinations: [...previous.scope.destinations].reverse(),
        dataClasses: [...previous.scope.dataClasses].reverse(),
        secrets: [...previous.scope.secrets].reverse(),
      },
    });

    expect(requiresFreshConsent(previous, reordered)).toBe(false);
  });

  it("requires fresh consent for a scope change or capability expansion", () => {
    expect(
      requiresFreshConsent(manifest, {
        ...manifest,
        scope: {
          ...manifest.scope,
          destinations: ["https://new.example"],
        },
      }),
    ).toBe(true);
    expect(
      requiresFreshConsent(manifest, {
        ...manifest,
        capabilities: ["source.ingest.v1", "context.read.v1"],
        capabilityVersions: {
          "source.ingest.v1": "1",
          "context.read.v1": "1",
        },
      }),
    ).toBe(true);
  });

  it.each([
    ["wildcard", "github:repo:acme/*"],
    ["control character", "github:repo:acme/\u0000app"],
    ["unbounded sentinel", "ALL"],
  ])("rejects %s scope entries without assuming a provider resource grammar", (_, entry) => {
    expect(
      ConnectorManifestSchema.safeParse({
        ...manifest,
        scope: { ...manifest.scope, resources: [entry] },
      }).success,
    ).toBe(false);
  });

  it("accepts bounded retention endpoints and rejects malformed or excessive retention", () => {
    for (const retention of ["0d", "3650d"]) {
      expect(
        ConnectorManifestSchema.safeParse({
          ...manifest,
          dataHandling: { ...manifest.dataHandling, retention },
        }).success,
      ).toBe(true);
    }
    for (const retention of ["-1d", "01d", "3651d", "forever"]) {
      expect(
        ConnectorManifestSchema.safeParse({
          ...manifest,
          dataHandling: { ...manifest.dataHandling, retention },
        }).success,
      ).toBe(false);
    }
  });

  it("requires capabilityVersions to exactly match declared capabilities", () => {
    expect(
      ConnectorManifestSchema.safeParse({
        ...manifest,
        capabilityVersions: {},
      }).success,
    ).toBe(false);
    expect(
      ConnectorManifestSchema.safeParse({
        ...manifest,
        capabilityVersions: {
          "source.ingest.v1": "1",
          "context.read.v1": "1",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a minimum core version above the maximum", () => {
    expect(
      ConnectorManifestSchema.safeParse({
        ...manifest,
        eventforge: { min: "2.0.0", max: "1.10.0" },
      }).success,
    ).toBe(false);
    expect(
      ConnectorManifestSchema.safeParse({
        ...manifest,
        eventforge: { min: "1.10.0", max: "2.0.0" },
      }).success,
    ).toBe(true);
  });

  it("accepts bounded public signing keys and rejects secrets, private keys, and oversized input", () => {
    const application = {
      legalIdentity: "Acme, Inc.",
      contact: "security@acme.test",
      domainControl: "acme.test",
      supportChannel: "support@acme.test",
      vulnerabilityContact: "security@acme.test",
      criticalAckHours: 48,
      dataUseDisclosure: "Operational events only",
      signingKey: `did:key:z${"1".repeat(32)}`,
      termsAcceptedAt: NOW.toISOString(),
      maintainers: ["security@acme.test"],
    };

    expect(PublisherApplicationSchema.safeParse(application).success).toBe(true);
    for (const signingKey of [
      "shared-secret",
      "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----",
      `did:key:z${"1".repeat(513)}`,
    ]) {
      expect(
        PublisherApplicationSchema.safeParse({
          ...application,
          signingKey,
        }).success,
      ).toBe(false);
    }
  });
});

describe("marketplace outage execution", () => {
  it("accepts only a valid signed revocation snapshot aged 0 through 15 minutes", () => {
    expect(canRunDuringOutage(snapshotTrust(0))).toBe(true);
    expect(canRunDuringOutage(snapshotTrust(15))).toBe(true);
    expect(canRunDuringOutage(snapshotTrust(16))).toBe(false);
    expect(canRunDuringOutage(snapshotTrust(-1))).toBe(false);
  });

  it("rejects live, unavailable, invalid, revoked, or unsigned revocation evidence", () => {
    expect(canRunDuringOutage(snapshotTrust(0), false)).toBe(false);
    expect(canRunDuringOutage(liveTrust)).toBe(false);
    expect(
      canRunDuringOutage({
        ...liveTrust,
        revocation: { source: "unavailable" },
      }),
    ).toBe(false);
    expect(
      canRunDuringOutage({
        ...snapshotTrust(0),
        artifactTrustAvailable: false,
      }),
    ).toBe(false);
    expect(
      canRunDuringOutage({
        ...snapshotTrust(0),
        signatureValid: false,
      }),
    ).toBe(false);
    expect(canRunDuringOutage(snapshotTrust(0, { revoked: true }))).toBe(false);
    expect(canRunDuringOutage(snapshotTrust(0, { signatureValid: false }))).toBe(false);
  });
});
