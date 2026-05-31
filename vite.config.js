import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Allows mobile devices on the same Wi-Fi network to connect
    port: 5173,
    strictPort: true
  }
});
