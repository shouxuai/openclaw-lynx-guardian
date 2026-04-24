import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/webview/",
  plugins: [
    {
      name: "lynx-webview-base-path-compat",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          const requestUrl = request.url ?? "";
          if (requestUrl === "/webview" || requestUrl.startsWith("/webview?")) {
            request.url = `/webview/${requestUrl.slice("/webview".length)}`;
          }
          next();
        });
      },
    },
    react(),
  ],
  server: {
    host: "127.0.0.1",
    port: 4173,
    proxy: {
      "/lynx": "http://127.0.0.1:18789",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
