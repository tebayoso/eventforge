import { describe, expect, it, vi } from "vitest";
import { applyTheme, persistTheme, readStoredTheme, resolveTheme, themeStorageKey } from "./theme";

describe("console theme preferences", () => {
  it("uses a valid saved theme before the system preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("falls back to the system preference when no saved theme exists", () => {
    expect(resolveTheme(undefined, true)).toBe("dark");
    expect(resolveTheme(undefined, false)).toBe("light");
  });

  it("ignores invalid and unavailable local storage values", () => {
    expect(readStoredTheme({ getItem: () => "system", setItem: vi.fn() })).toBeUndefined();
    expect(
      readStoredTheme({
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: vi.fn(),
      }),
    ).toBeUndefined();
  });

  it("applies and persists an explicit user choice", () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };
    applyTheme("dark");
    persistTheme("dark", storage);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(storage.setItem).toHaveBeenCalledWith(themeStorageKey, "dark");
  });
});
