import { describe, expect, it } from "vitest";
import {
  authorityObjectName,
  authorityStorageDisposition,
  sessionAuthorityFor,
  type AuthorityStorageSnapshot,
} from "../src/session-authority.js";

const readyStorage: AuthorityStorageSnapshot = {
  tables: ["authority_meta", "sessions"],
  metaColumns: ["key", "value"],
  sessionColumns: [
    "id",
    "request_token",
    "membership_version",
    "created_at",
    "last_used_at",
    "user_agent_label",
    "ip_label",
  ],
  metadata: {
    schema_version: "1",
    epoch: "0",
    blocked: "0",
    quarantined: "0",
  },
};

describe("session authority startup invariants", () => {
  it("initializes only truly empty storage and quarantines partial or invalid schemas", () => {
    expect(
      authorityStorageDisposition({
        tables: [],
        metaColumns: [],
        sessionColumns: [],
        metadata: {},
      }),
    ).toBe("initialize");
    expect(authorityStorageDisposition(readyStorage)).toBe("ready");
    expect(
      authorityStorageDisposition({
        ...readyStorage,
        tables: ["sessions"],
        metaColumns: [],
        sessionColumns: [],
        metadata: {},
      }),
    ).toBe("quarantine");
    expect(
      authorityStorageDisposition({
        ...readyStorage,
        metadata: { ...readyStorage.metadata, schema_version: "2" },
      }),
    ).toBe("quarantine");
    expect(
      authorityStorageDisposition({
        ...readyStorage,
        sessionColumns: readyStorage.sessionColumns.filter(
          (column) => column !== "membership_version",
        ),
      }),
    ).toBe("quarantine");
  });
});

describe("per-user authority selection", () => {
  it("uses one stable namespace name per canonical user without cross-user aliasing", () => {
    const selected: string[] = [];
    const env = {
      IDENTITY_AUTHORITY: {
        getByName(name: string) {
          selected.push(name);
          return { name };
        },
      },
    };

    expect(sessionAuthorityFor(env, "user-a")).toEqual({ name: "identity:user-a" });
    expect(sessionAuthorityFor(env, "user-b")).toEqual({ name: "identity:user-b" });
    expect(sessionAuthorityFor(env, "user-a")).toEqual({ name: "identity:user-a" });
    expect(selected).toEqual(["identity:user-a", "identity:user-b", "identity:user-a"]);
    expect(() => authorityObjectName(" user-a")).toThrow("canonical user identifier is invalid");
  });
});
