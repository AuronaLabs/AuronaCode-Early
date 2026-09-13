import { readFileSync } from "node:fs";
import React from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// 单一来源：应用版本号永远从 package.json 读取，避免前端出现硬编码副本而随版本漂移
const appVersion = (
  JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

export default defineConfig({
  plugins: [React(), tailwindcss()],
  clearScreen: false,
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    outDir: "Dist",
    minify: "esbuild",
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: "index.html",
        splash: "splash.html",
      },
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          xterm: ["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-web-links", "@xterm/addon-webgl"],
          icons: ["@tabler/icons-react"]
        }
      }
    }
  },
  esbuild: {
    drop: ["console", "debugger"],
  },
});
