import { defineConfig } from "vitest/config";
import { aliases } from "./config/aliases";
export default defineConfig({
  resolve: { alias: aliases },
  test: {
    include: ["tests/**/*.test.ts", "packages/core/src/**/*.test.ts"],
    maxWorkers: 2,
    testTimeout: 15000,
  },
});
