import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/integration/**", "tests/e2e/**", "tests/browser/**", "node_modules/**"],
    environment: "node",
    coverage: { provider: "v8", include: ["src/**"], exclude: ["src/app/**"] },
  },
});
