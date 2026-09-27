import type Decimal from 'break_infinity.js';
import { gameConfig } from '@data/gameConfig';
import { getObject, groupMeta, groupOrder, objectsByGroup } from '@data/objects';
import type { Game } from '@engine/Game';
import { formatMoney } from '@engine/format';
import type { ObjectDef, ObjectGroup } from '@engine/types';

interface CardRefs {
  root: HTMLElement;
  /** Прогресс-бар эволюции: заполнение + подпись «ур. 7/10 · Стадия». */
  barFillEl: HTMLElement;
  barLabelEl: HTMLElement;
  buyBtn: HTMLButtonElement;
  def: ObjectDef;
  /** Кэш последнего отображённого состояния — пишем в DOM только при изменении. */
  shownLevel: number;
  shownAffordable: boolean;
  shownUnlocked: boolean;
  /** Цена следующего уровня — зависит только от уровня, пересчитывается при его смене. */
  cachedCost: Decimal;
}

/**
 * Выноска объектов по группам-вкладкам. DOM строится один раз из data/objects.ts,
 * дальше обновляются только динамические части.
 *
 * Схема карточки (по ТЗ): [иконка + имя] [прогресс-бар до эволюции] [кнопка].
 * Каждые tiers.levelsPerTier покупок объект ЭВОЛЮЦИОНИРУЕТ: новая моделька на
 * сцене и название стадии. Прогресс-бар показывает путь до следующей эволюции.
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
 */
export class ObjectSheet {
  private root: HTMLElement;
  private titleEl: HTMLElement;
  private listEl: HTMLElement;
  private cards: CardRefs[] = [];
  private activeGroup: ObjectGroup = 'property';
  private openState = false;

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

    this.listEl = document.createElement('div');
    this.listEl.className = 'sheet-list';

    this.root.append(header, this.listEl);
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

  // -------------------------------------------------------------- карточки

  private rebuildCards(): void {
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

    const barLabel = document.createElement('div');
    barLabel.className = 'progress-label';

    bar.append(barTrack, barLabel);
    info.append(name, bar);

    // ---------- правая часть: кнопка покупки ----------
    const buyBtn = document.createElement('button');
    buyBtn.className = 'upgrade-buy js-interactive';
    buyBtn.addEventListener('click', () => {
      this.game.buyObject(def.id);
      // Доступность/цены перерисуются на ближайшем 'tick' (или при открытии шторки).
    });

    root.append(icon, info, buyBtn);

    const card: CardRefs = {
      root, barFillEl: barFill, barLabelEl: barLabel, buyBtn, def,
      shownLevel: -1, shownAffordable: false, shownUnlocked: true,
      cachedCost: this.game.state.getUpgradeCost(def),
    };
    this.refreshCard(card, true);
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
    this.openState = false;
    this.root.classList.remove('open');
    this.updateTabActiveState();
  }

  toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  /** Вызывается UIManager'ом каждый тик (только пока шторка открыта). */
  refresh(): void {
    for (const card of this.cards) {
      this.refreshCard(card, false);
    }
  }

  /**
   * Обновление одной карточки. Цена и бар зависят ТОЛЬКО от уровня —
   * пересчитываются при его смене. Доступность зависит от баланса — проверяется
   * на каждом вызове, но в DOM пишется только при изменении.
   */
  private refreshCard(card: CardRefs, force: boolean): void {
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
  }

  /** Всё, что зависит от уровня/анлока: бар, подписи, кнопка. */
  private renderLevelDependent(card: CardRefs, level: number, unlocked: boolean): void {
    const def = card.def;
    const state = this.game.state;

    // Формируем текст о вкладе в доходы
    const incomeInfo = this.getIncomeInfo(def);

    // ---------- прогресс-бар ----------
    if (!unlocked && def.requires) {
      card.barFillEl.style.width = '0%';
      card.barLabelEl.textContent = `Нужен: ${getObject(def.requires).name}`;
    } else if (state.isMaxed(def)) {
      card.barFillEl.style.width = '100%';
      card.barLabelEl.textContent = incomeInfo || 'MAX';
    } else if (level > 0) {
      const perTier = gameConfig.tiers.levelsPerTier;
      const inTier = level % perTier;
      card.barFillEl.style.width = `${(inTier / perTier) * 100}%`;
      const stage = def.tierNames?.[Math.floor(level / perTier)];
      card.barLabelEl.textContent = stage
        ? `ур. ${level} · ${stage} · ${incomeInfo}`
        : `ур. ${level} · ${incomeInfo}`;
    } else {
      card.barFillEl.style.width = '0%';
      card.barLabelEl.textContent = incomeInfo || 'Не куплено';
    }

    // ---------- кнопка ----------
    if (state.isMaxed(def)) {
      card.buyBtn.textContent = 'MAX';
      card.buyBtn.disabled = true;
    } else if (!unlocked) {
      card.buyBtn.textContent = '🔒';
      card.buyBtn.disabled = true;
    } else {
      card.buyBtn.textContent = formatMoney(card.cachedCost);
      card.buyBtn.disabled = !state.canAfford(def);
    }
  }

  /** Формирует текст о вкладе объекта в доходы (активный/пассивный). */
  private getIncomeInfo(def: ObjectDef): string {
    const state = this.game.state;
    const tier = Math.floor(def.currentLevel / gameConfig.tiers.levelsPerTier);
    const perTier = gameConfig.tiers.weightMultiplierPerTier * gameConfig.tiers.weightDecayPerTier;
    const tierMult = Math.pow(perTier, tier);

    const parts: string[] = [];

    // Вклад следующего уровня в активный доход
    if (def.aWeight > 0) {
      const contribution = gameConfig.moneyPerTap.mul(def.aWeight * tierMult);
      parts.push(`+${formatMoney(contribution)}/тап`);
    }

    // Вклад следующего уровня в пассивный доход
    if (def.pWeight > 0) {
      const contribution = gameConfig.passiveBase.mul(def.pWeight * tierMult);
      parts.push(`+${formatMoney(contribution)}/сек`);
    }

    return parts.length > 0 ? parts.join(' ') : '';
  }
}
