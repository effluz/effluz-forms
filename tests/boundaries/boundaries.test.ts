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

  it("lets definitions use form-model's public API but not review's", async () => {
    const ok = await lintVirtual(
      "src/modules/definitions/application/boundary-probe-ok.ts",
      `import { LIMITS } from "@/modules/form-model/application";\nexport const l = LIMITS;\n`,
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

  it("forbids submissions importing review's application layer", async () => {
    const rules = await lintVirtual(
      "src/modules/submissions/application/boundary-probe.ts",
      `import { y } from "@/modules/review/application/boundary-probe-target";\nexport const z = y;\n`,
    );
    expect(rules.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });
});
