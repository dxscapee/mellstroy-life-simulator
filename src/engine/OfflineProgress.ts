import { gameConfig } from '@data/gameConfig';
import type { GameState } from './GameState';
import type { OfflineEarnings } from './types';
import { formatMoney, formatTime } from './format';

/**
 * Офлайн-прогресс: считаем время между savedAt прошлого сейва и текущим запуском,
 * начисляем процент от пассивного дохода за это время.
 */
export class OfflineProgress {
  /** Посчитать результат офлайна по таймстемпу прошлого сейва (null = первый запуск). */
  static calc(state: GameState, lastSavedAt: number | null): OfflineEarnings | null {
    const { minSecondsToShow } = gameConfig.offline;

    if (lastSavedAt === null || !Number.isFinite(lastSavedAt)) return null;

    const secondsAway = (Date.now() - lastSavedAt) / 1000;
    // Отрицательное/нулевое = часы переведены вперёд или сейв из «будущего» — игнорируем.
    if (secondsAway < minSecondsToShow) return null;

    const result = state.calcOfflineEarnings(secondsAway);
    // Начислять нечего — модалку не показываем.
    if (result.amount.lte(0)) return null;

    return result;
  }

  /** Начислить деньги и вернуть готовые строки для модалки. */
  static apply(state: GameState, earnings: OfflineEarnings): { title: string; body: string } {
    state.addMoney(earnings.amount);

    return {
      title: 'С возвращением!',
      body:
        `Вас не было ${formatTime(earnings.cappedSeconds)}. ` +
        `Ваш бизнес заработал ${formatMoney(earnings.amount)}.`,
    };
  }
}
