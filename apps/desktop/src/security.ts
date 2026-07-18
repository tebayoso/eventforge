export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isAllowedNavigation(
  value: string,
  devServerUrl?: string,
  rendererUrl?: string,
): boolean {
  try {
    const target = new URL(value);
    if (target.protocol === "file:")
      return (
        devServerUrl === undefined &&
        rendererUrl !== undefined &&
        target.pathname === new URL(rendererUrl).pathname
      );
    if (!devServerUrl) return false;
    return target.origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}
