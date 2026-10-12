import { defineConfig, devices } from "@playwright/test";
import { BROWSER_E2E_BASE_URL } from "./tests/support/app-server";

// Browser end-to-end run against the built app (`pnpm build` first). See ADR 0024 and specs/system/ci-cd.md.
export default defineConfig({
  testDir: "tests/browser",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 120_000,
  // A stray `test.only` would shrink the CI run to one case and still pass.
  forbidOnly: !!process.env["CI"],
  globalSetup: "./tests/browser/global-setup.ts",
  reporter: process.env["CI"]
    ? [["list"], ["junit", { outputFile: "reports/e2e-browser.xml" }]]
    : "list",
  use: { baseURL: BROWSER_E2E_BASE_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium-phone", use: { ...devices["Pixel 7"] } }],
});
