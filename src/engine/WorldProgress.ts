import Decimal from 'break_infinity.js';
import { WORLD_EXP_STEP, WORLD_PERIODS } from '@data/worldStages';

/**
 * Чистый расчёт стадии МИРА из totalEarned. Без DOM/Pixi.
 *
 * Шкала: period = floor(log10(totalEarned) / WORLD_EXP_STEP), зажат [0, PERIODS-1].
 *   задний фон:     era = floor(period / 2) — меняется каждый второй период (6 эпох);
 *   растительность:  phase = period        — каждый период (в 2 раза чаще фона).
 *
 * Прогресс к следующему периоду считается В ЛОГАХ (равномерный темп для игрока):
 *   progress = (log10(total) - a*STEP) / STEP, где a — номер текущего периода.
 *
 * Hot path: вызывается раз в тик из UIManager чипа. Аллокаций нет: log10()
 * у Decimal — примитив, объект результата создается ровно один раз на смене
 * стадии и кэшируется в WorldWatch (см. ниже).
 */
export interface WorldStage {
  /** Период лог-шкалы 0..PERIODS-1 (= фаза растительности). */
  readonly period: number;
  /** Эпоха заднего фона floor(period/2). */
  readonly era: number;
  /** Прогресс к следующему периоду 0..1 (в последнем периоде = 1). */
  readonly eraProgress: number;
}

const LAST_PERIOD = WORLD_PERIODS - 1;

export function calcWorldStage(totalEarned: Decimal): WorldStage {
  const log = Math.max(0, totalEarned.log10());
  const raw = log / WORLD_EXP_STEP;
  const period = Math.min(Math.floor(raw), LAST_PERIOD);

  let eraProgress = 1;
  if (period < LAST_PERIOD) {
    const frac = raw - period; // позиция внутри периода [0..1)
    eraProgress = Math.min(1, Math.max(0, frac));
  }

  return { period, era: Math.floor(period / 2), eraProgress };
}

/**
 * Наблюдатель стадии: кэширует последний WorldStage, аллоцирует новый объект
 * ТОЛЬКО при смене периода. UI подписывается на 'world:changed' и читает
 * .stage — в тике достаточно сравнить period (примитив) без аллокаций.
 */
export class WorldWatch {
  private current: WorldStage = { period: -1, era: -1, eraProgress: 0 };

  /** Обновить по totalEarned; true = период сменился (эмит 'world:changed'). */
  update(totalEarned: Decimal): boolean {
    const s = calcWorldStage(totalEarned);
    if (s.period === this.current.period) return false;
    this.current = s;
    return true;
  }

  get stage(): WorldStage {
    return this.current;
  }
}
