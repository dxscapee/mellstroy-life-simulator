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
};

// ==================== ИМУЩЕСТВО (фон + сцена) ====================

const house: ObjectDef = {
  id: 'house', name: 'Дом', group: 'property', icon: '🏠',
  startLevel: 1, costBase: $(75), costGrowth: 1.35,
  aWeight: 0.05, pWeight: 0.15, maxLevel: 100,
  desc: 'Твой угл. Пассивный поток и престиж.',
  tierNames: HOUSE_STAGES,
  currentLevel: 1,
};

const car: ObjectDef = {
  id: 'car', name: 'Тачка', group: 'property', icon: '🚗',
  startLevel: 0, costBase: $(1_000), costGrowth: 1.4,
  aWeight: 0.25, pWeight: 0.1, maxLevel: 100,
  desc: 'Быстрее добираться до съёмок: качает тап.',
  requires: 'house',
  tierNames: TIER_STAGES.car,
  currentLevel: 0,
};

const bg: ObjectDef = {
  id: 'bg', name: 'Двор', group: 'property', icon: '🌆',
  startLevel: 0, costBase: $(300), costGrowth: 1.45,
  aWeight: 0.1, pWeight: 0.1, maxLevel: 100,
  desc: 'Чем богаче фон, тем больше подписчиков.',
  requires: 'house',
  currentLevel: 0,
};

// ==================== ШМОТ (сильный активный поток) ====================

const watch: ObjectDef = {
  id: 'watch', name: 'Часы', group: 'outfit', icon: '⌚',
  startLevel: 0, costBase: $(150), costGrowth: 1.35,
  aWeight: 0.3, pWeight: 0.02, maxLevel: 100,
  desc: 'Статус на запястье: мощно бустит тап.',
  requires: 'house',
  currentLevel: 0,
};

const face: ObjectDef = {
  id: 'face', name: 'Лицо', group: 'outfit', icon: '😎',
  startLevel: 0, costBase: $(250), costGrowth: 1.35,
  aWeight: 0.2, pWeight: 0.05, maxLevel: 100,
  desc: 'Улыбка решает: тап и немного пассива.',
  requires: 'house',
  currentLevel: 0,
};

const clothes: ObjectDef = {
  id: 'clothes', name: 'Шмот', group: 'outfit', icon: '👕',
  startLevel: 0, costBase: $(400), costGrowth: 1.35,
  aWeight: 0.15, pWeight: 0.08, maxLevel: 100,
  desc: 'Брендовый лук для контента.',
  requires: 'house',
  currentLevel: 0,
};

// ==================== РАБОЧЕЕ МЕСТО (пассивный поток) ====================

const tech: ObjectDef = {
  id: 'tech', name: 'Техника', group: 'workplace', icon: '📹',
  startLevel: 0, costBase: $(750), costGrowth: 1.4,
  aWeight: 0.05, pWeight: 0.2, maxLevel: 100,
  desc: 'Свет, камера, монтаж: пассив капает сам.',
  requires: 'house',
  currentLevel: 0,
};

const pc: ObjectDef = {
  id: 'pc', name: 'Комп', group: 'workplace', icon: '🖥️',
  startLevel: 0, costBase: $(2_000), costGrowth: 1.4,
  aWeight: 0.05, pWeight: 0.25, maxLevel: 100,
  desc: 'Рендер быстрее — видео чаще.',
  requires: 'tech',
  currentLevel: 0,
};

const furniture: ObjectDef = {
  id: 'furniture', name: 'Мебель', group: 'workplace', icon: '🪑',
  startLevel: 0, costBase: $(5_000), costGrowth: 1.4,
  aWeight: 0.05, pWeight: 0.3, maxLevel: 100,
  desc: 'Комфортное место силы: максимум пассива.',
  requires: 'tech',
  currentLevel: 0,
};

// ==================== НАВЫКИ (мультипликаторы тапа) ====================

const charisma: ObjectDef = {
  id: 'charisma', name: 'Харизма', group: 'skills', icon: '🗣️',
  startLevel: 0, costBase: $(1_500), costGrowth: 1.5,
  aWeight: 0.5, pWeight: 0, maxLevel: 50,
  desc: 'Каждый уровень: +50% к доходу за тап.',
  requires: 'pc',
  currentLevel: 0,
};

const emotion: ObjectDef = {
  id: 'emotion', name: 'Эмоциональность', group: 'skills', icon: '😤',
  startLevel: 0, costBase: $(6_000), costGrowth: 1.5,
  aWeight: 0.75, pWeight: 0, maxLevel: 50,
  desc: 'Каждый уровень: +75% к доходу за тап.',
  requires: 'charisma',
  currentLevel: 0,
};

const humor: ObjectDef = {
  id: 'humor', name: 'Юмор', group: 'skills', icon: '🤡',
  startLevel: 0, costBase: $(25_000), costGrowth: 1.5,
  aWeight: 1.0, pWeight: 0, maxLevel: 50,
  desc: 'Каждый уровень: +100% к доходу за тап.',
  requires: 'emotion',
  currentLevel: 0,
};

// ==================== РЕЕСТРЫ ====================

export const objectDefs: readonly ObjectDef[] = [
  house, car, bg,
  watch, face, clothes,
  tech, pc, furniture,
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
