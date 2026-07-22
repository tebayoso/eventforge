import { z } from "zod";

/** Public, host-mediated connector contract. This is intentionally not a plugin API. */
export const SDK_CORE_VERSION = "1.0.0";
export const CapabilitySchema = z.enum([
  "source.ingest.v1",
  "context.read.v1",
  "notification.send.v1",
]);
export type Capability = z.infer<typeof CapabilitySchema>;

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const SemverRangeSchema = z.string().min(1);
const ScopeSchema = z.object({
  resources: z.array(z.string().min(1)).max(100),
  destinations: z.array(z.string().min(1)).max(100),
  dataClasses: z.array(z.string().min(1)).max(50),
  secrets: z.array(z.string().min(1)).max(50),
});

export const ConnectorManifestSchema = z.object({
  sdkSchemaVersion: z.literal("1"),
  packageId: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  publisherId: z.string().min(1),
  entrypoint: z.string().min(1),
  entrypointDigest: DigestSchema,
  capabilities: z.array(CapabilitySchema).min(1).max(3),
  capabilityVersions: z.record(CapabilitySchema, z.literal("1")),
  scope: ScopeSchema,
  dataHandling: z.object({ classification: z.array(z.string().min(1)), retention: z.string().min(1) }),
  eventforge: z.object({ min: SemverRangeSchema, max: SemverRangeSchema }),
  providerCompatibility: z.record(z.string(), SemverRangeSchema),
  dependencies: z.array(z.object({ name: z.string().min(1), lockDigest: DigestSchema, sbomDigest: DigestSchema })),
  provenance: z.object({ sourceDigest: DigestSchema, buildDigest: DigestSchema }),
  support: z.object({ channel: z.string().min(1), deprecation: z.string().optional(), changelog: z.string().min(1) }),
  signatureRef: z.string().min(1),
}).strict();
export type ConnectorManifest = z.infer<typeof ConnectorManifestSchema>;

export type CapabilityContext = Readonly<{
  tenantId: string; deadline: Date; idempotencyKey: string; signal: AbortSignal;
  logger: { info(message: string, attributes?: Record<string, unknown>): void; error(message: string, attributes?: Record<string, unknown>): void };
}>;
export type CapabilityResult<T> = { status: "success"; value: T } | { status: "denied" | "retry" | "unknown"; reason: string };
export interface SourceIngestCapability { initialize(context: CapabilityContext): Promise<CapabilityResult<void>>; ingest(context: CapabilityContext, delivery: { raw: string; headers: Record<string, string> }): Promise<CapabilityResult<{ event: Record<string, unknown>; provenance: Record<string, unknown>; redactions: string[]; identity: string }>>; health(context: CapabilityContext): Promise<CapabilityResult<void>>; revoke(context: CapabilityContext): Promise<CapabilityResult<void>>; deleteData(context: CapabilityContext): Promise<CapabilityResult<void>>; }
export interface ContextReadCapability { initialize(context: CapabilityContext): Promise<CapabilityResult<void>>; read(context: CapabilityContext, query: { key: string; limit: number }): Promise<CapabilityResult<{ entries: Record<string, unknown>[] }>>; health(context: CapabilityContext): Promise<CapabilityResult<void>>; revoke(context: CapabilityContext): Promise<CapabilityResult<void>>; deleteData(context: CapabilityContext): Promise<CapabilityResult<void>>; }
export interface NotificationSendCapability { initialize(context: CapabilityContext): Promise<CapabilityResult<void>>; send(context: CapabilityContext, notification: { template: "eventforge.safe.v1"; recipient: string; variables: Record<string, string> }): Promise<CapabilityResult<{ deliveryId: string }>>; health(context: CapabilityContext): Promise<CapabilityResult<void>>; revoke(context: CapabilityContext): Promise<CapabilityResult<void>>; deleteData(context: CapabilityContext): Promise<CapabilityResult<void>>; }

export const PublisherStateSchema = z.enum(["applicant", "beta-restricted", "reviewed", "suspended", "removed"]);
export const PublisherApplicationSchema = z.object({ legalIdentity: z.string().min(1), contact: z.string().min(1), domainControl: z.string().min(1), supportChannel: z.string().min(1), vulnerabilityContact: z.string().min(1), criticalAckHours: z.literal(48), dataUseDisclosure: z.string().min(1), signingKey: z.string().min(1), termsAcceptedAt: z.string().datetime(), maintainers: z.array(z.string().min(1)).min(1) });
export const ReviewSchema = z.object({ state: PublisherStateSchema, reviewedAt: z.string().datetime(), expiresAt: z.string().datetime(), reviewerId: z.string().min(1) });

export type TrustServices = { artifactTrustAvailable: boolean; revocationSnapshotAgeMinutes?: number; revoked: boolean; signatureValid: boolean };
export function isCompatible(manifest: ConnectorManifest, runtime: { coreVersion: string; capabilities: Capability[] }): boolean {
  const inRange = runtime.coreVersion >= manifest.eventforge.min && runtime.coreVersion <= manifest.eventforge.max;
  return inRange && manifest.capabilities.every((capability) => runtime.capabilities.includes(capability));
}
export function requiresFreshConsent(previous: ConnectorManifest, next: ConnectorManifest): boolean {
  const before = JSON.stringify(previous.scope); const after = JSON.stringify(next.scope);
  return before !== after || next.capabilities.some((capability) => !previous.capabilities.includes(capability));
}
export function canInstall(input: { manifest: ConnectorManifest; review: z.infer<typeof ReviewSchema>; trust: TrustServices; runtime: { coreVersion: string; capabilities: Capability[] }; ownerRecentMfa: boolean; exactDigestApproved: boolean }): boolean {
  return input.trust.artifactTrustAvailable && input.trust.signatureValid && !input.trust.revoked && input.review.state === "reviewed" && new Date(input.review.expiresAt) > new Date() && input.ownerRecentMfa && input.exactDigestApproved && isCompatible(input.manifest, input.runtime);
}
export function canRunDuringMarketplaceOutage(trust: TrustServices): boolean { return trust.artifactTrustAvailable && !trust.revoked && trust.signatureValid && (trust.revocationSnapshotAgeMinutes ?? Infinity) <= 15; }
