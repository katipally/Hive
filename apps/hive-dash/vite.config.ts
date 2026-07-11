import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:4800",
      "/ws/dash": { target: "ws://localhost:4800", ws: true },
      // read live channel health straight from the bee runtime for honest status
      "/bee-api": { target: "http://localhost:4801", rewrite: (p) => p.replace(/^\/bee-api/, "/api") },
    },
  },
});
