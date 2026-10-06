import Decimal from 'break_infinity.js';
import { gameConfig } from '@data/gameConfig';
import { LOCATIONS, getLocation } from '@data/locations';
import type { SceneKind } from '@data/assets';
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

  /**
   * Индекс текущей локации (индекс в LOCATIONS, см. data/locations.ts).
   * Капом ЭТОЙ локации ограничена прокачка объектов; переход дальше —
   * только при 100% прокачки (advanceLocation). Сидется в снапшот.
   */
  location: number;

  /**
   * Текущая СЦЕНА (Дом/Улица, см. data/assets.ts SceneKind). Сессионная:
   * в сейв НЕ пишется (старт всегда с улицы) — инвариант сцен сохранён.
   * Меняет МЕСТО объектов и даёт бонус ровно одному из потоков дохода:
   * home — +15% пассива, street — +15% тапа (см. gameConfig.sceneBonus).
   */
  scene: SceneKind;

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
    this.location = 0;
    this.scene = 'street'; // сессия всегда начинается с улицы
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

  // ------------------------------------------------------------- локации

  /** Определение текущей локации (name/icon/start/cap/base). */
  get locationDef() {
    return getLocation(this.location);
  }

  /** Максимальный уровень объекта НА ТЕКУЩЕЙ ЛОКАЦИИ (гейт прогресса). */
  getLevelCap(): number {
    return this.locationDef.cap;
  }

  /** Объект упёрся в кап текущей локации — дальше не качается до перехода. */
  isLocationCapped(def: ObjectDef): boolean {
    return def.currentLevel >= this.getLevelCap();
  }

  /** Средний уровень всех объектов — душа прогресса локации. */
  averageLevel(): number {
    let sum = 0;
    for (const o of objectDefs) sum += o.currentLevel;
    return sum / objectDefs.length;
  }

  /**
   * Прогресс текущей локации 0..1 от ПРОКАЧКИ (не от денег):
   * 0 — ничего не накачано, 1 — все объекты на капе локации.
   * Считается на примитивах, аллокаций нет (зовётся из тика кольца).
   */
  locationProgress(): number {
    const loc = this.locationDef;
    const span = loc.cap - loc.base;
    if (span <= 0) return 1;
    const frac = (this.averageLevel() - loc.base) / span;
    return frac <= 0 ? 0 : frac >= 1 ? 1 : frac;
  }

  /** Можно ли переходить дальше: прокачка локации 100% и это не финал. */
  canAdvanceLocation(): boolean {
    return this.location < LOCATIONS.length - 1 && this.locationProgress() >= 1;
  }

  /**
   * Перейти на следующую локацию. false — нельзя (не вкачано или финал).
   * НАГРАДА ЗА ПЕРЕХОД (владелец 2026-10-04): +1 уровень ВСЕМ объектам — на новой
   * локации игрок стартует с её base (89 → 90), а не остаётся на прошлом капе.
   * Кэши потоков пересчитываются, сцена/HUD перечитывают уровни (objects:changed).
   */
  advanceLocation(): boolean {
    if (!this.canAdvanceLocation()) return false;
    this.location += 1;
    for (const o of objectDefs) {
      o.currentLevel = Math.min(o.maxLevel, o.currentLevel + 1);
    }
    this.invalidateCaches();
    events.emit('objects:changed', undefined);
    return true;
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
   *             грейда (levelsPerTier) и не дальше КАПА локации — прогресс-бар
   *             доливается, новый грейд/уровень уже закрыт.
   * count ≤ 0 (нельзя/не куплено/кап локации/не хватает денег) — тогда cost = цена
   * СЛЕДУЮЩЕГО уровня: UI показывает её на кнопке выключенной покупки.
   */
  getBuyPlan(def: ObjectDef, mode: BuyMode): { count: number; cost: Decimal } {
    const next = this.getUpgradeCost(def);
    // Кап прокачки: не выше ни дефа (глобальный), ни капа текущей локации.
    const cap = Math.min(def.maxLevel, this.getLevelCap());
    if (this.isMaxed(def) || !this.isUnlocked(def) || def.currentLevel >= cap || this.money.lt(next)) {
      return { count: 0, cost: next };
    }

    // Грейд — каждые levelsPerTier уровней. Уровень 0 (объект не куплен) считаем
    // НАЧАЛОМ грейда: «до конца грейда» = perTier уровней, а не 0.
    const perTier = gameConfig.tiers.levelsPerTier;
    const toTierEnd = perTier - (def.currentLevel % perTier);
    const budget = mode === 'one'
      ? 1
      : Math.min(toTierEnd, cap - def.currentLevel);

    let count = 1;
    let cost = next;
    while (count < budget) {
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

  // ----------------------------------------------------------------- scene

  /**
   * Смена сцены (Дом ↔ Улица): меняет множители потоков. Сценовый бонус —
   * РОВНО 15% от итогового потока (после весов/тиров), поэтому он живёт
   * МНОЖИТЕЛЕМ В КОНЦЕ формулы, а не в весах объектов. Стартовая сцена —
   * улица (сессия начинается там, сейв сцену не хранит).
   */
  setScene(scene: SceneKind): void {
    if (this.scene === scene) return;
    this.scene = scene;
    // Оба потока зависят от сцены — пересчитываем оба кэша.
    this.invalidateCaches();
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
      if (this.scene === 'street') {
        // Бонус улицы: тап ×1.15 (пассив остаётся стандартным).
        cached = cached.mul(1 + gameConfig.sceneBonus.tapBonus);
      }
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
    if (this.scene === 'home') {
      // Бонус дома: пассив ×1.15 (тап остаётся стандартным).
      this.passiveIncomePerSecond = this.passiveIncomePerSecond.mul(1 + gameConfig.sceneBonus.passiveBonus);
    }
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
    this.location = 0; // сброс — назад в Гомель
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
      location: this.location,
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

    // Локация: поле в сейве есть — верим ему; нет (сейв до локаций) — выводим
    // из среднего уровня. Уровни выше капа подрезаем — старый сейв мог быть
    // накачан дальше (был глобальный maxLevel без локаций).
    const stored = snap.location;
    this.location = typeof stored === 'number' && Number.isFinite(stored)
      ? Math.max(0, Math.min(LOCATIONS.length - 1, Math.floor(stored)))
      : this.deriveLocationFromLevel(this.averageLevel());
    const cap = this.getLevelCap();
    for (const o of objectDefs) {
      if (o.currentLevel > cap) o.currentLevel = cap;
    }

    // Потоки пересчитываем из дефов, а не верим сейву — защита от рассинхрона.
    this.invalidateCaches();
    events.emit('objects:changed', undefined); // сцена должна перечитать owned/тиры
  }

  /**
   * Локация по среднему уровню — миграция сейвов, созданных ДО введения локаций:
   * уровень уже выше 89 → сразу подходящая локация, прогресс не теряется.
   */
  private deriveLocationFromLevel(avg: number): number {
    let index = 0;
    for (let i = 1; i < LOCATIONS.length; i++) {
      if (avg >= LOCATIONS[i].base) index = i;
      else break;
    }
    return index;
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
