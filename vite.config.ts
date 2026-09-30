import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { assetsPlugin } from './scripts/vite-plugin-assets.mjs';

// Псевдонимы отражают tsconfig paths - держим их синхронно.
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  base: './',
  // Автосборка ассетов: dev — слежение за art/ + перезагрузка, build — свежий dist.
  plugins: [assetsPlugin()],
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
  server: {
    port: 5050,
    strictPort: true,
    open: true, // Автоматически открывает игру в браузере при запуске
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    // Бандл уезжает в dist/bundle/, а текстуры — в dist/assets/ (public/assets):
    // две разные сущности не смешиваются в одной папке.
    assetsDir: 'bundle',
  },
});
