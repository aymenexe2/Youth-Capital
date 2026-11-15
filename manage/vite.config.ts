import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Organisation-management app. Talks to the same backend as the public site
// (VITE_API_URL in production; proxied /api in development).
const port = Number(process.env.PORT) || 5175;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port,
    host: "0.0.0.0",
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: true } },
    fs: { strict: true, deny: ["**/.*"] },
  },
  preview: { port, host: "0.0.0.0" },
});
