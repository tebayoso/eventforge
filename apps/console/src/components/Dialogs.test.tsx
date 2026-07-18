import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionItem, ForgeItem } from "../api";
import { ApprovalDialog, ForgeReviewDialog } from "./Dialogs";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const action: ActionItem = {
  id: "action-1",
  title: "Patch CI",
  type: "pull_request",
  risk: "medium",
  status: "pending",
  diff: "+ fix",
  requiredCapabilities: ["write_files"],
};
const forge: ForgeItem = {
  id: "forge-1",
  prompt: "Build connector",
  status: "validated",
  requestedScopes: ["issues:read"],
  validation: { passed: true, findings: [] },
  generatedFiles: [
    { path: "one.ts", content: "one" },
    { path: "two.ts", content: "two" },
  ],
};

describe("review dialogs", () => {
  it("traps focus, records approval, and closes with Escape", () => {
    const onClose = vi.fn();
    const onDecide = vi.fn();
    act(() =>
      root.render(
        <ApprovalDialog action={action} busy={false} onClose={onClose} onDecide={onDecide} />,
      ),
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close");
    const buttons = Array.from(container.querySelectorAll("button"));
    act(() => buttons.find((button) => button.textContent?.includes("Approve"))!.click());
    expect(onDecide).toHaveBeenCalledWith(true);
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps a busy approval dialog open and disables decisions", () => {
    const onClose = vi.fn();
    act(() =>
      root.render(
        <ApprovalDialog
          action={{ ...action, diff: undefined }}
          busy
          onClose={onClose}
          onDecide={vi.fn()}
        />,
      ),
    );
    expect(
      Array.from(container.querySelectorAll("button")).every((button) => button.disabled),
    ).toBe(true);
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("supports arrow-key file tabs and rejects reviewed artifacts", () => {
    const onSelectFile = vi.fn();
    const onDecide = vi.fn();
    act(() =>
      root.render(
        <ForgeReviewDialog
          forge={forge}
          busy={false}
          selectedFilePath="one.ts"
          onSelectFile={onSelectFile}
          onClose={vi.fn()}
          onDecide={onDecide}
        />,
      ),
    );
    const firstTab = container.querySelector<HTMLElement>("[role=tab]")!;
    act(() =>
      firstTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(onSelectFile).toHaveBeenCalledWith("two.ts");
    act(() =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Reject artifact"))!
        .click(),
    );
    expect(onDecide).toHaveBeenCalledWith(false);
  });

  it("blocks approval when Forge validation fails", () => {
    const blocked = {
      ...forge,
      validation: { passed: false, findings: ["install script"] },
      generatedFiles: [],
    };
    act(() =>
      root.render(
        <ForgeReviewDialog
          forge={blocked}
          busy={false}
          onSelectFile={vi.fn()}
          onClose={vi.fn()}
          onDecide={vi.fn()}
        />,
      ),
    );
    expect(
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Approve artifact"),
      )?.disabled,
    ).toBe(true);
    expect(container.textContent).toContain("install script");
  });
});
