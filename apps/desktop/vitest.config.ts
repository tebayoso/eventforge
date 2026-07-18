import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      // Electron owns these integration entrypoints. Their behavior is covered by the packaged-app smoke test.
      exclude: ["src/main.ts", "src/preload.ts"],
      thresholds: { lines: 75, branches: 70 },
    },
  },
});
