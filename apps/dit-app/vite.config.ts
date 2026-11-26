import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/* `tauri.conf.json` names this port as `devUrl`; a taken port must fail rather
   than move, or the webview would load whatever is on the old one. */
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    /* Two pages: the panel, and the backfill window, which the app opens as a
     window of its own (`backfill_window.rs`). */
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        backfill: fileURLToPath(new URL("./backfill.html", import.meta.url)),
      },
    },
  },
});
