import Decimal from 'break_infinity.js';
import { gameConfig } from '@data/gameConfig';
import { objectById, objectDefs } from '@data/objects';
import type { GameStateSnapshot, ObjectDef, OfflineEarnings } from './types';

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

  /** Кэш активного потока (доход за тап): пересобирается после изменения уровней. */
  private cachedMoneyPerTap: Decimal | null = null;

  constructor() {
    this.money = gameConfig.startingMoney.add(0);
    this.passiveIncomePerSecond = new Decimal(0);
    this.totalEarned = new Decimal(0);
    this.tapsCount = 0;
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
    if (this.isMaxed(def) || !this.isUnlocked(def)) return false;

    const cost = this.getUpgradeCost(def);
    if (this.money.lt(cost)) return false;

    this.money = this.money.sub(cost);
    def.currentLevel += 1; // уровень живёт в дефе — единый источник правды
    this.invalidateCaches();
    return true;
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

  /** Доход за один тап (активный поток). Кэш — Decimal-операции аллоцируют. */
  getMoneyPerTap(): Decimal {
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
    for (const o of objectDefs) o.currentLevel = o.startLevel;
    this.invalidateCaches();
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
      savedAt: Date.now(),
    };
  }

  loadFromSnapshot(snap: GameStateSnapshot): void {
    this.money = new Decimal(snap.money ?? '0');
    this.totalEarned = new Decimal(snap.totalEarned ?? '0');
    this.tapsCount = snap.tapsCount ?? 0;

    // Сбрасываем уровни до стартовых, затем накатываем из сейва.
    for (const o of objectDefs) o.currentLevel = o.startLevel;
    if (snap.objects) {
      for (const [id, level] of Object.entries(snap.objects)) {
        const def = objectById.get(id as ObjectDef['id']);
        if (def && Number.isFinite(level) && level > 0) {
          def.currentLevel = Math.min(Math.floor(level), def.maxLevel);
        }
      }
    }

    // Потоки пересчитываем из дефов, а не верим сейву — защита от рассинхрона.
    this.invalidateCaches();
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
  }

  /** Сколько денег накопилось бы за время offlineSeconds (с эффективностью офлайна). */
  calcOfflineEarnings(secondsAway: number): OfflineEarnings {
    const { maxSeconds, efficiency } = gameConfig.offline;
    const cappedSeconds = Math.min(Math.max(0, secondsAway), maxSeconds);
    const amount = this.passiveIncomePerSecond.mul(cappedSeconds * efficiency);
    return { secondsAway, cappedSeconds, amount };
  }
}
