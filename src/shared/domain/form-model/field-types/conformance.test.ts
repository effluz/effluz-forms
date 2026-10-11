import { describe, expect, it } from "vitest";
import { conformanceChecks } from "./conformance-checks";
import { buildDefaultRegistry } from "./index";

const registry = buildDefaultRegistry();

describe.each(registry.list().map((d) => [d.id, d] as const))("field type %s", (_id, def) => {
  it.each(conformanceChecks(def).map((c) => [c.name, c] as const))("%s", (_name, check) => {
    expect(check.ok, `${def.id}: ${check.detail}`).toBe(true);
  });
});
