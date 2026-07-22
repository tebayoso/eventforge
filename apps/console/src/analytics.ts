type AnalyticsProperties = Record<string, string | number | boolean | undefined>;

type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY?.trim();
const POSTHOG_HOST = (
  import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://us.i.posthog.com"
).replace(/\/$/, "");
const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();

let anonymousId: string | undefined;

function getAnonymousId(): string {
  if (anonymousId) return anonymousId;
  try {
    const key = "eventbridge-anonymous-id";
    anonymousId = window.localStorage.getItem(key) ?? crypto.randomUUID();
    window.localStorage.setItem(key, anonymousId);
  } catch {
    anonymousId = crypto.randomUUID();
  }
  return anonymousId;
}

function initializeGoogleAnalytics(): void {
  if (!GA_MEASUREMENT_ID || document.querySelector("script[data-eventbridge-ga]")) return;
  const analyticsWindow = window as AnalyticsWindow;
  analyticsWindow.dataLayer = analyticsWindow.dataLayer || [];
  analyticsWindow.gtag = function gtag() {
    // gtag.js requires its commands to be queued as the function's arguments object.
    // eslint-disable-next-line prefer-rest-params
    analyticsWindow.dataLayer?.push(arguments);
  };
  analyticsWindow.gtag("js", new Date());
  analyticsWindow.gtag("config", GA_MEASUREMENT_ID, {
    anonymize_ip: true,
    allow_google_signals: false,
    page_title: document.title,
    send_page_view: false,
  });
  const script = document.createElement("script");
  script.async = true;
  script.dataset.eventbridgeGa = "true";
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
  document.head.append(script);
}

export function captureEvent(event: string, properties: AnalyticsProperties = {}): void {
  const payload = {
    api_key: POSTHOG_KEY,
    event,
    distinct_id: getAnonymousId(),
    properties: {
      ...properties,
      $current_url: window.location.href,
      $host: window.location.host,
      product: "eventbridge",
    },
  };
  if (POSTHOG_KEY) {
    void fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  }

  const analyticsWindow = window as AnalyticsWindow;
  analyticsWindow.gtag?.("event", event, properties);
}

export function initializeAnalytics(): void {
  if (typeof window === "undefined") return;
  initializeGoogleAnalytics();
  captureEvent("page_view");
}
