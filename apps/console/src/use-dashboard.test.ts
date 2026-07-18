import { describe, expect, it } from "vitest";
import { getConnectionStatus } from "./use-dashboard";

describe("dashboard connection status", () => {
  it("does not claim the control plane is online before a response arrives", () => {
    expect(getConnectionStatus([{}, {}])).toBe("connecting");
  });

  it("reports offline when every resource fails", () => {
    expect(getConnectionStatus([{ error: "offline" }, { error: "offline" }])).toBe("offline");
  });

  it("reports degraded while retaining successfully loaded resources", () => {
    expect(getConnectionStatus([{ updatedAt: 1 }, { error: "audit unavailable" }])).toBe(
      "degraded",
    );
  });

  it("reports online only when every resource is healthy", () => {
    expect(getConnectionStatus([{ updatedAt: 1 }, { updatedAt: 2 }])).toBe("online");
  });
});
