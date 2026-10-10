# Form Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the repository toolchain and CI, then build the `form-model` module: the pure, framework-free contract that parses form versions, evaluates visibility, validates submissions, validates drafts for publishing, and formats exports, with a field type registry and a conformance suite covering all twelve first-release field types.

**Architecture:** `form-model` is the bottom of the module graph in `specs/architecture.md`. It has a `domain/` layer (schemas, registry, evaluators) and an `application/` layer that is only a public API barrel. No infrastructure, no presentation, no I/O. Field types are registered capabilities: each one file exporting a `FieldTypeDefinition` plus test fixtures, and a conformance suite iterates the registry so a type that is missing a capability fails the build. Zod schemas are the single source of both runtime validation and TypeScript types.

**Tech Stack:** Node 24 LTS, pnpm, TypeScript strict, Next.js (app scaffold only in this plan), Zod 4, Vitest 3, ESLint 9 flat config with typescript-eslint and eslint-plugin-boundaries, Prettier, GitHub Actions.

**Spec:** `specs/form-definition.md` (primary), `specs/architecture.md` (module map, ports), `specs/system/security.md` (system maximums), `specs/system/ci-cd.md` (workflow `ci`), `specs/ui-ux/renderer.md` (validation message keys), `specs/ui-ux/builder.md` (publish error keys), `specs/use-cases/reference-form-preemie-stories.md` (acceptance fixture), `CLAUDE.md` (layer rules, testing standards).

## Global Constraints

- Layers: `domain` imports nothing outside itself except `src/shared/domain` and `zod`; `application` imports `domain` only. No React, no Next.js, no Node built-ins other than none. Enforced by ESLint boundaries from Task 2 on.
- `form-model` may depend only on `shared` (`specs/architecture.md`, Modules table).
- All code, comments, commits in English. Conventional Commits with scope `form-model`, `shared`, `tooling`, `ci`.
- TDD: every task writes the failing test first and runs it before implementing.
- No real personal data in fixtures. The reference form fixture uses the form's structure and synthetic answers only.
- System maximums, copied from `specs/system/security.md`: pages per form 20; input fields per page 15, builder warns at 7; options per choice field 50; text answer length 5,000 characters, `long_text` 20,000; files per upload field 10; file size 10 MB per image, 10 MB per video, 100 MB per submission; retention 1 to 36 months.
- Validation issue codes must equal the renderer catalog keys in `specs/ui-ux/renderer.md` (`required`, `min_length`, `max_length`, `pattern`, `email_syntax`, `number_min`, `number_max`, `integer`, `not_a_number`, `date_invalid`, `date_min`, `date_max`, `date_not_future`, `choice_min`, `choice_max`, `must_be_true`, `consent`, `files_min`, `files_max`) plus two model-only codes `invalid_shape` and `unknown_option`.
- Publish issue codes must equal the builder `err.*` keys in `specs/ui-ux/builder.md`: `no_input`, `unlabeled`, `missing_translation`, `option_unlabeled`, `consent_missing`, `consent_checklist`, `retention_missing`, `confirmation_missing`, `dangling_condition`, `over_maximum`, `submitter_email_dup`, `header_alt_missing`.
- Conditions reference only earlier fields; hidden field answers are discarded; `required` is skipped for hidden fields (`specs/form-definition.md`, Conditional logic).
- Consent checklist has exactly nine items (`specs/form-definition.md`, Consent text).

## Review Focus

Inputs the spec implies but no single requirement names. Each line has a test pinned in the task that owns the code.

1. **Answer document with extra keys** that belong to no field in the version, or to a hidden field. Expected: silently dropped from normalized answers, never an error. Task 16.
2. **Condition value of the wrong type** for the referenced field, for example `greater_than` with a string against a `number` field. Expected: `parseVersion` rejects it with a precise path; `evaluateCondition` on an already-parsed version never throws. Tasks 5 and 14.
3. **Unicode and whitespace in text answers**: leading and trailing whitespace, zero-width characters, combining marks. Expected: trimmed and NFC-normalized before length rules so a 5,000-character limit means characters a person sees. Task 8.
4. **A `single_choice` set to dropdown with six or fewer options.** Expected: parses fine; the renderer falls back to radio; the model exposes `effectiveDisplay` so builder and renderer agree. Task 10.
5. **A date like `2026-02-30` or `2026-13-01`**, well-formed but not real. Expected: `date_invalid`, not `date_min` or acceptance. Task 9.

---

## File structure

```
.github/workflows/ci.yml                     lint, typecheck, unit, build
.node-version                                24
package.json, pnpm-lock.yaml, tsconfig.json, next.config.ts
vitest.config.ts, eslint.config.mjs, .prettierrc, .prettierignore
specs/decisions/0012-toolchain.md            TypeScript, pnpm, Vitest, ESLint boundaries, Zod in domain

src/app/layout.tsx, src/app/page.tsx         Next.js scaffold, untouched placeholder
src/shared/domain/localized-text.ts          LocalizedText, Languages, resolveText, isComplete
src/shared/domain/localized-text.test.ts

src/modules/form-model/domain/
  limits.ts                                  system maximums as constants
  keys.ts                                    key schema and format
  issues.ts                                  ValidationIssue, PublishIssue, code unions
  operators.ts                               operator registry with compatibility and evaluate
  condition.ts                               Condition schema, evaluateCondition
  rules.ts                                   validation rule schemas and evaluators
  field-type.ts                              FieldTypeDefinition interface, defineFieldType helper
  registry.ts                                FieldTypeRegistry
  field-types/short-text.ts … section.ts      twelve types, each with fixtures
  field-types/index.ts                       buildDefaultRegistry()
  field-types/conformance.test.ts            iterates the registry
  version.ts                                 Version schema, parseVersion with registry refinement
  visibility.ts                              evaluateVisibility
  submission.ts                              validateSubmission
  publish.ts                                 validateForPublish, collectsPersonalData
  export.ts                                  exportColumns, exportRow
  consent-text.ts                            consentTextVersion hash
src/modules/form-model/application/index.ts  public API
tests/fixtures/reference-form.ts             the preemie stories form as a Version
tests/fixtures/reference-form.test.ts        end-to-end through the public API
```

Every `*.ts` under `domain/` has a sibling `*.test.ts` unless named above as a test file itself.

---

### Task 1: Scaffold the application and record the toolchain

**Files:**
- Create: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `.node-version`, `src/app/layout.tsx`, `src/app/page.tsx` (all by the scaffolder)
- Create: `specs/decisions/0012-toolchain.md`
- Modify: `.gitignore` (append `.vitest/`, `coverage/`, `playwright-report/`)

**Interfaces:**
- Produces: `pnpm typecheck` script; `tsconfig.json` with `paths` alias `@/*` to `src/*`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

- [ ] **Step 1: Pin Node and scaffold**

```bash
echo "24" > .node-version
corepack enable && corepack prepare pnpm@latest --activate
pnpm create next-app@latest . --typescript --eslint --app --src-dir --import-alias "@/*" --no-tailwind --use-pnpm --skip-install
pnpm install
```

If the scaffolder refuses a non-empty directory, run it in a temporary folder and copy `package.json`, `tsconfig.json`, `next.config.ts`, `next-env.d.ts`, `src/app/`, `public/` over, then `pnpm install`.

- [ ] **Step 2: Harden tsconfig and add scripts**

Replace `compilerOptions` in `tsconfig.json` with:

```json
{
  "target": "ES2022",
  "lib": ["dom", "dom.iterable", "es2023"],
  "module": "esnext",
  "moduleResolution": "bundler",
  "jsx": "preserve",
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitOverride": true,
  "noFallthroughCasesInSwitch": true,
  "verbatimModuleSyntax": true,
  "isolatedModules": true,
  "esModuleInterop": true,
  "skipLibCheck": true,
  "noEmit": true,
  "incremental": true,
  "resolveJsonModule": true,
  "allowJs": false,
  "baseUrl": ".",
  "paths": { "@/*": ["src/*"] },
  "plugins": [{ "name": "next" }]
}
```

Add to `package.json` scripts:

```json
"typecheck": "tsc --noEmit",
"format": "prettier --write .",
"format:check": "prettier --check ."
```

- [ ] **Step 3: Verify the scaffold typechecks and builds**

Run: `pnpm typecheck && pnpm build`
Expected: both exit 0.

- [ ] **Step 4: Write ADR 0012**

`specs/decisions/0012-toolchain.md`:

```markdown
# 0012. Toolchain: TypeScript strict, pnpm, Vitest, ESLint boundaries, Zod in the domain layer

Status: accepted
Date: 2026-10-10

## Context

ADR 0008 fixed Next.js and React. The language, package manager, test
runner, linter and the way layer rules are enforced were open. The form
model needs runtime validation whose types cannot drift from the schema.

## Decision

TypeScript with `strict`, `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. pnpm with a committed lockfile and frozen
installs in CI. Vitest for unit and integration tests, Playwright for
end-to-end tests when they arrive. ESLint flat config with typescript-eslint
and eslint-plugin-boundaries encoding the layer rules of `CLAUDE.md` and
the module graph of `architecture.md`. Prettier for formatting.

Zod is permitted in `domain/` layers as the schema language. It is a
framework-free library with no I/O; the types it infers are the domain
types. No other third-party dependency is allowed in `domain/`.

## Consequences

- Layer violations fail in the editor and in CI, not in review.
- Domain types are derived from schemas; there is one definition per shape.
- Zod is a dependency of every module. Replacing it would touch every
  schema; accepted.
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(tooling): scaffold Next.js app with strict TypeScript and record toolchain ADR"
```

---

### Task 2: Test runner, lint, format and layer boundaries

**Files:**
- Create: `vitest.config.ts`, `eslint.config.mjs`, `.prettierrc`, `.prettierignore`
- Create: `src/shared/domain/.gitkeep`, `src/modules/.gitkeep`
- Create: `tests/boundaries/boundaries.test.ts`
- Modify: `package.json` (scripts, devDependencies)

**Interfaces:**
- Produces: scripts `test`, `test:watch`, `lint`; boundary element types `shared-domain`, `module-domain`, `module-application`, `module-infrastructure`, `module-presentation`, `app`.

- [ ] **Step 1: Install dev dependencies**

```bash
pnpm add -D vitest @vitest/coverage-v8 prettier eslint @eslint/js typescript-eslint eslint-plugin-boundaries eslint-config-prettier eslint-plugin-import-x
pnpm add zod
```

- [ ] **Step 2: Write the failing boundary test**

This test runs ESLint programmatically on probe files that violate a rule and expects an error, so the configuration itself is under test. Probes are written to disk under `src/modules/boundary-probe/` because type-aware linting needs files that belong to the TypeScript project; they are removed after the run and the folder is listed in `.gitignore`.

`tests/boundaries/boundaries.test.ts`:

```ts
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
  return result?.messages.map((m) => m.ruleId) ?? [];
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
    expect(rules).toContain("boundaries/element-types");
  });

  it("forbids domain importing react", async () => {
    const rules = await lintVirtual(
      "src/modules/probe-a/domain/r.ts",
      `import * as React from "react";\nexport const z = React;\n`,
    );
    expect(rules).toContain("boundaries/external");
  });

  it("forbids a module importing another module's domain", async () => {
    await lintVirtual("src/modules/probe-a/domain/inner.ts", `export const y = 1;\n`);
    const rules = await lintVirtual(
      "src/modules/probe-b/domain/x.ts",
      `import { y } from "../../probe-a/domain/inner";\nexport const z = y;\n`,
    );
    expect(rules).toContain("boundaries/element-types");
  });

  it("allows domain importing zod", async () => {
    const rules = await lintVirtual(
      "src/modules/probe-a/domain/ok.ts",
      `import { z } from "zod";\nexport const s = z.string();\n`,
    );
    expect(rules.filter((r) => r?.startsWith("boundaries/"))).toEqual([]);
  });
});
```

Add `src/modules/probe-*/` to `.gitignore`.

- [ ] **Step 3: Write vitest config and run the test to see it fail**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    coverage: { provider: "v8", include: ["src/**"], exclude: ["src/app/**"] },
  },
});
```

Add scripts: `"test": "vitest run"`, `"test:watch": "vitest"`, `"lint": "eslint ."`.

Run: `pnpm test tests/boundaries`
Expected: FAIL, the rule ids are not reported because `eslint.config.mjs` does not define boundaries yet.

- [ ] **Step 4: Write the ESLint configuration**

`eslint.config.mjs`:

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";
import prettier from "eslint-config-prettier";

const layerOrder = ["domain", "application", "infrastructure", "presentation"];

export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "coverage/**", "next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
  {
    plugins: { boundaries },
    settings: {
      "boundaries/include": ["src/**/*"],
      "boundaries/elements": [
        { type: "app", pattern: "src/app/**", mode: "full" },
        { type: "shared-domain", pattern: "src/shared/domain/**", mode: "full" },
        { type: "shared-application", pattern: "src/shared/application/**", mode: "full" },
        { type: "shared-infrastructure", pattern: "src/shared/infrastructure/**", mode: "full" },
        { type: "shared-presentation", pattern: "src/shared/presentation/**", mode: "full" },
        ...layerOrder.map((layer) => ({
          type: `module-${layer}`,
          pattern: `src/modules/*/${layer}/**`,
          capture: ["module"],
          mode: "full",
        })),
      ],
    },
    rules: {
      "boundaries/no-unknown-files": "error",
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: "shared-domain", allow: ["shared-domain"] },
            { from: "shared-application", allow: ["shared-domain", "shared-application"] },
            { from: "shared-infrastructure", allow: ["shared-domain", "shared-application", "shared-infrastructure"] },
            { from: "shared-presentation", allow: ["shared-domain", "shared-application", "shared-presentation"] },
            { from: "module-domain", allow: ["shared-domain", ["module-domain", { module: "${from.module}" }]] },
            { from: "module-application", allow: ["shared-domain", "shared-application", ["module-domain", { module: "${from.module}" }], ["module-application", { module: "${from.module}" }], ["module-application", { module: "!${from.module}" }]] },
            { from: "module-infrastructure", allow: ["shared-domain", "shared-application", "shared-infrastructure", ["module-domain", { module: "${from.module}" }], ["module-application", { module: "${from.module}" }], ["module-infrastructure", { module: "${from.module}" }]] },
            { from: "module-presentation", allow: ["shared-domain", "shared-application", "shared-presentation", ["module-domain", { module: "${from.module}" }], ["module-application", { module: "${from.module}" }], ["module-presentation", { module: "${from.module}" }]] },
            { from: "app", allow: ["app", "shared-application", "shared-infrastructure", "shared-presentation", "module-application", "module-infrastructure", "module-presentation"] },
          ],
        },
      ],
      "boundaries/external": [
        "error",
        {
          default: "allow",
          rules: [
            { from: ["module-domain", "shared-domain"], disallow: ["react", "react-dom", "next", "next/*", "node:*"], message: "domain depends on nothing outside itself" },
            { from: ["module-application", "shared-application"], disallow: ["react", "react-dom", "next", "next/*"], message: "application is framework-free" },
          ],
        },
      ],
    },
  },
  prettier,
);
```

Cross-module application imports are allowed only via another module's `application/index.ts`; the inter-module DAG from `architecture.md` is added in Task 19 once a second module exists to test against.

`.prettierrc`: `{ "printWidth": 100, "trailingComma": "all" }`. `.prettierignore`: `.next`, `pnpm-lock.yaml`, `coverage`.

- [ ] **Step 5: Run the boundary test, lint and format**

Run: `pnpm test tests/boundaries && pnpm lint && pnpm format && pnpm format:check`
Expected: 4 tests pass; lint exits 0 on the scaffold.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(tooling): add Vitest, ESLint with layer boundaries, Prettier"
```

---

### Task 3: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: a required status check named `ci` composed of jobs `lint`, `typecheck`, `unit`, `build`. The `integration` and `e2e` jobs from `specs/system/ci-cd.md` are added by the plans that introduce Postgres adapters and the renderer; this workflow states that in a comment.

- [ ] **Step 1: Write the workflow**

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<pin to current commit SHA>
      - uses: pnpm/action-setup@<pin to current commit SHA>
      - uses: actions/setup-node@<pin to current commit SHA>
        with: { node-version-file: .node-version, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm lint
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<pin>
      - uses: pnpm/action-setup@<pin>
      - uses: actions/setup-node@<pin>
        with: { node-version-file: .node-version, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<pin>
      - uses: pnpm/action-setup@<pin>
      - uses: actions/setup-node@<pin>
        with: { node-version-file: .node-version, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test -- --reporter=default --reporter=junit --outputFile=reports/unit.xml
      - if: failure()
        uses: actions/upload-artifact@<pin>
        with: { name: unit-report, path: reports/ }
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<pin>
      - uses: pnpm/action-setup@<pin>
      - uses: actions/setup-node@<pin>
        with: { node-version-file: .node-version, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
  # integration and e2e jobs are added by the plans that introduce the
  # Postgres adapters and the renderer; see specs/system/ci-cd.md.
  ci:
    if: always()
    needs: [lint, typecheck, unit, build]
    runs-on: ubuntu-latest
    steps:
      - run: |
          for r in "${{ needs.lint.result }}" "${{ needs.typecheck.result }}" "${{ needs.unit.result }}" "${{ needs.build.result }}"; do
            test "$r" = "success" || exit 1
          done
```

Replace every `<pin>` with the full commit SHA of the action's current major release, looked up on GitHub at execution time, and add a trailing comment with the tag, for example `# v4`.

- [ ] **Step 2: Verify locally what CI will run**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all exit 0.

- [ ] **Step 3: Commit, push the branch, open a draft PR, confirm `ci` is green**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint, typecheck, unit and build jobs"
git push -u origin HEAD
gh pr create --draft --title "feat(form-model): toolchain and form model" --body "Implements docs/superpowers/plans/2026-10-10-form-model.md"
```

Then enable branch protection on `main` requiring the `ci` check, as `specs/system/ci-cd.md` states. This is a repository setting, done once by a maintainer.

---

### Task 4: Shared `LocalizedText` and `Languages`

**Files:**
- Create: `src/shared/domain/localized-text.ts`
- Test: `src/shared/domain/localized-text.test.ts`
- Delete: `src/shared/domain/.gitkeep`

**Interfaces:**
- Produces:
  - `Locale = "en" | "es"`, `localeSchema`
  - `Languages = "bilingual" | "en" | "es"`, `languagesSchema`
  - `LocalizedText = { en?: string; es?: string }`, `localizedTextSchema` (each value a string, max 20,000 characters)
  - `requiredLocales(languages: Languages): Locale[]`
  - `isComplete(text: LocalizedText | undefined, languages: Languages): boolean` meaning every required locale has a non-blank string
  - `resolveText(text: LocalizedText, locale: Locale, languages: Languages): string` returning the requested locale, falling back to the other required locale, then `""`
  - `localizedTextFrom(en: string, es: string): LocalizedText`

- [ ] **Step 1: Write the failing tests**

`src/shared/domain/localized-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isComplete,
  localizedTextFrom,
  localizedTextSchema,
  requiredLocales,
  resolveText,
} from "./localized-text";

describe("requiredLocales", () => {
  it("returns both for bilingual and one otherwise", () => {
    expect(requiredLocales("bilingual")).toEqual(["en", "es"]);
    expect(requiredLocales("es")).toEqual(["es"]);
  });
});

describe("isComplete", () => {
  it("needs every required locale non-blank", () => {
    expect(isComplete({ en: "Name", es: "Nombre" }, "bilingual")).toBe(true);
    expect(isComplete({ en: "Name", es: "  " }, "bilingual")).toBe(false);
    expect(isComplete({ es: "Nombre" }, "es")).toBe(true);
    expect(isComplete(undefined, "es")).toBe(false);
  });
});

describe("resolveText", () => {
  it("prefers the requested locale and falls back to the other required one", () => {
    const t = localizedTextFrom("Name", "Nombre");
    expect(resolveText(t, "es", "bilingual")).toBe("Nombre");
    expect(resolveText({ en: "Name" }, "es", "bilingual")).toBe("Name");
    expect(resolveText({}, "es", "es")).toBe("");
  });
});

describe("localizedTextSchema", () => {
  it("rejects non-string values and overlong strings", () => {
    expect(localizedTextSchema.safeParse({ en: 1 }).success).toBe(false);
    expect(localizedTextSchema.safeParse({ en: "x".repeat(20_001) }).success).toBe(false);
    expect(localizedTextSchema.safeParse({}).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/shared/domain`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/shared/domain/localized-text.ts`:

```ts
import { z } from "zod";

export const localeSchema = z.enum(["en", "es"]);
export type Locale = z.infer<typeof localeSchema>;

export const languagesSchema = z.enum(["bilingual", "en", "es"]);
export type Languages = z.infer<typeof languagesSchema>;

export const MAX_TEXT_LENGTH = 20_000;

export const localizedTextSchema = z.object({
  en: z.string().max(MAX_TEXT_LENGTH).optional(),
  es: z.string().max(MAX_TEXT_LENGTH).optional(),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;

export function localizedTextFrom(en: string, es: string): LocalizedText {
  return { en, es };
}

export function requiredLocales(languages: Languages): Locale[] {
  return languages === "bilingual" ? ["en", "es"] : [languages];
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

export function isComplete(text: LocalizedText | undefined, languages: Languages): boolean {
  if (!text) return false;
  return requiredLocales(languages).every((locale) => !isBlank(text[locale]));
}

export function resolveText(text: LocalizedText, locale: Locale, languages: Languages): string {
  const own = text[locale];
  if (!isBlank(own)) return own as string;
  for (const fallback of requiredLocales(languages)) {
    const candidate = text[fallback];
    if (!isBlank(candidate)) return candidate as string;
  }
  return "";
}
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test src/shared/domain && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git rm -q src/shared/domain/.gitkeep
git add src/shared/domain
git commit -m "feat(shared): add LocalizedText and Languages"
```

---

### Task 5: Limits, keys, issue types, operators and conditions

**Files:**
- Create: `src/modules/form-model/domain/limits.ts`
- Create: `src/modules/form-model/domain/keys.ts`
- Create: `src/modules/form-model/domain/issues.ts`
- Create: `src/modules/form-model/domain/operators.ts`
- Create: `src/modules/form-model/domain/condition.ts`
- Test: `src/modules/form-model/domain/keys.test.ts`, `operators.test.ts`, `condition.test.ts`
- Delete: `src/modules/.gitkeep`

**Interfaces:**
- Produces:
  - `LIMITS` constant: `{ pagesPerForm: 20, inputFieldsPerPage: 15, inputFieldsPerPageWarn: 7, optionsPerChoice: 50, shortTextMax: 5000, longTextMax: 20000, filesPerField: 10, fileSizeMb: 10, submissionSizeMb: 100, retentionMonthsMin: 1, retentionMonthsMax: 36, retentionMonthsDefault: 12 }`
  - `keySchema` matching `/^[a-z][a-z0-9_]{3,31}$/`, `type Key = string & { __brand: "Key" }` via `z.string().regex(...).brand("Key")`
  - `ValidationIssue = { code: ValidationCode; field: Key; params?: Record<string, string | number> }`, `validationCodes` tuple of the codes in Global Constraints
  - `PublishIssue = { code: PublishCode; path: string; params?: Record<string, string | number> }`, `publishCodes` tuple
  - `OperatorId` union of the nine operators; `operatorSchema`
  - `OPERATORS: Record<OperatorId, OperatorDefinition>` where `OperatorDefinition = { id; needsValue: boolean; evaluate(answer: unknown, value: unknown): boolean }`
  - `conditionSchema`, `Condition`, `Clause`
  - `evaluateCondition(condition: Condition, answers: Readonly<Record<string, unknown>>): boolean`

- [ ] **Step 1: Write the failing tests**

`keys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { keySchema } from "./keys";

describe("keySchema", () => {
  it("accepts lowercase alphanumeric keys starting with a letter", () => {
    expect(keySchema.safeParse("f_ab12cd34").success).toBe(true);
    expect(keySchema.safeParse("page1").success).toBe(true);
  });
  it("rejects uppercase, short, spaced or leading-digit keys", () => {
    for (const bad of ["F1", "ab", "a b", "1abc", "a".repeat(33)]) {
      expect(keySchema.safeParse(bad).success).toBe(false);
    }
  });
});
```

`operators.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { OPERATORS } from "./operators";

describe("operators", () => {
  it("equals compares primitives strictly and arrays by membership-free equality", () => {
    expect(OPERATORS.equals.evaluate("a", "a")).toBe(true);
    expect(OPERATORS.equals.evaluate(1, "1")).toBe(false);
    expect(OPERATORS.not_equals.evaluate(true, false)).toBe(true);
  });
  it("contains works on strings and arrays", () => {
    expect(OPERATORS.contains.evaluate("hello world", "world")).toBe(true);
    expect(OPERATORS.contains.evaluate(["a", "b"], "b")).toBe(true);
    expect(OPERATORS.not_contains.evaluate(["a"], "b")).toBe(true);
    expect(OPERATORS.contains.evaluate(undefined, "x")).toBe(false);
  });
  it("is_empty treats undefined, blank strings and empty arrays as empty", () => {
    for (const empty of [undefined, null, "", "  ", []]) {
      expect(OPERATORS.is_empty.evaluate(empty, undefined)).toBe(true);
      expect(OPERATORS.is_not_empty.evaluate(empty, undefined)).toBe(false);
    }
    expect(OPERATORS.is_empty.evaluate(0, undefined)).toBe(false);
  });
  it("greater_than and less_than compare numbers and ISO dates, never mixed types", () => {
    expect(OPERATORS.greater_than.evaluate(5, 3)).toBe(true);
    expect(OPERATORS.less_than.evaluate("2026-01-01", "2026-02-01")).toBe(true);
    expect(OPERATORS.greater_than.evaluate("5", 3)).toBe(false);
  });
  it("is_one_of checks membership of a primitive in a list", () => {
    expect(OPERATORS.is_one_of.evaluate("b", ["a", "b"])).toBe(true);
    expect(OPERATORS.is_one_of.evaluate("c", ["a", "b"])).toBe(false);
    expect(OPERATORS.is_one_of.evaluate("a", "a")).toBe(false);
  });
  it("never throws on odd inputs", () => {
    for (const op of Object.values(OPERATORS)) {
      expect(() => op.evaluate({ a: 1 }, Symbol("x"))).not.toThrow();
    }
  });
});
```

`condition.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { conditionSchema, evaluateCondition } from "./condition";

const answers = { twins: "yes", weeks: 30, tags: ["a"] };

describe("conditionSchema", () => {
  it("accepts a bare clause, all and any groups, and nested groups", () => {
    expect(conditionSchema.safeParse({ field: "twins", op: "equals", value: "yes" }).success).toBe(true);
    expect(
      conditionSchema.safeParse({
        all: [{ field: "twins", op: "equals", value: "yes" }, { any: [{ field: "weeks", op: "less_than", value: 32 }] }],
      }).success,
    ).toBe(true);
  });
  it("rejects a value on an operator that takes none and a missing value on one that does", () => {
    expect(conditionSchema.safeParse({ field: "twins", op: "is_empty", value: "x" }).success).toBe(false);
    expect(conditionSchema.safeParse({ field: "twins", op: "equals" }).success).toBe(false);
  });
});

describe("evaluateCondition", () => {
  it("evaluates clauses and groups", () => {
    expect(evaluateCondition({ field: "twins", op: "equals", value: "yes" }, answers)).toBe(true);
    expect(evaluateCondition({ all: [{ field: "twins", op: "equals", value: "yes" }, { field: "weeks", op: "greater_than", value: 35 }] }, answers)).toBe(false);
    expect(evaluateCondition({ any: [{ field: "twins", op: "equals", value: "no" }, { field: "weeks", op: "less_than", value: 35 }] }, answers)).toBe(true);
  });
  it("treats an empty all as true and an empty any as false", () => {
    expect(evaluateCondition({ all: [] }, answers)).toBe(true);
    expect(evaluateCondition({ any: [] }, answers)).toBe(false);
  });
  it("treats a missing field as undefined, not as an error", () => {
    expect(evaluateCondition({ field: "nope", op: "is_empty" }, answers)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test src/modules/form-model`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement limits, keys, issues**

`limits.ts`:

```ts
export const LIMITS = {
  pagesPerForm: 20,
  inputFieldsPerPage: 15,
  inputFieldsPerPageWarn: 7,
  optionsPerChoice: 50,
  shortTextMax: 5_000,
  longTextMax: 20_000,
  filesPerField: 10,
  fileSizeMb: 10,
  submissionSizeMb: 100,
  retentionMonthsMin: 1,
  retentionMonthsMax: 36,
  retentionMonthsDefault: 12,
} as const;
```

`keys.ts`:

```ts
import { z } from "zod";

export const keySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{3,31}$/, "key must be lowercase, start with a letter, 4 to 32 chars")
  .brand<"Key">();
export type Key = z.infer<typeof keySchema>;

export function asKey(value: string): Key {
  return keySchema.parse(value);
}
```

`issues.ts`:

```ts
import type { Key } from "./keys";

export const validationCodes = [
  "required", "min_length", "max_length", "pattern", "email_syntax",
  "number_min", "number_max", "integer", "not_a_number",
  "date_invalid", "date_min", "date_max", "date_not_future",
  "choice_min", "choice_max", "must_be_true", "consent",
  "files_min", "files_max", "invalid_shape", "unknown_option",
] as const;
export type ValidationCode = (typeof validationCodes)[number];

export type IssueParams = Record<string, string | number>;

export interface ValidationIssue {
  code: ValidationCode;
  field: Key;
  params?: IssueParams;
}

export const publishCodes = [
  "no_input", "unlabeled", "missing_translation", "option_unlabeled",
  "consent_missing", "consent_checklist", "retention_missing", "confirmation_missing",
  "dangling_condition", "over_maximum", "submitter_email_dup", "header_alt_missing",
] as const;
export type PublishCode = (typeof publishCodes)[number];

export interface PublishIssue {
  code: PublishCode;
  /** JSON-pointer-like path into the version, e.g. "pages/1/fields/3/label" */
  path: string;
  params?: IssueParams;
}
```

- [ ] **Step 4: Implement operators**

`operators.ts`:

```ts
import { z } from "zod";

export const operatorSchema = z.enum([
  "equals", "not_equals", "contains", "not_contains",
  "is_empty", "is_not_empty", "greater_than", "less_than", "is_one_of",
]);
export type OperatorId = z.infer<typeof operatorSchema>;

export interface OperatorDefinition {
  id: OperatorId;
  needsValue: boolean;
  evaluate(answer: unknown, value: unknown): boolean;
}

type Primitive = string | number | boolean;
const isPrimitive = (v: unknown): v is Primitive =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function isEmpty(answer: unknown): boolean {
  if (answer === undefined || answer === null) return true;
  if (typeof answer === "string") return answer.trim().length === 0;
  if (Array.isArray(answer)) return answer.length === 0;
  return false;
}

function compare(answer: unknown, value: unknown): number | undefined {
  if (typeof answer === "number" && typeof value === "number") return answer - value;
  if (typeof answer === "string" && typeof value === "string" && isoDate.test(answer) && isoDate.test(value)) {
    return answer < value ? -1 : answer > value ? 1 : 0;
  }
  return undefined;
}

function contains(answer: unknown, value: unknown): boolean {
  if (typeof answer === "string" && typeof value === "string") return answer.includes(value);
  if (Array.isArray(answer) && isPrimitive(value)) return answer.includes(value);
  return false;
}

const def = (id: OperatorId, needsValue: boolean, evaluate: OperatorDefinition["evaluate"]): OperatorDefinition => ({
  id, needsValue, evaluate: (a, v) => { try { return evaluate(a, v); } catch { return false; } },
});

export const OPERATORS: Record<OperatorId, OperatorDefinition> = {
  equals: def("equals", true, (a, v) => isPrimitive(a) && isPrimitive(v) && a === v),
  not_equals: def("not_equals", true, (a, v) => !(isPrimitive(a) && isPrimitive(v) && a === v)),
  contains: def("contains", true, contains),
  not_contains: def("not_contains", true, (a, v) => !contains(a, v)),
  is_empty: def("is_empty", false, (a) => isEmpty(a)),
  is_not_empty: def("is_not_empty", false, (a) => !isEmpty(a)),
  greater_than: def("greater_than", true, (a, v) => { const c = compare(a, v); return c !== undefined && c > 0; }),
  less_than: def("less_than", true, (a, v) => { const c = compare(a, v); return c !== undefined && c < 0; }),
  is_one_of: def("is_one_of", true, (a, v) => Array.isArray(v) && isPrimitive(a) && v.includes(a)),
};
```

- [ ] **Step 5: Implement conditions**

`condition.ts`:

```ts
import { z } from "zod";
import { keySchema } from "./keys";
import { OPERATORS, operatorSchema } from "./operators";

const clauseValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()]))]);

export const clauseSchema = z
  .object({ field: keySchema, op: operatorSchema, value: clauseValueSchema.optional() })
  .superRefine((clause, ctx) => {
    const needsValue = OPERATORS[clause.op].needsValue;
    if (needsValue && clause.value === undefined) ctx.addIssue({ code: "custom", message: "operator needs a value", path: ["value"] });
    if (!needsValue && clause.value !== undefined) ctx.addIssue({ code: "custom", message: "operator takes no value", path: ["value"] });
  });
export type Clause = z.infer<typeof clauseSchema>;

export type Condition = Clause | { all: Condition[] } | { any: Condition[] };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    clauseSchema,
    z.object({ all: z.array(conditionSchema) }).strict(),
    z.object({ any: z.array(conditionSchema) }).strict(),
  ]),
);

export function evaluateCondition(condition: Condition, answers: Readonly<Record<string, unknown>>): boolean {
  if ("all" in condition) return condition.all.every((c) => evaluateCondition(c, answers));
  if ("any" in condition) return condition.any.some((c) => evaluateCondition(c, answers));
  return OPERATORS[condition.op].evaluate(answers[condition.field], condition.value);
}

/** Every field key referenced anywhere in the condition, in order of appearance. */
export function referencedKeys(condition: Condition): string[] {
  if ("all" in condition) return condition.all.flatMap(referencedKeys);
  if ("any" in condition) return condition.any.flatMap(referencedKeys);
  return [condition.field];
}
```

- [ ] **Step 6: Run tests, lint, typecheck**

Run: `pnpm test src/modules/form-model && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git rm -q src/modules/.gitkeep
git add src/modules/form-model
git commit -m "feat(form-model): add limits, keys, issue types, operators and conditions"
```

---

### Task 6: Validation rules

**Files:**
- Create: `src/modules/form-model/domain/rules.ts`
- Test: `src/modules/form-model/domain/rules.test.ts`

**Interfaces:**
- Produces:
  - `ruleSchema` discriminated union on `rule`: `min_length {value}`, `max_length {value}`, `pattern {value: string, flags?: "i"}`, `min_value {value}`, `max_value {value}`, `min_date {value: "YYYY-MM-DD"}`, `max_date {value}`, `not_future {}`, `min_selected {value}`, `max_selected {value}`, `must_be_true {}`, `min_files {value}`, `max_files {value}`
  - `RuleId`, `Rule`
  - `evaluateRule(rule: Rule, answer: unknown, ctx: { today: string }): ValidationCode | undefined` returning the issue code when the rule fails. `today` is an ISO date supplied by the caller; the domain has no clock.
  - `ruleParams(rule: Rule): IssueParams` giving `{ n }` or `{ date }` for messages.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { evaluateRule, ruleParams, ruleSchema } from "./rules";

const ctx = { today: "2026-10-10" };

describe("ruleSchema", () => {
  it("accepts known rules with the right value types", () => {
    expect(ruleSchema.safeParse({ rule: "min_length", value: 3 }).success).toBe(true);
    expect(ruleSchema.safeParse({ rule: "not_future" }).success).toBe(true);
    expect(ruleSchema.safeParse({ rule: "min_date", value: "2020-01-01" }).success).toBe(true);
  });
  it("rejects unknown rules, negative counts and malformed dates", () => {
    expect(ruleSchema.safeParse({ rule: "bogus" }).success).toBe(false);
    expect(ruleSchema.safeParse({ rule: "max_files", value: -1 }).success).toBe(false);
    expect(ruleSchema.safeParse({ rule: "min_date", value: "01/01/2020" }).success).toBe(false);
  });
  it("rejects an unsafe regex pattern", () => {
    expect(ruleSchema.safeParse({ rule: "pattern", value: "(" }).success).toBe(false);
  });
});

describe("evaluateRule", () => {
  it("length rules count user-perceived characters after trimming", () => {
    expect(evaluateRule({ rule: "min_length", value: 3 }, "  ab ", ctx)).toBe("min_length");
    expect(evaluateRule({ rule: "max_length", value: 2 }, "éé", ctx)).toBeUndefined();
    expect(evaluateRule({ rule: "max_length", value: 1 }, "👩‍👩‍👧", ctx)).toBe("max_length");
  });
  it("pattern matches the whole string", () => {
    expect(evaluateRule({ rule: "pattern", value: "[a-z]+" }, "abc", ctx)).toBeUndefined();
    expect(evaluateRule({ rule: "pattern", value: "[a-z]+" }, "abc1", ctx)).toBe("pattern");
  });
  it("number rules", () => {
    expect(evaluateRule({ rule: "min_value", value: 10 }, 9, ctx)).toBe("number_min");
    expect(evaluateRule({ rule: "max_value", value: 10 }, 10, ctx)).toBeUndefined();
  });
  it("date rules including not_future against the supplied today", () => {
    expect(evaluateRule({ rule: "not_future" }, "2026-10-11", ctx)).toBe("date_not_future");
    expect(evaluateRule({ rule: "not_future" }, "2026-10-10", ctx)).toBeUndefined();
    expect(evaluateRule({ rule: "min_date", value: "2026-01-01" }, "2025-12-31", ctx)).toBe("date_min");
    expect(evaluateRule({ rule: "max_date", value: "2026-01-01" }, "2026-01-02", ctx)).toBe("date_max");
  });
  it("selection, boolean and file count rules", () => {
    expect(evaluateRule({ rule: "min_selected", value: 2 }, ["a"], ctx)).toBe("choice_min");
    expect(evaluateRule({ rule: "max_selected", value: 1 }, ["a", "b"], ctx)).toBe("choice_max");
    expect(evaluateRule({ rule: "must_be_true" }, false, ctx)).toBe("must_be_true");
    expect(evaluateRule({ rule: "min_files", value: 1 }, [], ctx)).toBe("files_min");
    expect(evaluateRule({ rule: "max_files", value: 2 }, ["m1", "m2", "m3"], ctx)).toBe("files_max");
  });
  it("skips when the answer has the wrong shape; shape is the field type's job", () => {
    expect(evaluateRule({ rule: "min_length", value: 3 }, 42, ctx)).toBeUndefined();
    expect(evaluateRule({ rule: "min_value", value: 3 }, "x", ctx)).toBeUndefined();
  });
});

describe("ruleParams", () => {
  it("exposes n or date for messages", () => {
    expect(ruleParams({ rule: "min_length", value: 3 })).toEqual({ n: 3 });
    expect(ruleParams({ rule: "min_date", value: "2026-01-01" })).toEqual({ date: "2026-01-01" });
    expect(ruleParams({ rule: "not_future" })).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/modules/form-model/domain/rules`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`rules.ts`:

```ts
import { z } from "zod";
import type { IssueParams, ValidationCode } from "./issues";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().min(0);

function safeRegex(source: string): boolean {
  if (source.length > 200) return false;
  try { new RegExp(source, "u"); } catch { return false; }
  // Reject nested quantifiers, the common catastrophic-backtracking shape.
  return !/(\(.*[+*].*\))[+*{]/.test(source);
}

export const ruleSchema = z.discriminatedUnion("rule", [
  z.object({ rule: z.literal("min_length"), value: count }),
  z.object({ rule: z.literal("max_length"), value: count }),
  z.object({ rule: z.literal("pattern"), value: z.string().refine(safeRegex, "unsafe or invalid pattern"), flags: z.enum(["i"]).optional() }),
  z.object({ rule: z.literal("min_value"), value: z.number().finite() }),
  z.object({ rule: z.literal("max_value"), value: z.number().finite() }),
  z.object({ rule: z.literal("min_date"), value: isoDate }),
  z.object({ rule: z.literal("max_date"), value: isoDate }),
  z.object({ rule: z.literal("not_future") }),
  z.object({ rule: z.literal("min_selected"), value: count }),
  z.object({ rule: z.literal("max_selected"), value: count }),
  z.object({ rule: z.literal("must_be_true") }),
  z.object({ rule: z.literal("min_files"), value: count }),
  z.object({ rule: z.literal("max_files"), value: count }),
]);
export type Rule = z.infer<typeof ruleSchema>;
export type RuleId = Rule["rule"];

export interface RuleContext { today: string }

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function graphemeLength(text: string): number {
  let n = 0;
  for (const _ of segmenter.segment(text.normalize("NFC").trim())) n++;
  return n;
}

export function evaluateRule(rule: Rule, answer: unknown, ctx: RuleContext): ValidationCode | undefined {
  switch (rule.rule) {
    case "min_length": return typeof answer === "string" && graphemeLength(answer) < rule.value ? "min_length" : undefined;
    case "max_length": return typeof answer === "string" && graphemeLength(answer) > rule.value ? "max_length" : undefined;
    case "pattern": return typeof answer === "string" && !new RegExp(`^(?:${rule.value})$`, `u${rule.flags ?? ""}`).test(answer.trim()) ? "pattern" : undefined;
    case "min_value": return typeof answer === "number" && answer < rule.value ? "number_min" : undefined;
    case "max_value": return typeof answer === "number" && answer > rule.value ? "number_max" : undefined;
    case "min_date": return typeof answer === "string" && answer < rule.value ? "date_min" : undefined;
    case "max_date": return typeof answer === "string" && answer > rule.value ? "date_max" : undefined;
    case "not_future": return typeof answer === "string" && answer > ctx.today ? "date_not_future" : undefined;
    case "min_selected": return Array.isArray(answer) && answer.length < rule.value ? "choice_min" : undefined;
    case "max_selected": return Array.isArray(answer) && answer.length > rule.value ? "choice_max" : undefined;
    case "must_be_true": return answer === false ? "must_be_true" : undefined;
    case "min_files": return Array.isArray(answer) && answer.length < rule.value ? "files_min" : undefined;
    case "max_files": return Array.isArray(answer) && answer.length > rule.value ? "files_max" : undefined;
  }
}

export function ruleParams(rule: Rule): IssueParams {
  if (!("value" in rule)) return {};
  return typeof rule.value === "number" ? { n: rule.value } : rule.rule.endsWith("_date") ? { date: rule.value } : {};
}
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test src/modules/form-model/domain/rules && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/form-model/domain/rules.ts src/modules/form-model/domain/rules.test.ts
git commit -m "feat(form-model): add declarative validation rules"
```

---

### Task 7: Field type contract, registry and conformance suite

**Files:**
- Create: `src/modules/form-model/domain/field-type.ts`
- Create: `src/modules/form-model/domain/registry.ts`
- Create: `src/modules/form-model/domain/field-types/index.ts` (empty registry for now)
- Test: `src/modules/form-model/domain/registry.test.ts`
- Test: `src/modules/form-model/domain/field-types/conformance.test.ts`

**Interfaces:**
- Produces:

```ts
export const fieldTypeIds = ["short_text","long_text","email","phone","number","date","single_choice","multiple_choice","checkbox","consent","file_upload","section"] as const;
export type FieldTypeId = (typeof fieldTypeIds)[number];

export interface FieldTypeFixtures<S, A> {
  settings: S[];            // at least one valid settings object
  validAnswers: A[];        // at least one, each valid for settings[0]
  invalidAnswers: unknown[];// at least one wrong-shaped answer
  emptyAnswer?: A;          // an answer isEmpty() must report empty, if the type has one
}

export interface FieldTypeDefinition<S = unknown, A = unknown> {
  id: FieldTypeId;
  isInput: boolean;
  collectsPersonalData: boolean;
  settingsSchema: z.ZodType<S>;
  answerSchema: z.ZodType<A>;
  allowedRules: readonly RuleId[];
  allowedOperators: readonly OperatorId[];
  normalize(answer: A, settings: S): A;
  validate(answer: A, settings: S): ValidationCode[];   // type-intrinsic checks only
  isEmpty(answer: A): boolean;
  exportHeaders(label: string): string[];
  exportCells(answer: A | undefined, settings: S, locale: Locale, languages: Languages): string[];
  fixtures: FieldTypeFixtures<S, A>;
}

export function defineFieldType<S, A>(def: FieldTypeDefinition<S, A>): FieldTypeDefinition<S, A>;

export interface FieldTypeRegistry {
  get(id: string): FieldTypeDefinition;      // throws UnknownFieldTypeError
  has(id: string): id is FieldTypeId;
  list(): readonly FieldTypeDefinition[];
}
export function createRegistry(defs: readonly FieldTypeDefinition<any, any>[]): FieldTypeRegistry; // throws on duplicate id
export function buildDefaultRegistry(): FieldTypeRegistry;  // field-types/index.ts
```

- [ ] **Step 1: Write the failing registry test**

`registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFieldType } from "./field-type";
import { createRegistry, UnknownFieldTypeError } from "./registry";

const stub = defineFieldType({
  id: "checkbox",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: z.object({}),
  answerSchema: z.boolean(),
  allowedRules: ["must_be_true"],
  allowedOperators: ["equals", "not_equals"],
  normalize: (a) => a,
  validate: () => [],
  isEmpty: (a) => a === false,
  exportHeaders: (label) => [label],
  exportCells: (a) => [a === undefined ? "" : a ? "yes" : "no"],
  fixtures: { settings: [{}], validAnswers: [true], invalidAnswers: ["yes"], emptyAnswer: false },
});

describe("createRegistry", () => {
  it("returns definitions by id and lists them", () => {
    const r = createRegistry([stub]);
    expect(r.get("checkbox").id).toBe("checkbox");
    expect(r.has("checkbox")).toBe(true);
    expect(r.has("nope")).toBe(false);
    expect(r.list()).toHaveLength(1);
  });
  it("throws a typed error for unknown ids", () => {
    expect(() => createRegistry([stub]).get("nope")).toThrow(UnknownFieldTypeError);
  });
  it("rejects duplicate ids", () => {
    expect(() => createRegistry([stub, stub])).toThrow(/duplicate/);
  });
});
```

- [ ] **Step 2: Write the conformance suite**

`field-types/conformance.test.ts`. It iterates whatever the default registry contains; it passes vacuously now and gains teeth as types land. Task 13 adds the completeness assertion.

```ts
import { describe, expect, it } from "vitest";
import { ruleSchema } from "../rules";
import { operatorSchema } from "../operators";
import { buildDefaultRegistry } from "./index";

const registry = buildDefaultRegistry();

describe.each(registry.list().map((d) => [d.id, d] as const))("field type %s", (_id, def) => {
  const settings = def.fixtures.settings[0];

  it("has at least one settings fixture, one valid and one invalid answer", () => {
    expect(def.fixtures.settings.length).toBeGreaterThan(0);
    expect(def.fixtures.validAnswers.length).toBeGreaterThan(0);
    expect(def.fixtures.invalidAnswers.length).toBeGreaterThan(0);
  });

  it("parses all settings fixtures with its settings schema", () => {
    for (const s of def.fixtures.settings) expect(def.settingsSchema.safeParse(s).success).toBe(true);
  });

  it("accepts valid answers and rejects invalid ones by shape", () => {
    for (const a of def.fixtures.validAnswers) expect(def.answerSchema.safeParse(a).success).toBe(true);
    for (const a of def.fixtures.invalidAnswers) expect(def.answerSchema.safeParse(a).success).toBe(false);
  });

  it("normalizes idempotently and valid answers produce no intrinsic issues", () => {
    for (const a of def.fixtures.validAnswers) {
      const once = def.normalize(a, settings);
      expect(def.normalize(once, settings)).toEqual(once);
      expect(def.validate(once, settings)).toEqual([]);
    }
  });

  it("declares only known rules and operators", () => {
    for (const r of def.allowedRules) expect(ruleSchema.options.some((o) => o.shape.rule.value === r)).toBe(true);
    for (const o of def.allowedOperators) expect(operatorSchema.safeParse(o).success).toBe(true);
  });

  it("reports its empty fixture as empty and valid answers as non-empty", () => {
    if (def.fixtures.emptyAnswer !== undefined) expect(def.isEmpty(def.fixtures.emptyAnswer)).toBe(true);
    if (def.isInput) for (const a of def.fixtures.validAnswers) expect(def.isEmpty(a)).toBe(false);
  });

  it("exports the same number of cells as headers, for answers and for undefined", () => {
    const headers = def.exportHeaders("Label");
    expect(def.exportCells(undefined, settings, "en", "bilingual")).toHaveLength(headers.length);
    for (const a of def.fixtures.validAnswers) expect(def.exportCells(a, settings, "es", "bilingual")).toHaveLength(headers.length);
  });

  it("non-input types collect no personal data and allow no rules", () => {
    if (!def.isInput) {
      expect(def.collectsPersonalData).toBe(false);
      expect(def.allowedRules).toEqual([]);
    }
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test src/modules/form-model/domain/registry src/modules/form-model/domain/field-types`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the contract and registry**

`field-type.ts`:

```ts
import type { z } from "zod";
import type { Languages, Locale } from "@/shared/domain/localized-text";
import type { ValidationCode } from "./issues";
import type { OperatorId } from "./operators";
import type { RuleId } from "./rules";

export const fieldTypeIds = [
  "short_text", "long_text", "email", "phone", "number", "date",
  "single_choice", "multiple_choice", "checkbox", "consent", "file_upload", "section",
] as const;
export type FieldTypeId = (typeof fieldTypeIds)[number];

export interface FieldTypeFixtures<S, A> {
  settings: S[];
  validAnswers: A[];
  invalidAnswers: unknown[];
  emptyAnswer?: A;
}

export interface FieldTypeDefinition<S = unknown, A = unknown> {
  id: FieldTypeId;
  isInput: boolean;
  collectsPersonalData: boolean;
  settingsSchema: z.ZodType<S>;
  answerSchema: z.ZodType<A>;
  allowedRules: readonly RuleId[];
  allowedOperators: readonly OperatorId[];
  normalize(answer: A, settings: S): A;
  validate(answer: A, settings: S): ValidationCode[];
  isEmpty(answer: A): boolean;
  exportHeaders(label: string): string[];
  exportCells(answer: A | undefined, settings: S, locale: Locale, languages: Languages): string[];
  fixtures: FieldTypeFixtures<S, A>;
}

export function defineFieldType<S, A>(def: FieldTypeDefinition<S, A>): FieldTypeDefinition<S, A> {
  return Object.freeze(def);
}

/** Loosens the generics for storage in a heterogeneous registry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFieldType = FieldTypeDefinition<any, any>;

export const normalizeText = (s: string): string => s.normalize("NFC").trim();
```

`registry.ts`:

```ts
import type { AnyFieldType, FieldTypeDefinition, FieldTypeId } from "./field-type";

export class UnknownFieldTypeError extends Error {
  constructor(public readonly id: string) {
    super(`unknown field type: ${id}`);
    this.name = "UnknownFieldTypeError";
  }
}

export interface FieldTypeRegistry {
  get(id: string): FieldTypeDefinition;
  has(id: string): id is FieldTypeId;
  list(): readonly FieldTypeDefinition[];
}

export function createRegistry(defs: readonly AnyFieldType[]): FieldTypeRegistry {
  const map = new Map<string, AnyFieldType>();
  for (const def of defs) {
    if (map.has(def.id)) throw new Error(`duplicate field type: ${def.id}`);
    map.set(def.id, def);
  }
  const list = Object.freeze([...map.values()]);
  return {
    get(id) {
      const def = map.get(id);
      if (!def) throw new UnknownFieldTypeError(id);
      return def;
    },
    has(id): id is FieldTypeId { return map.has(id); },
    list() { return list; },
  };
}
```

`field-types/index.ts`:

```ts
import type { AnyFieldType } from "../field-type";
import { createRegistry, type FieldTypeRegistry } from "../registry";

export const defaultFieldTypes: readonly AnyFieldType[] = [];

export function buildDefaultRegistry(): FieldTypeRegistry {
  return createRegistry(defaultFieldTypes);
}
```

- [ ] **Step 5: Run tests, lint, typecheck**

Run: `pnpm test src/modules/form-model && pnpm lint && pnpm typecheck`
Expected: registry tests PASS; conformance reports zero suites, PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/form-model
git commit -m "feat(form-model): add field type contract, registry and conformance suite"
```

---

### Task 8: Text field types: `short_text`, `long_text`, `email`, `phone`

**Files:**
- Create: `field-types/short-text.ts`, `field-types/long-text.ts`, `field-types/email.ts`, `field-types/phone.ts` (all under `src/modules/form-model/domain/`)
- Modify: `field-types/index.ts` (register the four)
- Test: `field-types/text-types.test.ts`

**Interfaces:**
- Consumes: `defineFieldType`, `normalizeText`, `LIMITS`, `localizedTextSchema`, `resolveText`.
- Produces: `shortText`, `longText`, `email`, `phone` definitions. Settings: `short_text { placeholder?: LocalizedText }`, `long_text { placeholder?: LocalizedText; rows: number 2..12 default 4 }`, `email { isSubmitterAddress: boolean default false }`, `phone {}`. Answers are strings. `collectsPersonalData` is true for `email` and `phone`.

- [ ] **Step 1: Write the failing tests** (pins Review Focus 3)

```ts
import { describe, expect, it } from "vitest";
import { email } from "./email";
import { longText } from "./long-text";
import { phone } from "./phone";
import { shortText } from "./short-text";

describe("short_text", () => {
  it("trims, NFC-normalizes and strips zero-width characters", () => {
    const raw = "  Ana​ María  ";
    expect(shortText.normalize(raw, {})).toBe("Ana María");
  });
  it("rejects answers over the system maximum as max_length", () => {
    expect(shortText.validate("x".repeat(5_001), {})).toEqual(["max_length"]);
    expect(shortText.validate("x".repeat(5_000), {})).toEqual([]);
  });
  it("reports blank as empty", () => {
    expect(shortText.isEmpty("   ")).toBe(true);
  });
});

describe("long_text", () => {
  it("defaults rows to 4 and caps at 12", () => {
    expect(longText.settingsSchema.parse({})).toEqual({ rows: 4 });
    expect(longText.settingsSchema.safeParse({ rows: 13 }).success).toBe(false);
  });
  it("allows up to 20,000 characters and keeps internal newlines", () => {
    expect(longText.validate("x".repeat(20_000), { rows: 4 })).toEqual([]);
    expect(longText.normalize("a\n\nb\n", { rows: 4 })).toBe("a\n\nb");
  });
});

describe("email", () => {
  it("lowercases and trims", () => {
    expect(email.normalize("  Ana@Example.COM ", { isSubmitterAddress: false })).toBe("ana@example.com");
  });
  it("flags syntax errors as email_syntax", () => {
    for (const bad of ["ana", "ana@", "@example.com", "ana@example", "ana example@x.com"]) {
      expect(email.validate(bad, { isSubmitterAddress: false })).toEqual(["email_syntax"]);
    }
    expect(email.validate("ana.maria+x@example.com", { isSubmitterAddress: false })).toEqual([]);
  });
  it("collects personal data", () => {
    expect(email.collectsPersonalData).toBe(true);
    expect(phone.collectsPersonalData).toBe(true);
  });
});

describe("phone", () => {
  it("keeps digits, plus, spaces, dashes and parentheses only", () => {
    expect(phone.normalize(" +507 6123-4567 ext.2", {})).toBe("+507 6123-4567 2");
  });
  it("needs at least 6 digits", () => {
    expect(phone.validate("12345", {})).toEqual(["pattern"]);
    expect(phone.validate("+507 6123 4567", {})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/modules/form-model/domain/field-types`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the four types**

`short-text.ts`:

```ts
import { z } from "zod";
import { localizedTextSchema } from "@/shared/domain/localized-text";
import { defineFieldType, normalizeText } from "../field-type";
import { LIMITS } from "../limits";
import { graphemeLength } from "../rules";

const ZERO_WIDTH = /[​-‍﻿]/g;
export const cleanText = (s: string): string => normalizeText(s.replace(ZERO_WIDTH, ""));

const settings = z.object({ placeholder: localizedTextSchema.optional() });

export const shortText = defineFieldType({
  id: "short_text",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: settings,
  answerSchema: z.string(),
  allowedRules: ["min_length", "max_length", "pattern"],
  allowedOperators: ["equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty", "is_one_of"],
  normalize: (a) => cleanText(a).replace(/\s*\n\s*/g, " "),
  validate: (a) => (graphemeLength(a) > LIMITS.shortTextMax ? ["max_length"] : []),
  isEmpty: (a) => a.trim().length === 0,
  exportHeaders: (label) => [label],
  exportCells: (a) => [a ?? ""],
  fixtures: {
    settings: [{}, { placeholder: { en: "Full name", es: "Nombre completo" } }],
    validAnswers: ["Ana María", "x"],
    invalidAnswers: [42, null, ["a"]],
    emptyAnswer: "",
  },
});
```

`long-text.ts`:

```ts
import { z } from "zod";
import { localizedTextSchema } from "@/shared/domain/localized-text";
import { defineFieldType } from "../field-type";
import { LIMITS } from "../limits";
import { graphemeLength } from "../rules";
import { cleanText } from "./short-text";

export const longText = defineFieldType({
  id: "long_text",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: z.object({ placeholder: localizedTextSchema.optional(), rows: z.number().int().min(2).max(12).default(4) }),
  answerSchema: z.string(),
  allowedRules: ["min_length", "max_length"],
  allowedOperators: ["contains", "not_contains", "is_empty", "is_not_empty"],
  normalize: (a) => cleanText(a).replace(/\r\n?/g, "\n"),
  validate: (a) => (graphemeLength(a) > LIMITS.longTextMax ? ["max_length"] : []),
  isEmpty: (a) => a.trim().length === 0,
  exportHeaders: (label) => [label],
  exportCells: (a) => [a ?? ""],
  fixtures: { settings: [{ rows: 4 }], validAnswers: ["Our story\n\nbegan early."], invalidAnswers: [1, {}], emptyAnswer: "" },
});
```

`email.ts`:

```ts
import { z } from "zod";
import { defineFieldType } from "../field-type";
import { cleanText } from "./short-text";

// Pragmatic syntax: local@domain.tld, no spaces, one @, a dot in the domain.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const email = defineFieldType({
  id: "email",
  isInput: true,
  collectsPersonalData: true,
  settingsSchema: z.object({ isSubmitterAddress: z.boolean().default(false) }),
  answerSchema: z.string(),
  allowedRules: ["pattern"],
  allowedOperators: ["equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty", "is_one_of"],
  normalize: (a) => cleanText(a).toLowerCase(),
  validate: (a) => (EMAIL.test(a) ? [] : ["email_syntax"]),
  isEmpty: (a) => a.trim().length === 0,
  exportHeaders: (label) => [label],
  exportCells: (a) => [a ?? ""],
  fixtures: { settings: [{ isSubmitterAddress: false }, { isSubmitterAddress: true }], validAnswers: ["family@example.com"], invalidAnswers: [5, null], emptyAnswer: "" },
});
```

`phone.ts`:

```ts
import { z } from "zod";
import { defineFieldType } from "../field-type";
import { cleanText } from "./short-text";

export const phone = defineFieldType({
  id: "phone",
  isInput: true,
  collectsPersonalData: true,
  settingsSchema: z.object({}),
  answerSchema: z.string(),
  allowedRules: ["min_length", "max_length"],
  allowedOperators: ["equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty", "is_one_of"],
  normalize: (a) => cleanText(a).replace(/[^\d+\s()-]/g, "").replace(/\s+/g, " ").trim(),
  validate: (a) => ((a.match(/\d/g)?.length ?? 0) >= 6 ? [] : ["pattern"]),
  isEmpty: (a) => a.trim().length === 0,
  exportHeaders: (label) => [label],
  exportCells: (a) => [a ?? ""],
  fixtures: { settings: [{}], validAnswers: ["+507 6123-4567"], invalidAnswers: [61234567, null], emptyAnswer: "" },
});
```

Register in `field-types/index.ts`: `export const defaultFieldTypes = [shortText, longText, email, phone];`

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test src/modules/form-model && pnpm lint && pnpm typecheck`
Expected: PASS, conformance now runs 4 suites.

- [ ] **Step 5: Commit**

```bash
git add src/modules/form-model
git commit -m "feat(form-model): add text field types"
```

---

### Task 9: `number` and `date` field types

**Files:**
- Create: `field-types/number.ts`, `field-types/date.ts`
- Modify: `field-types/index.ts`
- Test: `field-types/number-date.test.ts`

**Interfaces:**
- Produces: `number` definition, settings `{ integerOnly: boolean default false; unit?: LocalizedText }`, answer `number`. `date` definition, settings `{}`, answer `string` `YYYY-MM-DD`. Exports `isRealDate(iso: string): boolean`.

- [ ] **Step 1: Write the failing tests** (pins Review Focus 5)

```ts
import { describe, expect, it } from "vitest";
import { date, isRealDate } from "./date";
import { numberType } from "./number";

describe("number", () => {
  it("rejects non-finite as shape and reports integer when required", () => {
    expect(numberType.answerSchema.safeParse(Number.NaN).success).toBe(false);
    expect(numberType.validate(2.5, { integerOnly: true })).toEqual(["integer"]);
    expect(numberType.validate(2.5, { integerOnly: false })).toEqual([]);
  });
  it("exports with the unit in the header, resolved per locale", () => {
    expect(numberType.exportHeaders("Weight")).toEqual(["Weight"]);
    expect(numberType.exportCells(2.3, { integerOnly: false, unit: { en: "kg", es: "kg" } }, "es", "bilingual")).toEqual(["2.3"]);
  });
  it("zero is a non-empty answer", () => {
    expect(numberType.isEmpty(0)).toBe(false);
  });
});

describe("date", () => {
  it("accepts only real calendar dates", () => {
    expect(isRealDate("2024-02-29")).toBe(true);
    expect(isRealDate("2026-02-29")).toBe(false);
    expect(isRealDate("2026-02-30")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
  });
  it("shape accepts the ISO pattern and validate reports date_invalid for unreal dates", () => {
    expect(date.answerSchema.safeParse("2026-02-30").success).toBe(true);
    expect(date.validate("2026-02-30", {})).toEqual(["date_invalid"]);
    expect(date.answerSchema.safeParse("30/02/2026").success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/modules/form-model/domain/field-types/number-date`
Expected: FAIL.

- [ ] **Step 3: Implement**

`number.ts`:

```ts
import { z } from "zod";
import { localizedTextSchema } from "@/shared/domain/localized-text";
import { defineFieldType } from "../field-type";

export const numberType = defineFieldType({
  id: "number",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: z.object({ integerOnly: z.boolean().default(false), unit: localizedTextSchema.optional() }),
  answerSchema: z.number().finite(),
  allowedRules: ["min_value", "max_value"],
  allowedOperators: ["equals", "not_equals", "greater_than", "less_than", "is_empty", "is_not_empty"],
  normalize: (a) => a,
  validate: (a, s) => (s.integerOnly && !Number.isInteger(a) ? ["integer"] : []),
  isEmpty: () => false,
  exportHeaders: (label) => [label],
  exportCells: (a) => [a === undefined ? "" : String(a)],
  fixtures: { settings: [{ integerOnly: false }, { integerOnly: true, unit: { en: "weeks", es: "semanas" } }], validAnswers: [30, 2.5], invalidAnswers: ["30", Number.NaN, null] },
});
```

`date.ts`:

```ts
import { z } from "zod";
import { defineFieldType } from "../field-type";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isRealDate(iso: string): boolean {
  const m = ISO.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const date = defineFieldType({
  id: "date",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: z.object({}),
  answerSchema: z.string().regex(ISO),
  allowedRules: ["min_date", "max_date", "not_future"],
  allowedOperators: ["equals", "not_equals", "greater_than", "less_than", "is_empty", "is_not_empty"],
  normalize: (a) => a.trim(),
  validate: (a) => (isRealDate(a) ? [] : ["date_invalid"]),
  isEmpty: (a) => a.length === 0,
  exportHeaders: (label) => [label],
  exportCells: (a) => [a ?? ""],
  fixtures: { settings: [{}], validAnswers: ["2024-02-29"], invalidAnswers: ["29/02/2024", 20240229], emptyAnswer: "" },
});
```

Register both in `index.ts`.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test src/modules/form-model && pnpm lint && pnpm typecheck`
Expected: PASS, conformance runs 6 suites.

- [ ] **Step 5: Commit**

```bash
git add src/modules/form-model
git commit -m "feat(form-model): add number and date field types"
```

---

### Task 10: `single_choice`, `multiple_choice`, `checkbox`

**Files:**
- Create: `field-types/choice-shared.ts`, `field-types/single-choice.ts`, `field-types/multiple-choice.ts`, `field-types/checkbox.ts`
- Modify: `field-types/index.ts`
- Test: `field-types/choice-types.test.ts`

**Interfaces:**
- Produces:
  - `optionSchema = { key: Key; label: LocalizedText }`, `optionsSchema` array 1..`LIMITS.optionsPerChoice` with unique keys
  - `singleChoice` settings `{ options; display: "radio" | "dropdown" default "radio" }`, answer `Key`
  - `effectiveDisplay(settings): "radio" | "dropdown"` returning `radio` when `display` is `dropdown` but there are 6 or fewer options (Review Focus 4)
  - `multipleChoice` settings `{ options }`, answer `Key[]`
  - `checkbox` settings `{}`, answer `boolean`
  - Export: choice cells contain the option label resolved in the export locale; multiple choice joins with `"; "`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { checkbox } from "./checkbox";
import { optionsSchema } from "./choice-shared";
import { multipleChoice } from "./multiple-choice";
import { effectiveDisplay, singleChoice } from "./single-choice";

const options = [
  { key: "one", label: { en: "One baby", es: "Un solo bebé" } },
  { key: "twins", label: { en: "Twins", es: "Gemelar" } },
];

describe("options", () => {
  it("requires unique keys and at most 50", () => {
    expect(optionsSchema.safeParse([options[0], options[0]]).success).toBe(false);
    expect(optionsSchema.safeParse(Array.from({ length: 51 }, (_, i) => ({ key: `opt${i}`, label: { en: "x" } }))).success).toBe(false);
    expect(optionsSchema.safeParse([]).success).toBe(false);
  });
});

describe("single_choice", () => {
  const s = { options, display: "radio" as const };
  it("reports an answer that is not an option key as unknown_option", () => {
    expect(singleChoice.validate("triplets", s)).toEqual(["unknown_option"]);
    expect(singleChoice.validate("twins", s)).toEqual([]);
  });
  it("falls back to radio with six or fewer options", () => {
    expect(effectiveDisplay({ options, display: "dropdown" })).toBe("radio");
    const seven = Array.from({ length: 7 }, (_, i) => ({ key: `o${i}`, label: { en: "x" } }));
    expect(effectiveDisplay({ options: seven, display: "dropdown" })).toBe("dropdown");
  });
  it("exports the label in the requested locale", () => {
    expect(singleChoice.exportCells("twins", s, "es", "bilingual")).toEqual(["Gemelar"]);
    expect(singleChoice.exportCells(undefined, s, "es", "bilingual")).toEqual([""]);
  });
});

describe("multiple_choice", () => {
  const s = { options };
  it("normalizes to unique keys in option order", () => {
    expect(multipleChoice.normalize(["twins", "one", "twins"], s)).toEqual(["one", "twins"]);
  });
  it("flags unknown keys and exports joined labels", () => {
    expect(multipleChoice.validate(["one", "nope"], s)).toEqual(["unknown_option"]);
    expect(multipleChoice.exportCells(["one", "twins"], s, "en", "bilingual")).toEqual(["One baby; Twins"]);
  });
  it("empty array is empty", () => {
    expect(multipleChoice.isEmpty([])).toBe(true);
  });
});

describe("checkbox", () => {
  it("false is empty for required purposes and exports yes/no words", () => {
    expect(checkbox.isEmpty(false)).toBe(true);
    expect(checkbox.exportCells(true, {}, "es", "bilingual")).toEqual(["sí"]);
    expect(checkbox.exportCells(false, {}, "en", "bilingual")).toEqual(["no"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/modules/form-model/domain/field-types/choice-types`
Expected: FAIL.

- [ ] **Step 3: Implement**

`choice-shared.ts`:

```ts
import { z } from "zod";
import { type Languages, type Locale, localizedTextSchema, resolveText } from "@/shared/domain/localized-text";
import { keySchema } from "../keys";
import { LIMITS } from "../limits";

export const optionSchema = z.object({ key: keySchema, label: localizedTextSchema });
export type Option = z.infer<typeof optionSchema>;

export const optionsSchema = z
  .array(optionSchema)
  .min(1)
  .max(LIMITS.optionsPerChoice)
  .refine((opts) => new Set(opts.map((o) => o.key)).size === opts.length, "option keys must be unique");

export function optionLabel(options: Option[], key: string, locale: Locale, languages: Languages): string {
  const found = options.find((o) => o.key === key);
  return found ? resolveText(found.label, locale, languages) : key;
}
```

`single-choice.ts`:

```ts
import { z } from "zod";
import { defineFieldType } from "../field-type";
import { keySchema } from "../keys";
import { optionLabel, optionsSchema } from "./choice-shared";

const settings = z.object({ options: optionsSchema, display: z.enum(["radio", "dropdown"]).default("radio") });
type Settings = z.infer<typeof settings>;

export const DROPDOWN_MIN_OPTIONS = 7;
export function effectiveDisplay(s: Pick<Settings, "options" | "display">): "radio" | "dropdown" {
  return s.display === "dropdown" && s.options.length >= DROPDOWN_MIN_OPTIONS ? "dropdown" : "radio";
}

export const singleChoice = defineFieldType({
  id: "single_choice",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: settings,
  answerSchema: keySchema,
  allowedRules: [],
  allowedOperators: ["equals", "not_equals", "is_one_of", "is_empty", "is_not_empty"],
  normalize: (a) => a,
  validate: (a, s) => (s.options.some((o) => o.key === a) ? [] : ["unknown_option"]),
  isEmpty: (a) => a.length === 0,
  exportHeaders: (label) => [label],
  exportCells: (a, s, locale, languages) => [a === undefined ? "" : optionLabel(s.options, a, locale, languages)],
  fixtures: {
    settings: [{ options: [{ key: "one", label: { en: "One", es: "Uno" } }, { key: "two", label: { en: "Two", es: "Dos" } }], display: "radio" }],
    validAnswers: ["one"],
    invalidAnswers: [1, ["one"], null],
  },
});
```

`multiple-choice.ts`:

```ts
import { z } from "zod";
import { defineFieldType } from "../field-type";
import { keySchema } from "../keys";
import { optionLabel, optionsSchema } from "./choice-shared";

export const multipleChoice = defineFieldType({
  id: "multiple_choice",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: z.object({ options: optionsSchema }),
  answerSchema: z.array(keySchema),
  allowedRules: ["min_selected", "max_selected"],
  allowedOperators: ["contains", "not_contains", "is_empty", "is_not_empty"],
  normalize: (a, s) => s.options.map((o) => o.key).filter((k) => a.includes(k)),
  validate: (a, s) => (a.every((k) => s.options.some((o) => o.key === k)) ? [] : ["unknown_option"]),
  isEmpty: (a) => a.length === 0,
  exportHeaders: (label) => [label],
  exportCells: (a, s, locale, languages) => [(a ?? []).map((k) => optionLabel(s.options, k, locale, languages)).join("; ")],
  fixtures: {
    settings: [{ options: [{ key: "ig", label: { en: "Instagram", es: "Instagram" } }, { key: "fb", label: { en: "Facebook", es: "Facebook" } }] }],
    validAnswers: [["ig"], ["ig", "fb"]],
    invalidAnswers: ["ig", [1]],
    emptyAnswer: [],
  },
});
```

`checkbox.ts`:

```ts
import { z } from "zod";
import { defineFieldType } from "../field-type";

const YES = { en: "yes", es: "sí" } as const;
const NO = { en: "no", es: "no" } as const;

export const checkbox = defineFieldType({
  id: "checkbox",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: z.object({}),
  answerSchema: z.boolean(),
  allowedRules: ["must_be_true"],
  allowedOperators: ["equals", "not_equals"],
  normalize: (a) => a,
  validate: () => [],
  isEmpty: (a) => a === false,
  exportHeaders: (label) => [label],
  exportCells: (a, _s, locale) => [a === undefined ? "" : a ? YES[locale] : NO[locale]],
  fixtures: { settings: [{}], validAnswers: [true], invalidAnswers: ["true", 1], emptyAnswer: false },
});
```

Register the three in `index.ts`.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test src/modules/form-model && pnpm lint && pnpm typecheck`
Expected: PASS, 9 conformance suites.

- [ ] **Step 5: Commit**

```bash
git add src/modules/form-model
git commit -m "feat(form-model): add choice and checkbox field types"
```

---

### Task 11: `consent` field type and consent text version

**Files:**
- Create: `field-types/consent.ts`, `src/modules/form-model/domain/consent-text.ts`
- Modify: `field-types/index.ts`
- Test: `field-types/consent.test.ts`, `consent-text.test.ts`

**Interfaces:**
- Produces:
  - `consentItems` tuple of nine ids: `collector`, `collected`, `purpose`, `storage`, `retention`, `team_access`, `deletion`, `adult_authority`, `automated_correction`
  - `consent` settings `{ text: LocalizedText; coveredItems: ConsentItem[] }`, answer `{ accepted: true; textVersion: string }`
  - `consentTextVersion(text: LocalizedText): string`, a stable 16-hex-character FNV-1a hash over `en\u0000es` after NFC; identical text gives identical version across runs
  - `isConsentChecklistComplete(settings): boolean`
  - `consent.validate` reports `consent` when `textVersion` does not match the settings' text, so an outdated client cannot accept a stale text.

- [ ] **Step 1: Write the failing tests**

`consent-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { consentTextVersion } from "./consent-text";

describe("consentTextVersion", () => {
  it("is stable, 16 hex chars, and changes with any character", () => {
    const a = consentTextVersion({ en: "I agree", es: "Acepto" });
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(consentTextVersion({ en: "I agree", es: "Acepto" })).toBe(a);
    expect(consentTextVersion({ en: "I agree.", es: "Acepto" })).not.toBe(a);
    expect(consentTextVersion({ en: "I agree", es: "Acepto." })).not.toBe(a);
  });
  it("treats NFC and NFD forms as the same text", () => {
    expect(consentTextVersion({ es: "María" })).toBe(consentTextVersion({ es: "María" }));
  });
});
```

`consent.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { consentTextVersion } from "../consent-text";
import { consent, consentItems, isConsentChecklistComplete } from "./consent";

const text = { en: "I am an adult and agree.", es: "Soy mayor de edad y acepto." };
const full = { text, coveredItems: [...consentItems] };

describe("consent", () => {
  it("has exactly nine checklist items", () => {
    expect(consentItems).toHaveLength(9);
  });
  it("checklist completeness requires all nine", () => {
    expect(isConsentChecklistComplete(full)).toBe(true);
    expect(isConsentChecklistComplete({ text, coveredItems: consentItems.slice(0, 8) })).toBe(false);
  });
  it("accepts only accepted:true with the matching text version", () => {
    const v = consentTextVersion(text);
    expect(consent.validate({ accepted: true, textVersion: v }, full)).toEqual([]);
    expect(consent.validate({ accepted: true, textVersion: "0000000000000000" }, full)).toEqual(["consent"]);
    expect(consent.answerSchema.safeParse({ accepted: false, textVersion: v }).success).toBe(false);
  });
  it("is never empty when present and exports the accepted version", () => {
    const v = consentTextVersion(text);
    expect(consent.isEmpty({ accepted: true, textVersion: v })).toBe(false);
    expect(consent.exportHeaders("Consent")).toEqual(["Consent", "Consent (text version)"]);
    expect(consent.exportCells({ accepted: true, textVersion: v }, full, "en", "bilingual")).toEqual(["yes", v]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/modules/form-model/domain/consent src/modules/form-model/domain/field-types/consent`
Expected: FAIL.

- [ ] **Step 3: Implement**

`consent-text.ts`:

```ts
import type { LocalizedText } from "@/shared/domain/localized-text";

/** FNV-1a 64-bit over the NFC text of both languages; stable across runs and platforms. */
export function consentTextVersion(text: LocalizedText): string {
  const input = `${(text.en ?? "").normalize("NFC")}\u0000${(text.es ?? "").normalize("NFC")}`;
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const ch of new TextEncoder().encode(input)) {
    hash ^= BigInt(ch);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}
```

`consent.ts`:

```ts
import { z } from "zod";
import { localizedTextSchema } from "@/shared/domain/localized-text";
import { consentTextVersion } from "../consent-text";
import { defineFieldType } from "../field-type";

export const consentItems = [
  "collector", "collected", "purpose", "storage", "retention",
  "team_access", "deletion", "adult_authority", "automated_correction",
] as const;
export type ConsentItem = (typeof consentItems)[number];

const settings = z.object({ text: localizedTextSchema, coveredItems: z.array(z.enum(consentItems)).default([]) });
type Settings = z.infer<typeof settings>;

export function isConsentChecklistComplete(s: Pick<Settings, "coveredItems">): boolean {
  return consentItems.every((item) => s.coveredItems.includes(item));
}

const YES = { en: "yes", es: "sí" } as const;

export const consent = defineFieldType({
  id: "consent",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: settings,
  answerSchema: z.object({ accepted: z.literal(true), textVersion: z.string().regex(/^[0-9a-f]{16}$/) }),
  allowedRules: [],
  allowedOperators: [],
  normalize: (a) => a,
  validate: (a, s) => (a.textVersion === consentTextVersion(s.text) ? [] : ["consent"]),
  isEmpty: () => false,
  exportHeaders: (label) => [label, `${label} (text version)`],
  exportCells: (a, _s, locale) => (a ? [YES[locale], a.textVersion] : ["", ""]),
  fixtures: (() => {
    const text = { en: "I agree.", es: "Acepto." };
    return {
      settings: [{ text, coveredItems: [...consentItems] }],
      validAnswers: [{ accepted: true as const, textVersion: consentTextVersion(text) }],
      invalidAnswers: [{ accepted: false, textVersion: "0" }, true, "yes"],
    };
  })(),
});
```

Register in `index.ts`.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test src/modules/form-model && pnpm lint && pnpm typecheck`
Expected: PASS, 10 conformance suites.

- [ ] **Step 5: Commit**

```bash
git add src/modules/form-model
git commit -m "feat(form-model): add consent field type and consent text versioning"
```

---

### Task 12: `file_upload` and `section`

**Files:**
- Create: `field-types/file-upload.ts`, `field-types/section.ts`
- Modify: `field-types/index.ts`
- Test: `field-types/file-section.test.ts`

**Interfaces:**
- Produces:
  - `fileUpload` settings `{ kinds: ("image" | "video")[] non-empty, unique; maxFiles: 1..LIMITS.filesPerField default 10; maxSizeMb: 1..LIMITS.fileSizeMb default 10 }`, answer `string[]` of media ids matching `/^[A-Za-z0-9_-]{8,64}$/`. `validate` reports `files_max` when the answer exceeds `maxFiles` regardless of rules, because the setting is a hard cap. `collectsPersonalData` true.
  - `section` settings `{ title: LocalizedText; description?: LocalizedText }`, `isInput: false`, answer schema `z.undefined()`, no rules, no operators, exports zero columns.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { fileUpload } from "./file-upload";
import { section } from "./section";

describe("file_upload", () => {
  it("defaults to 10 files of 10 MB and rejects out-of-range settings", () => {
    expect(fileUpload.settingsSchema.parse({ kinds: ["image"] })).toEqual({ kinds: ["image"], maxFiles: 10, maxSizeMb: 10 });
    expect(fileUpload.settingsSchema.safeParse({ kinds: ["image"], maxFiles: 11 }).success).toBe(false);
    expect(fileUpload.settingsSchema.safeParse({ kinds: [], maxFiles: 1 }).success).toBe(false);
    expect(fileUpload.settingsSchema.safeParse({ kinds: ["image", "image"] }).success).toBe(false);
  });
  it("caps the count by settings even without a rule and dedupes ids", () => {
    const s = { kinds: ["image" as const], maxFiles: 2, maxSizeMb: 10 };
    expect(fileUpload.normalize(["m_aaaaaaaa", "m_aaaaaaaa"], s)).toEqual(["m_aaaaaaaa"]);
    expect(fileUpload.validate(["m_aaaaaaaa", "m_bbbbbbbb", "m_cccccccc"], s)).toEqual(["files_max"]);
  });
  it("exports the count and the ids joined", () => {
    expect(fileUpload.exportHeaders("Photos")).toEqual(["Photos (count)", "Photos (files)"]);
    expect(fileUpload.exportCells(["m_aaaaaaaa"], { kinds: ["image"], maxFiles: 10, maxSizeMb: 10 }, "en", "bilingual")).toEqual(["1", "m_aaaaaaaa"]);
  });
  it("collects personal data", () => {
    expect(fileUpload.collectsPersonalData).toBe(true);
  });
});

describe("section", () => {
  it("is not an input, takes no answer and exports nothing", () => {
    expect(section.isInput).toBe(false);
    expect(section.answerSchema.safeParse(undefined).success).toBe(true);
    expect(section.answerSchema.safeParse("x").success).toBe(false);
    expect(section.exportHeaders("Info")).toEqual([]);
    expect(section.exportCells(undefined, { title: { en: "Info" } }, "en", "bilingual")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/modules/form-model/domain/field-types/file-section`
Expected: FAIL.

- [ ] **Step 3: Implement**

`file-upload.ts`:

```ts
import { z } from "zod";
import { defineFieldType } from "../field-type";
import { LIMITS } from "../limits";

export const mediaIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

const settings = z.object({
  kinds: z.array(z.enum(["image", "video"])).min(1).refine((k) => new Set(k).size === k.length, "kinds must be unique"),
  maxFiles: z.number().int().min(1).max(LIMITS.filesPerField).default(LIMITS.filesPerField),
  maxSizeMb: z.number().int().min(1).max(LIMITS.fileSizeMb).default(LIMITS.fileSizeMb),
});

export const fileUpload = defineFieldType({
  id: "file_upload",
  isInput: true,
  collectsPersonalData: true,
  settingsSchema: settings,
  answerSchema: z.array(mediaIdSchema),
  allowedRules: ["min_files", "max_files"],
  allowedOperators: ["is_empty", "is_not_empty"],
  normalize: (a) => [...new Set(a)],
  validate: (a, s) => (a.length > s.maxFiles ? ["files_max"] : []),
  isEmpty: (a) => a.length === 0,
  exportHeaders: (label) => [`${label} (count)`, `${label} (files)`],
  exportCells: (a) => [String(a?.length ?? 0), (a ?? []).join("; ")],
  fixtures: {
    settings: [{ kinds: ["image"], maxFiles: 10, maxSizeMb: 10 }, { kinds: ["image", "video"], maxFiles: 3, maxSizeMb: 10 }],
    validAnswers: [["m_aaaaaaaa"], ["m_aaaaaaaa", "m_bbbbbbbb"]],
    invalidAnswers: ["m_aaaaaaaa", [1], ["short"]],
    emptyAnswer: [],
  },
});
```

`section.ts`:

```ts
import { z } from "zod";
import { localizedTextSchema } from "@/shared/domain/localized-text";
import { defineFieldType } from "../field-type";

export const section = defineFieldType({
  id: "section",
  isInput: false,
  collectsPersonalData: false,
  settingsSchema: z.object({ title: localizedTextSchema, description: localizedTextSchema.optional() }),
  answerSchema: z.undefined(),
  allowedRules: [],
  allowedOperators: [],
  normalize: () => undefined,
  validate: () => [],
  isEmpty: () => true,
  exportHeaders: () => [],
  exportCells: () => [],
  fixtures: { settings: [{ title: { en: "Information", es: "Información" } }], validAnswers: [undefined], invalidAnswers: ["text", 1] },
});
```

Register both. The conformance rule "valid answers are non-empty" is skipped for non-input types, which is why `section.isEmpty` returning `true` is fine.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test src/modules/form-model && pnpm lint && pnpm typecheck`
Expected: PASS, 12 conformance suites.

- [ ] **Step 5: Commit**

```bash
git add src/modules/form-model
git commit -m "feat(form-model): add file upload and section field types"
```

---

### Task 13: Registry completeness and operator compatibility

**Files:**
- Modify: `field-types/index.ts` (export `defaultFieldTypes` in display order)
- Test: `field-types/registry-complete.test.ts`

**Interfaces:**
- Produces: `defaultFieldTypes` ordered as the builder menu lists them: short_text, long_text, email, phone, single_choice, multiple_choice, checkbox, number, date, file_upload, consent, section. `operatorsFor(registry, typeId): OperatorDefinition[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { fieldTypeIds } from "../field-type";
import { OPERATORS } from "../operators";
import { buildDefaultRegistry, operatorsFor } from "./index";

describe("default registry", () => {
  const registry = buildDefaultRegistry();
  it("contains every first-release field type exactly once", () => {
    expect([...registry.list().map((d) => d.id)].sort()).toEqual([...fieldTypeIds].sort());
  });
  it("lists operators compatible with a type, needing a value or not", () => {
    const ops = operatorsFor(registry, "number").map((o) => o.id);
    expect(ops).toEqual(["equals", "not_equals", "greater_than", "less_than", "is_empty", "is_not_empty"]);
    expect(operatorsFor(registry, "section")).toEqual([]);
    expect(operatorsFor(registry, "checkbox")).toEqual([OPERATORS.equals, OPERATORS.not_equals]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/modules/form-model/domain/field-types/registry-complete`
Expected: FAIL, `operatorsFor` is not exported.

- [ ] **Step 3: Implement**

`field-types/index.ts`:

```ts
import type { AnyFieldType, FieldTypeId } from "../field-type";
import { OPERATORS, type OperatorDefinition } from "../operators";
import { createRegistry, type FieldTypeRegistry } from "../registry";
import { checkbox } from "./checkbox";
import { consent } from "./consent";
import { date } from "./date";
import { email } from "./email";
import { fileUpload } from "./file-upload";
import { longText } from "./long-text";
import { multipleChoice } from "./multiple-choice";
import { numberType } from "./number";
import { phone } from "./phone";
import { section } from "./section";
import { shortText } from "./short-text";
import { singleChoice } from "./single-choice";

export const defaultFieldTypes: readonly AnyFieldType[] = [
  shortText, longText, email, phone, singleChoice, multipleChoice, checkbox, numberType, date, fileUpload, consent, section,
];

export function buildDefaultRegistry(): FieldTypeRegistry {
  return createRegistry(defaultFieldTypes);
}

export function operatorsFor(registry: FieldTypeRegistry, typeId: FieldTypeId): OperatorDefinition[] {
  return registry.get(typeId).allowedOperators.map((id) => OPERATORS[id]);
}
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test src/modules/form-model && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/form-model
git commit -m "feat(form-model): complete default registry and operator lookup"
```

---

### Task 14: Version schema and draft parsing

**Files:**
- Create: `src/modules/form-model/domain/version.ts`
- Test: `src/modules/form-model/domain/version.test.ts`

**Interfaces:**
- Produces:

```ts
export const fieldSchema, pageSchema, versionSchema;      // structural Zod schemas
export type Field = { key: Key; type: FieldTypeId; label: LocalizedText; help?: LocalizedText; required: boolean; personal: boolean; validation: Rule[]; settings: unknown; visibility?: Condition };
export type Page = { key: Key; title: LocalizedText; description?: LocalizedText; fields: Field[]; visibility?: Condition };
export type Version = { languages: Languages; headerImage?: { ref: string; alt: LocalizedText }; pages: Page[]; confirmation: { screen: LocalizedText; email?: { subject: LocalizedText; body: LocalizedText } } };
export interface ParseIssue { path: string; message: string }
export type ParseResult = { ok: true; version: Version } | { ok: false; issues: ParseIssue[] };
export function parseDraft(input: unknown, registry: FieldTypeRegistry): ParseResult;
export function inputFields(version: Version): Field[];             // all fields whose type isInput, in order
export function fieldIndex(version: Version): Map<string, { field: Field; page: Page; order: number }>;
```

`parseDraft` is the lenient parse used on every builder save. It guarantees: well-formed structure; every field type known; every `settings` parsed and defaulted by its type's schema; every rule allowed by its type; keys unique across pages and fields; page count and input-fields-per-page within `LIMITS`; and, for any condition clause whose referenced field exists, the operator is allowed for that field's type and the value matches the field's answer shape (an array of them for `is_one_of`). It does **not** require labels, translations, consent, or that referenced fields come earlier; those are publish issues (Task 17).

- [ ] **Step 1: Write the failing tests** (pins Review Focus 2)

```ts
import { describe, expect, it } from "vitest";
import { buildDefaultRegistry } from "./field-types";
import { parseDraft } from "./version";

const registry = buildDefaultRegistry();
const page = (key: string, fields: unknown[]) => ({ key, title: { en: key }, fields });
const field = (key: string, type: string, extra: Record<string, unknown> = {}) => ({ key, type, label: { en: key }, ...extra });
const draft = (pages: unknown[]) => ({ languages: "bilingual", pages, confirmation: { screen: { en: "Thanks" } } });

describe("parseDraft", () => {
  it("parses a minimal draft and applies settings defaults", () => {
    const r = parseDraft(draft([page("p1", [field("story", "long_text")])]), registry);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.version.pages[0]?.fields[0]?.settings).toEqual({ rows: 4 });
  });
  it("rejects unknown types with the field path", () => {
    const r = parseDraft(draft([page("p1", [field("x", "slider")])]), registry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.path).toBe("pages/0/fields/0/type");
  });
  it("rejects rules the type does not allow", () => {
    const r = parseDraft(draft([page("p1", [field("n", "number", { validation: [{ rule: "min_length", value: 2 }] })])]), registry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.path).toBe("pages/0/fields/0/validation/0");
  });
  it("rejects duplicate keys across pages", () => {
    const r = parseDraft(draft([page("p1", [field("a", "short_text")]), page("p2", [field("a", "short_text")])]), registry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.message).toMatch(/duplicate key/);
  });
  it("rejects more than 20 pages and more than 15 inputs on a page", () => {
    const many = Array.from({ length: 21 }, (_, i) => page(`p${i}`, []));
    expect(parseDraft(draft(many), registry).ok).toBe(false);
    const dense = page("p1", Array.from({ length: 16 }, (_, i) => field(`f${i}`, "short_text")));
    expect(parseDraft(draft([dense]), registry).ok).toBe(false);
    const denseWithSections = page("p1", [...Array.from({ length: 15 }, (_, i) => field(`f${i}`, "short_text")), field("s", "section", { settings: { title: { en: "x" } } })]);
    expect(parseDraft(draft([denseWithSections]), registry).ok).toBe(true);
  });
  it("rejects a condition value of the wrong type for an existing field, with a path", () => {
    const r = parseDraft(
      draft([page("p1", [field("weeks", "number"), field("note", "short_text", { visibility: { field: "weeks", op: "greater_than", value: "thirty" } })])]),
      registry,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.path).toBe("pages/0/fields/1/visibility/value");
  });
  it("rejects an operator the referenced type does not allow", () => {
    const r = parseDraft(
      draft([page("p1", [field("agree", "checkbox"), field("note", "short_text", { visibility: { field: "agree", op: "contains", value: "x" } })])]),
      registry,
    );
    expect(r.ok).toBe(false);
  });
  it("accepts a forward or missing reference at draft time", () => {
    const r = parseDraft(
      draft([page("p1", [field("note", "short_text", { visibility: { field: "later", op: "is_empty" } }), field("later", "short_text")])]),
      registry,
    );
    expect(r.ok).toBe(true);
  });
  it("accepts is_one_of with an array of the field's answer shape", () => {
    const opts = { options: [{ key: "one", label: { en: "1" } }, { key: "two", label: { en: "2" } }] };
    const ok = parseDraft(draft([page("p1", [field("c", "single_choice", { settings: opts }), field("n", "short_text", { visibility: { field: "c", op: "is_one_of", value: ["one", "two"] } })])]), registry);
    expect(ok.ok).toBe(true);
    const bad = parseDraft(draft([page("p1", [field("c", "single_choice", { settings: opts }), field("n", "short_text", { visibility: { field: "c", op: "is_one_of", value: "one" } })])]), registry);
    expect(bad.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/modules/form-model/domain/version`
Expected: FAIL.

- [ ] **Step 3: Implement**

`version.ts`:

```ts
import { z } from "zod";
import { languagesSchema, localizedTextSchema } from "@/shared/domain/localized-text";
import { conditionSchema, type Condition } from "./condition";
import { fieldTypeIds } from "./field-type";
import { mediaIdSchema } from "./field-types/file-upload";
import { keySchema } from "./keys";
import { LIMITS } from "./limits";
import { OPERATORS } from "./operators";
import type { FieldTypeRegistry } from "./registry";
import { ruleSchema } from "./rules";

export const fieldSchema = z.object({
  key: keySchema,
  type: z.enum(fieldTypeIds),
  label: localizedTextSchema.default({}),
  help: localizedTextSchema.optional(),
  required: z.boolean().default(false),
  personal: z.boolean().default(false),
  validation: z.array(ruleSchema).default([]),
  settings: z.unknown().default({}),
  visibility: conditionSchema.optional(),
});
export type Field = z.infer<typeof fieldSchema>;

export const pageSchema = z.object({
  key: keySchema,
  title: localizedTextSchema.default({}),
  description: localizedTextSchema.optional(),
  fields: z.array(fieldSchema).default([]),
  visibility: conditionSchema.optional(),
});
export type Page = z.infer<typeof pageSchema>;

export const versionSchema = z.object({
  languages: languagesSchema,
  headerImage: z.object({ ref: mediaIdSchema, alt: localizedTextSchema.default({}) }).optional(),
  pages: z.array(pageSchema).min(1).max(LIMITS.pagesPerForm),
  confirmation: z.object({
    screen: localizedTextSchema.default({}),
    email: z.object({ subject: localizedTextSchema, body: localizedTextSchema }).optional(),
  }),
});
export type Version = z.infer<typeof versionSchema>;

export interface ParseIssue { path: string; message: string }
export type ParseResult = { ok: true; version: Version } | { ok: false; issues: ParseIssue[] };

const pathOf = (segments: (string | number)[]) => segments.join("/");

export function inputFields(version: Version, registry?: FieldTypeRegistry): Field[] {
  return version.pages.flatMap((p) => p.fields.filter((f) => (registry ? registry.get(f.type).isInput : f.type !== "section")));
}

export function fieldIndex(version: Version): Map<string, { field: Field; page: Page; order: number }> {
  const map = new Map<string, { field: Field; page: Page; order: number }>();
  let order = 0;
  for (const page of version.pages) for (const field of page.fields) map.set(field.key, { field, page, order: order++ });
  return map;
}

function clauseIssues(cond: Condition, index: ReturnType<typeof fieldIndex>, registry: FieldTypeRegistry, base: (string | number)[]): ParseIssue[] {
  if ("all" in cond) return cond.all.flatMap((c, i) => clauseIssues(c, index, registry, [...base, "all", i]));
  if ("any" in cond) return cond.any.flatMap((c, i) => clauseIssues(c, index, registry, [...base, "any", i]));
  const target = index.get(cond.field);
  if (!target) return []; // missing or later references are publish issues
  const def = registry.get(target.field.type);
  const issues: ParseIssue[] = [];
  if (!def.allowedOperators.includes(cond.op)) issues.push({ path: pathOf([...base, "op"]), message: `operator ${cond.op} not allowed for ${def.id}` });
  if (OPERATORS[cond.op].needsValue) {
    const valueSchema = cond.op === "is_one_of" ? z.array(def.answerSchema) : def.answerSchema;
    if (!valueSchema.safeParse(cond.value).success) issues.push({ path: pathOf([...base, "value"]), message: `value does not match the ${def.id} answer shape` });
  }
  return issues;
}

export function parseDraft(input: unknown, registry: FieldTypeRegistry): ParseResult {
  const structural = versionSchema.safeParse(input);
  if (!structural.success) {
    return { ok: false, issues: structural.error.issues.map((i) => ({ path: pathOf(i.path as (string | number)[]), message: i.message })) };
  }
  const version = structural.data;
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();

  version.pages.forEach((page, pi) => {
    if (seen.has(page.key)) issues.push({ path: pathOf(["pages", pi, "key"]), message: `duplicate key ${page.key}` });
    seen.add(page.key);
    let inputs = 0;
    page.fields.forEach((field, fi) => {
      const base = ["pages", pi, "fields", fi];
      if (seen.has(field.key)) issues.push({ path: pathOf([...base, "key"]), message: `duplicate key ${field.key}` });
      seen.add(field.key);
      if (!registry.has(field.type)) { issues.push({ path: pathOf([...base, "type"]), message: `unknown field type ${field.type}` }); return; }
      const def = registry.get(field.type);
      if (def.isInput) inputs++;
      const settings = def.settingsSchema.safeParse(field.settings);
      if (!settings.success) settings.error.issues.forEach((i) => issues.push({ path: pathOf([...base, "settings", ...(i.path as string[])]), message: i.message }));
      else field.settings = settings.data;
      field.validation.forEach((rule, ri) => {
        if (!def.allowedRules.includes(rule.rule)) issues.push({ path: pathOf([...base, "validation", ri]), message: `rule ${rule.rule} not allowed for ${def.id}` });
      });
    });
    if (inputs > LIMITS.inputFieldsPerPage) issues.push({ path: pathOf(["pages", pi, "fields"]), message: `more than ${LIMITS.inputFieldsPerPage} input fields` });
  });

  if (issues.length === 0) {
    const index = fieldIndex(version);
    version.pages.forEach((page, pi) => {
      if (page.visibility) issues.push(...clauseIssues(page.visibility, index, registry, ["pages", pi, "visibility"]));
      page.fields.forEach((field, fi) => {
        if (field.visibility) issues.push(...clauseIssues(field.visibility, index, registry, ["pages", pi, "fields", fi, "visibility"]));
      });
    });
  }

  return issues.length ? { ok: false, issues } : { ok: true, version };
}
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test src/modules/form-model && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/form-model/domain/version.ts src/modules/form-model/domain/version.test.ts
git commit -m "feat(form-model): add version schema and draft parsing"
```

---

### Task 15: Visibility evaluation

**Files:**
- Create: `src/modules/form-model/domain/visibility.ts`
- Test: `src/modules/form-model/domain/visibility.test.ts`

**Interfaces:**
- Produces: `evaluateVisibility(version: Version, answers: Readonly<Record<string, unknown>>): Visibility` where `Visibility = { pages: ReadonlyMap<string, boolean>; fields: ReadonlyMap<string, boolean>; visibleAnswers: Record<string, unknown> }`. One forward pass. A clause referencing a hidden or not-yet-seen field sees `undefined`. `visibleAnswers` holds only answers of visible input fields, which is what conditions and submission validation consume.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { buildDefaultRegistry } from "./field-types";
import { parseDraft } from "./version";
import { evaluateVisibility } from "./visibility";

const registry = buildDefaultRegistry();
const r = parseDraft({
  languages: "es",
  confirmation: { screen: { es: "Gracias" } },
  pages: [
    { key: "p1", title: { es: "Uno" }, fields: [
      { key: "twins", type: "checkbox", label: { es: "¿Gemelos?" } },
      { key: "names", type: "short_text", label: { es: "Nombres" }, visibility: { field: "twins", op: "equals", value: true } },
      { key: "later_dep", type: "short_text", label: { es: "x" }, visibility: { field: "weeks", op: "is_not_empty" } },
    ] },
    { key: "p2", title: { es: "Dos" }, visibility: { field: "twins", op: "equals", value: true }, fields: [
      { key: "weeks", type: "number", label: { es: "Semanas" } },
    ] },
  ],
}, registry);
if (!r.ok) throw new Error(JSON.stringify(r.issues));
const version = r.version;

describe("evaluateVisibility", () => {
  it("shows dependent fields and pages when the condition holds", () => {
    const v = evaluateVisibility(version, { twins: true, names: "A y B", weeks: 30 });
    expect(v.fields.get("names")).toBe(true);
    expect(v.pages.get("p2")).toBe(true);
    expect(v.visibleAnswers).toEqual({ twins: true, names: "A y B", weeks: 30 });
  });
  it("hides them otherwise and drops their answers from visibleAnswers", () => {
    const v = evaluateVisibility(version, { twins: false, names: "stale", weeks: 30 });
    expect(v.fields.get("names")).toBe(false);
    expect(v.pages.get("p2")).toBe(false);
    expect(v.fields.get("weeks")).toBe(false);
    expect(v.visibleAnswers).toEqual({ twins: false });
  });
  it("treats a reference to a later field as undefined (single forward pass)", () => {
    const v = evaluateVisibility(version, { twins: true, weeks: 30 });
    expect(v.fields.get("later_dep")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/modules/form-model/domain/visibility`
Expected: FAIL.

- [ ] **Step 3: Implement**

`visibility.ts`:

```ts
import { evaluateCondition } from "./condition";
import type { Version } from "./version";

export interface Visibility {
  pages: ReadonlyMap<string, boolean>;
  fields: ReadonlyMap<string, boolean>;
  visibleAnswers: Record<string, unknown>;
}

export function evaluateVisibility(version: Version, answers: Readonly<Record<string, unknown>>): Visibility {
  const pages = new Map<string, boolean>();
  const fields = new Map<string, boolean>();
  const visibleAnswers: Record<string, unknown> = {};
  for (const page of version.pages) {
    const pageVisible = page.visibility ? evaluateCondition(page.visibility, visibleAnswers) : true;
    pages.set(page.key, pageVisible);
    for (const field of page.fields) {
      const visible = pageVisible && (field.visibility ? evaluateCondition(field.visibility, visibleAnswers) : true);
      fields.set(field.key, visible);
      if (visible && field.type !== "section" && field.key in answers) visibleAnswers[field.key] = answers[field.key];
    }
  }
  return { pages, fields, visibleAnswers };
}
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test src/modules/form-model && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/form-model/domain/visibility.ts src/modules/form-model/domain/visibility.test.ts
git commit -m "feat(form-model): add forward-pass visibility evaluation"
```

---

### Task 16: Submission validation

**Files:**
- Create: `src/modules/form-model/domain/submission.ts`
- Test: `src/modules/form-model/domain/submission.test.ts`

**Interfaces:**
- Produces:

```ts
export interface SubmissionContext { today: string }   // ISO date, supplied by the caller's Clock
export type SubmissionResult =
  | { ok: true; answers: Record<string, unknown>; consent?: { fieldKey: Key; textVersion: string } }
  | { ok: false; issues: ValidationIssue[] };
export function validateSubmission(version: Version, registry: FieldTypeRegistry, raw: Readonly<Record<string, unknown>>, ctx: SubmissionContext): SubmissionResult;
export function isAbsent(raw: unknown): boolean;  // undefined, null, blank string, empty array
```

Algorithm, in field order with a running record of normalized visible answers: for each input field, compute visibility against the normalized answers so far (hidden: skip, discard). If `isAbsent(raw)`: issue `required` when `field.required`, or `consent` when the type is `consent`, else skip. Otherwise parse the answer shape (`invalid_shape` on failure), normalize, run the type's intrinsic `validate`, then each rule in `field.validation` with `ruleParams`. All issues for a field are collected, duplicates by code removed. Extra keys in `raw` are ignored. On success, `answers` contains only normalized visible input answers; `consent` is set when a consent field was answered.

- [ ] **Step 1: Write the failing tests** (pins Review Focus 1)

```ts
import { describe, expect, it } from "vitest";
import { consentTextVersion } from "./consent-text";
import { buildDefaultRegistry } from "./field-types";
import { isAbsent, validateSubmission } from "./submission";
import { parseDraft } from "./version";

const registry = buildDefaultRegistry();
const consentText = { es: "Soy mayor de edad y acepto." };
const r = parseDraft({
  languages: "es",
  confirmation: { screen: { es: "Gracias" } },
  pages: [{ key: "p1", title: { es: "Datos" }, fields: [
    { key: "name", type: "short_text", label: { es: "Nombre" }, required: true, validation: [{ rule: "min_length", value: 2 }] },
    { key: "mail", type: "email", label: { es: "Correo" }, required: true },
    { key: "weeks", type: "number", label: { es: "Semanas" }, settings: { integerOnly: true }, validation: [{ rule: "max_value", value: 42 }] },
    { key: "twins", type: "checkbox", label: { es: "Gemelos" } },
    { key: "names", type: "short_text", label: { es: "Nombres" }, required: true, visibility: { field: "twins", op: "equals", value: true } },
    { key: "born", type: "date", label: { es: "Nacimiento" }, validation: [{ rule: "not_future" }] },
    { key: "info", type: "section", label: {}, settings: { title: { es: "Info" } } },
    { key: "ok", type: "consent", label: { es: "Consentimiento" }, settings: { text: consentText } },
  ] }],
}, registry);
if (!r.ok) throw new Error(JSON.stringify(r.issues));
const version = r.version;
const ctx = { today: "2026-10-10" };
const accepted = { accepted: true, textVersion: consentTextVersion(consentText) };

describe("isAbsent", () => {
  it("treats undefined, null, blank and empty array as absent, but not 0 or false", () => {
    for (const a of [undefined, null, "", "  ", []]) expect(isAbsent(a)).toBe(true);
    for (const p of [0, false, "x", [1]]) expect(isAbsent(p)).toBe(false);
  });
});

describe("validateSubmission", () => {
  it("accepts a complete submission, normalizes, drops extra keys and reports consent", () => {
    const res = validateSubmission(version, registry, { name: "  Ana ", mail: "ANA@Example.com", weeks: 30, twins: false, names: "ignored", born: "2026-01-01", ok: accepted, extra: "x" }, ctx);
    expect(res).toEqual({ ok: true, answers: { name: "Ana", mail: "ana@example.com", weeks: 30, twins: false, born: "2026-01-01", ok: accepted }, consent: { fieldKey: "ok", textVersion: accepted.textVersion } });
  });
  it("reports required and consent for absent answers", () => {
    const res = validateSubmission(version, registry, {}, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues).toEqual(expect.arrayContaining([{ code: "required", field: "name" }, { code: "required", field: "mail" }, { code: "consent", field: "ok" }]));
  });
  it("requires names only when twins is true", () => {
    const res = validateSubmission(version, registry, { name: "Ana", mail: "a@b.co", twins: true, ok: accepted }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues).toContainEqual({ code: "required", field: "names" });
  });
  it("reports shape, intrinsic and rule issues with params", () => {
    const res = validateSubmission(version, registry, { name: "A", mail: "nope", weeks: 50.5, born: "2027-01-01", ok: accepted }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues).toContainEqual({ code: "min_length", field: "name", params: { n: 2 } });
      expect(res.issues).toContainEqual({ code: "email_syntax", field: "mail" });
      expect(res.issues).toContainEqual({ code: "integer", field: "weeks" });
      expect(res.issues).toContainEqual({ code: "number_max", field: "weeks", params: { n: 42 } });
      expect(res.issues).toContainEqual({ code: "date_not_future", field: "born" });
    }
  });
  it("reports invalid_shape for a wrong type instead of throwing", () => {
    const res = validateSubmission(version, registry, { name: 5, mail: "a@b.co", ok: accepted }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues).toContainEqual({ code: "invalid_shape", field: "name" });
  });
  it("rejects a stale consent text version", () => {
    const res = validateSubmission(version, registry, { name: "Ana", mail: "a@b.co", ok: { accepted: true, textVersion: "0123456789abcdef" } }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues).toContainEqual({ code: "consent", field: "ok" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/modules/form-model/domain/submission`
Expected: FAIL.

- [ ] **Step 3: Implement**

`submission.ts`:

```ts
import { evaluateCondition } from "./condition";
import type { ValidationCode, ValidationIssue } from "./issues";
import type { Key } from "./keys";
import type { FieldTypeRegistry } from "./registry";
import { evaluateRule, ruleParams } from "./rules";
import type { Field, Version } from "./version";

export interface SubmissionContext { today: string }

export type SubmissionResult =
  | { ok: true; answers: Record<string, unknown>; consent?: { fieldKey: Key; textVersion: string } }
  | { ok: false; issues: ValidationIssue[] };

export function isAbsent(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true;
  if (typeof raw === "string") return raw.trim().length === 0;
  if (Array.isArray(raw)) return raw.length === 0;
  return false;
}

function issuesFor(field: Field, registry: FieldTypeRegistry, raw: unknown, ctx: SubmissionContext): { issues: ValidationIssue[]; normalized?: unknown } {
  const def = registry.get(field.type);
  const key = field.key as Key;
  const issue = (code: ValidationCode, params?: ValidationIssue["params"]): ValidationIssue => (params ? { code, field: key, params } : { code, field: key });

  if (isAbsent(raw)) {
    if (def.id === "consent") return { issues: [issue("consent")] };
    return { issues: field.required ? [issue("required")] : [] };
  }
  const shape = def.answerSchema.safeParse(raw);
  if (!shape.success) return { issues: [issue("invalid_shape")] };
  const normalized = def.normalize(shape.data, field.settings);
  if (def.isEmpty(normalized)) {
    if (def.id === "consent") return { issues: [issue("consent")] };
    // An empty-but-present value such as checkbox false is still an answer when not required.
    return { issues: field.required ? [issue("required")] : [], normalized };
  }
  const issues: ValidationIssue[] = def.validate(normalized, field.settings).map((code) => issue(code));
  for (const rule of field.validation) {
    const code = evaluateRule(rule, normalized, ctx);
    if (code) { const params = ruleParams(rule); issues.push(issue(code, Object.keys(params).length ? params : undefined)); }
  }
  const unique = issues.filter((i, idx) => issues.findIndex((j) => j.code === i.code) === idx);
  return { issues: unique, normalized };
}

export function validateSubmission(version: Version, registry: FieldTypeRegistry, raw: Readonly<Record<string, unknown>>, ctx: SubmissionContext): SubmissionResult {
  const answers: Record<string, unknown> = {};
  const issues: ValidationIssue[] = [];
  let consent: { fieldKey: Key; textVersion: string } | undefined;

  for (const page of version.pages) {
    const pageVisible = page.visibility ? evaluateCondition(page.visibility, answers) : true;
    if (!pageVisible) continue;
    for (const field of page.fields) {
      const def = registry.get(field.type);
      if (!def.isInput) continue;
      const visible = field.visibility ? evaluateCondition(field.visibility, answers) : true;
      if (!visible) continue;
      const result = issuesFor(field, registry, raw[field.key], ctx);
      issues.push(...result.issues);
      if (result.issues.length === 0 && result.normalized !== undefined) {
        answers[field.key] = result.normalized;
        if (def.id === "consent") consent = { fieldKey: field.key as Key, textVersion: (result.normalized as { textVersion: string }).textVersion };
      }
    }
  }
  if (issues.length) return { ok: false, issues };
  return consent ? { ok: true, answers, consent } : { ok: true, answers };
}
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test src/modules/form-model && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/form-model/domain/submission.ts src/modules/form-model/domain/submission.test.ts
git commit -m "feat(form-model): add submission validation"
```

---

### Task 17: Publish validation and strict version parsing

**Files:**
- Create: `src/modules/form-model/domain/publish.ts`
- Test: `src/modules/form-model/domain/publish.test.ts`

**Interfaces:**
- Produces:

```ts
export function collectsPersonalData(version: Version, registry: FieldTypeRegistry): boolean; // any input field whose type collectsPersonalData, or flagged `personal`
export interface PublishContext { retentionMonths?: number }
export function checkDefinition(version: Version, registry: FieldTypeRegistry): PublishIssue[];  // definition-only checks
export function validateForPublish(version: Version, registry: FieldTypeRegistry, ctx: PublishContext): PublishIssue[]; // checkDefinition + retention_missing
export function parseVersion(input: unknown, registry: FieldTypeRegistry): ParseResult; // strict: parseDraft, then checkDefinition must be empty
```

Checks and their codes, with `path` as in Task 14:

| Code | Condition |
|---|---|
| `no_input` | no input field anywhere; path `pages` |
| `unlabeled` | an input field whose label is blank in every required language; a section whose title is blank |
| `missing_translation` | a required text present in one required language but blank in another: field label, help, page title, page description, section title or description, option label, consent text, confirmation screen, email subject or body; `params: { lang }` |
| `option_unlabeled` | an option whose label is blank in every required language |
| `consent_missing` | `collectsPersonalData` and no `consent` field |
| `consent_checklist` | a `consent` field whose `coveredItems` lacks any of the nine |
| `confirmation_missing` | confirmation screen blank in every required language |
| `header_alt_missing` | header image set and alt blank or partial; `params: { lang }` |
| `submitter_email_dup` | more than one `email` field with `isSubmitterAddress` |
| `dangling_condition` | a clause references a key that does not exist or does not come earlier (for a page condition, earlier means on a previous page); `params: { ref }` |
| `over_maximum` | a `min_length`/`max_length` value above the type's cap (`LIMITS.shortTextMax`, `LIMITS.longTextMax`), a `min_files`/`max_files` value above the field's `maxFiles`, a `min_selected`/`max_selected` value above the option count; `params: { detail }` |
| `retention_missing` | `ctx.retentionMonths` undefined or outside 1..36; path `settings/retention` |

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { consentItems } from "./field-types/consent";
import { buildDefaultRegistry } from "./field-types";
import { checkDefinition, collectsPersonalData, parseVersion, validateForPublish } from "./publish";
import { parseDraft } from "./version";

const registry = buildDefaultRegistry();
const parse = (input: unknown) => { const r = parseDraft(input, registry); if (!r.ok) throw new Error(JSON.stringify(r.issues)); return r.version; };
const consentField = { key: "ok", type: "consent", label: { en: "Consent", es: "Consentimiento" }, settings: { text: { en: "I agree", es: "Acepto" }, coveredItems: [...consentItems] } };
const base = {
  languages: "bilingual",
  confirmation: { screen: { en: "Thanks", es: "Gracias" } },
  pages: [{ key: "p1", title: { en: "One", es: "Uno" }, fields: [
    { key: "name", type: "short_text", label: { en: "Name", es: "Nombre" } },
    { key: "mail", type: "email", label: { en: "Email", es: "Correo" }, settings: { isSubmitterAddress: true } },
    consentField,
  ] }],
};
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("collectsPersonalData", () => {
  it("is true with an email, phone, file upload or personal-flagged field", () => {
    expect(collectsPersonalData(parse(base), registry)).toBe(true);
    const plain = parse({ ...base, pages: [{ key: "p1", title: { en: "x", es: "x" }, fields: [{ key: "n", type: "number", label: { en: "N", es: "N" } }] }] });
    expect(collectsPersonalData(plain, registry)).toBe(false);
    const flagged = parse({ ...base, pages: [{ key: "p1", title: { en: "x", es: "x" }, fields: [{ key: "n", type: "number", label: { en: "N", es: "N" }, personal: true }] }] });
    expect(collectsPersonalData(flagged, registry)).toBe(true);
  });
});

describe("checkDefinition", () => {
  it("passes a complete bilingual definition", () => {
    expect(checkDefinition(parse(base), registry)).toEqual([]);
  });
  it("reports no_input, unlabeled, missing_translation and confirmation_missing", () => {
    const v = parse({ languages: "bilingual", confirmation: { screen: {} }, pages: [{ key: "p1", title: { en: "One" }, fields: [
      { key: "s", type: "section", label: {}, settings: { title: {} } },
    ] }] });
    expect(codes(checkDefinition(v, registry))).toEqual(expect.arrayContaining(["no_input", "unlabeled", "missing_translation", "confirmation_missing"]));
  });
  it("reports missing_translation with the language and path", () => {
    const v = parse({ ...base, pages: [{ key: "p1", title: { en: "One", es: "Uno" }, fields: [{ key: "name", type: "short_text", label: { en: "Name" } }] }] });
    expect(checkDefinition(v, registry)).toContainEqual({ code: "missing_translation", path: "pages/0/fields/0/label", params: { lang: "es" } });
  });
  it("reports consent_missing when personal data is collected without consent", () => {
    const v = parse({ ...base, pages: [{ key: "p1", title: { en: "One", es: "Uno" }, fields: [base.pages[0]!.fields[1]!] }] });
    expect(codes(checkDefinition(v, registry))).toContain("consent_missing");
  });
  it("reports consent_checklist when an item is not covered", () => {
    const v = parse({ ...base, pages: [{ ...base.pages[0]!, fields: [base.pages[0]!.fields[0]!, { ...consentField, settings: { text: { en: "I agree", es: "Acepto" }, coveredItems: consentItems.slice(1) } }] }] });
    expect(codes(checkDefinition(v, registry))).toContain("consent_checklist");
  });
  it("reports submitter_email_dup", () => {
    const second = { key: "mail2", type: "email", label: { en: "Other", es: "Otro" }, settings: { isSubmitterAddress: true } };
    const v = parse({ ...base, pages: [{ ...base.pages[0]!, fields: [...base.pages[0]!.fields, second] }] });
    expect(codes(checkDefinition(v, registry))).toContain("submitter_email_dup");
  });
  it("reports dangling_condition for missing and forward references, including page conditions", () => {
    const v = parse({ ...base, pages: [
      { key: "p1", title: { en: "One", es: "Uno" }, fields: [
        { key: "a", type: "short_text", label: { en: "A", es: "A" }, visibility: { field: "zzz", op: "is_empty" } },
        { key: "b", type: "short_text", label: { en: "B", es: "B" }, visibility: { field: "c", op: "is_empty" } },
        { key: "c", type: "short_text", label: { en: "C", es: "C" } },
        ...base.pages[0]!.fields.slice(1),
      ] },
      { key: "p2", title: { en: "Two", es: "Dos" }, visibility: { field: "d", op: "is_empty" }, fields: [{ key: "d", type: "short_text", label: { en: "D", es: "D" } }] },
    ] });
    const dangling = checkDefinition(v, registry).filter((i) => i.code === "dangling_condition");
    expect(dangling.map((i) => i.params?.ref)).toEqual(["zzz", "c", "d"]);
  });
  it("reports over_maximum for rule values beyond caps", () => {
    const v = parse({ ...base, pages: [{ ...base.pages[0]!, fields: [
      { key: "name", type: "short_text", label: { en: "Name", es: "Nombre" }, validation: [{ rule: "max_length", value: 6000 }] },
      { key: "pics", type: "file_upload", label: { en: "Pics", es: "Fotos" }, settings: { kinds: ["image"], maxFiles: 3 }, validation: [{ rule: "min_files", value: 4 }] },
      ...base.pages[0]!.fields.slice(1),
    ] }] });
    expect(checkDefinition(v, registry).filter((i) => i.code === "over_maximum")).toHaveLength(2);
  });
  it("reports header_alt_missing", () => {
    const v = parse({ ...base, headerImage: { ref: "m_aaaaaaaa", alt: { en: "Babies" } } });
    expect(checkDefinition(v, registry)).toContainEqual({ code: "header_alt_missing", path: "headerImage/alt", params: { lang: "es" } });
  });
});

describe("validateForPublish and parseVersion", () => {
  it("adds retention_missing when retention is unset or out of range", () => {
    expect(codes(validateForPublish(parse(base), registry, {}))).toEqual(["retention_missing"]);
    expect(validateForPublish(parse(base), registry, { retentionMonths: 37 })).toHaveLength(1);
    expect(validateForPublish(parse(base), registry, { retentionMonths: 12 })).toEqual([]);
  });
  it("parseVersion is strict", () => {
    expect(parseVersion(base, registry).ok).toBe(true);
    const r = parseVersion({ ...base, confirmation: { screen: {} } }, registry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.message).toMatch(/confirmation_missing/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/modules/form-model/domain/publish`
Expected: FAIL.

- [ ] **Step 3: Implement**

`publish.ts`:

```ts
import { type Languages, type LocalizedText, requiredLocales } from "@/shared/domain/localized-text";
import { referencedKeys, type Condition } from "./condition";
import { isConsentChecklistComplete } from "./field-types/consent";
import type { PublishIssue } from "./issues";
import { LIMITS } from "./limits";
import type { FieldTypeRegistry } from "./registry";
import { fieldIndex, inputFields, parseDraft, type Field, type ParseResult, type Version } from "./version";

export interface PublishContext { retentionMonths?: number }

const blank = (s: string | undefined) => s === undefined || s.trim().length === 0;

/** "blank" = empty in every required language; "partial" = some but not all; "ok" otherwise. */
function textStatus(text: LocalizedText | undefined, languages: Languages): { status: "ok" | "blank" | "partial"; missing: string[] } {
  const missing = requiredLocales(languages).filter((l) => blank(text?.[l]));
  const required = requiredLocales(languages).length;
  return { status: missing.length === 0 ? "ok" : missing.length === required ? "blank" : "partial", missing };
}

export function collectsPersonalData(version: Version, registry: FieldTypeRegistry): boolean {
  return inputFields(version, registry).some((f) => f.personal || registry.get(f.type).collectsPersonalData);
}

export function checkDefinition(version: Version, registry: FieldTypeRegistry): PublishIssue[] {
  const issues: PublishIssue[] = [];
  const L = version.languages;
  const push = (code: PublishIssue["code"], path: string, params?: PublishIssue["params"]) => issues.push(params ? { code, path, params } : { code, path });

  const requireText = (text: LocalizedText | undefined, path: string, blankCode: PublishIssue["code"] | null) => {
    const { status, missing } = textStatus(text, L);
    if (status === "blank" && blankCode) push(blankCode, path);
    if (status === "partial") for (const lang of missing) push("missing_translation", path, { lang });
  };
  const optionalText = (text: LocalizedText | undefined, path: string) => { if (text) requireText(text, path, null); };

  if (inputFields(version, registry).length === 0) push("no_input", "pages");
  requireText(version.confirmation.screen, "confirmation/screen", "confirmation_missing");
  if (version.confirmation.email) {
    requireText(version.confirmation.email.subject, "confirmation/email/subject", "unlabeled");
    requireText(version.confirmation.email.body, "confirmation/email/body", "unlabeled");
  }
  if (version.headerImage) {
    const { status, missing } = textStatus(version.headerImage.alt, L);
    if (status !== "ok") for (const lang of (status === "blank" ? requiredLocales(L) : missing)) push("header_alt_missing", "headerImage/alt", { lang });
  }

  const index = fieldIndex(version);
  const pageStart = new Map<string, number>(); // page key -> order of its first field
  let order = 0;
  version.pages.forEach((page) => { pageStart.set(page.key, order); order += page.fields.length; });

  const checkCondition = (cond: Condition, ownOrder: number, path: string) => {
    for (const ref of referencedKeys(cond)) {
      const target = index.get(ref);
      if (!target || target.order >= ownOrder) push("dangling_condition", path, { ref });
    }
  };

  let submitterEmails = 0;
  let consentFields = 0;

  version.pages.forEach((page, pi) => {
    const pPath = `pages/${pi}`;
    requireText(page.title, `${pPath}/title`, "unlabeled");
    optionalText(page.description, `${pPath}/description`);
    if (page.visibility) checkCondition(page.visibility, pageStart.get(page.key) ?? 0, `${pPath}/visibility`);

    page.fields.forEach((field: Field, fi) => {
      const fPath = `${pPath}/fields/${fi}`;
      const def = registry.get(field.type);
      const settings = field.settings as Record<string, unknown>;
      if (def.isInput) requireText(field.label, `${fPath}/label`, "unlabeled");
      optionalText(field.help, `${fPath}/help`);
      if (field.visibility) checkCondition(field.visibility, index.get(field.key)?.order ?? 0, `${fPath}/visibility`);

      if (def.id === "section") {
        requireText(settings["title"] as LocalizedText, `${fPath}/settings/title`, "unlabeled");
        optionalText(settings["description"] as LocalizedText | undefined, `${fPath}/settings/description`);
      }
      if (def.id === "single_choice" || def.id === "multiple_choice") {
        const options = settings["options"] as { key: string; label: LocalizedText }[];
        options.forEach((o, oi) => requireText(o.label, `${fPath}/settings/options/${oi}/label`, "option_unlabeled"));
        for (const rule of field.validation) if ((rule.rule === "min_selected" || rule.rule === "max_selected") && rule.value > options.length) push("over_maximum", `${fPath}/validation`, { detail: `${rule.rule} ${rule.value} > ${options.length} options` });
      }
      if (def.id === "email" && settings["isSubmitterAddress"] === true) submitterEmails++;
      if (def.id === "consent") {
        consentFields++;
        requireText(settings["text"] as LocalizedText, `${fPath}/settings/text`, "unlabeled");
        if (!isConsentChecklistComplete(settings as { coveredItems: never[] })) push("consent_checklist", `${fPath}/settings/coveredItems`);
      }
      if (def.id === "short_text" || def.id === "long_text") {
        const cap = def.id === "short_text" ? LIMITS.shortTextMax : LIMITS.longTextMax;
        for (const rule of field.validation) if ((rule.rule === "min_length" || rule.rule === "max_length") && rule.value > cap) push("over_maximum", `${fPath}/validation`, { detail: `${rule.rule} ${rule.value} > ${cap}` });
      }
      if (def.id === "file_upload") {
        const maxFiles = settings["maxFiles"] as number;
        for (const rule of field.validation) if ((rule.rule === "min_files" || rule.rule === "max_files") && rule.value > maxFiles) push("over_maximum", `${fPath}/validation`, { detail: `${rule.rule} ${rule.value} > ${maxFiles} files` });
      }
    });
  });

  if (submitterEmails > 1) push("submitter_email_dup", "pages");
  if (consentFields === 0 && collectsPersonalData(version, registry)) push("consent_missing", "pages");
  return issues;
}

export function validateForPublish(version: Version, registry: FieldTypeRegistry, ctx: PublishContext): PublishIssue[] {
  const issues = checkDefinition(version, registry);
  const r = ctx.retentionMonths;
  if (r === undefined || !Number.isInteger(r) || r < LIMITS.retentionMonthsMin || r > LIMITS.retentionMonthsMax) issues.push({ code: "retention_missing", path: "settings/retention" });
  return issues;
}

export function parseVersion(input: unknown, registry: FieldTypeRegistry): ParseResult {
  const draft = parseDraft(input, registry);
  if (!draft.ok) return draft;
  const issues = checkDefinition(draft.version, registry);
  if (issues.length) return { ok: false, issues: issues.map((i) => ({ path: i.path, message: `${i.code}${i.params ? " " + JSON.stringify(i.params) : ""}` })) };
  return draft;
}
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test src/modules/form-model && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/form-model/domain/publish.ts src/modules/form-model/domain/publish.test.ts
git commit -m "feat(form-model): add publish validation and strict version parsing"
```

---

### Task 18: Export columns and rows

**Files:**
- Create: `src/modules/form-model/domain/export.ts`
- Test: `src/modules/form-model/domain/export.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ExportColumn { key: string; typeId: FieldTypeId; header: string; cell: number }  // cell = index within the field's cells
export function exportColumns(versions: readonly Version[], registry: FieldTypeRegistry, locale: Locale): ExportColumn[];
export function exportRow(columns: readonly ExportColumn[], version: Version, registry: FieldTypeRegistry, answers: Readonly<Record<string, unknown>>, locale: Locale): string[];
```

`exportColumns` takes the union of input field keys across `versions`, ordered by the **last** version in the array (the latest), with keys that exist only in older versions appended in their own order, oldest first. The header uses the label from the latest version that has the key, resolved in `locale` with that version's fallback. Each key expands to `def.exportHeaders(label).length` columns. `exportRow` fills each column from the submission's own version: if the key is absent from that version, every cell for it is `""`. Fixed columns such as reference and status are added by the `review` module.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { exportColumns, exportRow } from "./export";
import { buildDefaultRegistry } from "./field-types";
import { parseDraft } from "./version";

const registry = buildDefaultRegistry();
const parse = (input: unknown) => { const r = parseDraft(input, registry); if (!r.ok) throw new Error(JSON.stringify(r.issues)); return r.version; };
const v1 = parse({ languages: "bilingual", confirmation: { screen: { en: "x", es: "x" } }, pages: [{ key: "p1", title: { en: "p", es: "p" }, fields: [
  { key: "name", type: "short_text", label: { en: "Name", es: "Nombre" } },
  { key: "old", type: "number", label: { en: "Old field", es: "Campo viejo" } },
  { key: "pics", type: "file_upload", label: { en: "Photos", es: "Fotos" }, settings: { kinds: ["image"] } },
] }] });
const v2 = parse({ languages: "bilingual", confirmation: { screen: { en: "x", es: "x" } }, pages: [{ key: "p1", title: { en: "p", es: "p" }, fields: [
  { key: "info", type: "section", label: {}, settings: { title: { en: "i", es: "i" } } },
  { key: "pics", type: "file_upload", label: { en: "Pictures", es: "Imágenes" }, settings: { kinds: ["image"] } },
  { key: "name", type: "short_text", label: { en: "Full name", es: "Nombre completo" } },
  { key: "new", type: "checkbox", label: { en: "New", es: "Nuevo" } },
] }] });

describe("exportColumns", () => {
  it("orders by the latest version, appends older-only keys, labels from the latest, expands multi-cell types", () => {
    const cols = exportColumns([v1, v2], registry, "es");
    expect(cols.map((c) => c.header)).toEqual(["Imágenes (count)", "Imágenes (files)", "Nombre completo", "Nuevo", "Campo viejo"]);
    expect(cols.map((c) => c.key)).toEqual(["pics", "pics", "name", "new", "old"]);
  });
});

describe("exportRow", () => {
  const cols = exportColumns([v1, v2], registry, "en");
  it("fills from the submission's own version and blanks keys it lacks", () => {
    expect(exportRow(cols, v1, registry, { name: "Ana", old: 3, pics: ["m_aaaaaaaa"] }, "en")).toEqual(["1", "m_aaaaaaaa", "Ana", "", "3"]);
    expect(exportRow(cols, v2, registry, { name: "Ana", new: true, pics: [] }, "en")).toEqual(["0", "", "Ana", "yes", ""]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/modules/form-model/domain/export`
Expected: FAIL.

- [ ] **Step 3: Implement**

`export.ts`:

```ts
import { type Locale, resolveText } from "@/shared/domain/localized-text";
import type { FieldTypeId } from "./field-type";
import type { FieldTypeRegistry } from "./registry";
import { inputFields, type Field, type Version } from "./version";

export interface ExportColumn { key: string; typeId: FieldTypeId; header: string; cell: number }

export function exportColumns(versions: readonly Version[], registry: FieldTypeRegistry, locale: Locale): ExportColumn[] {
  const latestFirst = [...versions].reverse();
  const ordered: { field: Field; version: Version }[] = [];
  const seen = new Set<string>();
  for (const version of latestFirst) {
    for (const field of inputFields(version, registry)) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      ordered.push({ field, version });
    }
  }
  return ordered.flatMap(({ field, version }) => {
    const def = registry.get(field.type);
    const label = resolveText(field.label, locale, version.languages) || field.key;
    return def.exportHeaders(label).map((header, cell) => ({ key: field.key, typeId: def.id, header, cell }));
  });
}

export function exportRow(columns: readonly ExportColumn[], version: Version, registry: FieldTypeRegistry, answers: Readonly<Record<string, unknown>>, locale: Locale): string[] {
  const fields = new Map(inputFields(version, registry).map((f) => [f.key, f] as const));
  const cache = new Map<string, string[]>();
  return columns.map((col) => {
    const field = fields.get(col.key);
    if (!field) return "";
    if (!cache.has(col.key)) {
      const def = registry.get(field.type);
      cache.set(col.key, def.exportCells(answers[col.key], field.settings, locale, version.languages));
    }
    return cache.get(col.key)?.[col.cell] ?? "";
  });
}
```

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test src/modules/form-model && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/form-model/domain/export.ts src/modules/form-model/domain/export.test.ts
git commit -m "feat(form-model): add export columns and rows"
```

---

### Task 19: Public API, reference form fixture, inter-module rules, PR

**Files:**
- Create: `src/modules/form-model/application/index.ts`
- Create: `tests/fixtures/reference-form.ts`
- Test: `tests/fixtures/reference-form.test.ts`
- Modify: `eslint.config.mjs` (inter-module DAG), `tests/boundaries/boundaries.test.ts` (two more cases)
- Modify: `README.md`

**Interfaces:**
- Produces the only import surface other modules may use, `@/modules/form-model/application`:

```ts
export { buildDefaultRegistry, operatorsFor } from "../domain/field-types";
export type { FieldTypeRegistry } from "../domain/registry";
export { UnknownFieldTypeError } from "../domain/registry";
export type { FieldTypeDefinition, FieldTypeId } from "../domain/field-type";
export { fieldTypeIds } from "../domain/field-type";
export { LIMITS } from "../domain/limits";
export { keySchema, asKey } from "../domain/keys";
export type { Key } from "../domain/keys";
export type { ValidationIssue, ValidationCode, PublishIssue, PublishCode } from "../domain/issues";
export { validationCodes, publishCodes } from "../domain/issues";
export { OPERATORS, operatorSchema } from "../domain/operators";
export type { OperatorId } from "../domain/operators";
export { conditionSchema, evaluateCondition, referencedKeys } from "../domain/condition";
export type { Condition, Clause } from "../domain/condition";
export { ruleSchema } from "../domain/rules";
export type { Rule, RuleId } from "../domain/rules";
export { versionSchema, parseDraft, inputFields, fieldIndex } from "../domain/version";
export type { Version, Page, Field, ParseIssue, ParseResult } from "../domain/version";
export { evaluateVisibility } from "../domain/visibility";
export type { Visibility } from "../domain/visibility";
export { validateSubmission, isAbsent } from "../domain/submission";
export type { SubmissionContext, SubmissionResult } from "../domain/submission";
export { checkDefinition, validateForPublish, parseVersion, collectsPersonalData } from "../domain/publish";
export type { PublishContext } from "../domain/publish";
export { exportColumns, exportRow } from "../domain/export";
export type { ExportColumn } from "../domain/export";
export { consentTextVersion } from "../domain/consent-text";
export { consentItems, isConsentChecklistComplete } from "../domain/field-types/consent";
export type { ConsentItem } from "../domain/field-types/consent";
export { effectiveDisplay } from "../domain/field-types/single-choice";
export { mediaIdSchema } from "../domain/field-types/file-upload";
```

- [ ] **Step 1: Write the reference form fixture**

`tests/fixtures/reference-form.ts` encodes `specs/use-cases/reference-form-preemie-stories.md` as a draft input object: five pages with the keys and types listed there, Spanish single-language, the compliant consent text with all nine items covered, confirmation screen "Gracias por la información.", no email. Field keys: `adult_name`, `phone`, `email` (isSubmitterAddress), `instagram`, `photo_auth` (options `si`, `no`), `contact_auth` (options `phone`, `email`, `either`, `no`), `pregnancy` (options `single`, `twins`, `triplets`, `more`), `baby_name`, `pediatrician`, `hospital`, `weeks`, `weight`, `age_birthdate`, `helpers`, `story`, `source` (options `instagram`, `facebook`, `friend`, `search`), `photos` (kinds image and video, maxFiles 10, rules min_files 1), `info` section, `consent`. All inputs required. Help texts and descriptions copied from the spec in Spanish. Export it as `referenceFormDraft` and a `referenceSubmission` object of synthetic answers (invented names, `familia@example.com`, two media ids, consent with the right `textVersion` computed via `consentTextVersion`).

- [ ] **Step 2: Write the failing end-to-end test**

`tests/fixtures/reference-form.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDefaultRegistry, checkDefinition, evaluateVisibility, exportColumns, exportRow, parseDraft, parseVersion, validateForPublish, validateSubmission } from "@/modules/form-model/application";
import { referenceFormDraft, referenceSubmission } from "./reference-form";

const registry = buildDefaultRegistry();

describe("reference form through the public API", () => {
  it("parses as a draft and as a strict version", () => {
    expect(parseDraft(referenceFormDraft, registry).ok).toBe(true);
    expect(parseVersion(referenceFormDraft, registry).ok).toBe(true);
  });
  it("publishes with retention 12 and fails without", () => {
    const r = parseDraft(referenceFormDraft, registry); if (!r.ok) throw new Error("parse");
    expect(validateForPublish(r.version, registry, { retentionMonths: 12 })).toEqual([]);
    expect(validateForPublish(r.version, registry, {}).map((i) => i.code)).toEqual(["retention_missing"]);
  });
  it("has 5 pages, 18 inputs and at most 7 inputs per page", () => {
    const r = parseDraft(referenceFormDraft, registry); if (!r.ok) throw new Error("parse");
    expect(r.version.pages).toHaveLength(5);
    const counts = r.version.pages.map((p) => p.fields.filter((f) => f.type !== "section").length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(18);
    expect(Math.max(...counts)).toBeLessThanOrEqual(7);
  });
  it("requires consent because it collects personal data", () => {
    const withoutConsent = structuredClone(referenceFormDraft) as { pages: { fields: { type: string }[] }[] };
    withoutConsent.pages[4]!.fields = withoutConsent.pages[4]!.fields.filter((f) => f.type !== "consent");
    const r = parseDraft(withoutConsent, registry); if (!r.ok) throw new Error("parse");
    expect(checkDefinition(r.version, registry).map((i) => i.code)).toContain("consent_missing");
  });
  it("accepts the synthetic submission and rejects one without photos", () => {
    const r = parseDraft(referenceFormDraft, registry); if (!r.ok) throw new Error("parse");
    const ok = validateSubmission(r.version, registry, referenceSubmission, { today: "2026-10-10" });
    expect(ok.ok).toBe(true);
    const noPhotos = validateSubmission(r.version, registry, { ...referenceSubmission, photos: [] }, { today: "2026-10-10" });
    expect(noPhotos.ok).toBe(false);
    if (!noPhotos.ok) expect(noPhotos.issues).toContainEqual({ code: "required", field: "photos" });
  });
  it("everything is visible (no logic) and exports 18 keys to 20 columns", () => {
    const r = parseDraft(referenceFormDraft, registry); if (!r.ok) throw new Error("parse");
    const vis = evaluateVisibility(r.version, referenceSubmission);
    expect([...vis.fields.values()].every(Boolean)).toBe(true);
    const cols = exportColumns([r.version], registry, "es");
    expect(cols).toHaveLength(20); // 16 single-cell + photos (2) + consent (2)
    const ok = validateSubmission(r.version, registry, referenceSubmission, { today: "2026-10-10" }); if (!ok.ok) throw new Error("submission");
    expect(exportRow(cols, r.version, registry, ok.answers, "es")).toHaveLength(20);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test tests/fixtures`
Expected: FAIL, `@/modules/form-model/application` not found.

- [ ] **Step 4: Write the public API barrel exactly as listed in Interfaces, then run**

Run: `pnpm test tests/fixtures`
Expected: PASS. If the input count or column count differs, fix the fixture to match the spec, not the test.

- [ ] **Step 5: Add the inter-module dependency rules**

In `eslint.config.mjs`, replace the `module-application` rule entry with one that encodes the DAG from `specs/architecture.md`:

```js
const MODULE_DEPS = {
  "form-model": [],
  identity: [],
  media: [],
  notifications: [],
  definitions: ["form-model", "identity"],
  submissions: ["form-model", "definitions", "media", "notifications"],
  review: ["form-model", "definitions", "submissions", "media", "identity"],
};
const moduleRules = Object.entries(MODULE_DEPS).flatMap(([mod, deps]) =>
  ["application", "infrastructure", "presentation"].map((layer) => ({
    from: [[`module-${layer}`, { module: mod }]],
    allow: [
      "shared-domain", "shared-application",
      ...(layer === "infrastructure" ? ["shared-infrastructure"] : []),
      ...(layer === "presentation" ? ["shared-presentation"] : []),
      ["module-domain", { module: mod }],
      ["module-application", { module: mod }],
      [`module-${layer}`, { module: mod }],
      ...deps.map((d) => ["module-application", { module: d }]),
    ],
  })),
);
```

and spread `...moduleRules` into the `rules` array in place of the generic `module-application`, `module-infrastructure` and `module-presentation` entries. Keep the `module-domain` entry: domain never imports another module. Add to `tests/boundaries/boundaries.test.ts`:

```ts
  it("allows a module domain to import shared domain", async () => {
    const rules = await lintVirtual(
      "src/modules/probe-a/domain/shared.ts",
      `import { resolveText } from "@/shared/domain/localized-text";\nexport const r = resolveText;\n`,
    );
    expect(rules.filter((r) => r?.startsWith("boundaries/"))).toEqual([]);
  });

  it("lets definitions use form-model's public API but not review's", async () => {
    const ok = await lintVirtual("src/modules/definitions/application/probe.ts", `import { LIMITS } from "@/modules/form-model/application";\nexport const l = LIMITS;\n`);
    expect(ok.filter((r) => r?.startsWith("boundaries/"))).toEqual([]);
    await lintVirtual("src/modules/review/application/index.ts", `export const y = 1;\n`);
    const bad = await lintVirtual("src/modules/definitions/application/probe2.ts", `import { y } from "@/modules/review/application";\nexport const z = y;\n`);
    expect(bad).toContain("boundaries/element-types");
  });
```

Run: `pnpm test tests/boundaries`
Expected: PASS.

- [ ] **Step 6: README orientation**

Replace `README.md` with:

```markdown
# effluz-forms

Form builder and manager for Effluz events and processes. Staff build and
publish forms; the public fills them in; staff review the results.

- How to work here: `CLAUDE.md`
- What the system is: `specs/architecture.md`, `specs/form-definition.md`
- Design: `specs/design.md`, `design-system/`
- Decisions: `specs/decisions/`

## Develop

    corepack enable
    pnpm install
    pnpm test
    pnpm lint && pnpm typecheck
```

- [ ] **Step 7: Full verification, commit, mark the PR ready**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all exit 0.

```bash
git add -A
git commit -m "feat(form-model): expose public API, add reference form fixture and module dependency rules"
git push
gh pr ready
```

Then update the PR body to link the spec sections implemented: `specs/form-definition.md` (all), `specs/architecture.md` Modules and Ports (`FieldTypeRegistry`), `specs/system/ci-cd.md` Workflow `ci` (lint, typecheck, unit, build), and ADR 0012.

---

## Self-review notes

- **Spec coverage.** Concepts, text and languages, structure, keys, all twelve field types, validation, conditional logic, consent text checklist, privacy rules the model enforces (personal data detection, consent requirement, retention bounds, upload caps), submissions shape (answers normalization, consent record), export union: covered by Tasks 4 to 18. Lifecycle states and operational settings are owned by `definitions` and are not in this module. The builder guidance warnings (7 fields, upload page break) belong to the builder; the model exposes `LIMITS.inputFieldsPerPageWarn` for it.
- **Not in this plan.** Presentation-side capabilities of a field type (builder editor, renderer component, review display) and the conformance checks on them arrive with the `definitions`, `submissions` and `review` plans, which extend `FieldTypeDefinition` through a separate presentation registry keyed by `FieldTypeId`. The `integration` and `e2e` CI jobs arrive with those plans.
- **Type consistency.** `settings` is `unknown` on `Field` and parsed by each type's schema in `parseDraft`; every consumer receives already-parsed settings. `Key` is branded; tests use plain strings where the schema parses them.
- **Review Focus** tests: 1 in Task 16 (`extra` key), 2 in Tasks 14 and 5, 3 in Task 8, 4 in Task 10, 5 in Task 9.
