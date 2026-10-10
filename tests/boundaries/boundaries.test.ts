import { ESLint } from "eslint";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });
const PROBE_ROOT = path.join(process.cwd(), "src/modules");
const written: string[] = [];

async function lintVirtual(relativePath: string, code: string) {
  const file = path.join(process.cwd(), relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, code);
  written.push(file);
  const [result] = await eslint.lintFiles([file]);
  return result?.messages ?? [];
}

afterAll(() => {
  for (const f of written) rmSync(f, { force: true });
  for (const dir of ["probe-a", "probe-b", "definitions", "review"]) {
    rmSync(path.join(PROBE_ROOT, dir), { recursive: true, force: true });
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

  it("allows domain importing zod", async () => {
    const rules = await lintVirtual(
      "src/modules/probe-a/domain/ok.ts",
      `import { z } from "zod";\nexport const s = z.string();\n`,
    );
    expect(rules.filter((m) => m.ruleId?.startsWith("boundaries/"))).toEqual([]);
  });
});
