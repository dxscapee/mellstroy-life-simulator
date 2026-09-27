import { Container, Graphics, Sprite } from 'pixi.js';
import {
  WORLD_PERIODS,
  worldEraBackground,
  worldVegetationKey,
} from '@data/worldStages';

/**
 * Слой МИРА: задний фон + средний слой (растительность).
 *
 * ЗАДНИЙ СЛОЙ — статичен при ресайзе: рисуется в логическом эталоне
 * REF_W×REF_H и вписывается по cover (масштаб = max по осям), центр — центр
 * экрана. Изменение ширины окна НЕ перестраивает композицию, а ОБРЕЗАЕТ её
 * по краям (требование владельца). Меняется раз в 2 периода: era = period/2.
 *
 * СРЕДНИЙ СЛОЙ (растительность) — небольшая область вокруг дома, ВНУТРИ закона
 * сцены (якоря от центра, зум/дрейф как у всех объектов). Меняется каждый
 * период — в 2 раза чаще фона. За домом — рисуется ДО дома (глубина).
 *
 * Ассетов пока нет: строим плейсхолдеры; worldEraBackground() уже отдаёт пути —
 * замена на Sprite.from(url)/video-texture не тронет интерфейс слоя.
 */

/** Логический эталон заднего фона (мокап): обрезается по краям при ресайзе. */
export const WORLD_REF_W = 1120;
export const WORLD_REF_H = 556;

export class WorldLayer {
  readonly root = new Container();
  /** Растительность живёт в системе координат сцены (закон GameView.layout). */
  readonly vegetationRoot = new Container();

  private bgHolder = new Container();
  private bgContent: Container | Sprite | null = null;
  /** Кэш текстур/плейсхолдеров эпох и фаз: строим один раз, дальше только show/hide. */
  private bgByEra = new Map<number, Container>();
  private vegByPhase = new Map<number, Container>();
  private currentEra = -1;
  private currentPhase = -1;
  /** Отложенное применение стадии до конца init(). */
  private pendingStage: { era: number; phase: number } | null = null;

  constructor() {
    this.root.addChild(this.bgHolder);
    this.vegetationRoot.visible = false;
  }

  /** Вызывается один раз из GameView.init после добавления в stage. */
  init(): void {
    this.buildAllVegetation();
    if (this.pendingStage) {
      const { era, phase } = this.pendingStage;
      this.pendingStage = null;
      this.applyStage(era, phase);
    }
  }

  /**
   * Применить стадию мира. Смена эпох меняет фон (плейсхолдеры кэшируются),
   * смена фазы — только видимость растительности. Позиционирование делает
   * GameView.layout через layoutBackground/layoutVegetation (там размеры экрана).
   */
  applyStage(era: number, phase: number): void {
    if (era === this.currentEra && phase === this.currentPhase) return;

    if (era !== this.currentEra) {
      this.clearBg();
      this.bgContent = this.getBg(era);
      this.bgHolder.addChild(this.bgContent);
      this.currentEra = era;
    }

    if (phase !== this.currentPhase) {
      this.vegetationRoot.visible = true;
      for (const [key, veg] of this.vegByPhase) {
        veg.visible = key === phase;
      }
      this.currentPhase = phase;
    }
  }

  /**
   * Обложка заднего фона под экран: cover + центр. НО композиция не тянется
   * за экраном: масштаб от ЭТАЛОНА, излишки просто обрезаются краем холста
   * (у фона нет привязки к долям ширины).
   */
  layoutBackground(screenW: number, screenH: number): void {
    if (!this.bgContent) return;
    const scale = Math.max(screenW / WORLD_REF_W, screenH / WORLD_REF_H);
    this.bgHolder.scale.set(scale);
    this.bgHolder.x = screenW / 2;
    this.bgHolder.y = screenH / 2;
  }

  /**
   * Позиция растительности относительно центра дома (закон сцены).
   * Масштаб передаётся формально (для будущих текстур), сейчас всегда 1:
   * экранные размеры среднего слоя не зависят от ресайза.
   */
  layoutVegetation(houseX: number, houseY: number, scale = 1): void {
    this.vegetationRoot.x = houseX;
    this.vegetationRoot.y = houseY;
    this.vegetationRoot.scale.set(scale);
  }

  // ------------------------------------------------------------- построение

  private clearBg(): void {
    if (this.bgContent) {
      this.bgHolder.removeChild(this.bgContent);
      // Плейсхолдеры кэшируются в bgByEra и переиспользуются при возврате эпохи.
      this.bgContent = null;
    }
  }

  private getBg(era: number): Container {
    let bg = this.bgByEra.get(era);
    if (!bg) {
      bg = this.buildBgPlaceholder(era);
      this.bgByEra.set(era, bg);
    }
    return bg;
  }

  /**
   * Плейсхолдер эпохи фона: СПЛОШНОЙ ЦВЕТ в логическом эталоне — дальше
   * вместо него встанет текстура/video (worldEraBackground(era)), поэтому
   * никаких деталей: одна заливка, отличать эпохи можно только оттенком.
   */
  private buildBgPlaceholder(era: number): Container {
    const c = new Container();

    const colors: readonly number[] = [
      0x2a2620, // Пустошь: выжженная земля
      0x24301f, // Окраина: пожухлая трава
      0x1f3326, // Предместье: зелень
      0x1d2b3a, // Городок: асфальт/сумерки
      0x16202e, // Мегаполис: ночь, бетон
      0x1a1424, // Мегаструктура: неон/сумрак
    ];

    const g = new Graphics();
    g.rect(
      -WORLD_REF_W / 2,
      -WORLD_REF_H / 2,
      WORLD_REF_W,
      WORLD_REF_H,
    ).fill(colors[Math.min(era, colors.length - 1)]);
    c.addChild(g);

    void worldEraBackground(era); // путь зафиксирован контрактом
    return c;
  }

  /**
   * Растительность: 12 фаз. Строится один раз, видима ровно одна.
   * Плейсхолдер — ОДИН прямоугольник за домом: цвет чуть зеленеет с каждым
   * периодом. Текстура фазы встанет сюда без смены API.
   */
  private buildAllVegetation(): void {
    for (let phase = 0; phase < WORLD_PERIODS; phase++) {
      const veg = this.buildVegetationPlaceholder(phase);
      veg.visible = false;
      this.vegByPhase.set(phase, veg);
      this.vegetationRoot.addChild(veg);
    }
  }

  /** Один прямоугольник позади дома (дом в (0,0) контейнера сцены). */
  private buildVegetationPlaceholder(phase: number): Container {
    void worldVegetationKey(phase);
    const c = new Container();

    // От серо-жухлого к сочному зелёному: 12 шагов канала G.
    const g0 = 0x50;
    const gChannel = Math.min(0xff, g0 + phase * 0x11);
    const color = (0x1d << 16) | (gChannel << 8) | 0x24;

    const g = new Graphics();
    g.rect(-330, -40, 660, 150).fill(color);
    c.addChild(g);
    return c;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.vegetationRoot.destroy({ children: true });
  }
}
