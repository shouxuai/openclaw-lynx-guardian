import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: [
      "node_modules/**",
      ".worktrees/**",
      "test-temp/**",
      "dist/**",
      "server/**",
      "frontend/**",
      "backend/**",
    ],
    fileParallelism: false,
  },
});
