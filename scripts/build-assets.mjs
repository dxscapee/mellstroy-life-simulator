/**
 * СБОРКА АССЕТОВ СЦЕНЫ (подробная инструкция — ASSETS.md).
 *
 * Запускается как CLI (`node scripts/build-assets.mjs`) и импортируется
 * Vite-плагином: шебанга здесь нет намеренно — esbuild, собирающий
 * vite.config.ts, не принимает `#!` внутри бандла.
 *
 * Что делает за один прогон:
 *   1) скаффолдит папки мастеров art/<группа>/ (если их ещё нет);
 *   2) читает мастера <стадия>.<расширение>: картинки конвертирует в WebP
 *      (кап по размеру: бокс × maxScale), видео копирует как есть —
 *      sharp не умеет видео, перекодирование остаётся за владельцем;
 *   3) кладёт результат в public/assets/<группа>/<стадия>.<хеш>.<ext>
 *      (хеш = содержимое + настройки: меняется файл или настройки — меняется имя);
 *   4) удаляет устаревшие сгенерированные файлы, пишет public/assets/manifest.json
 *      (только если содержимое изменилось) — его читает игра;
 *   5) печатает весовой отчёт и проверяет бюджеты (общий и стартовый).
 *
 * Запуск:  npm run assets  |  npm run assets:watch
 * В dev и build это же вызывается автоматически (scripts/vite-plugin-assets.mjs).
 * Конфиг (папки, размеры, стадии, качество, бюджеты) — src/data/sceneAssets.json.
 */

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmdirSync,
  closeSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, 'src', 'data', 'sceneAssets.json');

const MANIFEST_VERSION = 1;
const HASH_LEN = 8;

/** Картинки: sharp → WebP. */
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);
/** Видео: копируется как есть (браузерные форматы). */
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v']);
/** Мусор ОС — молча игнорируем. */
const JUNK_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
/** Временные файлы редакторов/загрузок — тоже молча. */
const TEMP_SUFFIXES = ['~', '.tmp', '.temp', '.bak', '.swp', '.swo', '.part', '.crdownload'];

const isTempFile = (name) => TEMP_SUFFIXES.some((suffix) => name.endsWith(suffix));

const PREFIX = '[assets]';
const MB = 1024 * 1024;

// ------------------------------------------------------------------ утилиты

const toPosix = (p) => p.split(sep).join('/');

const fmtBytes = (bytes) => {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${bytes} Б`;
};

const fmtDims = (w, h) => (w && h ? `${w}×${h}` : '—');

const pad = (text, width) => String(text).padEnd(width, ' ');

/** Суммарный вес всех файлов в папке (реальный вес того, что уедет на площадку). */
function folderSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? folderSize(full) : statSync(full).size;
  }
  return total;
}

const shortHash = (text) => createHash('sha1').update(text).digest('hex').slice(0, HASH_LEN);

function hashFile(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha1');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', rejectPromise)
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}

/** Эвристика «moov после mdat» — видео лучше перекодировать с -movflags +faststart. */
function mp4LacksFaststart(path) {
  const fd = openSync(path, 'r');
  try {
    const size = Math.min(statSync(path).size, 512 * 1024);
    const buf = Buffer.alloc(size);
    readSync(fd, buf, 0, size, 0);
    const moov = buf.indexOf('moov');
    const mdat = buf.indexOf('mdat');
    return mdat !== -1 && (moov === -1 || moov > mdat);
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

function loadConfig() {
  const raw = readFileSync(CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw);
  if (!config.groups || typeof config.groups !== 'object') {
    throw new Error('sceneAssets.json: нет секции groups');
  }
  return config;
}

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- сканирование

/**
 * Пасс 1: прочитать все группы, вернуть план (без записи в public/).
 * Ошибки-конфликты не дают собираться вообще — манифест не должен «моргать».
 */
function scanMasters(config, warnings, errors) {
  const srcRoot = join(ROOT, config.sourcesDir ?? 'art');
  const plan = [];

  for (const [group, spec] of Object.entries(config.groups)) {
    const srcDir = join(srcRoot, group);
    mkdirSync(srcDir, { recursive: true });

    const byStage = new Map();
    for (const name of readdirSync(srcDir)) {
      const ext = extname(name).toLowerCase();
      if (name.startsWith('.') || JUNK_FILES.has(name.toLowerCase()) || isTempFile(name)) continue;

      const base = ext ? name.slice(0, -ext.length) : name;
      if (!/^\d+$/.test(base)) {
        warnings.push(`${group}/${name}: имя не по схеме «номер.расширение» — пропущен`);
        continue;
      }
      if (!IMAGE_EXT.has(ext) && !VIDEO_EXT.has(ext)) {
        warnings.push(`${group}/${name}: формат не поддерживается — пропущен`);
        continue;
      }
      const stage = Number(base);
      if (stage >= spec.stages) {
        warnings.push(
          `${group}/${name}: у группы «${spec.label}» стадии 0..${spec.stages - 1} — файл не будет показан, пропущен`,
        );
        continue;
      }
      const previous = byStage.get(stage);
      if (previous) {
        errors.push(
          `Конфликт стадии ${group}/${stage}: «${previous.name}» и «${name}». Оставь один файл (формат решает расширение).`,
        );
        continue;
      }
      byStage.set(stage, { name, ext, path: join(srcDir, name) });
    }

    plan.push({ group, spec, srcDir, byStage });
  }

  // Три слоя рабочего места обязаны быть конгруэнтны (на них держится стопка).
  const trio = ['furniture', 'tech', 'pc'];
  if (trio.every((g) => config.groups[g])) {
    const [a, b, c] = trio.map((g) => `${config.groups[g].w}×${config.groups[g].h}`);
    if (!(a === b && b === c)) {
      errors.push(`furniture/tech/pc должны иметь одинаковый размер (сейчас ${a}, ${b}, ${c}).`);
    }
  }

  return plan;
}

// -------------------------------------------------------------------- сборка

/**
 * Пасс 2: конвертация/копирование, очистка устаревшего, манифест, отчёт.
 * Модуль не бросает исключения наружу: всё уходит в warnings/errors,
 * а результат описывается объектом { ok, changed, ... }.
 */
export async function buildAssets({ quiet = false } = {}) {
  const warnings = [];
  const errors = [];
  const notes = [];
  let changed = false;

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`${PREFIX} ОШИБКА: не читается src/data/sceneAssets.json — ${err.message}`);
    return { ok: false, changed: false, warnings, errors: [String(err.message)] };
  }

  const sharp = await loadSharp();
  if (!sharp) {
    const message =
      'sharp не установлен — картинки конвертировать нечем. Выполни `npm install` и повтори.';
    console.error(`${PREFIX} ОШИБКА: ${message}`);
    return { ok: false, changed: false, warnings, errors: [message] };
  }

  const outRoot = join(ROOT, config.outputDir ?? 'public/assets');
  mkdirSync(outRoot, { recursive: true });

  const plan = scanMasters(config, warnings, errors);
  if (errors.length > 0) {
    for (const error of errors) console.error(`${PREFIX} ОШИБКА: ${error}`);
    return { ok: false, changed: false, warnings, errors };
  }

  const manifest = { version: MANIFEST_VERSION, assets: {} };
  const rows = [];
  /** Файлы, которые не удалось удалить (заняты на Windows и т.п.). */
  const leftovers = [];

  for (const { group, spec, srcDir, byStage } of plan) {
    // Папку группы создаём лениво: пустые папки в dist и в архиве площадки
    // не нужны (структура видна в art/, а игра читает манифест).
    const outDir = join(outRoot, group);
    const ensureOutDir = () => mkdirSync(outDir, { recursive: true });
    const kept = new Set();

    const stages = [...byStage.keys()].sort((a, b) => a - b);
    for (const stage of stages) {
      const file = byStage.get(stage);
      const sourceRel = toPosix(relative(ROOT, file.path));
      const inputHash = await hashFile(file.path);

      if (IMAGE_EXT.has(file.ext)) {
        const settings = [
          'webp',
          `q=${config.webpQuality ?? 82}`,
          `aq=${config.webpAlphaQuality ?? 100}`,
          `cap=${spec.w * spec.maxScale}x${spec.h * spec.maxScale}`,
          `v=${MANIFEST_VERSION}`,
        ].join('|');
        const outName = `${stage}.${shortHash(`${inputHash}|${settings}`)}.webp`;
        const outPath = join(outDir, outName);

        try {
          let width;
          let height;
          let bytes;
          let inputDims = '';

          if (existsSync(outPath)) {
            const meta = await sharp(outPath).metadata();
            width = meta.width ?? 0;
            height = meta.height ?? 0;
            bytes = statSync(outPath).size;
          } else {
            const meta = await sharp(file.path).metadata();
            inputDims = `${meta.width}×${meta.height}`;
            const result = await sharp(file.path, { animated: true })
              .resize({
                width: spec.w * spec.maxScale,
                height: spec.h * spec.maxScale,
                fit: 'inside',
                withoutEnlargement: true,
              })
              .webp({
                quality: config.webpQuality ?? 82,
                alphaQuality: config.webpAlphaQuality ?? 100,
                effort: 4,
              })
              .toBuffer({ resolveWithObject: true });
            ensureOutDir();
            writeFileSync(outPath, result.data);
            width = result.info.width;
            height = result.info.height;
            bytes = result.info.size;
            changed = true;
          }

          const targetAspect = spec.w / spec.h;
          if (width && height && Math.abs(width / height - targetAspect) / targetAspect > 0.01) {
            const consequence =
              group === 'world'
                ? 'фон обрежется по краям (cover), без растяжения'
                : 'при показе текстура растянется';
            warnings.push(
              `${group}/${stage}: соотношение сторон ${width}×${height} ≠ эталона ${spec.w}×${spec.h} — ${consequence}`,
            );
          }
          if (inputDims && (width < Number(inputDims.split('×')[0]) || height < Number(inputDims.split('×')[1]))) {
            notes.push(`${group}/${stage}: мастер ${inputDims} уменьшен до ${width}×${height} (кап ${spec.maxScale}×)`);
          }

          kept.add(outName);
          manifest.assets[`${group}/${stage}`] = {
            url: `assets/${group}/${outName}`,
            type: 'image',
            w: width,
            h: height,
            bytes,
            source: sourceRel,
          };
          rows.push({ key: `${group}/${stage}`, type: 'картинка', dims: fmtDims(width, height), bytes, source: sourceRel });
        } catch (err) {
          errors.push(`${group}/${stage}: не удалось обработать «${file.name}» — ${err.message}`);
        }
        continue;
      }

      // Видео: без перекодирования.
      const outName = `${stage}.${shortHash(`${inputHash}|video`)}${file.ext}`;
      const outPath = join(outDir, outName);
      if (!existsSync(outPath)) {
        ensureOutDir();
        copyFileSync(file.path, outPath);
        changed = true;
      }
      if ((file.ext === '.mp4' || file.ext === '.m4v' || file.ext === '.mov') && mp4LacksFaststart(file.path)) {
        warnings.push(
          `${group}/${stage}: в MP4 нет faststart (moov после mdat) — старт воспроизведения будет поздним; перекодируй с -movflags +faststart`,
        );
      }
      if (file.ext === '.mov') {
        warnings.push(`${group}/${stage}: .mov поддерживается не всеми браузерами — надёжнее MP4/H.264 или WebM/VP9`);
      }
      kept.add(outName);
      manifest.assets[`${group}/${stage}`] = {
        url: `assets/${group}/${outName}`,
        type: 'video',
        bytes: statSync(outPath).size,
        source: sourceRel,
      };
      rows.push({ key: `${group}/${stage}`, type: 'видео', dims: '—', bytes: statSync(outPath).size, source: sourceRel });
    }

    // Чистим устаревшее в папке группы. Занятый файл (его читает dev-сервер
    // или просмотрщик) на Windows удалить нельзя — это НЕ ошибка: имена
    // хешированные, игра на такой файл не ссылается, уберётся в след. прогоне.
    if (existsSync(outDir)) {
      for (const name of readdirSync(outDir)) {
        if (kept.has(name)) continue;
        const path = join(outDir, name);
        try {
          unlinkSync(path);
          notes.push(`удалён устаревший файл ${group}/${name}`);
          changed = true;
        } catch {
          leftovers.push({ path: `${group}/${name}`, bytes: statSync(path).size });
        }
      }
      // Папка без файлов только шумит в dist — убираем, если получилось.
      if (readdirSync(outDir).length === 0) {
        try {
          rmdirSync(outDir);
        } catch {
          /* занято dev-сервером — не страшно */
        }
      }
    }
  }

  // Манифест: стабильный порядок ключей, запись только при изменениях.
  const sortedAssets = Object.fromEntries(
    Object.entries(manifest.assets).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const manifestText = `${JSON.stringify({ version: MANIFEST_VERSION, assets: sortedAssets }, null, 2)}\n`;
  const manifestPath = join(outRoot, 'manifest.json');
  const previousText = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : '';
  if (previousText !== manifestText) {
    writeFileSync(manifestPath, manifestText);
    changed = true;
  }

  // Бюджеты. Считаем РЕАЛЬНЫЙ вес папки ассетов: в него попадают и занятые,
  // и положенные руками файлы — площадка-то взвешивает диск, а не манифест.
  const budget = config.budget ?? {};
  const manifestBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  const diskBytes = Math.max(0, folderSize(outRoot) - statSync(manifestPath).size);
  const totalBytes = Math.max(manifestBytes, diskBytes);
  const totalLimit = (budget.totalMB ?? 90) * MB;
  const startupLimit = (budget.startupMB ?? 15) * MB;
  const startupKeys = Array.isArray(budget.startupKeys) ? budget.startupKeys : [];
  let startupBytes = 0;
  const missingStartup = [];
  for (const key of startupKeys) {
    const entry = manifest.assets[key];
    if (!entry) {
      missingStartup.push(key);
      continue;
    }
    startupBytes += entry.bytes;
  }
  const overTotal = totalBytes > totalLimit;
  const overStartup = startupBytes > startupLimit;

  for (const leftover of leftovers) {
    notes.push(
      `лишний/занятый файл ${leftover.path} (${fmtBytes(leftover.bytes)}) — не удалился, уберётся следующим прогоном`,
    );
  }

  if (!quiet) {
    console.log(`${PREFIX} Сборка ассетов — ${new Date().toLocaleString('ru-RU')}`);
    if (rows.length === 0) {
      console.log(`${PREFIX} Пока пусто: положи мастера в art/<группа>/<стадия>.<ext> — см. ASSETS.md`);
    } else {
      for (const row of rows) {
        console.log(
          `  ${pad(row.key, 14)} ${pad(row.type, 8)} ${pad(row.dims, 9)} ${pad(fmtBytes(row.bytes), 10)} из ${row.source}`,
        );
      }
    }
    console.log(
      `${PREFIX} Итого: ${rows.length} файл(ов) по манифесту, вес папки ${fmtBytes(totalBytes)} — бюджет ${budget.totalMB ?? 90} МБ ${overTotal ? 'ПРЕВЫШЕН' : 'OK'}`,
    );
    if (startupKeys.length > 0) {
      for (const key of missingStartup) notes.push(`стартовый набор: ${key} — файла нет (заглушка)`);
      console.log(
        `${PREFIX} Стартовый набор (${startupKeys.join(', ')}): ${fmtBytes(startupBytes)} — бюджет ${budget.startupMB ?? 15} МБ ${overStartup ? 'ПРЕВЫШЕН' : 'OK'}`,
      );
    }
    for (const note of notes) console.log(`${PREFIX} ${note}`);
    for (const warning of warnings) console.warn(`${PREFIX} ! ${warning}`);
  }

  if (overTotal) errors.push(`Суммарный вес ассетов ${fmtBytes(totalBytes)} превышает бюджет ${budget.totalMB ?? 90} МБ`);
  if (overStartup) errors.push(`Стартовый набор ${fmtBytes(startupBytes)} превышает бюджет ${budget.startupMB ?? 15} МБ`);
  for (const error of errors) console.error(`${PREFIX} ОШИБКА: ${error}`);

  return { ok: errors.length === 0, changed, warnings, errors, totalBytes, startupBytes };
}

// ----------------------------------------------------------------------- CLI

async function runWatchMode() {
  const config = loadConfig();
  const srcDir = join(ROOT, config.sourcesDir ?? 'art');
  let timer = null;
  let running = false;
  let queued = false;

  const rebuild = async () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      await buildAssets({ quiet: false });
    } finally {
      running = false;
      if (queued) {
        queued = false;
        timer = setTimeout(rebuild, 150);
      }
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(rebuild, 300);
  };

  watch(srcDir, { recursive: true }, schedule);
  watch(CONFIG_PATH, schedule);
  console.log(`${PREFIX} Слежу за art/ и sceneAssets.json… (Ctrl+C — выход)`);
}

async function cli() {
  const watchMode = process.argv.includes('--watch');
  const result = await buildAssets({ quiet: false });

  if (watchMode) {
    await runWatchMode();
    return;
  }
  process.exitCode = result.ok ? 0 : 1;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  cli().catch((err) => {
    console.error(`${PREFIX} ОШИБКА: ${err.stack ?? err}`);
    process.exitCode = 1;
  });
}
