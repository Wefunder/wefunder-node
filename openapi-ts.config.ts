import { defineConfig } from "@hey-api/openapi-ts";

// Generates the typed layer ONLY (models + low-level request fns) into src/generated.
// This directory is never hand-edited — the hand-written shell in src/ wraps it.
export default defineConfig({
  input: "./spec/openapi.yaml",
  output: {
    path: "./src/generated",
    format: "prettier",
  },
  plugins: [
    { name: "@hey-api/client-fetch" },
    { name: "@hey-api/sdk", asClass: false },
    { name: "@hey-api/typescript", enums: "javascript" },
  ],
});
