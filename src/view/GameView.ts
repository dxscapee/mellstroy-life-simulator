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
import type { ObjectId } from '@engine/types';
import { SCENE_GROUPS, SCENE_ORDER, assetGroupOf, assetKey, backgroundGroup } from '@data/assets';
import type { AssetGroup, SceneKind } from '@data/assets';
import { WorldLayer, WORLD_REF_H, WORLD_REF_W } from './WorldLayer';
import type { AssetRegistry } from './assetRegistry';

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
 * край объекта, но сам объект остаётся в центре; с 2026-10-04 размер ещё умножается на зум сцены (растёт вровень с фоном, когда тот начинает расти от ширины — см. applySceneScale).
 *
 * ДИНАМИЧЕСКИЕ (игрок, машина) — якорь от центра композиции; на широких окнах
 * отъезжают от центра (жёлтые стрелки чертежа): drift = излишек ширины ×
 * DRIFT_GAIN, потолок DRIFT_MAX_TOTAL. На узких окнах отъезд схлопывается
 * (squeeze), центр композиции по Y садится в свободную полосу между HUD и
 * таб-баром (только позиция, размеры не трогаются).
 *
 * РАБОЧЕЕ МЕСТО — динамическое и по X живёт по общему правилу (якорь + дрейф
 * группой), но по Y СТОИТ НА ПОЛУ: низ группы — на FLOOR_GAP выше нижнего края
 * окна, а не у центра композиции (владелец 2026-09-30).
 *
 * ГРУППА ИГРОКА (игрок + причёска/одежда/часы) НЕ анимируется (владелец
 * 2026-09-30, временно): покачивание по Y и наклон сняты, остался только
 * сквиш-отклик на тап. Разъезд по ширине окна — часть раскладки, не анимации.
 *
 * Все объекты — ПРЯМОУГОЛЬНИКИ-ЗАГЛУШКИ с номером и размером в px. Размеры и
 * позиции истинные — визуальных правок геометрии нет. Когда в манифесте есть
 * ассет (см. @data/assets и ASSETS.md), заглушка ПОДМЕНЯЕТСЯ спрайтом той же
 * геометрии: стадия — по тиру, фон — по локации; загрузка ленивая, ключи резолвит
 * AssetRegistry. Раскладка о текстурах не знает и не меняется вообще.
 *
 * СЦЕНЫ (улица / дом): объекты сцены живут в ДВУХ корневых контейнерах —
 * streetRoot (фон улицы, двор, дом, машина) и homeRoot (рабочее место), — а
 * игрок с носимыми вынесен в общий корень поверх обоих и виден в ОБЕИХ сценах.
 * Переключение — setScene: скрывает один корень, показывает другой и меняет
 * фон (ключи world/<локация> и world_home/<локация>). Раскладка, размеры и
 * уровни объектов от сцены не зависят — это перенос места, не прокачки.
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
 * lift — подъём ПОДПИСИ (px) над верхом прямоугольника: только там, где соседние
 * подписи иначе слились бы в одну строку (игрок↔причёска, одежда↔часы).
 * w×h — всегда ИСТИННЫЕ габариты текстуры: визуальных правок геометрии у
 * заглушек нет.
 */
interface RectSpec {
  /** id объекта (engine/types) — по нему сцена выбирает группу ассета сцены. */
  id: ObjectId;
  /** Группа ассетов: папка мастера в art/ и ключ ассета в манифесте. */
  group: AssetGroup;
  w: number;
  h: number;
  color: number;
  num: string;
  label: string;
  lift?: number;
}

/**
 * Узел сцены: прямоугольник-заглушка (gfx + метка) и спрайт текстуры.
 * stage — ЗАПРОШЕННАЯ стадия (её ставит applySceneState/конструктор); -1 =
 * стадия ещё не известна (до первого applySceneState ничего не грузим, иначе
 * сцена угадывала бы нулевую стадию и тянула лишний ассет).
 * appliedKey — ключ ассета, который сейчас реально показан (null — заглушка).
 */
interface RectVisual {
  spec: RectSpec;
  gfx: Graphics;
  label: Text;
  sprite: Sprite;
  stage: number;
  appliedKey: string | null;
}

/**
 * Бокс объекта из паспорта ассетов (sceneAssets.json): w×h — истинные
 * габариты текстуры и спрайта. Пайплайн валидирует мастера по этим же числам.
 */
const sceneBox = (group: AssetGroup): { w: number; h: number } => ({
  w: SCENE_GROUPS[group].w,
  h: SCENE_GROUPS[group].h,
});

/**
 * Прямоугольники-заглушки объектов сцены: цвет, номер и размер — с чертежа.
 * Слоям ГРУПП (игрок, рабочее место) даны СВОИ цвета, чтобы их различать
 * (решение владельца 2026-09-30).
 * Фон(5) живёт в WorldLayer (WORLD_REF_W/H — его размер текстуры).
 */
const YARD_SPEC: RectSpec = { id: 'bg', group: 'yard', ...sceneBox('yard'), color: 0xff00aa, num: '6', label: 'ДВОР' };
const HOUSE_SPEC: RectSpec = { id: 'house', group: 'house', ...sceneBox('house'), color: 0x00a844, num: '4', label: 'ДОМ' };
const CAR_SPEC: RectSpec = { id: 'car', group: 'car', ...sceneBox('car'), color: 0xe01010, num: '2', label: 'МАШИНА' };
const CHAR_SPEC: RectSpec = { id: 'character' as ObjectId, group: 'character', ...sceneBox('character'), color: 0xe01010, num: '1', label: 'ИГРОК' };
/**
 * Рабочее место: ТРИ КОНГРУЭНТНЫХ слоя в ОДНОЙ точке, ОДНА геометрия на всех
 * (владелец 2026-09-30: «все объекты должны быть одинаковых размеров») — бокс
 * 360×480 из sceneAssets.json (было 300 → «выше по высоте» → 350×460 →
 * нормализация 8px-сетки 2026-10-03). Слои совпадают по площади
 * один в один, поэтому на экране читается ВЕРХНИЙ (комп, жёлтый), а размер всех
 * трёх виден в подписях; никаких визуальных хитростей с рамками у заглушек нет.
 * Глубина = чертёж: мебель(12) — дальний, камера(11) — средний, комп(10) —
 * ближний; цвета слоёв свои (оранжевый/бирюзовый/жёлтый).
 * ВАЖНО: глубина сцены ≠ порядку карточек в магазине (камера → мебель → комп);
 * сцена сохраняет чертёж, магазин — ТЗ владельца 2026-10-03.
 * lift разводит подписи колонкой над верхом: КОМП → КАМЕРА → МЕБЕЛЬ.
 */
// Размеры — из паспорта ассетов; пайплайн проверяет, что три слоя конгруэнтны.
// (раскладка стопки опирается только на высоту: низ группы стоит на полу)
const WORKPLACE_H = SCENE_GROUPS.camera.h;
const FURNITURE_SPEC: RectSpec = { id: 'furniture', group: 'furniture', ...sceneBox('furniture'), color: 0xf59e0b, num: '12', label: 'МЕБЕЛЬ', lift: 0 };
const CAMERA_SPEC: RectSpec = { id: 'camera', group: 'camera', ...sceneBox('camera'), color: 0x06b6d4, num: '11', label: 'КАМЕРА', lift: 27 };
const PC_SPEC: RectSpec = { id: 'pc', group: 'pc', ...sceneBox('pc'), color: 0xfacc15, num: '10', label: 'КОМП', lift: 54 };

/**
 * Носимые на игроке: дети контейнера игрока, наследуют его позицию и масштаб.
 * Раскладка — по чертежу крупным планом (владелец 2026-09-30, перенормирована
 * под игрока 264×552 2026-10-03): БОРТ К БОРТУ и без наложений. Координаты —
 * от центра игрока (верх −276, низ +276, левый борт −132):
 *   · ПРИЧЁСКА 264×192 — верхняя полоса (1/3 высоты игрока): впритык к верхнему,
 *     левому и правому бортам (центр −276 + 96 = −180);
 *   · ОДЕЖДА 264×360 — нижняя полоса (2/3 высоты): верх = низ причёски (−84),
 *     низ = низ игрока (+276), центр −84 + 180 = +96;
 *   · ЧАСЫ 120×176 — прижаты к ЛЕВОМУ борту (левый край −132, центр −72), верх
 *     на 15px ниже стыка полос (верх −69, центр +19).
 * Причёска + одежда = ровно 552 = высота игрока и 264 = его ширина — полосы
 * стыкуются без зазоров и нахлёстов (инвариант пайплайна: холсты совпадают).
 * Слои (глубина addChild): тело(1) → причёска(8) + одежда(9) → часы(7).
 * Цвета: ЗЕЛЁНАЯ причёска, СИНЯЯ одежда, ФИОЛЕТОВЫЕ часы, КРАСНЫЙ игрок.
 * lift поднимает подпись только там, где соседи слились бы (причёска↔игрок,
 * одежда↔часы); остальные подписи стоят вплотную над своим верхом.
 */
const WORN_SPECS: Record<'hair' | 'clothes' | 'watch', RectSpec & { ox: number; oy: number }> = {
  // Причёска — верхняя полоса игрока (впритык к верхнему/левому/правому бортам).
  hair: { id: 'hair', group: 'hair', ...sceneBox('hair'), color: 0x22c55e, num: '8', label: 'ПРИЧЁСКА', ox: 0, oy: -180, lift: 21 },
  // Одежда — нижняя полоса игрока: верх = низ причёски, низ = низ игрока.
  clothes: { id: 'clothes', group: 'clothes', ...sceneBox('clothes'), color: 0x2563eb, num: '9', label: 'ОДЕЖДА', ox: 0, oy: 96, lift: 9 },
  // Часы — слева, впритык к левому борту; верх на 15px ниже стыка полос.
  watch: { id: 'watch', group: 'watch', ...sceneBox('watch'), color: 0xa855f7, num: '7', label: 'ЧАСЫ', ox: -72, oy: 19, lift: 0 },
};

/** Якорь динамического объекта: смещение от центра композиции. */
type DynAnchor = { dx: number; dy: number };

// Снято с чертежа (эталон 1120×1505, центр композиции (560, ~707)).
// Машина придвинута к центру (владелец 2026-09-30: «на ПК очень далеко от центра»):
// 230 → 150 → 140. Побочно упала и доля дрейфа (|dx|/400) — на широких окнах отъезд меньше.
const CAR_ANCHOR: DynAnchor = { dx: 140, dy: 35 };
// Игрок сдвинут правее для телефонного экрана (владелец 2026-09-30): -240 → -220.
// dy: 215 → 75 (владелец 2026-10-03) — игрок был «утоплен вниз»: при центре
// композиции cy и высоте 690 низ уходил на cy+215+345 ≈ на 110px ПОД таб-бар на
// телефоне. После уменьшения игрока до 264×552 и подъёма якоря до +75 его низ
// = cy+75+276, т.е. целиком виден над таб-баром и в портрете, и в ландшафте.
const CHAR_ANCHOR: DynAnchor = { dx: -220, dy: 75 };
/**
 * Рабочее место — ОДНА точка на все три конгруэнтных слоя. По X это стол чертежа
 * +30 вправо (владелец 2026-09-30: «положение как у стола, но чуть-чуть правее»),
 * сдвинуто левее для телефонного экрана: 310 → 280.
 * По Y группа СТОИТ НА ПОЛУ — не от центра композиции, а от нижнего края окна
 * (владелец: «начинаться от пола… около 5–10 пикселей от нижней границы»).
 */
const WORKPLACE_DX = 280;
/** Просвет между низом рабочей группы и нижним краем окна (пол сцены), px. */
const FLOOR_GAP = 8;

/** Общий dx рабочей группы: все три слоя отъезжают КАК ОДНО ЦЕЛОЕ. */
const WORKPLACE_GROUP_DX = 200;

/**
 * Статические объекты: смещение центра от ЦЕНТРА КОМПОЗИЦИИ (cy).
 * Дом — центр чуть выше центра композиции (верх ~26% высоты, низ ~67%);
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
  /**
   * КОРНИ СЦЕН: street — фон улицы/двор/дом/машина; home — рабочее место.
   * Игрок с носимыми лежит ПОВЕРХ обоих (общий для сцен), поэтому видим всегда.
   * Переключение — setScene: скрывается/показывается КОРЕНЬ целиком, а видимость
   * конкретных узлов внутри ставит applySceneState (по владению и по сцене).
   */
  private streetRoot = new Container();
  private homeRoot = new Container();
  /** Какая сцена активна (её корень виден). */
  private currentScene: SceneKind = 'street';
  /**
   * Последнее состояние объектов (тот же массив, без копий): нужно при смене
   * сцены — видимость узлов зависит от сцены, а состояние объектов живёт не в
   * GameView (его передаёт main). Без него купленный на улице объект остался бы
   * невидимым после входа домой.
   */
  private lastStates: SceneObjectInfo[] | null = null;
  /** Статические слои: расставляются один раз (X намертво, Y — центр композиции). */
  private yard: Container | null = null;
  private house: Container | null = null;
  /** Динамические объекты. */
  private car: Container | null = null;
  private workplace = new Map<string, Container>(); // camera | furniture | pc
  private character: Container | null = null;
  /** Носимые — дети персонажа: watch | hair | clothes. */
  private worn = new Map<string, Container>();
  /** Узлы сцены: контейнер → заглушка + спрайт + метка (см. RectVisual). */
  private visuals = new Map<Container, RectVisual>();
  /** Метка фона (отдельный текст в stage — у WorldLayer нет своих детей). */
  private worldLabel: Text | null = null;
  /** Отписка от «ассет догрузился» (ставится в init, снимается в destroy). */
  private offAssets: (() => void) | null = null;
  /** Запрошенная локация фона (-1 — ещё не применяли) для пере-синхронизации. */
  private lastLocation = -1;
  /**
   * Ключ фона, удерживаемый ЗА КАЖДУЮ сцену (мы владельцы этих ассетов и
   * отпускаем их только при смене ЛОКАЦИИ). Держим оба фона текущей локации:
   * переключение сцены мговенное и не перезапускает видео-декодер. Максимум
   * два живых фона — в пределах бюджетта (ASSETS.md §4.3, 1–2 видео).
   */
  private readonly heldWorldKey: Record<SceneKind, string | null> = { street: null, home: null };
  /** Ключ, который РЕАЛЬНО стоит на слое фона (null — заглушка). */
  private displayedWorldKey: string | null = null;
  /**
   * Принудительный показ подписей ВСЕХ объектов (номер · имя · размер) —
   * дебаг-фича из панели (кнопка «Подписи объектов»). По умолчанию ВЫКЛ:
   * подписи живут только на заглушках, т.е. там, где текстуры ещё нет.
   */
  private labelsForced = false;

  /** Базовый масштаб персонажа — точка возврата сквиш-эффекта при тапе. */
  private charBaseScale = 1;

  /** Пул текстов «+1$»: без аллокаций на каждый тап. */
  private floatPool: FloatText[] = [];

  constructor(
    host: HTMLElement,
    /** Рантайм-загрузчик текстур: создаётся в main (см. ASSETS.md). */
    private readonly assets: AssetRegistry,
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

    // Порядок depth: градиент → фон(мир) → [streetRoot: двор → дом → машина]
    // → [homeRoot: рабочее место] → игрок с носимыми (общий, поверх обеих сцен).
    // Старт — УЛИЦА: домашний корень сразу выключен, чтобы он не проступил
    // до первого applySceneState (там видимость ставится по состоянию и сцене).
    this.buildBackground();
    this.buildWorld();
    this.homeRoot.visible = false;
    this.app.stage.addChild(this.streetRoot, this.homeRoot);
    this.buildYard();
    this.buildHouse();
    this.buildCar();
    this.buildWorkplace();
    this.buildCharacter();
    this.buildWorn();

    // Ленивая загрузка: догрузившиеся текстуры сами подменяют заглушки.
    this.offAssets = this.assets.onLoaded(() => this.refreshTextures());
    // Тело игрока: у него НЕТ тиров — скин (стадия) следует за ЛОКАЦИЕЙ, а не
    // за уровнями. Стадию ставит applySceneBackground (в bootstrap он зовётся
    // до boot.hide, поэтому игрок появляется уже в нужном скине).

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

    // Спрайт подменяемой текстуры: та же геометрия, что у заглушки, —
    // раскладка о текстурах ничего не знает (см. syncVisual).
    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    sprite.visible = false;
    c.addChild(sprite);

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
    // Видимость — строго по флагу показа подписей (по умолчанию ВЫКЛ).
    mark.visible = this.labelsForced;
    c.addChild(mark);
    this.visuals.set(c, { spec, gfx: g, label: mark, sprite, stage: -1, appliedKey: null });

    return c;
  }

  /** Двор — средний1 слой, статический. Живёт на УЛИЦЕ (streetRoot). */
  private buildYard(): void {
    this.yard = this.buildRect(YARD_SPEC);
    this.yard.visible = false; // появляется после покупки
    this.streetRoot.addChild(this.yard);
  }

  /** Дом — средний2 слой, статический, частично за машиной. Улица. */
  private buildHouse(): void {
    this.house = this.buildRect(HOUSE_SPEC);
    this.streetRoot.addChild(this.house);
  }

  /** Машина — передний слой, динамическая (отъезжает по жёлтой стрелке). Улица. */
  private buildCar(): void {
    this.car = this.buildRect(CAR_SPEC);
    this.car.visible = false; // появляется после покупки
    this.streetRoot.addChild(this.car);
  }

  /**
   * Рабочее место: мебель(12) → камера(11) → комп(10), все динамические.
   * Порядок addChild = ГЛУБИНА (мебель дальняя, комп ближний) — по чертежу
   * владельца; геометрия у всех трёх одна (см. placeWorkplace).
   */
  private buildWorkplace(): void {
    const furniture = this.buildRect(FURNITURE_SPEC);
    const camera = this.buildRect(CAMERA_SPEC);
    const pc = this.buildRect(PC_SPEC);

    this.workplace.set('furniture', furniture);
    this.workplace.set('camera', camera);
    this.workplace.set('pc', pc);

    for (const item of [furniture, camera, pc]) {
      item.visible = false; // появляется после покупки
      this.homeRoot.addChild(item);
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
   * окнах, squeeze на узких), а рабочее место по Y СТОИТ НА ПОЛУ (FLOOR_GAP от
   * нижнего края окна). Размеры объектов масштабируются зумом сцены (вровень с фоном от порога роста — см. applySceneScale).
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

    // МАСШТАБ СЦЕНЫ — «вровень с фоном»: объекты растут ровно во столько раз,
    // во сколько вырос фон, и только с момента, когда фон перестаёт упираться в
    // ВЫСОТУ окна и начинает расти от ШИРИНЫ (cover > height-fit). Ниже порога и
    // на узких/телефонных окнах zoom = 1 — вид прежний. Позиции и дрейф НЕ трогаем:
    // объект растёт вокруг своего центра и остаётся там же — просто крупнее.
    const heightFit = h > 0 ? h / WORLD_REF_H : 1;
    const cover = Math.max(w / WORLD_REF_W, heightFit);
    const zoom = Math.max(1, cover / heightFit);
    this.applySceneScale(zoom);

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
    const place = (item: Container | null, a: DynAnchor, driftX: number): void => {
      if (!item) return;
      item.x = cx + a.dx * squeeze + driftX;
      item.y = cy + a.dy;
    };

    place(this.car, CAR_ANCHOR, driftOffset(CAR_ANCHOR.dx));
    place(this.character, CHAR_ANCHOR, driftOffset(CHAR_ANCHOR.dx));

    // Рабочее место: три конгруэнтных слоя в ОДНОЙ точке, дрейф — общей группой;
    // по Y группа СТОИТ НА ПОЛУ (низ — FLOOR_GAP над нижним краем окна).
    this.placeWorkplace(cx + WORKPLACE_DX * squeeze + workplaceDrift, h - FLOOR_GAP - WORKPLACE_H / 2);

    this.placeWorldLabel();
  }

  /**
   * Рабочее место — один X и один Y на все три слоя: слои конгруэнтны и стоят
   * друг на друге, разъезжаться при раскладке им нельзя (иначе стопка развалится).
   */
  private placeWorkplace(x: number, y: number): void {
    const furniture = this.workplace.get('furniture');
    const camera = this.workplace.get('camera');
    const pc = this.workplace.get('pc');
    if (furniture) furniture.position.set(x, y);
    if (camera) camera.position.set(x, y);
    if (pc) pc.position.set(x, y);
  }

  /**
   * Метка фона (5 · ФОН · 1120×759) — у нижнего-левого угла прямоугольника
   * фона (верх занят HUD, верхний угол часто за краем из-за cover).
   */
  private placeWorldLabel(): void {
    // Бокс в подписи — от сцены: у квартиры свой бокс (world_home).
    const spec = SCENE_GROUPS[backgroundGroup(this.currentScene)];
    const text = `5 · ФОН · ${spec.w}×${spec.h}`;
    if (!this.worldLabel) {
      this.worldLabel = new Text({ text, style: this.markerStyle() });
      this.worldLabel.anchor.set(0, 1);
      // Видимость — строго по флагу показа подписей (по умолчанию ВЫКЛ).
      this.worldLabel.visible = this.labelsForced;
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
    const rec = this.visuals.get(item);
    if (!rec) return;
    const zoom = item.scale.y || 1;
    // Верх прямоугольника — в ЭКРАННЫХ координатах (узел масштабирован зумом сцены).
    const rectTop = item.y - (rec.spec.h / 2) * zoom;
    rec.label.y = (Math.max(rectTop - 6, topLimit + 4) - item.y) / zoom;
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

  /**
   * Масштаб зума ко ВСЕМ объектам сцены (фон масштабируется сам в WorldLayer).
   * Меняем только РАЗМЕР — позиции ставит layout, объект растёт вокруг центра.
   * Игрок — через charBaseScale: сквиш на тап и его плавный возврат идут к
   * базовому масштабу, иначе зум сбрасывался бы обратно к 1.
   */
  private applySceneScale(zoom: number): void {
    if (this.yard) this.yard.scale.set(zoom);
    if (this.house) this.house.scale.set(zoom);
    if (this.car) this.car.scale.set(zoom);
    for (const node of this.workplace.values()) node.scale.set(zoom);
    if (this.character) {
      this.charBaseScale = zoom;
      this.character.scale.set(zoom);
    }
  }

  /** Центр композиции по Y: свободная полоса между HUD и таб-баром. */
  private compositionCenterY(h: number): number {
    const topFree = Math.min(TOP_FREE_MAX, h * 0.24);
    const usable = Math.max(120, h - topFree - BOTTOM_FREE);
    return Math.round(topFree + usable * CY_FRAC);
  }

  // ----------------------------------------------------------------- сцены

  /** Текущая сцена (её корень виден). */
  get scene(): SceneKind {
    return this.currentScene;
  }

  /**
   * ПЕРЕКЛЮЧИТЬ СЦЕНУ (улица ↔ дом). Прокачка общая — меняются только МЕСТА
   * объектов: скрывается один корневой контейнер, показывается другой, плюс
   * подмена фона (у каждой сцены свой ключ и свой бокс заглушки).
   * Игрок с носимыми лежит ПОВЕРХ корней и виден в обеих сценах без правок.
   */
  setScene(scene: SceneKind): void {
    if (this.currentScene === scene) return;
    this.currentScene = scene;

    this.streetRoot.visible = scene === 'street';
    this.homeRoot.visible = scene === 'home';
    // Корни включаются, а видимость КОНКРЕТНЫХ узлов ставит applySceneState
    // (см. ниже): рабочие узлы показываются только дома.

    // Заглушка фона: бокс/цвет другой сцены; текстуру сменит applySceneBackground.
    this.world.setScene(scene);
    if (this.lastLocation >= 0) this.applySceneBackground(this.lastLocation);
    this.placeWorldLabel();

    // Видимость узлов зависит от сцены (рабочее место живёт только дома) —
    // перечитываем то же состояние объектов; заодно узлы новой сцены получат
    // текстуры, если они уже в кэше реестра.
    if (this.lastStates) this.applySceneState(this.lastStates);
  }

  /**
   * Применить ФОН ТЕКУЩЕЙ СЦЕНЫ для локации (зовёт main при 'location:changed',
   * при переключении сцены и один раз на старте). Ключ — ТОЧНЫЙ
   * <группа фона сцены>/<индекс локации> (world/2 — улица, world_home/2 —
   * квартира): без отката стадий вниз, чужой фон не подмазываем (нет ассета —
   * заглушка). Пока новая текстура грузится — на экране текущая или заглушка;
   * после подмены прошлый фон освобождается (BG-видео — живой видеодекодер).
   */
  applySceneBackground(location: number): void {
    this.lastLocation = location;

    // Скин игрока тоже следует за ЛОКАЦИЕЙ (art/character/<локация>): ставим
    // запрошенную стадию, текстура подтянется лениво (resolveKey с откатом вниз).
    this.setStage(this.character, location);

    const scene = this.currentScene;
    const key = assetKey(backgroundGroup(scene), location);

    // 1) ЧТО ПОКАЗЫВАЕМ. Ассета нет — заглушка; ассет грузится — на экране
    // остаётся прежний фон (появившийся позже позовёт onLoaded → refreshTextures).
    if (!this.assets.has(key)) {
      if (this.displayedWorldKey !== null) {
        this.world.setTexture(null);
        this.displayedWorldKey = null;
      }
    } else {
      const texture = this.assets.texture(key);
      if (texture && this.displayedWorldKey !== key) {
        this.world.setTexture(texture);
        this.displayedWorldKey = key;
      }
      if (this.displayedWorldKey === key) this.heldWorldKey[scene] = key;
    }

    // 2) ОТПУСКАЕМ фон чужой локации (у видео это закрытие декодера), НО только
    // тот, что НЕ стоит сейчас на экране: destroy текстуры под работающим
    // спрайтом = чёрный/битый кадр. Висящий на экране отпустит следующий заход
    // (после подмены фоном новой локации или заглушкой). Фон ДРУГОЙ СЦЕНЫ
    // текущей локации остаётся: возврат в сцену не тянет и не декодит его заново.
    for (const heldScene of SCENE_ORDER) {
      const held = this.heldWorldKey[heldScene];
      if (!held) continue;
      if (held === assetKey(backgroundGroup(heldScene), location)) continue;
      if (held === this.displayedWorldKey) continue;
      this.assets.release(held);
      this.heldWorldKey[heldScene] = null;
    }
  }

  // ---------------------------------------------------------------- текстуры

  /**
   * Показать/скрыть ПОДПИСИ ОБЪЕКТОВ (номер · имя · размер) — ДЕБАГ-ФИЧА
   * (кнопка в дебаг-панели; из консоли — scene.setObjectLabels(true)).
   * ВЫКЛ (по умолчанию): подписи скрыты У ВСЕХ — и на заглушках, и поверх
   * текстур. ВКЛ: подписи ВСЕХ объектов + метка фона.
   * Рамки-заглушки (gfx) не трогаем: под текстурой они не нужны.
   */
  setObjectLabels(visible: boolean): void {
    this.labelsForced = visible;
    for (const rec of this.visuals.values()) this.syncLabelVisibility(rec);
    if (this.worldLabel) this.worldLabel.visible = visible;
  }

  /** Пере-синхронизация всех видимых узлов и фона после догрузки ассетов. */
  refreshTextures(): void {
    for (const [container, rec] of this.visuals) {
      if (container.visible) this.syncVisual(rec);
    }
    // До первого applySceneBackground локация неизвестна — фон не трогаем.
    if (this.lastLocation >= 0) this.applySceneBackground(this.lastLocation);
  }

  /** Запомнить запрошенную стадию узла и сразу попробовать подменить текстуру. */
  private setStage(container: Container | null, stage: number): void {
    if (!container) return;
    const rec = this.visuals.get(container);
    if (!rec) return;
    rec.stage = stage;
    if (container.visible) this.syncVisual(rec);
  }

  /**
   * Подмена заглушки текстурой: ключ резолвится с откатом вниз (нет файла
   * стадии N — берётся ближайшая младшая). Ассета нет вовсе — остаётся
   * заглушка. Ассет есть, но ещё грузится — ничего не трогаем: по завершении
   * onLoaded позовёт refreshTextures.
   */
  private syncVisual(rec: RectVisual): void {
    if (rec.stage < 0) return; // стадия ещё не задана состоянием сцены
    // Группа ассета — из СЦЕНЫ, в которой объект живёт (id → группа этой сцены).
    const group = assetGroupOf(rec.spec.id, this.currentScene) ?? rec.spec.group;
    const key = this.assets.resolveKey(group, rec.stage);
    if (!key) {
      if (rec.appliedKey) this.showPlaceholder(rec);
      return;
    }

    const texture = this.assets.texture(key);
    if (!texture || rec.appliedKey === key) return;

    rec.sprite.texture = texture;
    // Размер спрайта ставится КАЖДЫЙ раз: у текстур разного разрешения своя
    // натуральная величина, width/height нормируют её в истинный бокс сцены.
    rec.sprite.width = rec.spec.w;
    rec.sprite.height = rec.spec.h;
    rec.sprite.visible = true;
    rec.gfx.visible = false;
    rec.appliedKey = key;
    this.syncLabelVisibility(rec);
  }

  /** Вернуть узел к прямоугольнику-заглушке (ассет исчез из манифеста). */
  private showPlaceholder(rec: RectVisual): void {
    rec.sprite.visible = false;
    rec.gfx.visible = true;
    rec.appliedKey = null;
    this.syncLabelVisibility(rec);
  }

  /**
   * Единое правило видимости подписи узла: подписи видны ТОЛЬКО при
   * включённом показе из дебаг-панели (labelsForced, по умолчанию ВЫКЛ).
   */
  private syncLabelVisibility(rec: RectVisual): void {
    rec.label.visible = this.labelsForced;
  }

  /**
   * Узел сцены по id объекта (мебель/камера/комп — в домашнем корне, носимые —
   * дети игрока). Возвращает и признак видимости: рабочие узлы показываются
   * только в своей сцене (носимые видны всегда — они дети игрока).
   */
  private sceneNode(id: ObjectId): { node: Container; inScene: boolean } | null {
    const workplaceNode = this.workplace.get(id);
    if (workplaceNode) return { node: workplaceNode, inScene: this.currentScene === 'home' };
    const wornNode = this.worn.get(id);
    if (wornNode) return { node: wornNode, inScene: true };
    return null;
  }

  // ------------------------------------------------------------ тиры сцены

  // ------------------------------------------------------------ тиры сцены

  /**
   * Применить визуальное состояние сцены по уровням объектов.
   * Плейсхолдеры — прямоугольники: тиры пока НИЧЕГО не меняют визуально
   * (перекраски-тинты убраны до текстур). Меняется только владение (visible).
   */
  applySceneState(states: SceneObjectInfo[]): void {
    this.lastStates = states;

    for (const s of states) {
      switch (s.id) {
        case 'house':
          // Дом не покупается (startLevel 1) — видимость не трогаем, только стадию.
          this.setStage(this.house, s.tier);
          break;
        case 'car':
          if (this.car) {
            this.car.visible = s.owned;
            if (s.owned) this.setStage(this.car, s.tier);
          }
          break;
        case 'bg':
          if (this.yard) {
            this.yard.visible = s.owned;
            if (s.owned) this.setStage(this.yard, s.tier);
          }
          break;
        // Рабочее место живёт в ДОМАШНЕЙ сцене: на улице узлы скрыты целиком
        // (иначе покупка «просвечивала» бы сквозь уличную композицию).
        case 'camera':
        case 'pc':
        case 'furniture': {
          const found = this.sceneNode(s.id);
          if (found) {
            found.node.visible = s.owned && found.inScene;
            if (s.owned) this.setStage(found.node, s.tier);
          }
          break;
        }
        case 'watch':
        case 'hair':
        case 'clothes': {
          const worn = this.worn.get(s.id);
          if (worn) {
            worn.visible = s.owned;
            if (s.owned) this.setStage(worn, s.tier);
          }
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
    this.offAssets?.();
    this.offAssets = null;
    // Текстуры принадлежат AssetRegistry — их освобождает registry.destroy().
    this.app.destroy(true, { children: true, texture: true });
  }
}
