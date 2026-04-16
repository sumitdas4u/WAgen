import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || "/",
  server: {
    port: 8080,
    strictPort: true
  },
  preview: {
    port: 8080,
    strictPort: true
  }
});
