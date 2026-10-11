import { ESLint } from "eslint";
import { existsSync, mkdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const eslint = new ESLint({ cwd: process.cwd() });
const MODULES_ROOT = path.join(process.cwd(), "src/modules");
const written: string[] = [];
const createdDirs: string[] = [];

// Creates `dir` and any missing parents under src/modules, recording only what this run created.
function mkdirTracked(dir: string) {
  const missing: string[] = [];
  for (let d = dir; d !== MODULES_ROOT && !existsSync(d); d = path.dirname(d)) missing.push(d);
  mkdirSync(dir, { recursive: true });
  createdDirs.push(...missing);
}

async function lintVirtual(relativePath: string, code: string) {
  const file = path.join(process.cwd(), relativePath);
  if (existsSync(file))
    throw new Error(`Boundary probe target already exists, refusing to overwrite: ${relativePath}`);
  mkdirTracked(path.dirname(file));
  writeFileSync(file, code);
  written.push(file);
  const [result] = await eslint.lintFiles([file]);
  return result?.messages ?? [];
}

afterAll(() => {
  for (const f of written) rmSync(f, { force: true });
  // Deepest first; non-recursive, so a directory that is not empty is left alone.
  for (const dir of [...new Set(createdDirs)].sort((a, b) => b.length - a.length)) {
    try {
      rmdirSync(dir);
    } catch {
      // not empty or already gone
    }
  }
});

describe("layer boundaries", () => {
  it("forbids domain importing from application", async () => {
    await lintVirtual(
      "src/modules/probe-a/application/boundary-probe-target.ts",
      `export const y = 1;\n`,
    );
    const rules = await lintVirtual(
      "src/modules/probe-a/domain/boundary-probe-x.ts",
      `import { y } from "../application/boundary-probe-target";\nexport const z = y;\n`,
    );
    expect(rules.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });

  it("forbids domain importing react", async () => {
    const rules = await lintVirtual(
      "src/modules/probe-a/domain/boundary-probe-r.ts",
      `import * as React from "react";\nexport const z = React;\n`,
    );
    expect(rules).toContainEqual(
      expect.objectContaining({
        ruleId: "boundaries/dependencies",
        message: "domain depends on nothing outside itself",
      }),
    );
  });

  it("forbids a module importing another module's domain", async () => {
    await lintVirtual(
      "src/modules/probe-a/domain/boundary-probe-inner.ts",
      `export const y = 1;\n`,
    );
    const rules = await lintVirtual(
      "src/modules/probe-b/domain/boundary-probe-x.ts",
      `import { y } from "../../probe-a/domain/boundary-probe-inner";\nexport const z = y;\n`,
    );
    expect(rules.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });

  it("forbids domain importing a prefixed Node core module", async () => {
    const rules = await lintVirtual(
      "src/modules/probe-a/domain/boundary-probe-io.ts",
      `import { readFileSync } from "node:fs";\nexport const z = readFileSync;\n`,
    );
    expect(rules.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });

  it("forbids domain importing a bare Node core module", async () => {
    const rules = await lintVirtual(
      "src/modules/probe-a/domain/boundary-probe-io-bare.ts",
      `import { readFileSync } from "fs";\nexport const z = readFileSync;\n`,
    );
    expect(rules.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });

  it("allows domain importing zod", async () => {
    const rules = await lintVirtual(
      "src/modules/probe-a/domain/boundary-probe-ok.ts",
      `import { z } from "zod";\nexport const s = z.string();\n`,
    );
    expect(rules.filter((m) => m.ruleId?.startsWith("boundaries/"))).toEqual([]);
  });

  it("allows a module domain to import shared domain", async () => {
    const rules = await lintVirtual(
      "src/modules/probe-a/domain/boundary-probe-shared.ts",
      `import { resolveText } from "@/shared/domain/localized-text";\nexport const r = resolveText;\n`,
    );
    expect(rules.filter((m) => m.ruleId?.startsWith("boundaries/"))).toEqual([]);
  });

  it("lets a module domain use the shared form model but not another module's entry point", async () => {
    const ok = await lintVirtual(
      "src/modules/definitions/domain/boundary-probe-form-model.ts",
      `import { LIMITS } from "@/shared/domain/form-model";\nexport const l = LIMITS;\n`,
    );
    // No message at all: an unresolved import would surface as a type-aware lint error.
    expect(ok).toEqual([]);
    const bad = await lintVirtual(
      "src/modules/definitions/domain/boundary-probe-entry.ts",
      `import { sanitizeReturnTo } from "@/modules/identity/application";\nexport const s = sanitizeReturnTo;\n`,
    );
    expect(bad.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });

  it("treats nested form model files as shared domain", async () => {
    const ok = await lintVirtual(
      "src/shared/domain/form-model/field-types/boundary-probe-nested.ts",
      `import { z } from "zod";\nimport { LIMITS } from "../limits";\nexport const s = z.string().max(LIMITS.shortTextMax);\n`,
    );
    // No message at all: an unresolved import would surface as a type-aware lint error.
    expect(ok).toEqual([]);
    const bad = await lintVirtual(
      "src/shared/domain/form-model/field-types/boundary-probe-module.ts",
      `import { sanitizeReturnTo } from "@/modules/identity/application";\nexport const s = sanitizeReturnTo;\n`,
    );
    expect(bad.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });

  it("lets definitions use identity's public API but not review's", async () => {
    const ok = await lintVirtual(
      "src/modules/definitions/application/boundary-probe-ok.ts",
      `import { sanitizeReturnTo } from "@/modules/identity/application";\nexport const s = sanitizeReturnTo;\n`,
    );
    expect(ok.filter((m) => m.ruleId?.startsWith("boundaries/"))).toEqual([]);
    await lintVirtual(
      "src/modules/review/application/boundary-probe-target.ts",
      `export const y = 1;\n`,
    );
    const bad = await lintVirtual(
      "src/modules/definitions/application/boundary-probe-bad.ts",
      `import { y } from "@/modules/review/application/boundary-probe-target";\nexport const z = y;\n`,
    );
    expect(bad.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });

  it("forbids definitions reaching past identity's application entry point", async () => {
    await lintVirtual(
      "src/modules/identity/application/boundary-probe-deep.ts",
      `export const y = 1;\n`,
    );
    const rules = await lintVirtual(
      "src/modules/definitions/application/boundary-probe-deep.ts",
      `import { y } from "@/modules/identity/application/boundary-probe-deep";\nexport const z = y;\n`,
    );
    expect(rules.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });

  it("lets a module's own layers import its own application files", async () => {
    await lintVirtual(
      "src/modules/definitions/application/boundary-probe-own-target.ts",
      `export const y = 1;\n`,
    );
    const rules = await lintVirtual(
      "src/modules/definitions/infrastructure/boundary-probe-own.ts",
      `import { y } from "@/modules/definitions/application/boundary-probe-own-target";\nexport const z = y;\n`,
    );
    expect(rules.filter((m) => m.ruleId?.startsWith("boundaries/"))).toEqual([]);
  });

  it("forbids submissions importing review's application layer", async () => {
    const rules = await lintVirtual(
      "src/modules/submissions/application/boundary-probe.ts",
      `import { y } from "@/modules/review/application/boundary-probe-target";\nexport const z = y;\n`,
    );
    expect(rules.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });
});

describe("files outside a layer folder", () => {
  const boundaryRules = (messages: { ruleId: string | null }[]) =>
    messages.map((m) => m.ruleId).filter((id) => id?.startsWith("boundaries/"));

  it("refuses a stray module file importing another module's infrastructure", async () => {
    const rules = await lintVirtual(
      "src/modules/media/boundary-probe-stray.ts",
      `import { GoogleOidcAdmin } from "@/modules/identity/infrastructure/google-oidc";\nexport const g = GoogleOidcAdmin;\n`,
    );
    expect(boundaryRules(rules)).not.toEqual([]);
  });

  it("refuses a stray shared file importing a module", async () => {
    const rules = await lintVirtual(
      "src/shared/boundary-probe-stray.ts",
      `import { sanitizeReturnTo } from "@/modules/identity/application";\nexport const s = sanitizeReturnTo;\n`,
    );
    expect(boundaryRules(rules)).not.toEqual([]);
  });

  it("refuses a stray file in the src root importing module infrastructure", async () => {
    const rules = await lintVirtual(
      "src/boundary-probe-stray.ts",
      `import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";\nexport const p = PgAuditLog;\n`,
    );
    expect(boundaryRules(rules)).not.toEqual([]);
  });

  it("refuses a stray file in the src root even without imports", async () => {
    const rules = await lintVirtual("src/boundary-probe-empty.ts", `export const x = 1;\n`);
    expect(boundaryRules(rules)).toContain("boundaries/no-unknown-files");
  });

  it("lets the Next proxy and its test import the container and the identity public API", async () => {
    const results = await eslint.lintFiles([
      path.join(process.cwd(), "src/proxy.ts"),
      path.join(process.cwd(), "src/proxy.test.ts"),
    ]);
    expect(results.flatMap((r) => boundaryRules(r.messages))).toEqual([]);
  });
});
