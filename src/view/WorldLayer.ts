import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { SCENE_GROUPS } from '@data/assets';

/**
 * ЗАДНИЙ СЛОЙ МИРА — «Фон» (объект 5 на чертеже).
 *
 * СТАТИЧЕСКИЙ: не участвует в дрейфе динамики, но СЛЕДУЕТ за экраном — на
 * каждом ресайзе пересчитывается cover и центр (фикс владельца 2026-09-30).
 * Непропорциональное окно срезает край фона симметрично — это ок.
 *
 * Cover считается по РАЗМЕРУ ТЕКУЩЕЙ ТЕКСТУРЫ, а не по эталону: фон любого
 * соотношения сторон закрывает экран без растяжения (эталон 1120×1505 из
 * sceneAssets.json — только номинальный кадр и заглушка).
 *
 * Текстуру ставит GameView.applyWorldStage по манифесту (setTexture(null) —
 * вернуть заглушку). Слою безразлично, картинка это или видео: и то и другое
 * приходит сюда как Texture. Мировые эпохи: world/<эпоха>.
 */

/** Номинальный эталон фона (размер текстуры из паспорта ассетов, px). */
export const WORLD_REF_W = SCENE_GROUPS.world.w;
export const WORLD_REF_H = SCENE_GROUPS.world.h;

/** Цвет прямоугольника фона — синий «задний слой» с чертежа. */
const BG_COLOR = 0x3f6f8f;

export class WorldLayer {
  readonly root = new Container();
  /** Контейнер-якорь: ставится в центр экрана, зумится cover-скейлом. */
  private holder = new Container();
  /** Прямоугольник-заглушка (до появления ассета). */
  private placeholder = new Graphics();
  /** Спрайт текстуры фона (картинка или видео). */
  private sprite = new Sprite();

  /** Размер текущего контента: эталон или фактическая текстура. */
  private contentW = WORLD_REF_W;
  private contentH = WORLD_REF_H;
  /** Последний экран — чтобы пересчитать cover при подмене текстуры. */
  private screenW = 0;
  private screenH = 0;

  constructor() {
    this.placeholder
      .rect(-WORLD_REF_W / 2, -WORLD_REF_H / 2, WORLD_REF_W, WORLD_REF_H)
      .fill({ color: BG_COLOR, alpha: 0.55 });
    this.placeholder
      .rect(-WORLD_REF_W / 2, -WORLD_REF_H / 2, WORLD_REF_W, WORLD_REF_H)
      .stroke({ width: 3, color: BG_COLOR });

    this.sprite.anchor.set(0.5);
    this.sprite.visible = false;

    this.holder.addChild(this.placeholder, this.sprite);
    this.root.addChild(this.holder);
  }

  /**
   * Вызывается один раз из GameView.init (после добавления root в stage):
   * сажает фон под ТЕКУЩИЙ экран.
   */
  init(screenW: number, screenH: number): void {
    this.layout(screenW, screenH);
  }

  /**
   * Подменить текстуру фона (null — вернуть заглушку). Сам по себе слой
   * ничего не грузит и не освобождает: владелец текстур — AssetRegistry.
   */
  setTexture(texture: Texture | null): void {
    if (texture) {
      this.sprite.texture = texture;
      this.contentW = texture.width || WORLD_REF_W;
      this.contentH = texture.height || WORLD_REF_H;
      this.sprite.visible = true;
      this.placeholder.visible = false;
    } else {
      this.sprite.texture = Texture.EMPTY;
      this.contentW = WORLD_REF_W;
      this.contentH = WORLD_REF_H;
      this.sprite.visible = false;
      this.placeholder.visible = true;
    }
    this.layout(this.screenW, this.screenH);
  }

  /**
   * Пересадка фона под ТЕКУЩИЙ экран — зовётся из GameView.layout на каждом
   * ресайзе: фон всегда ЦЕНТРИРОВАН и всегда ЗАКРЫВАЕТ экран (cover: scale =
   * max(w/contentW, h/contentH); непропорциональные окна срезают края).
   */
  layout(screenW: number, screenH: number): void {
    this.screenW = screenW;
    this.screenH = screenH;
    const scale = Math.max(screenW / this.contentW, screenH / this.contentH);
    this.holder.scale.set(scale);
    this.holder.x = Math.round(screenW / 2);
    this.holder.y = Math.round(screenH / 2);
  }

  /**
   * Левый ВЕРХНИЙ угол контента в координатах экрана (для метки).
   * Учитывает текущий cover-скейл (пересчитывается в layout).
   */
  get topLeftOnScreen(): { x: number; y: number } {
    return {
      x: this.holder.x - (this.contentW / 2) * this.holder.scale.x,
      y: this.holder.y - (this.contentH / 2) * this.holder.scale.y,
    };
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
