export class EventForgeApi {
  constructor(readonly baseUrl = process.env.EVENTFORGE_API_URL ?? "http://127.0.0.1:4310") {}

  async get<T>(path: string): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl));
    if (!response.ok) throw new Error(`EventForge API returned ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`EventForge API returned ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }
}
