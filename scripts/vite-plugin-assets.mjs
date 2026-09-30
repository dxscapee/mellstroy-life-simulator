/**
 * VITE-ПЛАГИН АВТОСБОРКИ АССЕТОВ (см. ASSETS.md).
 *
 * dev:   один тихий прогон на старте + слежение за art/ → пересборка
 *        (scripts/build-assets.mjs) → full-reload страницы. Так «положил файл
 *        в art/ — через секунду текстура в игре» работает без вторых рук.
 * build: один прогон перед сборкой, чтобы dist/ уезжал на площадку со свежими
 *        ассетами (при отсутствии art/ или sharp — тихо ничего не делает).
 *
 * Плагин никогда не валит dev и build: проблемы уходят в консоль как ошибки
 * сборки ассетов, игра при этом остаётся на заглушках.
 */

import { resolve } from 'node:path';
import { buildAssets } from './build-assets.mjs';

const PREFIX = '[assets]';
const DEBOUNCE_MS = 300;

export function assetsPlugin() {
  let mode = 'build';
  /** @type {import('vite').ViteDevServer | null} */
  let server = null;
  let timer = null;
  let running = false;
  let queued = false;

  const printIssues = (result) => {
    for (const warning of result.warnings) console.warn(`${PREFIX} ! ${warning}`);
    if (!result.ok) {
      for (const error of result.errors) console.error(`${PREFIX} ОШИБКА: ${error}`);
    }
  };

  const run = async ({ initial = false } = {}) => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      const result = await buildAssets({ quiet: true });
      printIssues(result);
      if (result.changed && !initial && server) {
        console.log(`${PREFIX} ассеты обновлены — перезагружаю страницу`);
        server.ws.send({ type: 'full-reload' });
      }
    } catch (err) {
      console.warn(`${PREFIX} сборка не удалась: ${err?.message ?? err}`);
    } finally {
      running = false;
      if (queued) {
        queued = false;
        schedule();
      }
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, DEBOUNCE_MS);
  };

  return {
    name: 'scene-assets-pipeline',
    configResolved(config) {
      mode = config.command;
    },
    async buildStart() {
      if (mode === 'build') await run({ initial: true });
    },
    configureServer(devServer) {
      server = devServer;
      void (async () => {
        await run({ initial: true });
        const artRoot = resolve(devServer.config.root, 'art');
        devServer.watcher.add(artRoot);
        devServer.watcher.on('all', (_event, file) => {
          const normalized = String(file).split('\\').join('/');
          if (normalized.includes('/art/')) schedule();
        });
        console.log(`${PREFIX} слежу за art/: положил или изменил файл — пересборка и перезагрузка сами`);
      })();
    },
  };
}
