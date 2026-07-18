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
  expect(container.textContent).toContain("EventForge");
  expect(container.textContent).toContain("Agents start with context");
  act(() => root.unmount());
  container.remove();
});
