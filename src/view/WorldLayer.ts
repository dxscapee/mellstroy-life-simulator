import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { SCENE_GROUPS } from '@data/assets';
import type { SceneKind } from '@data/assets';

/**
 * ЗАДНИЙ СЛОЙ МИРА — «Фон» (объект 5 на чертеже).
 *
 * СТАТИЧЕСКИЙ: не участвует в дрейфе динамики, но СЛЕДУЕТ за экраном — на
 * каждом ресайзе пересчитывается cover и центр (фикс владельца 2026-09-30).
 * Непропорциональное окно срезает край фона симметрично — это ок.
 *
 * Cover считается по РАЗМЕРУ ТЕКУЩЕЙ ТЕКСТУРЫ, а не по эталону: фон любого
 * соотношения сторон закрывает экран без растяжения (эталон 1120×759 из
 * sceneAssets.json — только номинальный кадр и заглушка; аспект мастера
 * world/0 = 1.475 совпадает с ним).
 *
 * Текстуру ставит GameView.applySceneBackground по манифесту (setTexture(null) —
 * вернуть заглушку). Слою безразлично, картинка это или видео: и то и другое
 * приходит сюда как Texture. Ключи фона: world/<локация> (улица) и
 * world_home/<локация> (квартира).
 *
 * Заглушка знает про СЦЕНУ: у улицы и квартиры разные размеры бокса и цвета
 * (синий/тёплый), поэтому setScene(scene) перенастраивает прямоугольник и
 * повторно центрует фон (без текстуры cover считался бы по чужому боксу).
 */

/** Номинальный эталон фона (размер бокса из паспорта ассетов, px). */
export const WORLD_REF_W = SCENE_GROUPS.world.w;
export const WORLD_REF_H = SCENE_GROUPS.world.h;

/** Цвета прямоугольников-заглушек фона: улица — синий, квартира — тёплый. */
const BG_COLOR: Record<SceneKind, number> = {
  street: 0x3f6f8f,
  home: 0x8f6f3f,
};

/** Бокс заглушки фона для сцены (у каждой сцены свой размер из паспорта). */
const bgBox = (scene: SceneKind): { w: number; h: number } => {
  const spec = scene === 'home' ? SCENE_GROUPS.world_home : SCENE_GROUPS.world;
  return { w: spec.w, h: spec.h };
};

export class WorldLayer {
  readonly root = new Container();
  /** Контейнер-якорь: ставится в центр экрана, зумится cover-скейлом. */
  private holder = new Container();
  /** Прямоугольник-заглушка (до появления ассета). */
  private placeholder = new Graphics();
  /** Спрайт текстуры фона (картинка или видео). */
  private sprite = new Sprite();

  /** Размер текущего контента: эталон сцены или фактическая текстура. */
  private contentW = WORLD_REF_W;
  private contentH = WORLD_REF_H;
  /** Текущая сцена — от неё зависят бокс и цвет заглушки. */
  private scene: SceneKind = 'street';
  /** Последний экран — чтобы пересчитать cover при подмене текстуры. */
  private screenW = 0;
  private screenH = 0;

  constructor() {
    this.sprite.anchor.set(0.5);
    this.sprite.visible = false;

    this.holder.addChild(this.placeholder, this.sprite);
    this.root.addChild(this.holder);

    this.drawPlaceholder();
  }

  /** Перерисовать прямоугольник заглушки под текущую сцену (бокс + цвет). */
  private drawPlaceholder(): void {
    const { w, h } = bgBox(this.scene);
    const color = BG_COLOR[this.scene];

    this.placeholder.clear();
    this.placeholder.rect(-w / 2, -h / 2, w, h).fill({ color, alpha: 0.55 });
    this.placeholder.rect(-w / 2, -h / 2, w, h).stroke({ width: 3, color });
  }

  /**
   * Сменить сцену фона: у квартиры другой бокс и цвет заглушки. Текстуру
   * (если она уже стоит) не трогаем — GameView сам применит нужный ключ, а до
   * этого момента экран закрывает прежний фон (он больше размером).
   */
  setScene(scene: SceneKind): void {
    if (this.scene === scene) return;
    this.scene = scene;
    this.drawPlaceholder();
    if (!this.sprite.visible) {
      const box = bgBox(scene);
      this.contentW = box.w;
      this.contentH = box.h;
    }
    this.layout(this.screenW, this.screenH);
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
      const box = bgBox(this.scene);
      this.sprite.texture = Texture.EMPTY;
      this.contentW = box.w;
      this.contentH = box.h;
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
