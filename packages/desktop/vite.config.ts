import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = new URL("../..", import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  envPrefix: ["VITE_", "CAPRICE_"],
  server: {
    port: 1420,
    strictPort: true,
    fs: {
      allow: [repoRoot],
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
