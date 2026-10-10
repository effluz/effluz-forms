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
    await lintVirtual("src/modules/probe-a/application/index.ts", `export const y = 1;\n`);
    const rules = await lintVirtual(
      "src/modules/probe-a/domain/x.ts",
      `import { y } from "../application";\nexport const z = y;\n`,
    );
    expect(rules.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });

  it("forbids domain importing react", async () => {
    const rules = await lintVirtual(
      "src/modules/probe-a/domain/r.ts",
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
    await lintVirtual("src/modules/probe-a/domain/inner.ts", `export const y = 1;\n`);
    const rules = await lintVirtual(
      "src/modules/probe-b/domain/x.ts",
      `import { y } from "../../probe-a/domain/inner";\nexport const z = y;\n`,
    );
    expect(rules.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });

  it("forbids domain importing a prefixed Node core module", async () => {
    const rules = await lintVirtual(
      "src/modules/probe-a/domain/io.ts",
      `import { readFileSync } from "node:fs";\nexport const z = readFileSync;\n`,
    );
    expect(rules.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });

  it("forbids domain importing a bare Node core module", async () => {
    const rules = await lintVirtual(
      "src/modules/probe-a/domain/io-bare.ts",
      `import { readFileSync } from "fs";\nexport const z = readFileSync;\n`,
    );
    expect(rules.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });

  it("allows domain importing zod", async () => {
    const rules = await lintVirtual(
      "src/modules/probe-a/domain/ok.ts",
      `import { z } from "zod";\nexport const s = z.string();\n`,
    );
    expect(rules.filter((m) => m.ruleId?.startsWith("boundaries/"))).toEqual([]);
  });
});
