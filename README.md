# BRIIX Studio

Chat-first AI studio: сессии чата, генерация музыки и фото, черновики продюсера
(producer-brain), waveform-плеер. Вынесена из репозитория [briix.ru](https://github.com/bestdeejay-design/briix.ru)
в отдельный репозиторий (issue briix.ru#107): студия и её «мозги» живут здесь,
сайт и демо-разделы — там.

**Прод:** <https://demo.briix.ru/studio/> — same-origin `/api/*` проксируется
`briix-demo-server.py` на стенде A. Адрес прода не меняется: каталог `studio/`
этого репо доставляется на `fonotext-stand:/home/badai/briix-demo/studio/`
(сам деплой делает координатор, job описан отдельно; caddy и
`briix-demo.service` не затрагиваются).

## Структура

- `studio/` — самодостаточная папка: `index.html`, `studio.js`, `studio.css`,
  `session-store.js`, `waveform.js`, `producer-brain.js`, `music-brain.js` + копии
  `wait-phrases.js` / `wait-ui.js` (в briix.ru они лежат уровнем выше,
  здесь пути `./wait-*`). Runtime-зависимости studio.js: только same-origin
  `fetch('/api/...')` и `fetch('/assets/data/creative-base.json')` (few-shot
  база стиля владельца, копия в `assets/data/`).
- `assets/` — файлы, которые студия подгружает по same-origin
  (`creative-base.json`) и которые нужны тестам (`showcase/*.m4a`).
- `tools/` — 8 тестовых сюит + `browser-env.cjs` (общий playwright-раннер),
  `fixtures/briefs-20.json` (брифы приёмки мозга v2) и `bench-captions.cjs` /
  `bench-ab.cjs` (бенчмарк «мозг vs альбом», см. `bench/README.md`).
- `server-contract/` — справочник контракта media-bff (`bff.py` + README).
  Снимок: живой сервис на стенде A, источник истины не здесь.

## Локальный запуск

Статика + stub-бэкенд (генерации фейковые, тесты так же фейкуют bff):

```bash
python3 -m http.server 8080
# http://127.0.0.1:8080/studio/index.html
```

Для реальных генераций нужен стенд-туннель: same-origin `/api/*` проксируется
`briix-demo-server.py` (см. `server-contract/`), локально без стенда студия
работает в режиме недоступного bff (фразы ожидания, ошибки поллинга).

## Тесты

Локально (macOS, playwright установлен глобально через homebrew):

```bash
export NODE_PATH=/opt/homebrew/lib/node_modules
node tools/check-assembly.cjs        # сборка запроса #109: sanitize, языковое правило, brain-теги, каркас лирики
node tools/check-music-brain.cjs     # музыкальный мозг v2: слои caption, ритм всегда, бюджет, негативы, 20 брифов
node tools/check-studio.cjs          # студия целиком: композер, чат SSE, music/photo job'ы, библиотека, мобильная вёрстка
node tools/check-session-store.cjs   # session-store.js: персист и восстановление сессий
node tools/check-studio-storage.cjs  # localStorage/квоты/миграции хранилища студии
node tools/check-waveform.cjs        # waveform.js: пики, seek, fallback на битом аудио (WAV + реальный m4a)
node tools/check-producer.cjs        # producer-brain.js: черновики продюсера (vm, без браузера)
node tools/check-wait-phrases.cjs    # wait-phrases.js + wait-ui.js: фразы ожидания, самодостаточный сервер 127.0.0.1:8388
```

Зависимости браузера: `npx playwright install chromium` (в CI ставится в job).

## CI

`.github/workflows/ci.yml` — `ubuntu-latest` (не self-hosted briix-ci):
`node --check` всех JS, затем все 6 сюит. Шаг `check-wait-phrases` помечен
`continue-on-error` как сетевой-зависимый страховочный (ассерты локального
прогона не глушатся — см. отчёт в `audits/`). Timeout — 10 минут.

## Языковое правило сборки (решение владельца, 15.11 — briix.ru#109)

1. **Музыкальный prompt в модель — всегда английский.** Конвейер сборки
   (studio.js `createMusic`): идея пользователя → sanitize (снимает только
   markdown-обрамление и служебные обёртки, художественный текст не «исправляется»)
   → детерминированный brain (`studio/music-brain.js`, теги ACE-Step ≤ 240 символов,
   порядок жанр → инструменты → вокал → BPM → настроение → эпоха → продакшн,
   негативы «без кульминации» → `flat dynamics, loop-like`) → при не-ASCII идее —
   связный английский перевод через producer-чат (abortable, `max_tokens` 300;
   болтовня/JSON/markdown и не-ASCII ответы отбраковываются). Brain-теги
   приоритетнее перевода и остаются гарантированным минимумом при его неудаче.
2. **Теги частей лирики — всегда латиницей** ([Intro]/[Verse]/[Pre-Chorus]/[Chorus]/[Bridge]/[Outro]).
   `BriixProducer.latinizeTags` переписывает только теги, текст не трогает.
3. **Лирика — на языке пользователя; дефолт — английский.** Русский (или иной)
   — только при явном указании («на русском», «по-русски», «in russian», «на английском»
   и т.п.). Отсутствие указания ≠ русский. Автолирика, продюсер и brain-тег языка
   (`English lyrics` / `Russian lyrics`) следуют этому правилу.
4. **Исходная идея сохраняется неизменной** в карточке/сессии/библиотеке
   (`input.prompt`); в модель уходит сборка (`promptSent`), обе версии видны в
   «Промпт и текст песни» трека. Повтор подставляет исходную идею.
5. **Каркас частей** обязателен для автолирики и продюсера (адаптивно:
   intro → verse(s) → pre-chorus → chorus → bridge → outro); ручная лирика не
   навязывается — `BriixProducer.structureWarnings` только предупреждает.

Регресс: `node tools/check-assembly.cjs` (аргументы (а)–(м) из задачи #109).
