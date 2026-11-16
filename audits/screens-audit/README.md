# `audits/screens-audit` — скриншоты: почему их нет и как получить за одну команду

Бриф аудита (issue #15) требует скриншоты по каждому замечанию. **Снимков в этом каталоге нет**, и это
единственное требование брифа, которое не выполнено: аудит выполнялся в песочнице Арены, где

- нет браузера и нет доступа к CDN браузеров (`cdn.playwright.dev`, `storage.googleapis.com`,
  `objects.githubusercontent.com` закрыты) → Chromium не устанавливается;
- нет доступа к `demo.briix.ru` → живой стенд не открыть;
- egress разрешён только к `github.com`, `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`.

Вместо снимков здесь лежит **готовый прогон** `capture.cjs`: на любой машине с Node 18+ он поднимает
копию студии с фейковым `media-bff` и снимает все требуемые состояния во всех требуемых вьюпортах.
Ничего в `studio/` не правится, реальный стенд не трогается, ключ стенда не нужен
(используется тестовый ключ `audit-capture-token`, который ничего не открывает кроме этого mock-сервера).

## Запуск

```bash
npm i -D playwright                 # или глобально: brew install playwright (как советует README репо)
npx playwright install chromium
node audits/screens-audit/capture.cjs
```

Результат — в этом каталоге:

- `NN-состояние__вьюпорт[__кадр].png` — 10 состояний × 4 вьюпорта, 44 кадра
  (состояние «Библиотека» снимается до и после клика «В избранное»);
- `capture-log.txt` — по каждому кадру: сетевой журнал (`POST /jobs`, число поллингов, `cancel`, `peaks`),
  `console.warn/error`, failed-запросы и **метрики реального браузера**, которых не может дать jsdom:
  `devicePixelRatio`, размер `canvas` (атрибуты против CSS-бокса), число видимых `<audio>` и играющих,
  высота/ширина тач-таргетов меньше 44 px, высота документа, наличие горизонтального переполнения.

Полезные флаги:

```bash
node audits/screens-audit/capture.cjs --state 09          # только «Библиотека»
node audits/screens-audit/capture.cjs --vp mobile-390x844 # только один вьюпорт
node audits/screens-audit/capture.cjs --peaks=array       # отдать пики голым массивом (волна появится)
node audits/screens-audit/capture.cjs --server-only       # только поднять стенд и не снимать (для curl/отладки)
STAGE_MS=60000 SSE_MS=120 node audits/screens-audit/capture.cjs   # медленнее стадии/стрим — удобнее ловить кадры
```

Открыть стенд руками (без Chromium): `node audits/screens-audit/capture.cjs --server-only` и перейти на
<http://127.0.0.1:8080/studio/index.html?key=audit-capture-token>. Любой ник + любые 4 цифры PIN.

## Состояния и что на них смотреть

| № | Кадр | Что проверяем (ссылки на находки отчёта) |
|---|---|---|
| 01 | `01-gate` | гейт: PIN-пад, `#pinDots` без `role`/`aria-live` (F-02), отсутствие `h1` (F-02), размеры таргетов (F-49) |
| 02 | `02-sessions` | диалог «История»: `aria-modal` без `inert` у фона (F-05), отсутствие поиска/переименования/удаления (F-04) |
| 03 | `03-composer-music` | режим «Музыка»: чипы ассистента/модели, `#genTrack`, теги-подсказки, тач-таргеты 28–36 px (F-49) |
| 04 | `04-mentor-stream` | стрим ответа: `aria-live="polite"` на всей ленте (F-49), автоскролл (F-39), отсутствие кнопки остановки в композере (F-31) |
| 05 | `05-producer-draft` | черновик продюсера: два разных компонента черновика (F-11), «Поля заполнены» в `role=status` (F-12) |
| 06 | `06-waiting` | ожидание: фраза, полоса стадий без ARIA (F-15), таймер, ✕ без серверного `cancel` (T-05) |
| 07 | `07-track-ready` | готовый трек: **названия нет в карточке** (F-18), обложка=PLAY, волна (или её отсутствие при `--peaks` по умолчанию — P1-01/T-01), transparency без серверной правды (F-29), нативный `<audio controls>` без таймкодов (F-25) |
| 08 | `08-track-menu` | меню «⋯»: 7 пунктов в ленте, bottom-sheet на ≤480 px (F-27/F-28) |
| 09 | `09-library-100` | 100 серверных треков: `before-fav` и `after-fav` — ре-рендер всего списка, повторная загрузка 75 обложек (T-36/P1-11), сырой id модели (F-19), отсутствие названия (F-18), 6 пунктов меню вместо 7 (F-27) |
| 10 | `10-errors` | ошибки: `502 upstream_error` → «Сервер ответил 502.» без кода и `request_id` (T-09), `422 content_blocked` → карточка «Модерация» (это сделано хорошо) |

## Намеренная особенность mock-сервера

По умолчанию `/api/files/{id}-peaks.json` отдаёт **объект** `{id, duration, peaks}` — ровно так, как
задокументировано в `server-contract/README.md`. Клиент принимает только голый массив
(`Array.isArray(peaks)`, `studio.js:566-573`), поэтому на кадрах 07/09 волны не будет, а в
`capture-log.txt` появится `console.warn` про недоступные пики. Это не баг прогона, а доказательство
находки **P1-01/T-01** в реальном браузере. Кадр «как должно выглядеть после фикса» снимается флагом
`--peaks=array`.

Прочее, что mock повторяет за настоящим bff: стадии (`writing-lyrics → synthesizing → album-cover` для
вокала и `model-warmup → generating → album-cover` для инструментала — словарь из `bff.py:1287`),
конверт ошибок `{error:{code,message,request_id}}`, `X-Request-Id` в каждом ответе, 401 без bearer,
422 `content_blocked`, `provenance/ttl_seconds/mime/size/checksum` в `GET /jobs/{id}` (клиент их не читает —
T-06), `_job_public` без названия/seed/пиков в `GET /jobs`, SSE `data:`+`[DONE]`, `/v1/models` с реальными
латентностями из снапшота (нужны для честных ориентиров ожидания — F-59).

Аудио отдаётся настоящим WAV (2 с тишины), чтобы Chromium его декодировал: работает нативный плеер,
автоплей и живая волна из WebAudio. Обложки — настоящие PNG (рисуются в скрипте, 120×120).

## Что было проверено без браузера

Mock-серверная часть `capture.cjs` проверена в песочнице `curl`'ом (18 эндпоинтов: health, static,
401/422/404-конверты, создание/поллинг/отмена/избранное/удаление джоб, файлы wav/png/peaks, SSE-поток,
`/v1/models`, список из 100 записей, защита от traversal). Драйвер Playwright **не исполнялся**
(браузера в песочнице нет) — он синтаксически проверен `node --check` и написан под селекторы, которые
подтверждены DOM-снимками из `audits/repro` (`#gate`, `#nickInput`, `.pk[data-digit]`, `#enterBtn`,
`.mode[data-mode=music]`, `#prompt`, `#send`, `#genTrack`, `#newChat`, `#sessionsOpen`, `#sessionsDialog`,
`.card.stage`, `.music-draft`, `#feed audio`, `.track-details`, `.menu-btn`, `.track-menu`,
`.tab[data-tab=library]`, `.lib-item`, `.lib-item .action`). Первый запуск на машине с Chromium может
потребовать мелкой правки таймаутов (`--state NN` для отладки одного состояния).
