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
import { WorldLayer, WORLD_REF_W, WORLD_REF_H } from './WorldLayer';

interface FloatText {
  node: Text;
  age: number;
  lifetime: number;
  active: boolean;
}

/**
 * ЗАКОН РАСКЛАДКИ СЦЕНЫ v2 (чертёж владельца 2026-09-29, уточнён 2026-09-30).
 *
 * Эталонная композиция — вертикальный экран SCENE_REF_W × SCENE_REF_H
 * (1120×1505), все координаты сняты с чертежа. Два ТИПА объектов:
 *
 * СТАТИЧЕСКИЕ (фон, двор, дом) — X следует за ЦЕНТРОМ ЭКРАНА на КАЖДОМ
 * ресайзе (фикс владельца 2026-09-30: раньше X фиксировался один раз при init,
 * и при сужении окна дом/двор/фон «уезжали» вправо); Y — центр композиции
 * между HUD и таб-баром. Размеры константны: непропорциональное окно срезает
 * край объекта, но сам объект остаётся в центре.
 *
 * ДИНАМИЧЕСКИЕ (игрок, машина, рабочее место) — якорь от центра композиции;
 * на широких окнах отъезжают от центра (жёлтые стрелки чертежа): drift =
 * излишек ширины × DRIFT_GAIN, потолок DRIFT_MAX_TOTAL. На узких окнах
 * отъезд схлопывается (squeeze), центр композиции по Y садится в свободную
 * полосу между HUD и таб-баром (только позиция, размеры не трогаются).
 *
 * ГРУППА ИГРОКА (игрок + причёска/одежда/часы) НЕ анимируется (владелец
 * 2026-09-30, временно): покачивание по Y и наклон сняты, остался только
 * сквиш-отклик на тап. Разъезд по ширине окна — часть раскладки, не анимации.
 *
 * Все объекты — ПРЯМОУГОЛЬНИКИ-ЗАГЛУШКИ в цветах чертежа с номером и
 * размером в px (цель: владелец снимает размеры текстур). Текстуры и видео
 * встанут позже ВМЕСТО прямоугольника внутри buildRect, API не меняется.
 */

/** Эталон композиции (весь чертёж): SCENE_REF_W×SCENE_REF_H, центр по Y. */
export const SCENE_REF_W = 1120;
export const SCENE_REF_H = 1505;

/** Насколько px отъезда даёт каждый px излишка ширины сверх эталона. */
const DRIFT_GAIN = 0.25;
/** Потолок отъезда (px) — длина жёлтых стрелок чертежа. */
const DRIFT_MAX_TOTAL = 190;

/** Свободная полоса между HUD и таб-баром: посадка центра композиции по Y. */
const TOP_FREE_MAX = 170; // HUD с тремя рядами
const BOTTOM_FREE = 120; // таб-бар
/** Доля свободной полосы, на которой стоит центр композиции. */
const CY_FRAC = 0.46;

/**
 * Заглушка одного объекта: цвет/номер/размер — с чертежа.
 * lift — подъём ПОДПИСИ (px) над верхом прямоугольника: у стопок конгруэнтных
 * слоёв подписи ставятся колонкой, иначе сливаются в одну нечитаемую строку.
 */
interface RectSpec {
  w: number;
  h: number;
  color: number;
  num: string;
  label: string;
  lift?: number;
}

/**
 * Прямоугольники-заглушки объектов сцены: цвет, номер и размер — с чертежа.
 * Фон(5) живёт в WorldLayer (WORLD_REF_W/H — его размер текстуры).
 */
const YARD_SPEC: RectSpec = { w: 1080, h: 910, color: 0xff00aa, num: '6', label: 'ДВОР' };
const HOUSE_SPEC: RectSpec = { w: 740, h: 620, color: 0x00a844, num: '4', label: 'ДОМ' };
const CAR_SPEC: RectSpec = { w: 290, h: 190, color: 0xe01010, num: '2', label: 'МАШИНА' };
const CHAR_SPEC: RectSpec = { w: 330, h: 690, color: 0xe01010, num: '1', label: 'ИГРОК' };
/**
 * Рабочее место: ТРИ КОНГРУЭНТНЫХ слоя 350×300, стоящих в ОДНОЙ точке
 * (владелец 2026-09-30: «все объекты в одном месте, просто наложены друг на
 * друга»): мебель(12) — дальний, микрофон(11) — средний, комп(10) — ближний.
 * lift разводит подписи колонкой над верхом: КОМП → МИКРОФОН → МЕБЕЛЬ.
 */
const FURNITURE_SPEC: RectSpec = { w: 350, h: 300, color: 0xe01010, num: '12', label: 'МЕБЕЛЬ', lift: 0 };
const TECH_SPEC: RectSpec = { w: 350, h: 300, color: 0xe01010, num: '11', label: 'МИКРОФОН', lift: 27 };
const PC_SPEC: RectSpec = { w: 350, h: 300, color: 0xe01010, num: '10', label: 'КОМП', lift: 54 };

/**
 * Носимые на игроке: дети контейнера игрока, наследуют его позицию/масштаб.
 * Все слои КОНГРУЭНТНЫ игроку (330×690) — текстуры рисуются на одном холсте
 * и совпадают с телом пиксель в пиксель (владелец 2026-09-30); часы приподняты
 * на 20px относительно игрока. Слои (глубина addChild): тело(1) → причёска(8)
 * + одежда(9) → часы(7). Подписи разведены колонкой (шаг 27px от верха тела):
 * ПРИЧЁСКА → ОДЕЖДА → ЧАСЫ → ИГРОК.
 */
const WORN_SPECS: Record<'hair' | 'clothes' | 'watch', RectSpec & { ox: number; oy: number }> = {
  // Причёска — ровно на игроке (тот же холст 330×690).
  hair: { w: 330, h: 690, color: 0xe01010, num: '8', label: 'ПРИЧЁСКА', ox: 0, oy: 0, lift: 81 },
  // Одежда — ровно на игроке (тот же холст 330×690, один слой с причёской).
  clothes: { w: 330, h: 690, color: 0xe01010, num: '9', label: 'ОДЕЖДА', ox: 0, oy: 0, lift: 54 },
  // Часы — тот же холст 330×690, но на 20px ВЫШЕ игрока (подпись в колонке).
  watch: { w: 330, h: 690, color: 0xe01010, num: '7', label: 'ЧАСЫ', ox: 0, oy: -20, lift: 7 },
};

/** Якорь динамического объекта: смещение от центра композиции. */
type DynAnchor = { dx: number; dy: number };

// Снято с чертежа (эталон 1120×1505, центр композиции (560, ~707)):
const CAR_ANCHOR: DynAnchor = { dx: 230, dy: 35 };
const CHAR_ANCHOR: DynAnchor = { dx: -240, dy: 215 };
/**
 * Рабочее место — ОДНА точка на все три конгруэнтных слоя (владелец
 * 2026-09-30: «положение как у стола, но чуть-чуть правее»). Стол был
 * (280, 240) → +30 вправо; центр по Y не сдвигаем — верх прямоугольника
 * поднялся сам на 25px из-за роста высоты 250 → 300.
 */
const WORKPLACE_ANCHOR: DynAnchor = { dx: 310, dy: 240 };

/** Общий dx рабочей группы: все три слоя отъезжают КАК ОДНО ЦЕЛОЕ. */
const WORKPLACE_GROUP_DX = 200;

/**
 * Статические объекты: смещение центра от ЦЕНТРА КОМПОЗИЦИИ (cy).
 * Дом — центр чуть выше центра композиции (верх ~23% высоты, низ ~66%);
 * двор — центр заметно ниже (верх ~35% высоты, низ ~95%): дом выглядывает
 * из-за двора сверху, двор идёт до самого низа — как на чертеже.
 */
const HOUSE_DY = -25; // центр дома относительно cy
const YARD_DY = 270; // центр двора относительно cy

/** Доля отъезда (0..1) при drift = DRIFT_MAX_TOTAL — по удалённости от центра. */
const driftShare = (dx: number): number => Math.min(1, Math.abs(dx) / 400);

/**
 * Слой 1: игровая сцена Pixi. Знает только про рисование и ввод на холсте.
 * Игровую логику не трогает — наружу отдаёт колбэк onTap и методы-эффекты.
 */
export class GameView {
  private app = new Application();
  private host: HTMLElement;

  private bg: Sprite | null = null;
  /** Задний слой мира (фон-прямоугольник, статический). */
  readonly world: WorldLayer = new WorldLayer();
  /** Статические слои: расставляются один раз (X намертво, Y — центр композиции). */
  private yard: Container | null = null;
  private house: Container | null = null;
  /** Динамические объекты. */
  private car: Container | null = null;
  private workplace = new Map<string, Container>(); // tech | pc | furniture
  private character: Container | null = null;
  /** Носимые — дети персонажа: watch | hair | clothes. */
  private worn = new Map<string, Container>();
  /** Метки-подписи прямоугольников: контейнер → метка + высота (для клампа). */
  private markers = new Map<Container, { mark: Text; h: number }>();
  /** Метка фона (отдельный текст в stage — у WorldLayer нет своих детей). */
  private worldLabel: Text | null = null;

  /** Базовый масштаб персонажа — точка возврата сквиш-эффекта при тапе. */
  private charBaseScale = 1;

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

    // Порядок depth: градиент → фон(мир) → двор → дом → машина/рабочее место/игрок.
    this.buildBackground();
    this.buildWorld();
    this.buildYard();
    this.buildHouse();
    this.buildCar();
    this.buildWorkplace();
    this.buildCharacter();
    this.buildWorn();

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

    // Единый закон раскладки (статику центрирует, динамику сажает по якорям).
    this.layout();

    this.app.renderer.on('resize', () => this.layout());
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

  /** Задний слой мира: прямоугольник фона (статический, дальний). */
  private buildWorld(): void {
    this.world.init(this.app.screen.width, this.app.screen.height);
    this.app.stage.addChildAt(this.world.root, this.app.stage.getChildIndex(this.bg!) + 1);
  }

  /** Прямоугольник-заглушка одного объекта: цвет/номер/размер — с чертежа. */
  private buildRect(spec: RectSpec): Container {
    const c = new Container();

    const g = new Graphics();
    g.rect(-spec.w / 2, -spec.h / 2, spec.w, spec.h).fill({ color: spec.color, alpha: 0.55 });
    g.rect(-spec.w / 2, -spec.h / 2, spec.w, spec.h).stroke({ width: 3, color: spec.color });
    c.addChild(g);

    // Метка: номер из чертежа + название + размер текстуры в px.
    // Центр-верх прямоугольника: метка видна, даже когда края объекта
    // выходят за окно (по чертежу они и должны выходить). lift поднимает
    // подпись в стопке конгруэнтных слоёв.
    const mark = new Text({
      text: `${spec.num} · ${spec.label} · ${spec.w}×${spec.h}`,
      style: this.markerStyle(),
    });
    mark.anchor.set(0.5, 1);
    mark.position.set(0, Math.round(-spec.h / 2) - 6 - (spec.lift ?? 0));
    c.addChild(mark);
    this.markers.set(c, { mark, h: spec.h });

    return c;
  }

  /** Двор — средний1 слой, статический. */
  private buildYard(): void {
    this.yard = this.buildRect(YARD_SPEC);
    this.yard.visible = false; // появляется после покупки
    this.app.stage.addChild(this.yard);
  }

  /** Дом — средний2 слой, статический, частично за машиной. */
  private buildHouse(): void {
    this.house = this.buildRect(HOUSE_SPEC);
    this.app.stage.addChild(this.house);
  }

  /** Машина — передний слой, динамическая (отъезжает по жёлтой стрелке). */
  private buildCar(): void {
    this.car = this.buildRect(CAR_SPEC);
    this.car.visible = false; // появляется после покупки
    this.app.stage.addChild(this.car);
  }

  /**
   * Рабочее место: мебель(12) → микрофон(11) → комп(10), все динамические.
   * Порядок addChild = ГЛУБИНА (мебель дальняя, комп ближний) — по чертежу
   * владельца; геометрия у всех трёх одна (см. WORKPLACE_ANCHOR).
   */
  private buildWorkplace(): void {
    const furniture = this.buildRect(FURNITURE_SPEC);
    const tech = this.buildRect(TECH_SPEC);
    const pc = this.buildRect(PC_SPEC);

    this.workplace.set('furniture', furniture);
    this.workplace.set('tech', tech);
    this.workplace.set('pc', pc);

    for (const item of [furniture, tech, pc]) {
      item.visible = false; // появляется после покупки
      this.app.stage.addChild(item);
    }
  }

  /** Игрок (1): прямоугольник тела; носимые — дети, см. buildWorn. */
  private buildCharacter(): void {
    this.character = this.buildRect(CHAR_SPEC);
    this.app.stage.addChild(this.character);
  }

  /**
   * Носимые — ДЕТИ персонажа: наследуют его позицию и масштаб, поэтому сквиш
   * при тапе двигает их вместе с телом (idle-покачивание снято владельцем
   * 2026-09-30 — позиция группы игрока заморожена).
   * Порядок addChild: причёска(8) и одежда(9) — один слой, часы(7) — поверх.
   */
  private buildWorn(): void {
    if (!this.character) return;

    const hair = this.buildWornRect(WORN_SPECS.hair);
    const clothes = this.buildWornRect(WORN_SPECS.clothes);
    const watch = this.buildWornRect(WORN_SPECS.watch);

    this.worn.set('hair', hair);
    this.worn.set('clothes', clothes);
    this.worn.set('watch', watch);

    // addChild ПОСЛЕ тела: причёска/одежда поверх тела, часы — последними.
    for (const item of this.worn.values()) {
      item.visible = false; // появляется после покупки
      this.character.addChild(item);
    }
  }

  /** Носимый прямоугольник: тот же формат метки, позиция — офсет от центра тела. */
  private buildWornRect(spec: RectSpec & { ox: number; oy: number }): Container {
    const c = this.buildRect(spec);
    c.position.set(spec.ox, spec.oy);
    return c;
  }

  // ------------------------------------------------------------- раскладка

  /**
   * ЕДИНЫЙ ЗАКОН РАСКЛАДКИ (init + каждый ресайз): статика центрируется по X
   * экрана, динамика садится по якорям от центра композиции (дрейф на широких
   * окнах, squeeze на узких). Размеры объектов константны — зума сцены нет.
   */
  private layout(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;

    if (this.bg) {
      this.bg.width = w;
      this.bg.height = h;
    }

    // Фон: тот же центр + cover под ТЕКУЩИЙ экран (иначе при сужении окна
    // он, как и статика, «уезжал» вправо — баг владельца 2026-09-30).
    this.world.layout(w, h);

    // Статика: X ВСЕГДА центр экрана; Y — центр композиции между HUD и таб-баром.
    const cx = w * 0.5;
    const cy = this.compositionCenterY(h);
    if (this.yard) this.yard.position.set(cx, cy + YARD_DY);
    if (this.house) this.house.position.set(cx, cy + HOUSE_DY);

    // Метки статики не должны прятаться под HUD: если верх прямоугольника
    // ушёл за панель, метка садится на первую видимую строку.
    const labelTopLimit = Math.min(TOP_FREE_MAX, h * 0.24) + 34;
    this.clampMarkerTop(this.house, labelTopLimit);
    this.clampMarkerTop(this.yard, labelTopLimit);

    const extra = Math.max(0, w - SCENE_REF_W);
    const drift = Math.min(DRIFT_MAX_TOTAL, extra * DRIFT_GAIN);
    const squeeze = Math.min(1, w / SCENE_REF_W);

    const driftOffset = (shareDx: number): number =>
      Math.sign(shareDx || 1) * drift * driftShare(shareDx);
    // Рабочее место — ОДИН дрейф на все три слоя: группа отъезжает целиком
    // и слои не расползаются при ресайзе (якорь у них теперь общий).
    const workplaceDrift = driftOffset(WORKPLACE_GROUP_DX);
    const place = (item: Container | null, a: DynAnchor, driftX = workplaceDrift): void => {
      if (!item) return;
      item.x = cx + a.dx * squeeze + driftX;
      item.y = cy + a.dy;
    };

    place(this.car, CAR_ANCHOR, driftOffset(CAR_ANCHOR.dx));
    // Рабочее место: три конгруэнтных слоя в ОДНОЙ точке, дрейф — общей группой.
    place(this.workplace.get('furniture') ?? null, WORKPLACE_ANCHOR);
    place(this.workplace.get('pc') ?? null, WORKPLACE_ANCHOR);
    place(this.workplace.get('tech') ?? null, WORKPLACE_ANCHOR);
    place(this.character, CHAR_ANCHOR, driftOffset(CHAR_ANCHOR.dx));

    this.placeWorldLabel();
  }

  /**
   * Метка фона (5 · ФОН · 1120×1505) — у нижнего-левого угла прямоугольника
   * фона (верх занят HUD, верхний угол часто за краем из-за cover).
   */
  private placeWorldLabel(): void {
    const text = `5 · ФОН · ${WORLD_REF_W}×${WORLD_REF_H}`;
    if (!this.worldLabel) {
      this.worldLabel = new Text({ text, style: this.markerStyle() });
      this.worldLabel.anchor.set(0, 1);
      this.app.stage.addChild(this.worldLabel);
    } else if (this.worldLabel.text !== text) {
      this.worldLabel.text = text;
    }
    const h = this.app.screen.height;
    const tl = this.world.topLeftOnScreen;
    // Клампим в окно: метка — сервисная подпись, не статический объект.
    this.worldLabel.position.set(Math.max(8, tl.x + 8), h - 8);
  }

  /**
   * Кламп метки статического объекта: её низ сидит над верхом прямоугольника,
   * но не выше topLimit (нижний край HUD). Контейнер не масштабируется,
   * поэтому локальная координата = экранная − y контейнера.
   */
  private clampMarkerTop(item: Container | null, topLimit: number): void {
    if (!item) return;
    const rec = this.markers.get(item);
    if (!rec) return;
    const rectTop = item.y - rec.h / 2;
    rec.mark.y = Math.max(rectTop - 6, topLimit + 4) - item.y;
  }

  /** Общий стиль меток-подписей. */
  private markerStyle(): TextStyle {
    return new TextStyle({
      fontFamily: 'Arial, sans-serif',
      fontSize: 20,
      fontWeight: '700',
      fill: 0xffffff,
      stroke: { color: 0x0b0e12, width: 4 },
    });
  }

  /** Центр композиции по Y: свободная полоса между HUD и таб-баром. */
  private compositionCenterY(h: number): number {
    const topFree = Math.min(TOP_FREE_MAX, h * 0.24);
    const usable = Math.max(120, h - topFree - BOTTOM_FREE);
    return Math.round(topFree + usable * CY_FRAC);
  }

  /**
   * Применить стадию мира (эпоха фона). Вызывается из main при 'world:changed'
   * и один раз на старте. Растительность убрана с карты (фазы живут в HUD).
   */
  applyWorldStage(era: number): void {
    this.world.applyStage(era);
  }

  // ------------------------------------------------------------ тиры сцены

  /**
   * Применить визуальное состояние сцены по уровням объектов.
   * Плейсхолдеры — прямоугольники: тиры пока НИЧЕГО не меняют визуально
   * (перекраски-тинты убраны до текстур). Меняется только владение (visible).
   */
  applySceneState(states: SceneObjectInfo[]): void {
    for (const s of states) {
      switch (s.id) {
        case 'car':
          if (this.car) this.car.visible = s.owned;
          break;
        case 'bg':
          if (this.yard) this.yard.visible = s.owned;
          break;
        case 'tech':
        case 'pc':
        case 'furniture': {
          const item = this.workplace.get(s.id);
          if (item) item.visible = s.owned;
          break;
        }
        case 'watch':
        case 'hair':
        case 'clothes': {
          const worn = this.worn.get(s.id);
          if (worn) worn.visible = s.owned;
          break;
        }
      }
    }
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
    // Плавное возвращение масштаба после тапа (к базовому, а не к 1).
    // Покачивание/idle ВРЕМЕННО снято (владелец 2026-09-30): позиция и наклон
    // группы игрока заморожены — её двигает только раскладка по ширине окна.
    if (this.character) {
      const s = this.character.scale.x;
      const next = s + (this.charBaseScale - s) * Math.min(1, dt * 9);
      this.character.scale.set(next);
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
