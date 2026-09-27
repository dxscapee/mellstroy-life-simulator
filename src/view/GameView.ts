import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  TextStyle,
} from 'pixi.js';
import type { SceneObjectInfo } from '@data/objects';
import { WorldLayer } from './WorldLayer';

interface FloatText {
  node: Text;
  age: number;
  lifetime: number;
  active: boolean;
}

/**
 * ЗАКОН РАСКЛАДКИ СЦЕНЫ (мокап 1120×556 из ТЗ).
 *
 * Эталонная композиция задана смещениями (dx, dy) ОТ ЦЕНТРА холста — не долями
 * ширины/высоты. Два железных правила (требование владельца):
 * 1) РАЗМЕРЫ ОБЪЕКТОВ НЕ ЗАВИСЯТ ОТ ЭКРАНА. Scale плейсхолдера — его константа;
 *    при ресайзе меняется ТОЛЬКО положение на экране. Никакого зума сцены.
 * 2) На широких экранах объекты дрожат от центра лишь немного (drift = излишек
 *    ширины × DRIFT_GAIN, потолок DRIFT_MAX_TOTAL) и дальше замораживаются —
 *    «красные линии» мокапа. Дом и двор (dx = 0) всегда строго по центру.
 * Следствие: на узких окнах объекты сближаются и могут перекрываться —
 * осознанный размен за нерушимость размеров.
 */

/** Эталонная ширина мокапа: якоря вычислены для этого размера. */
const SCENE_REF_WIDTH = 1120;
/** Насколько px дрейфа даёт каждый px излишка ширины сверх эталона. */
const DRIFT_GAIN = 0.25;
/** Потолок дрейфа (px) — ширина «красных коридоров» мокапа (~50–65px). */
const DRIFT_MAX_TOTAL = 60;
/** Максимальное эталонное |dx| — нормировка доли дрейфа (самая крайняя точка). */
const SCENE_MAX_DX = 398;

/** Якорь сценового объекта: смещение от центра эталона + масштаб плейсхолдера. */
type SceneAnchor = { dx: number; dy: number; scale: number };

// Якоря сняты с мокапа 1120×556 (дом/двор — строго по центру, dx = 0):
const HOUSE_ANCHOR: SceneAnchor = { dx: 0, dy: -62, scale: 0.68 };
const YARD_ANCHOR: SceneAnchor = { dx: 0, dy: -60, scale: 0.55 };
const CAR_ANCHOR: SceneAnchor = { dx: -382, dy: 75, scale: 0.62 };
const CHAR_ANCHOR: SceneAnchor = { dx: 135, dy: 56, scale: 0.7 };
const FURNITURE_ANCHOR: SceneAnchor = { dx: -265, dy: 174, scale: 0.88 };
const PC_ANCHOR: SceneAnchor = { dx: -38, dy: 172, scale: 0.78 };
const TECH_ANCHOR: SceneAnchor = { dx: 197, dy: 190, scale: 0.72 };

/**
 * Слой 1: игровая сцена Pixi. Знает только про рисование и ввод на холсте.
 * Игровую логику не трогает — наружу отдаёт колбэк onTap и методы-эффекты.
 *
 * Плейсхолдеры сценовых объектов (дом, тачка) рисуются из примитивов и
 * перекрашиваются/подписываются по тиру: при levelup тира 5, 10, 15... вид меняется.
 * Реальные спрайты/атласы подставятся вместо draw-методов позже, без смены API.
 */
export class GameView {
  private app = new Application();
  private host: HTMLElement;

  private bg: Sprite | null = null;
  /** Слой мира: задний фон (обрезка при ресайзе) + растительность вокруг дома. */
  readonly world: WorldLayer = new WorldLayer();
  private character: Container | null = null;
  private house: Container | null = null;
  private car: Container | null = null;
  /** Плейсхолдеры остальных объектов: двор + рабочее место (рисуются при покупке). */
  private yard: Container | null = null;
  private workplace = new Map<string, Container>(); // tech | pc | furniture
  /** Носимые плейсхолдеры на персонаже: watch | face | clothes (видны при покупке). */
  private worn = new Map<string, Container>();
  /** Подпись стадии над сценовым объектом (плейсхолдер вместо спрайтов). */
  private stageLabels = new Map<string, Text>();
  private charBaseX = 0;
  private charBaseY = 0;
  /** Базовый масштаб персонажа (от него считаются squash-эффект и idle). */
  private charBaseScale = CHAR_ANCHOR.scale;
  private time = 0;

  /** Пул текстов «+1$»: без аллокаций на каждый тап. */
  private floatPool: FloatText[] = [];

  constructor(
    host: HTMLElement,
    private readonly onCanvasTap: (x: number, y: number) => void,
  ) {
    this.host = host;
  }

  async init(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      background: 0x101418,
      antialias: true,
      resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    this.host.appendChild(this.app.canvas);

    // Порядок depth: градиент → мир (фон+растительность) → сцена (дом, тачка…).
    this.buildBackground();
    this.buildYard();
    this.buildHouse();
    this.buildCar();
    this.buildWorkplace();
    this.buildCharacter();
    this.buildWorn();

    // Слои мира: фон — сразу за градиентом, растительность — ПЕРЕД двором
    // (то есть за двором, домом, тачкой, персонажем — весь передний слой поверх).
    this.world.init();
    this.app.stage.addChildAt(this.world.root, this.app.stage.getChildIndex(this.bg!) + 1);
    this.app.stage.addChildAt(
      this.world.vegetationRoot,
      this.app.stage.getChildIndex(this.yard!),
    );

    // Ввод: вся сцена кликабельна, тапы «пробивают» с HTML-оверлея
    // (у оверлея pointer-events: none, у холста — auto).
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointerdown', (e) => {
      const x = e.global.x;
      const y = e.global.y;
      this.punchCharacter();
      this.onCanvasTap(x, y);
    });

    this.app.renderer.on('resize', () => this.layout());
    this.layout();

    this.app.ticker.add((ticker) => this.update(ticker.deltaMS / 1000));
  }

  // ------------------------------------------------------------- построение

  /** Градиент рисуем через 2D-canvas текстуру — надёжно на любой версии Pixi v8. */
  private buildBackground(): void {
    const cv = document.createElement('canvas');
    cv.width = 4;
    cv.height = 512;
    const ctx = cv.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0, '#1b2431');
      grad.addColorStop(0.55, '#232f3e');
      grad.addColorStop(1, '#101418');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 4, 512);
    }

    this.bg = new Sprite(Texture.from(cv));
    this.app.stage.addChild(this.bg);
  }

  /** Дом-плейсхолдер: перекрашивается по тиру, подпись — название стадии. */
  private buildHouse(): void {
    const c = new Container();

    const body = new Graphics();
    body.rect(-90, -40, 180, 110).fill(0x3d4a5c);
    c.addChild(body);

    const roof = new Graphics();
    roof.poly([-100, -40, 0, -110, 100, -40]).fill(0x8c5a3c);
    c.addChild(roof);

    const door = new Graphics();
    door.roundRect(-18, 10, 36, 60, 4).fill(0x2a323d);
    c.addChild(door);

    this.house = c;
    this.app.stage.addChild(c);
  }

  /** Тачка-плейсхолдер: видна только после покупки (уровень >= 1). */
  private buildCar(): void {
    const c = new Container();

    const bodyG = new Graphics();
    bodyG.roundRect(-70, -22, 140, 34, 10).fill(0xc0392b);
    c.addChild(bodyG);

    const cabin = new Graphics();
    cabin.roundRect(-40, -46, 70, 30, 8).fill(0xc0392b);
    c.addChild(cabin);

    const w1 = new Graphics();
    w1.circle(-42, 14, 14).fill(0x1a1d21);
    c.addChild(w1);

    const w2 = new Graphics();
    w2.circle(44, 14, 14).fill(0x1a1d21);
    c.addChild(w2);

    c.visible = false; // тачка появляется после первой покупки
    this.car = c;
    this.app.stage.addChild(c);
  }

  /**
   * Двор-плейсхолдер (просто фигура за домом; позже — многослойный фон).
   * Зависит от тира: пустырь (перекрестье) → асфальт (серый) → паркет (теплый).
   */
  private buildYard(): void {
    const c = new Container();
    const g = new Graphics();
    g.roundRect(-130, -90, 260, 180, 12).fill(0x2a333f);
    // «Перекрестье» — метка пустыря, чтобы объект был виден даже на тире 0.
    g.moveTo(-90, 0).lineTo(90, 0).moveTo(0, -55).lineTo(0, 55)
      .stroke({ width: 3, color: 0x3a4655 });
    g.roundRect(-130, -90, 260, 180, 12).stroke({ width: 3, color: 0x3a4655 });
    c.addChild(g);

    c.visible = false; // появляется после покупки
    this.yard = c;
    this.app.stage.addChild(c);
  }

  /** Рабочее место: микрофон/комп/мебель — три отдельных плейсхолдера. */
  private buildWorkplace(): void {
    // Микрофон: капсула на стойке (тир 0) → студийный (тир 1) → золотой (тир 2).
    const tech = new Container();
    const tCapsule = new Graphics();
    tCapsule.roundRect(-11, -44, 22, 32, 11).fill(0x56657a);
    tech.addChild(tCapsule);
    const tGrill = new Graphics();
    tGrill.roundRect(-8, -41, 16, 12, 5).fill(0x22303d);
    tech.addChild(tGrill);
    const tHolder = new Graphics();
    tHolder.roundRect(-6, -12, 12, 12, 3).fill(0x3a4655);
    tech.addChild(tHolder);
    const tStand = new Graphics();
    tStand.rect(-2.5, 0, 5, 42).fill(0x3a4655);
    tStand.roundRect(-16, 42, 32, 6, 3).fill(0x3a4655);
    tech.addChild(tStand);
    this.workplace.set('tech', tech);

    // Комп: монитор на подставке.
    const pc = new Container();
    const pScreen = new Graphics();
    pScreen.roundRect(-36, -30, 72, 48, 6).fill(0x1c2632);
    pc.addChild(pScreen);
    const pGlow = new Graphics();
    pGlow.roundRect(-30, -24, 60, 36, 4).fill(0x39c2ff);
    pGlow.alpha = 0.85;
    pc.addChild(pGlow);
    const pStand = new Graphics();
    pStand.rect(-4, 18, 8, 14).fill(0x2c3846);
    pStand.roundRect(-18, 30, 36, 6, 3).fill(0x2c3846);
    pc.addChild(pStand);
    this.workplace.set('pc', pc);

    // Мебель: стул.
    const furniture = new Container();
    const fBack = new Graphics();
    fBack.roundRect(-18, -34, 36, 40, 5).fill(0x7a5a3a);
    furniture.addChild(fBack);
    const fSeat = new Graphics();
    fSeat.roundRect(-22, 4, 44, 12, 4).fill(0x8c6a46);
    furniture.addChild(fSeat);
    const fLegs = new Graphics();
    fLegs.moveTo(-18, 16).lineTo(-18, 46).moveTo(18, 16).lineTo(18, 46)
      .stroke({ width: 5, color: 0x5d4429 });
    furniture.addChild(fLegs);
    this.workplace.set('furniture', furniture);

    for (const item of this.workplace.values()) {
      item.visible = false; // появляется после покупки
      this.app.stage.addChild(item);
    }
  }

  /**
   * Носимые плейсхолдеры на персонаже. addChild идёт ПОСЛЕ character,
   * поэтому они рисуются поверх тела (см. layout: те же координаты + офсеты).
   */
  private buildWorn(): void {
    // Часы — на «запястье» (правый низ тела).
    const watch = new Container();
    const wStrap = new Graphics();
    wStrap.roundRect(0, 0, 10, 26, 4).fill(0x22303d);
    watch.addChild(wStrap);
    const wFace = new Graphics();
    wFace.circle(5, 13, 9).fill(0xf1c40f);
    watch.addChild(wFace);
    this.worn.set('watch', watch);

    // Лицо — «очки поверх» (тир 0 — просто улыбка-заглушка).
    const face = new Container();
    const fSmile = new Graphics();
    fSmile.arc(0, 0, 14, 0.35, Math.PI - 0.35).stroke({ width: 4, color: 0xb98a54 });
    face.addChild(fSmile);
    this.worn.set('face', face);

    // Шмот — «цепь» на груди (видна поверх тела; толще — заметнее на зелёном).
    const clothes = new Container();
    const chain = new Graphics();
    chain.moveTo(-30, 26).quadraticCurveTo(0, 46, 30, 26).stroke({ width: 6, color: 0xf7d774 });
    chain.circle(0, 40, 6).fill(0xf7d774); // кулон
    clothes.addChild(chain);
    this.worn.set('clothes', clothes);

    for (const item of this.worn.values()) {
      item.visible = false; // появляется после покупки
      this.app.stage.addChild(item);
    }
  }

  /** Заглушка персонажа из примитивов — позже заменится на спрайты/атлас. */
  private buildCharacter(): void {
    const c = new Container();

    // Тело (худи).
    const body = new Graphics();
    body.roundRect(-42, 20, 84, 96, 14).fill(0x2ecc71);
    c.addChild(body);

    // Голова.
    const head = new Graphics();
    head.circle(0, -14, 34).fill(0xf1c27d);
    c.addChild(head);

    // Кепка.
    const cap = new Graphics();
    cap.roundRect(-36, -52, 72, 18, 9).fill(0x34495e);
    cap.rect(-36, -40, 72, 7).fill(0x2c3e50);
    cap.rect(4, -46, 44, 9).fill(0x2c3e50);
    c.addChild(cap);

    // Очки.
    const glasses = new Graphics();
    glasses.rect(-26, -22, 22, 10).fill(0x111111);
    glasses.rect(4, -22, 22, 10).fill(0x111111);
    c.addChild(glasses);

    this.character = c;
    this.app.stage.addChild(c);
  }

  /**
   * Раскладка сцены — см. ЗАКОН РАСКЛАДКИ над константами выше:
   * позиции от центра, дрейф с заморозкой на широких, размеры НЕ зависят
   * от экрана. Здесь НЕТ долей ширины (w * 0.24 и т.п.) — только якоря.
   */
  private layout(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;

    if (this.bg) {
      this.bg.width = w;
      this.bg.height = h;
    }

    // Мир: фон — cover-обрезка от эталона (ресайз не перестраивает, а режет),
    // растительность — за домом, в координатах сцены (масштаб 1: не зумится).
    this.world.layoutBackground(w, h);

    const extra = Math.max(0, w - SCENE_REF_WIDTH);
    const drift = Math.min(DRIFT_MAX_TOTAL, extra * DRIFT_GAIN);

    const cx = w * 0.5;
    // Вертикальная ПОСАДКА: центр композиции смещается в свободную полосу между
    // HUD (сверху, ~150px с тремя рядами) и таб-баром (снизу ~110px). Только
    // позиция — размеры объектов от этого не зависят (железное правило 1).
    const topFree = Math.min(170, h * 0.24);
    const bottomFree = 120;
    const usable = Math.max(120, h - topFree - bottomFree);
    const cy = topFree + usable * 0.46;

    const place = (item: Container | null, a: SceneAnchor): void => {
      if (!item) return;
      // Размер — КОНСТАНТА плейсхолдера: экран влияет только на положение.
      item.scale.set(a.scale);
      // На узких экранах (уже эталона) dx схлопывается пропорционально — иначе
      // крайние объекты уходят за край. Это изменение ПОЗИЦИИ (разрешено),
      // размеры не трогаем. На широких — фактор 1, работает только дрейф.
      const squeeze = Math.min(1, w / SCENE_REF_WIDTH);
      const effDx = a.dx * squeeze;
      // Дрейф: доля якоря от самого крайнего, в сторону своего смещения.
      const driftShare = Math.abs(a.dx) / SCENE_MAX_DX;
      item.x = cx + effDx + Math.sign(a.dx) * drift * driftShare;
      item.y = cy + a.dy;
    };

    place(this.house, HOUSE_ANCHOR);
    place(this.yard, YARD_ANCHOR);
    place(this.car, CAR_ANCHOR);
    place(this.workplace.get('furniture') ?? null, FURNITURE_ANCHOR);
    place(this.workplace.get('pc') ?? null, PC_ANCHOR);
    place(this.workplace.get('tech') ?? null, TECH_ANCHOR);
    place(this.character, CHAR_ANCHOR);

    // Растительность следует за домом (та же система координат, что у сцены),
    // масштаб 1 — экранные размеры прямоугольника-заглушки константны.
    this.world.layoutVegetation(
      this.house?.x ?? cx,
      (this.house?.y ?? cy) + 30,
      1,
    );

    if (this.character) {
      this.charBaseX = this.character.x;
      this.charBaseY = this.character.y;
      this.charBaseScale = CHAR_ANCHOR.scale;
    }

    // Носимые следуют за персонажем (с учётом его idle-покачивания в update).
    this.syncWornPositions();

    // Подписи стадий следуют за своими объектами; офсеты константные — размеры
    // (и подписей, и объектов) от экрана не зависят. Подписи дома/двора клампятся
    // ниже HUD (topFree): на низких окнах иначе они прячутся под чип эпохи.
    const labelTopLimit = topFree + 34;
    this.stageLabels.get('house')?.position.set(
      this.house?.x ?? cx, Math.max((this.house?.y ?? cy) - 98, labelTopLimit));
    this.stageLabels.get('car')?.position.set(
      this.car?.x ?? 0, (this.car?.y ?? 0) - 70);
    this.stageLabels.get('bg')?.position.set(
      this.yard?.x ?? cx, Math.max((this.yard?.y ?? cy) - 70, labelTopLimit));
    this.stageLabels.get('furniture')?.position.set(
      this.workplace.get('furniture')?.x ?? 0, (this.workplace.get('furniture')?.y ?? 0) - 70);
    this.stageLabels.get('pc')?.position.set(
      this.workplace.get('pc')?.x ?? 0, (this.workplace.get('pc')?.y ?? 0) - 68);
    this.stageLabels.get('tech')?.position.set(
      this.workplace.get('tech')?.x ?? 0, (this.workplace.get('tech')?.y ?? 0) - 70);
  }

  /** Носимые держатся на персонаже (офсеты от его базовой точки). */
  private syncWornPositions(): void {
    if (!this.character) return;
    const x = this.charBaseX;
    const y = this.charBaseY;
    const s = this.charBaseScale;
    const watch = this.worn.get('watch');
    if (watch) {
      watch.position.set(x + 30 * s, y + 66 * s); // запястье
      watch.scale.set(s);
    }
    const face = this.worn.get('face');
    if (face) {
      face.position.set(x, y - 6 * s); // на голове
      face.scale.set(s);
    }
    const clothes = this.worn.get('clothes');
    if (clothes) {
      clothes.position.set(x, y + 30 * s); // грудь
      clothes.scale.set(s);
    }
  }

  /**
   * Применить стадию мира (эпоха фона + фаза растительности).
   * Вызывается из main при 'world:changed' и один раз на старте.
   */
  applyWorldStage(era: number, phase: number): void {
    this.world.applyStage(era, phase);
    this.layout(); // новый фон может требовать cover-пересчёт
  }

  // ------------------------------------------------------------ тиры сцены

  /**
   * Применить визуальное состояние сцены по уровням объектов.
   * Вызывается из main при 'object:levelup' и один раз на старте.
   */
  applySceneState(states: SceneObjectInfo[]): void {
    for (const s of states) {
      switch (s.id) {
        case 'house': {
          // Плейсхолдер: тир = перекраска контейнера (спрайты стадий придут позже).
          const tints = [0x3d4a5c, 0x5d6d80, 0x8fa3b8, 0xd8c690]; // коробка → пентхаус
          if (this.house) this.house.tint = tints[Math.min(s.tier, tints.length - 1)];
          this.ensureStageLabel('house', s.stageName);
          break;
        }
        case 'car': {
          if (this.car) this.car.visible = s.owned;
          this.toggleStageLabel('car', s.owned, s.stageName);
          break;
        }
        case 'bg': {
          // Двор: тир = перекраска (пустырь → асфальт → паркет).
          const yardTints = [0x2a333f, 0x46525f, 0x8a6f4d];
          if (this.yard) {
            this.yard.visible = s.owned;
            this.yard.tint = yardTints[Math.min(s.tier, yardTints.length - 1)];
          }
          this.toggleStageLabel('bg', s.owned, s.stageName);
          break;
        }
        case 'tech':
        case 'pc':
        case 'furniture': {
          // Рабочее место: тир = смена акцентного цвета заглушки.
          const item = this.workplace.get(s.id);
          if (item) {
            item.visible = s.owned;
            const wpTints = [0xffffff, 0x9fffcf, 0xffd97a]; // тир-акцент через tint
            item.tint = wpTints[Math.min(s.tier, wpTints.length - 1)];
          }
          this.toggleStageLabel(s.id, s.owned, s.stageName);
          break;
        }
        case 'watch':
        case 'face':
        case 'clothes': {
          const worn = this.worn.get(s.id);
          if (worn) {
            worn.visible = s.owned;
            const wornTints = [0xffffff, 0xbfe8ff, 0xffd97a];
            worn.tint = wornTints[Math.min(s.tier, wornTints.length - 1)];
          }
          break; // носимые не подписываются — и так на персонаже
        }
      }
    }
  }

  /** Показать/скрыть подпись стадии (destroy при скрытии — как раньше для car). */
  private toggleStageLabel(key: string, show: boolean, text: string): void {
    if (show) {
      this.ensureStageLabel(key, text);
    } else {
      this.stageLabels.get(key)?.destroy();
      this.stageLabels.delete(key);
    }
  }

  /** Ленивое создание подписи стадии. */
  private ensureStageLabel(key: string, text: string): void {
    let label = this.stageLabels.get(key);
    if (!label) {
      label = new Text({
        text: '',
        style: new TextStyle({
          fontFamily: 'Arial, sans-serif',
          fontSize: 15,
          fontWeight: '700',
          fill: 0xd7dde6,
          stroke: { color: 0x0b0e12, width: 3 },
        }),
      });
      label.anchor.set(0.5);
      this.app.stage.addChild(label);
      this.stageLabels.set(key, label);
    }
    if (label.text !== text) label.text = text;
    this.layout();
  }
  // ----------------------------------------------------------------- тапы

  /** Сквош-эффект персонажа при клике (относительно его базового масштаба). */
  private punchCharacter(): void {
    if (!this.character) return;
    this.character.scale.set(this.charBaseScale * 1.16);
  }

  /** Всплывающий текст «+N$» в мировых координатах холста. */
  spawnMoneyText(amount: string, x: number, y: number): void {
    let slot = this.floatPool.find((f) => !f.active);

    if (!slot) {
      const style = new TextStyle({
        fontFamily: 'Arial, sans-serif',
        fontSize: 30,
        fontWeight: 'bold',
        fill: 0x7cfc00,
        stroke: { color: 0x0b3d0b, width: 4 },
      });
      const node = new Text({ text: '', style });
      node.anchor.set(0.5);
      this.app.stage.addChild(node);

      slot = { node, age: 0, lifetime: 0.9, active: false };
      this.floatPool.push(slot);
    }

    slot.node.text = `+${amount}`;
    slot.node.x = x + (Math.random() * 40 - 20);
    slot.node.y = y - 10;
    slot.node.alpha = 1;
    slot.node.scale.set(1);
    slot.node.visible = true;
    slot.age = 0;
    slot.active = true;
  }

  // ------------------------------------------------------------- кадр

  private update(dt: number): void {
    this.time += dt;

    // Плавное возвращение масштаба после тапа (к базовому, а не к 1).
    if (this.character) {
      const s = this.character.scale.x;
      const next = s + (this.charBaseScale - s) * Math.min(1, dt * 9);
      this.character.scale.set(next);

      // Idle-анимация: лёгкое покачивание.
      this.character.y = this.charBaseY + Math.sin(this.time * 2.2) * 7;
      this.character.rotation = Math.sin(this.time * 1.1) * 0.02;
      this.syncWornPositions();
    }

    // Обновление всплывающих текстов.
    for (const f of this.floatPool) {
      if (!f.active) continue;

      f.age += dt;
      const t = f.age / f.lifetime;

      f.node.y -= 70 * dt;
      f.node.alpha = Math.max(0, 1 - t);
      f.node.scale.set(1 + t * 0.25);

      if (f.age >= f.lifetime) {
        f.active = false;
        f.node.visible = false;
      }
    }
  }

  destroy(): void {
    this.app.destroy(true, { children: true, texture: true });
  }
}
