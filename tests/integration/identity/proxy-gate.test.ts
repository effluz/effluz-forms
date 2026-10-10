import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { loadConfig } from "@/app/config";
import { buildContainer, getContainer } from "@/app/container";
import { ScriptedAdminIdentity } from "@/modules/identity/application/testing/fakes";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgSessionRepository } from "@/modules/identity/infrastructure/pg-session-repository";
import { PgSignInAttemptStore } from "@/modules/identity/infrastructure/pg-sign-in-attempt-store";
import type { Logger } from "@/shared/application/ports/logger";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { proxy } from "@/proxy";
import { testPool, truncateAll } from "../db";

const BASE = "https://forms.example.com";
const config = loadConfig({
  NODE_ENV: "test",
  PUBLIC_BASE_URL: BASE,
  DATABASE_URL: "postgres://unused@localhost:5432/unused",
  STAGING_DIR: "./data/staging",
  PRIVACY_CONTACT_EMAIL: "privacy@example.com",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_ALLOWED_HOSTED_DOMAIN: "effluz.com",
});
const COOKIE = config.session.cookieName;

/**
 * The admin gate on the real Postgres adapters; only the provider is a fake.
 * A cookie value is attacker-controlled, so a malformed one must read as "no
 * session" and send the person to sign-in, not to the error page.
 */
describe("admin proxy gate on Postgres", () => {
  const pool = testPool();
  const warn = vi.fn();
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn,
    error: vi.fn(),
    child: () => logger,
  };

  beforeEach(async () => {
    await truncateAll(pool);
    warn.mockReset();
    const uow = new PgUnitOfWorkFactory(pool);
    vi.mocked(getContainer).mockReturnValue(
      buildContainer(config, {
        pool,
        uow,
        logger,
        identity: {
          identity: new ScriptedAdminIdentity(),
          sessions: new PgSessionRepository(pool),
          audit: new PgAuditLog(),
          attempts: new PgSignInAttemptStore(pool),
          uow,
          clock: systemClock,
          ids: systemIdGenerator,
          allowedHostedDomain: "effluz.com",
          publicBaseUrl: BASE,
        },
      }),
    );
  });

  function request(cookie: string): NextRequest {
    return new NextRequest(`${BASE}/admin/forms`, { headers: { cookie } });
  }

  it.each([
    ["a word", "gone"],
    ["a UUID with a trailing character", `${randomUUID()}x`],
  ])("redirects a session cookie holding %s to sign-in", async (_name, value) => {
    const res = await proxy(request(`${COOKIE}=${value}`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${BASE}/admin/auth/signin?returnTo=${encodeURIComponent("/admin/forms")}`,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("redirects a well-formed but unknown session id to sign-in", async () => {
    const res = await proxy(request(`${COOKIE}=${randomUUID()}`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${BASE}/admin/auth/signin?returnTo=${encodeURIComponent("/admin/forms")}`,
    );
  });
});
