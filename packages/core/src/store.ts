import { randomUUID } from "node:crypto";
import type {
  ActionProposal,
  AgentRun,
  AuditEntry,
  EventEnvelope,
  ForgeJob,
  WorkflowDefinition,
} from "./contracts.js";
import { ScopedMemory } from "./memory.js";

export type DecisionResult<T> = {
  value?: T;
  error?: "not_found" | "conflict" | "expired";
  message?: string;
};

export class EventForgeStore {
  readonly memory = new ScopedMemory();
  #events: EventEnvelope[] = [];
  #workflows: WorkflowDefinition[] = [];
  #actions: ActionProposal[] = [];
  #runs: AgentRun[] = [];
  #forges: ForgeJob[] = [];
  #audit: AuditEntry[] = [];
  #dedupe = new Set<string>();
  #auditListeners = new Set<(entry: AuditEntry) => void | Promise<void>>();

  appendEvent(event: EventEnvelope): { created: boolean; event: EventEnvelope } {
    if (this.#dedupe.has(event.dedupeKey))
      return {
        created: false,
        event: this.#events.find((item) => item.dedupeKey === event.dedupeKey) ?? event,
      };
    this.#dedupe.add(event.dedupeKey);
    this.#events.unshift(event);
    this.audit(
      event.workspaceId,
      "event_received",
      event.id,
      `${event.provider}:${event.topic} accepted (${event.signatureStatus}).`,
    );
    return { created: true, event };
  }

  events(workspaceId?: string): EventEnvelope[] {
    return workspaceId
      ? this.#events.filter((event) => event.workspaceId === workspaceId)
      : [...this.#events];
  }
  workflows(workspaceId?: string): WorkflowDefinition[] {
    return workspaceId
      ? this.#workflows.filter((workflow) => workflow.workspaceId === workspaceId)
      : [...this.#workflows];
  }
  addWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
    this.#workflows.unshift(workflow);
    return workflow;
  }
  actions(workspaceId?: string): ActionProposal[] {
    return workspaceId
      ? this.#actions.filter(
          (action) => this.workflowById(action.workflowId)?.workspaceId === workspaceId,
        )
      : [...this.#actions];
  }
  runs(): AgentRun[] {
    return [...this.#runs];
  }
  forgeJobs(workspaceId?: string): ForgeJob[] {
    return workspaceId
      ? this.#forges.filter((forge) => forge.workspaceId === workspaceId)
      : [...this.#forges];
  }
  auditEntries(workspaceId?: string): AuditEntry[] {
    return workspaceId
      ? this.#audit.filter((entry) => entry.workspaceId === workspaceId)
      : [...this.#audit];
  }
  workflowById(id: string): WorkflowDefinition | undefined {
    return this.#workflows.find((workflow) => workflow.id === id);
  }
  eventById(id: string): EventEnvelope | undefined {
    return this.#events.find((event) => event.id === id);
  }
  addAction(action: ActionProposal): ActionProposal {
    this.#actions.unshift(action);
    return action;
  }
  actionById(id: string): ActionProposal | undefined {
    return this.#actions.find((action) => action.id === id);
  }
  addRun(run: AgentRun): AgentRun {
    this.#runs.unshift(run);
    return run;
  }
  updateRun(id: string, patch: Partial<AgentRun>): AgentRun | undefined {
    const item = this.#runs.find((run) => run.id === id);
    return item && Object.assign(item, patch);
  }
  addForge(job: ForgeJob): ForgeJob {
    this.#forges.unshift(job);
    return job;
  }
  forgeById(id: string): ForgeJob | undefined {
    return this.#forges.find((forge) => forge.id === id);
  }

  decideAction(
    id: string,
    input: {
      approved: boolean;
      reviewer: string;
      expectedVersion?: number;
      reason?: string;
      now?: Date;
    },
  ): DecisionResult<ActionProposal> {
    const action = this.actionById(id);
    if (!action) return { error: "not_found", message: "Action not found." };
    if (input.expectedVersion !== undefined && input.expectedVersion !== action.version) {
      return {
        value: action,
        error: "conflict",
        message: `Action version is ${action.version}, not ${input.expectedVersion}.`,
      };
    }
    if (action.status !== "pending")
      return { value: action, error: "conflict", message: `Action is already ${action.status}.` };
    const now = input.now ?? new Date();
    if (action.expiresAt && Date.parse(action.expiresAt) <= now.getTime()) {
      action.status = "expired";
      action.version += 1;
      return { value: action, error: "expired", message: "Action approval has expired." };
    }
    action.status = input.approved ? "approved" : "rejected";
    action.reviewer = input.reviewer;
    action.decisionReason = input.reason;
    action.decidedAt = now.toISOString();
    action.version += 1;
    const workflow = this.workflowById(action.workflowId);
    if (workflow)
      this.audit(
        workflow.workspaceId,
        "approval",
        action.id,
        `${input.reviewer} ${input.approved ? "approved" : "rejected"} ${action.title}.`,
      );
    return { value: action };
  }

  decideForge(id: string, approved: boolean, reviewer: string): ForgeJob | undefined {
    const job = this.forgeById(id);
    if (!job || job.status !== "validated") return job;
    job.status = approved ? "approved" : "rejected";
    job.approvedBy = reviewer;
    this.audit(
      job.workspaceId,
      "forge",
      job.id,
      `${reviewer} ${approved ? "approved" : "rejected"} forge artifact.`,
    );
    return job;
  }

  audit(
    workspaceId: string,
    kind: AuditEntry["kind"],
    subjectId: string,
    message: string,
  ): AuditEntry {
    const entry = {
      id: randomUUID(),
      workspaceId,
      kind,
      subjectId,
      message,
      createdAt: new Date().toISOString(),
    };
    this.#audit.unshift(entry);
    for (const listener of this.#auditListeners) void listener(entry);
    return entry;
  }

  subscribeAudit(listener: (entry: AuditEntry) => void | Promise<void>): () => void {
    this.#auditListeners.add(listener);
    return () => this.#auditListeners.delete(listener);
  }
}
