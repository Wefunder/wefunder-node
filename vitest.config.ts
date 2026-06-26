import { defineConfig } from "vitest/config";

// Default `test` run is hermetic (no network): excludes the live E2E.
// Run the live sandbox suite explicitly with `npm run test:e2e`.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "test/e2e/**"],
  },
});
