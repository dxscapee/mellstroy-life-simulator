import { events } from '@engine/eventBus';
import { formatCount, formatMoney, formatIncomePerSecond } from '@engine/format';
import { WORLD_ERA_NAMES, WORLD_VEGETATION_NAMES } from '@data/worldStages';
import { worldProgressFrac } from '@engine/WorldProgress';
import type { Game } from '@engine/Game';
import { Modal } from './OfflineModal';
import { ObjectSheet } from './ObjectSheet';
import { EraPopup } from './EraPopup';

/** Геометрия кольца прогресса мира (viewBox 60×60). */
const WORLD_RING_R = 26;

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
  /** Чип эпохи мира: имя эпохи + прогресс к следующей. Клик — галерея. */
  private eraChip: HTMLButtonElement;
  private eraNameEl: HTMLElement;
  private eraNextEl: HTMLElement;
  private eraPopup: EraPopup;
  private lastEraKey: string | null = null;
  /** Кольцо прогресса мира (слева сверху) + его SVG-дуга и % внутри. */
  private worldRing: HTMLButtonElement;
  private worldRingFg: SVGCircleElement;
  private worldRingPct: HTMLElement;
  private lastWorldPct = -1;
  private readonly worldRingC: number;
  /** Кнопка настроек (пока заглушка — сюда лягут графика/звук). */
  private settingsBtn: HTMLButtonElement;
  private lastBalanceRendered: string | null = null;
  private lastPassiveRendered: string | null = null;
  private lastActiveRendered: string | null = null;
  private lastSubKey: string | null = null;
  private hudThrottle = 0;
  private worldThrottle = 0;
  private unsubscribers: Array<() => void> = [];

  constructor(
    uiRoot: HTMLElement,
    private readonly game: Game,
  ) {
    this.worldRingC = 2 * Math.PI * WORLD_RING_R;
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

    // ---------- кольцо прогресса мира (слева от HUD, по мокапу владельца) ----------
    // Круговая SVG-шкала: заполняется по ходу текущего периода мира, % внутри.
    // Обновление ~12 раз/с (отдельный троттлинг, чаще HUD) от живой дроби
    // worldProgressFrac(totalEarned) — кэш WorldWatch «заморожен» между сменами.
    this.worldRing = document.createElement('button');
    this.worldRing.className = 'world-ring js-interactive';
    this.worldRing.type = 'button';
    this.worldRing.title = 'Прогресс эпохи мира';

    const NS = 'http://www.w3.org/2000/svg';
    const ringSvg = document.createElementNS(NS, 'svg');
    ringSvg.setAttribute('viewBox', '0 0 60 60');
    ringSvg.classList.add('world-ring-svg');
    const ringBg = document.createElementNS(NS, 'circle');
    ringBg.setAttribute('cx', '30');
    ringBg.setAttribute('cy', '30');
    ringBg.setAttribute('r', String(WORLD_RING_R));
    ringBg.classList.add('world-ring-bg');
    this.worldRingFg = document.createElementNS(NS, 'circle');
    this.worldRingFg.setAttribute('cx', '30');
    this.worldRingFg.setAttribute('cy', '30');
    this.worldRingFg.setAttribute('r', String(WORLD_RING_R));
    this.worldRingFg.classList.add('world-ring-fg');
    this.worldRingFg.style.strokeDasharray = String(this.worldRingC);
    this.worldRingFg.style.strokeDashoffset = String(this.worldRingC);
    ringSvg.append(ringBg, this.worldRingFg);

    this.worldRingPct = document.createElement('span');
    this.worldRingPct.className = 'world-ring-pct';
    this.worldRingPct.textContent = '0%';

    this.worldRing.append(ringSvg, this.worldRingPct);
    // Окно кольца — прежний попап-галерея эпох (продумать функционал позже,
    // по ТЗ владельца «может остаться прежней»).
    this.worldRing.addEventListener('click', () => this.eraPopup.toggle());
    uiRoot.appendChild(this.worldRing);

    // ---------- кнопка настроек (справа сверху, заглушка под будущий функционал) ----------
    this.settingsBtn = document.createElement('button');
    this.settingsBtn.className = 'settings-btn js-interactive';
    this.settingsBtn.type = 'button';
    this.settingsBtn.title = 'Настройки';
    this.settingsBtn.setAttribute('aria-label', 'Настройки');
    this.settingsBtn.textContent = '⚙';
    this.settingsBtn.addEventListener('click', () => {
      // Пока пусто: здесь откроется панель настроек (графика/звук и т.д.).
    });
    uiRoot.appendChild(this.settingsBtn);

    // ---------- чип эпохи мира (пятая ячейка HUD, под сеткой 2×2) ----------
    // Клик = попап-галерея стадий. Смена эпохи приходит событием world:changed.
    this.eraChip = document.createElement('button');
    this.eraChip.className = 'era-chip js-interactive';
    this.eraChip.type = 'button';

    const eraIcon = document.createElement('span');
    eraIcon.className = 'era-icon';
    eraIcon.textContent = '🌍';

    this.eraNameEl = document.createElement('span');
    this.eraNameEl.className = 'era-name';
    this.eraNameEl.textContent = WORLD_ERA_NAMES[0];

    this.eraNextEl = document.createElement('span');
    this.eraNextEl.className = 'era-next';
    this.eraNextEl.textContent = '';

    this.eraChip.append(eraIcon, this.eraNameEl, this.eraNextEl);
    this.eraChip.addEventListener('click', () => this.eraPopup.toggle());
    // Пятая ячейка ВНУТРИ сетки HUD (grid-column 1/-1 — третья строка блока).
    this.eraPopup = new EraPopup(uiRoot, game.worldWatch);
    hud.appendChild(this.eraChip);

    this.sheet = new ObjectSheet(uiRoot, game);
    this.modal = new Modal(uiRoot);

    this.renderHud();
    this.renderSubscribers(true);
    this.renderWorldRing();

    // ---------- подписки ----------
    this.unsubscribers.push(
      events.on('tick', () => this.onTick()),
      events.on('tap:earned', () => this.forceHud()),
      events.on('object:levelup', () => this.forceHud()),
      events.on('subscribers:changed', () => this.renderSubscribers()),
      events.on('subscribers:ready', () => this.renderSubscribers()),
      // Смена периода мира: чип мигает, подпись обновляется; попап обновит сам себя.
      events.on('world:changed', () => {
        this.lastEraKey = null;
        this.renderEraChip();
        this.eraChip.classList.remove('evolved');
        void this.eraChip.offsetWidth; // рестарт CSS-анимации
        this.eraChip.classList.add('evolved');
      }),
      // Полный сброс (дебаг): HUD и подписчики могут не измениться по ключам — рендерим принудительно.
      events.on('game:reset', () => {
        this.lastSubKey = null;
        this.lastEraKey = null;
        this.lastWorldPct = -1;
        this.forceHud();
        this.renderWorldRing();
      }),
    );

    this.renderEraChip();
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
    if (this.hudThrottle % 15 === 0) {
      this.renderHud();
      this.renderEraChip();
    }
    // Кольцо прогресса мира — чаще HUD (~12 раз/с): владелец хочет заметного
    // живого хода процента. Пишем в DOM только при смене целого %.
    this.worldThrottle += 1;
    if (this.worldThrottle % 5 === 0) this.renderWorldRing();
    if (this.sheet.isOpen()) this.sheet.refresh();
    if (this.eraPopup.isOpenState()) this.eraPopup.refresh();
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

  /** Кольцо прогресса: живая дробь периода мира, DOM — только при смене целого %. */
  private renderWorldRing(): void {
    const pct = Math.floor(worldProgressFrac(this.game.state.totalEarned) * 100);
    if (pct === this.lastWorldPct) return;
    this.lastWorldPct = pct;

    // stroke-dashoffset: полный круг при pct=100. CSS transition — плавный ход.
    this.worldRingFg.style.strokeDashoffset = String(
      this.worldRingC * (1 - pct / 100),
    );
    this.worldRingPct.textContent = `${pct}%`;
  }

  /** Чип эпохи: «имя эпохи · фаза растительности · N% к следующей». */
  private renderEraChip(): void {
    const s = this.game.worldWatch.stage;
    const vegName = WORLD_VEGETATION_NAMES[
      Math.min(s.period, WORLD_VEGETATION_NAMES.length - 1)
    ];
    // Живая дробь периода (кэш WorldWatch заморожен между сменами) —
    // текст чипа ходит синхронно с кольцом слева.
    const pct = Math.floor(worldProgressFrac(this.game.state.totalEarned) * 100);
    const nextLabel = s.period >= WORLD_VEGETATION_NAMES.length - 1
      ? 'макс. эпоха'
      : `далее ${WORLD_VEGETATION_NAMES[s.period + 1]} · ${pct}%`;

    const key = `${s.period}|${pct}`;
    if (key === this.lastEraKey) return;
    this.lastEraKey = key;

    this.eraNameEl.textContent = WORLD_ERA_NAMES[s.era];
    this.eraNextEl.textContent = `${vegName} · ${nextLabel}`;
  }

  destroy(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }
}
