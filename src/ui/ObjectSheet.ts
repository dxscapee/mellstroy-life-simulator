import type Decimal from 'break_infinity.js';
import { gameConfig } from '@data/gameConfig';
import { getObject, groupMeta, groupOrder, objectsByGroup } from '@data/objects';
import type { Game } from '@engine/Game';
import { formatMoney } from '@engine/format';
import type { BuyMode, ObjectDef, ObjectGroup } from '@engine/types';

/**
 * Зажатие кнопки покупки. Пауза до первого повтора даёт юзеру отпустить после
 * ОДНОЙ покупки, дальше идёт серия; после HOLD_FREE_REPEATS шаг ускоряется —
 * длинная закупка не тянется вечно, но и проскочить легко не даёт.
 */
const HOLD_DELAY_MS = 420;
const HOLD_REPEAT_MS = 120;
const HOLD_FREE_REPEATS = 12;
const HOLD_REPEAT_FAST_MS = 70;
/** Пересчёт цены пачки (режим 'tier') — не чаще, чем раз в N тиков: Decimal не бесплатен. */
const TIER_PLAN_THROTTLE_TICKS = 15;

interface CardRefs {
  root: HTMLElement;
  /** Имя объекта: на уровне 0 — название, после покупки — стадия тира («Ноут», «Супер-ПК»). */
  nameEl: HTMLElement;
  /** Прогресс-бар эволюции: заполнение + подпись «ур. 7». */
  barFillEl: HTMLElement;
  barLabelEl: HTMLElement;
  /** ОБЩИЙ вклад объекта в доход: «+58$/т +0.05$/с» (строка под баром). */
  incomeEl: HTMLElement;
  buyBtn: HTMLButtonElement;
  def: ObjectDef;
  /** Кэш последнего отображённого состояния — пишем в DOM только при изменении. */
  shownLevel: number;
  shownAffordable: boolean;
  shownUnlocked: boolean;
  /** Подпись, уже показанная на кнопке покупки (в DOM пишем только при изменении). */
  shownBuyText: string;
  /** Цена следующего уровня — зависит только от уровня, пересчитывается при его смене. */
  cachedCost: Decimal;
}

/**
 * Выноска объектов по группам-вкладкам. DOM строится один раз из data/objects.ts,
 * дальше обновляются только динамические части.
 *
 * Схема карточки (по ТЗ): [иконка] [имя/стадия] [бар] [нижняя строка: ур. N + вклад] [кнопка].
 * Имя объекта после покупки заменяется НАЗВАНИЕМ СТАДИИ тира («Ноут» → «Монитор»);
 * уровень живёт в подписи под баром, рядом — ОБЩИЙ вклад объекта в доход
 * (не дельта следующего уровня). Каждые tiers.levelsPerTier покупок объект
 * ЭВОЛЮЦИОНИРУЕТ: новая моделька на сцене и название стадии.
 *
 * Окно — отдельная выноска над таб-баром (НЕ его продолжение), по центру,
 * фиксированной ширины (не растягивается на широких экранах).
 * Повторный клик по активной вкладке закрывает выноску (toggle).
 *
 * Состояния карточки:
 *  - locked:   гейт `requires` не пройден — кнопка 🔒, условие в подписи бара;
 *  - level 0:  кнопка = цена первой покупки, бар пустой;
 *  - owned:    бар = level % levelsPerTier, кнопка = цена следующего уровня;
 *  - maxed:    кнопка MAX, бар полный.
 *
 * РЕЖИМ ПОКУПКИ (радио сверху выноски, аналог Qt RadioButton):
 *  - 'one'  — каждое действие покупает ровно 1 уровень;
 *  - 'tier' — действие покупает максимум доступного, но не дальше конца
 *             текущего грейда: прогресс-бар обнуляется, карточка обновляется.
 * Нажатие на кнопку можно ЗАЖАТЬ: покупки идут серией (пауза → повтор с
 * разгоном), отпускание мгновенно останавливает серию.
 */
export class ObjectSheet {
  private root: HTMLElement;
  private titleEl: HTMLElement;
  private listEl: HTMLElement;
  private cards: CardRefs[] = [];
  private activeGroup: ObjectGroup = 'property';
  private openState = false;

  /** Режим покупки всех кнопок выноски (радио сверху). */
  private buyMode: BuyMode = 'one';
  /** Кнопки радио — для переключения активного состояния без перестройки DOM. */
  private modeBtns: HTMLButtonElement[] = [];
  /** Зажатие: таймер до следующей покупки + карточка серии + счётчик повторов. */
  private holdTimer: number | null = null;
  private holdCard: CardRefs | null = null;
  private holdRepeats = 0;
  /** Серия уже покупала: следующий click (после отпускания) — лишний. */
  private holdFired = false;
  /** Счётчик вызовов refresh — троттлинг пересчёта цены пачки в режиме 'tier'. */
  private refreshTicks = 0;

  constructor(
    private readonly uiRoot: HTMLElement,
    private readonly game: Game,
  ) {
    // ---------- каркас шторки ----------
    this.root = document.createElement('div');
    this.root.className = 'sheet';

    const header = document.createElement('div');
    header.className = 'sheet-header';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'sheet-title';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'sheet-close js-interactive';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => this.close());

    header.append(this.titleEl, closeBtn);

    // Радио-режим покупки: сверху выноски, над карточками (см. BuyMode).
    const modeRow = this.buildModeRow();

    this.listEl = document.createElement('div');
    this.listEl.className = 'sheet-list';

    this.root.append(header, modeRow, this.listEl);
    this.uiRoot.appendChild(this.root);

    this.buildTabs();
    this.rebuildCards();
  }

  // ------------------------------------------------------------- вкладки

  /** Вкладки групп — часть нижней панели, рендерятся из groupOrder. */
  private buildTabs(): void {
    const bottom = document.createElement('nav');
    bottom.className = 'hud-bottom';

    for (const group of groupOrder) {
      const meta = groupMeta[group];

      const btn = document.createElement('button');
      btn.className = 'tab-btn js-interactive';
      btn.dataset.group = group;

      const icon = document.createElement('span');
      icon.className = 'tab-icon';
      icon.textContent = meta.icon;

      const label = document.createElement('span');
      label.textContent = meta.label;

      btn.append(icon, label);
      btn.addEventListener('click', () => this.showGroup(group));

      bottom.appendChild(btn);
    }

    this.uiRoot.appendChild(bottom);
  }

  // --------------------------------------------------------- режим покупки

  /**
   * Радио сверху выноски (аналогия Qt RadioButton): переключает поведение ВСЕХ
   * кнопок покупки и их подписи. Зажатие работает в обоих режимах.
   */
  private buildModeRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sheet-modes';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', 'Режим покупки');

    // Подписи короткие по ТЗ владельца (2026-10-02): «1 ур.» | «max»;
    // полные объяснения режима остаются в title (hint) у кнопок.
    const items: { mode: BuyMode; label: string; hint: string }[] = [
      { mode: 'one', label: '1 ур.', hint: 'Одно нажатие — один уровень' },
      { mode: 'tier', label: 'max', hint: 'Сразу до конца грейда — бар обнуляется' },
    ];

    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mode-btn js-interactive';
      btn.dataset.mode = item.mode;
      btn.textContent = item.label;
      btn.title = item.hint;
      btn.setAttribute('role', 'radio');
      btn.addEventListener('click', () => this.setBuyMode(item.mode));
      this.modeBtns.push(btn);
      row.appendChild(btn);
    }

    this.updateModeActiveState();
    return row;
  }

  /** Смена режима: сбрасываем зажатие (иначе серия продолжила бы старую логику). */
  private setBuyMode(mode: BuyMode): void {
    if (this.buyMode === mode) return;
    this.buyMode = mode;
    this.stopHold();
    this.updateModeActiveState();
    this.refresh(true); // подписи кнопок зависят от режима — перерисовываем сразу
  }

  private updateModeActiveState(): void {
    for (const btn of this.modeBtns) {
      const active = btn.dataset.mode === this.buyMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    }
  }

  // -------------------------------------------------------------- карточки

  private rebuildCards(): void {
    this.stopHold(); // серия не должна переживать смену вкладки
    this.holdFired = false; // карточки старые — лишний click гасить некому
    this.listEl.replaceChildren();
    this.cards = [];

    for (const def of objectsByGroup(this.activeGroup)) {
      const card = this.buildCard(def);
      this.cards.push(card);
      this.listEl.appendChild(card.root);
    }

    const meta = groupMeta[this.activeGroup];
    this.titleEl.textContent = `${meta.icon} ${meta.label}`;
    this.updateTabActiveState();
  }

  private buildCard(def: ObjectDef): CardRefs {
    const root = document.createElement('div');
    root.className = 'upgrade-card';

    // ---------- левая часть: иконка ----------
    const icon = document.createElement('div');
    icon.className = 'upgrade-icon';
    icon.textContent = def.icon;

    // ---------- центр: информация ----------
    const info = document.createElement('div');
    info.className = 'card-info';

    // Имя объекта. После покупки показываем стадию тира (обновляется в renderLevelDependent).
    const name = document.createElement('div');
    name.className = 'upgrade-name';
    name.textContent = def.name;

    const bar = document.createElement('div');
    bar.className = 'card-progress';

    const barTrack = document.createElement('div');
    barTrack.className = 'progress-track';

    const barFill = document.createElement('div');
    barFill.className = 'progress-fill';
    barTrack.appendChild(barFill);

    // Нижняя строка под баром: уровень слева + общий вклад в доход справа.
    const barBottom = document.createElement('div');
    barBottom.className = 'card-bottom';

    const barLabel = document.createElement('div');
    barLabel.className = 'progress-label';

    const income = document.createElement('span');
    income.className = 'card-income';
    income.title = 'т — за тап, с — в секунду';

    barBottom.append(barLabel, income);
    bar.append(barTrack, barBottom);
    info.append(name, bar);

    // ---------- правая часть: кнопка покупки ----------
    const buyBtn = document.createElement('button');
    buyBtn.className = 'upgrade-buy js-interactive';
    // pointer-события только ЗАВОДЯТ и останавливают серию зажатия, а сама
    // одиночная покупка — на click: так кнопка работает и с клавиатуры, и из
    // скриптов, а после серии лишний click отсекается флагом holdFired.
    buyBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // без выделения текста во время серии
      this.startHold(card);
    });
    buyBtn.addEventListener('pointerup', () => this.stopHold());
    buyBtn.addEventListener('pointercancel', () => this.stopHold());
    buyBtn.addEventListener('pointerleave', () => this.stopHold());
    buyBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    buyBtn.addEventListener('click', () => {
      // Клик приходит после тапа, после серии и с клавиатуры (Enter/Space).
      if (this.holdFired) {
        this.holdFired = false;
        return;
      }
      this.buyNow(card);
    });

    root.append(icon, info, buyBtn);

    const card: CardRefs = {
      root, nameEl: name, barFillEl: barFill, barLabelEl: barLabel, incomeEl: income, buyBtn, def,
      shownLevel: -1, shownAffordable: false, shownUnlocked: true, shownBuyText: '',
      cachedCost: this.game.state.getUpgradeCost(def),
    };
    this.refreshCard(card, true, true);
    return card;
  }

  /** Подсвечивается только вкладка ОТКРЫТОЙ выноски (закрыто — нет активных). */
  private updateTabActiveState(): void {
    const active = this.openState ? this.activeGroup : null;
    for (const el of this.uiRoot.querySelectorAll<HTMLButtonElement>('.tab-btn')) {
      el.classList.toggle('active', el.dataset.group === active);
    }
  }

  // ---------------------------------------------------------------- public

  showGroup(group: ObjectGroup): void {
    // Повторный клик по активной вкладке закрывает выноску (toggle).
    if (this.openState && this.activeGroup === group) {
      this.close();
      return;
    }
    if (this.activeGroup !== group) {
      this.activeGroup = group;
      this.rebuildCards();
    }
    if (!this.openState) this.open();
  }

  open(): void {
    this.openState = true;
    this.refresh(); // мгновенная синхронизация цен после простоя
    this.root.classList.add('open');
    this.updateTabActiveState();
  }

  isOpen(): boolean {
    return this.openState;
  }

  close(): void {
    this.stopHold(); // закрыли выноску — серия покупок обрывается
    this.openState = false;
    this.root.classList.remove('open');
    this.updateTabActiveState();
  }

  toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  /**
   * Вызывается UIManager'ом каждый тик (только пока шторка открыта).
   * force = true — перерисовать подписи немедленно (смена режима покупки).
   * planDue — можно пересчитать цену пачки в режиме 'tier' (троттлинг: Decimal).
   */
  refresh(force = false): void {
    this.refreshTicks += 1;
    const planDue = this.buyMode === 'tier' && this.refreshTicks % TIER_PLAN_THROTTLE_TICKS === 0;

    for (const card of this.cards) {
      this.refreshCard(card, force, force || planDue);
    }
  }

  /**
   * Обновление одной карточки. Цена и бар зависят ТОЛЬКО от уровня —
   * пересчитываются при его смене. Доступность зависит от баланса — проверяется
   * на каждом вызове, но в DOM пишется только при изменении.
   */
  private refreshCard(card: CardRefs, force: boolean, planDue: boolean): void {
    const def = card.def;
    const state = this.game.state;
    const level = def.currentLevel;
    const unlocked = state.isUnlocked(def);
    const affordable = unlocked && !state.isMaxed(def) && state.canAfford(def);

    if (force || card.shownLevel !== level || card.shownUnlocked !== unlocked) {
      card.cachedCost = state.getUpgradeCost(def);
      this.renderLevelDependent(card, level, unlocked);
      card.shownLevel = level;
      card.shownUnlocked = unlocked;
      card.shownAffordable = affordable;
      card.root.classList.toggle('locked', !unlocked);
      card.root.classList.toggle('affordable', affordable);
      return;
    }

    if (card.shownAffordable !== affordable) {
      card.buyBtn.disabled = !affordable;
      card.root.classList.toggle('affordable', affordable);
      card.shownAffordable = affordable;
    }

    // В режиме 'tier' подпись кнопки — цена пачки, а пачка растёт вместе с балансом.
    if (planDue) this.updateBuyButton(card, false);
  }

  /** Всё, что зависит от уровня/анлока: имя-стадия, бар, подписи, кнопка. */
  private renderLevelDependent(card: CardRefs, level: number, unlocked: boolean): void {
    const def = card.def;
    const state = this.game.state;
    const perTier = gameConfig.tiers.levelsPerTier;

    // Имя = стадия тира (только у купленного объекта); не куплен/заблокирован — название.
    const stage = level > 0 ? def.tierNames?.[Math.floor(level / perTier)] : undefined;
    card.nameEl.textContent = stage ?? def.name;

    // Формируем текст об ОБЩЕМ вкладе объекта в доходы
    const incomeInfo = this.getIncomeInfo(def);

    // ---------- прогресс-бар (короткая подпись: только уровень) ----------
    card.incomeEl.textContent = unlocked ? incomeInfo : '';

    if (!unlocked && def.requires) {
      card.barFillEl.style.width = '0%';
      card.barLabelEl.textContent = `Нужен: ${getObject(def.requires).name}`;
    } else if (state.isMaxed(def)) {
      card.barFillEl.style.width = '100%';
      card.barLabelEl.textContent = def.tierNames ? `ур. ${level}` : 'MAX';
    } else if (level > 0) {
      const inTier = level % perTier;
      card.barFillEl.style.width = `${(inTier / perTier) * 100}%`;
      card.barLabelEl.textContent = `ур. ${level}`;
    } else {
      card.barFillEl.style.width = '0%';
      card.barLabelEl.textContent = 'Не куплено';
    }

    // ---------- кнопка ----------
    this.updateBuyButton(card, true);
  }

  /**
   * Подпись и доступность кнопки покупки. В режиме 'one' — цена следующего
   * уровня из кэша; в режиме 'tier' — цена ВСЕЙ пачки до конца грейда и «×N»
   * уровней в ней (пачка зависит от баланса — считается по троттлингу).
   */
  private updateBuyButton(card: CardRefs, force: boolean): void {
    const def = card.def;
    const state = this.game.state;

    if (state.isMaxed(def)) {
      this.setBuyText(card, 'MAX', force);
      card.buyBtn.disabled = true;
      return;
    }

    if (!state.isUnlocked(def)) {
      this.setBuyText(card, '🔒', force);
      card.buyBtn.disabled = true;
      return;
    }

    if (this.buyMode === 'one') {
      this.setBuyText(card, formatMoney(card.cachedCost), force);
      card.buyBtn.title = 'Купить 1 уровень (зажать — покупать серией)';
    } else {
      const plan = state.getBuyPlan(def, 'tier');
      const money = formatMoney(plan.cost);
      this.setBuyText(card, plan.count > 1 ? `${money} ×${plan.count}` : money, force);
      card.buyBtn.title = plan.count > 1
        ? `Купить ${plan.count} ур. до конца грейда за ${money}`
        : 'Купить 1 уровень';
    }

    card.buyBtn.disabled = !state.canAfford(def);
  }

  /** DOM-запись подписи кнопки только при изменении. */
  private setBuyText(card: CardRefs, text: string, force: boolean): void {
    if (!force && card.shownBuyText === text) return;
    card.buyBtn.textContent = text;
    card.shownBuyText = text;
  }

  // ---------------------------------------------------------- зажатие кнопки

  /**
   * Палец/курсор нажал на кнопку. Сначала ЖДЁМ HOLD_DELAY_MS — за это время юзер
   * успевает отпустить (тогда будет ровно одна покупка по click), и только потом
   * стартует серия. Само нажатие ничего не покупает.
   */
  private startHold(card: CardRefs): void {
    this.stopHold();
    this.holdFired = false;
    if (card.buyBtn.disabled) return;

    this.holdCard = card;
    this.holdTimer = globalThis.setTimeout(() => {
      this.holdTimer = null;
      this.stepHold();
    }, HOLD_DELAY_MS);
  }

  /** Шаг серии: покупка, затем следующий шаг (после разгона — чаще). */
  private stepHold(): void {
    const card = this.holdCard;
    if (!card) return;

    const bought = this.buyNow(card);
    this.holdRepeats += 1;

    // Покупать больше нечего (MAX, гейт, деньги кончились) — серия встаёт.
    if (bought <= 0) {
      this.stopHold();
      return;
    }

    this.holdFired = true; // следующая обычная покупка (click) будет лишней — отсечём

    const step = this.holdRepeats > HOLD_FREE_REPEATS ? HOLD_REPEAT_FAST_MS : HOLD_REPEAT_MS;
    this.holdTimer = globalThis.setTimeout(() => {
      this.holdTimer = null;
      this.stepHold();
    }, step);
  }

  /**
   * Остановка серии без покупки: отпускание, уход курсора, смена вкладки/режима,
   * закрытие выноски. holdFired НЕ сбрасывается — его гасит click после отпускания.
   */
  private stopHold(): void {
    if (this.holdTimer !== null) {
      globalThis.clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    this.holdCard = null;
    this.holdRepeats = 0;
  }

  /** Одно действие покупки по текущему режиму; возвращает число взятых уровней. */
  private buyNow(card: CardRefs): number {
    const before = card.def.currentLevel;
    this.game.buyObject(card.def.id, this.buyMode);
    return card.def.currentLevel - before;
  }

  /**
   * ОБЩИЙ вклад объекта в доходы на ТЕКУЩИЙ момент (не дельта следующего уровня):
   * base × weight × уровень × tierMult — тот же член Σ, что и в потоках GameState.
   * «т» = за тап (активный), «с» = в секунду (пассивный).
   */
  private getIncomeInfo(def: ObjectDef): string {
    const level = def.currentLevel;
    if (level <= 0) return '';

    const tier = Math.floor(level / gameConfig.tiers.levelsPerTier);
    const perTier = gameConfig.tiers.weightMultiplierPerTier * gameConfig.tiers.weightDecayPerTier;
    const tierMult = Math.pow(perTier, tier);

    const parts: string[] = [];

    if (def.aWeight > 0) {
      const total = gameConfig.moneyPerTap.mul(def.aWeight * level * tierMult);
      parts.push(`+${formatMoney(total)}/т`);
    }

    if (def.pWeight > 0) {
      const total = gameConfig.passiveBase.mul(def.pWeight * level * tierMult);
      parts.push(`+${formatMoney(total)}/с`);
    }

    return parts.length > 0 ? parts.join(' ') : '';
  }
}
