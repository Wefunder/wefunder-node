import { defineConfig } from "vitest/config";

// Live sandbox E2E only. Auto-skips inside the suite when creds are absent.
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
