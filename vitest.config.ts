import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// 与 vite.config.ts 保持一致：测试环境同样注入应用版本号
const appVersion = (
  JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./Src/Test/setup.ts"],
    include: ["Src/**/*.test.{ts,tsx}", "Tests/**/*.test.{ts,tsx}"],
    clearMocks: true,
  },
});
