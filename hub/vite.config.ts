import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port fixe : Tauri pointe dessus en dev (voir src-tauri/tauri.conf.json).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
});
