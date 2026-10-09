import { gameConfig } from '@data/gameConfig';
import { objectById } from '@data/objects';
import type { SceneKind } from '@data/assets';
import type Decimal from 'break_infinity.js';
import { events } from './eventBus';
import { GameState } from './GameState';
import { GameLoop } from './GameLoop';
import { OfflineProgress } from './OfflineProgress';
import { SaveManager } from './SaveManager';
import type { BuyMode, ObjectDef } from './types';

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
  /** Таймер пассивного прироста подписчиков (раз в gameConfig.subscribers.addIntervalSec). */
  private subscriberTimer = 0;
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

    // Пассивный прирост подписчиков: раз в интервал капает пассивный доход за него.
    this.subscriberTimer += dt;
    if (this.subscriberTimer >= gameConfig.subscribers.addIntervalSec) {
      this.subscriberTimer -= gameConfig.subscribers.addIntervalSec;
      const wasReady = this.state.subscribers.claimable;
      this.state.addSubscribersFromPassive(gameConfig.subscribers.addIntervalSec);
      this.emitSubscriberEvents(wasReady);
    }

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
    // Бонус подписчиков за каждый N-й клик (величина = доход за этот клик).
    const subsWereReady = this.state.subscribers.claimable;
    this.state.addSubscribersFromTap(amount);
    this.emitSubscriberEvents(subsWereReady);

    events.emit('tap:earned', { amount, totalTaps: this.state.tapsCount });
    events.emit('money:changed', undefined);
    return amount;
  }

  /** Эмитим события подписчиков только при фактических изменениях. */
  private emitSubscriberEvents(wasReady: boolean): void {
    const isReady = this.state.subscribers.claimable;
    if (isReady && !wasReady) events.emit('subscribers:ready', undefined);
    else events.emit('subscribers:changed', undefined);
  }

  /** Забрать награду за заполненную шкалу подписчиков. Возвращает сумму или null. */
  claimSubscribers(): Decimal | null {
    const reward = this.state.claimSubscribers();
    if (reward) {
      events.emit('money:changed', undefined);
      events.emit('subscribers:changed', undefined);
    }
    return reward;
  }

  /**
   * Покупка уровней объекта. mode — режим магазина ('one' — один уровень,
   * 'tier' — до конца текущего грейда на доступные деньги, см. BuyMode).
   * События эмитятся ОДИН раз на всю пачку (иначе зажатая кнопка спамит шину):
   * сцена получает одно 'object:levelup', карточки/HUD обновятся на ближайшем тике.
   * Возвращает деф, если покупка состоялась.
   */
  buyObject(id: string, mode: BuyMode = 'one'): ObjectDef | null {
    const def = objectById.get(id as ObjectDef['id']);
    if (!def) return null;

    const prevLevel = def.currentLevel;
    const moneyBefore = this.state.money;
    if (this.state.buyUpgradeBulk(def, mode) <= 0) return null;

    events.emit('object:levelup', def);
    events.emit('money:changed', undefined);
    // Прошлый уровень + списанная сумма — чтобы дебаг-панель откатила
    // ЭТУ покупку как отдельное действие (см. GameEventMap 'object:purchased').
    events.emit('object:purchased', { def, prevLevel, cost: moneyBefore.sub(this.state.money) });
    return def;
  }

  saveNow(): void {
    this.saveManager.save(this.state.toSnapshot());
    events.emit('game:saved', undefined);
  }

  /**
   * Переход на следующую локацию (кнопка в попапе локаций, открывается кольцом
   * при 100% прокачки). false — нельзя: не вкачано или это последняя локация.
   * Сейв сразу: смена локации — редкое и важное событие, терять нельзя.
   */
  advanceLocation(): boolean {
    if (!this.state.advanceLocation()) return false;
    events.emit('location:changed', { location: this.state.location });
    this.saveNow();
    return true;
  }

  // ----------------------------------------------------------------- scene

  /**
   * Смена сцены (Дом ↔ Улица): модель меняет бонус потока (home — +15%
   * пассива, street — +15% тапа) и эмитится событие для HUD/сцены. false — сцена
   * уже была такой (переключения не было).
   */
  setScene(scene: SceneKind): boolean {
    if (this.state.scene === scene) return false;
    this.state.setScene(scene);
    events.emit('scene:changed', { scene });
    return true;
  }

  /** Полный сброс прогресса (используется дебаг-панелью). */
  resetAll(): void {
    this.saveManager.clear();
    this.state.resetProgress();

    events.emit('game:reset', undefined);
    events.emit('money:changed', undefined);

    // Локация откатывается в нулевую — сцена (фон) и подпись кольца перечитываются.
    events.emit('location:changed', { location: this.state.location });
  }

  /** В dev-режиме дебаг-панель может ускорять время. В проде — no-op. */
  setTimeScale(scale: number): void {
    this.loop.speedScale = Math.max(0.1, scale);
  }

  /**
   * Пересинхронизация UI после ПРЯМЫХ мутаций state из dev-инструментов
   * (undo денег, applyLevels и т.п.): HUD и кольцо перерисуются на ближайшем
   * тике (кольцо читает живую прокачку, отдельных кэшей у него нет).
   */
  refreshAfterDebug(): void {
    events.emit('money:changed', undefined);
  }

  destroy(): void {
    this.loop.stop();
    document.removeEventListener('visibilitychange', this.saveOnHideBound);
    this.saveNow();
  }
}
