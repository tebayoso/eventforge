import { describe, expect, it } from "vitest";
import { isConsolePath } from "./worker.js";

describe("hosted console route boundary", () => {
  it("protects the console document and every nested console route", () => {
    expect(isConsolePath("/console")).toBe(true);
    expect(isConsolePath("/console/settings")).toBe(true);
    expect(isConsolePath("/console-public")).toBe(false);
    expect(isConsolePath("/")).toBe(false);
  });
});
