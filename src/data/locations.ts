import { gameConfig } from '@data/gameConfig';

/**
 * ЛОКАЦИИ — каркас мета-прогресса (решение владельца 2026-10-03).
 *
 * Всего пять: Гомель → Москва-сити → Дубай → Турция → Кипр.
 * Уровни ГЛОБАЛЬНЫЕ (не сбрасываются): каждая локация — полоса из
 * gameConfig.locations.stages ступеней × tiers.levelsPerTier уровней
 * (3 × 30 = 90 уровней): 0–89, 90–179, 180–269, 270–359, 360–449.
 *
 * ГЕЙТ: перейти на следующую локацию можно только когда ВСЕ объекты
 * накачаны до cap текущей (прогресс-кольцо = 100%). Пока не перешли —
 * прокачка объектов ограничена cap (GameState.getBuyPlan).
 *
 * Прогресс-кольцо HUD считается от ПРОКАЧКИ (средний уровень объектов),
 * а не от денег: 0% — ничего не накачано, 100% — всё на капе.
 * index локации — это ещё и ключ ассета её фона: world/<index> (ASSETS.md).
 */

export interface LocationDef {
  /** Индекс локации 0..N-1 (он же стадия ассета фона world/<index>). */
  readonly index: number;
  readonly name: string;
  readonly icon: string;
  /** Первый уровень локации. */
  readonly start: number;
  /** Последний уровень локации — целевая прокачка для перехода дальше. */
  readonly cap: number;
  /** База шкалы прогресса: уровень, с которого ползёт бар (0 / предыдущий cap). */
  readonly base: number;
}

/** Сырые данные локаций: только имя и иконка, диапазоны считаются от конфига. */
const LOCATION_SEEDS = [
  { name: 'Гомель', icon: '🏡' },
  { name: 'Москва-сити', icon: '🏙️' },
  { name: 'Дубай', icon: '🏗️' },
  { name: 'Турция', icon: '🌴' },
  { name: 'Кипр', icon: '🏝️' },
] as const;

/** Уровней в локации: ступени прокачки × уровней в ступени (3 × 30 = 90). */
export const LEVELS_PER_LOCATION =
  gameConfig.tiers.levelsPerTier * gameConfig.locations.stages;

export const LOCATIONS: readonly LocationDef[] = LOCATION_SEEDS.map((seed, index) => {
  const start = index * LEVELS_PER_LOCATION;
  return {
    index,
    name: seed.name,
    icon: seed.icon,
    start,
    cap: start + LEVELS_PER_LOCATION - 1, // 89, 179, 269, 359, 449
    base: index === 0 ? 0 : start - 1,    // 0, 89, 179, 269, 359
  };
});

/** Глобальный максимум уровней объектов = кап последней локации (449). */
export const MAX_LEVEL = LOCATIONS[LOCATIONS.length - 1].cap;

/** Локация по индексу с клампом (выше списка = последняя). */
export function getLocation(index: number): LocationDef {
  const i = Math.max(0, Math.min(LOCATIONS.length - 1, Math.floor(index)));
  return LOCATIONS[i];
}
