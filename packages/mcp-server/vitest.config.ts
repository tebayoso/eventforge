import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/client.ts", "src/server.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        lines: 85,
        branches: 80,
      },
    },
  },
});
