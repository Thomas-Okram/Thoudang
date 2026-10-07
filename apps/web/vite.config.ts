import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// API_PORT lets several checkouts run side by side; the default matches apps/api.
const apiPort = process.env.API_PORT ?? '3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    // Listen on the LAN so phones on the same Wi-Fi can reach the intake page (Phase 4 QR upload).
    host: '0.0.0.0',
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
});
