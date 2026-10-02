import './ui/styles.css';

import { events } from '@engine/eventBus';
import { Game } from '@engine/Game';
import { formatMoney } from '@engine/format';
import { yandexService } from '@services/yandex';
import { buildSceneState } from '@data/objects';
import {
  assetGroupOf,
  CHARACTER_ASSET_GROUP,
  CHARACTER_ASSET_STAGE,
  WORLD_ASSET_GROUP,
} from '@data/assets';
import { GameView } from '@view/GameView';
import { AssetRegistry } from '@view/assetRegistry';
import { UIManager } from '@ui/UIManager';
import { BootScreen } from '@ui/BootScreen';

const canvasHost = document.getElementById('canvas-host')!;
const uiRoot = document.getElementById('ui-root')!;

let game: Game | null = null;
/** Сцена — нужна дебаг-панели (кнопка подписей объектов), только в DEV. */
let scene: GameView | null = null;

/**
 * Ключи стартового набора: фон текущей эпохи, тело игрока и текстуры всех
 * купленных сценовых объектов на их текущих стадиях. Ключи резолвятся реестром
 * (с откатом вниз), поэтому грузим ИМЕННО то, что будет показано. Это
 * происходит до LoadingAPI.ready() (загрузочный экран); остальное — лениво.
 */
function startupAssetKeys(assets: AssetRegistry): string[] {
  if (!game) return [];

  const keys: string[] = [];
  const characterKey = assets.resolveKey(CHARACTER_ASSET_GROUP, CHARACTER_ASSET_STAGE);
  if (characterKey) keys.push(characterKey);

  const worldKey = assets.resolveKey(WORLD_ASSET_GROUP, game.worldWatch.stage.era);
  if (worldKey) keys.push(worldKey);

  for (const state of buildSceneState()) {
    if (!state.owned) continue;
    const group = assetGroupOf(state.id);
    if (!group) continue;
    const key = assets.resolveKey(group, state.tier);
    if (key) keys.push(key);
  }
  return keys;
}

async function bootstrap(): Promise<void> {
  const boot = new BootScreen();

  // 1) Ядро: состояние + сейв + офлайн-доход (модалка уйдёт событием).
  game = new Game();

  // 2) Слой Pixi + рантайм-загрузчик текстур (манифест — assets/manifest.json).
  const assets = new AssetRegistry();
  const view = new GameView(canvasHost, assets, (x, y) => {
    const amount = game!.handleTap();
    view.spawnMoneyText(formatMoney(amount), x, y);
  });

  // SDK платформы грузится параллельно с ассетами; ready() скажем в конце.
  const platformReady = yandexService.init();

  await Promise.all([view.init(), assets.init()]);

  // 3) Стартовые текстуры — под загрузочным экраном.
  const keys = startupAssetKeys(assets);
  await assets.preload(keys, (done, total) => boot.setProgress(done, total));

  // Сцена отражает состояние объектов: тиры, владение тачкой, подписи стадий.
  view.applySceneState(buildSceneState());
  const refreshScene = () => view.applySceneState(buildSceneState());
  events.on('object:levelup', refreshScene);
  // Массовые изменения (applyLevels из дебага, загрузка сейва) — сцена перечитывает всё.
  events.on('objects:changed', refreshScene);

  // Мир: стадии применяются и на старте, и при смене периода (фон).
  view.applyWorldStage(game.worldWatch.stage.era);
  events.on('world:changed', ({ era }) => view.applyWorldStage(era));

  // 4) Слой UI. Превью эпох для галереи: URL фона из манифеста (ui про view не знает).
  const ui = new UIManager(uiRoot, game, (era) => {
    const key = assets.resolveKey(WORLD_ASSET_GROUP, era);
    const entry = key ? assets.entry(key) : null;
    return entry ? { url: entry.url, kind: entry.type } : null;
  });

  // Офлайн-модалка: подписка на будущее + учёт уже случившегося (событие
  // эмитится из конструктора Game раньше, чем UI успел подписаться).
  events.on('offline:income', ({ title, body }) => {
    ui.modal.show(title, body);
  });
  if (game.pendingOfflineModal) {
    ui.modal.show(game.pendingOfflineModal.title, game.pendingOfflineModal.body);
  }

  // 5) Платформа: LoadingAPI.ready() только когда игра одета и собрана.
  await platformReady;
  yandexService.gameplayStart();

  // 6) Игровой цикл запускаем последним — когда всё готово принимать тики.
  game.loop.start();
  boot.hide();

  // Доступ из консоли для ручных экспериментов — только в dev
  // (в проде ветка мертва; см. ASSETS.md, раздел про отладку ассетов).
  if (import.meta.env.DEV) {
    const handles = window as unknown as Record<string, unknown>;
    handles.game = game;
    handles.assets = assets;
    handles.scene = view;
    scene = view; // для дебаг-панели (в проде ветка мертва)
    console.info('%c[App] Игра запущена', 'color:#2ecc71;font-weight:bold');
  }
}

const appReady = bootstrap().catch((err) => {
  console.error('[App] Ошибка запуска:', err);
  document.body.innerHTML =
    '<p style="color:#fff;font-family:sans-serif;padding:20px">Не удалось запустить игру. Проверьте консоль.</p>';
});

// ============================================================
// ДЕБАГ-ПАНЕЛЬ: подключается ТОЛЬКО в dev-сборке.
// Rollup статически анализирует граф импортов: в проде ветка
// мертва, поэтому debugPanel.ts и его CSS не попадают в бандл.
// Требование zero-leakage: других ссылок на @debug в коде нет.
// ============================================================
if (import.meta.env.DEV) {
  void appReady.then(async () => {
    const { setupDebugPanel } = await import('@debug/debugPanel');
    if (game && scene) setupDebugPanel(game, scene);
  });
}
