import { describe, expect, it } from "vitest";
import { ConnectorManifestSchema, canInstall, canRunDuringMarketplaceOutage, requiresFreshConsent } from "../src/index.js";

const manifest = ConnectorManifestSchema.parse({ sdkSchemaVersion: "1", packageId: "acme.github", version: "1.0.0", publisherId: "acme", entrypoint: "dist/index.js", entrypointDigest: `sha256:${"a".repeat(64)}`, capabilities: ["source.ingest.v1"], capabilityVersions: { "source.ingest.v1": "1" }, scope: { resources: ["github:repo:acme/app"], destinations: [], dataClasses: ["operational"], secrets: ["github-webhook"] }, dataHandling: { classification: ["operational"], retention: "30d" }, eventforge: { min: "1.0.0", max: "1.0.0" }, providerCompatibility: { github: "2022-11-28" }, dependencies: [], provenance: { sourceDigest: `sha256:${"b".repeat(64)}`, buildDigest: `sha256:${"c".repeat(64)}` }, support: { channel: "mailto:support@acme.test", changelog: "https://acme.test/changelog" }, signatureRef: "sigstore://acme.github/1.0.0" });
const review = { state: "reviewed" as const, reviewedAt: "2026-07-22T00:00:00.000Z", expiresAt: "2027-07-22T00:00:00.000Z", reviewerId: "security" };
const runtime = { coreVersion: "1.0.0", capabilities: ["source.ingest.v1"] as const };

describe("governed SDK foundation", () => {
  it("fails closed without #8 artifact trust, valid review, exact consent, or compatible capabilities", () => {
    expect(canInstall({ manifest, review, runtime, ownerRecentMfa: true, exactDigestApproved: true, trust: { artifactTrustAvailable: false, signatureValid: true, revoked: false } })).toBe(false);
    expect(canInstall({ manifest, review, runtime, ownerRecentMfa: true, exactDigestApproved: true, trust: { artifactTrustAvailable: true, signatureValid: true, revoked: false } })).toBe(true);
  });
  it("requires new consent for scope or capability expansion and stops stale outage runs", () => {
    expect(requiresFreshConsent(manifest, { ...manifest, scope: { ...manifest.scope, destinations: ["https://new.example"] } })).toBe(true);
    expect(canRunDuringMarketplaceOutage({ artifactTrustAvailable: true, signatureValid: true, revoked: false, revocationSnapshotAgeMinutes: 16 })).toBe(false);
    expect(canRunDuringMarketplaceOutage({ artifactTrustAvailable: true, signatureValid: true, revoked: false, revocationSnapshotAgeMinutes: 15 })).toBe(true);
  });
});
