import { SCENE_META, SCENE_ORDER } from '@data/assets';
import type { SceneKind } from '@data/assets';

/**
 * КНОПКА ПЕРЕХОДА МЕЖДУ СЦЕНАМИ (улица ↔ дом) — вертикальная пилюля сбоку
 * справа над таб-баром (решение владельца 2026-10-04: «доп. кнопка сбоку»).
 *
 * Показывает ТУ сцену, в которую игрок перейдёт по клику (не текущую):
 * поэтому подпись всегда читается как действие («Дом» — «зайти домой»).
 * Своих данных не хранит: сцена — свойство СЦЕНЫ (GameView), а не UI, поэтому
 * текущее состояние кнопка получает через провайдер и обновляется по событию
 * 'scene:changed'. Слой ui про view не знает — провайдер даёт main.
 */
export class SceneButton {
  private readonly root: HTMLButtonElement;
  private readonly iconEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  private offScene: (() => void) | null = null;
  private shown: SceneKind | null = null;

  constructor(
    uiRoot: HTMLElement,
    /** Текущая сцена (main читает у GameView — ui остаётся в стороне от view). */
    private readonly currentScene: () => SceneKind,
    /** Переключить сцену (main зовёт GameView.setScene). */
    private readonly onSwitch: (scene: SceneKind) => void,
    /** Подписка на смену сцены (main даёт events.on('scene:changed')); null — без подписки. */
    subscribe?: (listener: () => void) => () => void,
  ) {
    this.root = document.createElement('button');
    this.root.className = 'scene-btn js-interactive';
    this.root.type = 'button';

    this.iconEl = document.createElement('span');
    this.iconEl.className = 'scene-icon';

    this.labelEl = document.createElement('span');
    this.labelEl.className = 'scene-label';

    this.root.append(this.iconEl, this.labelEl);
    this.root.addEventListener('click', () => {
      this.onSwitch(this.nextScene());
    });

    uiRoot.appendChild(this.root);
    if (subscribe) this.offScene = subscribe(() => this.render());

    this.render();
  }

  /** Сцена-цель: первая в SCENE_ORDER, которая не текущая. */
  private nextScene(): SceneKind {
    const current = this.currentScene();
    return SCENE_ORDER.find((scene) => scene !== current) ?? current;
  }

  /** Перерисовать подпись/иконку под текущую сцену (DOM — только при смене). */
  private render(): void {
    const target = this.nextScene();
    if (target === this.shown) return;
    this.shown = target;

    const meta = SCENE_META[target];
    this.iconEl.textContent = meta.icon;
    this.labelEl.textContent = meta.label;
    this.root.title = target === 'home' ? 'Зайти домой' : 'Выйти на улицу';
    this.root.setAttribute('aria-label', `Перейти: ${meta.label}`);
  }

  destroy(): void {
    this.offScene?.();
    this.offScene = null;
    this.root.remove();
  }
}