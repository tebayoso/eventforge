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
  private closed = false;

  constructor(private readonly start: () => Promise<LocalGitHubWebhook>) {}

  async ensure(provider: RelayProvider): Promise<LocalRelayStatus> {
    if (this.closed) throw new Error("Local relay controller is closed.");
    if (!this.active) {
      this.current = { state: "starting", provider };
      this.pending ??= this.start().then(async (active) => {
        if (this.closed) {
          await active.close();
          throw new Error("Local relay controller closed during startup.");
        }
        return active;
      });
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
    this.closed = true;
    try {
      if (this.active) await this.active.close();
      else await this.pending?.catch(() => undefined);
    } finally {
      this.active = undefined;
      this.pending = undefined;
      this.current = { state: "stopped" };
    }
  }
}
