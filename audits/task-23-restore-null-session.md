# Хотфикс #23: «Не удалось открыть сессии: Cannot read properties of null (reading 'title')»

Ветка: `fix/restore-null-session` (от `origin/main` a9fd560). Issue: bestdeejay-design/briix-studio#23.

## Что сделано

### 1. Корневой фикс — `studio/session-store.js`
Добавлена санитизация профиля при каждом `open()`/`openProfile()` (оба бэкенда — IDB и локальный fallback):

- `sanitizeSession(raw, now)`: null / не-объект / массив → выбросить; записи без валидного `id` — новый UUID; без валидного `title` — «Новый чат» + `titleSet: false`; `feed`/`history` не массивы → `[]`; `createdAt`/`updatedAt` не числа → `now` / `createdAt`.
- `sanitizeProfile(profile)`: возвращает новый профиль с очищенным `sessions` и флагом `changed`. Валидные записи не пересоздаются (тот же объект) — ничего не теряется.
- В `openProfile` (IDB): санированный профиль записывается обратно в том же readwrite-транзакции, `revision` не меняется.
- В локальном fallback `open()`: санированный профиль пишется обратно в `briix-studio-sessions-v1-<nick>`.
- Значение `schemaVersion` и существующие валидные записи не трогаются.

### 2. Оборона в `studio/studio.js` (минимальные guard)
- `startSession()`: если `activeSession` не нашёлся или битый (нет `id`/`feed` не массив) — создаётся `newSessionRecord()` вместо краша; та же защита добавлена в `reloadProfileInPlace()` (та же семья restore-путей).
- Четыре места чтения `.title` + рендер списка: `renderSessions()` (`session?.title`, плюс `continue` для мусорной записи и guard дат), `renderOpsBadge()` (`session?.title`), пункт меню библиотеки «Открыть сессию: …» и подпись «Сессия: …» (`sourceSession?.title || 'Новый чат'`).

### 3. Регресс-тесты
- `tools/check-session-store.cjs`: сценарий «профиль с [null, запись-без-id-и-title, битая-без-feed/history, валидная]» → `openProfile()` возвращает 3 санированные записи (id и валидный title сохранены, дефолтный title проставлен где надо), валидная запись не тронута (deep-equal), санированный профиль записан обратно, `revision` не изменился; тот же сценарий на локальном бэкенде. Попутно: сервер сюиты теперь отдаёт JS с `charset=utf-8` (кириллический дефолтный title в скрипте иначе читался как mojibake).
- `tools/check-studio.cjs`: сквозной сценарий через гейт входа — в IDB сеется профиль `[null, битая, валидная]` с `activeSessionId` битой записи, логин «сломан»/PIN → студия открыта, баннер `#storageWarning` пустой и скрыт, в хранилище 2 санированные записи, список сессий показывает «Живой чат», переход в него восстанавливает ленту.

## Файлы
- `studio/session-store.js`
- `studio/studio.js`
- `tools/check-session-store.cjs`
- `tools/check-studio.cjs`
- `audits/task-23-restore-null-session.md`

## Проверено
- Все 8 сюит зелёные (`NODE_PATH=/opt/homebrew/lib/node_modules`): check-session-store, check-studio (74 checks), check-assembly, check-studio-storage, check-waveform, check-producer, check-wait-phrases, check-cache-selfheal. Сборочный отпечаток совпал с `version.json` — перегенерация не понадобилась, `version.json`/`index.html` не тронуты.
- `node --check` на обоих правленых JS — чисто.

## Непроверенное
- Реальный прод-профиль владельца: проверено синтетическими битыми записями в Chromium (Playwright), но не на живых данных владельца — после деплоя стоит дождаться подтверждения, что лента открылась.
- Поведение при одновременной санитизации из двух вкладок покрыто существующими тестами блокировок только косвенно (put идёт в существующей транзакции openProfile, конфликтов ревизий санитизация не создаёт — revision не инкрементится), явного двухвкладочного теста именно для санитизации нет.
- Firefox/Safari не запускались (сюиты идут на Chromium); `crypto.randomUUID` используется уже в `newSessionRecord()` студии, так что новой зависимости нет.

## Дожим по ревью PR #25 (находка-1: null-элементы внутри feed)
- `session-store.js`: `sanitizeSession` теперь чистит null/мусорные ЭЛЕМЕНТЫ внутри `feed` и `history` валидных записей (фильтр `item && typeof item === 'object'`) — раньше профиль с `feed: [null]` проходил санитизацию записей и ронял бут на `ensureRoot` (`item.t` у null).
- `tools/check-session-store.cjs`: регресс-ассерт — валидная сессия с `feed: [null, {t:'user',text:'x'}, 'мусор-строка']` и `history: [null, {role:'user',…}]` → после `openProfile()` остаётся только валидный элемент в каждом массиве.
- check-session-store и check-studio (74 checks) — зелёные. Первый прогон check-studio упал по таймауту (разовый флак); два повторных прогона полностью зелёные, к правкам это не относится.
