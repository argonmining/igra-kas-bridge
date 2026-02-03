import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
  },
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    exclude: ['./src/kaspa/kaspa.js'],
  },
});
