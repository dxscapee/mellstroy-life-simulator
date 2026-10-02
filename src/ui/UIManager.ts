import { WORLD_ERA_NAMES } from '@data/worldStages';
import { events } from '@engine/eventBus';
import { formatCount, formatMoney, formatIncomePerSecond } from '@engine/format';
import { worldProgressFrac } from '@engine/WorldProgress';
import type { Game } from '@engine/Game';
import { Modal } from './OfflineModal';
import { ObjectSheet } from './ObjectSheet';
import { EraPopup } from './EraPopup';
import type { EraPreviewProvider } from './EraPopup';

/** Геометрия кольца прогресса мира (viewBox 60×60). */
const WORLD_RING_R = 26;

/**
 * Композитор HTML-слоя: создаёт HUD, выноску и модалку, подписывает их
 * на события движка. Логики не содержит — только связывание и рендер.
 *
 * Верхняя панель .hud-bar — блок плашек по ширине нижнего меню, СДВИНУТЫЙ
 * вправо от центра (--hud-shift): слева остаётся полоса под кольцо прогресса
 * мира, которое ПРИКРЕПЛЕНО К ЛЕВОМУ КРАЮ БЛОКА (right: calc(100% + зазор)),
 * а не к краю окна, поэтому при ресайзе не расходится с меню. Размер кольца
 * считает CSS (--ring-size) — от свободного места слева.
 * Под кольцом — название локации (эпоха мира).
 * Плашки (порядок DOM row-major, без подписей):
 *   [баланс][пассив] / [новая валюта «soon»][актив] / [подписчики + бар]
 * Смысл ячейки: значение (все — одного белого цвета, ТЗ 2026-10-02),
 * полное имя — в title.
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
  /** Попап-галерея эпох: открывается кольцом прогресса (чипа в HUD больше нет). */
  private eraPopup: EraPopup;
  /** Кольцо прогресса мира (слева сверху) + его SVG-дуга и % внутри. */
  private worldRing: HTMLButtonElement;
  private worldRingFg: SVGCircleElement;
  private worldRingPct: HTMLElement;
  /** Название локации прогресса (эпоха мира) под кольцом. */
  private worldLabel: HTMLElement;
  private lastWorldPct = -1;
  private readonly worldRingC: number;
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
    /**
     * Провайдер превью эпох (URL фона из манифеста) — даёт main из AssetRegistry,
     * поэтому ui остаётся в стороне от view (только данные, без импорта слоя).
     */
    eraPreview?: EraPreviewProvider,
  ) {
    this.worldRingC = 2 * Math.PI * WORLD_RING_R;
    // Попап-галерея эпох: открывается кольцом прогресса (см. ниже). Раньше
    // его открывал и чип эпохи в HUD — чипа больше нет, роль осталась кольцу.
    this.eraPopup = new EraPopup(uiRoot, game, eraPreview);

    // ---------- верхняя панель: блок плашек + кольцо и настройки по его краям ----------
    // .hud-bar центрируется как одно целое (та же ширина, что у нижнего меню).
    // Дети — позиционируются от краёв БЛОКА, поэтому при изменении ширины окна
    // кольцо/настройки/плашки едут вместе и не расходятся к краям экрана.
    const bar = document.createElement('div');
    bar.className = 'hud-bar';

    // Плашки без подписей (ТЗ владельца 2026-09-30) — панели стали ниже.
    // Порядок DOM row-major: строка 1 [баланс | пассив], строка 2 [новая валюта | актив].
    const hud = document.createElement('header');
    hud.className = 'hud-top';
    hud.appendChild(this.mkStat('Всего денег', 'balance', this.balanceEl = document.createElement('div')));
    hud.appendChild(this.mkStat('Пассивный доход', 'passive', this.passiveEl = document.createElement('div')));
    const goldValueEl = document.createElement('div');
    goldValueEl.textContent = 'soon';
    hud.appendChild(this.mkStat('Новая валюта (ещё не введена)', 'gold', goldValueEl));
    hud.appendChild(this.mkStat('Доход за клик', 'active', this.activeEl = document.createElement('div')));
    bar.appendChild(hud);

    // Нижняя строка (на всю ширину блока): подписчики, клик = забрать награду.
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

    // Подписи у плашек убраны: смысл несёт иконка 👤 + бар, полное имя — в title.
    this.subChip.title = 'Подписчики: клик — забрать награду';

    this.subChip.append(subTop, subTrack);
    this.subChip.addEventListener('click', () => this.onSubChipClick());

    hud.appendChild(this.subChip);

    // ---------- кольцо прогресса мира (слева от HUD) ----------
    // Круглая кнопка-шкала: тёмная таблетка в стиле плашек HUD, сплошная
    // зелёная дуга прогресса (акцент) и % внутри. Заполняется от ЖИВОЙ дроби
    // периода worldProgressFrac(totalEarned) — кэш WorldWatch «заморожен»
    // между сменами. Клик — галерея эпох: та же функция, что была у чипа.
    this.worldRing = document.createElement('button');
    this.worldRing.className = 'world-ring js-interactive';
    this.worldRing.type = 'button';
    this.worldRing.title = 'Мир: эпохи';
    this.worldRing.setAttribute('aria-label', 'Прогресс эпохи мира');

    const NS = 'http://www.w3.org/2000/svg';
    const ringSvg = document.createElementNS(NS, 'svg');
    ringSvg.setAttribute('viewBox', '0 0 60 60');
    ringSvg.classList.add('world-ring-svg');

    // Дорожка (весь круг) под дугой прогресса — видно, сколько ещё осталось.
    // Цвет дуги задан в CSS (stroke: var(--accent)) — SVG без defs и градиентов.
    const ringTrack = document.createElementNS(NS, 'circle');
    ringTrack.setAttribute('cx', '30');
    ringTrack.setAttribute('cy', '30');
    ringTrack.setAttribute('r', String(WORLD_RING_R));
    ringTrack.classList.add('world-ring-track');

    this.worldRingFg = document.createElementNS(NS, 'circle');
    this.worldRingFg.setAttribute('cx', '30');
    this.worldRingFg.setAttribute('cy', '30');
    this.worldRingFg.setAttribute('r', String(WORLD_RING_R));
    this.worldRingFg.classList.add('world-ring-fg');
    this.worldRingFg.style.strokeDasharray = String(this.worldRingC);
    this.worldRingFg.style.strokeDashoffset = String(this.worldRingC);
    ringSvg.append(ringTrack, this.worldRingFg);

    this.worldRingPct = document.createElement('span');
    this.worldRingPct.className = 'world-ring-pct';
    this.worldRingPct.textContent = '0%';

    // Название локации — под кольцом, внутри самой кнопки: клик по подписи
    // открывает ту же галерею эпох (а не уходит тапом в сцену). Ширину подписи
    // держит CSS (100% кольца) — за компоновку верхней панели не выходит.
    this.worldLabel = document.createElement('span');
    this.worldLabel.className = 'world-label';
    this.worldLabel.textContent = WORLD_ERA_NAMES[0] ?? '';

    this.worldRing.append(ringSvg, this.worldRingPct, this.worldLabel);
    this.worldRing.addEventListener('click', () => this.eraPopup.toggle());
    bar.appendChild(this.worldRing); // прикреплено к ЛЕВОМУ краю блока плашек
    uiRoot.appendChild(bar);

    this.sheet = new ObjectSheet(uiRoot, game);
    this.modal = new Modal(uiRoot);

    this.renderHud();
    this.renderSubscribers(true);
    this.renderWorldRing();
    this.renderWorldLabel();

    // ---------- подписки ----------
    this.unsubscribers.push(
      events.on('tick', () => this.onTick()),
      events.on('tap:earned', () => this.forceHud()),
      events.on('object:levelup', () => this.forceHud()),
      events.on('subscribers:changed', () => this.renderSubscribers()),
      events.on('subscribers:ready', () => this.renderSubscribers()),
      // Смена периода мира: кольцо вспыхивает (попап обновит себя сам),
      // подпись локации обновляется (меняется только на смене ЭПОХИ).
      events.on('world:changed', () => {
        this.worldRing.classList.remove('evolved');
        void this.worldRing.offsetWidth; // рестарт CSS-анимации
        this.worldRing.classList.add('evolved');
        this.renderWorldLabel();
      }),
      // Полный сброс (дебаг): HUD и подписчики могут не измениться по ключам — рендерим принудительно.
      events.on('game:reset', () => {
        this.lastSubKey = null;
        this.lastWorldPct = -1;
        this.forceHud();
        this.renderWorldRing();
        this.renderWorldLabel();
      }),
    );
  }

  private onSubChipClick(): void {
    const reward = this.game.claimSubscribers();
    if (reward) {
      console.info(`[UI] Награда подписчиков забрана: ${formatMoney(reward)}`);
    }
  }

  /**
   * Ячейка-показатель: ТОЛЬКО значение (подписи-плашки убраны по ТЗ владельца),
   * поэтому плашки компактные. Смысл показателя даёт цвет (stat-<kind>),
   * полное имя лежит в title ячейки. Значение заполняется renderHud.
   */
  private mkStat(title: string, kind: string, valueEl: HTMLElement): HTMLElement {
    const cell = document.createElement('div');
    cell.className = `hud-cell stat-cell stat-${kind}`;
    cell.title = title;

    valueEl.className = 'cell-value';

    cell.appendChild(valueEl);
    return cell;
  }

  private onTick(): void {
    // Троттлинг HUD: перерисовка баланса ~4 раза/сек.
    // Шторка обновляется только пока открыта — в закрытом состоянии её не видно.
    this.hudThrottle += 1;
    if (this.hudThrottle % 15 === 0) this.renderHud();
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

  /**
   * Название локации под кольцом (эпоха мира). Меняется только на смене эпохи,
   * поэтому зовётся не в тике, а по событиям (world:changed / game:reset).
   */
  private renderWorldLabel(): void {
    const era = this.game.worldWatch.stage.era;
    const name = WORLD_ERA_NAMES[Math.min(era, WORLD_ERA_NAMES.length - 1)] ?? '';
    if (name === this.worldLabel.textContent) return;
    this.worldLabel.textContent = name;
  }

  destroy(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }
}
