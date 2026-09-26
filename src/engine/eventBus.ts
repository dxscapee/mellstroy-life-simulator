import type { GameEventMap } from './types';

type Handler<T> = (payload: T) => void;

/**
 * Минималистичный типизированный EventBus.
 * Движок не знает про UI и Pixi — слои общаются только через события.
 * Контракт событий — карта GameEventMap из types.ts.
 */
export class EventBus {
  private handlers = new Map<string, Set<Handler<never>>>();

  on<K extends keyof GameEventMap>(event: K, handler: Handler<GameEventMap[K]>): () => void {
    let set = this.handlers.get(event as string);
    if (!set) {
      set = new Set();
      this.handlers.set(event as string, set);
    }
    set.add(handler as unknown as Handler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof GameEventMap>(event: K, handler: Handler<GameEventMap[K]>): void {
    this.handlers.get(event as string)?.delete(handler as unknown as Handler<never>);
  }

  emit<K extends keyof GameEventMap>(event: K, payload: GameEventMap[K]): void {
    const set = this.handlers.get(event as string);
    if (!set || set.size === 0) return;
    // Итерируем Set напрямую — без аллокации копии (emit идёт на каждом тике).
    // Отписка внутри обработчика безопасна: Set в JS пропускает удалённые элементы.
    for (const h of set) {
      try {
        (h as unknown as Handler<GameEventMap[K]>)(payload);
      } catch (err) {
        // Один упавший слушатель не должен валить игровой цикл.
        console.error(`[EventBus] handler for "${String(event)}" failed`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

/** Глобальный автобус приложения. Слои общаются только через него. */
export const events = new EventBus();
