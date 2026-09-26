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

interface FloatText {
  node: Text;
  age: number;
  lifetime: number;
  active: boolean;
}

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
  private character: Container | null = null;
  private house: Container | null = null;
  private car: Container | null = null;
  /** Подпись стадии над сценовым объектом (плейсхолдер вместо спрайтов). */
  private stageLabels = new Map<string, Text>();
  private charBaseX = 0;
  private charBaseY = 0;
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

    this.buildBackground();
    this.buildHouse();
    this.buildCar();
    this.buildCharacter();

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

  /** Раскладка элементов под текущий размер холста. */
  private layout(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;

    if (this.bg) {
      this.bg.width = w;
      this.bg.height = h;
    }

    if (this.house) {
      this.house.x = w * 0.5;
      this.house.y = h * 0.34;
    }

    if (this.car) {
      this.car.x = w * 0.24;
      this.car.y = h * 0.78;
    }

    if (this.character) {
      this.charBaseX = w * 0.62;
      this.charBaseY = h * 0.62;
      this.character.x = this.charBaseX;
      this.character.y = this.charBaseY;
    }

    // Подписи стадий следуют за своими объектами.
    this.stageLabels.get('house')?.position.set(this.house?.x ?? 0, (this.house?.y ?? 0) - 130);
    this.stageLabels.get('car')?.position.set(this.car?.x ?? 0, (this.car?.y ?? 0) - 70);
  }

  // ------------------------------------------------------------ тиры сцены

  /**
   * Применить визуальное состояние сцены по уровням объектов.
   * Вызывается из main при 'object:levelup' и один раз на старте.
   */
  applySceneState(states: SceneObjectInfo[]): void {
    for (const s of states) {
      if (s.id === 'house') {
        // Плейсхолдер: тир = перекраска контейнера (спрайты стадий придут позже).
        const tints = [0x3d4a5c, 0x5d6d80, 0x8fa3b8, 0xd8c690]; // коробка → пентхаус
        if (this.house) this.house.tint = tints[Math.min(s.tier, tints.length - 1)];
        this.ensureStageLabel('house', s.stageName);
      } else if (s.id === 'car') {
        if (this.car) this.car.visible = s.owned;
        if (s.owned) this.ensureStageLabel('car', s.stageName);
        else {
          this.stageLabels.get('car')?.destroy();
          this.stageLabels.delete('car');
        }
      }
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

  /** Сквош-эффект персонажа при клике. */
  private punchCharacter(): void {
    if (!this.character) return;
    this.character.scale.set(1.16);
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

    // Плавное возвращение масштаба после тапа.
    if (this.character) {
      const s = this.character.scale.x;
      const next = s + (1 - s) * Math.min(1, dt * 9);
      this.character.scale.set(next);

      // Idle-анимация: лёгкое покачивание.
      this.character.y = this.charBaseY + Math.sin(this.time * 2.2) * 7;
      this.character.rotation = Math.sin(this.time * 1.1) * 0.02;
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
