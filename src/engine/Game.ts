import { gameConfig } from '@data/gameConfig';
import { objectById } from '@data/objects';
import type Decimal from 'break_infinity.js';
import { events } from './eventBus';
import { GameState } from './GameState';
import { GameLoop } from './GameLoop';
import { OfflineProgress } from './OfflineProgress';
import { SaveManager } from './SaveManager';
import type { ObjectDef } from './types';

/**
 * Фасад ядра: связывает состояние, цикл, сейвы и офлайн-доход.
 * Слои (UI, Pixi) знают только про Game и события — про внутренности нет.
 */
export class Game {
  readonly state: GameState;
  readonly loop: GameLoop;
  /**
   * Офлайн-доход, рассчитанный при старте. Событие 'offline:income' эмитится
   * в конструкторе — до того, как UI подпишется, поэтому main.ts после сборки
   * UI проверяет это поле и показывает модалку. Гарантия без race condition.
   */
  pendingOfflineModal: { title: string; body: string } | null = null;

  private saveManager: SaveManager;
  private saveTimer = 0;
  private saveOnHideBound = this.handleVisibilityChange.bind(this);

  constructor() {
    this.state = new GameState();
    this.saveManager = new SaveManager('idle_tycoon_save_v2');
    this.loop = new GameLoop((dt) => this.tick(dt));

    this.loadOrInit();
    this.registerLifecycleHooks();
  }

  // ------------------------------------------------------------------ setup

  private loadOrInit(): void {
    const snap = this.saveManager.load();

    if (snap) {
      this.state.loadFromSnapshot(snap);

      const earnings = OfflineProgress.calc(this.state, snap.savedAt);
      if (earnings) {
        this.pendingOfflineModal = OfflineProgress.apply(this.state, earnings);
        events.emit('offline:income', this.pendingOfflineModal);
      }
    } else {
      this.state.recalculatePassiveIncome();
    }

    events.emit('money:changed', undefined);
  }

  private registerLifecycleHooks(): void {
    // Сворачивание/переключение вкладки — быстрый сейв (важно для мобильных).
    document.addEventListener('visibilitychange', this.saveOnHideBound);
    window.addEventListener('beforeunload', () => this.saveNow());
  }

  private handleVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      this.saveNow();
    }
  }

  // ------------------------------------------------------------- game loop

  private tick(dt: number): void {
    this.state.applyIncomeForDuration(dt);

    this.saveTimer += dt;
    if (this.saveTimer >= gameConfig.autoSaveIntervalSec) {
      this.saveTimer = 0;
      this.saveNow();
    }

    events.emit('tick', undefined);
  }

  // ----------------------------------------------------------------- public

  handleTap(): Decimal {
    const amount = this.state.applyTap();
    events.emit('tap:earned', { amount, totalTaps: this.state.tapsCount });
    events.emit('money:changed', undefined);
    return amount;
  }

  /** Покупка уровня объекта. Возвращает деф, если покупка состоялась. */
  buyObject(id: string): ObjectDef | null {
    const def = objectById.get(id as ObjectDef['id']);
    if (!def) return null;

    if (!this.state.buyUpgrade(def)) return null;

    events.emit('object:levelup', def);
    events.emit('money:changed', undefined);
    return def;
  }

  saveNow(): void {
    this.saveManager.save(this.state.toSnapshot());
    events.emit('game:saved', undefined);
  }

  /** Полный сброс прогресса (используется дебаг-панелью). */
  resetAll(): void {
    this.saveManager.clear();
    this.state.resetProgress();

    events.emit('game:reset', undefined);
    events.emit('money:changed', undefined);
  }

  /** В dev-режиме дебаг-панель может ускорять время. В проде — no-op. */
  setTimeScale(scale: number): void {
    this.loop.speedScale = Math.max(0.1, scale);
  }

  destroy(): void {
    this.loop.stop();
    document.removeEventListener('visibilitychange', this.saveOnHideBound);
    this.saveNow();
  }
}
