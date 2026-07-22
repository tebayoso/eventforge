export type IdentityRole = "owner" | "admin" | "operator" | "viewer";
export type FactorKind = "totp" | "webauthn";
export type EmailDelivery = {
  sendVerification(input: { email: string; challenge: string; expiresAt: string }): Promise<void>;
};
export type FactorVerifier = {
  verify(input: { userId: string; kind: FactorKind; proof: unknown }): Promise<boolean>;
};
export type AuditEvent = {
  workspaceId: string;
  actorId: string;
  sessionId?: string;
  kind: string;
  subjectId: string;
  createdAt: string;
};

type User = { id: string; email: string; verifiedAt?: string };
type Membership = { userId: string; workspaceId: string; role: IdentityRole; version: number };
type Invite = {
  id: string;
  workspaceId: string;
  email: string;
  role: IdentityRole;
  inviterId: string;
  expiresAt: number;
  usedAt?: number;
};
type Challenge = { token: string; userId: string; expiresAt: number; usedAt?: number };
type RecoveryCode = { salt: string; hash: string };

export function normalizeIdentityEmail(value: string): string | undefined {
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function opaque(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function slowHash(salt: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(value),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 210_000 },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equal(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1)
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

/** Deterministic test-domain implementation. Production wiring must supply D1 and external factor/email ports. */
export class HostedIdentityService {
  readonly audit: AuditEvent[] = [];
  private users = new Map<string, User>();
  private usersByEmail = new Map<string, string>();
  private challenges = new Map<string, Challenge>();
  private memberships = new Map<string, Membership>();
  private invitations = new Map<string, Invite>();
  private factors = new Map<string, Set<FactorKind>>();
  private recovery = new Map<string, RecoveryCode[]>();

  constructor(
    private readonly email: EmailDelivery,
    private readonly now = () => Date.now(),
  ) {}

  private membership(userId: string, workspaceId: string): Membership | undefined {
    return this.memberships.get(`${userId}:${workspaceId}`);
  }
  private auditEvent(workspaceId: string, actorId: string, kind: string, subjectId: string): void {
    this.audit.push({
      workspaceId,
      actorId,
      kind,
      subjectId,
      createdAt: new Date(this.now()).toISOString(),
    });
  }
  private userForEmail(email: string): User {
    const id = this.usersByEmail.get(email);
    if (id) return this.users.get(id)!;
    const user = { id: crypto.randomUUID(), email };
    this.users.set(user.id, user);
    this.usersByEmail.set(email, user.id);
    return user;
  }

  /** Always returns the same outcome, whether or not an identity already exists. */
  async requestVerification(rawEmail: string): Promise<{ accepted: true }> {
    const email = normalizeIdentityEmail(rawEmail);
    if (!email) return { accepted: true };
    const user = this.userForEmail(email);
    const token = opaque();
    const expiresAt = this.now() + 60 * 60_000;
    this.challenges.set(token, { token, userId: user.id, expiresAt });
    await this.email.sendVerification({
      email,
      challenge: token,
      expiresAt: new Date(expiresAt).toISOString(),
    });
    return { accepted: true };
  }

  verifyEmail(token: string): User | undefined {
    const challenge = this.challenges.get(token);
    if (!challenge || challenge.usedAt || challenge.expiresAt <= this.now()) return undefined;
    challenge.usedAt = this.now();
    const user = this.users.get(challenge.userId)!;
    user.verifiedAt = new Date(this.now()).toISOString();
    return user;
  }

  createWorkspace(userId: string, workspaceId: string): boolean {
    const user = this.users.get(userId);
    if (!user?.verifiedAt || this.membership(userId, workspaceId)) return false;
    this.memberships.set(`${userId}:${workspaceId}`, {
      userId,
      workspaceId,
      role: "owner",
      version: 1,
    });
    this.auditEvent(workspaceId, userId, "workspace_created", workspaceId);
    return true;
  }

  addFactor(userId: string, kind: FactorKind): void {
    this.factors.set(userId, new Set([...(this.factors.get(userId) ?? []), kind]));
  }
  hasRequiredFactor(userId: string): boolean {
    return (this.factors.get(userId)?.size ?? 0) > 0;
  }
  isRecentMfa(at: number | undefined): boolean {
    return at !== undefined && at <= this.now() && this.now() - at <= 15 * 60_000;
  }
  /** All hosted resource families must call this with their server-derived workspace. */
  canAccess(
    userId: string,
    workspaceId: string,
    options: { privileged?: boolean; recentMfaAt?: number } = {},
  ): boolean {
    const membership = this.membership(userId, workspaceId);
    if (!membership) return false;
    if (
      (membership.role === "owner" || membership.role === "admin") &&
      !this.hasRequiredFactor(userId)
    )
      return false;
    return !options.privileged || this.isRecentMfa(options.recentMfaAt);
  }

  invite(
    actorId: string,
    workspaceId: string,
    rawEmail: string,
    role: IdentityRole,
  ): string | undefined {
    const actor = this.membership(actorId, workspaceId);
    const email = normalizeIdentityEmail(rawEmail);
    if (!actor || !email || !["owner", "admin"].includes(actor.role) || role === "owner")
      return undefined;
    if ((actor.role === "owner" || actor.role === "admin") && !this.hasRequiredFactor(actorId))
      return undefined;
    const id = opaque();
    this.invitations.set(id, {
      id,
      workspaceId,
      email,
      role,
      inviterId: actorId,
      expiresAt: this.now() + 7 * 24 * 60 * 60_000,
    });
    this.auditEvent(workspaceId, actorId, "invitation_created", id);
    return id;
  }

  /** Exact verified email binding means forwarding cannot grant access. */
  acceptInvitation(userId: string, invitationId: string): { accepted: true } {
    const invite = this.invitations.get(invitationId);
    const user = this.users.get(userId);
    if (
      !invite ||
      invite.usedAt ||
      invite.expiresAt <= this.now() ||
      !user?.verifiedAt ||
      user.email !== invite.email
    )
      return { accepted: true };
    if (this.membership(userId, invite.workspaceId)) return { accepted: true };
    invite.usedAt = this.now();
    this.memberships.set(`${userId}:${invite.workspaceId}`, {
      userId,
      workspaceId: invite.workspaceId,
      role: invite.role,
      version: 1,
    });
    this.auditEvent(invite.workspaceId, userId, "invitation_accepted", invitationId);
    return { accepted: true };
  }

  changeRole(
    actorId: string,
    userId: string,
    workspaceId: string,
    role: IdentityRole,
    recentMfaAt?: number,
  ): boolean {
    const actor = this.membership(actorId, workspaceId);
    const target = this.membership(userId, workspaceId);
    if (!actor || !target || actor.role !== "owner" || !this.isRecentMfa(recentMfaAt)) return false;
    const owners = [...this.memberships.values()].filter(
      (membership) => membership.workspaceId === workspaceId && membership.role === "owner",
    );
    if (target.role === "owner" && role !== "owner" && owners.length === 1) return false;
    if (role === "owner" && !this.users.get(userId)?.verifiedAt) return false;
    target.role = role;
    target.version += 1;
    this.auditEvent(workspaceId, actorId, "membership_role_changed", userId);
    return true;
  }

  removeMember(
    actorId: string,
    userId: string,
    workspaceId: string,
    recentMfaAt?: number,
  ): boolean {
    const target = this.membership(userId, workspaceId);
    if (!target || !this.changeRole(actorId, userId, workspaceId, "viewer", recentMfaAt))
      return false;
    this.memberships.delete(`${userId}:${workspaceId}`);
    this.auditEvent(workspaceId, actorId, "membership_removed", userId);
    return true;
  }

  async regenerateRecoveryCodes(userId: string): Promise<string[]> {
    const values = Array.from({ length: 8 }, () => opaque().slice(0, 16));
    this.recovery.set(
      userId,
      await Promise.all(
        values.map(async (value) => {
          const salt = opaque();
          return { salt, hash: await slowHash(salt, value) };
        }),
      ),
    );
    return values;
  }

  async consumeRecoveryCode(userId: string, value: string): Promise<boolean> {
    const codes = this.recovery.get(userId) ?? [];
    for (let index = 0; index < codes.length; index += 1)
      if (equal(codes[index]!.hash, await slowHash(codes[index]!.salt, value))) {
        codes.splice(index, 1);
        return true;
      }
    return false;
  }

  membershipFor(userId: string, workspaceId: string): Membership | undefined {
    return this.membership(userId, workspaceId);
  }
}
