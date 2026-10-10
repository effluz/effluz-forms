import { describe, expect, it } from "vitest";
import { revokeSessionsForEmail } from "./revoke-sessions";
import { makeDeps } from "./testing/fakes";

describe("revokeSessionsForEmail", () => {
  it("deletes the address's sessions and audits the count without the address", async () => {
    const deps = makeDeps();
    const now = deps.clock.now();
    for (const [id, email] of [
      ["s1", "leaver@example.com"],
      ["s2", "leaver@example.com"],
      ["s3", "other@example.com"],
    ] as const) {
      deps.sessions.seed({
        id,
        email,
        name: "N",
        csrfToken: `c-${id}`,
        createdAt: now,
        lastSeenAt: now,
      });
    }

    const removed = await revokeSessionsForEmail(deps, {
      email: "Leaver@Example.com",
      actorEmail: "ops@example.com",
    });

    expect(removed).toBe(2);
    expect(deps.sessions.all().map((s) => s.id)).toEqual(["s3"]);
    expect(deps.audit.entries).toEqual([
      {
        entry: {
          action: "sessions_revoked",
          actorEmail: "ops@example.com",
          targetId: null,
          ip: null,
          details: { count: 2 },
        },
        at: now,
      },
    ]);
    expect(JSON.stringify(deps.audit.entries[0]?.entry.details)).not.toContain("leaver");
  });

  it("audits a revocation with no operator and zero sessions", async () => {
    const deps = makeDeps();
    const removed = await revokeSessionsForEmail(deps, {
      email: "nobody@example.com",
      actorEmail: null,
    });
    expect(removed).toBe(0);
    expect(deps.audit.entries[0]?.entry).toEqual({
      action: "sessions_revoked",
      actorEmail: null,
      targetId: null,
      ip: null,
      details: { count: 0 },
    });
  });
});
