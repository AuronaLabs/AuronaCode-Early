import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./Src/Test/setup.ts"],
    include: ["Src/**/*.test.{ts,tsx}"],
    clearMocks: true,
  },
});
