import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL("../dist/web", import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    // The API accepts writes only from its own origin, so the proxy presents that origin. With CORS off,
    // other localhost sites cannot pass a preflight to reach the proxy.
    cors: false,
    proxy: Object.fromEntries(
      ["/api", "/files/", "/mounts/", "/t/"].map((path) => [path, { target: "http://127.0.0.1:4710", changeOrigin: true, headers: { origin: "http://127.0.0.1:4710" } }]),
    ),
  },
});
