import { defineConfig } from "vitest/config";
import path from "node:path";

// End-to-end tests against the built app (`pnpm build` first). See specs/system/ci-cd.md.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/e2e/setup.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
