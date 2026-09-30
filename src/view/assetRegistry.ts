import { Assets, Texture, VideoSource } from 'pixi.js';
import type { AssetGroup } from '@data/assets';
import { ASSET_MANIFEST_URL, assetKey } from '@data/assets';

/**
 * РАНТАЙМ-ЗАГРУЗЧИК ТЕКСТУР (подробности — ASSETS.md).
 *
 * Что делает: читает public/assets/manifest.json (его пишет npm run assets),
 * лениво грузит ассеты по ключам «группа/стадия» и отдаёт готовые Texture.
 * Картинки грузит штатный загрузчик Pixi (Assets), видео — программно через
 * VideoSource: muted, playsinline, loop, без контролов (требования Яндекса),
 * элемент живёт скрытым в DOM (iOS/WKWebView играет inline только так).
 *
 * Контракты:
 *  · ключ = `${group}/${stage}`, стадия резолвится с ОТКАТОМ ВНИЗ (нет файла
 *    стадии N — берётся ближайшая младшая);
 *  · texture(key) НИКОГДА не ждёт: кэш → Texture, иначе запускает фоновую
 *    загрузку и возвращает null (сцена покажет заглушку, по завершении
 *    сработают слушатели onLoaded);
 *  · release(key) — освободить память (BG-видео прошлой эпохи и т.п.);
 *  · манифеста нет — реестр пуст, игра живёт на заглушках, всё тихо (info).
 *
 * Реестр ничего не знает о раскладке и о конкретных объектах: только ключи.
 */

export type AssetKind = 'image' | 'video';

/** Запись манифеста (пишет пайплайн, читает игра). */
export interface AssetEntry {
  /** URL относительно index.html (например, assets/house/0.ab12cd34.webp). */
  url: string;
  type: AssetKind;
  /** Натуральные размеры (у картинок всегда; у видео могут отсутствовать). */
  w?: number;
  h?: number;
  bytes?: number;
  /** Мастер-источник из art/ — для диагностики. */
  source?: string;
}

interface AssetManifestFile {
  version: number;
  assets: Record<string, AssetEntry>;
}

/** Потолок ожидания стартового набора: дальше играем с заглушками. */
const PRELOAD_TIMEOUT_MS = 12_000;

/** Больше двух живых видео одновременно — дорого по памяти (предупреждение в dev). */
const VIDEO_SOFT_LIMIT = 2;

export class AssetRegistry {
  /** null — манифест ещё не читали; пустой Map — читали, ассетов нет. */
  private entries: Map<string, AssetEntry> | null = null;
  private cache = new Map<string, Texture>();
  private inflight = new Map<string, Promise<Texture | null>>();
  private videos = new Map<string, HTMLVideoElement>();
  private failed = new Set<string>();
  private releaseOnArrive = new Set<string>();
  private listeners = new Set<(key: string) => void>();
  private loggedMissing = new Set<string>();
  private loggedFallback = new Set<string>();
  private videoRetryArmed = false;
  private destroyed = false;

  /** Прочитан ли манифест (не важно, пустой). */
  get manifestReady(): boolean {
    return this.entries !== null;
  }

  /** Сколько ассетов обещает манифест. */
  get count(): number {
    return this.entries?.size ?? 0;
  }

  /**
   * Чтение манифеста + подготовка загрузчика Pixi. Ошибки не летят наружу:
   * отсутствие манифеста — легальное состояние (заглушки).
   */
  async init(): Promise<void> {
    try {
      await Assets.init();
    } catch (err) {
      console.warn('[assets] Assets.init упал:', err);
    }

    try {
      const response = await fetch(ASSET_MANIFEST_URL, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as Partial<AssetManifestFile>;
      const map = new Map<string, AssetEntry>();
      for (const [key, entry] of Object.entries(data.assets ?? {})) {
        if (entry && typeof entry.url === 'string' && (entry.type === 'image' || entry.type === 'video')) {
          map.set(key, entry);
        }
      }
      this.entries = map;
      if (map.size > 0) console.info(`[assets] манифест: ${map.size} ассет(ов)`);
    } catch {
      this.entries = new Map();
      console.info('[assets] манифеста нет — сцена живёт на заглушках (собери: npm run assets)');
    }
  }

  /** Есть ли ключ в манифесте. */
  has(key: string): boolean {
    return this.entries?.has(key) ?? false;
  }

  /**
   * Лучшая существующая стадия для группы: от запрошенной вниз до 0.
   * null — у группы нет ни одного ассета.
   */
  resolveKey(group: AssetGroup, stage: number): string | null {
    if (!this.entries) return null;

    for (let s = Math.max(0, Math.floor(stage)); s >= 0; s--) {
      const key = assetKey(group, s);
      if (!this.entries.has(key)) continue;
      if (s !== stage && import.meta.env.DEV && !this.loggedFallback.has(key)) {
        this.loggedFallback.add(key);
        console.info(`[assets] ${group}/${stage}: файла нет, показываю ${key}`);
      }
      return key;
    }

    if (import.meta.env.DEV && !this.loggedMissing.has(group)) {
      this.loggedMissing.add(group);
      console.info(`[assets] «${group}»: ассетов нет — заглушка (см. ASSETS.md)`);
    }
    return null;
  }

  /**
   * Текстура из кэша. Если не загружена — запускает фоновую загрузку
   * (одна на ключ) и возвращает null: сцена не ждёт, по завершении
   * onLoaded попросит пере-синхронизацию.
   */
  texture(key: string): Texture | null {
    if (this.destroyed) return null;
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (this.failed.has(key) || this.inflight.has(key) || !this.entries?.has(key)) return null;
    void this.load(key);
    return null;
  }

  /**
   * Догрузка набора ключей (стартовый экран). Никогда не реджектит; ключи,
   * которых нет в манифесте, просто пропускаются. Опоздавшие загрузки не
   * отменяются: их подхватит onLoaded.
   */
  async preload(
    keys: readonly string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    const unique = [...new Set(keys)].filter((key) => this.entries?.has(key));
    if (unique.length === 0) {
      onProgress?.(0, 0);
      return;
    }

    let done = 0;
    onProgress?.(0, unique.length);
    await Promise.all(
      unique.map(async (key) => {
        const timeout = new Promise<void>((resolveTimeout) => {
          setTimeout(resolveTimeout, PRELOAD_TIMEOUT_MS);
        });
        await Promise.race([this.load(key), timeout]);
        done += 1;
        onProgress?.(done, unique.length);
      }),
    );
  }

  /** Подписка «ассет догрузился» (ключ в аргументе). Возвращает отписку. */
  onLoaded(listener: (key: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Освободить ассет: текстура уничтожается, видео-элемент удаляется из DOM. */
  release(key: string): void {
    if (this.inflight.has(key)) this.releaseOnArrive.add(key);

    const entry = this.entries?.get(key);
    const texture = this.cache.get(key);
    this.cache.delete(key);

    if (entry?.type === 'image') {
      // Assets.unload сам уничтожает и текстуру, и источник.
      void Assets.unload(entry.url);
    } else if (texture) {
      texture.destroy(true);
    }
    this.removeVideoElement(key);
  }

  /** Полный разбор (вызывается при уничтожении игры). */
  destroy(): void {
    this.destroyed = true;
    for (const key of [...this.cache.keys()]) this.release(key);
    this.listeners.clear();
  }

  // ------------------------------------------------------------- загрузка

  /** Однократная загрузка ключа: all-in-one промис, без реджектов. */
  private load(key: string): Promise<Texture | null> {
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const entry = this.entries?.get(key);
    if (!entry || this.failed.has(key) || this.destroyed) return Promise.resolve(null);

    const promise = this.loadEntry(key, entry)
      .then((texture) => {
        this.inflight.delete(key);
        if (!texture) return null;
        // Пока грузилось, ассет мог стать не нужен (смена эпохи, destroy).
        if (this.destroyed || this.releaseOnArrive.delete(key)) {
          this.destroyLoaded(key, texture, entry);
          return null;
        }
        this.cache.set(key, texture);
        for (const listener of this.listeners) listener(key);
        return texture;
      })
      .catch((err) => {
        this.inflight.delete(key);
        this.failed.add(key);
        console.warn(`[assets] не загрузился «${key}» (${entry.url}):`, err?.message ?? err);
        return null;
      });

    this.inflight.set(key, promise);
    return promise;
  }

  private loadEntry(key: string, entry: AssetEntry): Promise<Texture> {
    return entry.type === 'video' ? this.loadVideo(key, entry) : Assets.load<Texture>(entry.url);
  }

  /**
   * Видео-текстура: скрытый <video> в DOM, muted + playsinline + loop, без
   * контролов и звука; VideoSource сам гоняет кадры в текстуру.
   * Каждый видео-ассет — отдельный живой декодер: держи их одновременно
   * 1–2, не больше (см. ASSETS.md).
   */
  private async loadVideo(key: string, entry: AssetEntry): Promise<Texture> {
    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.controls = false;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    // Скрытый, но ЖИВОЙ в DOM элемент: iOS/WKWebView иначе не играет inline.
    video.style.cssText =
      'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1;';
    video.src = entry.url;
    document.body.appendChild(video);

    const source = new VideoSource({
      resource: video,
      autoLoad: false,
      autoPlay: true,
      loop: true,
      muted: true,
      playsinline: true,
    });
    const texture = new Texture({ source });

    try {
      await source.load();
    } catch (err) {
      texture.destroy(true);
      video.remove();
      throw err;
    }

    this.videos.set(key, video);
    this.armAutoplayRetry();

    if (import.meta.env.DEV && this.videos.size > VIDEO_SOFT_LIMIT) {
      console.warn(
        `[assets] одновременно живёт ${this.videos.size} видео-текстур — это дорого по памяти, см. ASSETS.md`,
      );
    }
    return texture;
  }

  private destroyLoaded(key: string, texture: Texture, entry: AssetEntry): void {
    if (entry.type === 'image') {
      void Assets.unload(entry.url);
    } else {
      texture.destroy(true);
    }
    this.removeVideoElement(key);
  }

  private removeVideoElement(key: string): void {
    const video = this.videos.get(key);
    if (!video) return;
    this.videos.delete(key);
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }

  /**
   * Автоплей приглушённого видео разрешён почти везде, но в редких режимах
   * (энергосбережение, политики WebView) первый play() может быть отклонён.
   * Тогда догоняем по первому жесту — текстура оживёт.
   */
  private armAutoplayRetry(): void {
    if (this.videoRetryArmed) return;
    this.videoRetryArmed = true;
    window.addEventListener(
      'pointerdown',
      () => {
        for (const video of this.videos.values()) {
          if (video.paused) void video.play().catch(() => {});
        }
      },
      { passive: true },
    );
  }
}
