import './ui/styles.css';

import { events } from '@engine/eventBus';
import { Game } from '@engine/Game';
import { formatMoney } from '@engine/format';
import { yandexService } from '@services/yandex';
import { buildSceneState } from '@data/objects';
import { GameView } from '@view/GameView';
import { UIManager } from '@ui/UIManager';

const canvasHost = document.getElementById('canvas-host')!;
const uiRoot = document.getElementById('ui-root')!;

let game: Game | null = null;

async function bootstrap(): Promise<void> {
  // 1) Ядро: состояние + сейв + офлайн-доход (модалка уйдёт событием).
  game = new Game();

  // 2) Слой Pixi: тапы по холсту = активный доход.
  const view = new GameView(canvasHost, (x, y) => {
    const amount = game!.handleTap();
    view.spawnMoneyText(formatMoney(amount), x, y);
  });
  await view.init();

  // Сцена отражает состояние объектов: тиры, владение тачкой, подписи стадий.
  view.applySceneState(buildSceneState());
  const refreshScene = () => view.applySceneState(buildSceneState());
  events.on('object:levelup', refreshScene);
  // Массовые изменения (applyLevels из дебага, загрузка сейва) — сцена перечитывает всё.
  events.on('objects:changed', refreshScene);

  // Мир: стадии применяются и на старте, и при смене периода (фон).
  view.applyWorldStage(game.worldWatch.stage.era);
  events.on('world:changed', ({ era }) => view.applyWorldStage(era));

  // 3) Слой UI.
  const ui = new UIManager(uiRoot, game);

  // Офлайн-модалка: подписка на будущее + учёт уже случившегося (событие
  // эмитится из конструктора Game раньше, чем UI успел подписаться).
  events.on('offline:income', ({ title, body }) => {
    ui.modal.show(title, body);
  });
  if (game.pendingOfflineModal) {
    ui.modal.show(game.pendingOfflineModal.title, game.pendingOfflineModal.body);
  }

  // 4) Платформа: SDK + сигнал готовности.
  await yandexService.init();
  yandexService.gameplayStart();

  // 5) Игровой цикл запускаем последним — когда всё готово принимать тики.
  game.loop.start();

  // Доступ из консоли для ручных экспериментов — только в dev.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).game = game;
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
    if (game) setupDebugPanel(game);
  });
}
