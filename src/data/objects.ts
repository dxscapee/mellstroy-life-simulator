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
 */

// ---------- ЛОКАЛЬНЫЕ ССЫЛКИ (не экспортировать наружу!) ----------
const $ = (n: number) => new Decimal(n);

/** Визуальные стадии дома: index = тир (каждые TIERS.levelsPerTier уровней). */
const HOUSE_STAGES = ['Коробка', 'Комната', 'Квартира', 'Пентхаус'] as const;

// Названия стадий описывают ТОЛЬКО купленный объект (владение = флаг owned):
// тачка уровней 1–4 — «Велик», 5–9 — «Лада», 10+ — «Ламба».
const TIER_STAGES: Partial<Record<ObjectId, readonly string[]>> = {
  house: HOUSE_STAGES,
  car: ['Велик', 'Лада', 'Ламба'],
  bg: ['Пустырь', 'Асфальт', 'Паркет'],
  tech: ['Микрофон', 'Студийный', 'Золотой'],
  pc: ['Ноут', 'Монитор', 'Супер-ПК'],
  furniture: ['Табурет', 'Кресло', 'Трон'],
  watch: ['Браслет', 'Часы', 'Тайм-золото'],
  hair: ['Кудри', 'Ирокез', 'Косички'],
  clothes: ['Футболка', 'Худи', 'Шуба'],
};

// ==================== ИМУЩЕСТВО (фон + сцена) ====================

const house: ObjectDef = {
  id: 'house', name: 'Дом', group: 'property', icon: '🏠',
  startLevel: 1, costBase: $(75), costGrowth: 1.15,
  aWeight: 0.05, pWeight: 0.25, maxLevel: 100,
  desc: 'Твой угл. Основной источник пассива.',
  tierNames: HOUSE_STAGES,
  currentLevel: 1,
};

const car: ObjectDef = {
  id: 'car', name: 'Тачка', group: 'property', icon: '🚗',
  startLevel: 0, costBase: $(100), costGrowth: 1.15,
  aWeight: 0.06, pWeight: 0.20, maxLevel: 100,
  desc: 'Возит на съёмки: пассив капает стабильнее.',
  requires: 'house',
  tierNames: TIER_STAGES.car,
  currentLevel: 0,
};

const bg: ObjectDef = {
  id: 'bg', name: 'Двор', group: 'property', icon: '🌆',
  startLevel: 0, costBase: $(100), costGrowth: 1.15,
  aWeight: 0.04, pWeight: 0.18, maxLevel: 100,
  desc: 'Чем богаче фон, тем больше подписчиков.',
  requires: 'house',
  tierNames: TIER_STAGES.bg,
  currentLevel: 0,
};

// ==================== ШМОТ (пассивный поток) ====================

const watch: ObjectDef = {
  id: 'watch', name: 'Часы', group: 'outfit', icon: '⌚',
  startLevel: 0, costBase: $(100), costGrowth: 1.15,
  aWeight: 0.05, pWeight: 0.20, maxLevel: 100,
  desc: 'Статус на запястье: пассив капает бодрее.',
  requires: 'house',
  tierNames: TIER_STAGES.watch,
  currentLevel: 0,
};

const hair: ObjectDef = {
  id: 'hair', name: 'Причёска', group: 'outfit', icon: '💇',
  startLevel: 0, costBase: $(100), costGrowth: 1.15,
  aWeight: 0.05, pWeight: 0.18, maxLevel: 100,
  desc: 'Причёска решает: подписчики за стиль.',
  requires: 'house',
  tierNames: TIER_STAGES.hair,
  currentLevel: 0,
};

const clothes: ObjectDef = {
  id: 'clothes', name: 'Шмот', group: 'outfit', icon: '👕',
  startLevel: 0, costBase: $(100), costGrowth: 1.15,
  aWeight: 0.04, pWeight: 0.20, maxLevel: 100,
  desc: 'Брендовый лук: подписчики за стиль.',
  requires: 'house',
  tierNames: TIER_STAGES.clothes,
  currentLevel: 0,
};

// ==================== РАБОЧЕЕ МЕСТО (активный поток) ====================

const tech: ObjectDef = {
  id: 'tech', name: 'Микрофон', group: 'workplace', icon: '🎙️',
  startLevel: 0, costBase: $(100), costGrowth: 1.15,
  aWeight: 0.25, pWeight: 0.05, maxLevel: 100,
  desc: 'Голос решает: каждый тап жирнее.',
  requires: 'house',
  tierNames: TIER_STAGES.tech,
  currentLevel: 0,
};

const pc: ObjectDef = {
  id: 'pc', name: 'Комп', group: 'workplace', icon: '🖥️',
  startLevel: 0, costBase: $(100), costGrowth: 1.15,
  aWeight: 0.35, pWeight: 0.05, maxLevel: 100,
  desc: 'Монтаж быстрее: тап бьёт сильнее.',
  requires: 'tech',
  tierNames: TIER_STAGES.pc,
  currentLevel: 0,
};

const furniture: ObjectDef = {
  id: 'furniture', name: 'Мебель', group: 'workplace', icon: '🪑',
  startLevel: 0, costBase: $(100), costGrowth: 1.15,
  aWeight: 0.45, pWeight: 0.05, maxLevel: 100,
  desc: 'Комфортное место силы: максимум с тапа.',
  requires: 'tech',
  tierNames: TIER_STAGES.furniture,
  currentLevel: 0,
};

// ==================== НАВЫКИ (мультипликаторы тапа) ====================

const charisma: ObjectDef = {
  id: 'charisma', name: 'Харизма', group: 'skills', icon: '🗣️',
  startLevel: 0, costBase: $(500), costGrowth: 1.25,
  aWeight: 0.8, pWeight: 0, maxLevel: 50,
  desc: 'Каждый уровень: +80% к доходу за тап.',
  requires: 'pc',
  currentLevel: 0,
};

const emotion: ObjectDef = {
  id: 'emotion', name: 'Эмоциональность', group: 'skills', icon: '😤',
  startLevel: 0, costBase: $(1000), costGrowth: 1.25,
  aWeight: 1.2, pWeight: 0, maxLevel: 50,
  desc: 'Каждый уровень: +120% к доходу за тап.',
  requires: 'charisma',
  currentLevel: 0,
};

const humor: ObjectDef = {
  id: 'humor', name: 'Юмор', group: 'skills', icon: '🤡',
  startLevel: 0, costBase: $(2000), costGrowth: 1.25,
  aWeight: 1.5, pWeight: 0, maxLevel: 50,
  desc: 'Каждый уровень: +150% к доходу за тап.',
  requires: 'emotion',
  currentLevel: 0,
};

// ==================== РЕЕСТРЫ ====================

export const objectDefs: readonly ObjectDef[] = [
  house, car, bg,
  watch, hair, clothes,
  furniture, pc, tech, // порядок карточек = порядку на сцене: стул → монитор → микрофон
  charisma, emotion, humor,
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
  outfit:    { label: 'Шмот',      icon: '👕' },
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
