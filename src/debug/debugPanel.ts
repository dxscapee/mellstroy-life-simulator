import '@debug/debugPanel.css';
import Decimal from 'break_infinity.js';
import type { Game } from '@engine/Game';
import { gameConfig } from '@data/gameConfig';
import { objectDefs } from '@data/objects';
import { yandexService } from '@services/yandex';

/**
 * ДЕБАГ-ПАНЕЛЬ (только для dev).
 *
 * Этот модуль импортируется в main.ts исключительно внутри
 * `if (import.meta.env.DEV)` с динамическим импортом — Rollup/Vite
 * полностью вырезает его и его CSS из продакшен-сборки.
 *
 * ВАЖНО для zero-leakage:
 *  - нигде, кроме блока DEV, на него не должно быть статических ссылок;
 *  - прод-логика не должна знать о его существовании (общается только с Game).
 */

const PANEL_ID = 'debug-panel';

let panelEl: HTMLElement | null = null;
let speedButtons: HTMLButtonElement[] = [];

export function setupDebugPanel(game: Game): void {
  if (document.getElementById(PANEL_ID)) return;

  panelEl = document.createElement('div');
  panelEl.id = PANEL_ID;

  const title = document.createElement('h3');
  title.textContent = 'DEBUG ~';

  const addMoneyBtn = mkBtn('+ 1 000 000$', () => {
    game.state.addMoney(new Decimal(1_000_000));
    console.info('[Debug] Начислено 1 000 000$');
  });

  // Разблокировать и купить 1-й уровень всех объектов (проверка гейтов/тиров).
  const unlockAllBtn = mkBtn('Unlock all (lvl 1)', () => {
    const levels: Record<string, number> = {};
    for (const o of objectDefs) levels[o.id] = Math.max(1, o.currentLevel);
    game.state.applyLevels(levels);
    console.info('[Debug] Все объекты разблокированы (lvl 1)');
  });

  // Форс дохода за тап для проверки поздней экономики (цены, подписчики, тиры).
  // Переключатель: состояние читается из модели (isTapOverridden), повторный клик снимает.
  const LATE_TAP = 1_000;
  const tapOverrideBtn = mkBtn(`Тап = ${LATE_TAP}$ (форс)`, () => {
    if (game.state.isTapOverridden()) {
      game.state.setTapOverride(null);
      tapOverrideBtn.textContent = `Тап = ${LATE_TAP}$ (форс)`;
      tapOverrideBtn.classList.remove('active-forced');
      console.info('[Debug] Форс тапа снят — обычная формула весов');
    } else {
      game.state.setTapOverride(new Decimal(LATE_TAP));
      tapOverrideBtn.textContent = `Тап = ${LATE_TAP}$ (ВКЛ)`;
      tapOverrideBtn.classList.add('active-forced');
      console.info(`[Debug] Тап форсирован: ${LATE_TAP}$/клик (повторный клик — снять)`);
    }
  });

  // Сброс с инлайн-подтверждением (confirm() заблокирован в вебвью Яндекса).
  let resetArmed = false;
  let resetDisarmTimer = 0;
  const resetBtn = mkBtn('Сбросить сейв', () => {
    if (!resetArmed) {
      resetArmed = true;
      resetBtn.textContent = 'Точно? (ещё раз)';
      resetBtn.classList.add('danger');
      resetDisarmTimer = window.setTimeout(() => {
        resetArmed = false;
        resetBtn.textContent = 'Сбросить сейв';
        resetBtn.classList.remove('danger');
      }, 3000);
      return;
    }
    clearTimeout(resetDisarmTimer);
    resetArmed = false;
    resetBtn.textContent = 'Сбросить сейв';
    resetBtn.classList.remove('danger');
    game.resetAll();
    // resetProgress чистит форс в модели — синхронизируем кнопку.
    tapOverrideBtn.textContent = `Тап = ${LATE_TAP}$ (форс)`;
    tapOverrideBtn.classList.remove('active-forced');
    console.info('[Debug] Сейв сброшен');
  });

  // --- ускорение времени ---
  const speedRow = document.createElement('div');
  speedRow.className = 'row';
  speedButtons = [];
  for (const scale of gameConfig.debug.timeScales) {
    const b = mkBtn(`x${scale}`, () => {
      game.setTimeScale(scale);
      refreshSpeedHighlight(scale);
      console.info(`[Debug] Скорость времени: x${scale}`);
    });
    speedButtons.push(b);
    speedRow.appendChild(b);
  }

  // --- тест рекламы ---
  const rewardedBtn = mkBtn('Rewarded (тест)', async () => {
    console.info('[Debug] Запуск теста Rewarded…');
    const result = await yandexService.showRewardedVideo();
    if (result === 'rewarded') {
      game.state.addMoney(new Decimal(10_000));
      console.info('[Debug] Награда выдана: +10 000$ (тестовая)');
    } else {
      console.info(`[Debug] Rewarded завершён без награды: ${result}`);
    }
  });

  const fullscreenBtn = mkBtn('Fullscreen adv (тест)', async () => {
    const shown = await yandexService.showFullscreenAdv();
    console.info(`[Debug] showFullscreenAdv: wasShown=${shown}`);
  });

  // --- скрытая кнопка-точка в углу ---
  const cornerDot = document.createElement('button');
  cornerDot.className = 'debug-corner-dot';
  cornerDot.title = 'Debug panel (~)';
  cornerDot.addEventListener('click', toggle);
  document.body.appendChild(cornerDot);

  panelEl.append(title, addMoneyBtn, unlockAllBtn, tapOverrideBtn, resetBtn, speedRow, rewardedBtn, fullscreenBtn);
  document.body.appendChild(panelEl);

  window.addEventListener('keydown', onKeydown);

  console.info(
    '[Debug] Панель готова: клавиша ~ (тильда) или точка в правом верхнем углу.\n' +
    'В продакшен-сборке этот модуль вырезается tree-shaking-ом.',
  );
}

function onKeydown(e: KeyboardEvent): void {
  // "`" и "~" (Shift+`), плюс ё для русской раскладки.
  if (e.key === '`' || e.key === '~' || e.code === 'Backquote') {
    e.preventDefault();
    toggle();
  }
}

function toggle(): void {
  panelEl?.classList.toggle('visible');
}

function refreshSpeedHighlight(active: number): void {
  const scales = gameConfig.debug.timeScales;
  speedButtons.forEach((b, i) => b.classList.toggle('debug-speed-active', scales[i] === active));
}

function mkBtn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
