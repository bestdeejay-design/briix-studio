# Ревью PR briix-studio#10 — вариант B «Студия-агент» (feat/studio-agent-b, c0bc617)

VERDICT: **PASS с минорными замечаниями. Мажоров нет.** Все обязательные решения владельца
реализованы и подтверждены тестами; все чек-сюиты лично прогнаны в чистом клоне — PASS.
Живой GLM-трафик и серверная запись params.title/artist в теги M4A — вне зоны ревью (контрактное
ожидание, INFRA-задача параллельно).

Ревьюер: независимый саб (ADR-0002). Дата: 14.11.2026. Клон: /tmp/review-b, checkout
origin/feat/studio-agent-b (c0bc617), база d5832fa = origin/main (проверено: main внутри ветки).

## 1. Лично прогнанное (в моём worktree, не со слов агента)

| Проверка | Результат |
|---|---|
| `check-studio` (NODE_PATH, playwright) | **PASS, 49 проверок** — включая «send in music mode does NOT create a job», «mentor system prompt actually used», «draft Generate creates exactly one job», «promptReady path skips silent translation», «music dialog persisted in session-store» + reload, «mobile 320x568 bottom sheet inside viewport» |
| `check-assembly` | PASS (sanitize, языковое правило, brain-ступень, guards) |
| `check-producer` | PASS |
| `check-session-store` | PASS (миграция, бэкап, изоляция, конфликты) |
| `check-studio-storage` | PASS |
| `check-waveform` (NODE_PATH) | PASS (auto-attach, click-seek, a11y-слайдер, бюджеты, fallback) |
| `node --check` studio.js / waveform.js / music-brain.js / session-store.js | OK |
| Конфликт-маркеры `^(<{7}|={7}|>{7})` по studio/ и tools/ | пусто |
| CSS-скобки studio.css | 312/312 |
| `params.duration` | отсутствует в studio.js и в jobPosts тестов (assert в check-studio:1105) |
| `[hidden] { display:none !important }` | на месте (1 правило в шапке studio.css) |
| Зашитые цвета вне токен-блока | 0 (после строки 40 — чисто; waveform берёт `--accent`/`--faint` через cssVar с фолбэком) |
| Внешние CDN/скрипты | нет (единственный http:// — DEFAULT_SERVER для localhost-стенда) |

Скриншоты audits/screens/ (6 шт) просмотрены: на 390 — карточка трека с обложкой в состоянии
playing (⏸ поверх), волной, «Что уехало в модель»; на 320 — draft-блок с «Принять в поля» /
«Сгенерировать трек»; меню «⋯» = ровно 7 пунктов bottom-sheet внутри 320×568. Оценка —
«собранный компонент присутствует», не свидетельство качества.

## 2. Ключевые решения — сверка с контекстом

- **send в music mode = разговор** (studio.js:864-868): Simple → `createMusicChat`, advanced
  («Тонко настроить») → прежний `createMusic`. Тестом подтверждено: 0 джоб при send.
- **«Сгенерировать трек» — отдельная кнопка**: `#genTrack` в композере (index.html:153,
  studio.js:2322-2326) + кнопка в draft-блоке. Джоба ровно одна (check-studio:1195).
- **Наставник получает СВОЙ system** (studio.js:997): `assistant.system` выбранного из
  ASSISTANTS.music (продюсер/лирик/автор), без хардкода; assert по содержимому перехваченного
  POST (check-studio:1175).
- **Контекст**: snapshot полей (studio.js:936-941, читается на каждый send — актуален) + история
  `.slice(-40)`, наращивается ровно один раз за завершённый ход (studio.js:1014), дублей нет.
  Смена наставника сбрасывает `musicChat` (чип: studio.js:471-474; и guard в createMusicChat:974).
- **Stop (✕)**: `makeCancelHandle()` на карточку (studio.js:985) — гасит только свой стрим; abort
  не пишет ход в history (корректно: оборванный ответ не попадает в контекст).
- **Принять = бэкап+откат** (studio.js:1082-1099): `entry.backups` + persist ДО записи полей
  (неудачный persist = поля не тронуты, studio.js:1092) + «Вернуть поля». Правки пользователя в
  полях draft-блока читаются из `promptField.value` — не теряются даже без «Принять»
  (generate делает writeFields из актуальных значений, studio.js:1116).
- **Персистентность**: `musicChat` и `music_draft`-entries живут в session.store целиком
  (session-store не вайтлистит поля); feedRestore рендерит draft-карточки после reload
  (studio.js:318-319); check-studio:1202-1211 подтверждает history/drafts в IDB и после reload.
- **Карточка трека**: обложка=PLAY c keyboard/aria (studio.js:581-594); waveform auto-attach
  на onloadedmetadata (waveform.js:111-113) — декод только в бюджетах (8 МиБ / 60 с / 32 МиБ PCM),
  вне бюджета — текстовый fallback, плеер живёт; меню «⋯» ровно 7 действий (studio.js:694-702),
  все с рабочими привязками (favorite с серверным флагом, delete с confirm и revoke);
  nodownload на всех `<audio>` (studio.js:1372, 340).
- **params.title/artist** (studio.js:1352-1353): title = черновик → первая строка лирики →
  fallback по дате, sanitize+лимит; artist = `currentUser()` (ник из gate, до логина studio
  закрыт gate — обхода нет). Filename `safeFileName` (studio.js:598-606): кириллица сохранена,
  спецсимволы ФС вырезаны, fallback `briix-track-<дата>`. Контракт задокументирован в
  server-contract/README.md.
- **Прежние пути**: dispatch ветвит, не переписывает; improve ✨ / prepareMusic / make-track /
  repeatMusic не тронуты дифом; brain-конвейер и языковое правило — check-assembly PASS.

## 3. Гонки

- Двойной клик «Сгенерировать»: `runOnce` + disable трёх кнопок (studio.js:1066-1071) — джоба
  не двоится (и тестом подтверждено).
- Параллельные createMusicChat + createPhoto: `musicChatActive` блокирует только диалог,
  медиа-джобы не блокируются — по дизайну; late-результат изолирован по session
  (check-studio:1134-1149).
- Смена ника mid-flight: fileBlob бросает `cancelled` при смене профиля (studio.js:1444);
  карточки пишутся в свою сессию по captured `session`.
- Logout с открытым диалогом: отказ при `runningOps > 0` (studio.js:1875) — диалог завершается
  или останавливается до выхода; персист до сброса (1876).
- Reload с незавершённым draft: draft-entries уже в feed (persist после каждого хода) —
  восстанавливаются; незавершённый стрим пропадает (как в chat mode, консистентно).

## 4. Находки

### Мажоры
Нет.

### Миноры
1. **studio.js:1110-1122 — «Сгенерировать трек» из draft при вокале с пустой лирикой запускает
   автолирику.** Контекст решений говорит «без автолирики», но это верно для promptReady-пути
   (промпт уходит как есть, перевода нет — подтверждено assert check-studio:1200). Если в draft
   лирика пуста (пользователь стёр) — createMusic уйдёт в writing-lyrics. Поведение
   консистентно с остальной студией и не теряет данные, но стоит помнить.
2. **studio.js:1114-1120 — микро-гонка pendingTrackTitle/pendingLyricsSource**: глобальные
   флаги выставляются, затем `await persistSessions()` до `createMusic`. Второй параллельный
   запуск генерации в этом окне мог бы перехватить title. Окно миллисекундное, обе кнопки
   задизейблены только в своей карточке — композерная #genTrack не задизейблена. Практический
   риск низкий.
3. **waveform.js:111 — auto-attach на всех треках**: для трека >60 с (или >8 МиБ) волна не
   строится и под плеером появляется постоянный текст «Форма звука недоступна…» без запроса
   пользователя. Бюджеты осознанные (сохранены прежние), но шум для длинных треков теперь
   автоматический. Косметика.
4. **320px (скриншот agent-b-320-music-chat.png)**: подпись «Сгенерировать тр…» в композере
   обрезается рядом с «Тонко настроить». Не ломает вёрстку (chip сжимается), но текст не читается
   целиком. Косметика.
5. **tools/check-wait-phrases.cjs — мёртвая сюита в этом репо (не регресс PR)**: ждёт
   `#main-content` и `#/music` — страницу briix.ru-демо, которой в briix-studio нет; FAIL и на
   origin/main (файл не менялся в PR, c84772c). Ложно красит CI, если сюита включена.
6. **studio.js:1019-1025 — оборванный (✕) ход диалога остаётся в DOM, но не пишется в feed/
   history**: после reload фрагмент исчезает. Консистентно с chat mode, не регресс.

## 5. Честно непроверенное

- **Живой GLM**: все чеки на мок-сервере; реальное поведение слабой модели (фолбэк
  `BriixProducer.parse` на «почти JSON», качество draft) не проверялось.
- **Серверная часть контракта**: запись params.title/artist в теги M4A и Content-Disposition —
  ожидание (INFRA параллельно); клиент от него не зависит, но фактической проверки нет.
- **Браузер вручную глазами** я не открывал — всё через прогон playwright-сюит и скриншоты агента.
- Реальные M4A-файлы стенда (decode fallback, 60-секундные треки) — только синтетика в тестах.
