import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true, // Bind to 0.0.0.0 for devcontainer access
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
