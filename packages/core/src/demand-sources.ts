/**
 * Demand-source contracts are deliberately disconnected from live ingress until
 * their individual readiness evidence is recorded. They contain no partner or
 * customer data: that proof belongs in the external approval record.
 */
export const demandProviders = ["gitlab", "jira", "datadog"] as const;
export type DemandProvider = (typeof demandProviders)[number];
export type ReadinessStatus = "unavailable" | "recorded";

export type ProviderReadiness = {
  provider: DemandProvider;
  status: ReadinessStatus;
  approvalReference?: string;
  eventMatrixVersion: string;
  gateEvidence: ReadinessStatus;
};

export const providerReadinessManifest: readonly ProviderReadiness[] = demandProviders.map(
  (provider) => ({ provider, status: "unavailable", eventMatrixVersion: "v1", gateEvidence: "unavailable" }),
);

export const supportedEventMatrix = {
  gitlab: ["Merge Request Hook", "Pipeline Hook", "Job Hook"],
  jira: ["jira:issue_created", "jira:issue_updated", "comment_created"],
  datadog: ["monitor_alert_transition"],
} as const satisfies Record<DemandProvider, readonly string[]>;

export function providerGateOpen(provider: DemandProvider, manifest = providerReadinessManifest): boolean {
  const record = manifest.find((candidate) => candidate.provider === provider);
  return Boolean(record && record.status === "recorded" && record.gateEvidence === "recorded" && record.approvalReference);
}

export type ProviderMapping = {
  provider: DemandProvider;
  providerAccountId: string;
  resourceId: string;
  workspaceId: string;
  installationId: string;
  credentialVersion: number;
  mode: "local" | "hosted";
  state: "pending" | "connected" | "degraded" | "permission-drift" | "revoked" | "removed";
};

/** Server-side attestation and explicit owner confirmation are both required. */
export function establishProviderMapping(
  mappings: readonly ProviderMapping[],
  mapping: ProviderMapping,
  input: { attested: boolean; ownerConfirmed: boolean },
): ProviderMapping {
  if (!input.attested || !input.ownerConfirmed) throw new Error("Provider attestation and owner confirmation are required.");
  const conflict = mappings.find(
    (candidate) => candidate.provider === mapping.provider && candidate.providerAccountId === mapping.providerAccountId && candidate.resourceId === mapping.resourceId,
  );
  if (conflict && conflict.workspaceId !== mapping.workspaceId) throw new Error("Provider resource is already mapped to another workspace.");
  return mapping;
}

export function acceptsProviderEvent(provider: DemandProvider, event: string, schemaVersion: string): boolean {
  return schemaVersion === "v1" && (supportedEventMatrix[provider] as readonly string[]).includes(event);
}

/** Datadog durable evidence deliberately excludes continuous payloads and bodies. */
export function normalizeDatadogMonitorTransition(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  if (payload.type !== "monitor_alert_transition") return undefined;
  const monitor = payload.monitor as Record<string, unknown> | undefined;
  const transition = payload.transition as Record<string, unknown> | undefined;
  if (!monitor || !transition || typeof monitor.id !== "string" || typeof transition.status !== "string" || typeof transition.at !== "string") return undefined;
  const tags = Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string" && /^(service|env|team):/.test(tag)) : [];
  return { monitorId: monitor.id, status: transition.status, at: transition.at, tags };
}
