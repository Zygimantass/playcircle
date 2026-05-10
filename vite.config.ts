import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  root: "src/frontend",
  publicDir: "../../public",
  build: {
    outDir: "../../dist",
    emptyOutDir: true
  },
  server: {
    port: 1420,
    strictPort: true
  }
});
