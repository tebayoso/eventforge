type AnalyticsProperties = Record<string, string | number | boolean | undefined>;
type PublicAnalyticsConfig = {
  posthogKey?: string;
  posthogHost?: string;
  gaMeasurementId?: string;
};

type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

const fallbackConfig: Required<PublicAnalyticsConfig> = {
  posthogKey: import.meta.env.VITE_POSTHOG_KEY?.trim() || "",
  posthogHost: (import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://us.i.posthog.com").replace(
    /\/$/,
    "",
  ),
  gaMeasurementId: import.meta.env.VITE_GA_MEASUREMENT_ID?.trim() || "",
};
let analyticsConfig = fallbackConfig;

let anonymousId: string | undefined;

function getAnonymousId(): string {
  if (anonymousId) return anonymousId;
  try {
    const key = "eventforge-anonymous-id";
    anonymousId = window.localStorage.getItem(key) ?? crypto.randomUUID();
    window.localStorage.setItem(key, anonymousId);
  } catch {
    anonymousId = crypto.randomUUID();
  }
  return anonymousId;
}

function initializeGoogleAnalytics(): void {
  if (!analyticsConfig.gaMeasurementId || document.querySelector("script[data-eventforge-ga]"))
    return;
  const analyticsWindow = window as AnalyticsWindow;
  analyticsWindow.dataLayer = analyticsWindow.dataLayer || [];
  analyticsWindow.gtag = function gtag() {
    // gtag.js requires its commands to be queued as the function's arguments object.
    // eslint-disable-next-line prefer-rest-params
    analyticsWindow.dataLayer?.push(arguments);
  };
  analyticsWindow.gtag("js", new Date());
  analyticsWindow.gtag("config", analyticsConfig.gaMeasurementId, {
    anonymize_ip: true,
    allow_google_signals: false,
    page_title: document.title,
    send_page_view: false,
  });
  const script = document.createElement("script");
  script.async = true;
  script.dataset.eventforgeGa = "true";
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(analyticsConfig.gaMeasurementId)}`;
  document.head.append(script);
}

export function captureEvent(event: string, properties: AnalyticsProperties = {}): void {
  const payload = {
    api_key: analyticsConfig.posthogKey,
    event,
    distinct_id: getAnonymousId(),
    properties: {
      ...properties,
      $current_url: window.location.href,
      $host: window.location.host,
      product: "eventforge",
    },
  };
  if (analyticsConfig.posthogKey) {
    void fetch(`${analyticsConfig.posthogHost}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  }

  const analyticsWindow = window as AnalyticsWindow;
  analyticsWindow.gtag?.("event", event, properties);
}

export function initializeAnalytics(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return fetch("/analytics-config.json", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : undefined))
    .then((config: PublicAnalyticsConfig | undefined) => {
      if (config) {
        analyticsConfig = {
          posthogKey: config.posthogKey?.trim() || fallbackConfig.posthogKey,
          posthogHost: (config.posthogHost?.trim() || fallbackConfig.posthogHost).replace(
            /\/$/,
            "",
          ),
          gaMeasurementId: config.gaMeasurementId?.trim() || fallbackConfig.gaMeasurementId,
        };
      }
    })
    .catch(() => undefined)
    .finally(() => {
      initializeGoogleAnalytics();
      captureEvent("page_view");
    });
}
