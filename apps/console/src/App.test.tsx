import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  events: vi.fn(),
  actions: vi.fn(),
  runs: vi.fn(),
  audit: vi.fn(),
  memory: vi.fn(),
  connectors: vi.fn(),
  forges: vi.fn(),
  demo: vi.fn(),
  decideAction: vi.fn(),
  forge: vi.fn(),
  decideForge: vi.fn(),
}));

vi.mock("./api", async () => ({
  ...(await vi.importActual<typeof import("./api")>("./api")),
  api: mockApi,
}));

import App from "./App";

const event = {
  id: "event-1",
  provider: "github",
  topic: "check_run",
  signatureStatus: "verified",
  receivedAt: "2026-07-18T00:00:00.000Z",
  payload: { action: "completed" },
};
const action = {
  id: "action-1",
  title: "Patch CI",
  type: "pull_request",
  risk: "medium",
  status: "pending",
  diff: "+ fix",
  requiredCapabilities: ["write_files"],
};
const run = {
  id: "run-1",
  status: "waiting_for_approval",
  summary: "Tests failed",
  startedAt: "2026-07-18T00:00:00.000Z",
  threadId: "thread-1",
};
const audit = {
  id: "audit-1",
  kind: "event",
  message: "Event received",
  createdAt: "2026-07-18T00:00:00.000Z",
};
const memory = {
  id: "memory-1",
  text: "CI context",
  tags: ["ci"],
  createdAt: "2026-07-18T00:00:00.000Z",
};
const connector = { provider: "github", status: "configured", capabilities: ["webhooks"] };
const forge = {
  id: "forge-1",
  prompt: "Connector",
  status: "validated",
  requestedScopes: ["issues:read"],
  validation: { passed: true, findings: [] },
  generatedFiles: [{ path: "index.ts", content: "export {};" }],
};

let container: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(label),
  );
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  for (const mock of Object.values(mockApi)) mock.mockReset();
  mockApi.events.mockResolvedValue([event]);
  mockApi.actions.mockResolvedValue([action]);
  mockApi.runs.mockResolvedValue([run]);
  mockApi.audit.mockResolvedValue([audit]);
  mockApi.memory.mockResolvedValue([memory]);
  mockApi.connectors.mockResolvedValue([connector]);
  mockApi.forges.mockResolvedValue([forge]);
  mockApi.demo.mockResolvedValue({ ok: true });
  mockApi.decideAction.mockResolvedValue({ ok: true });
  mockApi.forge.mockResolvedValue(forge);
  mockApi.decideForge.mockResolvedValue({ ok: true });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("operations console", () => {
  it("loads resources and completes demo, approval, Forge, and theme flows", async () => {
    act(() => root.render(<App />));
    await flush();
    expect(container.textContent).toContain("Control plane online");
    expect(container.textContent).toContain("check_run");

    act(() => button("Run GitHub CI demo").click());
    await flush();
    expect(mockApi.demo).toHaveBeenCalledWith("github");

    act(() => button("Patch CI").click());
    act(() => button("Approve action").click());
    await flush();
    expect(mockApi.decideAction).toHaveBeenCalledWith("action-1", true);

    act(() => button("Forge draft").click());
    await flush();
    expect(mockApi.forge).toHaveBeenCalledOnce();
    act(() => button("Review artifact").click());
    act(() => button("Approve artifact").click());
    await flush();
    expect(mockApi.decideForge).toHaveBeenCalledWith("forge-1", true);

    act(() => button("Dark").click());
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("reports partial failures as degraded instead of hiding them", async () => {
    mockApi.audit.mockRejectedValue(new Error("audit unavailable"));
    act(() => root.render(<App />));
    await flush();
    expect(container.textContent).toContain("Control plane degraded");
    expect(container.textContent).toContain("Audit entries appear for every event");
  });

  it("surfaces mutation errors and allows dismissing them", async () => {
    mockApi.demo.mockRejectedValue(new Error("demo unavailable"));
    act(() => root.render(<App />));
    await flush();
    act(() => button("Run GitHub CI demo").click());
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("demo unavailable");
    act(() => button("Dismiss").click());
    expect(container.textContent).not.toContain("demo unavailable");
  });

  it("retains successful data when a later refresh fails", async () => {
    mockApi.events
      .mockResolvedValueOnce([event])
      .mockRejectedValueOnce(new Error("events unavailable"));
    act(() => root.render(<App />));
    await flush();
    act(() => button("Refresh").click());
    await flush();
    expect(container.textContent).toContain("Showing cached data");
    expect(container.textContent).toContain("check_run");
  });
});
