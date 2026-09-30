import Decimal from 'break_infinity.js';
import { WORLD_ERA_NAMES, WORLD_VEGETATION_NAMES, WORLD_EXP_STEP } from '@data/worldStages';
import type { WorldWatch } from '@engine/WorldProgress';
import { formatMoney } from '@engine/format';

/**
 * Попап-галерея стадий мира (клик по чипу эпохи в HUD).
 * Показывает все эпохи заднего фона: пройденные, текущую (с прогрессом
 * к следующей) и будущие (с порогом в totalEarned). DOM-строки строятся
 * один раз; обновляется только «текущая» строка и её бар (по дифу).
 *
 * Закрыта = opacity+visibility+pointer-events:none (не ловит тапы —
 * тот же инвариант, что у модалки офлайна).
 */

/** Иконки эпох (плейсхолдеры; потом — превьюшки текстур фона). */
const ERA_ICONS: readonly string[] = ['🏜️', '🌾', '🌳', '🏙️', '🌆', '🌃'];

/** totalEarned-порог эпохи: 10^(2*STEP*era) — эпоха = каждый второй период. */
function eraThreshold(era: number): Decimal {
  return Decimal.pow(10, 2 * WORLD_EXP_STEP * era);
}

export class EraPopup {
  private pop: HTMLElement;
  private rows: HTMLElement[] = [];
  private bars: HTMLElement[] = [];
  private sides: HTMLElement[] = [];
  private isOpen = false;
  private lastCurrent = -1;
  private lastPct = -1;

  constructor(
    uiRoot: HTMLElement,
    private readonly world: WorldWatch,
  ) {
    this.pop = document.createElement('div');
    this.pop.className = 'era-pop';

    const header = document.createElement('div');
    header.className = 'era-pop-header';
    const title = document.createElement('div');
    title.className = 'era-pop-title';
    title.textContent = 'Мир: эпохи';
    const close = document.createElement('button');
    close.className = 'sheet-close js-interactive';
    close.type = 'button';
    close.textContent = '×';
    close.addEventListener('click', () => this.close());
    header.append(title, close);

    const list = document.createElement('div');
    list.className = 'era-pop-list';

    for (let era = 0; era < WORLD_ERA_NAMES.length; era++) {
      const row = document.createElement('div');
      row.className = 'era-row';

      const icon = document.createElement('div');
      icon.className = 'era-row-icon';
      icon.textContent = ERA_ICONS[era] ?? '🗺️';

      const body = document.createElement('div');
      body.className = 'era-row-body';
      const name = document.createElement('div');
      name.className = 'era-row-name';
      name.textContent = WORLD_ERA_NAMES[era];
      const veg = document.createElement('div');
      veg.className = 'era-row-veg';
      const bar = document.createElement('div');
      bar.className = 'era-bar';
      const barFill = document.createElement('div');
      barFill.className = 'era-bar-fill';
      bar.appendChild(barFill);
      body.append(name, veg, bar);

      const side = document.createElement('div');
      side.className = 'era-row-side';

      row.append(icon, body, side);
      list.appendChild(row);

      this.rows.push(row);
      this.bars.push(barFill);
      this.sides.push(side);
    }

    this.pop.append(header, list);
    uiRoot.appendChild(this.pop);
    this.refresh(true);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Открыт ли попап (UIManager обновляет его содержимое только в открытом виде). */
  isOpenState(): boolean {
    return this.isOpen;
  }

  open(): void {
    this.refresh(true);
    this.isOpen = true;
    this.pop.classList.add('open');
  }

  close(): void {
    this.isOpen = false;
    this.pop.classList.remove('open');
  }

  /** Обновление строк по дифу (см. ObjectSheet.refresh — только изменения в DOM). */
  refresh(force = false): void {
    const { era, eraProgress } = this.world.stage;
    const pct = Math.round(eraProgress * 100);

    if (!force && era === this.lastCurrent && pct === this.lastPct) return;
    this.lastCurrent = era;
    this.lastPct = pct;

    for (let e = 0; e < this.rows.length; e++) {
      const row = this.rows[e];
      const cls = e < era ? 'era-row past' : e === era ? 'era-row current' : 'era-row future';
      if (row.className !== cls) row.className = cls;

      if (e === era) {
        // Текущая: фаза растительности + прогресс к следующей эпохе в баре.
        const vegName = WORLD_VEGETATION_NAMES[
          Math.min(this.world.stage.period, WORLD_VEGETATION_NAMES.length - 1)
        ];
        this.sides[e].textContent = `${pct}%`;
        (row.querySelector('.era-row-veg') as HTMLElement).textContent =
          `Растительность: ${vegName}`;
        this.bars[e].style.width = `${pct}%`;
      } else if (e < era) {
        this.sides[e].textContent = '✓';
        this.bars[e].style.width = '100%';
      } else {
        this.sides[e].textContent = `от ${formatMoney(eraThreshold(e))}`;
        this.bars[e].style.width = '0%';
      }
    }
  }
}
