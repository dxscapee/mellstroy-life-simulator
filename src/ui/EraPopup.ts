import Decimal from 'break_infinity.js';
import { WORLD_ERA_NAMES, WORLD_VEGETATION_NAMES, WORLD_EXP_STEP } from '@data/worldStages';
import type { WorldWatch } from '@engine/WorldProgress';
import { formatMoney } from '@engine/format';

/**
 * ПОПАП-ГАЛЕРЕЯ ЭПОХ (карусель) — открывается кликом по кольцу прогресса.
 *
 * ОКНО ПО ЦЕНТРУ ЭКРАНА (ТЗ владельца 2026-10-02: раньше висело над нижней
 * панелью). ОДНА СТРАНИЦА = ОДНА ЭПОХА, листается стрелками по краям кадра и
 * точками-индикатором снизу (клик по точке — прыжок на страницу).
 *
 * Превью страницы:
 *   · прошлые и текущая эпоха — ФОН ЭПОХИ из манифеста (world/<эпоха>):
 *     картинка или видео (видео живёт ОДНО — только на активной странице,
 *     см. инвариант про декодеры); ассета нет — заглушка с иконкой;
 *   · будущие эпохи — только «?»: содержимое уровня не показываем.
 *
 * Нижняя строка — по ПРОСМАТРИВАЕМОЙ странице (не по текущей эпохе игрока):
 * пройдено / текущий прогресс с фазой растительности / порог открытия.
 * Обновление — по дифу (страница + эпоха + целый процент); DOM-строки строятся
 * один раз. Закрыта = opacity+visibility+pointer-events:none (тот же инвариант,
 * что у модалки офлайна: скрытая не ловит тапы).
 */

/** Иконки эпох (плейсхолдеры; потом — превьюшки текстур фона). */
const ERA_ICONS: readonly string[] = ['🏜️', '🌾', '🌳', '🏙️', '🌆', '🌃'];

/** Что даёт провайдер превью: URL фона эпохи и его формат. */
export interface EraPreviewSource {
  url: string;
  kind: 'image' | 'video';
}

/**
 * Провайдер превью эпохи. Его даёт main (из AssetRegistry) — слой ui про view
 * не знает (инвариант направлений зависимостей), получает только URL и формат.
 */
export type EraPreviewProvider = (era: number) => EraPreviewSource | null;

/** totalEarned-порог эпохи: 10^(2*STEP*era) — эпоха = каждый второй период. */
function eraThreshold(era: number): Decimal {
  return Decimal.pow(10, 2 * WORLD_EXP_STEP * era);
}

/** Что сейчас построено в медиа-слоте страницы. */
type MediaState = 'unbuilt' | 'future' | 'placeholder' | 'image' | 'video';

export class EraPopup {
  private pop: HTMLElement;
  /** Лента страниц: едет transform'ом, страницы — по 100% ширины кадра. */
  private track: HTMLElement;
  /** Медиа-слоты страниц (по индексу эпохи). */
  private pages: HTMLElement[] = [];
  private mediaState: MediaState[] = [];
  private dots: HTMLButtonElement[] = [];
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  /** Нижняя строка (общая для всех страниц — обновляется по просматриваемой). */
  private stripIcon: HTMLElement;
  private stripName: HTMLElement;
  private stripSub: HTMLElement;
  private stripSide: HTMLElement;
  private barFill: HTMLElement;
  private isOpen = false;
  /** Просматриваемая страница — НЕЗАВИСИМА от текущей эпохи игрока. */
  private index = 0;
  private lastIndex = -1;
  private lastEra = -1;
  private lastPct = -1;

  constructor(
    uiRoot: HTMLElement,
    private readonly world: WorldWatch,
    private readonly preview?: EraPreviewProvider,
  ) {
    const total = WORLD_ERA_NAMES.length;

    this.pop = document.createElement('div');
    this.pop.className = 'era-pop';

    // ---------- шапка: заголовок + закрыть ----------
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

    // ---------- кадр карусели: стрелка / лента страниц / стрелка ----------
    const viewport = document.createElement('div');
    viewport.className = 'era-viewport';

    this.prevBtn = this.mkArrow('‹', 'Предыдущая эпоха', () => this.selectEra(this.index - 1));
    this.nextBtn = this.mkArrow('›', 'Следующая эпоха', () => this.selectEra(this.index + 1));

    this.track = document.createElement('div');
    this.track.className = 'era-track';
    // Лента В N РАЗ ШИРЕ кадра: тогда translateX в процентах считается от её
    // полной длины и страницы встают ровно по кадру (иначе % шёл бы от ширины
    // кадра и лента не доезжала — проверено вживую).
    this.track.style.width = `${total * 100}%`;
    for (let era = 0; era < total; era++) {
      const page = document.createElement('div');
      page.className = 'era-page';
      page.style.flex = `0 0 ${100 / total}%`;
      this.track.appendChild(page);
      this.pages.push(page);
      this.mediaState.push('unbuilt');
    }

    viewport.append(this.prevBtn, this.track, this.nextBtn);

    // ---------- точки-индикатор: клик = прыжок на страницу ----------
    const dotsRow = document.createElement('div');
    dotsRow.className = 'era-dots';
    for (let era = 0; era < total; era++) {
      const dot = document.createElement('button');
      dot.className = 'era-dot js-interactive';
      dot.type = 'button';
      dot.title = `Эпоха ${era + 1}: ${WORLD_ERA_NAMES[era]}`;
      dot.setAttribute('aria-label', dot.title);
      dot.addEventListener('click', () => this.selectEra(era));
      this.dots.push(dot);
      dotsRow.appendChild(dot);
    }

    // ---------- нижняя строка просматриваемой эпохи ----------
    const strip = document.createElement('div');
    strip.className = 'era-strip';

    this.stripIcon = document.createElement('div');
    this.stripIcon.className = 'era-strip-icon';
    this.stripIcon.textContent = ERA_ICONS[0] ?? '🗺️';

    const body = document.createElement('div');
    body.className = 'era-strip-body';
    this.stripName = document.createElement('div');
    this.stripName.className = 'era-strip-name';
    this.stripSub = document.createElement('div');
    this.stripSub.className = 'era-strip-sub';
    const bar = document.createElement('div');
    bar.className = 'era-bar';
    this.barFill = document.createElement('div');
    this.barFill.className = 'era-bar-fill';
    bar.appendChild(this.barFill);
    body.append(this.stripName, this.stripSub, bar);

    this.stripSide = document.createElement('div');
    this.stripSide.className = 'era-strip-side';

    strip.append(this.stripIcon, body, this.stripSide);

    this.pop.append(header, viewport, dotsRow, strip);
    uiRoot.appendChild(this.pop);

    this.renderStrip();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Открыт ли попап (UIManager обновляет его содержимое только в открытом виде). */
  isOpenState(): boolean {
    return this.isOpen;
  }

  /** Открытие: всегда на странице ТЕКУЩЕЙ эпохи игрока. */
  open(): void {
    this.selectEra(this.world.stage.era, true);
    this.isOpen = true;
    this.pop.classList.add('open');
  }

  close(): void {
    this.isOpen = false;
    this.pop.classList.remove('open');
  }

  /**
   * Переход на страницу эпохи (стрелки, точки, открытие). force — перестроить
   * даже если страница та же (открытие после смены эпохи).
   */
  private selectEra(era: number, force = false): void {
    const idx = Math.max(0, Math.min(this.pages.length - 1, era));
    const prev = this.index;
    if (!force && idx === prev) return;

    this.index = idx;
    this.track.style.transform = `translateX(${(-idx * 100) / this.pages.length}%)`;
    // Уходя со страницы, закрываем её видео-декодер (больше одного не держим).
    if (prev !== idx) this.releaseMedia(prev);
    if (this.mediaState[idx] === 'unbuilt') this.buildMedia(idx);
    this.refresh(true);
  }

  /** Обновление по дифу (см. ObjectSheet.refresh — только изменения в DOM). */
  refresh(force = false): void {
    const { era, eraProgress } = this.world.stage;
    const pct = Math.round(eraProgress * 100);

    // Смена эпохи/сброс: у страниц меняется статус «будущая ↔ открыта» —
    // такие слоты перестраиваем («?» ↔ фон эпохи).
    for (let e = 0; e < this.pages.length; e++) {
      const state = this.mediaState[e];
      const future = e > era;
      if ((future && state !== 'future' && state !== 'unbuilt') || (!future && state === 'future')) {
        this.buildMedia(e);
      }
    }

    if (!force && this.index === this.lastIndex && era === this.lastEra && pct === this.lastPct) {
      return;
    }
    this.lastIndex = this.index;
    this.lastEra = era;
    this.lastPct = pct;

    this.renderStrip();
    for (let i = 0; i < this.dots.length; i++) {
      this.dots[i].classList.toggle('active', i === this.index);
      this.dots[i].disabled = i === this.index;
    }
    this.prevBtn.disabled = this.index <= 0;
    this.nextBtn.disabled = this.index >= this.pages.length - 1;
  }

  /** Нижняя строка — по ПРОСМАТРИВАЕМОЙ странице. */
  private renderStrip(): void {
    const { era, period } = this.world.stage;
    const pct = Math.round(this.world.stage.eraProgress * 100);
    const view = this.index;

    this.stripIcon.textContent = ERA_ICONS[view] ?? '🗺️';
    this.stripName.textContent = WORLD_ERA_NAMES[view] ?? `Эпоха ${view + 1}`;

    if (view < era) {
      this.stripSub.textContent = 'Пройдено';
      this.stripSide.textContent = '✓';
      this.barFill.style.width = '100%';
    } else if (view === era) {
      const vegName =
        WORLD_VEGETATION_NAMES[Math.min(period, WORLD_VEGETATION_NAMES.length - 1)];
      this.stripSub.textContent = `Растительность: ${vegName}`;
      this.stripSide.textContent = `${pct}%`;
      this.barFill.style.width = `${pct}%`;
    } else {
      this.stripSub.textContent = `Открывается от ${formatMoney(eraThreshold(view))}`;
      this.stripSide.textContent = '🔒';
      this.barFill.style.width = '0%';
    }
  }

  // ------------------------------------------------------------- страницы

  private mkArrow(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = `era-arrow ${glyph === '‹' ? 'era-arrow-prev' : 'era-arrow-next'} js-interactive`;
    b.type = 'button';
    b.textContent = glyph;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  /**
   * Построить превью страницы: «?» для будущей эпохи, фон эпохи (картинка или
   * видео) для открытой, заглушка — если ассета нет.
   */
  private buildMedia(era: number): void {
    const slot = this.pages[era];
    slot.textContent = '';
    this.mediaState[era] = 'placeholder';

    // Будущая эпоха: содержимое уровня не показываем — только «?».
    if (era > this.world.stage.era) {
      const unknown = document.createElement('div');
      unknown.className = 'era-media-unknown';
      unknown.textContent = '?';
      slot.appendChild(unknown);
      this.mediaState[era] = 'future';
      return;
    }

    const src = this.preview?.(era) ?? null;
    if (!src) {
      // Ассета фона ещё нет — страница не пустует: иконка + подпись.
      const empty = document.createElement('div');
      empty.className = 'era-media-empty';
      const icon = document.createElement('div');
      icon.className = 'era-media-empty-icon';
      icon.textContent = ERA_ICONS[era] ?? '🗺️';
      const text = document.createElement('div');
      text.className = 'era-media-empty-text';
      text.textContent = 'Фон эпохи ещё не нарисован';
      empty.append(icon, text);
      slot.appendChild(empty);
      return;
    }

    if (src.kind === 'image') {
      const img = document.createElement('img');
      img.className = 'era-media';
      img.src = src.url;
      img.alt = `Фон эпохи «${WORLD_ERA_NAMES[era]}»`;
      img.draggable = false;
      slot.appendChild(img);
      this.mediaState[era] = 'image';
      return;
    }

    // Видео: ОДИН живой декодер — только на просматриваемой странице
    // (muted/playsinline/loop без контролов, как требует Яндекс).
    const video = document.createElement('video');
    video.className = 'era-media';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.controls = false;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-label', `Фон эпохи «${WORLD_ERA_NAMES[era]}»`);
    video.src = src.url;
    slot.appendChild(video);
    void video.play().catch(() => {});
    this.mediaState[era] = 'video';
  }

  /**
   * Освободить слот уходящей страницы: видео закрываем (декодеров держим
   * 1–2, см. ASSETS.md), картинку оставляем — она бесплатна и вернётся мгновенно.
   */
  private releaseMedia(era: number): void {
    if (this.mediaState[era] !== 'video') return;
    const video = this.pages[era].querySelector('video');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
    }
    this.mediaState[era] = 'unbuilt';
  }
}
