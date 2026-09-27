import { events } from '@engine/eventBus';
import { formatCount, formatMoney, formatIncomePerSecond } from '@engine/format';
import type { Game } from '@engine/Game';
import { Modal } from './OfflineModal';
import { ObjectSheet } from './ObjectSheet';

/**
 * Композитор HTML-слоя: создаёт HUD, выноску и модалку, подписывает их
 * на события движка. Логики не содержит — только связывание и рендер.
 *
 * HUD — единый центральный блок 2×2 (не растягивается, как и нижнее меню):
 *   [пассив /сек]  [баланс $ всего]
 *   [тап /клик  ]  [подписчики + бар]
 */
export class UIManager {
  readonly sheet: ObjectSheet;
  readonly modal: Modal;

  private balanceEl: HTMLElement;
  private passiveEl: HTMLElement;
  private activeEl: HTMLElement;
  private subChip: HTMLButtonElement;
  private subBarFill: HTMLElement;
  private subCountEl: HTMLElement;
  private subGoalEl: HTMLElement;
  private lastBalanceRendered: string | null = null;
  private lastPassiveRendered: string | null = null;
  private lastActiveRendered: string | null = null;
  private lastSubKey: string | null = null;
  private hudThrottle = 0;
  private unsubscribers: Array<() => void> = [];

  constructor(
    uiRoot: HTMLElement,
    private readonly game: Game,
  ) {
    // ---------- HUD: центральный блок 2×2 ----------
    const hud = document.createElement('header');
    hud.className = 'hud-top';
    hud.appendChild(this.mkStat('пассив /сек', this.passiveEl = document.createElement('div')));
    hud.appendChild(this.mkStat('$ всего', this.balanceEl = document.createElement('div')));
    hud.appendChild(this.mkStat('за клик', this.activeEl = document.createElement('div')));

    // Правая нижняя ячейка: подписчики (клик = забрать награду).
    // Иконка вместо надписи — компактнее, всё влезает в ячейку.
    this.subChip = document.createElement('button');
    this.subChip.className = 'hud-cell sub-cell js-interactive';
    this.subChip.type = 'button';

    const subIcon = document.createElement('span');
    subIcon.className = 'sub-icon';
    subIcon.textContent = '👤';

    // Счёт и цель — РАЗНЫЕ элементы: цель не должна ломать счёт при нехватке места,
    // и всё прижато к иконке влево (не растягивается по ячейке).
    this.subCountEl = document.createElement('span');
    this.subCountEl.className = 'sub-count';
    this.subCountEl.textContent = '0';

    this.subGoalEl = document.createElement('span');
    this.subGoalEl.className = 'sub-goal';
    this.subGoalEl.textContent = '/ 0';

    const subTrack = document.createElement('div');
    subTrack.className = 'sub-track';
    this.subBarFill = document.createElement('div');
    this.subBarFill.className = 'sub-fill';
    subTrack.appendChild(this.subBarFill);

    const subTop = document.createElement('div');
    subTop.className = 'sub-top';
    subTop.append(subIcon, this.subCountEl, this.subGoalEl);
    this.subChip.append(subTop, subTrack);
    this.subChip.addEventListener('click', () => this.onSubChipClick());

    hud.appendChild(this.subChip);
    uiRoot.appendChild(hud);

    this.sheet = new ObjectSheet(uiRoot, game);
    this.modal = new Modal(uiRoot);

    this.renderHud();
    this.renderSubscribers(true);

    // ---------- подписки ----------
    this.unsubscribers.push(
      events.on('tick', () => this.onTick()),
      events.on('tap:earned', () => this.forceHud()),
      events.on('object:levelup', () => this.forceHud()),
      events.on('subscribers:changed', () => this.renderSubscribers()),
      events.on('subscribers:ready', () => this.renderSubscribers()),
      // Полный сброс (дебаг): HUD и подписчики могут не измениться по ключам — рендерим принудительно.
      events.on('game:reset', () => {
        this.lastSubKey = null;
        this.forceHud();
      }),
    );
  }

  private onSubChipClick(): void {
    const reward = this.game.claimSubscribers();
    if (reward) {
      console.info(`[UI] Награда подписчиков забрана: ${formatMoney(reward)}`);
    }
  }

  /** Ячейка-статистика: подпись сверху, значение снизу (значение заполняется renderHud). */
  private mkStat(caption: string, valueEl: HTMLElement): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'hud-cell';

    const cap = document.createElement('span');
    cap.className = 'cell-caption';
    cap.textContent = caption;

    valueEl.className = 'cell-value';

    cell.append(cap, valueEl);
    return cell;
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
    this.lastActiveRendered = null;
    this.renderHud();
    this.renderSubscribers();
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

    // Активный поток меняется только при смене уровней — но пишем по кэшу строки.
    const activeStr = '+' + formatMoney(state.getMoneyPerTap()) + '/клик';
    if (activeStr !== this.lastActiveRendered) {
      this.activeEl.textContent = activeStr;
      this.lastActiveRendered = activeStr;
    }
  }

  private renderSubscribers(force = false): void {
    const state = this.game.state;
    const s = state.subscribers;
    const goal = state.getSubscriberGoal();
    const pct = s.claimable ? 100 : Math.min(100, (s.progress / goal) * 100);
    // Ключ всех видимых величин: перезапись DOM только при изменениях.
    const key = `${s.count.toFixed(2)}|${pct.toFixed(2)}|${s.claimable}|${goal}`;
    if (!force && key === this.lastSubKey) return;
    this.lastSubKey = key;

    if (s.claimable) {
      this.subCountEl.textContent = `Забрать ${formatMoney(state.getSubscriberReward())}`;
      this.subGoalEl.style.display = 'none'; // вся строка — под награду
    } else {
      // Показываем текущее количество / целевое количество (count + недостающий прирост)
      const targetTotal = s.count + (goal - s.progress);
      this.subCountEl.textContent = formatCount(s.count);
      this.subGoalEl.style.display = '';
      this.subGoalEl.textContent = `/ ${formatCount(targetTotal)}`;
    }
    this.subBarFill.style.width = `${pct}%`;
    this.subChip.classList.toggle('claimable', s.claimable);
  }

  destroy(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }
}
