# ABOUT_PROJECT — живая карта проекта

> ⚠️ Читается ПЕРВЫМ делом в каждой сессии (см. `CONTEXT.md`).
> После каждого структурного изменения проекта этот файл обновляется в том же ходе работы.
> Изменил код и не обновил этот файл = задача не завершена.

---

## 1. Что это за проект

2D **Idle Tycoon** (в духе Lamar — Idle Vlogger) для платформы **Яндекс Игры**.
На сцене: персонаж, за ним дом, тачка (после покупки). Всё прокачиваемое — ОБЪЕКТЫ
(13 шт., 4 группы-вкладки): у объекта уровень, каждые 30 уровней (levelsPerTier) —
ЭВОЛЮЦИЯ (меняется ВИЗУАЛЬНАЯ стадия-текстура и усиливается вклад в доход, итог ×1.8).
ИМЕНА СТАТИЧНЫ и обобщены (Недвижимость/Транспорт/Двор/…, решение владельца 2026-10-03).
Часть объектов изначально не куплена (уровень 0) — их покупают. Гейты `requires`:
ветка «Навыки» открывается после КАМЕРЫ — все четыре навыка сразу, без цепочки между собой;
рабочее место — камера → мебель → комп.

**Мета-прогресс — подписчики (subscribers):** шкала в правой нижней ячейке HUD
(иконка 👤 + счёт «N / цель» + бар). Прирост: раз в 5с капает величина = пассивный
доход за интервал; КАЖДЫЙ клик даёт величину = доход за этот клик (clickBonusEvery=1).
Цель ЦИКЛА фиксируется в момент старта (goalMult × тап) и НЕ тянется за ростом тапа
в середине цикла; после claim: новая цель = старая + goalMult × (тап на момент клейма) —
цели растут накопленно. Награда = rewardMult × (тап на момент клейма) = 500 × тап.
Цель/награда живут в состоянии (SubscriberState.goal), не в кэшах от тапа.

**Экономика двух потоков:**
- **A (активный)** — доход за тап: `A = moneyPerTap * (1 + Σ aWeight·level·tierMult)`;
- **P (пассивный)** — доход в секунду: `P = passiveBase * (1 + Σ pWeight·level·tierMult)`;
- `tierMult = 1.8^tier` (вклад ×2 за тир, процент ×0.9 за тир — см. Решение #10);
- не купленный объект (level 0) даёт вклад 0 — флаг владения 0/1 получается сам.

Планируется сильное масштабирование (престиж, рекламные бустеры, контент-апдейты).
Тон игры: ироничный, «уличный» (стадии: «Коробка» → «Комната» → «Квартира» → «Пентхаус»).

---

## 2. Стек

| Технология | Зачем |
|---|---|
| Vite 5 + TypeScript 5 (strict) | сборка, типы |
| Pixi.js v8 | игровая сцена на canvas (слой 1) |
| чистый HTML5/CSS | весь UI-оверлей (слой 2), без UI-фреймворков |
| break_infinity.js | большие числа; import: `import Decimal from 'break_infinity.js'` (default export!) |

---

## 3. Структура папок и назначение файлов

```
index.html            — два хост-контейнера: #canvas-host (z-index 1), #ui-root (z-index 10)
                        + #boot-screen (загрузочный оверлей, скрывается перед LoadingAPI.ready()).
                        Тега SDK Яндекса НЕТ — скрипт грузится динамически из services/yandex.ts.
CONTEXT.md            — правила работы AI с проектом (роль, запреты, проверки).
ABOUT_PROJECT.md      — этот файл.
ASSETS.md             — инструкция по текстурам сцены: art/ → npm run assets → public/assets + манифест.
art/                  — МАСТЕРА текстур владельца (gitignored): art/<группа>/<стадия>.<ext>.
public/assets/        — СОБРАННЫЕ ассеты (хеш-имена) + manifest.json; читает игра, уезжает в dist/.
scripts/              — пайплайн ассетов (Node, вне src): build-assets.mjs (сборка/отчёт/бюджеты) и
                        vite-plugin-assets.mjs (dev: слежение за art/ + перезагрузка; build: свежий dist).
src/
├── main.ts           — точка входа: Game → AssetRegistry + GameView (view.init и assets.init параллельно) →
│                       preload стартового набора под загрузочным экраном → applySceneState/applyWorldStage →
│                       UIManager (ему передаётся провайдер превью эпох: URL фона из манифеста —
│                       так ui не импортирует view) → await SDK → gameplayStart (ready ПОСЛЕ ассетов) →
│                       boot.hide. Дебаг-панель подключается ТОЛЬКО здесь (ей передаётся и сцена —
│                       кнопка подписей объектов): if (import.meta.env.DEV) +
│                       динамический import(). window.game/assets/scene (консольный доступ) — только в DEV.
├── data/             — ТОЛЬКО данные, ноль логики
│   ├── gameConfig.ts     — все константы: startingMoney, базы потоков moneyPerTap (A) и passiveBase (P),
│                            tiers (levelsPerTier=30 — полный прогресс-бар = 30 уровней, решение
│                            владельца 2026-10-03; weightMultiplierPerTier=2, weightDecayPerTier=0.9 →
│                            итог x1.8 за эволюцию), pricing (upgradeMarkup=1.15 — базовая наценка
│                            за уровень, skillMarkup=1.25 — навыки; отдельная точка тюнинга цен), subscribers (addIntervalSec=5, clickBonusEvery=1,
│                            goalMult=500, rewardMult=500), автосейв (10с), офлайн (макс 8ч, eff 50%, порог 60с), дебаг-шкалы.
│   └── objects.ts        — дата-драйвен список 13 ОБЪЕКТОВ: id, name, group, icon, startLevel (0|1),
│                            costBase, costGrowth (= gameConfig.pricing.*, свой литерал в дефе нет),
│                            aWeight/pWeight (вклады в потоки A/P), maxLevel,
│                            requires? (гейт ветки), tierNames? ТОЛЬКО как число стадий сцены
│                            (в карточке имена НЕ показываются — name статичен), currentLevel (runtime!).
│                            + groupMeta/groupOrder (вкладки), objectById (Map), getObject(),
│                            objectsByGroup(), tierOf(), buildSceneState() (визуал сцены для GameView).
│                            НОВЫЙ ОБЪЕКТ = одна запись в objectDefs (+ строка в TIER_STAGES, если рисуется на сцене).
│   ├── worldStages.ts    — стадии МИРА: WORLD_EXP_STEP=2.5 (ширина периода по порядкам totalEarned),
│                            WORLD_PERIODS=12; имена 12 фаз растительности (ЖИВУТ только в HUD/галерее —
│                            слой растительности с карты сцены СНЯТ решением владельца 2026-09-29) +
│                            6 эпох фона (WORLD_ERA_NAMES). Путь ассета фона — ключ манифеста
│                            world/<эпоха> (data/assets.ts worldEraAssetKey): формат (картинка или
│                            видео) определяет пайплайн по расширению файла-мастера (ASSETS.md).
│                            Схема: фон меняется каждый ВТОРОЙ период (era = period/2).
│   ├── sceneAssets.json  — ПАСПОРТ АССЕТОВ: группы (папка/размер/стадии/maxScale), качество WebP,
│   │                        бюджеты. ЕДИНЫЙ источник размеров: читают и игра, и пайплайн (скрипт
│   │                        парсит этот же JSON — размеры не дублируются в двух местах).
│   └── assets.ts         — мост «объект ↔ папка»: AssetGroup (ключи JSON), SCENE_GROUPS,
│                            OBJECT_ASSET_GROUP (ObjectId → папка), assetKey/worldEraAssetKey,
│                            ASSET_MANIFEST_URL; комментарий-контракт по ключам/форматам/стадиям.
├── engine/           — чистая логика, НЕ знает про DOM/Pixi
│   ├── types.ts          — контракты: ObjectGroup, ObjectId, ObjectDef, BuyMode ('one' — один
│                            уровень за действие | 'tier' — до конца текущего грейда),
│                            GameStateSnapshot (version:2), OfflineEarnings, GameEventMap.
│   ├── eventBus.ts       — типизированная шина событий over GameEventMap; синглтон `events`.
│                            emit итерирует Set БЕЗ копии (аллокация на каждом тике недопустима):
│                            отписка внутри обработчика безопасна, т.к. Set пропускает удалённое.
│   ├── format.ts         — formatMoney/formatNumber (до 2 знаков, подрезка нулей, 999.996→1K),
│                            formatIncomePerSecond, formatCount (обычные числа: подписчики, цели),
│                            formatTime. Единственное место Decimal→строка.
│   ├── GameState.ts      — модель: money, passiveIncomePerSecond (кэш), totalEarned, tapsCount,
│                            subscribers {count, progress, claimed, claimable, goal}, tapOverride (dev-форс).
│                            Потоки: getMoneyPerTap (кэш cachedMoneyPerTap) и recalculatePassiveIncome —
│                            оба = base*(1+Σ weight·level·tierMult); tierWeightMult = 1.8^(level/10)
│                            (вклад ×2 за тир, процент ×0.9 за тир).
│                            Подписчики: getSubscriberGoal (ленивый фикс SubscriberState.goal от тапа,
│                            НЕ меняется при росте тапа в цикле), getSubscriberReward (500×тап НА МОМЕНТ
│                            клейма, без кэша), addSubscribersFromPassive(dt),
│                            addSubscribersFromTap (каждый N-й клик), claimSubscribers
│                            (после claim: goal += 500×тап — накопленный рост целей).
│                            Инвалидация кэшей — invalidateCaches() ПОСЛЕ любого изменения уровней
│                            (buyUpgrade/loadFromSnapshot/resetProgress/applyLevels — ИНАЧЕ старые доходы).
│                            getUpgradeCost = costBase*costGrowth^level (costGrowth — из gameConfig.pricing);
│                            isUnlocked (гейт requires);
│                            isMaxed; getBuyPlan(def, mode) — ПЛАН покупки на одно действие
│                            (count + суммарная стоимость; 'tier' режет пачку на конце грейда,
│                            не меняет состояние — его читает UI для кнопки); buyUpgradeBulk(def, mode)
│                            — списание ОДНОЙ суммой и ОДНА инвалидация кэшей (зажатая кнопка берёт
│                            десятки уровней за действие); buyUpgrade(def) — обёртка над 'one';
│                            resetProgress (вся логика сброса в модели);
│                            applyLevels (нейтральный API для дебага/облака); toSnapshot/loadFromSnapshot
│                            (потоки пересчитываются из дефов, не верим сейву); calcOfflineEarnings.
│                            ТОЧКА РАСШИРЕНИЯ глобальных множителей — recalculatePassiveIncome.
│   ├── WorldProgress.ts — чистый расчёт стадии мира из totalEarned: calcWorldStage (period =
│                            floor(log10/STEP), era = period/2, прогресс В ЛОГАХ внутри периода);
│                            worldProgressFrac — ЖИВАЯ дробь периода без аллокаций (кэш WorldWatch
│                            заморожен между сменами; кольцо прогресса HUD считает по ней);
│                            WorldWatch — кэш стадии, update() → true при смене периода (аллокация
│                            объекта стадии ТОЛЬКО на смене; на тике — примитивное сравнение).
│   ├── GameLoop.ts       — rAF-цикл: dt = min(rawDt, 1.0) * speedScale; speedScale — дебаг x1/x5/x10.
│   ├── SaveManager.ts    — LocalStorage, ключ 'idle_tycoon_save_v2'; валидация version:2 (старые сейвы = новая игра); try/catch везде.
│   ├── OfflineProgress.ts— calc(state, lastSavedAt) + apply() → текст для модалки.
│   └── Game.ts           — ФАСАД ядра: владеет state/loop/saveManager; тик: доход→worldWatch (смена
│                            периода мира → emit('world:changed'))→таймер подписчиков
│                            (раз в 5с addSubscribersFromPassive)→автосейв→emit('tick').
│                            worldWatch — readonly-поле (UIManager читает .stage; EraPopup получает
│                            Game целиком: эпоха/период — из .stage, живой прогресс — state.totalEarned).
│                            API: handleTap (внутри — бонус подписчиков), buyObject(id, mode) —
│                            пачечная покупка, события ('object:levelup' + 'money:changed') эмитятся
│                            ОДИН раз на всю пачку,
│                            claimSubscribers, saveNow, resetAll (эмитит world:changed),
│                            setTimeScale, destroy.
│                            pendingOfflineModal — результат офлайна на старте (см. Грабли #3).
│                            Сейв на visibilitychange + beforeunload.
├── view/             — слой Pixi (z-index 1)
│   ├── WorldLayer.ts     — ЗАДНИЙ СЛОЙ МИРА «Фон» (объект 5 чертежа): СТАТИЧЕСКИЙ, но СЛЕДУЕТ за
│                            экраном: layout(w,h) (зовётся из GameView.layout на КАЖДОМ ресайзе) заново
│                            считает cover = max(w/REF_W, h/REF_H) и садит центр на центр экрана — фикс
│                            владельца 2026-09-30 (раньше cover считался ОДИН раз при init, и при сужении
│                            окна фон «уезжал» вправо вместе с домом и двором); непропорциональное окно
│                            срезает края симметрично. Эталон WORLD_REF 1120×759 (аспект мастеров
│                            world/0 и world/2 = 1.475; был 1120×1505 при ландшафтных мастерах —
│                            несоответствие, убрано 2026-10-03). Плейсхолдер — ОДИН прямоугольник цвета чертежа
│                            (0x3f6f8f): перекраска по эпохе убрана — визуальную смену эпох даст
│                            замена текстуры (worldEraBackground(era)); applyStage(era) — no-op,
│                            контракт main → view сохранён.
│   ├── GameView.ts       — Application (resizeTo host, resolution ≤2, autoDensity); градиент через
│                            2D-canvas→Texture; сцена: ПРЯМОУГОЛЬНИКИ-ЗАГЛУШКИ (buildRect: fill+stroke
│                            в цвете чертежа + метка «N · ИМЯ · W×H» для снятия размеров текстур;
│                            все Graphics-фигуры, тинты и подписи стадий УДАЛЕНЫ); двор (yard) и
│                            рабочее место (workplace Map: camera/furniture/pc — ОДНА точка и ОДНА геометрия
│                            WORKPLACE_W×WORKPLACE_H = 360×480 (из sceneAssets.json; было 300 → 350×460 →
│                            нормализация 8px-сетки 2026-10-03): inset СНЯТ (владелец 2026-09-30: «все объекты
│                            должны быть одинаковых размеров» — рамки выглядели как разные боксы);
│                            глубина addChild = чертёж: мебель(12, дальний) →
│                            камера(11) → комп(10, ближний); по Y стопка СТОИТ НА ПОЛУ (placeWorkplace:
│                            низ — FLOOR_GAP 8px над нижним краем окна), по X — WORKPLACE_DX+дрейф группы),
│                            персонаж + носимые
│                            (worn Map: hair/clothes/watch — ДЕТИ character, позиции — офсеты от центра
│                            игрока; раскладка БОРТ К БОРТУ по чертежу 2026-09-30, офсеты пересчитаны
│                            2026-10-03 под игрока 264×552: причёска 264×192 —
│                            верхняя полоса (1/3), одежда 264×360 — нижняя (2/3; верх одежды = низ причёски), часы
│                            120×176 — слева вплотную, верх на 15px ниже стыка полос; слои: тело(1) →
│                            причёска(8)/одежда(9) → часы(7)). Цвета слоёв СВОИ (игрок красный, причёска
│                            зелёная, одежда синяя, часы фиолетовые; мебель оранжевая, камера бирюзовая,
│                            комп жёлтый); RectSpec.lift поднимает подпись там, где соседи слились бы.
│                            Вложенных рамок (inset) в коде НЕТ — геометрия заглушек чистая, w×h всегда
│                            равны истинному размеру текстуры.
│                            applySceneState — ТОЛЬКО owned → visible (тиры до текстур ничего не
│                            меняют); ПУЛ текстов «+1$» (floatPool); сквош при тапе. Idle-покачивание
│                            игрока СНЯТО (владелец 2026-09-30, временно): позиция и наклон группы игрока
│                            заморожены — двигает её только раскладка по ширине окна.
│                            ЗАКОН РАСКЛАДКИ v2 (чертёж владельца, эталон 1120×1505, SCENE_REF):
│                            композиция ОДНА на все ориентации (портретная ветка удалена).
│                            СТАТИЧЕСКИЕ (фон/двор/дом): X = центр экрана НА КАЖДОМ ресайзе (фикс 2026-09-30:
│                            раньше X фиксировался при init и «уезжал» вправо при сужении окна; в WorldLayer
│                            — тем же правилом), Y — центр композиции (topFree=min(170,24%h)+usable×0.46);
│                            метки статики клампятся под HUD (clampMarkerTop). ДИНАМИЧЕСКИЕ объекты
│                            (игрок/машина/рабочее место):
│                            якоря (dx,dy) от центра; шире эталона → drift = излишек×DRIFT_GAIN 0.25,
│                            потолок 190px (доля |dx|/400), рабочее место отъезжает ЦЕЛИКОМ
│                            (WORKPLACE_GROUP_DX); уже эталона → dx×squeeze (w/1120). ИСКЛЮЧЕНИЕ по Y:
│                            рабочее место не садится на центр композиции — оно СТОИТ НА ПОЛУ
│                            (y = h − FLOOR_GAP − WORKPLACE_H/2, WORKPLACE_DX для X). РАЗМЕРЫ
│                            объектов — константы (зум сцены отсутствует). НОВЫЙ СЦЕНОВЫЙ ОБЪЕКТ =
│                            SPEC + build-метод + ветка applySceneState + якорь в layout.
│                            ЗАМЕНА НА ТЕКСТУРЫ СДЕЛАНА: у каждого узла сцены спрайт + заглушка + метка
│                            (Map visuals → RectVisual со стадией/appliedKey); applySceneState ставит
│                            стадию по тиру (в т.ч. ветка house — раньше тир дома не переключался),
│                            applyWorldStage тянет world/<эпоха> и освобождает прошлый фон; onLoaded →
│                            refreshTextures (ленивая догрузка); гаснет при появлении текстуры
│                            прямоугольник (подпись — по правилу показа подписей ниже). ПОКАЗ ПОДПИСЕЙ (дебаг-фича, ТЗ владельца 2026-10-02, корректура того же дня):
│                            setObjectLabels(on) + флаг labelsForced (по умолчанию ВЫКЛ — подписи
│                            скрыты У ВСЕХ, и на заглушках тоже); правило одно —
│                            syncLabelVisibility: подпись видна ТОЛЬКО при labelsForced (включая
│                            метку фона); рамки-gfx не трогаем; из консоли —
│                            scene.setObjectLabels(true). Размеры боксов — из sceneAssets.json (sceneBox),
│                            сама раскладка не изменилась.
│   └── assetRegistry.ts  — РАНТАЙМ-ЗАГРУЗЧИК ТЕКСТУР: init (fetch манифеста no-cache; нет/битый —
│                            пусто, живём на заглушках), resolveKey (откат стадий вниз), entry (запись
│                            манифеста: URL + формат — для превью эпох в UI, без текстуры в сцену),
│                            texture
│                            (кэш → Texture, иначе фоновая загрузка + null), preload (стартовый набор
│                            с прогрессом и таймаутом, не реджектит), release, onLoaded. Картинки —
│                            штатный Assets Pixi; видео — VideoSource со скрытым <video>
│                            muted+playsinline+loop без контролов (Яндекс 1.6.2.5), ретрай автоплея по
│                            первому жесту, release закрывает декодер. О раскладке не знает.
├── ui/               — HTML-оверлей (z-index 10)
│   ├── styles.css        — #ui-root{pointer-events:none}, button/.js-interactive{auto};
│                            .sheet-modes/.mode-btn — радио режима покупки КОМПАКТНЫМИ
│                            пилюлями (flex:0 0 auto, слева, подписи «1 ур.»/«max» — ТЗ
│                            владельца 2026-10-02; активный = --accent),
│                            .upgrade-buy: touch-action:none + user-select:none (зажатие кнопки
│                            не должно уезжать в скролл списка и выделять текст);
│                            .modal-backdrop: visibility+pointer-events при скрытии (см. Грабли #2);
│                            --tabbar-h: 60px синхронизирует выноску и таб-бар;
│                            --menu-w: min(100%,420px) — ЕДИНАЯ ширина меню (нижняя панель
│                            = выноска/попап): всё СЖАТО К ЦЕНТРУ (left:50% + translateX(-50%))
│                            и не растягивается на широких экранах; у .hud-top боковых отступов нет,
│                            поэтому крайние плашки вровень с блоком;
│                            .hud-bar — ВЕРХНЯЯ ПАНЕЛЬ КАК ОДНО ЦЕЛОЕ: блок .hud-top СДВИНУТ
│                            ВПРАВО от центра (--hud-shift 30px = прежний отступ кольца 6px +
│                            24px по ТЗ владельца 2026-10-02) + кольцо, ПРИКРЕПЛЁННОЕ К ЕГО
│                            ЛЕВОМУ КРАЮ (right: 100% + --ring-gap 10px) — при ресайзе не
│                            расходится с блоком; своя --bar-w (min(100vw,420px); на <584px
│                            min(100vw−124px,420px)) — в vw, чтобы кольцо считало размер;
│                            .world-ring — круглая кнопка-таблетка из МАТЕРИАЛОВ плашек
│                            (фон --bg-panel + рамка 8%, без зелёного оттенка и теней): дорожка +
│                            сплошная зелёная дуга var(--accent) + % внутри, вспышка .evolved; РАЗМЕР
│                            --ring-size = clamp(52px, свободная полоса слева − зазор − отступ,
│                            --ring-max 96px) — «насколько влезает»: 76px на узком экране, до 96px
│                            на широком (медиа-значений размера больше нет); % внутри и inset SVG
│                            масштабируются от --ring-size;
│                            .world-label — НАЗВАНИЕ ЛОКАЦИИ (эпоха) ПОД кольцом, внутри кнопки:
│                            ширина = кольцо + зазор — ровно свободная полоса до левого края блока
│                            (за компоновку панели не выходит), длинное имя режет ellipsis;
│                            .era-pop — карусель эпох ПО ЦЕНТРУ ЭКРАНА (top/left 50% + translate(−50%));
│                            .era-viewport (кадр) / .era-track (лента N×кадр, transform из TS) /
│                            .era-page (медиа-слот) / .era-media (contain — арт не обрезаем) /
│                            .era-media-unknown («?» будущей эпохи) / .era-media-empty (нет ассета);
│                            .era-arrow (круглые ‹ › по краям кадра, :disabled на концах) / .era-dots
│                            + .era-dot (хит 18px, видимый кружок 10px через прозрачную рамку) /
│                            .era-strip (нижняя строка: иконка / имя + фаза / бар / ✓ · % · 🔒);
│                            pointer-events:none — подпись не интерактив (инвариант 4), тапы сквозь
│                            неё уходят в сцену (проверено elementFromPoint → CANVAS);
│                            .settings-btn УДАЛЕНА (владелец 2026-10-02, временно) вместе с
│                            медиа-правкой свисания;
│                            .sheet — ОТДЕЛЬНАЯ выноска: bottom: tabbar-h + safe-area + 10px,
│                            скругление со всех сторон, тень, pop-анимация scale 0.96→1,
│                            закрыта = opacity:0 + visibility:hidden (кнопки не перехватывают тапы);
│                            .hud-top сам не ловит клики (pointer-events:none — плашки-показатели
│                            не должны есть тапы по холсту; у плашки подписчиков — auto как button).
│   ├── UIManager.ts      — ВЕРХНЯЯ ПАНЕЛЬ .hud-bar (центр — как у нижнего меню): ПЯТЬ ПЛАШЕК
│                            БЕЗ ПОДПИСЕЙ (ТЗ владельца 2026-09-30) — только значения, поэтому
│                            ячейки ниже (38px против ~50 с подписями):
│                            [баланс][пассив] / [новая валюта «soon»][актив] / [подписчики+бар];
│                            порядок DOM row-major; ВСЕ ЗНАЧЕНИЯ БЕЛЫЕ (ТЗ владельца 2026-10-02:
│                            разноцветную маркировку stat-<kind> убрали), полное имя —
│                            в title ячейки; GOLD — статичная заглушка новой валюты (значение не
│                            перерисовывается); ЧИП ЭПОХИ УДАЛЁН (его роль у кольца) — renderEraChip
│                            и WORLD_*_NAMES из UI убраны.
│                            КОЛЬЦО ПРОГРЕССА МИРА .world-ring (слева от блока, right:100%+10px):
│                            с SVG (viewBox 60, r=26) — дорожка world-ring-track + дуга
│                            world-ring-fg (сплошной var(--accent); defs/linearGradient и
│                            WORLD_RING_GRADIENT_* удалены 2026-10-02); заполняется
│                            от worldProgressFrac(totalEarned) — живая дробь периода, обновление
│                            ~12 раз/с (троттлинг worldThrottle=5 кадров), DOM-запись только при
│                            смене целого % (lastWorldPct), stroke-dashoffset + CSS-переход;
│                            клик — EraPopup (та же функция, что была у чипа); на world:changed —
│                            вспышка .evolved на кольце (рестарт через offsetWidth).
│                            ПОДПИСЬ ЛОКАЦИИ .world-label под кольцом (тапы сквозь неё — в сцену):
│                            ЦЕНТР ПОД КОЛЬЦОМ (фикс 2026-10-02): left: calc(--ring-gap / -2) при
│                            ширине 100%+--ring-gap — центр бокса = центр кольца, text-align:center
│                            ставит текст ровно под ним (было left:0 → текст уходил вправо на
│                            gap/2 = 5px; замер вживую: delta 0 после фикса). Текст = WORLD_ERA_NAMES
│                            [worldWatch.stage.era] (единственный вернувшийся в UI импорт
│                            WORLD_*_NAMES); renderWorldLabel() — по world:changed / game:reset
│                            и один раз в конструкторе (эпоха меняется редко, в тике не нужна).
│                            КНОПКА НАСТРОЕК УДАЛЕНА (владелец 2026-10-02, временно): поле
│                            settingsBtn, разметка и CSS убраны (вернуть — из истории git).
│                            На <584px сжимается сам БЛОК (.hud-bar): --bar-w
│                            min(100vw−124px, 420px), значение мельче; размер кольца отдельно
│                            не задаётся — его считает CSS от свободной полосы.
│                            Ячейки .hud-cell: только значение (mkStat, title ячейки);
│                            ячейка подписчиков — button.sub-cell на всю ширину блока
│                            (grid-column 1/-1; клик = забрать награду; claimable → пульс +
│                            «Забрать N$»); game:reset → принудительный рендер.
│                            Ключ-строка renderSubscribers — DOM только при изменениях;
│                            троттлинг ~4/с, кэш строк, форс на tap:earned/object:levelup;
│                            выноска обновляется ТОЛЬКО пока открыта (sheet.isOpen()),
│                            синхронизация цен — в sheet.open() через refresh().
│   ├── ObjectSheet.ts    — вкладки групп (из groupOrder) + ВЫНОСКА покупок (плавающее окно над
│                            таб-баром, НЕ его продолжение); DOM строится ОДИН раз из дефов;
│                            ПОВТОРНЫЙ клик по активной вкладке закрывает окно (toggle в showGroup);
│                            подсветка .active — только у вкладки ОТКРЫТОГО окна (updateTabActiveState
│                            зовётся из open()/close()).
│                            СХЕМА КАРТОЧКИ (по ТЗ): [иконка слева][стадия тира][бар][нижняя строка
│                            ур. N + ОБЩИЙ вклад][кнопка справа]. Имя = стадия тира купленного
│                            объекта (Ноут/Монитор/Супер-ПК), не куплен — название из дефа.
│                            Бар: level%10 / 10 + подпись «ур. N» (или «Нужен: X» / «Не куплено» / MAX).
│                            ПЕРЕХОД ЧЕРЕЗ ГРЕЙД (владелец 2026-10-03): покупка, перепрыгнувшая границу
│                            тира (в 'tier' — ВСЕГДА, пачка режется по концу грейда), СНАЧАЛА
│                            доливает бар до 100% (playTierFill, TIER_FILL_MS 260 ≈ CSS-transition
│                            0.25s) и только потом сбрасывает в новый грейд БЕЗ анимации (раньше
│                            падал в 0 мгновенно). Таймер живёт на карточке (fillTimer), его
│                            гасит clearFillTimer при смене уровня/режима/вкладки.
│                            card-income показывает ОБЩИЙ вклад объекта в потоки на текущий момент
│                            (base·weight·level·tierMult, NOT дельта следующего уровня), в нижней строке.
│                            refreshCard() пишет в DOM только изменения (кэши shownLevel/shownUnlocked/
│                            shownAffordable/cachedCost); renderLevelDependent — бар+подпись+кнопка при смене уровня.
│                            Состояния: locked (🔒 + «Нужен: X»), level 0 («Не куплено»), owned, maxed («Максимальная эволюция»).
│                            РЕЖИМ ПОКУПКИ: радио .sheet-modes сверху выноски (role=radiogroup,
│                            активный .mode-btn.active) — 'one' («1 ур.») | 'tier' («max»),
│                            пилюли fit-content слева, высота строки ~31px (ТЗ 2026-10-02);
│                            setBuyMode сбрасывает зажатие и зовёт refresh(true). ЗАЖАТИЕ КНОПКИ:
│                            pointerdown заводит таймер HOLD_DELAY_MS 420мс (до него покупок НЕТ —
│                            юзер успевает отпустить), дальше шаги HOLD_REPEAT_MS 120мс, после
│                            12 повторов 70мс; pointerup/cancel/leave гасят серию. Сама ОДИНОЧНАЯ
│                            покупка — на click (работает и с клавиатуры), лишний click после серии
│                            гасит флаг holdFired. Покупка = game.buyObject(id, buyMode); в режиме
│                            'tier' подпись кнопки = сумма пачки + «×N» (троттлинг TIER_PLAN_THROTTLE_TICKS
│                            = 15 тиков, Decimal не бесплатен), в 'one' — кэш цены уровня.
│   ├── EraPopup.ts       — попап-галерея эпох КАРУСЕЛЬЮ (клик по КОЛЬЦУ прогресса в HUD):
│                            ОКНО ПО ЦЕНТРУ ЭКРАНА (ТЗ владельца 2026-10-02: было прижато к нижней
│                            панели), одна страница = одна эпоха. ПРЕВЬЮ СТРАНИЦЫ: прошлые и текущая —
│                            ФОН ЭПОХИ из манифеста (world/<эпоха>, картинка или видео; видео живёт
│                            только на активной странице, декодер закрывается при уходе), будущие —
│                            только «?», нет ассета — заглушка с иконкой. Провайдер превью eraPreview
│                            даёт main из AssetRegistry (ui про view не знает — только URL и формат).
│                            ЛЕНТА: ширина N×кадр и доля страницы задаются inline из TS (число эпох
│                            не дублируется в CSS), сдвиг — translateX в % от ЛЕНТЫ (не от кадра:
│                            иначе лента не доезжает); стрелки ‹ › по краям кадра (на концах
│                            disabled), точки-индикатор снизу (хит-зона 18px, клик = прыжок на
│                            страницу). НИЖНЯЯ СТРОКА — по ПРОСМАТРИВАЕМОЙ странице: пройдено (✓, бар
│                            100%) / текущая (Растительность: фаза + % и бар) / будущая (🔒 + порог
│                            10^(2·STEP·era) в formatMoney). Медиа-слоты ленивые (mediaState: unbuilt/
│                            future/placeholder/image/video), при смене эпохи «?» ↔ фон перестраивается;
│                            обновление по дифу (index/era/pct); открытие — всегда на текущей эпохе;
│                            isOpenState() — UIManager обновляет только открытым.
│                            ПРОГРЕСС % — ЖИВОЙ (фикс 2026-10-02): constructor(uiRoot, game: Game,
│                            preview?) — НЕ WorldWatch; pct в refresh()/renderStrip() =
│                            floor(worldProgressFrac(state.totalEarned)*100) — та же живая дробь
│                            и то же округление, что у кольца. Раньше брался кэш stage.eraProgress,
│                            ЗАМОРОЖЕННЫЙ между сменами периода (WorldWatch обновляет current только
│                            на смене) — меню показывало 0%, пока кольцо жило; refresh() зовётся
│                            из onTick на КАЖДОМ тике пока открыта (кольцо — каждые 5 тиков).
│   ├── OfflineModal.ts   — универсальная модалка show(title, body, buttonText, onClose).
│   └── BootScreen.ts     — загрузочный оверлей #boot-screen (разметка в index.html, стили в
│                            styles.css): setStatus/setProgress/hide. Скрывается перед
│                            LoadingAPI.ready() — платформа видит уже одетую игру; без элементов
│                            в разметке методы тихо ничего не делают.
├── services/
│   └── yandex.ts         — синглтон yandexService. init(): НЕ в iframe → mock БЕЗ загрузки скрипта
│                            (см. Решения #1); в iframe → динамическая загрузка sdk/v2 → YaGames.init().
│                            showFullscreenAdv/showRewardedVideo (промисы), gameplayStart, cloud-save заготовки.
└── debug/              — DEV-only, вырезается из прода (проверено grep по dist/)
    ├── debugPanel.ts     — панель «~»/точка в углу (СЛЕВА сверху, сбоку от HUD; при <700px
│                            компактнее): деньги — поле (человекочитаемая нотация 1M/2.5B/1e623,
│                            parseDebugAmount) + кнопка «Добавить» + множители ×10/×100; «+1 lvl
│                            всем» (уровень +1 у КАЖДОГО объекта); «↩ Отменить» — undo-стек LIFO
│                            РОВНО 10 шагов, откатывает ПО ОДНОМУ действию за нажатие
│                            (деньги: money+totalEarned с полом; уровни: applyLevels(before));
│                            форс тапа (поле + переключатель «$»; пока форс АКТИВЕН, правка поля
│                            и ×10/×100 применяется ЖИВО через live-hook mkMultButtons —
│                            повторное «$» не нужно; blur/Enter — только лог); сброс (двойной клик;
│                            перед следующим логом ставит маркер «история до сброса», wrapPending);
│                            скорость x1/x5/x10 (x1 ВЫБРАНА при старте); ВСТРОЕННЫЕ ЛОГИ
│                            (log-list: новые СНИЗУ, автоприлипание только у низа — при чтении
│                            вверх автоскролл не дёргает; 200 строк LOG_HISTORY; длинные строки
│                            переносятся; история до сброса приглушена классом .log-wrap-start);
│                            мутации state из панели — через Game.refreshAfterDebug().
│                            КНОПКА «Подписи объектов: ВКЛ/ВЫКЛ» (ТЗ владельца 2026-10-02) —
│                            единственное место, где панель трогает СЦЕНУ: setupDebugPanel(game, scene)
│                            → scene.setObjectLabels(); по умолчанию ВЫКЛ (подписи скрыты нигде —
│                            даже на заглушках), включённая кнопка подсвечена .active-forced, смена — в лог.
    └── debugPanel.css    — стили панели (+ .row input, .flash-ok); импортируется только из debugPanel.ts.
                            Точка-триггер .debug-corner-dot после редизайна HUD переехала влево ПОД кольцо
                            прогресса (top:128px, left:12px) — ниже кольца 96px и его подписи локации
                            (2026-10-02) — не мешает ни плашкам, ни подписи. ПРИ ОТКРЫТОЙ ПАНЕЛИ
                            точка прилипает к её правому верхнему углу (класс .panel-open от toggle():
                            236,46 при панели 10+220; 202,40 на <700px), z-index 10000 — иначе
                            панель (9999) перекрывала её и закрыть панель с точки было нельзя (фикс
                            2026-10-02).
                            Скролл: панель с max-height 100dvh−56px + touch-action:pan-y, лог-лист —
                            overscroll-behavior:contain (жесты скролла не уходят на страницу).
```

---

## 4. Связи и потоки (кто с кем общается)

**Направление зависимостей (нарушать нельзя):**
`data ← engine ← (view | ui | debug)`; main знает всех; view и ui НЕ импортируют друг друга.

**События шины (`GameEventMap` в types.ts):**
`tick`, `money:changed`, `game:saved`, `game:reset` (undefined) · `offline:income {title, body}` ·
`tap:earned {amount, totalTaps}` · `object:levelup` (ObjectDef) ·
`subscribers:changed` / `subscribers:ready` / `objects:changed` (undefined) ·
`world:changed {period, era}` (смена периода мира; слушают main — фон сцены — и UIManager — кольцо прогресса).

**Ключевые потоки:**
1. Тап: canvas pointerdown → GameView → колбэк main → Game.handleTap → GameState.applyTap →
   события → HUD; «+1$» из пула; каждый 5-й клик — бонус подписчиков (= доход за клик).
2. Покупка: кнопка ObjectSheet → Game.buyObject → GameState (списание, level++, invalidateCaches) →
   emit('object:levelup') → сцена (тир/owned) + HUD (форс) ; цены обновятся на ближайшем tick.
3. Тик: GameLoop(dt) → доход + подписчики (раз в 5с) + автосейв(10с) → emit('tick') →
   UIManager: HUD + sheet.refresh().
4. Офлайн: конструктор Game → SaveManager.load → loadFromSnapshot → OfflineProgress → pendingOfflineModal → main показывает модалку.
5. Дебаг: debugPanel → публичное API Game + yandexService + ОДИН метод сцены
   (GameView.setObjectLabels — кнопка подписей объектов). В проде цепочки не существует.
6. Ассеты: npm run assets / Vite-плагин (art/ → public/assets + manifest.json) → AssetRegistry.init
   (манифест) → main.preload стартового набора (загрузочный экран) → GameView подменяет заглушки
   спрайтами; догрузки ленивые (onLoaded → refreshTextures), смена эпохи освобождает прошлый фон
   (release). LoadingAPI.ready() — только после прелоада (см. ASSETS.md).

---

## 4.1. Рецепты расширения

- **Новый объект:** одна запись в `objectDefs` (data/objects.ts) — карточка, цена, вкладка появятся сами;
  если объект рисуется на сцене — добавить tierNames, build-метод и ветку в GameView.applySceneState.
- **Новая группа (вкладка):** ключ в `ObjectGroup` (engine/types.ts) + записи в `groupMeta` и `groupOrder` (data/objects.ts).
- **Гейт ветки:** объекту поле `requires: ObjectId` — карточка сама покажет 🔒 и «Нужен: X».
- **Глобальный множитель (престиж/бустер):** в `GameState.recalculatePassiveIncome()` (P) и/или в getMoneyPerTap (A).
- **Новое событие:** тип в `GameEventMap` (engine/types.ts), emit в движке, подписка в UI/view — не напрямую.
- **Облачный сейв:** `yandexService.saveCloudData(state.toSnapshot())` — формат уже сериализуемый.
- **Новая мета-шкала (по образцу подписчиков):** константы в gameConfig.subscribers (или своя секция),
  состояние + кэши цели/награды в GameState, таймер в Game.tick, чип в UIManager + CSS.
- **Новая текстура (картинка или видео):** только файл — `art/<группа>/<стадия>.<ext>`; кода не
  касаемся, пайплайн и манифест всё сделают (ASSETS.md). Новая ГРУППА = запись в sceneAssets.json +
  строка в OBJECT_ASSET_GROUP (data/assets.ts) + спека/build-метод/ветка applySceneState (GameView).
- **Смена размера или числа стадий:** правится только `src/data/sceneAssets.json` (игра берёт боксы
  оттуда же, где пайплайн валидирует мастера) + перерисовать мастера.

---

## 5. Инварианты (нарушать нельзя)

1. Деньги/доход — ТОЛЬКО Decimal (break_infinity.js, default export). В числа — только в момент отображения (format.ts).
2. Уровни объектов живут в дефах (`ObjectDef.currentLevel`) — единый источник правды; сейв хранит Record<id, level> (v2).
3. Зависимости — только по стрелке из §4. Engine не знает про DOM/Pixi.
4. UI-оверлей: pointer-events:none на контейнере, auto — только на интерактиве.
5. Дебаг — только через `import.meta.env.DEV` + динамический import в main.ts. Ноль упоминаний @debug вне этого блока.
6. dt игрового цикла зажат (≤1с); «потерянное» время — только через OfflineProgress.
7. Экономика/баланс — только в data/gameConfig.ts и data/objects.ts, не в коде.
7b. Инвалидация кэшей потоков (cachedMoneyPerTap + passive) — ПОСЛЕ любого изменения уровней (GameState.invalidateCaches).
8. Hot path без аллокаций: пулы для «+1$», никаких new в тике/кадре.
9. Любая ошибка слушателя шины не должна ронять цикл (EventBus try/catch).
10. Ассеты: размеры/стадии — ТОЛЬКО из src/data/sceneAssets.json (единый источник для игры и
    пайплайна); текстуры попадают в сцену ТОЛЬКО через AssetRegistry по манифесту (никаких
    Texture.from(url) в GameView); папка public/assets/ генерируемая (руками не править), мастера —
    только в art/ (gitignored); нет ассета — остаётся заглушка (игра не падает и не гадает); видео —
    muted/playsinline/loop без контролов, 1–2 живых декодера максимум, освобождение через release();
    раскладка о текстурах не знает (подмена внутри buildRect/WorldLayer, API сцены не меняется).

---

## 6. Журнал решений (почему так)

1. **SDK грузится динамически и только в iframe.** Статический тег вне платформы ломал ввод:
   SDK переотправлял синтетические pointer-события (тап считался ~72 раза за клик) и шумел в консоли.
2. **Скользящая модалка оффлайна через `pendingOfflineModal` (+дубль подпиской).** Событие 'offline:income'
   эмитится из конструктора Game ДО подписки UIManager — поэтому main после сборки UI читает поле напрямую.
3. **Скрытая модалка = visibility:hidden + pointer-events:none.** Иначе её кнопка «Забрать» (opacity:0,
   но в layout) перехватывала клики по центру экрана — тапы по канвасу не работали.
4. **Форматирование: toFixed(2) для чисел <1000 + спец-случай 999.996→1K.** Без этого дроби вида
   66.1333000001 выглядели грязно, а 999.996 округлялся в «1000» без суффикса.
5. **Градиент фона через 2D-canvas→Texture,** а не шейдер/Geometry — совместимость со всеми сборками Pixi v8.
6. **Шторка позиционируется `bottom: var(--tabbar-h)`** с выездом `translateY(calc(100% + var(--tabbar-h)))` —
   иначе в закрытом состоянии её невидимые кнопки висели над центром экрана.
7. **Оптимизация тик-пути (аудит):** DOM-запись только при изменении (кэши shownLevel/shownAffordable),
   цена — только при смене уровня; refresh шторки — только когда она открыта; emit без копии массива;
   тап-доход кэшируется (Decimal-операции аллоцируют). Вызвано целью Zero-Allocation из CONTEXT.md.
8. **Экономика двух потоков A/P на вкладах-процентах** (рефактор по запросу владельца): оба потока =
   base × (1 + Σ weight·level·tierMult). Плюсы: флаг владения 0/1 получается сам (не куплен = вклад 0),
   скиллы/бусты — просто большой aWeight, тиры усиливают вклад без отдельной логики.
9. **Сейв v2 без миграции:** экономика сломана концептуально, старые сейвы несовместимы —
   новый ключ 'idle_tycoon_save_v2' (старый просто игнорируется).
10. **Эволюция x1.8 за тир, а не x2:** вклад растёт (×2), но процент за уровень ослабевает (×0.9)
   — по ТЗ «по ходу прокачки немного апается процент получения». Уровней в тире — 30 (прогресс-бар
   карточки; было 10 — решение владельца 2026-10-03). Сейвы при смене levelsPerTier не ломаются:
   уровень абсолютен, тир выводится из него.
11. **Подписчики: цель цикла ФИКСИРУЕТСЯ в момент старта (goal в SubscriberState, не кэш):**
   рост тапа в середине цикла цель не двигает — иначе чип «убегал» бы от игрока при активной прокачке.
   После claim: goal += goalMult × тап (цели растут накопленно), награда = rewardMult × тап на момент
   клейма (обе константы = 500). Дробная часть подписчиков — норма: поток дробный, копится в count;
   отображается formatCount.
12. **Нижнее меню/выноска — width:min(100%,420px) + left:50% + translateX(-50%):** по ТЗ панель
   не растягивается на широких экранах, всегда сжата к центру.
13. **Окно покупок — отдельная выноска, а не продолжение таб-бара** (по ТЗ со скрина): зазор 10px
   (bottom = tabbar-h + safe-area + 10px), скругление/тень со всех сторон, pop-анимация scale 0.96→1.
   Закрытие — opacity+visibility (НЕ выезд за экран, как у старой шторки): те же причины, что у
   модалки (Решение #3). Повторный клик по активной вкладке = toggle закрыть (как × на скрине).
   transform выноски — ТОЛЬКО translateX+scale (без translateY): не сломать центрирование.
14. **Сцена — композиция от центра; размеры объектов от экрана НЕ зависят** (по ТЗ владельца,
   уточнено после ревью): якоря (dx, dy, scale) от центра эталона 1120px. Scale — КОНСТАНТА
   плейсхолдера: ресайз меняет ТОЛЬКО положение (зум сцены удалён — сжимал объекты по x и y).
   Шире эталона: дрейф ≤60px (DRIFT_GAIN 0.25, доля |dx|/SCENE_MAX_DX) с заморозкой. Уже эталона:
   dx схлопывается фактором squeeze = w/1120 (тоже только позиция) — иначе крайние объекты
   уходят за край; размеры при этом не трогаются (возможны перекрытия — осознанный размен).
   Вертикальная посадка: cy = topFree + usable×0.46, где topFree = min(170, 24%h) (HUD с тремя
   рядами), bottomFree = 120 (таб-бар). Подписи дома/двора клампятся ниже HUD (labelTopLimit).
   Доли ширины (w*0.24) в layout запрещены. ГЛУБИНА: растительность (средний слой) — ПЕРЕД
   двором (за всем передним слоем), world.root — сразу за градиентом.
15. **3 слоя мира на единой лог-шкале totalEarned** (по ТЗ владельца): период = floor(log10(total)/
   2.5) — 12 периодов на весь забег (~10²⁵–10³⁰, до конца контента); растительность (средний слой,
   вокруг дома) меняется КАЖДЫЙ период, задний фон — каждый ВТОРОЙ (era = period/2, 6 эпох):
   схема bg0+veg0 → bg0+veg1 → bg1+veg2… (ТЗ: «в два раза чаще»). Пороги по логарифму, потому что
   экономика экспоненциальна (×100 за эпоху) — линейные пороги свалили бы все смены в первый час.
   Фон СТАТИЧЕН при ресайзе (вписка cover от центра эталона 1120×556, обрезка по краям) — не путать
   с законом сцены (решение #14): фон живёт в WorldLayer, растительность — В КООРДИНАТАХ СЦЕНЫ
   (за домом), подчиняется зуму/дрейфу. Метрика уже была: GameState.totalEarned (весь заработок
   за жизнь сейва) — новых полей сейва НЕ нужно, стадии — чистая функция от него (сейв-совместимо).
   Прогресс внутри периода — тоже в логах (frac), поэтому бар чипа идёт равномерно.
   GIF для фона отклонены (нет альфы, 256 цветов, CPU-декодинг): контракт — worldEraBackground(era)
   отдаёт путь без расширения, WorldLayer сам решает video это или картинка; рекомендованная пара
   MP4(+WebM для Chrome-вебвью) или статичный PNG/WebP — решается при появлении ассетов.
16. **Раскладка v2 «статика/динамика» (чертёж владельца) + центрирование 2026-09-30:** композиция
   ОДНА 1120×1505 (портретные ветки удалены); фон/двор/дом «статичны» = НЕ дрейфуют, но по X
   следуют за ЦЕНТРОМ ЭКРАНА на каждом ресайзе (в первой версии v2 X фиксировался на init — при сужении
   окна до мобильного соотношения дом/двор/фон уезжали вправо),
   игрок/машина/рабочее место — динамические (дрейф от центра на широких, squeeze на узких).
   Машина — ДИНАМИЧЕСКАЯ (по чертежу: красный контур + жёлтая стрелка; в старом тексте ТЗ была
   «статической как дом» — уточнено владельцем). Слой растительности СНЯТ с карты сцены (фазы
   остались в HUD/галерее — метрика totalEarned не тронута). Машина частично ПЕРЕД домом, двор
   за домом, фон дальний — перекрытия задуманы (текстуры с прозрачностью сделают стыки).
17. **Система текстур: папки-мастера → пайплайн → манифест → AssetRegistry (2026-09-30, ASSETS.md).**
   Задача владельца: он рисует текстуры — они сами встают в сцену, без правок кода и раскладки;
   картинки и видео работают одинаково. Решения:
   (1) КОНТРАКТ ИМЁН: `art/<группа>/<стадия>.<ext>` — папка = объект, имя = номер стадии,
   расширение = формат (png/webp/jpg/avif/gif → картинка, mp4/webm/mov/m4v → видео). Стадия без
   файла берёт ближайшую МЛАДШУЮ: один `0` закрывает все тиры/эпохи (иначе первые текстуры
   выглядели бы «дырами» на старших стадиях). Один файл на стадию: два формата сразу — ошибка сборки.
   (2) ЕДИНЫЙ ИСТОЧНИК РАЗМЕРОВ: src/data/sceneAssets.json — читают и игра (боксы заглушек/спрайтов),
   и пайплайн (валидация аспекта, кап вывода, стадии, бюджеты). В GameView размеры больше не
   дублируются (sceneBox берёт из JSON).
   (3) ПАЙПЛАЙН scripts/build-assets.mjs (sharp в devDependencies, в бандл игры не входит): WebP
   q82/alpha100, кап w×h×maxScale без увеличения, видео — копия как есть (sharp не умеет видео; перекодирование —
   зона владельца; проверяются faststart и расширение), хеш-имена от содержимого И настроек,
   manifest.json пишется только при изменениях (нет git-шума), чистка устаревшего, весовой отчёт и
   ХАРД-бюджеты (90 МБ папка, 15 МБ стартовый набор; превышение = exit 1). Вес считается по диску,
   а не только по манифесту.
   (4) АВТОМАТИКА: scripts/vite-plugin-assets.mjs — в dev следит за art/ (chokidar Vite),
   пересобирает и делает full-reload; в build прогоняет сборку до копирования public/ в dist.
   Плагин никогда не валит dev/build: проблемы — только в консоль.
   (5) РАНТАЙМ view/assetRegistry.ts: манифест (fetch no-cache; нет/битый → пусто), resolveKey с
   откатом вниз, texture() НЕ ждёт (кэш → Texture, иначе запуск загрузки + null; onLoaded →
   GameView.refreshTextures), release для памяти. Картинки — штатный Assets Pixi, видео —
   VideoSource со скрытым <video> (muted+playsinline+loop, без контролов — требование 1.6.2.5),
   ретрай автоплея по первому жесту, release закрывает декодер.
   (6) ЗАГРУЗОЧНЫЙ ЭКРАН (ui/BootScreen.ts + #boot-screen + стили): main грузит стартовый набор
   (фон текущей эпохи + тело игрока + все купленные объекты их стадий) ДО LoadingAPI.ready() —
   платформа видит уже одетую игру.
   (7) СЦЕНА: Map visuals → RectVisual (спрайт + заглушка + метка + запрошенная стадия + appliedKey);
   при появлении текстуры прямоугольник и подпись гаснут; стадия ставится по тиру (у дома ПОЯВИЛАСЬ
   ветка в applySceneState — раньше видимость дома не трогалась и тир не переключался), фон — по
   эпохе (WorldLayer.setTexture; cover теперь считается по РАЗМЕРУ ТЕКСТУРЫ, а не по эталону: фон
   любого аспекта закрывает экран без растяжения; applyStage удалён). Build.assetsDir вынесен в
   'bundle/', чтобы dist/assets/ был ТОЛЬКО текстурами.
   Проверено вживую (dev 5051): картинки (house/0, world/0, character/0) встают на сцену, подписи
   гаснут; дом 0→10 уровней меняет текстуру на house/1; world/0.mp4 играется (VideoSource, muted,
   loop, currentTime идёт), смена эпохи (totalEarned 1e6) подменяет фон на world/1.png и УДАЛЯЕТ
   видео-элемент из DOM (release); без манифеста — чистые заглушки и чистая консоль; пайплайн
   ловит конфликт форматов и занятый файл (EBUSY), печатает отчёт и бюджеты; tsc + vite build зелёные,
   dist без debug-утечек.

---

## 7. Грабли (уже наступали)

0. **confirm()/alert() недоступны в вебвью платформы** — в UI только инлайн-подтверждения
   (в дебаг-сбросе: два клика с таймаутом 3с).
0b. **Decimal не экспортирует именованный Decimal** — только default: `import Decimal from` / `import type Decimal from`.

1. **Не убивать все node-процессы** (`taskkill //IM node.exe`) — только конкретный PID порта:
   `pid=$(netstat -ano | grep :5173 | grep LISTENING | awk '{print $5}' | head -1); taskkill //F //PID $pid`.
2. **beforeunload-сейв перезаписывает инъекцию в localStorage при перезагрузке** — для тестов офлайна
   сначала `game.saveNow = () => {}`, потом инъекция + location.reload() в одном выражении.
3. **HUD троттлится и кэшируется** — при ручных манипуляциях со state в консоли дёргай `game.handleTap()`
   для принудительной перерисовки. То же с подписчиками: выставлять claimable напрямую в state бесполезно —
   UI узнаёт только через события (штатный путь: догнать тапами до кратного 5).
4. **break_infinity.js — default export:** `import Decimal from 'break_infinity.js'`, НЕ `{ Decimal }`.
5. **Пишущие инструменты могут вставлять мусор в файлы** — после записи читать файл и проверять целостность.
6. **Автосейв каждые 10с** — правки state «протухают», если игра продолжает тикать в фоне теста.
7. **Windows держит сгенерированный ассет, пока его отдаёт dev-сервер** — `npm run assets` не может
   удалить устаревший файл (EBUSY: resource busy or locked). Это не ошибка: скрипт оставит файл,
   напишет note и удалит его следующим прогоном (после перезапуска dev-сервера); манифест на такой
   файл не ссылается.
8. **Shebang (`#!`) в скриптах, которые импортирует vite.config, ломает esbuild** — `#!` внутри
   бандла конфига = `Syntax error "!"`; поэтому scripts/build-assets.mjs без шебанга (запуск всегда
   через `node scripts/...`).
9. **Vite dev отдаёт index.html на несуществующий путь (SPA-fallback)** — «есть ли манифест» нельзя
   проверять по HTTP-статусу: годен только успешный JSON-парсинг (иначе 200 + HTML).

---

## 8. Проверки и команды

```bash
npm run dev         # http://localhost:5050 (дебаг-панель: ~ или точка в углу); сам следит за art/
npm run build       # tsc --noEmit && vite build (ассеты обновляются до копирования public/)
npm run typecheck   # только типы
npm run assets      # собрать текстуры из art/ + отчёт + проверка бюджетов (exit 1 при ошибке)
npm run assets:watch# то же в режиме слежения за art/ (F5 руками)
# zero-leakage дебага:
grep -rl "debug-panel\|setupDebugPanel\|window.game" dist/   # должно быть пусто
```

Смоук-сценарий после правок: тап по канвасу («+1.05$», баланс растёт) → вкладка «Имущество» → покупка
объекта (уровень+, вклад в потоки, при тире — смена стадии на сцене) → вкладка «Навыки» (🔒 до камеры) →
инъекция сейва 2ч назад + reload → модалка офлайна с суммой → закрыть → всё кликабельно.

---

## 9. Роадмап / бэклог

- [ ] Престиж (сброс за постоянный множитель; точка расширения: recalculatePassiveIncome/getMoneyPerTap)
- [ ] Rewarded-бустер x2 на N минут (yandexService.showRewardedVideo уже готов)
- [x] ~~Текстуры/видео сцены~~ — сделано 2026-09-30 (Журнал #17, инструкция ASSETS.md):
  art/ → npm run assets → public/assets + manifest.json → AssetRegistry; картинки и видео на равных,
  стадии по тирам, эпохи фона, загрузочный экран до LoadingAPI.ready(). Владельцу осталось нарисовать
  и залить сами файлы (размеры и папки — ASSETS.md §2).
- [ ] Многослойные фоны двора/рабочего места (задумка владельца): сейчас у группы один слой —
  расширять новыми группами в sceneAssets.json (без правки пайплайна).
- [x] ~~Ветвь «Рабочее место» на сцене~~ — сделано (плейсхолдеры camera/furniture/pc)
- [ ] Облачные сейвы Яндекса (заготовки saveCloudData/loadCloudData уже есть)
- [ ] Unit-тесты экономики (vitest): цены, гейты, тиры, офлайн, снапшоты v2
- [ ] Баланс-ревизия v2: веса и цены выровнены (первая покупка 100$ везде), но прогон доиграбельности
  (первые 15–20 минут) не сделан: темп роста P/A, стоимость навыков по цепочке гейтов, порог скуки

---

## 10. Журнал изменений карты

<!-- Актуально после рефактора механики A/P-потоков (см. последнюю запись журнала). -->
- 2026-09-26 — Карта создана; структура соответствует коммиту-скелету (v0.1.0) + фикс форматирования чисел <1000.
- 2026-09-26 — README.md удалён: команды → §8, рецепты расширения → §4.1, архитектура — §3–§5.
- 2026-09-26 — Полный аудит кода: Zero-Allocation в тик/тап-пути (кэш тапа, emit без копии,
  DOM только по диффу, refresh только открытой шторки), таймауты yandex-init (5с)/загрузки SDK (7с),
  инлайн-подтверждение сброса в дебаге (confirm заблокирован в вебвью), touch-action: manipulation,
  сброс вынесен в GameState.resetProgress, убраны мёртвые import Decimal/GameEventName.
- 2026-09-26 — РЕФАКОР МЕХАНИКИ: экономика двух потоков A/P на вкладах-процентах; 12 объектов
  с тирами, startLevel 0|1 (флаг владения), гейты requires (Навыки: комп→харизма→эмоция→юмор);
  upgrades.ts → objects.ts, UpgradeSheet → ObjectSheet; HUD с двумя строками потоков;
  сейв v2 ('idle_tycoon_save_v2'); событие object:levelup; GameState.applyLevels.
- 2026-09-27 — МЕНЮ КАРТОЧЕК: схема «иконка+имя / прогресс-бар / кнопка»; эволюция каждые 10
  покупок (levelsPerTier 5→10); вклад тира ×2, но процент за уровень ×0.9 за тир (итог x1.8 —
  GameState.tierWeightMult); стадии тачки переписаны под 10 ур (Велик/Лада/Ламба); прогресс-бар
  и его подпись обновляются только при смене уровня (Zero-Allocation сохранён). Проверено:
  бар 7/10→70%, эволюция дома ур.10 → «Комната», P-математика тира 1.8×.
- 2026-09-27 — HUD + ПОДПИСЧИКИ: HUD перестроен на чипы (слева «$ Всего» = текущий баланс,
  «$/сек» = пассив; строка «A:» убрана); справа чип subscr. с прогресс-баром: прирост раз в 5с
  = пассив за интервал + каждый 5-й клик = доход за клик; цель 1000×, награда 100× от дохода
  за клик; claim по клику на чип (пульс, subscribers:ready/changed). Нижнее меню и шторка
  сжаты к центру (min(100%,420px), left:50%, translateX(-50%)). Сейв: subscribers опционален
  в snapshot v2 (старые сейвы v2 валидны). События subscribers:changed/ready. Проверено:
  математика цели/награды/бонуса, нативный claim, центрирование при 1280px, сейв-раундтрип.
- 2026-09-27 — ВЫНОСКА ПОКУПОК: шторка → плавающее окно над меню (зазор 10px + safe-area,
  скругление/тень, pop scale 0.96→1, закрыта = opacity+visibility); toggle — повторный клик
  по активной вкладке закрывает; подсветка вкладки только при открытом окне; ширина как у меню
  (min(100%,420px)). Проверено: toggle, переключение вкладок, closed-hittest (elementFromPoint =
  CANVAS), геометрия (та же ширина/центр, зазор над панелью).
- 2026-09-27 — РЕБАЛАНС ПОТОКОВ (fix по фидбеку): раскладка весов была ЗЕРКАЛЬНОЙ замыслу —
  теперь по канону: Имущество+Шмот → ПАССИВ (pWeight 0.10–0.15, aWeight ~0.02–0.04),
  Рабочее место+Навыки → ТАП (aWeight 0.15–0.25/0.5–1.0, pWeight 0.03 или 0). Базы цен
  выровнены на 100$ (были 75–25 000$), costGrowth везде 1.35 (навыки 1.5 — плата за гейт).
  Подписчики: goalMult 1000→500 (цель = 500×тап). Проверено вживую: вклад тачки P +0.06/A +0.04,
  техники A +0.15/P +0.015, харизма A ×1.35; все первые цены 100$ в DOM; ratio цели = ровно 500.
- 2026-09-27 — ДЕБГ-КНОПКА «Тап = 1000$ (форс)»: GameState.setTapOverride/isTapOverridden
  (форс активного потока для проверки поздней экономики; invalidateCaches — цель/награда
  подписчиков пересчитываются; resetProgress снимает форс). Кнопка-переключатель с классом
  .active-forced (жёлтая). Проверено: A=1000, цель 500К, тап +1000.00, снятие, связка со сбросом.
- 2026-09-27 — ПОДПИСЧИКИ v2 (fix по фидбеку): цель цикла фиксируется в момент старта и живёт
  в SubscriberState.goal (кэши от тапа удалены); рост тапа в середине цикла цель НЕ меняет;
  после claim новая цель = старая + 500×тап (накопленный рост); награда = 500×тап на момент
  клейма (rewardMult 100→500). Сейв: поле goal опционально (0 = ленивый перефикс). Проверено:
  фикс 515 при росте тапа ×100, клейм 50 000$, новая цель 50 515, перефикс после снятия форса.
- 2026-09-27 — HUD 2×2: верхняя панель собрана в центральный блок (как нижнее меню:
  width:min(100%,420px), left:50%, translateX(-50%)); ячейки: пассив /сек (зелёный),
  $ всего, за клик (жёлтый), подписчики+бар (кнопка клейма). Дебаг-панель перенесена
  влево-вверх (сбоку от HUD), при <700px компактнее. UIManager слушает game:reset
  (принудительный рендер — фикс устаревшего чипа после сброса). Проверено: центр/420px на 632px
  и 1280px, сетка 2×2 (197px×2), клейм реальным кликом (+515$), сброс обновляет чип.
- 2026-09-27 — СЦЕНОВЫЕ ПЛЕЙСХОЛДЕРЫ (временные, до спрайтов): двор (yard, перекрестье →
  тинты пустырь/асфальт/паркет), рабочее место (tech — камера на штативе, pc — монитор,
  furniture — стул; видимость по owned, тир через tint),  носимые на персонаже (watch —
  часы на запястье, face — улыбка (УСТАРЕЛО: теперь hair — причёска, см. журнал 2026-09-29),
  clothes — цепь; syncWornPositions в layout+update;
  УСТАРЕЛО: теперь worn — дети character, см. журнал 2026-09-28).
  tierNames добавлены для 7 объектов. Ветки applySceneState переведены на switch +
  toggleStageLabel. Проверено: Unlock all lvl 1 и lvl 11 без ошибок в консоли.
- 2026-09-27 — ФИКС НЕОТОБРАЖЕНИЯ (двор/шмот/рабочее место): причина №1 — tierNames были
  только в словаре TIER_STAGES, но не привязаны к дефам, а buildSceneState фильтрует по
  tierNames !== undefined → объекты не попадали в applySceneState. Привязаны.
  Причина №2 — applyLevels/loadFromSnapshot не эмитили object:levelup, сцена не обновлялась
  после Unlock all/загрузки сейва. Добавлено событие objects:changed (emit в applyLevels и
  loadFromSnapshot), main слушает его рядом с object:levelup. Раскладка сцены: тачка выше
  (0.16/0.68), рабочий ряд ниже и без наложений (tech 0.30 / furniture 0.47 / pc 0.80),
  цепь шмота толще + кулон. Проверено скриншотами: все 9 объектов видны, подписи на местах.
- 2026-09-27 — ФИКС СБРОСА: resetProgress теперь тоже эмитит objects:changed — сцена
  скрывает все купленные объекты при сбросе сейва (проверено скриншотами: после сброса
  только дом + персонаж без носимых).
- 2026-09-27 — ЯЧЕЙКА ПОДПИСЧИКОВ: надпись «подписчики» → иконка 👤, счёт уплотнён
  (13.5px, flex+right) — «N / цель» влезает целиком (скриншот). clickBonusEvery 5→1:
  подписчики капают за КАЖДЫЙ клик (проверено: 5 тапов = +5.15 ровно).
- 2026-09-27 — РАБОЧЕЕ МЕСТО: tech переименован «Техника» → «Микрофон» (иконка 🎙️, стадии
  Микрофон/Студийный/Золотой), плейсхолдер перерисован с камеры на микрофон на стойке.
  Порядок на сцене и в карточках шторки: стул → монитор → микрофон (furniture, pc, tech
  переставлены в objectDefs и в layout: 0.26/0.47/0.68). Проверено скриншотом сцены
  (Табурет→Ноут→Микрофон) и порядком карточек.
- 2026-09-27 — ФИКС ЯЧЕЙКИ ПОДПИСЧИКОВ v2: счёт и цель — РАЗНЫЕ элементы (sub-count/sub-goal
  вместо одной строки с ellipsis, которая ломала цель); sub-top justify-content:flex-start —
  текст прижат к иконке 👤 (зазор 4px), не растягивается по ячейке на широких экранах;
  в claimable цель скрывается, вся строка — «Забрать N$». Проверено на 632px и 1280px,
  счёт 98.77K + цель целиком, без переполнений.
- 2026-09-27 — ЗАКОН РАСКЛАДКИ СЦЕНЫ: GameView.layout переписан с долей ширины (w * 0.24 и
  т.п.) на КОМПОЗИЦИЮ ОТ ЦЕНТРА — якоря (dx, dy, scale) от центра эталонного мокапа
  1120×556 (SCENE_REF_WIDTH; дом/двор dx=0 — всегда строго по центру). Экран УЖЕ эталона →
  вся сцена сжимается равномерным зумом (sceneScale = w/1120, пол SCENE_MIN_SCALE 0.34):
  взаимное расположение объектов не меняется никогда. Экран ШИРЕ → масштаб замораживается
  на эталонном, объекты дрожат от центра на drift = min(extra×DRIFT_GAIN 0.25,
  DRIFT_MAX_TOTAL 60px), доля дрейфа пропорциональна |dx|/SCENE_MAX_DX — «красные линии»
  мокапа (коридоры ~50–65px). Побочно синхронизированы масштабы персонажа с сценой
  (charBaseScale: squash-эффект и idle возвращаются к базе, а не к 1; носимые и их офсеты
  зумятся) и подписи стадий (floor офсета, чтобы не слипались при малом зуме). Якоря:
  кар −382/75, табурет −265/174, ноут −38/172, микрофон 197/190, персонаж 135/56,
  дом 0/−62, двор 0/−60. Проверено скриншотами: 1120×556 (соответствие мокапу), 1400×556
  (дрейф = ровно 60px у тачки, заморожен), 390×780 (композиция сжата к центру), 1280×800.
- 2026-09-28 — ДЕБГ-ПАНЕЛЬ v2 + УПРОЩЕНИЕ ПЛЕЙСХОЛДЕРОВ МИРА: «+1M$» → «+ Деньги» с полем
  суммы (геологическая нотация 1e6/2.5e15/1e623, разбор new Decimal, ошибки — в консоль);
  «Тап = 1000$ (форс)» → поле + переключатель «Тап = форс» (подпись активного состояния
  показывает сумму: «Тап ВКЛ: 100K$»); Fullscreen-тест УДАЛЁН (в mock был чистый no-op —
  wasShown=true через 0.4с, геймплейного эффекта ноль; вернём при интеграции в геймплей);
  Rewarded-тест оставлен и получил видимый фидбек (flashBtn: инлайн-подтверждение +10 000$
  на кнопке 2с — alert в вебвью недоступен, Грабли #0). Плейсхолдеры мира упрощены под
  будущие текстуры (запрос владельца): фон = сплошной цвет эпохи (была палитра с силуэтами
  горизонта), растительность = один прямоугольник за домом, зеленеющий с периодом (были
  кусты/деревья). Проверено вживую: +5e7 → баланс 50M, эпоха Окраина; форс 1e5 → тап
  100K$/клик, снятие повторным кликом; Rewarded → +10K$ и фидбек на кнопке; grep dist чист.
- 2026-09-28 — ФИКС ГЛУБИНЫ И ЗАКОНА РАСКЛАДКИ (по ревью владельца): (1) растительность была
  НАД передним слоем (addChildAt по индексу house+1) — переставлена ПЕРЕД двором
  (getChildIndex(yard)): средний слой строго за домом/тачкой/персонажем. (2) Зум сцены УДАЛЁН:
  scale больше не умножается на sceneScale — ресайз НЕ уменьшает объекты ни по x, ни по y
  (scale — константа якоря, меняются только позиции). charBaseScale/носимые/подписи — тоже
  константы. (3) На узких окнах dx схлопывается (squeeze = w/1120) + вертикальная посадка cy
  между HUD и таб-баром (иначе дом уезжал под HUD с тремя рядами). (4) Подписи дома/двора
  клампятся ниже HUD (labelTopLimit = topFree + 34). Проверено скриншотами 1120/1400/700×556:
  размеры дома/персонажа идентичны на всех ширинах, тачка не уходит за край, глубина верна.
- 2026-09-28 — ДЕБГ-ПАНЕЛЬ v3: (1) встроенный список логов (новые сверху, 60 строк,
  ок/warn-цвета, дубль в консоль через единый log()); (2) «+1 lvl всем» — уровень +1 у
  КАЖДОГО объекта (не только разблокировка на 1); (3) скорость x1 ВЫБРАНА при старте панели
  (раньше подсветки не было); (4) Rewarded-тест УДАЛЁН полностью (юзлес в mock); (5) деньги:
  кнопка «Добавить» + множители ×10/×100 к полю, суммы в ЧЕЛОВЕКОЧИТАЕМОЙ нотации
  (1M/2.5B/1e623 — parseDebugAmount понимает суффиксы format.ts и экспоненту);
  (6) «↩ Отменить» — undo-стек (LIFO, 25 шагов, подпись последнего действия на кнопке):
  деньги откатываются полностью (money + totalEarned, с полом от startingMoney/0),
  уровни — через applyLevels(before); Game.refreshAfterDebug() — пересинхронизация
  мира/HUD после прямых мутаций state. Сброс сейва чистит undo-стек.
- 2026-09-28 — ДЕБГ-ПАНЕЛЬ v4 (раскладка по скетчу владельца): две группы с подписями —
  «Баланс» и «Per second», каждая [поле|×10|×100|$] ($ = применить; для тапа это тумблер
  вкл/выкл, жёлтая подсветка active-forced); ниже: Отменить, +1 lvl всем, скорость x1/x5/x10
  (x1 предвыбрана), Сброс (двойной клик), большая область логов (min-height 96px).
- 2026-09-28 — 3 СЛОЯ МИРА + ЧИП ЭПОХИ: новая метрика прогресса — totalEarned (уже был в модели/
  сейве, новых полей не нужно). data/worldStages.ts (STEP 2.5, 12 периодов, имена 6 эпох фона +
  12 фаз растительности, контракты путей ассетов), engine/WorldProgress.ts (calcWorldStage +
  WorldWatch — аллокация стадии только на смене), событие world:changed (emit из Game.tick /
  loadOrInit / resetAll), view/WorldLayer.ts (фон-cover 1120×556 + 12 фаз растительности вокруг
  дома в координатах сцены, за домом по глубине), GameView.applyWorldStage + растительность в
  layout за домом, ui/EraPopup.ts (галерея эпох с порогами) + чип эпохи в HUD (третья строка
  блока 2×2, глоу на смене). Проверено вживую: +1M$ → Окраина/Молодые посадки (чётный период —
  смена фона+растительности), 32M$ → период 3 (нечётный: фон остался), сброс → Пустошь/период 0,
  галерея с порогами (100K$/10B$/1aa$…) и прогрессом 55%. Тип-чек/build/grep dist — зелёные.
  Грабли-добавка: rAF-цикл стоит в фоновой вкладке — смена стадии не эмитится, пока вкладка
  не отрисована (это ок для игры, но при отладке не дёргать worldWatch.update() руками —
  он проглотит следующий emit).
- 2026-09-28 — ШМОТ ПРИКРЕПЛЁН К ТЕЛУ: syncWornPositions() удалена; worn (watch/face/clothes,
  сейчас watch/hair/clothes)
  теперь ДЕТИ контейнера character (addChild в buildWorn после частей тела → рисуются
  поверх), локальные офсеты заданы один раз: watch (30, 66), hair (0, −6; раньше face), clothes (0, 30),
  scale.set не нужен — наследуют масштаб персонажа (charBaseScale остался для squash/возврата).
  При idle-покачивании и squash шмот движется вместе с телом структурно, а не синхронизацией.
  Проверено вживую на 1120px: часы/лицо/цепь сидят на теле при покачивании.
- 2026-09-28 — КАРТОЧКИ ОБЪЕКТОВ ВЛЕЗАЮТ ВСЕГДА: компоновка карточки ObjectSheet
  перебрана — имя (def.name) и вклад в доход объединены в одну flex-строку .card-top
  (имя слева с ellipsis + min-width:0, доход справа в компактной форме «+0.1$/т +0.25$/с»
  с flex-shrink:0 и title-подсказкой «т — за тап, с — в секунду»); подпись бара —
  короткая «ур. N · Стадия» (доход больше не дублируется в ней); при max — «ур. N · Стадия»
  вместо incomeInfo. CSS: .card-top flex, nowrap+ellipsis у name/label, кнопка min-width
  108→86px + max-width:40vw, иконка 50→40px, media ≤360px — доп. ужатие (padding/gap,
  иконка 36px, кнопка 76px). Ничего не вылезает: на 320px имя схлопывается в ellipsis,
  цифры и кнопка всегда целы. Проверено вживую: 320px/375px/1120px, переполнений 0.
- 2026-09-29 — «ЛИЦО» → «ПРИЧЁСКА» (замена объекта ветки «Шмот» по решению владельца):
  ObjectId 'face' → 'hair' (types.ts), деф face → hair (objects.ts: имя «Причёска», иконка 💇,
  desc «Причёска решает», стадии Кудри/Ирокез/Косички; веса/цены/гейт house — БЕЗ изменений),
  GameView: worn-плейсхолдер «улыбка» → кудри над головой (0, −6, тот же офсет), case 'hair'.
  МИГРАЦИЯ СЕЙВОВ: loadFromSnapshot маппит 'face' → 'hair' (старый прогресс не теряется;
  маппинг оставить навсегда — фильтра по дате нет). Баланс не менялся.
- 2026-09-29 — КОЛЬЦО ПРОГРЕССА + НАСТРОЙКИ (модернизация верхнего меню по мокапу
  владельца): (1) прогресс игрока вынесен из чипа в КРУГ .world-ring слева сверху — SVG-дуга
  (rotate −90°, старт сверху) + % внутри, красный как в мокапе; (2) ПОЧЕМУ процент «стоял»:
  WorldWatch кэширует stage на весь период, eraProgress не пересчитывался между сменами —
  добавлена worldProgressFrac() (живая дробь периода из totalEarned, только примитивы);
  кольцо обновляется ~12 раз/с (свой троттлинг), DOM — только при смене целого процента;
  чип эпохи теперь считает % из той же живой дроби (текст ходит синхронно с кольцом);
  клик по кольцу — EraPopup (как раньше у чипа; окно будет продумано позже). (3) Кнопка
  настроек ⚙ справа сверху — ЗАГЛУШКА под будущие графику/звук. На <584px виджеты мельчают,
  HUD сжимается между ними (media-блок в styles.css). corner-dot дебага сдвинут вниз —
  не налезает на настройки. Проверено вживую (dev-сервер 5050): 1000×500 и 375×667 без
  перекрытий (getBoundingClientRect), живой пересчёт 8%→11% после +20% totalEarned,
  дуга/оффсет совпадают с формулой; tsc+build зелёные.
- 2026-09-30 — СИСТЕМА ПОКУПКИ (по ТЗ владельца): (1) ЗАЖАТИЕ КНОПКИ — серия покупок: пауза
  420мс до первого повтора (юзер успевает отпустить после ОДНОЙ покупки), шаги по 120мс, после
  12 повторов 70мс; отпускание/уход курсора/смена вкладки/режима/закрытие выноски мгновенно гасят
  серию. Само нажатие НЕ покупает: одиночная покупка идёт на click (работает с клавиатуры), а после
  серии лишний click отсекается флагом holdFired — двойной покупки нет (проверено: клик = ровно +1
  уровень, серия 1.5с = 9 уровней, лишней покупки нет). (2) РАДИО РЕЖИМА сверху выноски
  (role=radiogroup, аналог Qt RadioButton): 'one' — один уровень за действие, 'tier' —
  «НА ВСЕ ДЕНЬГИ»: максимум доступного, но НЕ дальше конца текущего грейда (по решению владельца
  при избытке денег останавливаемся на ближайшем грейде) — прогресс-бар обнуляется, стадия
  обновляется. В 'tier' подпись кнопки = цена всей пачки и «×N» (дом и тап: 2 → 10 за 1.36K$,
  бар 0%, стадия «Комната»), пересчёт по троттлингу 15 тиков. Движок: BuyMode (types.ts),
  GameState.getBuyPlan/buyUpgradeBulk (одна инвалидация кэшей и одно списание на пачку),
  Game.buyObject(id, mode) с одним 'object:levelup' на пачку. Проверено: tsc + build зелёные,
  консоль чистая, узкий экран 420×860.
- 2026-09-30 — ФИКС РАСКЛАДКИ + ГЕОМЕТРИЯ СТОПОК (по замечаниям владельца к прямоугольникам):
  (1) ЦЕНТРИРОВАНИЕ СТАТИКИ: дом/двор/фон пересаживаются по X на КАЖДОМ ресайзе (GameView.layout
  ставит x = w/2, а не один раз при init; WorldLayer.layout пересчитывает cover + центр) — раньше
  при сужении окна до мобильного соотношения они «уезжали» вправо. (2) IDLE СНЯТ (временно): у группы
  игрока убраны покачивание по Y и наклон (поля time/charBaseY удалены, остался только сквиш при
  тапе); разъезд по ширине окна остался — это раскладка, не анимация. (3) ГЕОМЕТРИЯ СТОПОК:
  причёска/одежда/часы КОНГРУЭНТНЫ игроку — 330×690, часы на 20px выше; рабочее место — три
  конгруэнтных слоя 350×300 в ОДНОЙ точке (WORKPLACE_ANCHOR: стол был +30 вправо, центр по Y
  не сдвигали → верх поднялся сам на 25px из-за роста высоты 250→300), глубина приведена к чертежу
  (мебель → микрофон → комп). Подписи стопок разносятся колонкой (RectSpec.lift, шаг 27px).
  (4) ЦВЕТА СЛОЁВ ГРУПП (владелец 2026-09-30): игрок красный, причёска зелёная, одежда синяя,
  часы фиолетовые; мебель оранжевая, микрофон бирюзовый, комп жёлтый. Т.к. слои группы совпадают
  по площади ровно, к цветам добавлены ВЛОЖЕННЫЕ рамки (RectSpec.inset — визуальный отступ внутрь,
  заливка 0.15): без них 3–4 совпадающих прямоугольника дали бы одно смешанное пятно, видно было
  бы только верхний. Истинный размер всегда даёт внешняя рамка группы и подпись «W×H».
  (6) ГРУППА ИГРОКА ПЕРЕДЕЛАНА (чертёж крупным планом от владельца): причёска и одежда —
  ДВЕ ПОЛОСЫ ВСТЫК, а не совпадающие боксы: причёска 330×240 (верхняя полоса, борта в верхний/
  левый/правый игрока), одежда 330×450 (нижняя, верх = низ причёски, низ = низ игрока), часы
  150×215 — прижаты к левому борту игрока, верх на 15px ниже стыка полос. Механизм вложенных
  рамок RectSpec.inset УДАЛЁН полностью (в коде он больше не нужен, геометрия заглушек теперь
  всегда истинная). Подписи: lift 26 у причёски и 11 у одежды — только чтобы не слипались с
  подписями игрока и часов.
  (5) РАБОЧЕЕ МЕСТО ПЕРЕДЕЛАНО (владелец 2026-09-30): у трёх слоёв ОДНА геометрия 350×460
  (было 300 — «должны быть выше по высоте»; вложенные рамки сняты, из-за них слои выглядели
  разными размерами — inset остался только у группы игрока), и группа больше не садится на центр
  композиции: она СТОИТ НА ПОЛУ — низ FLOOR_GAP = 8px над нижним краем окна (владелец:
  «начинаться от пола… около 5–10 пикселей от нижней границы»). X не менялся (WORKPLACE_DX 310 +
  дрейф группой). На эталоне 1120×1300 это бокс x 695…1045, y 832…1292.
  (7) РАЗМЕРЫ ДОМА И МАШИНЫ (владелец 2026-09-30): дом 740×620 → 370×620 — «слишком широкий,
  должен целиком помещаться при окне телефонного размера» (высота не менялась, только уже);
  машина 290×190 → 340×240 (+50px к ширине и высоте) + якорь CAR_ANCHOR.dx 230 → 150 —
  «на ПК очень далеко от центра» (побочно упала доля дрейфа |dx|/400 — на широких окнах
  машина отъезжает меньше). Оба числа живут в sceneAssets.json и пайплайном же валидируются.
  Проверено вживую (dev 5051): 1400×700 → 620×1000 → 390×780 — метка дома/двора стоит по центру
  каждого окна (700/310/195), фон закрывает экран и тоже центрирован, динамика дрейфует на широком и
  сжимается на узком; два кадра подряд — позиции меток группы игрока совпадают (idle нет); тап даёт
  «+N$» (и клейм-бар подписчиков); консоль чистая; tsc + vite build зелёные; dist без debug-утечек.
  ТАБЛИЦА РАЗМЕРОВ ТЕКСТУР на 2026-09-30 (ЗАМЕНЕНА 2026-10-03, см. запись в конце журнала):
  фон 1120×1505, двор 1080×910, дом 370×620,
  игрок 330×690, причёска 330×240 (верхняя полоса игрока), одежда 330×450 (нижняя полоса),
  часы 150×215 (слева вплотную), машина 340×240, мебель/микрофон/комп — один холст 350×460
  (стоят на полу). Причёска и одежда вместе ровно закрывают игрока — холсты совпадают с его
  полосами, борта стыкуются без зазоров и нахлёстов.
- 2026-09-29 — СЦЕНА НА ПРЯМОУГОЛЬНИКАХ (переборка визуала по чертежу владельца, этап 1–2
  подготовки к своим текстурам): ВСЕ Graphics-фигуры сценовых объектов удалены (дом/тачка/двор/
  техника/персонаж/носимые были наборами фигур) — вместо них ПРЯМОУГОЛЬНИКИ-ЗАГЛУШКИ (buildRect:
  fill alpha 0.55 + stroke в цвете чертежа) с метками «N · ИМЯ · W×H» (номера и размеры — с
  чертежа; владелец снимает размеры будущих текстур прямо со сцены). Тинты-перекраски по тиру и
  подписи стадий УДАЛЕНЫ (до текстур тиры визуально ничего не меняют; stageName остаётся в
  карточках). Носимые (hair/clothes/watch) — прямоугольники-дети игрока. МЕТКИ статики клампятся
  под HUD (clampMarkerTop), метка фона — в левом-нижнем углу с клампом в окно. Эталон композиции
  1120×1505 (SCENE_REF) — весь чертёж; портретная ветка PORTRAIT_* и dyScale УДАЛЕНЫ (одна
  композиция на все ориентации, решение владельца: статика может обрезаться краем окна).
  Закон раскладки v2: статика (фон/двор/дом) — X намертво, Y за центром композиции
  (topFree=min(170,24%h)+usable×0.46); динамика (игрок −240/+215, машина +230/+35, рабочее
  место группой +200) — drift потолок 190px (был 60), squeeze как раньше. WorldLayer: фон —
  ОДИН прямоугольник 1120×1505 (WORLD_REF_H 556→1505), cover ОДИН РАЗ при init, дальше
  заморожен; перекраска по эпохе убрана (applyStage no-op, контракт сохранён); растительность
  (vegByPhase/vegetationRoot) удалена из view — фазы живут в HUD/галерее. worldStages.ts:
  worldVegetationKey удалён (мёртвый контракт). Проверено вживую (dev 5051): эталонные
  1120×1505 / широкие 1400×700 (статика на месте, динамика отъехала, потолок 190px) / узкие
  390×780 (squeeze к центру); консоль чистая; тапы дают «+N$»; покупки (тачка/двор) появляются
  на сцене; сброс сейва скрывает всё купленное; +1 lvl всем включает все 12 объектов без ошибок.
  tsc + vite build зелёные. Таблица размеров текстур: фон 1120×1505, двор 1080×910, дом 740×620,
  игрок 330×690, одежда 250×300, причёска 200×90, машина 290×190, мебель/микрофон/комп 350×250,
  часы 70×70.
- 2026-09-28 — ДВЕ КОМПОЗИЦИИ СЦЕНЫ (портрет по референсу Lamar Idle Vlogger):
  при h > w включается вертикальная стопка — PORTRAIT_* якоря: дом сверху (dy −195,
  scale 0.95), под ним тачка (−55/0.85), персонаж КРУПНЫЙ у левого края (−95, +35,
  scale 1.4), рабочее место внизу (стул/ноут/микрофон dy ~+175). Ландшафт — прежний
  мокап 1120×556. Смена ориентации на лету (portrait = h > w в layout). Подписи
  стадий в портрете расставлены врозь (дом — над, двор/тачка — справа от объекта,
  рабочее место — под/над в стороны), иначе слипаются под HUD; двор клампится
  labelTopLimit. Вертикальные зазоры портрета жмутся на низких экранах:
  dyScale = min(1, usable/380) — ТОЛЬКО позиции, размеры константны; на 375×667
  коэффициент ровно 1. Проверено вживую: 375×667 (стопка как в референсе),
  320×568 (всё влезло), 1120×800 (ландшафт не задет). tsc+build зелёные.
- 2026-09-30 — СИСТЕМА ТЕКСТУР (ASSETS.md): папки-мастера art/<группа>/<стадия>.<ext> (картинка или
  видео по расширению) → пайплайн npm run assets (sharp: WebP + кап размера без увеличения, видео
  копией, хеш-имена от содержимого и настроек, manifest.json, чистка устаревшего, весовой отчёт,
  бюджеты 90/15 МБ) → рантайм view/assetRegistry.ts (ленивая загрузка, откат стадий вниз, release,
  видео через VideoSource) → сцена подменяет заглушки спрайтами (Map visuals, стадии по тирам,
  фон по эпохам, метки гаснут) → загрузочный экран #boot-screen до LoadingAPI.ready(). Единый
  источник размеров — src/data/sceneAssets.json (игра + пайплайн). Новые файлы: ASSETS.md,
  scripts/build-assets.mjs, scripts/vite-plugin-assets.mjs, src/data/sceneAssets.json,
  src/data/assets.ts, src/view/assetRegistry.ts, src/ui/BootScreen.ts. Правки: GameView (visuals,
  стадии, фон, sceneBox), WorldLayer (setTexture + cover по текстуре; applyStage удалён), main
  (прелоад до ready + dev-ручки window.assets/scene), index.html/styles.css (boot-screen),
  vite.config (assetsDir 'bundle' + плагин), package.json (sharp + assets/assets:watch),
  worldStages.ts (worldEraBackground → ключ мира в data/assets). Проверено: tsc/build зелёные,
  живой прогон картинок, видео, смены тира и эпохи (release декодера), отсутствия манифеста,
  конфликта форматов, занятого файла, бюджетов; dist без debug-утечек.
- 2026-09-30 — КОРРЕКТИРОВКА КООРДИНАТ ДЛЯ ТЕЛЕФОННОГО ЭКРАНА: игрок/машина/рабочее место сдвинуты
  для лучшей вписки в вертикальное соотношение сторон. CHAR_ANCHOR.dx: −240 → −220 (игрок правее
  на 20px, меньше выходит за левый край); CAR_ANCHOR.dx: 150 → 140 (машина ближе к центру на 10px);
  WORKPLACE_DX: 310 → 280 (рабочее место левее на 30px, не выходит за правый край). Проверено:
  tsc/build зелёные.
- 2026-09-30 — РЕДИЗАЙН ВЕРХНЕГО МЕНЮ (по мокапу владельца, решения согласованы вопросами):
  (1) HUD перебран с 2×2+чип на ПЯТЬ ПЛАШЕК [TOTAL BALANCE | Passive $] / [GOLD «soon» | Active $]
  / [SUBSCRIBERS на всю ширину] — подписи АНГЛИЙСКИЕ, как на скетче (решение владельца);
  значения прежние (TOTAL BALANCE = текущий баланс money, Passive/Active — потоки, GOLD —
  заглушка новой валюты). (2) ЧИП ЭПОХИ УДАЛЁН из HUD — его функцию (EraPopup) забирает кольцо;
  "название эпохи и фаза" на главном экране больше не показываются, только в попапе (решение
  владельца). (3) КОЛЬЦО ПЕРЕДЕЛАНО: круг-кнопка с тёмной таблеткой-плашкой, дорожка
  world-ring-track + градиентная дуга (SVG linearGradient 'world-ring-gradient', 3 стопа,
  ссылка из CSS через stroke:url(#…)), свечение дуги, белый % и вспышка .evolved на world:changed.
  (4) ШИРИНА МЕНЮ: единая переменная --menu-w (min(100%,420px)) — .hud-top (боковые отступы
  СНЯТЫ, крайние плашки вровень), .hud-bottom, .sheet, .era-pop; на 1280px оба блока ровно
  420px от x=430 (проверено getBoundingClientRect). (5) КНОПКА НАСТРОЕК: 46px, размер статичен;
  при (max-aspect-ratio:1/1) + width≤583px уходит за правый край на 6px (right:-6px) —
  «чуть-чуть за границу» (выбор владельца), на широких экранах целиком внутри.
  (6) Точка-триггер дебаг-панели переехала налево ПОД кольцо (top:96px/left:12px).
  Убрано мёртвое: renderEraChip/eraChip/eraNameEl/eraNextEl/lastEraKey, импорты WORLD_*_NAMES,
  CSS .era-chip/.era-icon/.era-name/.era-next/@keyframes era-glow, .world-ring-bg → .world-ring-track.
  Проверено вживую (dev 5050): 1000×760, 1280×800 (HUD == нижняя панель, кольцо/настройки
  без перекрытий), 375×700 (settings обрезана на 6px, плашки без переполнения — ACTIVE $
  уходит в ellipsis), ручное пересечение периода: .world-ring.evolved + пct 4% (формула),
  консоль чистая, tsc + vite build зелёные, grep dist без debug-утечек.
- 2026-09-30 — ВЕРХНЯЯ ПАНЕЛЬ: КОМПАКТНО + ПРИКРЕПЛЕНА К ЦЕНТРУ (по замечаниям владельца):
  (1) ПОДПИСИ ПЛАШЕК УБРАНЫ (все пять — balance/passive/gold/active/subscribers): ячейки стали
  низкими (38px вместо ~50) — «верхние окна поменьше»; смысл показателя несут цвет значения
  (stat-<kind>) и title ячейки (mkStat(title, kind, valueEl), .cell-caption и её CSS удалены).
  (2) ПОЧЕМУ «РАЗЪЕЗЖАЛИСЬ»: кольцо/настройки были привязаны к КРАЯМ ОКНА (left/right:10px) —
  на широком экране уходили от меню к краям, при ресайзе расходились. Теперь есть обёртка
  .hud-bar (та же --menu-w + центрирование, что у нижнего меню), в которой живёт блок .hud-top,
  а .world-ring и .settings-btn позиционируются ОТ КРАЁВ БЛОКА: right: calc(100% + 10px) и
  left: calc(100% + 10px) → зазор ровно 10px на ЛЮБОЙ ширине (проверено 375/1280/1600px),
  ширина блока = ширине нижней панели и центр не смещается; на <584px ширина переехала на
  .hud-bar (кольцо/настройки автоматически у краёв экрана). (3) Мобильный свисающий край
  сохранён: при (max-aspect-ratio:1/1) + width≤583px у настроек left: calc(100% + 16px)
  → правый край выступает на 6px (проверено: 375px — settings.x 335…381, кольцо x 6 — не обрезано).
  Проверено: getBoundingClientRect на 1600/1280/375 (блок == нижняя панель по x/w, зазоры 10px,
  captions=0, переполнений значений нет, pointer-events: плашки none — тапы уходят на холст,
  кольцо/настройки/подписчики auto), tsc + vite build зелёные.
- 2026-10-02 — ВЕРХНЯЯ ПАНЕЛЬ: СДВИГ ВПРАВО + КРУПНОЕ КОЛЬЦО + НАЗВАНИЕ ЛОКАЦИИ (ТЗ владельца):
  (1) БЛОК ПЛАШЕК СДВИНУТ ВПРАВО на 24px сверх прежних 6px отступа кольца (--hud-shift 30px,
  одна переменная на обе ветки ширины) — в окне ~430px блок стоит x 92..398 (правый запас 32px).
  (2) КОЛЬЦО РАСТЁТ ПО СВОБОДНОМУ МЕСТУ: --ring-size = clamp(52px, 50vw + --hud-shift −
  --bar-w/2 − зазор 10px − отступ 6px, --ring-max 96px); --bar-w — та же ширина блока, что и
  --menu-w, но в vw (100% внутри calc() кольца считалось бы от контейнера КОЛЬЦА, а не блока).
  Замеры: 375/430px — кольцо 76px (x=6), 583px — 95.5px, 584px — 96px (стык медиа-запросов БЕЗ
  скачка: ширина блока на 583/584 одинакова), 1280px — 96px. Медиа-значений размера кольца
  (72/52px) и inset SVG больше нет: % внутри = 0.215·диаметр, inset SVG = 8.3%.
  (3) ПОД КОЛЬЦОМ — НАЗВАНИЕ ЛОКАЦИИ (эпоха мира, WORLD_ERA_NAMES[stage.era]): span внутри самой
  кнопки, но pointer-events:none — тапы сквозь подпись уходят в сцену (инвариант 4; проверено
  elementFromPoint → CANVAS), ширина = кольцо + зазор — ровно свободная полоса до левого края блока
  (замер: подпись x 7..91 при блоке с x=92 — за компоновку не выходит), «Мегаструктура» влезает
  целиком (74px при шрифте 10.26px), ellipsis — страховка.
  (4) КНОПКА НАСТРОЕК УДАЛЕНА (владелец: временно; вернуть — из истории git): поле settingsBtn и
  разметка в UIManager, CSS .settings-btn и медиа-правка свисания за край; точка дебага переехала
  ниже (top:128px) — кольцо с подписью выросли.
  Проверено вживую (dev 5050): getBoundingClientRect на 375/430/583/584/1280 (переполнений нет,
  settings нет), клик по подписи открывает/закрывает EraPopup, консоль чистая, tsc + build зелёные.
- 2026-10-02 — ДЕБАГ: ПОДПИСИ ОБЪЕКТОВ + НАЖИМАЕМАЯ ТОЧКА ПАНЕЛИ (ТЗ владельца):
  (1) КНОПКА «Подписи объектов: ВЫКЛ/ВКЛ» — единственное место, где панель трогает СЦЕНУ:
  setupDebugPanel(game, scene) (main передаёт GameView; модульная `scene` пишется в DEV-блоке
  bootstrap), кнопка зовёт scene.setObjectLabels(on). ПО УМОЛЧАНИЮ ВЫКЛ. Правило видимости —
  syncLabelVisibility(rec): подпись видна ТОЛЬКО при labelsForced (РАНЬШЕ было «заглушка ИЛИ
  принудительно» — из-за этого с выключенной кнопкой подписи светились на заглушках, что владелец
  и признал ошибкой в корректуре того же дня: «по умолчанию выключена — подписи не видны»);
  ВКЛ показывает подписи «номер · имя · размер» ВСЕХ объектов (включая заглушки) + метку фона
  (рамки-gfx не трогаются — под текстурой не нужны). Из консоли — scene.setObjectLabels(true).
  (2) ТОЧКА-ТРИГГЕР: панель (z-index 9999) перекрывала точку (9998) и закрыть панель с неё было
  нельзя. toggle() теперь вешает на точку .panel-open — она прилипает к правому верхнему углу
  панели СНАРУЖИ (236,46 при панели 10+220; на <700px 202,40) с z-index 10000.
  Проверено вживую (dev 5050): открытие/закрытие панели точкой на 430 и 1280 (dot 202,40 и 236,46 —
  вне панели, elementFromPoint = сама точка), кнопка и scene.setObjectLabels на подделанном appliedKey
  («текстура есть») — ВЫКЛ держит подпись скрытой, ВКЛ показывает, повторный ВЫКЛ прячет; labelsForced
  по умолчанию false; tsc + build зелёные.
- 2026-10-02 — ГАЛЕРЕЯ ЭПОХ: КАРУСЕЛЬ ПО ЦЕНТРУ ЭКРАНА (ТЗ владельца):
  (1) ОКНО ПЕРЕЕХАЛО С НИЗА ЭКРАНА В ЦЕНТР: .era-pop = top/left 50% + translate(-50%,-50%).
  (2) СПИСОК СТРОК → КАРУСЕЛЬ: страница = эпоха; превью = ФОН ЭПОХИ из манифеста (world/<эпоха>):
  прошлые и текущая — картинка (<img>) или видео (единственный живой декодер: создаётся на
  активной странице, при уходе элемент удаляется), будущие — только «?», нет ассета — заглушка
  с иконкой. Провайдер превью (EraPreviewProvider) собирает main из AssetRegistry (resolveKey +
  новый entry) — ui про view не знает (инвариант направлений зависимостей).
  (3) СТРЕЛКИ ‹ › по краям кадра (на концах disabled) + ТОЧКИ-ИНДИКАТОР снизу (хит 18px, клик =
  прыжок на страницу); нижняя строка — по ПРОСМАТРИВАЕМОЙ странице (Пройдено ✓ / Растительность
  + % и бар / 🔒 + порог).
  ГРАБЛИ: первая версия считала translateX в % от СОБСТВЕННОЙ ширины ленты (= кадру) — страницы
  не доезжали, в кадре был кусок соседней. Фикс: ширина ленты N×100% и доля страницы (100/N)%
  задаются inline из TS (число эпох не дублируется в CSS).
  Проверено вживую (dev 5050): центрирование (смещение 0 на 430×780 и 1280×800), карточка
  влезает в 430×520 (медиа сжалось до 170px), выравнивание страниц по кадру при стрелках и
  кликах по точкам (alignedPage == индекс), mediaState: видео → уход → элемент удалён, картинка
  остаётся тем же <img>, будущая эпоха — «?», стрелки на концах disabled, tsc + build зелёные.
- 2026-10-02 — ДЕБАГ: КОРРЕКТУРА КНОПКИ ПОДПИСЕЙ (ТЗ владельца):
  Владелец: «по умолчанию выключена (подписи не видны), при включении показывает подписи».
  СТАРОЕ ПРАВИЛО («видна на заглушке ИЛИ принудительно») показывало подписи со ВЫКЛЕННОЙ
  кнопкой везде, где нет текстур — в его сборке это были все объекты (скриншот: подписи при ВЫКЛ).
  НОВОЕ ПРАВИЛО: подпись (объекта и метка фона) видна СТРОГО при labelsForced (по умолчанию
  false → не видно ничего, включая заглушки); убраны setWorldLabelVisible и ветки
  «appliedKey === null» в syncLabelVisibility/месте создания метки; mark.visible ставится
  при сборке узла. Проверено вживую (dev 5050): старт — labelsForced false, ни одной подписи
  (10 шт. + метка фона скрыты, кнопка «ВЫКЛ»); клик — ВКЛ, все 10 + метка фона видны;
  повторный клик — ВЫКЛ, снова ничего. tsc + build зелёные, в dist только публичный
  setObjectLabels (панели и строки «Подписи объектов» в проде нет).
- 2026-10-02 — HUD: БАР КРАСНЫЙ, НАДПИСИ БЕЛЫЕ, КОЛЬЦО В СТИЛЕ ПЛАШЕК (ТЗ владельца):
  (1) БАР ПОДПИСЧИКОВ — КРАСНЫЙ (был жёлтый): .sub-fill на var(--danger)-градиенте,
  claimable — более яркий красный, пульс-свечение клейма тоже красное. ГРАБЛИ: трек
  .sub-track схлопывался в 0 (полоса не рисовалась) — у <button> в Chrome UA-стиль
  align-items: flex-start, и пустой div не растягивался; фикс — align-self: stretch
  на .sub-track и .sub-top (заодно .sub-goal получил ширину под ellipsis).
  (2) ВСЕ НАДПИСИ ВЕРХНЕГО МЕНЮ — БЕЛЫЕ: убраны зелёный (пассив) и золотые (тап,
  GOLD «soon», claimable-счёт) — стат-цвета удалены, все значения var(--text);
  у GOLD оставлена только типографика (капс, разрядка, 14px).
  (3) КОЛЬЦО ПРОГРЕССА — ТЕ ЖЕ МАТЕРИАЛЫ, ЧТО ПЛАШКИ (выбор владельца: круг + зелёная
  дуга): фон var(--bg-panel) вместо зелёного radial-gradient, рамка 8% как у .hud-cell,
  без «уличной» тени и внутренней подсветки; дуга сплошной var(--accent) вместо
  градиента (зелёный→жёлтый) и без drop-shadow-свечения; SVG defs/linearGradient и
  константы WORLD_RING_GRADIENT_ID/STOPS удалены из UIManager (цвет живёт в CSS),
  вспышка .evolved оставлена (без inset); % — var(--text).
  Проверено вживую (dev 5050): track 280px (до правки был 0), fill красный, все 4 значения
  + счёт белые rgb(245,246,247), кольцо: bg rgba(16,20,24,0.82), border 8%, дуга
  rgb(46,204,113), defs в SVG нет; tsc + build зелёные, в dist нет world-ring-gradient.
- 2026-10-02 — ФИКС ДВУХ UI-БАГОВ (по фидбеку владельца): (1) ЦЕНТРИРОВАНИЕ ПОДПИСИ
  .world-label ПОД КОЛЬЦОМ: left: calc(--ring-gap / -2) вместо left:0 — центр бокса
  подписи совпадает с центром кольца (text-align:center центрировал по боксу
  «кольцо+зазор», текст уходил вправо на gap/2 = 5px; замер вживую: delta 0 после,
  +5px до). (2) ПРОГРЕСС В ПОПАПЕ EraPopup — ЖИВОЙ: constructor получает Game (а не
  WorldWatch), pct в refresh()/renderStrip() считается от worldProgressFrac(
  state.totalEarned) с округлением floor — как у кольца (раньше — кэш stage.eraProgress,
  замороженный между сменами периода: меню стояло на 0%, пока кольцо показывало живые
  %; ранее тот же паттерн чинился для кольца — worldProgressFrac, Журнал #15). Проверено
  вживую (dev 5050): подпись delta 0 от центра кольца; меню = кольцо (11% == 11%),
  инъект totalEarned ×3 сразу двигает % и бар меню (31%), после отката state/save
  чистые; tsc + build зелёные.
- 2026-10-03 — МОДЕЛИ: НОРМАЛИЗАЦИЯ БОКСОВ + РЕЗКОСТЬ ФОНА + ИГРОК ПОДНЯТ (ТЗ владельца;
  ветка fix/models). Три связанные правки:
  (1) РЕЗКОСТЬ (главный баг «замыленный фон»): у world/yard/house стоял maxScale 1 — пайплайн
  резал мастера по spec.w*1 и выбрасывал половину деталей (art/world/1.jpg 2572×1440 → 1120×627,
  art/world/2.png 3010×2040 → 1120×759), после чего WorldLayer по cover растягивал их обратно
  под портретный экран (на 420×900 — 1.44×, на DPR2 ещё выше). Фикс: maxScale 2 у ВСЕХ групп
  (игра рендерит до DPR2) + webpQuality 82→88. Итог сборки: world/1 2240×1254, world/2 2240×1518,
  house/0 740×1240 (мастер 2× больше не сжимается), character/0 528×1104 — на портрете cover
  теперь ~0.7–1.1×, а не 1.4–2.2×. ВАЖНО: world/0 (1505×1020) остался меньше капа — на DPR2
  портрете всё ещё upscale ~1.65×; владельцу желательно перерисовать era-0 фон шире (≥2240).
  (2) БОКСЫ ПО 8px-СЕТКЕ (sceneAssets.json — единый источник для игры и пайплайна): фон 1120×759
  (был 1120×1505 — не совпадал с ландшафтными мастерами 1.475; убрано и вечное предупреждение
  об аспекте), двор 1080×912, дом 384×640, машина 352×240, игрок 264×552, причёска 264×192,
  одежда 264×360, часы 120×176, мебель/микрофон/комп 360×480 (трио конгруэнтно — инвариант
  пайплайна прошёл). Причёска(1/3)+одежда(2/3) = ровно 552 и 264 — полосы закрывают игрока встык.
  (3) ИГРОК ПОДНЯТ И УМЕНЬШЕН: 330×690 → 264×552 (×0.8 — аспект мастера сохранён, растяжения нет;
  теперь заметно НИЖЕ дома 384×640, было наоборот) и CHAR_ANCHOR.dy 215 → 75. Было: низ игрока
  = cy+215+345 ≈ на 110px ПОД таб-баром на 420×900 («утоплен вниз»); стало низ = cy+75+276
  (полностью виден над таб-баром и в портрете, и в ландшафте). Офсеты носимых пересчитаны
  (hair oy −180, clothes oy +96, watch ox −72/oy +19), lift 21/9/0; WorldLayer-эталон 1120×759.
  МЕХАНИКА РЕСАЙЗА НЕ ТРОНУТА (drift/squeeze/floor — как было). Проверено вживую (dev 5050):
  портрет 420×900 — игрок целиком виден, метки 264×552/264×192/264×360/120×176/384×640/360×480;
  ландшафт 960×500 — фон 0.43× (резкий), игрок до таб-бара; tsc + vite build зелёные; бюджеты
  папки 1.4 МБ и старта 168 КБ OK. Старые хеш-файлы в public/assets не удалились (их держит
  запущенный dev-сервер) — не в манифесте, уберутся следующим прогоном npm run assets.
- 2026-10-03 — КАРТОЧКА: БАР ДОЛИВАЕТСЯ ПРИ ЗАВЕРШЕНИИ ГРЕЙДА (баг владельца: «в режиме max
  прогресс-бар просто сбрасывается в ноль»). Причина: getBuyPlan('tier') режет пачку по
  toTierEnd, поэтому после 'tier'-покупки level % 10 === 0 и renderLevelDependent ставил 0%
  мгновенно (CSS-transition давал отток назад). ФИКС ObjectSheet: при переходе через границу
  тира (Math.floor(level/perTier) > Math.floor(shownLevel/perTier)) вызывается playTierFill —
  ширина ставится 100% (CSS доливает 0.25s), а через TIER_FILL_MS 260мс таймер СНАПИТ бар в
  новый грейд с transition:none (форс-reflow) и, если итог > 0, анимирует к нему. Обычный путь
  (без перехода) — setBarWidth, который заодно гасит висящий таймер; таймеры снимаются при
  rebuildCards. ТЗ-подсказка режима обновлена («бар доливается и стартует новый»). Работает и в
  'one' (9→10: 90%→100%→0%). Проверено вживую (dev 5050): 'tier' ур.10→20 — computed width
  0→35→70→97→121→137→144px за ~250мс, затем снап 0; 'one' 20→21→22 — 0%→10%→20% без сброса;
  tsc зелёный.
- 2026-10-03 — МАГАЗИН: СТАТИЧНЫЕ ОБОБЩЁННЫЕ ИМЕНА, КАМЕРА И ВЕТКА НАВЫКОВ (ТЗ владельца).
  (1) ИМЕНА СТАТИЧНЫ: ObjectSheet.renderLevelDependent пишет ВСЕГДА def.name (раньше —
  tierNames[тир]), т.е. название больше не меняется от прокачки. tierNames остались ТОЛЬКО
  как число стадий сцены (tierOf/assetKey/фильтр сценовых объектов) и в карточке не
  показываются. Имена: дом→Недвижимость, машина→Транспорт, двор→Двор, часы→Часы,
  причёска→Причёска, одежда→Одежда (было «Шмот»), камера, мебель, комп,
  навыки: Харизма / Интеллект / Юмор / Эмоциональность. Вкладка outfit «Шмот» → «Одежда».
  (2) РАБОЧЕЕ МЕСТО: «Микрофон» УБРАН → КАМЕРА (ObjectId tech→camera и группа ассетов
  tech→camera: sceneAssets.json, OBJECT_ASSET_GROUP, GameView CAMERA_SPEC, trio пайплайна;
  art/tech → art/camera, мастеров там не было). Порядок карточек/покупки: КАМЕРА → МЕБЕЛЬ →
  КОМП; гейты: camera.requires = house, furniture.requires = camera, pc.requires = furniture.
  Глубина СЦЕНЫ не менялась (мебель 12 — дальний, камера 11 — средний, комп 10 — ближний).
  (3) НАВЫКИ: добавлен intellect (было 3 → 4); ВСЕ четыре require = camera (раньше цепочка
  харизма→эмоция→юмор) и открываются СРАЗУ все; баланс монотонный — Харизма 0.8/500$,
  Интеллект 1.0/800$, Юмор 1.2/1.2K$, Эмоциональность 1.5/2K$ (рост 1.25, максимум 50).
  (4) СЕЙВ: версия НЕ менялась — в GameState.loadFromSnapshot добавлена миграция id
  tech→camera (рядом со старой face→hair), поэтому прогресс игроков сохраняется: старые
  гейты (навыки→pc→tech) гарантируют, что камера в сейве уже была. Проверено вживую
  (dev 5050, после resetAll): Недвижимость/Транспорт/Двор/Часы/Причёска/Одежда — статичные
  имена; Камера покупается, Мебель «🔒 Нужен: Камера», Комп «🔒 Нужен: Мебель»; все 4 навыка
  «🔒 Нужен: Камера». После покупки Камеры — все 4 навыка открываются сразу (500/800/1.2K/2K),
  Мебель открывается, Комп остаётся за Мебелью; на сцене метка «11 · КАМЕРА · 360×480». tsc + vite
  build зелёные. ГРАБЛИ: мастер art/house/0.png ИСЧЕЗ из art/house/ ВО ВРЕМЯ работы (папка
  опустела в 01:59, уже после успешной сборки дома в 01:56) — не из-за правок; house/0 выпал из
  манифеста и рисуется заглушкой. Вернуть master + npm run assets.
