import { events } from '@engine/eventBus';
import { formatIncomePerSecond, formatMoney } from '@engine/format';
import type { Game } from '@engine/Game';
import { Modal } from './OfflineModal';
import { ObjectSheet } from './ObjectSheet';

/**
 * Композитор HTML-слоя: создаёт HUD, шторку и модалку, подписывает их
 * на события движка. Логики не содержит — только связывание и рендер.
 *
 * HUD показывает оба потока экономики:
 *  - P — пассивный доход в секунду;
 *  - A — доход за один тап.
 */
export class UIManager {
  readonly sheet: ObjectSheet;
  readonly modal: Modal;

  private balanceEl: HTMLElement;
  private passiveEl: HTMLElement;
  private activeEl: HTMLElement;
  private lastBalanceRendered: string | null = null;
  private lastPassiveRendered: string | null = null;
  private hudThrottle = 0;
  private unsubscribers: Array<() => void> = [];

  constructor(
    uiRoot: HTMLElement,
    private readonly game: Game,
  ) {
    // ---------- HUD ----------
    const hud = document.createElement('header');
    hud.className = 'hud-top';

    this.balanceEl = document.createElement('div');
    this.balanceEl.className = 'hud-balance';
    this.balanceEl.textContent = formatMoney(game.state.money);

    this.passiveEl = document.createElement('div');
    this.passiveEl.className = 'hud-income hud-passive';
    this.passiveEl.textContent = formatIncomePerSecond(game.state.passiveIncomePerSecond);

    this.activeEl = document.createElement('div');
    this.activeEl.className = 'hud-income hud-active';
    this.activeEl.textContent = `A: +${formatMoney(game.state.getMoneyPerTap())} за тап`;

    hud.append(this.balanceEl, this.passiveEl, this.activeEl);
    uiRoot.appendChild(hud);

    this.sheet = new ObjectSheet(uiRoot, game);
    this.modal = new Modal(uiRoot);

    // ---------- подписки ----------
    this.unsubscribers.push(
      events.on('tick', () => this.onTick()),
      events.on('tap:earned', () => this.forceHud()),
      events.on('object:levelup', () => this.forceHud()),
    );
  }

  private onTick(): void {
    // Троттлинг HUD: перерисовка баланса ~4 раза/сек.
    // Шторка обновляется только пока открыта — в закрытом состоянии её не видно.
    this.hudThrottle += 1;
    if (this.hudThrottle % 15 === 0) this.renderHud();
    if (this.sheet.isOpen()) this.sheet.refresh();
  }

  private forceHud(): void {
    this.lastBalanceRendered = null; // форс-перерисовка
    this.lastPassiveRendered = null;
    this.renderHud();
  }

  private renderHud(): void {
    const state = this.game.state;

    const moneyStr = formatMoney(state.money);
    if (moneyStr !== this.lastBalanceRendered) {
      this.balanceEl.textContent = moneyStr;
      this.lastBalanceRendered = moneyStr;
    }

    const passiveStr = formatIncomePerSecond(state.passiveIncomePerSecond);
    if (passiveStr !== this.lastPassiveRendered) {
      this.passiveEl.textContent = passiveStr;
      this.lastPassiveRendered = passiveStr;
    }

    // Активный поток меняется только при смене уровней — пишется на forceHud.
    this.activeEl.textContent = `A: +${formatMoney(state.getMoneyPerTap())} за тап`;
  }

  destroy(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }
}
