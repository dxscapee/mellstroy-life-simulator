import Decimal from 'break_infinity.js';
import { gameConfig } from '@data/gameConfig';
import type { ObjectDef, ObjectGroup, ObjectId } from '@engine/types';

/**
 * Дата-драйвен список всех прокачиваемых объектов. UI, сцена и экономика
 * читают отсюда. Новый объект = одна запись в массив (строка в TIER_STAGES
 * добавляется только если его надо рисовать на сцене).
 *
 * Экономика P/A-потоков (см. gameConfig):
 *   A = moneyPerTap  * (1 + Σ aWeight * level)  — доход за тап
 *   P = passiveBase  * (1 + Σ pWeight * level)  — доход в секунду
 * Объект со startLevel: 0 даёт вклад 0, пока не куплен (уровень 1+).
 *
 * ИМЕНА СТАТИЧНЫ (решение владельца 2026-10-03): `name` не меняется от
 * прокачки, названия обобщённые («Недвижимость», «Транспорт», «Камера»…).
 * `tierNames` остались ТОЛЬКО как число визуальных стадий сцены (сколько
 * текстур рисует владелец) — в карточке они больше не показываются.
 */

// ---------- ЛОКАЛЬНЫЕ ССЫЛКИ (не экспортировать наружу!) ----------
const $ = (n: number) => new Decimal(n);

/** Визуальные стадии дома: index = тир. Задают ЧИСЛО стадий текстуры. */
const HOUSE_STAGES = ['Коробка', 'Комната', 'Квартира', 'Пентхаус'] as const;

/**
 * Число визуальных стадий для сценовых объектов (в карточке НЕ показываются —
 * имена статичны). length = сколько текстур-стадий ждёт пайплайн (ASSETS.md).
 * Объекты без записи здесь на сцене не рисуются (навыки).
 */
const TIER_STAGES: Partial<Record<ObjectId, readonly string[]>> = {
  house: HOUSE_STAGES,
  car: ['Велик', 'Лада', 'Ламба'],
  bg: ['Пустырь', 'Асфальт', 'Паркет'],
  camera: ['Камера', 'Профи-камера', 'Студийная'],
  pc: ['Ноут', 'Монитор', 'Супер-ПК'],
  furniture: ['Табурет', 'Кресло', 'Трон'],
  watch: ['Браслет', 'Часы', 'Тайм-золото'],
  hair: ['Кудри', 'Ирокез', 'Косички'],
  clothes: ['Футболка', 'Худи', 'Шуба'],
};

// ==================== ИМУЩЕСТВО (фон + сцена) ====================

const house: ObjectDef = {
  id: 'house', name: 'Недвижимость', group: 'property', icon: '🏠',
  startLevel: 1, costBase: $(75), costGrowth: gameConfig.pricing.upgradeMarkup,
  aWeight: 0.05, pWeight: 0.25, maxLevel: 100,
  desc: 'Твой угол. Основной источник пассива.',
  tierNames: HOUSE_STAGES,
  currentLevel: 1,
};

const car: ObjectDef = {
  id: 'car', name: 'Транспорт', group: 'property', icon: '🚗',
  startLevel: 0, costBase: $(100), costGrowth: gameConfig.pricing.upgradeMarkup,
  aWeight: 0.06, pWeight: 0.20, maxLevel: 100,
  desc: 'Возит на съёмки: пассив капает стабильнее.',
  requires: 'house',
  tierNames: TIER_STAGES.car,
  currentLevel: 0,
};

const bg: ObjectDef = {
  id: 'bg', name: 'Двор', group: 'property', icon: '🌆',
  startLevel: 0, costBase: $(100), costGrowth: gameConfig.pricing.upgradeMarkup,
  aWeight: 0.04, pWeight: 0.18, maxLevel: 100,
  desc: 'Чем богаче двор, тем больше подписчиков.',
  requires: 'house',
  tierNames: TIER_STAGES.bg,
  currentLevel: 0,
};

// ==================== ОДЕЖДА (пассивный поток) ====================

const watch: ObjectDef = {
  id: 'watch', name: 'Часы', group: 'outfit', icon: '⌚',
  startLevel: 0, costBase: $(100), costGrowth: gameConfig.pricing.upgradeMarkup,
  aWeight: 0.05, pWeight: 0.20, maxLevel: 100,
  desc: 'Статус на запястье: пассив капает бодрее.',
  requires: 'house',
  tierNames: TIER_STAGES.watch,
  currentLevel: 0,
};

const hair: ObjectDef = {
  id: 'hair', name: 'Причёска', group: 'outfit', icon: '💇',
  startLevel: 0, costBase: $(100), costGrowth: gameConfig.pricing.upgradeMarkup,
  aWeight: 0.05, pWeight: 0.18, maxLevel: 100,
  desc: 'Причёска решает: подписчики за стиль.',
  requires: 'house',
  tierNames: TIER_STAGES.hair,
  currentLevel: 0,
};

const clothes: ObjectDef = {
  id: 'clothes', name: 'Одежда', group: 'outfit', icon: '👕',
  startLevel: 0, costBase: $(100), costGrowth: gameConfig.pricing.upgradeMarkup,
  aWeight: 0.04, pWeight: 0.20, maxLevel: 100,
  desc: 'Брендовый лук: подписчики за стиль.',
  requires: 'house',
  tierNames: TIER_STAGES.clothes,
  currentLevel: 0,
};

// ==================== РАБОЧЕЕ МЕСТО (активный поток) ====================
// Порядок покупки = порядок карточек: КАМЕРА → МЕБЕЛЬ → КОМП.
// Камера — первая и открывает всю ветку (включая навыки).

const camera: ObjectDef = {
  id: 'camera', name: 'Камера', group: 'workplace', icon: '📷',
  startLevel: 0, costBase: $(100), costGrowth: gameConfig.pricing.upgradeMarkup,
  aWeight: 0.25, pWeight: 0.05, maxLevel: 100,
  desc: 'Первый шаг к контенту и ключ ко всей ветке.',
  requires: 'house',
  tierNames: TIER_STAGES.camera,
  currentLevel: 0,
};

const furniture: ObjectDef = {
  id: 'furniture', name: 'Мебель', group: 'workplace', icon: '🪑',
  startLevel: 0, costBase: $(100), costGrowth: gameConfig.pricing.upgradeMarkup,
  aWeight: 0.45, pWeight: 0.05, maxLevel: 100,
  desc: 'Комфортное место силы: максимум с тапа.',
  requires: 'camera',
  tierNames: TIER_STAGES.furniture,
  currentLevel: 0,
};

const pc: ObjectDef = {
  id: 'pc', name: 'Комп', group: 'workplace', icon: '🖥️',
  startLevel: 0, costBase: $(100), costGrowth: gameConfig.pricing.upgradeMarkup,
  aWeight: 0.35, pWeight: 0.05, maxLevel: 100,
  desc: 'Монтаж быстрее: тап бьёт сильнее.',
  requires: 'furniture',
  tierNames: TIER_STAGES.pc,
  currentLevel: 0,
};

// ==================== НАВЫКИ (мультипликаторы тапа) ====================
// Открываются ВСЕ сразу после покупки Камеры — между собой НЕ гейтятся
// (раньше цепочка харизма→эмоция→юмор). Сила и цена растут по порядку:
// Харизма → Интеллект → Юмор → Эмоциональность.

const charisma: ObjectDef = {
  id: 'charisma', name: 'Харизма', group: 'skills', icon: '🗣️',
  startLevel: 0, costBase: $(500), costGrowth: gameConfig.pricing.skillMarkup,
  aWeight: 0.8, pWeight: 0, maxLevel: 50,
  desc: 'Каждый уровень: +80% к доходу за тап.',
  requires: 'camera',
  currentLevel: 0,
};

const intellect: ObjectDef = {
  id: 'intellect', name: 'Интеллект', group: 'skills', icon: '💡',
  startLevel: 0, costBase: $(800), costGrowth: gameConfig.pricing.skillMarkup,
  aWeight: 1.0, pWeight: 0, maxLevel: 50,
  desc: 'Каждый уровень: +100% к доходу за тап.',
  requires: 'camera',
  currentLevel: 0,
};

const humor: ObjectDef = {
  id: 'humor', name: 'Юмор', group: 'skills', icon: '🤡',
  startLevel: 0, costBase: $(1200), costGrowth: gameConfig.pricing.skillMarkup,
  aWeight: 1.2, pWeight: 0, maxLevel: 50,
  desc: 'Каждый уровень: +120% к доходу за тап.',
  requires: 'camera',
  currentLevel: 0,
};

const emotion: ObjectDef = {
  id: 'emotion', name: 'Эмоциональность', group: 'skills', icon: '😤',
  startLevel: 0, costBase: $(2000), costGrowth: gameConfig.pricing.skillMarkup,
  aWeight: 1.5, pWeight: 0, maxLevel: 50,
  desc: 'Каждый уровень: +150% к доходу за тап.',
  requires: 'camera',
  currentLevel: 0,
};

// ==================== РЕЕСТРЫ ====================

export const objectDefs: readonly ObjectDef[] = [
  house, car, bg,
  watch, hair, clothes,
  camera, furniture, pc, // порядок карточек = порядку покупки: камера → мебель → комп
  charisma, intellect, humor, emotion, // все открываются после камеры
];

export const objectById: ReadonlyMap<ObjectId, ObjectDef> = new Map(
  objectDefs.map((o) => [o.id, o]),
);

/** Быстрый доступ по id. */
export function getObject(id: ObjectId): ObjectDef {
  const def = objectById.get(id);
  if (!def) throw new Error(`[objects] Неизвестный id: ${id}`);
  return def;
}

/** Метки и иконки групп-вкладок — единственное место, знающее про группы в UI. */
export const groupMeta: Record<ObjectGroup, { label: string; icon: string }> = {
  property:  { label: 'Имущество', icon: '🏠' },
  outfit:    { label: 'Одежда',    icon: '👕' },
  workplace: { label: 'Рабочее место', icon: '🖥️' },
  skills:    { label: 'Навыки',    icon: '🧠' },
};

/** Порядок вкладок снизу. */
export const groupOrder: readonly ObjectGroup[] = ['property', 'outfit', 'workplace', 'skills'];

/** Объекты группы в порядке объявления. */
export function objectsByGroup(group: ObjectGroup): ObjectDef[] {
  return objectDefs.filter((o) => o.group === group);
}

/** Текущий тир объекта (0..stages-1) по уровню. */
export function tierOf(def: ObjectDef): number {
  if (!def.tierNames) return 0;
  const raw = Math.floor(def.currentLevel / gameConfig.tiers.levelsPerTier);
  return Math.max(0, Math.min(raw, def.tierNames.length - 1));
}

/** Визуальное состояние сценовых объектов (читает GameView). */
export interface SceneObjectInfo {
  id: ObjectId;
  /** Куплен ли объект (уровень > 0); тачка не рисуется, пока false. */
  owned: boolean;
  tier: number;
  stageName: string;
}

/** Собрать визуальное состояние сцены по уровням. */
export function buildSceneState(): SceneObjectInfo[] {
  return objectDefs
    .filter((o) => o.tierNames !== undefined)
    .map((o) => {
      const tier = tierOf(o);
      return { id: o.id, owned: o.currentLevel > 0, tier, stageName: o.tierNames![tier] };
    });
}
