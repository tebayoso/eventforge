import { afterEach, describe, expect, it, vi } from "vitest";

type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  document.querySelectorAll("script[data-eventforge-ga]").forEach((script) => script.remove());
  delete (window as AnalyticsWindow).dataLayer;
  delete (window as AnalyticsWindow).gtag;
});

describe("Google Analytics initialization", () => {
  it("queues commands using Google's supported arguments-object format", async () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123456");
    const { initializeAnalytics } = await import("./analytics");

    initializeAnalytics();

    const analyticsWindow = window as AnalyticsWindow;
    const script = document.querySelector<HTMLScriptElement>("script[data-eventforge-ga]");
    expect(script?.src).toBe("https://www.googletagmanager.com/gtag/js?id=G-TEST123456");
    expect(analyticsWindow.dataLayer).toHaveLength(3);
    expect(Object.prototype.toString.call(analyticsWindow.dataLayer?.[0])).toBe(
      "[object Arguments]",
    );
    expect(Array.from(analyticsWindow.dataLayer?.[1] as ArrayLike<unknown>)).toEqual([
      "config",
      "G-TEST123456",
      expect.objectContaining({
        allow_google_signals: false,
        anonymize_ip: true,
        send_page_view: false,
      }),
    ]);
    expect(Array.from(analyticsWindow.dataLayer?.[2] as ArrayLike<unknown>)).toEqual([
      "event",
      "page_view",
      {},
    ]);
  });
});
