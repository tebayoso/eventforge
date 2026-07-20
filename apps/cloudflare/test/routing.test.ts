import { describe, expect, it } from "vitest";
import { surfaceFor } from "../src/index.js";

describe("production hostname isolation", () => {
  it("keeps API and signed-hook surfaces on their declared custom domains", () => {
    expect(surfaceFor("api.eventforge.dev", "production")).toBe("api");
    expect(surfaceFor("hooks.eventforge.dev", "production")).toBe("hooks");
    expect(surfaceFor("eventforge.dev", "production")).toBe("unknown");
    expect(surfaceFor("eventforge-cloud-preview.example.workers.dev", "preview")).toBe("preview");
  });
});
