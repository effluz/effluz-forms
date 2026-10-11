import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { loadConfig } from "@/app/config";
import { buildContainer, getContainer } from "@/app/container";
import {
  fakeUuid,
  makeDefinitionsDeps,
  seedForm,
  type FakeDefinitionsDeps,
} from "@/modules/definitions/application/testing/fakes";
import { makeDeps, type FakeIdentityDeps } from "@/modules/identity/application/testing/fakes";
import { GET as getPng } from "./qr.png/route";
import { GET as getSvg } from "./qr.svg/route";

const BASE = "https://forms.example.com";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const config = loadConfig({
  NODE_ENV: "test",
  PUBLIC_BASE_URL: BASE,
  DATABASE_URL: "postgres://user:pw@localhost:5432/none",
  STAGING_DIR: "./data/staging",
  PRIVACY_CONTACT_EMAIL: "privacy@example.com",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_ALLOWED_HOSTED_DOMAIN: "effluz.com",
});
const COOKIE = config.session.cookieName;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

let identity: FakeIdentityDeps;
let definitions: FakeDefinitionsDeps;
let formId: string;

beforeEach(async () => {
  identity = makeDeps({ publicBaseUrl: BASE });
  definitions = makeDefinitionsDeps({ publicBaseUrl: BASE });
  vi.mocked(getContainer).mockReturnValue(
    buildContainer(config, { pool: {} as unknown as Pool, identity, definitions }),
  );
  const now = identity.clock.now();
  identity.sessions.seed({
    id: SESSION_ID,
    email: "staff.member@effluz.com",
    name: "Staff Member",
    csrfToken: "csrf-token-1",
    createdAt: now,
    lastSeenAt: now,
  });
  formId = await seedForm(definitions, { slug: "spring-stories" });
});

function call(
  handler: typeof getPng,
  path: string,
  id: string = formId,
  cookie: string | null = `${COOKIE}=${SESSION_ID}`,
) {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
  if (cookie !== null) headers.set("cookie", cookie);
  return handler(new Request(`${BASE}/admin/forms/${id}/${path}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

describe("GET /admin/forms/[id]/qr.png", () => {
  it("sends a request without a session to sign-in", async () => {
    const res = await call(getPng, "qr.png?size=1024", formId, null);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/admin/auth/signin");
  });

  it("answers 404 for an unknown form", async () => {
    const res = await call(getPng, "qr.png?size=1024", fakeUuid(99));
    expect(res.status).toBe(404);
  });

  it("answers 404 for an id that is not a form id", async () => {
    const res = await call(getPng, "qr.png?size=1024", "not-an-id");
    expect(res.status).toBe(404);
  });

  it.each(["512", "abc", "", "1024.5"])("refuses the size %j with 400", async (size) => {
    const res = await call(getPng, `qr.png?size=${size}`);
    expect(res.status).toBe(400);
  });

  it("refuses a missing size with 400", async () => {
    const res = await call(getPng, "qr.png");
    expect(res.status).toBe(400);
  });

  it.each([1024, 2048])("returns a %i px PNG as a download", async (size) => {
    const res = await call(getPng, `qr.png?size=${String(size)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="spring-stories-qr-${String(size)}.png"`,
    );
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual(PNG_SIGNATURE);
    // The PNG header holds the width as a big-endian integer at byte 16.
    expect(new DataView(bytes.buffer).getUint32(16)).toBe(size);
  });
});

describe("GET /admin/forms/[id]/qr.svg", () => {
  it("sends a request without a session to sign-in", async () => {
    const res = await call(getSvg, "qr.svg", formId, null);
    expect(res.status).toBe(302);
  });

  it("answers 404 for an unknown form", async () => {
    const res = await call(getSvg, "qr.svg", fakeUuid(99));
    expect(res.status).toBe(404);
  });

  it("returns the SVG inline for the preview", async () => {
    const res = await call(getSvg, "qr.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(await res.text()).toContain("<svg");
  });

  it("returns it as a download with ?download=1", async () => {
    const res = await call(getSvg, "qr.svg?download=1");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="spring-stories-qr.svg"',
    );
  });
});
