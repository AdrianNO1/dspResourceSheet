import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiOrigin = "http://127.0.0.1:3001";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": apiOrigin,
    },
  },
});
