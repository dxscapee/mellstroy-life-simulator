import { Container, Filter, GlProgram, Sprite, Texture, UniformGroup } from 'pixi.js';

/**
 * СВЕЧЕНИЕ СИЛУЭТА ОБЪЕКТА — визуальный отклик на СМЕНУ СТАДИИ
 * (ТЗ владельца 2026-10-06, редакция 2: первая версия «заливала объект сплошным
 * белым» и была отклонена — см. решение 31 в ABOUT_PROJECT.md).
 *
 * Пять требований ТЗ и как они закрыты:
 *  1. ТЕКСТУРА ОСТАЁТСЯ ВИДИМОЙ. Свечение — ОТДЕЛЬНЫЙ слой (add поверх сцены), оно
 *     НЕ перекрашивает спрайт. Добавка света живёт только в узкой полосе у кромки
 *     (см. RIM_*) и ЗА силуэтом (AURA_*) — внутренность объекта не выбеливается.
 *     Ошибка первой версии: радиус «кромки» брался как 20% меньшей стороны (53 px
 *     на одежде) — такая полоса накрывала почти весь объект и складывалась в заливку.
 *  2. ВНУТРЕННЕЕ + ВНЕШНЕЕ ГАЛО. Два РАЗНЫХ радиуса кольцевого размытия альфы:
 *     · uRimRadius (мелкий) → разница (a - ring) максимальна у самой кромки и падает
 *       до нуля ВГЛУБЬ за uRimRadius px: яркая линия по контуру, центр чистый;
 *     · uAuraRadius (крупный) → разница (ring - a) даёт мягкую ауру ЗА пределами
 *       силуэта, гаснущую за uAuraRadius px.
 *  3. ВОЛНА СВЕРХУ ВНИЗ. Диагональная координата s = v + WAVE_TILT·x (v: 0 сверху,
 *     1 снизу) минус uTime/WAVE_PERIOD: блик скользит от головы к ногам за ~1 с
 *     (WAVE_PERIOD) и повторяется WAVE_REPEATS раз за удержание свечения.
 *  4. КРОСС-ФЕЙД ПОД СВЕЧЕНИЕМ. main-спрайт узла сразу несёт НОВУЮ текстуру (alpha 1),
 *     а поверх него ghost-спрайт держит СТАРУЮ и гаснет 1→0 с задержкой на разгон:
 *     итог кадра = старая·(1-u) + новая·u — чистый кросс-фейд ровно на пике свечения.
 *  5. GPU-ШЕЙДЕР ЧИТАЕТ АЛЬФУ. Фильтр читает a исходного спрайта и строит контур/гало
 *     по РЕАЛЬНОЙ форме (у часов 24×16 px внутри бокса 120×176 бокс не значит ничего).
 *
 * Устройство:
 *  · ZERO-ALLOCATION: у эффекта только спрайты и Float32Array-uniforms, созданные один
 *    раз; в кадре нет new, find и замыканий — только запись чисел в буферы;
 *  · ядро эффекта — РЕБЁНОК контейнера объекта (см. GameView.createGlow): позиция и зум
 *    сцены наследуются, раскладку эффект не знает;
 *  · шейдер идёт на GPU в WebGL (штатный рендерер проекта: pixi по умолчанию пробует
 *    webgl первым), доп. ассетов и зависимостей нет.
 */

/** Разгон свечения до максимума, с. */
const RISE_TIME = 0.25;
/** Затухание свечения после удержания, с. */
const FALL_TIME = 0.5;
/** Один пробег блика сверху вниз, с (ТЗ: «за 1 секунду»). */
const WAVE_PERIOD = 1;
/** Сколько раз блик пробегает за эффект (ТЗ: «повторяясь 2–3 раза»). */
const WAVE_REPEATS = 3;
/** Удержание свечения на максимуме: ровно столько, чтобы волна прошла WAVE_REPEATS раз. */
const HOLD_TIME = WAVE_PERIOD * WAVE_REPEATS;
/** Полная длительность эффекта, с. */
const TOTAL_TIME = RISE_TIME + HOLD_TIME + FALL_TIME;
/** Длительность кросс-фейда текстур, с. */
const CROSSFADE_TIME = 1;
/** Кросс-фейд стартует НЕ сразу, а на пике свечения (пункт 4 ТЗ). */
const CROSSFADE_DELAY = RISE_TIME;

/**
 * Радиус внутренней кромки (яркая линия по контуру) как доля МЕНЬШЕЙ стороны бокса.
 * Держим его МАЛЫМ: именно ширина этой полосы определяет, насколько глубоко в объект
 * уходит белый свет (пункт 1 ТЗ — текстура должна остаться видимой).
 */
const RIM_FRACTION = 0.04;
const RIM_MIN = 2;
const RIM_MAX = 12;

/** Радиус внешней ауры (мягкое гало за силуэтом), доля меньшей стороны бокса. */
const AURA_FRACTION = 0.1;
const AURA_MIN = 6;
const AURA_MAX = 30;

/** Запас площади фильтра под внешнее гало относительно радиуса ауры. */
const PAD_RATIO = 1.5;

/** Сколько точек кольца усредняют альфу (компромисс плавности и цены кадра). */
const GLOW_TAPS = 16;

/** Сглаживание 0..1 (нулевая производная на концах). */
function smooth(u: number): number {
  const t = u < 0 ? 0 : u > 1 ? 1 : u;
  return t * t * (3 - 2 * t);
}

/**
 * Вершинный шейдер фильтра — штатный шаблон Pixi v8 (см. defaultFilter.vert):
 * переводит квад площади фильтра в клип-спейс и даёт uv ВНУТРИ площади фильтра.
 */
const FILTER_VERT = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

/**
 * Фрагментный шейдер свечения.
 *
 * uTexture    — рендер спрайта объекта (его АЛЬФА = силуэт);
 * uBoxPx      — истинный бокс объекта в px (нужен только волне: нормализация и диагональ);
 * uBoxFrac    — доля бокса в площади фильтра (площадь = бокс + полосы под гало);
 * uTexel      — uv одного пикселя площади (1 / площадь в px) — переводит радиусы в uv;
 * uPad        — ширина полосы гало в тех же px (окно, гасящее ауру у края площади);
 * uRimRadius  — радиус кольца для ВНУТРЕННЕЙ кромки, px;
 * uAuraRadius — радиус кольца для ВНЕШНЕЙ ауры, px;
 * uIntensity  — 0..1 общая яркость (разгон/затухание);
 * uTime       — секунды, гонит блик.
 *
 * Выход — ПРЕМНОЖЕННЫЙ белый (rgb = a = яркость), фильтр рисуется в режиме 'add'
 * (см. createGlowFilter): свечение ДОБАВЛЯЕТСЯ поверх сцены, а не заменяет её.
 */
const FILTER_FRAG = `
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec2 uBoxPx;
uniform vec2 uBoxFrac;
uniform vec2 uTexel;
uniform float uPad;
uniform float uRimRadius;
uniform float uAuraRadius;
uniform float uIntensity;
uniform float uTime;

const float TAU = 6.28318531;
/** Крутизна внутренней кромки: у края силуэта (кольцо наполовину внутри) даёт ~1. */
const float RIM_GAIN = 2.8;
/** Яркость внешней ауры: у края силуэта (кольцо наполовину снаружи) даёт ~0.6. */
const float AURA_GAIN = 1.3;
/** Наклон блика: доля вертикали, добавляемая по горизонтали (0 — строго вертикально). */
const float WAVE_TILT = 0.35;
/** Базовая яркость свечения между бликами. */
const float WAVE_BASE = 0.5;
/** Прибавка яркости в самом блике. */
const float WAVE_GAIN = 1.1;
/** Острота блика: чем больше, тем уже бегущая полоса. */
const float WAVE_SHARPNESS = 2.0;
/** Период блика, с (синхронно с WAVE_PERIOD в GlowEffect.ts). */
const float WAVE_PERIOD = ${WAVE_PERIOD.toFixed(2)};

/** Средняя альфа по кольцу радиуса rPx вокруг точки uv — мера «сколько силуэта рядом». */
float ringAvg(vec2 uv, float rPx)
{
    float sum = 0.0;

    for (int i = 0; i < ${GLOW_TAPS}; i++) {
        float ang = (float(i) + 0.5) * (TAU / float(${GLOW_TAPS}));
        vec2 offset = vec2(cos(ang), sin(ang)) * (rPx * uTexel);
        sum += texture(uTexture, uv + offset).a;
    }

    return sum / float(${GLOW_TAPS});
}

void main(void)
{
    float a = texture(uTexture, vTextureCoord).a;

    // Пункт 2 ТЗ, внутренняя половина: «плотно здесь — пусто вокруг» максимально
    // ровно на кромке силуэта и линейно падает до нуля вглубь за uRimRadius px.
    float rim = clamp((a - ringAvg(vTextureCoord, uRimRadius)) * RIM_GAIN, 0.0, 1.0);

    // Пункт 2 ТЗ, внешняя половина: «силуэт рядом — пусто здесь» максимально сразу
    // ЗА кромкой и гаснет наружу за uAuraRadius px: мягкое размытое гало.
    float aura = clamp((ringAvg(vTextureCoord, uAuraRadius) - a) * AURA_GAIN, 0.0, 1.0);

    // Окно у края площади фильтра: аура гаснет ДО границы и не обрезается рамкой
    // (иначе на сильном зуме сцены край полосы читался бы как прямоугольник).
    vec2 edgePx = min(vTextureCoord, vec2(1.0) - vTextureCoord) / uTexel;
    float win = clamp(min(edgePx.x, edgePx.y) / uPad, 0.0, 1.0);
    win = win * win * (3.0 - 2.0 * win);
    rim *= win;
    aura *= win;

    // Пункт 3 ТЗ: диагональная волна яркости, бегущая СВЕРХУ ВНИЗ.
    // s: 0 у верхней кромки бокса, 1 у нижней; WAVE_TILT наклоняет полосу.
    vec2 pPx = (vTextureCoord - 0.5) / uBoxFrac * uBoxPx;
    float s = pPx.y / max(uBoxPx.y, 1.0) + 0.5 + WAVE_TILT * (pPx.x / max(uBoxPx.x, 1.0));
    float band = 0.5 + 0.5 * cos((s - uTime / WAVE_PERIOD) * TAU);
    band = pow(band, WAVE_SHARPNESS);
    float wave = WAVE_BASE + WAVE_GAIN * band;

    float lum = clamp((rim + aura) * wave * uIntensity, 0.0, 1.0);
    finalColor = vec4(lum, lum, lum, lum);
}
`;

/**
 * Свечение силуэта одного объекта. Создаётся лениво (только у объекта, пережившего
 * смену стадии) и переиспользуется все следующие эволюции.
 */
export class GlowEffect {
  /** Корень эффекта — ребёнок контейнера объекта: позиция и зум сцены наследуются. */
  readonly root = new Container();

  /** Уходящая текстура: лежит ПОВЕРХ main-спрайта и гаснет первым этапом эффекта. */
  private readonly ghost: Sprite;
  /** Свечение: спрайт с текстурой объекта, к которому применён фильтр силуэта. */
  private readonly glow: Sprite;
  private readonly uniforms: UniformGroup;
  /** Ширина полосы гало в px площади — для окна затухания на краю. */
  private readonly pad: number;
  /** Истинный бокс объекта (габариты текстуры из паспорта ассетов), px сцены. */
  private readonly w: number;
  private readonly h: number;

  private phase: 'idle' | 'rise' | 'hold' | 'fall' = 'idle';
  /** Время с начала эффекта, с. */
  private t = 0;
  /** Идёт ли кросс-фейд (ghost показан и гаснет). */
  private fading = false;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;

    const minSide = Math.min(w, h);
    const rimRadius = clamp(minSide * RIM_FRACTION, RIM_MIN, RIM_MAX);
    const auraRadius = clamp(minSide * AURA_FRACTION, AURA_MIN, AURA_MAX);
    this.pad = Math.ceil(auraRadius * PAD_RATIO) + 2;

    this.uniforms = createGlowUniforms(w, h, this.pad, rimRadius, auraRadius);

    this.ghost = new Sprite();
    this.ghost.anchor.set(0.5);
    this.ghost.visible = false;
    this.root.addChild(this.ghost);

    this.glow = new Sprite();
    this.glow.anchor.set(0.5);
    this.glow.visible = false;
    this.glow.filters = [createGlowFilter(this.uniforms, this.pad)];
    this.root.addChild(this.glow);

    this.root.visible = false;
  }

  /** Идёт ли эффект (по нему GameView решает: серия — retarget или новый запуск). */
  get active(): boolean {
    return this.phase !== 'idle';
  }

  /**
   * Запуск свечения. newTexture — стадия, к которой переходим; previous — что было
   * показано до неё (null у первого появления объекта: гасить нечего, кросс-фейда нет).
   */
  start(newTexture: Texture, previous: Texture | null): void {
    this.setTexture(this.glow, newTexture);
    if (previous) {
      this.setTexture(this.ghost, previous);
      this.ghost.alpha = 1;
      this.ghost.visible = true;
      this.fading = true;
    } else {
      this.ghost.texture = Texture.EMPTY;
      this.ghost.visible = false;
      this.fading = false;
    }

    this.uniforms.uniforms.uIntensity = 0;
    this.uniforms.uniforms.uTime = 0;
    this.glow.visible = true;
    this.root.visible = true;
    this.phase = 'rise';
    this.t = 0;
  }

  /**
   * СМЕНА ЦЕЛИ (серия эволюций): эффект НЕ перезапускается, пока кросс-фейд ещё идёт —
   * просто показываем самую свежую форму (main-спрайт уже несёт новую текстуру, ghost
   * продолжает гаснуть, переход выходит бесшовным). Если фейд уже доигран — начинаем
   * заново, приняв ПРЕЖНЮЮ цель за уходящую текстуру (иначе была бы резкая подмена).
   */
  retarget(newTexture: Texture): void {
    if (!this.fading) {
      this.setTexture(this.ghost, this.glow.texture);
      this.ghost.alpha = 1;
      this.ghost.visible = true;
      this.fading = true;
      this.t = 0;
      this.phase = 'rise';
      this.uniforms.uniforms.uTime = 0;
    }

    this.setTexture(this.glow, newTexture);
  }

  /** Кадр эффекта. dt — реальные секунды (дебаг-ускорение времени его не трогает). */
  update(dt: number): void {
    if (this.phase === 'idle') return;

    this.t += dt;

    // Разгон → удержание (ровно на WAVE_REPEATS пробегов блика) → затухание.
    let intensity: number;
    if (this.phase === 'rise') {
      const u = this.t / RISE_TIME;
      intensity = smooth(u);
      if (u >= 1) this.phase = 'hold';
    } else if (this.phase === 'hold') {
      intensity = 1;
      if (this.t >= RISE_TIME + HOLD_TIME) this.phase = 'fall';
    } else {
      intensity = 1 - smooth((this.t - RISE_TIME - HOLD_TIME) / FALL_TIME);
    }
    this.uniforms.uniforms.uIntensity = intensity;
    this.uniforms.uniforms.uTime = this.t;

    // Кросс-фейд: ghost гаснет, открывая новую текстуру main-спрайта, — стартует на
    // пике свечения (CROSSFADE_DELAY), чтобы подмена шла «под прикрытием» гало.
    if (this.fading) {
      const u = (this.t - CROSSFADE_DELAY) / CROSSFADE_TIME;
      if (u >= 1) {
        this.fading = false;
        this.ghost.visible = false;
        this.ghost.texture = Texture.EMPTY;
      } else {
        this.ghost.alpha = 1 - smooth(u);
      }
    }

    if (this.t >= TOTAL_TIME) this.finish();
  }

  /** Конец эффекта: спрайты спрятаны до следующей эволюции. */
  private finish(): void {
    this.phase = 'idle';
    this.t = 0;
    this.fading = false;
    this.uniforms.uniforms.uIntensity = 0;
    this.glow.visible = false;
    this.ghost.visible = false;
    this.ghost.texture = Texture.EMPTY;
    this.root.visible = false;
  }

  /**
   * Текстура + истинный бокс сцены: у текстур разного разрешения своя натуральная
   * величина, width/height нормируют её в бокс объекта.
   */
  private setTexture(sprite: Sprite, texture: Texture): void {
    sprite.texture = texture;
    sprite.width = this.w;
    sprite.height = this.h;
  }
}

/** Зажать число в диапазон. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Uniforms одного эффекта: своя группа на объект (у каждого своя интенсивность и время). */
function createGlowUniforms(
  w: number,
  h: number,
  pad: number,
  rimRadius: number,
  auraRadius: number,
): UniformGroup {
  return new UniformGroup({
    uBoxPx: { value: new Float32Array([w, h]), type: 'vec2<f32>' },
    uBoxFrac: {
      value: new Float32Array([w / (w + pad * 2), h / (h + pad * 2)]),
      type: 'vec2<f32>',
    },
    uTexel: {
      value: new Float32Array([1 / (w + pad * 2), 1 / (h + pad * 2)]),
      type: 'vec2<f32>',
    },
    uPad: { value: pad, type: 'f32' },
    uRimRadius: { value: rimRadius, type: 'f32' },
    uAuraRadius: { value: auraRadius, type: 'f32' },
    uIntensity: { value: 0, type: 'f32' },
    uTime: { value: 0, type: 'f32' },
  });
}

/**
 * Фильтр свечения силуэта: программа одна на всех (кэшируется по исходнику), но
 * ГРУППА UNIFORMS у каждого эффекта своя — объекты светятся независимо.
 * padding — запас площади под внешнее гало; resolution 1 — кромка остаётся резкой
 * (половинное разрешение смазывало бы саму белую линию по контуру);
 * blendMode 'add' — свечение ДОБАВЛЯЕТСЯ к сцене (см. FilterOptions.blendMode).
 */
function createGlowFilter(uniforms: UniformGroup, pad: number): Filter {
  const glProgram = GlProgram.from({
    vertex: FILTER_VERT,
    fragment: FILTER_FRAG,
    name: 'silhouette-glow',
    preferredFragmentPrecision: 'highp',
  });

  return new Filter({
    glProgram,
    resources: { glowUniforms: uniforms },
    padding: pad,
    resolution: 1,
    antialias: 'off',
    blendMode: 'add',
  });
}
