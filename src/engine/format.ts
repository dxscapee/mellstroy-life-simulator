import Decimal from 'break_infinity.js';

/**
 * Единая точка форматирования чисел для всего UI.
 * До 1000 — обычное число, дальше суффиксы (1.25K, 5.80M, 10.12B, ...).
 */
const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag', 'ah', 'ai', 'aj'] as const;

export function formatMoney(value: Decimal): string {
  return formatNumber(value) + '$';
}

export function formatNumber(value: Decimal): string {
  // Защита от NaN/Infinity (например, после читерских операций в консоли).
  if (Number.isNaN(value.m) || !Number.isFinite(value.e)) return '∞';

  const sign = value.lt(0) ? '-' : '';
  const abs = value.abs();

  if (abs.lt(1000)) {
    // Округляем до 2 знаков — иначе дробные балансы выглядят как «66.1333000001».
    const rounded = trimZeros(abs.toFixed(2));
    // Граница: 999.99… округлилось до «1000» — уводим в следующий разряд.
    if (rounded === '1000') return sign + '1K';
    return sign + rounded;
  }

  // Индекс суффикса: каждые 3 порядка.
  const tier = Math.floor(abs.log10() / 3);
  const suffix = SUFFIXES[tier] ?? `e${tier * 3}`;

  // Нормализуем до «X.YY»: делим на 1000^tier.
  const mantissa = abs.div(new Decimal(10).pow(tier * 3));
  const twoDecimals = mantissa.toFixed(2);
  return sign + trimZeros(twoDecimals) + suffix;
}

/** «5.80M» читается лучше, чем «5.80» — но «1.00» показываем как «1». */
function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

export function formatIncomePerSecond(value: Decimal): string {
  return '+' + formatNumber(value) + '/сек';
}

/** Форматирование обычного числа (подписчики, цели шкал) через тот же суффиксный пайплайн. */
export function formatCount(value: number): string {
  return formatNumber(new Decimal(Number.isFinite(value) ? value : 0));
}

export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;

  if (hours > 0) return `${hours} ч ${minutes} мин`;
  if (minutes > 0) return `${minutes} мин ${seconds} сек`;
  return `${seconds} сек`;
}
