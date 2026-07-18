import type { LocalRelayStatus, Provider } from "@eventforge/core";
import type { LocalGitHubWebhook } from "./local-github.js";

type RelayProvider = Exclude<Provider, "custom">;

export interface RelayController {
  ensure(provider: RelayProvider): Promise<LocalRelayStatus>;
  status(): LocalRelayStatus;
  close(): Promise<void>;
}

export class LocalRelayController implements RelayController {
  private active?: LocalGitHubWebhook;
  private pending?: Promise<LocalGitHubWebhook>;
  private current: LocalRelayStatus = { state: "stopped" };

  constructor(private readonly start: () => Promise<LocalGitHubWebhook>) {}

  async ensure(provider: RelayProvider): Promise<LocalRelayStatus> {
    if (!this.active) {
      this.current = { state: "starting", provider };
      this.pending ??= this.start();
      try {
        this.active = await this.pending;
      } catch (error) {
        this.current = {
          state: "failed",
          provider,
          error: "Local relay failed to start.",
        };
        throw error;
      } finally {
        this.pending = undefined;
      }
    }
    const endpoint = new URL(`/webhooks/${provider}`, `${this.active.publicBaseUrl}/`).toString();
    this.current = {
      state: "ready",
      provider,
      endpoint,
      publicUrl: this.active.publicBaseUrl,
      tunnelName: this.active.tunnelName,
    };
    return this.current;
  }

  status(): LocalRelayStatus {
    return this.current;
  }

  async close(): Promise<void> {
    await this.active?.close();
    this.active = undefined;
    this.pending = undefined;
    this.current = { state: "stopped" };
  }
}
