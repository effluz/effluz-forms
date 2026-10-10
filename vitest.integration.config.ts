import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests run against a throwaway Postgres database created by the
// global setup. See specs/system/database.md, "Local development".
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
