import { z } from "zod";

export const ProviderSchema = z.enum(["github", "linear", "sentry", "custom"]);
export type Provider = z.infer<typeof ProviderSchema>;

export const EventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  provider: ProviderSchema,
  topic: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  occurredAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  signatureStatus: z.enum(["verified", "demo", "unverified"]),
  dedupeKey: z.string().min(1),
  payload: z.record(z.unknown()),
  payloadRef: z.string().optional(),
  redactions: z.array(z.string()).default([])
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export const ApprovalModeSchema = z.enum(["approval_required", "allow_listed_writes"]);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

export const ExecutionPolicySchema = z.object({
  approvalMode: ApprovalModeSchema.default("approval_required"),
  allowedCapabilities: z.array(z.enum(["read", "write_files", "git_commit", "provider_write", "network", "install_plugin"])).default(["read"]),
  allowedRepositories: z.array(z.string()).default([]),
  allowedPaths: z.array(z.string()).default([]),
  allowedDomains: z.array(z.string()).default([]),
  allowedProviders: z.array(ProviderSchema).default([])
});
export type ExecutionPolicy = z.infer<typeof ExecutionPolicySchema>;

export const WorkflowDefinitionSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  trigger: z.object({ provider: ProviderSchema, topic: z.string().min(1) }),
  filters: z.record(z.unknown()).default({}),
  agentProfile: z.enum(["ci-investigator", "issue-triager", "alert-responder", "custom"]),
  memoryScope: z.enum(["project", "workspace"]),
  policy: ExecutionPolicySchema
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export const ActionProposalSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  eventId: z.string().uuid(),
  title: z.string().min(1),
  type: z.enum(["comment", "create_branch", "open_pull_request", "install_connector", "custom"]),
  risk: z.enum(["low", "medium", "high"]),
  requiredCapabilities: z.array(z.string()),
  diff: z.string().optional(),
  status: z.enum(["pending", "approved", "rejected", "executed"]),
  reviewer: z.string().optional(),
  createdAt: z.string().datetime(),
  auditEventIds: z.array(z.string()).default([])
});
export type ActionProposal = z.infer<typeof ActionProposalSchema>;

export const AgentRunSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  eventId: z.string().uuid(),
  threadId: z.string().optional(),
  status: z.enum(["queued", "running", "waiting_for_approval", "completed", "failed"]),
  summary: z.string().optional(),
  memoryIds: z.array(z.string()).default([]),
  actionProposalId: z.string().uuid().optional(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional()
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

export const ForgeJobSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().min(1),
  prompt: z.string().min(8),
  status: z.enum(["draft", "validated", "rejected", "approved", "installed"]),
  requestedScopes: z.array(z.string()),
  artifactPath: z.string().optional(),
  generatedFiles: z.array(z.object({ path: z.string(), content: z.string() })),
  validation: z.object({ passed: z.boolean(), findings: z.array(z.string()) }),
  createdAt: z.string().datetime(),
  approvedBy: z.string().optional()
});
export type ForgeJob = z.infer<typeof ForgeJobSchema>;

export type AuditEntry = {
  id: string;
  workspaceId: string;
  kind: "event_received" | "workflow_matched" | "agent_run" | "approval" | "forge";
  subjectId: string;
  message: string;
  createdAt: string;
};
