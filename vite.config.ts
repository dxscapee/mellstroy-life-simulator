import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Алиасы зеркалят tsconfig paths — держим их синхронно.
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@data': r('src/data'),
      '@engine': r('src/engine'),
      '@view': r('src/view'),
      '@ui': r('src/ui'),
      '@services': r('src/services'),
      '@debug': r('src/debug'),
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
