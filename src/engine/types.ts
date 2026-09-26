import type Decimal from 'break_infinity.js';

/** Группа объектов = вкладка снизу. Новая вкладка = ключ сюда + объекты в data/objects.ts. */
export type ObjectGroup = 'property' | 'outfit' | 'workplace' | 'skills';

/** id всех прокачиваемых объектов игры. */
export type ObjectId =
  | 'house' | 'car' | 'bg'
  | 'watch' | 'face' | 'clothes'
  | 'tech' | 'pc' | 'furniture'
  | 'charisma' | 'emotion' | 'humor';

/**
 * Прокачиваемый объект. Статические данные задаёт data/objects.ts;
 * currentLevel — единственное мутируемое поле (runtime-состояние, живёт в дефе).
 */
export interface ObjectDef {
  readonly id: ObjectId;
  readonly name: string;
  readonly group: ObjectGroup;
  readonly icon: string;
  /** Уровень нового игрока: 1 = объект есть сразу (дом), 0 = объект нужно купить. */
  readonly startLevel: 0 | 1;
  /** Цена уровня 1. Для startLevel: 0 это и есть цена «покупки» объекта. */
  readonly costBase: Decimal;
  /** Множитель цены за каждый следующий уровень. */
  readonly costGrowth: number;
  /** Вклад уровня в АКТИВНЫЙ поток: +aWeight×100% к базе тапа. */
  readonly aWeight: number;
  /** Вклад уровня в ПАССИВНЫЙ поток: +pWeight×100% к базе пассива. */
  readonly pWeight: number;
  readonly maxLevel: number;
  /** Короткая подпись-вкусняшка в карточке. */
  readonly desc: string;
  /** Объект нельзя купить, пока у этого объекта уровень 0 (гейт веток). */
  readonly requires?: ObjectId;
  /** Названия визуальных стадий (index = tier); показывается в карточке. */
  readonly tierNames?: readonly string[];
  /** Текущий уровень (runtime). НЕ задавать вручную вне GameState. */
  currentLevel: number;
}

/** Сериализуемый снимок состояния (формат v2 — экономика P/A-потоков). */
export interface GameStateSnapshot {
  version: 2;
  money: string;
  totalEarned: string;
  tapsCount: number;
  /** id -> уровень (сохраняются только уровни > 0). */
  objects: Record<string, number>;
  savedAt: number;
}

/** Параметры офлайн-дохода. */
export interface OfflineEarnings {
  secondsAway: number;
  cappedSeconds: number;
  amount: Decimal;
}

/** Карта событий игры: имя -> тип payload. Единственный контракт связи слоёв. */
export type GameEventMap = {
  'tick': undefined;
  'money:changed': undefined;
  'game:saved': undefined;
  'game:reset': undefined;
  'offline:income': { title: string; body: string };
  'tap:earned': { amount: Decimal; totalTaps: number };
  /** Уровень любого объекта вырос (включая первую покупку-«анлок»). */
  'object:levelup': ObjectDef;
};
