import { LOCATIONS } from '@data/locations';
import type { Game } from '@engine/Game';

/**
 * ПОПАП ЛОКАЦИЙ (карусель) — открывается кликом по кольцу прогресса.
 *
 * ОКНО ПО ЦЕНТРУ ЭКРАНА (ТЗ владельца 2026-10-02). ОДНА СТРАНИЦА = ОДНА
 * ЛОКАЦИЯ (Гомель … Кипр), листается стрелками и точками-индикатором.
 *
 * Превью страницы:
 *   · прошлые и текущая локация — её ФОН из манифеста (world/<index>):
 *     картинка или видео (видео живёт ОДНО — только на активной странице);
 *     ассета нет — заглушка «фон ещё не нарисован»;
 *   · будущие локации — только «?»: содержимое не показываем.
 *
 * Нижняя строка — по ПРОСМАТРИВАЕМОЙ странице: имя + статус:
 *   · пройдена — «Пройдено» и ✓;
 *   · текущая — живой прогресс ПРОКАЧКИ (средний уровень / кап локации);
 *   · закрыта — «вкачай текущую локацию» и 🔒.
 * На текущей странице при 100% появляется кнопка «Перейти →»: первый тап
 * подтверждает («Точно? Ещё раз», 3с), второй — переход на новую локацию
 * (ТЗ владельца 2026-10-03: кольцо → подтверждение → переход).
 *
 * Обновление — по дифу (страница + локация + целый процент); DOM-строки
 * строятся один раз. Закрыта = opacity+visibility+pointer-events:none
 * (тот же инвариант, что у модалки офлайна: скрытая не ловит тапы).
 */

/** Что даёт провайдер превью: URL фона локации и его формат. */
export interface LocationPreviewSource {
  url: string;
  kind: 'image' | 'video';
}

/**
 * Провайдер превью локации. Его даёт main (из AssetRegistry) — слой ui про
 * view не знает (инвариант направлений зависимостей), получает только URL и формат.
 */
export type LocationPreviewProvider = (location: number) => LocationPreviewSource | null;

/** Сколько мс дано на подтверждение перехода (второй тап по «Перейти»). */
const ARM_MS = 3000;

/** Что сейчас построено в медиа-слоте страницы. */
type MediaState = 'unbuilt' | 'future' | 'placeholder' | 'image' | 'video';

export class LocationPopup {
  private pop: HTMLElement;
  /** Лента страниц: едет transform'ом, страницы — по 100% ширины кадра. */
  private track: HTMLElement;
  /** Медиа-слоты страниц (по индексу локации). */
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
  /** Кнопка перехода на следующую локацию (видна на текущей при 100%). */
  private goBtn: HTMLButtonElement;
  /** Два шага перехода: первый тап — подтверждение, второй — уход. */
  private armed = false;
  private armTimer: number | null = null;
  private isOpen = false;
  /** Просматриваемая страница — НЕЗАВИСИМА от текущей локации игрока. */
  private index = 0;
  private lastIndex = -1;
  private lastLocation = -1;
  private lastPct = -1;

  constructor(
    uiRoot: HTMLElement,
    /** Игра нужна для живого прогресса: прокачка (средний уровень) и локация. */
    private readonly game: Game,
    private readonly preview?: LocationPreviewProvider,
  ) {
    const total = LOCATIONS.length;

    this.pop = document.createElement('div');
    this.pop.className = 'loc-pop';

    // ---------- шапка: заголовок + закрыть ----------
    const header = document.createElement('div');
    header.className = 'loc-pop-header';
    const title = document.createElement('div');
    title.className = 'loc-pop-title';
    title.textContent = 'Локации';
    const close = document.createElement('button');
    close.className = 'sheet-close js-interactive';
    close.type = 'button';
    close.textContent = '×';
    close.addEventListener('click', () => this.close());
    header.append(title, close);

    // ---------- кадр карусели: стрелка / лента страниц / стрелка ----------
    const viewport = document.createElement('div');
    viewport.className = 'loc-viewport';

    this.prevBtn = this.mkArrow('‹', 'Предыдущая локация', () => this.selectLocation(this.index - 1));
    this.nextBtn = this.mkArrow('›', 'Следующая локация', () => this.selectLocation(this.index + 1));

    this.track = document.createElement('div');
    this.track.className = 'loc-track';
    // Лента В N РАЗ ШИРЕ кадра: тогда translateX в процентах считается от её
    // полной длины и страницы встают ровно по кадру (иначе % шёл бы от ширины
    // кадра и лента не доезжала — проверено вживую у карусели эпох).
    this.track.style.width = `${total * 100}%`;
    for (let i = 0; i < total; i++) {
      const page = document.createElement('div');
      page.className = 'loc-page';
      page.style.flex = `0 0 ${100 / total}%`;
      this.track.appendChild(page);
      this.pages.push(page);
      this.mediaState.push('unbuilt');
    }

    viewport.append(this.prevBtn, this.track, this.nextBtn);

    // ---------- точки-индикатор: клик = прыжок на страницу ----------
    const dotsRow = document.createElement('div');
    dotsRow.className = 'loc-dots';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('button');
      dot.className = 'loc-dot js-interactive';
      dot.type = 'button';
      dot.title = `Локация ${i + 1}: ${LOCATIONS[i].name}`;
      dot.setAttribute('aria-label', dot.title);
      dot.addEventListener('click', () => this.selectLocation(i));
      this.dots.push(dot);
      dotsRow.appendChild(dot);
    }

    // ---------- нижняя строка просматриваемой локации ----------
    const strip = document.createElement('div');
    strip.className = 'loc-strip';

    this.stripIcon = document.createElement('div');
    this.stripIcon.className = 'loc-strip-icon';
    this.stripIcon.textContent = LOCATIONS[0].icon;

    const body = document.createElement('div');
    body.className = 'loc-strip-body';
    this.stripName = document.createElement('div');
    this.stripName.className = 'loc-strip-name';
    this.stripSub = document.createElement('div');
    this.stripSub.className = 'loc-strip-sub';
    const bar = document.createElement('div');
    bar.className = 'loc-bar';
    this.barFill = document.createElement('div');
    this.barFill.className = 'loc-bar-fill';
    bar.appendChild(this.barFill);
    body.append(this.stripName, this.stripSub, bar);

    this.stripSide = document.createElement('div');
    this.stripSide.className = 'loc-strip-side';

    this.goBtn = document.createElement('button');
    this.goBtn.className = 'loc-go js-interactive';
    this.goBtn.type = 'button';
    this.goBtn.textContent = 'Перейти →';
    this.goBtn.style.display = 'none';
    this.goBtn.addEventListener('click', () => this.onGoClick());

    strip.append(this.stripIcon, body, this.stripSide, this.goBtn);
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

  /** Открытие: всегда на странице ТЕКУЩЕЙ локации игрока. */
  open(): void {
    this.selectLocation(this.game.state.location, true);
    this.isOpen = true;
    this.pop.classList.add('open');
  }

  close(): void {
    this.isOpen = false;
    this.pop.classList.remove('open');
    this.disarm();
  }

  /**
   * Переход на страницу локации (стрелки, точки, открытие). force — перестроить
   * даже если страница та же (открытие после смены локации).
   */
  private selectLocation(location: number, force = false): void {
    const idx = Math.max(0, Math.min(this.pages.length - 1, location));
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
    const location = this.game.state.location;
    // floor — ТО ЖЕ округление, что у кольца HUD (renderWorldRing), иначе меню
    // и кольцо расходятся на 1% (round vs floor) на границах долей процента.
    const pct = Math.floor(this.game.state.locationProgress() * 100);

    // Смена локации: у страниц меняется статус «будущая ↔ открыта» —
    // такие слоты перестраиваем («?» ↔ фон локации).
    for (let i = 0; i < this.pages.length; i++) {
      const state = this.mediaState[i];
      const future = i > location;
      if ((future && state !== 'future' && state !== 'unbuilt') || (!future && state === 'future')) {
        this.buildMedia(i);
      }
    }

    if (!force && this.index === this.lastIndex && location === this.lastLocation && pct === this.lastPct) {
      return;
    }
    this.lastIndex = this.index;
    this.lastLocation = location;
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
    const state = this.game.state;
    const location = state.location;
    const loc = LOCATIONS[Math.min(this.index, LOCATIONS.length - 1)];
    const pct = Math.floor(state.locationProgress() * 100);
    const ready = pct >= 100;
    const view = this.index;

    this.stripIcon.textContent = loc.icon;
    this.stripName.textContent = loc.name;

    if (view < location) {
      this.stripSub.textContent = 'Пройдено';
      this.stripSide.textContent = '✓';
      this.barFill.style.width = '100%';
    } else if (view === location) {
      this.stripSub.textContent = ready
        ? 'Вкачано — можно переходить!'
        : `Средний уровень ${state.averageLevel().toFixed(1)} / ${loc.cap}`;
      this.stripSide.textContent = `${pct}%`;
      this.barFill.style.width = `${pct}%`;
    } else {
      this.stripSub.textContent = 'Вкачай текущую локацию до конца';
      this.stripSide.textContent = '🔒';
      this.barFill.style.width = '0%';
    }

    // Кнопка перехода: только на ТЕКУЩЕЙ странице, только при 100% и не на финале.
    const showGo = view === location && ready && state.canAdvanceLocation();
    this.goBtn.style.display = showGo ? '' : 'none';
    if (!showGo) this.disarm();
  }

  /** Первый тап — подтверждение, второй в течение ARM_MS — переход. */
  private onGoClick(): void {
    if (!this.game.state.canAdvanceLocation()) return;

    if (!this.armed) {
      this.armed = true;
      this.goBtn.textContent = 'Точно? Ещё раз';
      this.goBtn.classList.add('armed');
      this.armTimer = globalThis.setTimeout(() => this.disarm(), ARM_MS);
      return;
    }

    this.disarm();
    if (this.game.advanceLocation()) {
      // Прыгаем на новую локацию: и полоса, и превью пересчитаются сами.
      this.selectLocation(this.game.state.location, true);
    }
  }

  /** Сброс подтверждения (таймаут, закрытие попапа, переход состоялся). */
  private disarm(): void {
    if (this.armTimer !== null) {
      globalThis.clearTimeout(this.armTimer);
      this.armTimer = null;
    }
    this.armed = false;
    this.goBtn.textContent = 'Перейти →';
    this.goBtn.classList.remove('armed');
  }

  // ------------------------------------------------------------- страницы

  private mkArrow(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = `loc-arrow ${glyph === '‹' ? 'loc-arrow-prev' : 'loc-arrow-next'} js-interactive`;
    b.type = 'button';
    b.textContent = glyph;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  /**
   * Построить превью страницы: «?» для будущей локации, её фон (картинка или
   * видео) для открытой, заглушка — если ассета нет.
   */
  private buildMedia(location: number): void {
    const slot = this.pages[location];
    slot.textContent = '';
    this.mediaState[location] = 'placeholder';

    // Будущая локация: содержимое не показываем — только «?».
    if (location > this.game.state.location) {
      const unknown = document.createElement('div');
      unknown.className = 'loc-media-unknown';
      unknown.textContent = '?';
      slot.appendChild(unknown);
      this.mediaState[location] = 'future';
      return;
    }

    const src = this.preview?.(location) ?? null;
    if (!src) {
      // Ассета фона локации ещё нет — страница не пустует: иконка + подпись.
      const empty = document.createElement('div');
      empty.className = 'loc-media-empty';
      const icon = document.createElement('div');
      icon.className = 'loc-media-empty-icon';
      icon.textContent = LOCATIONS[location]?.icon ?? '🗺️';
      const text = document.createElement('div');
      text.className = 'loc-media-empty-text';
      text.textContent = 'Фон локации ещё не нарисован';
      empty.append(icon, text);
      slot.appendChild(empty);
      return;
    }

    if (src.kind === 'image') {
      const img = document.createElement('img');
      img.className = 'loc-media';
      img.src = src.url;
      img.alt = `Фон локации «${LOCATIONS[location].name}»`;
      img.draggable = false;
      slot.appendChild(img);
      this.mediaState[location] = 'image';
      return;
    }

    // Видео: ОДИН живой декодер — только на просматриваемой странице
    // (muted/playsinline/loop без контролов, как требует Яндекс).
    const video = document.createElement('video');
    video.className = 'loc-media';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.controls = false;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-label', `Фон локации «${LOCATIONS[location].name}»`);
    video.src = src.url;
    slot.appendChild(video);
    void video.play().catch(() => {});
    this.mediaState[location] = 'video';
  }

  /**
   * Освободить слот уходящей страницы: видео закрываем (декодеров держим
   * 1–2, см. ASSETS.md), картинку оставляем — она бесплатна и вернётся мгновенно.
   */
  private releaseMedia(location: number): void {
    if (this.mediaState[location] !== 'video') return;
    const video = this.pages[location].querySelector('video');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
    }
    this.mediaState[location] = 'unbuilt';
  }
}
