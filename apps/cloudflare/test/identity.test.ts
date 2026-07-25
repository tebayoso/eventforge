import { describe, expect, it } from "vitest";
import { HostedIdentityService, type EmailDelivery } from "../src/identity.js";

class TestEmail implements EmailDelivery {
  sent: Array<{ email: string; challenge: string }> = [];
  async sendVerification(input: { email: string; challenge: string }): Promise<void> {
    this.sent.push(input);
  }
}

describe("hosted identity lifecycle", () => {
  it("makes verification and invitation acceptance enumeration-safe while binding the exact verified email", async () => {
    const email = new TestEmail();
    let now = 0;
    const service = new HostedIdentityService(email, () => now);
    expect(await service.requestVerification("Owner@Example.com")).toEqual({ accepted: true });
    expect(await service.requestVerification("missing")).toEqual({ accepted: true });
    const owner = service.verifyEmail(email.sent[0]!.challenge)!;
    expect(service.createWorkspace(owner.id, "a")).toBe(true);
    service.addFactor(owner.id, "totp");
    const invitation = service.invite(owner.id, "a", "invitee@example.com", "operator")!;
    await service.requestVerification("forwarder@example.com");
    const forwarder = service.verifyEmail(email.sent[1]!.challenge)!;
    expect(service.acceptInvitation(forwarder.id, invitation)).toEqual({ accepted: true });
    expect(service.membershipFor(forwarder.id, "a")).toBeUndefined();
    await service.requestVerification("invitee@example.com");
    const invitee = service.verifyEmail(email.sent[2]!.challenge)!;
    service.acceptInvitation(invitee.id, invitation);
    expect(service.membershipFor(invitee.id, "a")?.role).toBe("operator");
    now += 7 * 24 * 60 * 60_000 + 1;
    expect(service.acceptInvitation(invitee.id, invitation)).toEqual({ accepted: true });
  });

  it("requires MFA for governance, preserves the final owner, and never refreshes recent MFA on ordinary activity", async () => {
    const email = new TestEmail();
    let now = 0;
    const service = new HostedIdentityService(email, () => now);
    await service.requestVerification("owner@example.com");
    const owner = service.verifyEmail(email.sent[0]!.challenge)!;
    service.createWorkspace(owner.id, "a");
    await service.requestVerification("admin@example.com");
    const admin = service.verifyEmail(email.sent[1]!.challenge)!;
    expect(service.invite(owner.id, "a", "admin@example.com", "admin")).toBeUndefined();
    service.addFactor(owner.id, "webauthn");
    const invite = service.invite(owner.id, "a", "admin@example.com", "admin")!;
    service.acceptInvitation(admin.id, invite);
    expect(service.canAccess(admin.id, "a")).toBe(false);
    service.addFactor(admin.id, "totp");
    expect(service.canAccess(admin.id, "a", { privileged: true, recentMfaAt: now })).toBe(true);
    expect(service.changeRole(owner.id, owner.id, "a", "viewer", now)).toBe(false);
    now += 15 * 60_000 + 1;
    expect(service.changeRole(owner.id, admin.id, "a", "owner", 0)).toBe(false);
  });

  it("derives tenant access from current membership for every hosted resource family", async () => {
    const email = new TestEmail();
    const service = new HostedIdentityService(email);
    await service.requestVerification("a@example.com");
    const a = service.verifyEmail(email.sent[0]!.challenge)!;
    await service.requestVerification("b@example.com");
    const b = service.verifyEmail(email.sent[1]!.challenge)!;
    service.createWorkspace(a.id, "workspace-a");
    service.createWorkspace(b.id, "workspace-b");
    service.addFactor(a.id, "totp");
    expect(service.canAccess(a.id, "workspace-a")).toBe(true);
    expect(service.canAccess(a.id, "workspace-b")).toBe(false);
    expect(
      service.canAccess(b.id, "workspace-a", { privileged: true, recentMfaAt: Date.now() }),
    ).toBe(false);
  });

  it("stores recovery codes as one-way values and atomically consumes a code once", async () => {
    const email = new TestEmail();
    const service = new HostedIdentityService(email);
    await service.requestVerification("owner@example.com");
    const user = service.verifyEmail(email.sent[0]!.challenge)!;
    const codes = await service.regenerateRecoveryCodes(user.id);
    expect(await service.consumeRecoveryCode(user.id, codes[0]!)).toBe(true);
    expect(await service.consumeRecoveryCode(user.id, codes[0]!)).toBe(false);
    const replacement = await service.regenerateRecoveryCodes(user.id);
    expect(await service.consumeRecoveryCode(user.id, codes[1]!)).toBe(false);
    expect(await service.consumeRecoveryCode(user.id, replacement[0]!)).toBe(true);
  });
});
