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
   * для фона — число эпох (WORLD_PERIODS / 2).
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

/**
 * ObjectId → группа ассетов. Таблица намеренно типизирована (Partial<Record<ObjectId, …>>):
 * опечатка в id не соберётся. Объекты без пресета на сцене (навыки) сюда не входят.
 */
export const OBJECT_ASSET_GROUP: Partial<Record<ObjectId, AssetGroup>> = {
  bg: 'yard',
  house: 'house',
  car: 'car',
  hair: 'hair',
  clothes: 'clothes',
  watch: 'watch',
  furniture: 'furniture',
  tech: 'tech',
  pc: 'pc',
};

/** Группа ассета для объекта сцены (null — объект не рисуется). */
export const assetGroupOf = (id: ObjectId): AssetGroup | null => OBJECT_ASSET_GROUP[id] ?? null;

/** Ключ ассета в манифесте: «группа/стадия» (например, world/3 — фон 3-й эпохи). */
export const assetKey = (group: AssetGroup, stage: number): string => `${group}/${stage}`;

/** Группа фона: ключ эпохи — assetKey(WORLD_ASSET_GROUP, era). */
export const WORLD_ASSET_GROUP: AssetGroup = 'world';

/** Группа постоянного тела игрока (без стадий). */
export const CHARACTER_ASSET_GROUP: AssetGroup = 'character';

/** Стадия тела игрока (у персонажа нет тиров). */
export const CHARACTER_ASSET_STAGE = 0;

/** Манифест, который пишет npm run assets и читает игра (путь относительный). */
export const ASSET_MANIFEST_URL = 'assets/manifest.json';
