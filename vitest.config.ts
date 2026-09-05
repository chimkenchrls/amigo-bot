import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
    env: {
      DISCORD_TOKEN: "test-token",
      DISCORD_APP_ID: "test-app",
      GEMINI_API_KEY: "test-key",
    },
  },
});
