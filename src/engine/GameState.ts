import Decimal from 'break_infinity.js';
import { gameConfig } from '@data/gameConfig';
import { objectById, objectDefs } from '@data/objects';
import { events } from './eventBus';
import type { BuyMode, GameStateSnapshot, ObjectDef, OfflineEarnings, SubscriberState } from './types';

/**
 * Чистая модель данных игры. Никакого DOM, никакой графики.
 * Только числа (Decimal), уровни и чистые методы расчёта.
 *
 * Экономика двух потоков (веса заданы в data/objects.ts):
 *   A = moneyPerTap * (1 + Σ aWeight * level * tierMult)
 *   P = passiveBase * (1 + Σ pWeight * level * tierMult)
 * tierMult = (weightMultiplierPerTier * weightDecayPerTier) ^ tier — вклад уровня
 * усиливается с каждой эволюцией объекта (x1.8), но процент слегка ослабевает (x0.9).
 */
export class GameState {
  money: Decimal;
  /** Кэш пассивного потока (/сек), пересчитывается при изменении уровней. */
  passiveIncomePerSecond: Decimal;
  /** Сколько всего заработано за жизнь сейва — статистика/ачивки. */
  totalEarned: Decimal;
  tapsCount: number;

  /** Мета-прогресс подписчиков (см. gameConfig.subscribers). */
  subscribers: SubscriberState;

  /** Кэш активного потока (доход за тап): пересобирается после изменения уровней. */
  private cachedMoneyPerTap: Decimal | null = null;
  /**
   * Форс дохода за тап (dev-инструменты/баланс-тесты). Не null — формула весов
   * игнорируется, тап всегда даёт это значение. Сбрасывается в resetProgress.
   */
  private tapOverride: Decimal | null = null;

  constructor() {
    this.money = gameConfig.startingMoney.add(0);
    this.passiveIncomePerSecond = new Decimal(0);
    this.totalEarned = new Decimal(0);
    this.tapsCount = 0;
    this.subscribers = { count: 0, progress: 0, claimed: 0, claimable: false, goal: 0 };
  }

  // -------------------------------------------------------------- objects

  getLevel(id: string): number {
    return objectById.get(id as ObjectDef['id'])?.currentLevel ?? 0;
  }

  isOwned(def: ObjectDef): boolean {
    return def.currentLevel > 0;
  }

  /** Объект уже на максимуме. */
  isMaxed(def: ObjectDef): boolean {
    return def.currentLevel >= def.maxLevel;
  }

  /** Разблокирован ли объект для покупки (гейт по `requires`). */
  isUnlocked(def: ObjectDef): boolean {
    if (!def.requires) return true;
    return this.getLevel(def.requires) > 0;
  }

  /** Стоимость следующего уровня: costBase * costGrowth^level. */
  getUpgradeCost(def: ObjectDef): Decimal {
    return def.costBase.mul(Math.pow(def.costGrowth, def.currentLevel));
  }

  canAfford(def: ObjectDef): boolean {
    return this.money.gte(this.getUpgradeCost(def));
  }

  /** Покупка следующего уровня (включая первую покупку = «анлок»). */
  buyUpgrade(def: ObjectDef): boolean {
    return this.buyUpgradeBulk(def, 'one') > 0;
  }

  /**
   * План покупки НА ОДНО действие (не меняет состояние, только считает).
   * mode:
   *  - 'one'  — всегда ровно один уровень;
   *  - 'tier' — максимум того, что влезает в деньги, но не дальше КОНЦА текущего
   *             грейда (levelsPerTier), чтобы прогресс-бар обнулился.
   * count ≤ 0 (нельзя/не куплено/не хватает денег) — тогда cost = цена СЛЕДУЮЩЕГО
   * уровня: UI показывает её на кнопке выключенной покупки.
   */
  getBuyPlan(def: ObjectDef, mode: BuyMode): { count: number; cost: Decimal } {
    const next = this.getUpgradeCost(def);
    if (this.isMaxed(def) || !this.isUnlocked(def) || this.money.lt(next)) {
      return { count: 0, cost: next };
    }

    // Грейд — каждые levelsPerTier уровней. Уровень 0 (объект не куплен) считаем
    // НАЧАЛОМ грейда: «до конца грейда» = perTier уровней, а не 0.
    const perTier = gameConfig.tiers.levelsPerTier;
    const toTierEnd = perTier - (def.currentLevel % perTier);
    const cap = mode === 'one'
      ? 1
      : Math.min(toTierEnd, def.maxLevel - def.currentLevel);

    let count = 1;
    let cost = next;
    while (count < cap) {
      // Цена уровня (currentLevel + count) — тот же закон, что у getUpgradeCost.
      const step = def.costBase.mul(Math.pow(def.costGrowth, def.currentLevel + count));
      const total = cost.add(step);
      if (this.money.lt(total)) break;
      cost = total;
      count += 1;
    }

    return { count, cost };
  }

  /**
   * Покупка пачкой по плану getBuyPlan: ОДНО списание и ОДНА инвалидация кэшей,
   * поэтому зажатая кнопка может брать десятки уровней за одно действие.
   * Возвращает число купленных уровней (0 — покупать нельзя).
   */
  buyUpgradeBulk(def: ObjectDef, mode: BuyMode): number {
    const plan = this.getBuyPlan(def, mode);
    if (plan.count <= 0) return 0;

    this.money = this.money.sub(plan.cost);
    def.currentLevel += plan.count; // уровень живёт в дефе — единый источник правды
    this.invalidateCaches();
    return plan.count;
  }

  // ------------------------------------------------------- потоки дохода

  /**
   * Эффективный тир-множитель вклада уровня: вклад растёт (x weightMultiplierPerTier),
   * но процент за уровень слегка падает (x weightDecayPerTier). Итог за тир = x1.8
   * (2 * 0.9) — эволюция ощутима, но не ломает экспоненту цены.
   */
  private tierWeightMult(def: ObjectDef): number {
    const tier = Math.floor(def.currentLevel / gameConfig.tiers.levelsPerTier);
    const perTier = gameConfig.tiers.weightMultiplierPerTier * gameConfig.tiers.weightDecayPerTier;
    return Math.pow(perTier, tier);
  }

  /** Форсировать доход за тап (dev-инструменты/баланс-тесты). null = обычная формула. */
  setTapOverride(value: Decimal | null): void {
    this.tapOverride = value;
    this.invalidateCaches(); // цель/награда подписчиков зависят от тапа
  }

  /** Активен ли форс тапа (для dev-UI). */
  isTapOverridden(): boolean {
    return this.tapOverride !== null;
  }

  /** Доход за один тап (активный поток). Кэш — Decimal-операции аллоцируют. */
  getMoneyPerTap(): Decimal {
    if (this.tapOverride) return this.tapOverride;
    let cached = this.cachedMoneyPerTap;
    if (!cached) {
      let sum = 0;
      for (const o of objectDefs) {
        if (o.currentLevel > 0 && o.aWeight > 0) {
          sum += o.aWeight * o.currentLevel * this.tierWeightMult(o);
        }
      }
      cached = gameConfig.moneyPerTap.mul(1 + sum);
      this.cachedMoneyPerTap = cached;
    }
    return cached;
  }

  /**
   * Пересчёт пассивного потока. Точка расширения глобальных множителей
   * (престиж, рекламные бусты): добавить mul в конец формулы.
   */
  recalculatePassiveIncome(): void {
    let sum = 0;
    for (const o of objectDefs) {
      if (o.currentLevel > 0 && o.pWeight > 0) {
        sum += o.pWeight * o.currentLevel * this.tierWeightMult(o);
      }
    }
    this.passiveIncomePerSecond = gameConfig.passiveBase.mul(1 + sum);
  }

  /** Начислить пассивный доход за dt секунд. Вызывается из GameLoop. */
  applyIncomeForDuration(dt: number): void {
    if (dt <= 0 || this.passiveIncomePerSecond.lte(0)) return;
    this.addMoney(this.passiveIncomePerSecond.mul(dt));
  }

  /** Сброс кэшей потоков — вызывать ПОСЛЕ любого изменения уровней. */
  private invalidateCaches(): void {
    this.cachedMoneyPerTap = null;
    this.recalculatePassiveIncome();
  }

  // ----------------------------------------------------------- subscribers

  /**
   * Цель ТЕКУЩЕГО цикла подписчиков. Ленивая инициализация: при первом обращении
   * фиксируется от текущего дохода за клик (goalMult × тап) и больше не меняется,
   * пока цикл не завершится клеймом. Рост тапа в середине цикла цель не двигает.
   */
  getSubscriberGoal(): number {
    const s = this.subscribers;
    if (s.goal <= 0) {
      s.goal = Math.max(1, Math.round(this.getMoneyPerTap().toNumber() * gameConfig.subscribers.goalMult));
    }
    return s.goal;
  }

  /**
   * Награда за заполненную шкалу = rewardMult × (доход за клик НА МОМЕНТ клейма).
   * Не кэшируется: вычисляется в момент выдачи (нужна один раз за цикл).
   */
  getSubscriberReward(): Decimal {
    return this.getMoneyPerTap().mul(gameConfig.subscribers.rewardMult);
  }

  /**
   * Пассивный прирост подписчиков: раз в addIntervalSec капает сумма,
   * равная пассивному доходу за интервал. Копится дробная часть — не теряется.
   */
  addSubscribersFromPassive(dt: number): void {
    if (this.passiveIncomePerSecond.lte(0)) return;
    const gain = this.passiveIncomePerSecond.toNumber() * dt;
    if (gain <= 0) return;
    this.bumpSubscribers(gain);
  }

  /** Бонус за клики: каждый N-й клик даёт подписчиков = доход за этот клик. */
  addSubscribersFromTap(tapAmount: Decimal): void {
    if (this.tapsCount % gameConfig.subscribers.clickBonusEvery !== 0) return;
    this.bumpSubscribers(tapAmount.toNumber());
  }

  private bumpSubscribers(gain: number): void {
    if (!Number.isFinite(gain) || gain <= 0) return;

    const s = this.subscribers;
    s.count += gain;

    if (!s.claimable) {
      s.progress += gain;
      if (s.progress >= this.getSubscriberGoal()) {
        s.progress = this.getSubscriberGoal();
        s.claimable = true;
      }
    }
    // Пока claimable — прирост копится в count, но не в progress: шкала ждёт клика.
  }

  /**
   * Забрать награду за заполненную шкалу. Возвращает сумму или null.
   * Следующая цель = старая + goalMult × (тап на момент клейма) — цели растут
   * накопленно, каждый цикл чуть длиннее предыдущего.
   */
  claimSubscribers(): Decimal | null {
    const s = this.subscribers;
    if (!s.claimable) return null;

    const reward = this.getSubscriberReward();
    this.addMoney(reward);
    s.claimed += 1;
    s.claimable = false;
    s.progress = 0;
    // Новая цель фиксируется ТОТЧАС от текущего тапа: старое число + новая порция.
    s.goal = s.goal + Math.round(this.getMoneyPerTap().toNumber() * gameConfig.subscribers.goalMult);
    return reward;
  }

  // ----------------------------------------------------------------- tap

  applyTap(): Decimal {
    const amount = this.getMoneyPerTap();
    this.addMoney(amount);
    this.tapsCount += 1;
    return amount;
  }

  // ---------------------------------------------------------------- money

  addMoney(amount: Decimal): void {
    if (amount.lte(0)) return;
    this.money = this.money.add(amount);
    this.totalEarned = this.totalEarned.add(amount);
  }

  // ----------------------------------------------------------------- cycle

  /** Полный сброс прогресса (используется Game.resetAll и дебагом). */
  resetProgress(): void {
    this.money = gameConfig.startingMoney.add(0);
    this.totalEarned = new Decimal(0);
    this.tapsCount = 0;
    this.tapOverride = null; // свежий старт = без форсов
    this.subscribers = { count: 0, progress: 0, claimed: 0, claimable: false, goal: 0 };
    for (const o of objectDefs) o.currentLevel = o.startLevel;
    this.invalidateCaches();
    events.emit('objects:changed', undefined); // сцена должна скрыть проданное
  }

  toSnapshot(): GameStateSnapshot {
    const objects: Record<string, number> = {};
    for (const o of objectDefs) {
      if (o.currentLevel > 0) objects[o.id] = o.currentLevel;
    }

    return {
      version: 2,
      money: this.money.toString(),
      totalEarned: this.totalEarned.toString(),
      tapsCount: this.tapsCount,
      objects,
      subscribers: { ...this.subscribers },
      savedAt: Date.now(),
    };
  }

  loadFromSnapshot(snap: GameStateSnapshot): void {
    this.money = new Decimal(snap.money ?? '0');
    this.totalEarned = new Decimal(snap.totalEarned ?? '0');
    this.tapsCount = snap.tapsCount ?? 0;

    const sub = snap.subscribers;
    this.subscribers = {
      count: Number.isFinite(sub?.count) ? sub!.count : 0,
      progress: Number.isFinite(sub?.progress) ? sub!.progress : 0,
      claimed: Number.isFinite(sub?.claimed) ? sub!.claimed : 0,
      claimable: sub?.claimable === true,
      // 0 = старый сейв без поля: цель перефиксируется лениво от текущего тапа.
      goal: Number.isFinite(sub?.goal) && sub!.goal > 0 ? sub!.goal : 0,
    };

    // Сбрасываем уровни до стартовых, затем накатываем из сейва.
    for (const o of objectDefs) o.currentLevel = o.startLevel;
    if (snap.objects) {
      for (const [rawId, level] of Object.entries(snap.objects)) {
        // Миграции id (прогресс переносится): «Лицо» → «Причёска»; микрофон
        // (tech) → камера (camera, решение владельца 2026-10-03). Старые гейты
        // (навыки → pc → tech) гарантируют, что камера в сейве уже была куплена.
        const id = rawId === 'face' ? 'hair' : rawId === 'tech' ? 'camera' : rawId;
        const def = objectById.get(id as ObjectDef['id']);
        if (def && Number.isFinite(level) && level > 0) {
          def.currentLevel = Math.min(Math.floor(level), def.maxLevel);
        }
      }
    }

    // Потоки пересчитываем из дефов, а не верим сейву — защита от рассинхрона.
    this.invalidateCaches();
    events.emit('objects:changed', undefined); // сцена должна перечитать owned/тиры
  }

  /**
   * Выставить уровни объектов напрямую (id -> level; отсутствующий id = startLevel)
   * и пересчитать потоки. Нейтральный API для dev-инструментов и будущих
   * систем вроде восстановления из облака — в проде никем не вызывается.
   */
  applyLevels(levels: Record<string, number>): void {
    for (const o of objectDefs) {
      const lvl = levels[o.id];
      o.currentLevel = lvl === undefined
        ? o.startLevel
        : Math.max(o.startLevel, Math.min(Math.floor(lvl), o.maxLevel));
    }
    this.invalidateCaches();
    events.emit('objects:changed', undefined); // сцена/перф-зависимости перечитывают всё
  }

  /** Сколько денег накопилось бы за время offlineSeconds (с эффективностью офлайна). */
  calcOfflineEarnings(secondsAway: number): OfflineEarnings {
    const { maxSeconds, efficiency } = gameConfig.offline;
    const cappedSeconds = Math.min(Math.max(0, secondsAway), maxSeconds);
    const amount = this.passiveIncomePerSecond.mul(cappedSeconds * efficiency);
    return { secondsAway, cappedSeconds, amount };
  }
}
