import { defineConfig, devices } from "@playwright/test";

// Browser end-to-end run against the built app (`pnpm build` first). See ADR 0024 and specs/system/ci-cd.md.
export default defineConfig({
  testDir: "tests/browser",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 120_000,
  globalSetup: "./tests/browser/global-setup.ts",
  reporter: process.env["CI"]
    ? [["list"], ["junit", { outputFile: "reports/e2e-browser.xml" }]]
    : "list",
  use: { baseURL: "http://127.0.0.1:3299", trace: "retain-on-failure" },
  projects: [{ name: "chromium-phone", use: { ...devices["Pixel 7"] } }],
});
