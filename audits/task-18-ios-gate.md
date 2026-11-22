# Задача #18 — iOS mobile gate (шрифты полей + переполнение на 320px)

Дата: 22.11.2026. Ветка: `work/18-ios-gate` от origin/main (ef3a9d1). Регресс — по кодам выхода, NODE_PATH=/opt/homebrew/lib/node_modules.

## 1. Аудит font-size всех форм-контролов (iOS зумит поля <16px)

Метод: headless Chromium (Playwright), вьюпорт 320×568, isMobile+hasTouch; computed `fontSize` всех `input/select/textarea` на всех экранах: гейт входа, чат, «Ещё», бургер-меню, библиотека, гейт ключа.

Результат аудита (было):
- `#nickInput` (гейт, текст) — 16px, ок
- `#prompt`, `#lyrics`, `#musicPrompt` (textarea) — 16px, ок
- `#keyInput` (password) — 16px, ок
- `.producer-field input/textarea` (динамические, продюсер) — 16px, ок
- динамический textarea в `legacyCopyText` (studio.js:2269) — offscreen, readonly, не фокусируется пользователем, ок
- `#keyRemember` (checkbox) — **13px**. Checkbox не зумится iOS (зум только текстовых полей), но по постановке «every input >= 16px computed» выправлен.

Исправление (studio.css):
- `.key-remember input { font-size: 16px }` — на вид чекбокса не влияет (appearance по умолчанию), тач-таргет не менялся.

Итого исправлено контролов: **1** (`#keyRemember`). Остальные уже соответствовали гейту.

## 2. Переполнение на 320×568 (неразрывные токены)

Метод: в живую страницу инжектились худшие токены (кириллическое слово 125 символов, латинский токен ~180 символов, URL ~320 символов) в карточку ленты (`.who`, `.track-title`, `.track-meta`, `.track-details`, `.draft-read-plain`, `.draft-read-full`); замер `documentElement.scrollWidth - clientWidth`.

Найдено:
- **бургер-меню `#profileMenu` давало +144px горизонтального скролла**: `.menu { left: 0; min-width: 200px }` при якоре у правого края шапки (320px) — меню уходило за экран (правый край x=464).

Что уже было в порядке (наследование `overflow-wrap: anywhere` от `.card`, `.session-item`, `.track-title`, `.track-meta`, `.draft-read-*`, тосты, `.producer-*`) — худшие токены в карточке черновика и карточке трека скролла не давали (overflow=0 до и после фикса меню).

Исправления (studio.css):
- `#profileMenu { left: auto; right: 0 }` — меню якорится правым краем якоря; после фикса в кадре [108..308] на 320px.
- `.menu { max-width: calc(100vw - 16px); overflow-wrap: anywhere }` — страховка для всех дропдаунов: длинный ник/название сессии не распирает меню за вьюпорт.

Тач-таргеты не тронуты (44px-правила не менялись; a11y-сьют зелёный).

## 3. Новые e2e-ассерты (tools/check-studio.cjs, секция «18-iOS-gate»)

- все `input/select/textarea` computed font-size >= 16px на 320×568 (deepEqual на список нарушителей);
- инжект худших токенов в карточку ленты → горскролл <= 0 на 320px;
- открытый `#profileMenu` в кадре 320px (left >= 0, right <= 320), горскролл <= 0.

## 4. Регресс (коды выхода)

- `check-studio.cjs` — EXIT=0, SUITE PASS: **79 checks** (78 базовых + новая секция #18)
- `check-a11y.cjs` EXIT=0, `check-assembly` 0, `check-bench` 0, `check-cache-selfheal` 0, `check-chat-draft` 0, `check-export` 0, `check-lyrics-brain` 0, `check-md-links` 0, `check-music-brain` 0, `check-producer` 0, `check-session-migration` 0, `check-session-store` 0, `check-studio-storage` 0, `check-wait-phrases` 0, `check-waveform` 0 — все зелёные.

Примечание по флакам среды (вне продукта): за сессию дважды наблюдались разовые сбои — «Target page closed» на `#feed audio` и разовый `SessionStoreError` в T-28; оба не воспроизводятся при повторе прогона, на origin/main не воспроизводятся.

## 5. Сборка

`node tools/asset-versions.cjs --fix` — отпечаток сборки 7d5e644c8d (index.html, studio.css, version.json).
