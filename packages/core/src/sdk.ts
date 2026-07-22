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
const VersionSchema = z.string().regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/);
const ProviderVersionRangeSchema = z.string().min(1).max(100);
const UnboundedScopePattern = /^(all|any|global|unbounded)$/i;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

const ScopeEntrySchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !containsControlCharacter(value), {
    message: "Scope entries must not contain control characters",
  })
  .refine((value) => !value.includes("*"), {
    message: "Scope entries must not contain wildcards",
  })
  .refine((value) => !UnboundedScopePattern.test(value), {
    message: "Scope entries must identify a bounded target",
  });

function setLikeScopeArray(maximum: number) {
  return z
    .array(ScopeEntrySchema)
    .max(maximum)
    .refine((values) => new Set(values).size === values.length, {
      message: "Scope entries must be unique",
    });
}

const ScopeSchema = z.object({
  resources: setLikeScopeArray(100),
  destinations: setLikeScopeArray(100),
  dataClasses: setLikeScopeArray(50),
  secrets: setLikeScopeArray(50),
});

const RetentionSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,3})d$/, "Retention must be an integer number of days")
  .refine((value) => Number.parseInt(value, 10) <= 3650, {
    message: "Retention must not exceed 3650 days",
  });

export const ConnectorManifestSchema = z
  .object({
    sdkSchemaVersion: z.literal("1"),
    packageId: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
    version: VersionSchema,
    publisherId: z.string().min(1),
    entrypoint: z.string().min(1),
    entrypointDigest: DigestSchema,
    capabilities: z
      .array(CapabilitySchema)
      .min(1)
      .max(3)
      .refine((values) => new Set(values).size === values.length, {
        message: "Capabilities must be unique",
      }),
    capabilityVersions: z.record(CapabilitySchema, z.literal("1")),
    scope: ScopeSchema,
    dataHandling: z.object({
      classification: z.array(z.string().min(1)),
      retention: RetentionSchema,
    }),
    eventforge: z.object({ min: VersionSchema, max: VersionSchema }),
    providerCompatibility: z.record(z.string(), ProviderVersionRangeSchema),
    dependencies: z.array(
      z.object({
        name: z.string().min(1),
        lockDigest: DigestSchema,
        sbomDigest: DigestSchema,
      }),
    ),
    provenance: z.object({
      sourceDigest: DigestSchema,
      buildDigest: DigestSchema,
    }),
    support: z.object({
      channel: z.string().min(1),
      deprecation: z.string().optional(),
      changelog: z.string().min(1),
    }),
    signatureRef: z.string().min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const declaredCapabilities = new Set(manifest.capabilities);
    const versionedCapabilities = Object.keys(manifest.capabilityVersions);
    if (
      versionedCapabilities.length !== declaredCapabilities.size ||
      versionedCapabilities.some(
        (capability) => !declaredCapabilities.has(capability as Capability),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capabilityVersions"],
        message: "Capability versions must exactly match declared capabilities",
      });
    }

    if (compareVersions(manifest.eventforge.min, manifest.eventforge.max) > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eventforge", "min"],
        message: "Minimum EventForge version must not exceed maximum version",
      });
    }
  });
export type ConnectorManifest = z.infer<typeof ConnectorManifestSchema>;

export type CapabilityContext = Readonly<{
  tenantId: string;
  deadline: Date;
  idempotencyKey: string;
  signal: AbortSignal;
  logger: {
    info(message: string, attributes?: Record<string, unknown>): void;
    error(message: string, attributes?: Record<string, unknown>): void;
  };
}>;
export type CapabilityResult<T> =
  { status: "success"; value: T } | { status: "denied" | "retry" | "unknown"; reason: string };
export interface SourceIngestCapability {
  initialize(context: CapabilityContext): Promise<CapabilityResult<void>>;
  ingest(
    context: CapabilityContext,
    delivery: { raw: string; headers: Record<string, string> },
  ): Promise<
    CapabilityResult<{
      event: Record<string, unknown>;
      provenance: Record<string, unknown>;
      redactions: string[];
      identity: string;
    }>
  >;
  health(context: CapabilityContext): Promise<CapabilityResult<void>>;
  revoke(context: CapabilityContext): Promise<CapabilityResult<void>>;
  deleteData(context: CapabilityContext): Promise<CapabilityResult<void>>;
}
export interface ContextReadCapability {
  initialize(context: CapabilityContext): Promise<CapabilityResult<void>>;
  read(
    context: CapabilityContext,
    query: { key: string; limit: number },
  ): Promise<CapabilityResult<{ entries: Record<string, unknown>[] }>>;
  health(context: CapabilityContext): Promise<CapabilityResult<void>>;
  revoke(context: CapabilityContext): Promise<CapabilityResult<void>>;
  deleteData(context: CapabilityContext): Promise<CapabilityResult<void>>;
}
export interface NotificationSendCapability {
  initialize(context: CapabilityContext): Promise<CapabilityResult<void>>;
  send(
    context: CapabilityContext,
    notification: {
      template: "eventforge.safe.v1";
      recipient: string;
      variables: Record<string, string>;
    },
  ): Promise<CapabilityResult<{ deliveryId: string }>>;
  health(context: CapabilityContext): Promise<CapabilityResult<void>>;
  revoke(context: CapabilityContext): Promise<CapabilityResult<void>>;
  deleteData(context: CapabilityContext): Promise<CapabilityResult<void>>;
}

const PublicSigningKeySchema = z
  .string()
  .trim()
  .min(32)
  .max(8192)
  .refine(
    (value) =>
      /^did:key:z[1-9A-HJ-NP-Za-km-z]{32,512}$/.test(value) ||
      /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END PUBLIC KEY-----$/.test(
        value,
      ),
    { message: "Signing key must be a bounded did:key or PEM public key" },
  );

export const PublisherStateSchema = z.enum([
  "applicant",
  "beta-restricted",
  "reviewed",
  "suspended",
  "removed",
]);
export const PublisherApplicationSchema = z.object({
  legalIdentity: z.string().min(1),
  contact: z.string().min(1),
  domainControl: z.string().min(1),
  supportChannel: z.string().min(1),
  vulnerabilityContact: z.string().min(1),
  criticalAckHours: z.literal(48),
  dataUseDisclosure: z.string().min(1),
  signingKey: PublicSigningKeySchema,
  termsAcceptedAt: z.string().datetime(),
  maintainers: z.array(z.string().min(1)).min(1),
});
export const ReviewSchema = z.object({
  state: PublisherStateSchema,
  reviewedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  reviewerId: z.string().min(1),
});

export type RevocationEvidence =
  | { source: "marketplace-live"; revoked: boolean }
  | {
      source: "signed-snapshot";
      revoked: boolean;
      signatureValid: boolean;
      ageMinutes: number;
    }
  | { source: "unavailable" };

export type TrustServices = Readonly<{
  artifactTrustAvailable: boolean;
  signatureValid: boolean;
  revocation: RevocationEvidence;
}>;

export type InstallInput = Readonly<{
  manifest: ConnectorManifest;
  review: z.infer<typeof ReviewSchema>;
  trust: TrustServices;
  runtime: { coreVersion: string; capabilities: readonly Capability[] };
  ownerRecentMfa: boolean;
  exactDigestApproved: boolean;
}>;

export type InstallDenialReason =
  | "evaluation-time-invalid"
  | "artifact-trust-unavailable"
  | "signature-invalid"
  | "revocation-status-unavailable"
  | "artifact-revoked"
  | "publisher-not-reviewed"
  | "publisher-review-not-yet-valid"
  | "publisher-review-expired"
  | "owner-recent-mfa-required"
  | "exact-digest-approval-required"
  | "runtime-incompatible";

export type InstallDecision =
  | { allowed: true; reasons: readonly [] }
  | { allowed: false; reasons: readonly InstallDenialReason[] };

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function isCompatible(
  manifest: ConnectorManifest,
  runtime: { coreVersion: string; capabilities: readonly Capability[] },
): boolean {
  if (!VersionSchema.safeParse(runtime.coreVersion).success) return false;
  const inRange =
    compareVersions(runtime.coreVersion, manifest.eventforge.min) >= 0 &&
    compareVersions(runtime.coreVersion, manifest.eventforge.max) <= 0;
  return (
    inRange &&
    manifest.capabilities.every((capability) => runtime.capabilities.includes(capability))
  );
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return new Set(left).size === new Set(right).size && left.every((value) => right.includes(value));
}

export function requiresFreshConsent(
  previous: ConnectorManifest,
  next: ConnectorManifest,
): boolean {
  const scopeChanged = (Object.keys(previous.scope) as (keyof ConnectorManifest["scope"])[]).some(
    (key) => !sameSet(previous.scope[key], next.scope[key]),
  );
  const capabilityExpanded = next.capabilities.some(
    (capability) => !previous.capabilities.includes(capability),
  );
  return scopeChanged || capabilityExpanded;
}

/** Primary installation gate. Reasons are accumulated in stable evaluation order. */
export function evaluateInstall(input: InstallInput, now: Date): InstallDecision {
  const reasons: InstallDenialReason[] = [];
  if (!Number.isFinite(now.getTime())) reasons.push("evaluation-time-invalid");
  if (!input.trust.artifactTrustAvailable) reasons.push("artifact-trust-unavailable");
  if (!input.trust.signatureValid) reasons.push("signature-invalid");
  if (input.trust.revocation.source !== "marketplace-live") {
    reasons.push("revocation-status-unavailable");
  } else if (input.trust.revocation.revoked) {
    reasons.push("artifact-revoked");
  }
  if (input.review.state !== "reviewed") reasons.push("publisher-not-reviewed");
  if (new Date(input.review.reviewedAt) > now) reasons.push("publisher-review-not-yet-valid");
  if (new Date(input.review.expiresAt) <= now) reasons.push("publisher-review-expired");
  if (!input.ownerRecentMfa) reasons.push("owner-recent-mfa-required");
  if (!input.exactDigestApproved) reasons.push("exact-digest-approval-required");
  if (!isCompatible(input.manifest, input.runtime)) reasons.push("runtime-incompatible");
  return reasons.length === 0 ? { allowed: true, reasons: [] } : { allowed: false, reasons };
}

/** Compatibility helper for callers that only need the final allow/deny result. */
export function canInstall(input: InstallInput, now: Date): boolean {
  return evaluateInstall(input, now).allowed;
}

export type OutageExecutionInput = Readonly<{
  existingExactInstallation: boolean;
  trust: TrustServices;
}>;

export function canRunDuringMarketplaceOutage(input: OutageExecutionInput): boolean {
  const { trust } = input;
  if (
    !input.existingExactInstallation ||
    !trust.artifactTrustAvailable ||
    !trust.signatureValid ||
    trust.revocation.source !== "signed-snapshot"
  ) {
    return false;
  }

  const snapshotAge = trust.revocation.ageMinutes;
  return (
    trust.revocation.signatureValid &&
    !trust.revocation.revoked &&
    Number.isFinite(snapshotAge) &&
    snapshotAge >= 0 &&
    snapshotAge <= 15
  );
}
