import type { GameStateSnapshot } from './types';

/**
 * Единственное место, знающее про LocalStorage.
 * Логика миграций — здесь (сейчас: чужая/старая версия = новый сейв).
 * v2 — экономика P/A-потоков (ключ сейва 'idle_tycoon_save_v2').
 */
export class SaveManager {
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

  constructor(private readonly key: string) {
    // try/catch: в приватных вкладках/нативных вебвью localStorage может кидать.
    try {
      this.storage = globalThis.localStorage ?? null;
    } catch {
      this.storage = null;
    }
  }

  load(): GameStateSnapshot | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as Partial<GameStateSnapshot>;
      if (parsed?.version !== 2) {
        console.warn('[Save] Несовместимая версия сейва — начинаем с нуля.');
        return null;
      }
      // Минимальная валидация формы.
      if (typeof parsed.money !== 'string' || typeof parsed.savedAt !== 'number') {
        return null;
      }
      return parsed as GameStateSnapshot;
      } catch {
      return null;
    }
  }

  save(snapshot: GameStateSnapshot): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.key, JSON.stringify(snapshot));
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem(this.key);
    } catch {
      /* no-op */
    }
  }
}
