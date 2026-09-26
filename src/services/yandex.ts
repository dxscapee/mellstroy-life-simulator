/**
 * Обёртка над Yandex Games SDK.
 * Если SDK не обнаружен (локальный запуск) — включается mock-режим:
 * вызовы имитируются с понятными логами, игра работает без платформы.
 */

interface YandexSdkPlugin {
  features?: {
    LoadingAPI?: { ready(): void };
  };
  adv: {
    showFullscreenAdv(options: {
      callbacks: {
        onClose: (wasShown: boolean) => void;
        onOpen?: () => void;
        onError?: (error: unknown) => void;
      };
    }): void;
    showRewardedVideo(options: {
      callbacks: {
        onOpen?: () => void;
        onRewarded: () => void;
        onClose?: () => void;
        onError?: (error: unknown) => void;
      };
    }): void;
  };
  // Минимальный слепок cloud-сохранений: в реальном проекте расширяйте по документации.
  player?: {
    setData?: (data: unknown, flush?: boolean) => Promise<void>;
    getData?: <T>(keys?: string[]) => Promise<T>;
  };
}

declare global {
  interface Window {
    YaGames?: {
      init(): Promise<YandexSdkPlugin>;
    };
  }
}

const logPrefix = '[YandexSDK]';

export type RewardedResult = 'rewarded' | 'closed' | 'error';

class YandexService {
  private sdk: YandexSdkPlugin | null = null;
  private mockMode = true;
  private initPromise: Promise<void> | null = null;

  get isMock(): boolean {
    return this.mockMode;
  }

  /** Инициализация. Безопасно вызывать один раз; повторные вызовы вернут тот же промис. */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      // Запуск вне iframe платформы (локальная разработка) — SDK работать не может,
      // а его глобальные хендлеры только мешают (переотправка синтетических событий).
      // Поэтому сам скрипт SDK грузим ТОЛЬКО внутри iframe: на платформе он
      // подгрузится автоматически, локально игра живёт в чистом mock-режиме.
      const inIframe = window.self !== window.top;
      if (typeof window === 'undefined' || !inIframe) {
        this.mockMode = true;
        console.info(
          `${logPrefix} Запуск вне платформы — работаем в MOCK-режиме ` +
          '(реклама и облако имитируются). На Яндекс Играх SDK подключится автоматически.',
        );
        return;
      }

      await this.loadSdkScript();

      if (!window.YaGames) {
        this.mockMode = true;
        console.warn(`${logPrefix} Скрипт SDK не загрузился — включён mock-режим.`);
        return;
      }

      try {
        // Таймаут: зависший init() не должен вечно держать загрузку игры.
        this.sdk = await Promise.race([
          window.YaGames.init(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('SDK init timeout')), 5000),
          ),
        ]);
        this.mockMode = false;
        console.info(`${logPrefix} SDK инициализирован успешно.`);
      } catch (err) {
        this.mockMode = true;
        console.warn(`${logPrefix} Ошибка/таймаут инициализации SDK — включён mock-режим.`, err);
      }
    })();

    return this.initPromise;
  }

  /** Динамическая загрузка скрипта SDK (только внутри iframe платформы). */
  private loadSdkScript(): Promise<void> {
    return new Promise((resolve) => {
      const existing = document.querySelector('script[src^="https://yandex.ru/games/sdk"]');
      if (existing) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://yandex.ru/games/sdk/v2';
      // Любой исход (включая таймаут сети 7с) разрешает промис: игра стартует в mock.
      script.onload = () => resolve();
      script.onerror = () => resolve();
      setTimeout(resolve, 7000);
      document.head.appendChild(script);
    });
  }

  /** Сообщить платформе, что игра загрузилась и можно показывать рекламу. */
  gameplayStart(): void {
    if (this.mockMode) {
      console.info(`${logPrefix} [MOCK] gameplayStart() — LoadingAPI.ready()`);
      return;
    }
    try {
      this.sdk?.features?.LoadingAPI?.ready();
    } catch (err) {
      console.warn(`${logPrefix} LoadingAPI.ready() упал:`, err);
    }
  }

  /** Межстраничная реклама. wasShown=true — реклама действительно показывалась. */
  showFullscreenAdv(): Promise<boolean> {
    if (this.mockMode) {
      console.info(`${logPrefix} [MOCK] showFullscreenAdv() — имитация показа`);
      return new Promise((resolve) => {
        setTimeout(() => resolve(true), 400);
      });
    }

    return new Promise((resolve) => {
      try {
        this.sdk?.adv.showFullscreenAdv({
          callbacks: {
            onClose: (wasShown) => resolve(wasShown),
            onError: (err) => {
              console.warn(`${logPrefix} fullscreen error:`, err);
              resolve(false);
            },
          },
        });
      } catch (err) {
        console.warn(`${logPrefix} showFullscreenAdv упал:`, err);
        resolve(false);
      }
    });
  }

  /** Реклама за награду. resolve('rewarded') — награду нужно выдать. */
  showRewardedVideo(): Promise<RewardedResult> {
    if (this.mockMode) {
      console.info(`${logPrefix} [MOCK] showRewardedVideo() — имитация просмотра (1.2с)`);
      return new Promise((resolve) => {
        setTimeout(() => resolve('rewarded'), 1200);
      });
    }

    return new Promise((resolve) => {
      try {
        this.sdk?.adv.showRewardedVideo({
          callbacks: {
            onRewarded: () => resolve('rewarded'),
            onClose: () => resolve('closed'),
            onError: (err) => {
              console.warn(`${logPrefix} rewarded error:`, err);
              resolve('error');
            },
          },
        });
      } catch (err) {
        console.warn(`${logPrefix} showRewardedVideo упал:`, err);
        resolve('error');
      }
    });
  }

  // ---------------------------------------------------- cloud saves (заготовка)

  /** Облачное сохранение. Сейчас локальный сейв — источник правды, облако — прогрев. */
  async saveCloudData(data: unknown): Promise<boolean> {
    if (this.mockMode) {
      console.info(`${logPrefix} [MOCK] saveCloudData()`, data);
      return true;
    }
    try {
      await this.sdk?.player?.setData?.(data, true);
      return true;
    } catch (err) {
      console.warn(`${logPrefix} saveCloudData упал:`, err);
      return false;
    }
  }

  async loadCloudData<T>(): Promise<T | null> {
    if (this.mockMode) {
      console.info(`${logPrefix} [MOCK] loadCloudData() — вернул null`);
      return null;
    }
    try {
      return (await this.sdk?.player?.getData?.<T>()) ?? null;
    } catch (err) {
      console.warn(`${logPrefix} loadCloudData упал:`, err);
      return null;
    }
  }
}

export const yandexService = new YandexService();
