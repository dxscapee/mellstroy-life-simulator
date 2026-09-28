import { Container, Graphics } from 'pixi.js';

/**
 * ЗАДНИЙ СЛОЙ МИРА — «Фон» (объект 5 на чертеже).
 *
 * СТАТИЧЕСКИЙ: расстановка делается ОДИН РАЗ при init (cover от центра экрана
 * под начальный размер окна) и больше НИКОГДА не меняется — ни при ресайзе по
 * X, ни по Y (решение владельца: полная заморозка; ок по задумке, что на
 * непропорциональных окнах край срежет часть фона).
 *
 * Плейсхолдер — ОДИН прямоугольник цвета чертежа (сине-серый). Перекраска по
 * эпохе убрана: с карты сцены ушёл слой растительности, а смену эпох здесь
 * будет давать замена ТЕКСТУРЫ фона (worldEraBackground(era)) — сигнатура
 * applyStage сохранена ради контракта main → view.
 */

/** Эталон фона из чертежа владельца (размер текстуры, px). */
export const WORLD_REF_W = 1120;
export const WORLD_REF_H = 1505;

/** Цвет прямоугольника фона — синий «задний слой» с чертежа. */
const BG_COLOR = 0x3f6f8f;

export class WorldLayer {
  readonly root = new Container();
  /** Контейнер-якорь: один раз ставится в центр экрана и замораживается. */
  private holder = new Container();

  constructor() {
    this.root.addChild(this.holder);
  }

  /**
   * Вызывается один раз из GameView.init после добавления root в stage.
   * Единственная расстановка слоя: cover под НАЧАЛЬНЫЙ размер окна от центра.
   * Дальше слой заморожен — ресайз окна не двигает и не масштабирует его.
   */
  init(screenW: number, screenH: number): void {
    const g = new Graphics();
    g.rect(-WORLD_REF_W / 2, -WORLD_REF_H / 2, WORLD_REF_W, WORLD_REF_H)
      .fill({ color: BG_COLOR, alpha: 0.55 });
    g.rect(-WORLD_REF_W / 2, -WORLD_REF_H / 2, WORLD_REF_W, WORLD_REF_H)
      .stroke({ width: 3, color: BG_COLOR });
    this.holder.addChild(g);

    // Cover под начальное окно (один раз): фон всегда закрывает экран целиком.
    const scale = Math.max(screenW / WORLD_REF_W, screenH / WORLD_REF_H);
    this.holder.scale.set(scale);
    this.holder.x = Math.round(screenW / 2);
    this.holder.y = Math.round(screenH / 2);
  }

  /**
   * Применить эпоху (смена раз в 2 периода мира). Позиция и размер НЕ
   * меняются — слой статический; визуальная смена эпох вернётся вместе
   * с текстурами фона (путь: worldEraBackground(era)).
   */
  applyStage(_era: number): void {
    // Плейсхолдер один на все эпохи; контракт сохранён ради main → view.
  }

  /**
   * Левый ВЕРХНИЙ угол прямоугольника фона в координатах экрана (для метки).
   * Учитывает единственный cover-скейл, заданный при init.
   */
  get topLeftOnScreen(): { x: number; y: number } {
    return {
      x: this.holder.x - (WORLD_REF_W / 2) * this.holder.scale.x,
      y: this.holder.y - (WORLD_REF_H / 2) * this.holder.scale.y,
    };
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
