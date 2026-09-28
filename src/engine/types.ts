import type Decimal from 'break_infinity.js';

/** Группа объектов = вкладка снизу. Новая вкладка = ключ сюда + объекты в data/objects.ts. */
export type ObjectGroup = 'property' | 'outfit' | 'workplace' | 'skills';

/** id всех прокачиваемых объектов игры. */
export type ObjectId =
  | 'house' | 'car' | 'bg'
  | 'watch' | 'hair' | 'clothes'
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

/**
 * Сериализуемый снимок состояния (формат v2 — экономика P/A-потоков).
 * subscribers опционален: сейвы v2 до введения подписчиков валидны без него.
 */
export interface GameStateSnapshot {
  version: 2;
  money: string;
  totalEarned: string;
  tapsCount: number;
  /** id -> уровень (сохраняются только уровни > 0). */
  objects: Record<string, number>;
  subscribers?: SubscriberState;
  savedAt: number;
}

/** Прогресс подписчиков: шкала с накоплением и наградой за заполнение. */
export interface SubscriberState {
  /** Всего подписчиков за всё время (дробная часть — внутренняя точность потока). */
  count: number;
  /** Накопленный прогресс к текущей цели (сбрасывается при claim). */
  progress: number;
  /** Сколько наград уже забрано. */
  claimed: number;
  /** Цель набрана — чип кликабелен, ждёт награды. */
  claimable: boolean;
  /**
   * Цель ТЕКУЩЕГО цикла: фиксируется в момент старта цикла и НЕ тянется
   * за ростом дохода за клик. После claim: goal += goalMult × (тап на момент клейма).
   * 0 = цель ещё не посчитана (инициализируется лениво от текущего тапа).
   */
  goal: number;
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
  /** Прогресс подписчиков изменился (тикающий прирост или бонус за клики). */
  'subscribers:changed': undefined;
  /** Цель подписчиков набрана — чип кликабелен за награду. */
  'subscribers:ready': undefined;
  /** Уровни объектов изменены массово (applyLevels/загрузка сейва) — сцене надо перечитать всё. */
  'objects:changed': undefined;
  /** Период мира сменился (порог по totalEarned): фон/растительность + чип эпохи. */
  'world:changed': { period: number; era: number };
};
