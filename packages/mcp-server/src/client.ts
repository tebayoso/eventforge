export class EventForgeApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EventForgeApiError";
  }
}

export interface EventForgeApiOptions {
  baseUrl?: string;
  bearerToken?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class EventForgeApi {
  readonly baseUrl: string;
  private readonly bearerToken?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EventForgeApiOptions | string = {}) {
    const normalized = typeof options === "string" ? { baseUrl: options } : options;
    this.baseUrl = normalized.baseUrl ?? process.env.EVENTFORGE_API_URL ?? "http://127.0.0.1:4310";
    this.bearerToken = normalized.bearerToken ?? process.env.EVENTFORGE_API_TOKEN;
    this.timeoutMs = normalized.timeoutMs ?? 10_000;
    this.fetchImpl = normalized.fetchImpl ?? fetch;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body: JSON.stringify(body) });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers({ accept: "application/json" });
    if (init.body) headers.set("content-type", "application/json");
    if (this.bearerToken) headers.set("authorization", `Bearer ${this.bearerToken}`);

    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, this.baseUrl), {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new EventForgeApiError("Unable to reach the EventForge API.", undefined, {
        cause: error,
      });
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500).trim();
      throw new EventForgeApiError(
        `EventForge API returned ${response.status}${detail ? `: ${detail}` : "."}`,
        response.status,
      );
    }

    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new EventForgeApiError("EventForge API returned invalid JSON.", response.status, {
        cause: error,
      });
    }
  }
}
