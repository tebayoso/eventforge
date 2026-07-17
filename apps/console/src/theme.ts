export type Theme = "light" | "dark";

export const themeStorageKey = "eventforge-theme";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark";
}

export function readStoredTheme(storage: StorageLike | null | undefined): Theme | undefined {
  try {
    const value = storage?.getItem(themeStorageKey) ?? null;
    return isTheme(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function resolveTheme(storedTheme: Theme | undefined, systemPrefersDark: boolean): Theme {
  return storedTheme ?? (systemPrefersDark ? "dark" : "light");
}

export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  let storedTheme: Theme | undefined;
  let systemPrefersDark = false;
  try { storedTheme = readStoredTheme(window.localStorage); } catch { /* Storage can be disabled. */ }
  try { systemPrefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false; } catch { /* Some embedded browsers block media queries. */ }
  return resolveTheme(storedTheme, systemPrefersDark);
}

export function applyTheme(theme: Theme, documentRef: Document = document): void {
  documentRef.documentElement.dataset.theme = theme;
  documentRef.documentElement.style.colorScheme = theme;
}

export function persistTheme(theme: Theme, storage?: StorageLike | null): void {
  try {
    (storage ?? window.localStorage).setItem(themeStorageKey, theme);
  } catch {
    // A disabled storage API must not prevent a user from changing themes.
  }
}
