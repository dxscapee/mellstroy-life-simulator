import '@debug/debugPanel.css';
import Decimal from 'break_infinity.js';
import type { Game } from '@engine/Game';
import { gameConfig } from '@data/gameConfig';
import { objectDefs } from '@data/objects';
import { formatNumber } from '@engine/format';

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
 *
 * Раскладка (по скетчу владельца): группа «Баланс» [поле|×10|×100|$],
 * группа «Per second» [поле|×10|×100|$], Отменить, +1 lvl, скорость,
 * Сброс, большие логи.
 */

const PANEL_ID = 'debug-panel';

let panelEl: HTMLElement | null = null;
let speedButtons: HTMLButtonElement[] = [];
let logListEl: HTMLElement | null = null;
let undoBtn: HTMLButtonElement | null = null;

/** Глубина истории логов панели (строк). */
const LOG_HISTORY = 200;
/** Ожидает маркер разрыва истории (после сброса) — ставится первым логом. */
let wrapPending = false;

/** Отменяемое действие: подпись + замыкание отката. */
type DebugAction = { label: string; undo: () => void };
const undoStack: DebugAction[] = [];
/** Глубина отката: максимум 10 последних действий (LIFO, по одному за нажатие). */
const UNDO_LIMIT = 10;

export function setupDebugPanel(game: Game): void {
  if (document.getElementById(PANEL_ID)) return;

  panelEl = document.createElement('div');
  panelEl.id = PANEL_ID;

  const title = document.createElement('h3');
  title.textContent = 'DEBUG ~';

  // ============ Группа «Баланс»: [поле][×10][×100][$] ============
  const balanceLabel = mkLabel('Баланс');
  const moneyRow = document.createElement('div');
  moneyRow.className = 'row';
  const moneyInput = mkInput('1M');
  const addMoneyBtn = mkBtn('$', () => {
    const amount = parseDebugAmount(moneyInput.value);
    if (!amount) {
      log('Не понял сумму. Примеры: 1M, 2.5B, 1e623', 'warn');
      return;
    }
    const moneyBefore = game.state.money;
    const totalBefore = game.state.totalEarned;
    game.state.addMoney(amount);
    log(`Начислено ${formatNumber(amount)}$`, 'ok');
    pushUndo(`деньги +${formatNumber(amount)}$`, () => {
      // Полный откат: и баланс, и totalEarned (стадии мира откатятся тиком).
      game.state.money = Decimal.max(moneyBefore, gameConfig.startingMoney);
      game.state.totalEarned = Decimal.max(totalBefore, new Decimal(0));
      game.refreshAfterDebug();
      log(`Откат денег: −${formatNumber(amount)}$`);
    });
  });
  moneyRow.append(moneyInput, ...mkMultButtons(moneyInput), addMoneyBtn);

  // ============ Группа «Per second»: [поле][×10][×100][$] ============
  const tapLabel = mkLabel('Per second');
  const tapRow = document.createElement('div');
  tapRow.className = 'row';
  const tapInput = mkInput('1000');
  const tapOverrideBtn = mkBtn('$', () => {
    if (game.state.isTapOverridden()) {
      game.state.setTapOverride(null);
      tapOverrideBtn.classList.remove('active-forced');
      log('Форс тапа снят — обычная формула весов');
      return;
    }
    const amount = parseDebugAmount(tapInput.value);
    if (!amount) {
      log('Не понял сумму тапа. Примеры: 1000, 1e5, 2.5B', 'warn');
      return;
    }
    game.state.setTapOverride(amount);
    tapOverrideBtn.classList.add('active-forced');
    log(`Тап форсирован: ${formatNumber(amount)}$/клик (повторный $ — снять)`, 'ok');
  });
  tapOverrideBtn.title = 'Вкл/выкл форс тапа';

  // Живое применение форса: пока он активен, правка поля или ×10/×100 сразу
  // меняет форс — повторное «$» не нужно. Некорректный ввод игнорируется тихо
  // (форс остаётся прежним), итог логируем на change (blur/Enter), а не на каждый символ.
  const applyLiveTapForce = (amount: Decimal | null): void => {
    if (amount && game.state.isTapOverridden()) game.state.setTapOverride(amount);
  };
  tapInput.addEventListener('input', () => applyLiveTapForce(parseDebugAmount(tapInput.value)));
  tapInput.addEventListener('change', () => {
    if (!game.state.isTapOverridden()) return;
    const amount = parseDebugAmount(tapInput.value);
    if (amount) log(`Тап форсирован: ${formatNumber(amount)}$/клик`, 'ok');
  });
  tapRow.append(tapInput, ...mkMultButtons(tapInput, applyLiveTapForce), tapOverrideBtn);

  // ============ Отменить (полная ширина) ============
  undoBtn = mkBtn('↩ Отменить', () => {
    const action = undoStack.pop();
    if (!action) {
      log('Нечего отменять', 'warn');
      return;
    }
    action.undo();
    refreshUndoButton();
  });
  undoBtn.disabled = true;
  refreshUndoButton();

  // ============ +1 lvl (полная ширина) ============
  const lvlAllBtn = mkBtn('+1 lvl всем', () => {
    const before: Record<string, number> = {};
    for (const o of objectDefs) before[o.id] = o.currentLevel;
    const levels: Record<string, number> = {};
    for (const o of objectDefs) {
      levels[o.id] = Math.min(o.maxLevel, o.currentLevel + 1);
    }
    game.state.applyLevels(levels);
    log('Всем объектам +1 уровень', 'ok');
    pushUndo('+1 lvl всем', () => {
      game.state.applyLevels(before);
      log('Откат: уровни восстановлены');
    });
  });

  // ============ Скорость (x1 выбрана по умолчанию) ============
  const speedRow = document.createElement('div');
  speedRow.className = 'row';
  speedButtons = [];
  for (const scale of gameConfig.debug.timeScales) {
    const b = mkBtn(`x${scale}`, () => {
      game.setTimeScale(scale);
      refreshSpeedHighlight(scale);
      log(`Скорость времени: x${scale}`);
    });
    speedButtons.push(b);
    speedRow.appendChild(b);
  }
  game.setTimeScale(1);
  refreshSpeedHighlight(1);

  // ============ Сброс (полная ширина) ============
  let resetArmed = false;
  let resetDisarmTimer = 0;
  const resetBtn = mkBtn('Сброс', () => {
    if (!resetArmed) {
      resetArmed = true;
      resetBtn.textContent = 'Точно? (ещё раз)';
      resetBtn.classList.add('danger');
      resetDisarmTimer = window.setTimeout(() => {
        resetArmed = false;
        resetBtn.textContent = 'Сброс';
        resetBtn.classList.remove('danger');
      }, 3000);
      return;
    }
    clearTimeout(resetDisarmTimer);
    resetArmed = false;
    resetBtn.textContent = 'Сброс';
    resetBtn.classList.remove('danger');
    game.resetAll();
    // resetProgress чистит форс в модели — синхронизируем кнопку $ тапа.
    tapOverrideBtn.classList.remove('active-forced');
    undoStack.length = 0; // после сброса откатывать нечего
    refreshUndoButton();
    wrapPending = true; // следующий лог отделит историю до сброса
    log('Сейв сброшен', 'warn');
  });

  // ============ Логи (большая область) ============
  logListEl = document.createElement('div');
  logListEl.className = 'log-list';
  logListEl.textContent = '';

  // --- скрытая кнопка-точка в углу ---
  const cornerDot = document.createElement('button');
  cornerDot.className = 'debug-corner-dot';
  cornerDot.title = 'Debug panel (~)';
  cornerDot.addEventListener('click', toggle);
  document.body.appendChild(cornerDot);

  panelEl.append(
    title,
    balanceLabel,
    moneyRow,
    tapLabel,
    tapRow,
    undoBtn,
    lvlAllBtn,
    speedRow,
    resetBtn,
    logListEl,
  );
  document.body.appendChild(panelEl);

  window.addEventListener('keydown', onKeydown);

  log('Панель готова: ~ или точка в углу. Суммы: 1M, 2.5B, 1e623');
}

// -------------------------------------------------------------- действия

/**
 * Кнопки ×10/×100 для конкретного поля: умножают его значение на месте.
 * onAfterChange — необязательный хук live-применения (форс тапа использует его,
 * чтобы множители сразу обновляли активный форс без повторного «$»).
 */
function mkMultButtons(
  input: HTMLInputElement,
  onAfterChange?: (next: Decimal) => void,
): HTMLButtonElement[] {
  return [10, 100].map((mult) =>
    mkBtn(`×${mult}`, () => {
      const current = parseDebugAmount(input.value);
      if (!current) {
        log('Сначала корректная сумма: 1M, 2.5B…', 'warn');
        return;
      }
      const next = current.mul(mult);
      input.value = formatNumber(next); // человекочитаемый вид: 10M, 500M…
      onAfterChange?.(next);
      log(`Сумма ×${mult}: ${formatNumber(next)}$`);
    }),
  );
}

/** Запомнить действие для «↩ Отменить» (стек ограничен, LIFO). */
function pushUndo(label: string, undo: () => void): void {
  undoStack.push({ label, undo });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  refreshUndoButton();
}

function refreshUndoButton(): void {
  if (!undoBtn) return;
  const last = undoStack[undoStack.length - 1];
  undoBtn.disabled = undoStack.length === 0;
  undoBtn.textContent = last ? `↩ ${last.label}` : '↩ Отменить';
}

// ------------------------------------------------------------------- лог

/** Лог панели: строка в списке + дубль в консоль (единая точка). */
function log(text: string, cls: 'info' | 'ok' | 'warn' = 'info'): void {
  if (logListEl) {
    // После сброса — маркер: всё, что выше, — история до сброса (приглушена CSS).
    if (wrapPending) {
      wrapPending = false;
      const marker = document.createElement('div');
      marker.className = 'log-wrap-marker';
      marker.textContent = '— история до сброса —';
      logListEl.appendChild(marker);
      if (logListEl.childElementCount > LOG_HISTORY + 1) logListEl.firstChild?.remove();
    }
    // Прилипание к низу: автоскролл только если читатель и так у низа —
    // прокрутил историю вверх, чтобы почитать — новые строки его не дёргают.
    const stick = logListEl.scrollHeight - logListEl.scrollTop - logListEl.clientHeight < 24;
    const line = document.createElement('div');
    line.className = `log-line ${cls}`;
    const t = new Date();
    const hh = `${t.getHours()}`.padStart(2, '0');
    const mm = `${t.getMinutes()}`.padStart(2, '0');
    const ss = `${t.getSeconds()}`.padStart(2, '0');
    line.textContent = `${hh}:${mm}:${ss}  ${text}`;
    logListEl.appendChild(line); // новые снизу, как в консоли — историю листаем вверх
    while (logListEl.childElementCount > LOG_HISTORY) {
      logListEl.firstChild?.remove();
    }
    if (stick) logListEl.scrollTop = logListEl.scrollHeight;
  }
  if (cls === 'warn') console.warn(`[Debug] ${text}`);
  else console.info(`[Debug] ${text}`);
}

// ------------------------------------------------------------ утилиты

/**
 * Разбор суммы в человекочитаемой нотации: '1M', '2.5B', '1e623', '1000'.
 * Суффиксы — те же, что в format.ts (K/M/B/T/aa…), плюс чистая экспонента.
 */
function parseDebugAmount(raw: string): Decimal | null {
  let s = raw.trim().replace(',', '.').replace(/\s+/g, '');
  if (s === '') return null;

  // Чистая экспонента или голое число — Decimal понимает сам.
  if (/^\d+(\.\d+)?(e\+?\d+)?$/i.test(s)) {
    const d = new Decimal(s);
    return d.gt(0) ? d : null;
  }

  // Суффикс: отделяем мантиссу и множитель 1000^индекс.
  const m = /^(\d+(?:\.\d+)?)([a-zA-Z]+)$/.exec(s);
  if (!m) return null;
  const mantissa = new Decimal(m[1]);
  const suffix = m[2].toLowerCase();
  const suffixes = ['', 'k', 'm', 'b', 't', 'aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag', 'ah', 'ai', 'aj'];
  const idx = suffixes.indexOf(suffix);
  if (idx < 0) return null;
  const d = mantissa.mul(new Decimal(10).pow(idx * 3));
  return d.gt(0) ? d : null;
}

function onKeydown(e: KeyboardEvent): void {
  // "`"/"~"/Backquote — но НЕ когда фокус в поле ввода панели.
  const inPanelInput = (e.target as HTMLElement | null)?.closest?.('#debug-panel input');
  if (inPanelInput) return;
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

function mkLabel(text: string): HTMLElement {
  const l = document.createElement('div');
  l.className = 'section-label';
  l.textContent = text;
  return l;
}

function mkInput(initial: string): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text';
  i.value = initial;
  i.spellcheck = false;
  i.autocomplete = 'off';
  return i;
}
