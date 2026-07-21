import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import LandingPage from "./LandingPage";

it("renders the public product story and working console entrypoint", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<LandingPage />));
  expect(container.querySelector<HTMLAnchorElement>('a[href="/console"]')).not.toBeNull();
  expect(container.textContent).toContain("EventBridge");
  expect(container.textContent).toContain("Agents start with context");
  expect(container.textContent).toContain("Verified ingress");
  expect(container.textContent).toContain("Free to prove.");
  expect(container.textContent).toContain("Install with Codex");
  expect(
    container.querySelector<HTMLAnchorElement>('a[href="https://github.com/tebayoso/eventforge"]'),
  ).not.toBeNull();
  expect(
    container.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com/tebayoso/eventforge/blob/main/workfiles/CONFIGURATION.md"]',
    ),
  ).not.toBeNull();
  act(() => root.unmount());
  container.remove();
});
