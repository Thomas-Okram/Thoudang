import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Listen on the LAN so phones on the same Wi-Fi can reach the intake page (Phase 4 QR upload).
    host: true,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
