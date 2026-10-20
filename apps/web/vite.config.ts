import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Proxy para /api evita problemas de cookies cross-site em dev: o navegador
// vê tudo como mesma origem (localhost:5173), e o Vite repassa para a API em :4000.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
