# ABOUT_PROJECT — живая карта проекта

> ⚠️ Читается ПЕРВЫМ делом в каждой сессии (см. `CONTEXT.md`).
> После каждого структурного изменения проекта этот файл обновляется в том же ходе работы.
> Изменил код и не обновил этот файл = задача не завершена.

---

## 1. Что это за проект

2D **Idle Tycoon** (в духе Lamar — Idle Vlogger) для платформы **Яндекс Игры**.
На сцене: персонаж, за ним дом, тачка (после покупки). Всё прокачиваемое — ОБЪЕКТЫ
(12 шт., 4 группы-вкладки): у объекта уровень, каждые 5 уровней — новый ТИР
(меняется визуальная стадия и усиливается вклад в доход). Часть объектов изначально
не куплена (уровень 0) — их покупают; ветка «Навыки» гейтится через `requires`
(комп → харизма → эмоциональность → юмор).

**Экономика двух потоков:**
- **A (активный)** — доход за тап: `A = moneyPerTap * (1 + Σ aWeight·level·tierMult)`;
- **P (пассивный)** — доход в секунду: `P = passiveBase * (1 + Σ pWeight·level·tierMult)`;
- `tierMult = 2^tier` — вклад уровня удваивается с каждой стадией объекта;
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
index.html            — два хост-контейнера: #canvas-host (z-index 1), #ui-root (z-index 10).
                        Тега SDK Яндекса НЕТ — скрипт грузится динамически из services/yandex.ts.
CONTEXT.md            — правила работы AI с проектом (роль, запреты, проверки).
ABOUT_PROJECT.md      — этот файл.
src/
├── main.ts           — точка входа: собирает слои (Game → GameView → UIManager → yandexService → loop.start()).
│                       Дебаг-панель подключается ТОЛЬКО здесь: if (import.meta.env.DEV) + динамический import().
│                       window.game (консольный доступ) — тоже только в DEV.
├── data/             — ТОЛЬКО данные, ноль логики
│   ├── gameConfig.ts     — все константы: startingMoney, базы потоков moneyPerTap (A) и passiveBase (P),
│                            tiers (levelsPerTier=10, weightMultiplierPerTier=2, weightDecayPerTier=0.9 →
│                            итог x1.8 за эволюцию), автосейв (10с), офлайн (макс 8ч, eff 50%, порог 60с), дебаг-шкалы.
│   └── objects.ts        — дата-драйвен список 12 ОБЪЕКТОВ: id, name, group, icon, startLevel (0|1),
│                            costBase, costGrowth, aWeight/pWeight (вклады в потоки A/P), maxLevel,
│                            requires? (гейт ветки), tierNames? (стадии для сцены), currentLevel (runtime!).
│                            + groupMeta/groupOrder (вкладки), objectById (Map), getObject(),
│                            objectsByGroup(), tierOf(), buildSceneState() (визуал сцены для GameView).
│                            НОВЫЙ ОБЪЕКТ = одна запись в objectDefs (+ строка в TIER_STAGES, если рисуется на сцене).
├── engine/           — чистая логика, НЕ знает про DOM/Pixi
│   ├── types.ts          — контракты: ObjectGroup, ObjectId, ObjectDef, GameStateSnapshot (version:2),
│                            OfflineEarnings, GameEventMap (карта событий шины).
│   ├── eventBus.ts       — типизированная шина событий over GameEventMap; синглтон `events`.
│                            emit итерирует Set БЕЗ копии (аллокация на каждом тике недопустима):
│                            отписка внутри обработчика безопасна, т.к. Set пропускает удалённое.
│   ├── format.ts         — formatMoney/formatNumber (до 2 знаков, подрезка нулей, 999.996→1K),
│                            formatIncomePerSecond, formatTime. Единственное место Decimal→строка.
│   ├── GameState.ts      — модель: money, passiveIncomePerSecond (кэш), totalEarned, tapsCount.
│                            Потоки: getMoneyPerTap (кэш cachedMoneyPerTap) и recalculatePassiveIncome —
│                            оба = base*(1+Σ weight·level·tierMult); tierWeightMult = 1.8^(level/10)
│                            (вклад ×2 за тир, процент ×0.9 за тир).
│                            Инвалидация кэшей — invalidateCaches() ПОСЛЕ любого изменения уровней
│                            (buyUpgrade/loadFromSnapshot/resetProgress/applyLevels — ИНАЧЕ старые доходы).
│                            getUpgradeCost = costBase*costGrowth^level; isUnlocked (гейт requires);
│                            isMaxed; buyUpgrade; resetProgress (вся логика сброса в модели);
│                            applyLevels (нейтральный API для дебага/облака); toSnapshot/loadFromSnapshot
│                            (потоки пересчитываются из дефов, не верим сейву); calcOfflineEarnings.
│                            ТОЧКА РАСШИРЕНИЯ глобальных множителей — recalculatePassiveIncome.
│   ├── GameLoop.ts       — rAF-цикл: dt = min(rawDt, 1.0) * speedScale; speedScale — дебаг x1/x5/x10.
│   ├── SaveManager.ts    — LocalStorage, ключ 'idle_tycoon_save_v2'; валидация version:2 (старые сейвы = новая игра); try/catch везде.
│   ├── OfflineProgress.ts— calc(state, lastSavedAt) + apply() → текст для модалки.
│   └── Game.ts           — ФАСАД ядра: владеет state/loop/saveManager; тик: доход→автосейв→emit('tick').
│                            API: handleTap, buyUpgrade, saveNow, resetAll, setTimeScale, destroy.
│                            pendingOfflineModal — результат офлайна на старте (см. Грабли #3).
│                            Сейв на visibilitychange + beforeunload.
├── view/             — слой Pixi (z-index 1)
│   └── GameView.ts       — Application (resizeTo host, resolution ≤2, autoDensity); градиент через
│                            2D-canvas→Texture; сцена: дом + тачка (плейсхолдеры из Graphics) + персонаж;
│                            applySceneState(buildSceneState()) — тиры (перекраска дома), видимость тачки
│                            (owned), подписи стадий (stageLabels, ленивое создание; при sell/unlock —
│                            destroy+delete); ПУЛ текстов «+1$» (floatPool); сквош при тапе; idle-анимация.
│                            Новые сценовые объекты = build-метод + ветка в applySceneState + layout.
├── ui/               — HTML-оверлей (z-index 10)
│   ├── styles.css        — #ui-root{pointer-events:none}, button/.js-interactive{auto};
│                            .modal-backdrop: visibility+pointer-events при скрытии (см. Грабли #2);
│                            --tabbar-h: 60px синхронизирует шторку и таб-бар.
│   ├── UIManager.ts      — HUD: баланс + ОБЕ строки потоков (P зелёным /сек, A жёлтым за тап);
│                            троттлинг ~4/с, кэш строк, форс на tap:earned и object:levelup;
│                            шторка обновляется ТОЛЬКО пока открыта (sheet.isOpen()),
│                            синхронизация цен — в sheet.open() через refresh().
│   ├── ObjectSheet.ts    — вкладки групп (из groupOrder) + шторка; DOM строится ОДИН раз из дефов;
│                            СХЕМА КАРТОЧКИ (по ТЗ): [иконка+имя слева][прогресс-бар эволюции по центру][кнопка справа].
│                            Бар: level%10 / 10 + подпись «ур. N · K/10 · Стадия» (или «Нужен: X» / «Не куплено» / MAX).
│                            refreshCard() пишет в DOM только изменения (кэши shownLevel/shownUnlocked/
│                            shownAffordable/cachedCost); renderLevelDependent — бар+подпись+кнопка при смене уровня.
│                            Состояния: locked (🔒 + «Нужен: X»), level 0 («Не куплено»), owned, maxed («Максимальная эволюция»).
│                            Покупка = game.buyObject(id).
│   └── OfflineModal.ts   — универсальная модалка show(title, body, buttonText, onClose).
├── services/
│   └── yandex.ts         — синглтон yandexService. init(): НЕ в iframe → mock БЕЗ загрузки скрипта
│                            (см. Решения #1); в iframe → динамическая загрузка sdk/v2 → YaGames.init().
│                            showFullscreenAdv/showRewardedVideo (промисы), gameplayStart, cloud-save заготовки.
└── debug/              — DEV-only, вырезается из прода (проверено grep по dist/)
    ├── debugPanel.ts     — панель «~»/точка в углу: +1M$, Unlock all (lvl 1 всех объектов через
│                            state.applyLevels), сброс, скорость x1/x5/x10, тест рекламы.
    └── debugPanel.css    — стили панели; импортируется только из debugPanel.ts → тоже вырезается.
```

---

## 4. Связи и потоки (кто с кем общается)

**Направление зависимостей (нарушать нельзя):**
`data ← engine ← (view | ui | debug)`; main знает всех; view и ui НЕ импортируют друг друга.

**События шины (`GameEventMap` в types.ts):**
`tick`, `money:changed`, `game:saved`, `game:reset` (undefined) · `offline:income {title, body}` ·
`tap:earned {amount, totalTaps}` · `object:levelup` (ObjectDef) — слушают main (сцена) и UIManager (HUD).

**Ключевые потоки:**
1. Тап: canvas pointerdown → GameView → колбэк main → Game.handleTap → GameState.applyTap → события → HUD; «+1$» из пула.
2. Покупка: кнопка ObjectSheet → Game.buyObject → GameState (списание, level++, invalidateCaches) →
   emit('object:levelup') → сцена (тир/owned) + HUD (форс) ; цены обновятся на ближайшем tick.
3. Тик: GameLoop(dt) → доход + автосейв(10с) → emit('tick') → UIManager: HUD + sheet.refresh().
4. Офлайн: конструктор Game → SaveManager.load → loadFromSnapshot → OfflineProgress → pendingOfflineModal → main показывает модалку.
5. Дебаг: debugPanel → публичное API Game + yandexService. В проде цепочки не существует.

---

## 4.1. Рецепты расширения

- **Новый объект:** одна запись в `objectDefs` (data/objects.ts) — карточка, цена, вкладка появятся сами;
  если объект рисуется на сцене — добавить tierNames, build-метод и ветку в GameView.applySceneState.
- **Новая группа (вкладка):** ключ в `ObjectGroup` (engine/types.ts) + записи в `groupMeta` и `groupOrder` (data/objects.ts).
- **Гейт ветки:** объекту поле `requires: ObjectId` — карточка сама покажет 🔒 и «Нужен: X».
- **Глобальный множитель (престиж/бустер):** в `GameState.recalculatePassiveIncome()` (P) и/или в getMoneyPerTap (A).
- **Новое событие:** тип в `GameEventMap` (engine/types.ts), emit в движке, подписка в UI/view — не напрямую.
- **Облачный сейв:** `yandexService.saveCloudData(state.toSnapshot())` — формат уже сериализуемый.

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
   — по ТЗ «по ходу прокачки немного апается процент получения». Уровней в тире — 10 (прогресс-бар
   карточки). Сейвы при смене levelsPerTier не ломаются: уровень абсолютен, тир выводится из него.

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
   для принудительной перерисовки.
4. **break_infinity.js — default export:** `import Decimal from 'break_infinity.js'`, НЕ `{ Decimal }`.
5. **Пишущие инструменты могут вставлять мусор в файлы** — после записи читать файл и проверять целостность.
6. **Автосейв каждые 10с** — правки state «протухают», если игра продолжает тикать в фоне теста.

---

## 8. Проверки и команды

```bash
npm run dev         # http://localhost:5173 (дебаг-панель: ~ или точка в углу)
npm run build       # tsc --noEmit && vite build
npm run typecheck   # только типы
# zero-leakage дебага:
grep -rl "debug-panel\|setupDebugPanel\|window.game" dist/   # должно быть пусто
```

Смоук-сценарий после правок: тап по канвасу («+1.05$», баланс растёт) → вкладка «Имущество» → покупка
объекта (уровень+, вклад в потоки, при тире — смена стадии на сцене) → вкладка «Навыки» (🔒 до компа) →
инъекция сейва 2ч назад + reload → модалка офлайна с суммой → закрыть → всё кликабельно.

---

## 9. Роадмап / бэклог

- [ ] Престиж (сброс за постоянный множитель; точка расширения: recalculatePassiveIncome/getMoneyPerTap)
- [ ] Rewarded-бустер x2 на N минут (yandexService.showRewardedVideo уже готов)
- [ ] Спрайт-атласы для тиров сцены (сейчас: плейсхолдеры Graphics, перекраска по тиру)
- [ ] Ветвь «Рабочее место» на сцене (техника/комп/мебель пока только в шторке)
- [ ] Облачные сейвы Яндекса (заготовки saveCloudData/loadCloudData уже есть)
- [ ] Unit-тесты экономики (vitest): цены, гейты, тиры, офлайн, снапшоты v2
- [ ] Баланс-ревизия: веса aWeight/pWeight/costBase проставлены на глаз — нужен прогон доиграбельности

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
