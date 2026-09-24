import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  test: { include: ['src/**/*.test.ts', 'tests/**/*.test.ts'] },
});
