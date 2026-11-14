# Аудит: взаимодействие в режиме «Музыка» студии — маршрутизация отправки и наставники

Дата: 14.11.2026. Код: briix-studio @ main (36744dc), файлы `studio/studio.js`, `studio/producer-brain.js`, `studio/music-brain.js`, `server-contract/bff.py`. Аудит только по коду и git-истории; в браузере не открывал. Никаких правок поведения — только факты.

## 1. Dispatch отправки: в music mode путь к чату через основной send отсутствует

Точка входа — кнопка send:

- `studio/studio.js:1924` — `els.send.addEventListener('click', create);`
- `studio/studio.js:696-703` — функция `create()`:

```js
async function create() {
  ...
  const text = promptValue();
  if ((!text && !(mode === 'music' && advanced && els.lyrics.value.trim())) || (mode === 'chat' && chatActive)) return;
  if (mode === 'chat') return createChat(text);
  if (mode === 'photo') return createPhoto(text);
  return createMusic(text);
}
```

Маршрутизация — строго по глобальной переменной `mode` (`studio/studio.js:234`, значения `chat|photo|music`, переключение `setMode` → `renderChrome`). Для `mode === 'music'` безусловный `return createMusic(text)` (`studio/studio.js:702`). Ветки на `createChat` в music mode нет; других вызовов `createChat` в файле нет — он доступен только из `create()` при `mode === 'chat'` (`studio/studio.js:700`). Подтверждено: **в music mode через основной send невозможно попасть в чат-поток**.

Ввод (Enter) тоже ведёт в тот же `create`: `studio/studio.js:2010` — `els.prompt.addEventListener('keydown', ...)` вызывает отправку (та же кнопка send).

`promptValue()` (`studio/studio.js:651-653`): в music mode с включённым «Тонко настроить» (`advanced`) берётся `els.musicPrompt`, иначе `els.prompt` (`activePromptEl()`, `studio/studio.js:647-649`).

## 2. Судьба произвольного текста («напиши мне стихи про осень») в music mode

Любой текст уходит в `createMusic(description)` (`studio/studio.js:852`). Трассировка для текста без «Тонко настроить» (advanced=false):

1. `rawIdea = description` (`studio/studio.js:859`), `style = BriixProducer.sanitize(rawIdea)` (`:860`) — sanitize снимает только markdown-обрамление/служебные обёртки, смысл не меняет.
2. Если vocal (не инструментал) и лирика пуста — автолирика: `lyrics = await autoLyrics(style || lyrics || 'песня', ...)` (`studio/studio.js:920-922`). `autoLyrics` (`:824-850`) шлёт текст в chatStream (тот же `/v1/chat/completions`) со **своим** system-промптом «Ты — автор песен…» (`:832-836`) — не `ASSISTANTS.music`. Тема «напиши мне стихи про осень» уходит как `Тема песни: напиши мне стихи про осень` (`:837`) — модель напишет песню про осень, диалога не будет.
3. Brain-ступень применяется **безусловно к любому тексту**: `BRIIX_MUSIC_BRAIN.buildTags(style || lyrics || '', {kind, language, bpm})` (`studio/studio.js:939-943`).
4. Не-ASCII (русский) текст → `translatePrompt` (`:948-955`, `:818-822`) — перевод через producer-чат `BriixProducer.translateMessages` (`producer-brain.js`), затем `mergePromptTags(fluent, brain.tags)`; при отказе перевода — `brain.tags || style`.
5. Итог: `submitJob({ type: 'music', prompt: finalPrompt, params })` (`studio/studio.js:975`), `params = { model: ace-step-flash|pro }` + `instrumental`/`lyrics` (`:968-970`).

То есть **да**: «напиши мне стихи про осень» немедленно превращается в music-джобу (автолирика → brain-теги → перевод → submitJob). Ни на одном шаге нет ветки «это разговор — ответить текстом».

## 3. «Подготовить песню / трек» (producer path) — отдельная кнопка, не основной send

- Кнопка: `els.prepareMusic`, `studio/index.html:120` (класс `producer-entry music-only`), обработчик `studio/studio.js:1925`, функция `prepareMusic()` `studio/studio.js:1084-1132`. Доступна только в music mode (`:1085`: `mode !== 'music'` → return).
- Вызов модели: `chatNonStream({ messages: BriixProducer.messages({...}), maxTokens: 1800 })` (`studio/studio.js:1109-1110`).
- System-промпт: **свой, в producer-brain.js** — `producer-brain.js:7-18` («Ты музыкальный продюсер BRIIX. Подготовь черновик…»), требует JSON `{title, prompt, lyrics}` (`producer-brain.js:20-25`).
- **Выбранный наставник из чипа не используется**: в `prepareMusic` и `BriixProducer.messages` нет ни `currentAssistant()`, ни `ASSISTANTS.music` — grep подтверждает единственные использования `currentAssistant()`: `studio.js:399` (метка в meta), `:638` (подпись чипа), `:709` (createChat), `:1285` (improvePhoto).
- Результат — карточка-черновик «Музыкальный продюсер · черновик» (`studio/studio.js:1134+`); кнопка «Принять в поля студии» (`:1204-1223`) заполняет `els.musicPrompt`/`els.lyrics` и включает `advanced = true`. Генерация всё равно запускается отдельно кнопкой send: «Поля заполнены. Проверьте их и отдельно нажмите „Создать“» (`:1222`).

Чип-наставник «Продюсер» из `ASSISTANTS.music` и system-промпт `producer-brain.js` — два разных, не связанных промпта.

## 4. Наставники ASSISTANTS.music — мёртвый UI в music mode

`ASSISTANTS` объявлен `studio/studio.js:22-41`; music-список (`:36-40`): Продюсер, Лирик, Автор песни. `currentAssistant()` (`:392-394`): `ASSISTANTS[mode].find(a => a.id === assistantId[mode])`.

Все использования `currentAssistant()`:

| Место | Назначение | Достижимо в music mode? |
|---|---|---|
| `studio.js:399` (`meta()`) | строка статуса; для music там вместо наставника подставляется модель (`:399-400`: `if (mode === 'music') bits.push(MODEL_LABELS[quality])`) | нет (не используется) |
| `studio.js:638` (`renderChrome`) | подпись чипа наставника | чип виден, но имя — только отображение |
| `studio.js:709` (`createChat`) | system-промпт в messages | нет — createChat достижим только при mode='chat' |
| `studio.js:1285` (`improvePhoto`) | system-промпт «Улучшить» фото | нет — кнопка photo-only (`index.html:131`, `updateEnabled:662`) |

Чип наставника (`studio/index.html:134-138`) не имеет класса `*-only` — виден во всех трёх режимах, меню строится из `ASSISTANTS[mode]` (`studio/studio.js:454-456`). В music mode выбор «Продюсер/Лирик/Автор песни» меняет только `assistantId.music` и подпись чипа — **ни один system-промпт `ASSISTANTS.music` нигде не отправляется в модель**. Наставник-чип в music mode — функционально мёртвый UI.

Дополнительно: единственный мост из чата в музыку — кнопка «🎵 Сделать из этого трек» под ответом чата (`addMakeTrackAction`, `studio/studio.js:569-583`): переключает `setMode('music')` и подставляет бриф в `els.prompt` (`advanced=false`) — после чего следующий send уйдёт в createMusic.

## 5. «Улучшить» в «Тонко настроить»

- Кнопки `improveLyrics` / `improvePrompt` → `improve('lyrics'|'prompt')` (`studio/studio.js:1926-1927`, функция `:1242-1263`) → `improveText(fieldText, kind)` (`:195-209`).
- `improveText` строит **свой** system-промпт (`:202-207`: «Ты редактор музыкальной студии BRIIX…») с few-shot из `assets/data/creative-base.json` (5 случайных примеров, `:196-200`), запрос через `chatNonStream` (`:208`).
- Выбранный наставник не используется (в music mode ассистенты из чипа, как показано в п.4, вообще нигде не применяются).
- Отдельно: «✨ Улучшить» в photo mode (`improvePhoto`, `:1274-1300`) — единственное место вне chat, где используется `currentAssistant()` (`:1285`), т.е. photo-наставники (Арт-директор / Визуальный дизайнер) живут только там.

## 6. Чат-режим: музыкальные наставники недостижимы

`ASSISTANTS` — объект, ключёванный по режиму (`studio/studio.js:22-41`): в `chat` — Наставник/Универсальный/Редактор/Аналитик/Разработчик/Маркетолог/Наставник (обучение); музыкальных в чат-списке нет. `currentAssistant()` читает только `ASSISTANTS[mode]` (`:393`), `attachMenu` показывает только `ASSISTANTS[mode]` (`:454`). Переключение режима — единственный способ сменить список. Подтверждено: **из chat mode до Продюсера/Лирика/Автора песни не добраться** (кроме кнопки «Сделать из этого трек», которая переводит в music mode, где чат недоступен — п.1, п.4).

## 7. История решения (git, репо briix.ru)

- `fbbd2c1` 2026-11-09 «feat(studio): отдельный экран Студии — чат/фото/музыка на приватной шине» — **самая первая версия studio.js уже содержала трёхветочный dispatch**: `if (mode === 'music') return createMusic();` (строка 303 в файле того коммита). Т.е. music mode **никогда не был чат-ориентированным** — «чат-центричного» периода у music-режима студии не существовало; feed был лентой с самого начала.
- `06a5b4a` 2026-11-09 «Переработать Студию: живая лента и независимая очередь» — развивает ту же модель (dispatch сохранён).
- `90da875` 2026-11-14 «Add opt-in music producer drafts to studio» — добавлен producer path (`prepareMusic`, producer-brain.js) как отдельная opt-in кнопка, не как замена dispatch.
- `c84772c` 2026-11-14 «Вынос студии из briix.ru (issue briix.ru#107)» — studio переехала в репо briix-studio; `87ed30c` 2026-11-14 — studio/ в briix.ru заменён редирект-стабом.
- В briix-studio: `90c019c` 2026-11-14 (assembly #109) добавил brain-ступень `BRIIX_MUSIC_BRAIN.buildTags` и перевод в `createMusic` — усилил «любой текст → промпт», поведение отправки (create→createMusic) не менялось ни разу.

`git log -S "return createMusic"` по трём путям studio.js показывает ровно два коммита: fbbd2c1 (создание) и 87ed30c (удаление при выносе) — dispatch не переписывался.

## 8. Серверная сторона: chat и music независимы

Контракт — `server-contract/bff.py` (снимок media-bff):

- **Chat**: `POST /v1/chat/completions` (`bff.py:1527`, handler `chat_completions` `:796+`) — прокси в локальный Ollama `OLLAMA_TEXT = http://127.0.0.1:11436`, модель `TEXT_MODEL = "qwen3:4b-instruct"` (`bff.py:42-43`). Факт: на текущем стенде текстовый бэкенд — qwen3:4b через Ollama, а не GLM (GLM в контракте не упоминается; упоминание GLM в вопросе владельца не подтверждается кодом). SSE-стрим и non-stream — оба через `/api/chat` Ollama (`:830-844`).
- **Music**: `POST /jobs` (`bff.py:1517`, `create_job` `:440+`) — очередь jobs.json + поллинг `GET /jobs/{id}`. type=music с `params.model=ace-step-flash|pro` — vocal-route: пайплайн `ace-lm → ace-synth` (ACE-Step, `bff.py:44-54`, `:979+`); с `instrumental=true` или без model — MusicGen (`:453-459`). Лирика обязательна для vocal (`:467-471`).
- Два маршрута раздельны: модерация у обоих своя (`moderate_or_block` — chat с `llm=False` `:810`, jobs с полной `:453`), thread-budget общий (`THREAD_BUDGET`, `:36`), но пайплайны, лимиты и модели не пересекаются. Клиентский `chatNonStream`/`chatStream` (studio.js) используется и для «настоящего» чата, и как вспомогательный LLM-конвейер внутри createMusic (автолирика `:843`, перевод `:820`) и producer-черновика (`:1109`) — т.е. музыкальный путь зависит от текстового бэкенда как сервиса, но не от chat-фич студии.

## Итог: доступность разговорной работы по режимам

| Режим | Разговорный диалог (chatStream/NonStream с system наставника) | Генерация медиа |
|---|---|---|
| Чат | Да — createChat, единственное место с `ASSISTANTS`-наставником (studio.js:709) | Нет (только кнопка «Сделать из этого трек» → уходит в music) |
| Фото | Только косвенно: «✨ Улучшить» (improvePhoto, :1285) с system photo-наставника; диалога нет | createPhoto → /jobs |
| Музыка | **Нет** — createChat недостижим; все LLM-вызовы (автолирика, перевод, producer-черновик, «Улучшить») одноразовые со встроенными system-промптами, ответы не ведут диалог | createMusic → /jobs (безусловный путь любого текста) |

Непроверенное: поведение в живом браузере (demo.briix.ru/studio/) не проверялось — всё выведено из кода 36744dc; фактическое состояние прод-деплоя стенда не сверялось.
