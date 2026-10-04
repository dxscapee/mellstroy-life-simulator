/**
 * ПАСПОРТ АССЕТОВ СЦЕНЫ — единственный источник правды для трёх потребителей:
 *   1) игра (GameView/WorldLayer берут отсюда истинные размеры боксов),
 *   2) рантайм-загрузчик (AssetRegistry: ключи «группа/стадия» + URL манифеста),
 *   3) пайплайн сборки (scripts/build-assets.mjs читает этот же sceneAssets.json
 *      и по нему валидирует размеры/стадии/бюджеты).
 *
 * Пайплайн (npm run assets) собирает public/assets/ из мастеров в art/:
 *   art/<группа>/<стадия>.<расширение>  →  public/assets/<группа>/<стадия>.<хеш>.<ext>
 * Ключ ассета в манифесте — «группа/стадия» (например, "house/0", "world/3").
 * Расширение файла решает формат: png/jpg/jpeg/webp/avif/gif → картинка,
 * mp4/webm/mov/m4v → видео. Подробная инструкция — ASSETS.md.
 *
 * Размеры w×h здесь — ИСТИННЫЕ габариты текстуры (= габариты прямоугольника
 * сцены). Раскладка позиций живёт в GameView; этот файл отвечает только за
 * размеры, папки, число стадий и бюджет веса.
 *
 * СЦЕНЫ: у каждого объекта сцены группа ассетов зависит от СЦЕНЫ (улица/дом) —
 * см. SCENE_OBJECT_GROUPS/assetGroupOf; фон у каждой сцены свой
 * (backgroundGroup). Прокачка при этом общая: сцена меняет только адрес ассета.
 */

import type { ObjectId } from '@engine/types';
import sceneAssets from './sceneAssets.json';

/** Имя группы = имя папки в art/ и public/assets/. Список задаёт sceneAssets.json. */
export type AssetGroup = keyof typeof sceneAssets.groups;

/** Описание группы ассетов: размер бокса, число стадий, кап вывода пайплайна. */
export interface SceneGroupSpec {
  /** Человекочитаемое имя (отчёт пайплайна, документация). */
  readonly label: string;
  /** Ширина текстуры-эталона (px). */
  readonly w: number;
  /** Высота текстуры-эталона (px). */
  readonly h: number;
  /**
   * Сколько стадий у группы: для объектов — число тиров (tierNames),
   * для фона — число локаций (LOCATIONS.length, data/locations.ts).
   */
  readonly stages: number;
  /**
   * Во сколько раз пайплайн максимум разрешает текстуру крупнее бокса
   * (2 = «можно отдать 2× для резкости на больших экранах»).
   */
  readonly maxScale: number;
}

/** Спеки всех групп (типизированы ключами из sceneAssets.json). */
export const SCENE_GROUPS: Record<AssetGroup, SceneGroupSpec> = sceneAssets.groups;

// ==================== СЦЕНЫ (локации мира) ====================

/**
 * СЦЕНА — часть мира, между которыми игрок переключается кнопкой.
 * Прокачка общая: делятся только МЕСТА объектов, не их уровни.
 *  · 'street' — улица: фон улицы, двор, дом, машина, игрок;
 *  · 'home'   — дом/квартира: фон квартиры, игрок и рабочее место.
 * Игрок (тело + носимые) живёт в ОБЕИХ сценах.
 */
export type SceneKind = 'street' | 'home';

/** Порядок сцен в кнопке перехода (и порядок вкладок-состояний). */
export const SCENE_ORDER: readonly SceneKind[] = ['street', 'home'];

/** Подпись и иконка сцены для кнопки перехода в UI. */
export const SCENE_META: Record<SceneKind, { label: string; icon: string }> = {
  street: { label: 'Улица', icon: '🌆' },
  home: { label: 'Дом', icon: '🏠' },
};

/**
 * Группы СЦЕНОВЫХ объектов по сценам. Навыки на сцене не рисуются — их нет нигде.
 * Объект живёт РОВНО в одной сцене (рабочее место — в домашней), игрок — в обеих
 * (см. CHARACTER_ASSET_GROUP ниже).
 */
export const SCENE_OBJECT_GROUPS: Record<SceneKind, Partial<Record<ObjectId, AssetGroup>>> = {
  street: {
    bg: 'yard',
    house: 'house',
    car: 'car',
    hair: 'hair',
    clothes: 'clothes',
    watch: 'watch',
  },
  home: {
    furniture: 'furniture_home',
    camera: 'camera_home',
    pc: 'pc_home',
    hair: 'hair',
    clothes: 'clothes',
    watch: 'watch',
  },
};

/**
 * Группа ассета объекта в конкретной сцене (null — объекта в этой сцене нет).
 * Вторая таблица намеренно НЕ вводится: сцена — часть адреса ассета, а не
 * отдельная сущность в data/objects.ts (там по-прежнему одна запись на объект).
 */
export const assetGroupOf = (id: ObjectId, scene: SceneKind): AssetGroup | null =>
  SCENE_OBJECT_GROUPS[scene][id] ?? null;

/** Есть ли объект на сцене хотя бы одной из сцен (для стартового прелоада). */
export const isSceneObject = (id: ObjectId): boolean =>
  SCENE_ORDER.some((scene) => assetGroupOf(id, scene) !== null);

/** Ключ ассета в манифесте: «группа/стадия» (например, world/3 — фон локации №4). */
export const assetKey = (group: AssetGroup, stage: number): string => `${group}/${stage}`;

/**
 * Группа фона КАЖДОЙ сцены: ключ фона = assetKey(backgroundGroup(scene), индекс
 * локации). Улица — world/<index>, квартира — world_home/<index>.
 */
export const SCENE_BACKGROUND_GROUP: Record<SceneKind, AssetGroup> = {
  street: 'world',
  home: 'world_home',
};

/** Группа фона для сцены (data-функция вместо константы: сцен стало две). */
export const backgroundGroup = (scene: SceneKind): AssetGroup => SCENE_BACKGROUND_GROUP[scene];

/** Группа постоянного тела игрока (без стадий). */
export const CHARACTER_ASSET_GROUP: AssetGroup = 'character';

/** Стадия тела игрока (у персонажа нет тиров). */
export const CHARACTER_ASSET_STAGE = 0;

/** Манифест, который пишет npm run assets и читает игра (путь относительный). */
export const ASSET_MANIFEST_URL = 'assets/manifest.json';
