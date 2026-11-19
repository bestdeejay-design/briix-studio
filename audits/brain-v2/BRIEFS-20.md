# 20 тестовых брифов — слоевой чек-лист против топ-промтов корпуса

> Issue [#20](https://github.com/bestdeejay-design/briix-studio/issues/20), §5:
> «20 тестовых брифов (10 из чатов владельца + 10 синтетических) — сравнение
> слоёв с топ-промтами корпуса по чек-листу».
>
> Источник брифов: `tools/fixtures/briefs-20.json`. Дословных логов чата
> 15–16.11 в репозитории нет (`.tmp-demo/` не закоммичен), поэтому 10 «владельческих»
> брифов восстановлены по кейсам, зафиксированным в issue и в тестах, — это указано
> в поле `case` и не выдаётся за цитату.
>
> Генерируется командой: `node tools/check-music-brain.cjs` (проверяет) и
> `node tools/bench-captions.cjs` (таблицы для бенчмарка).

## Чек-лист (формула топ-промтов корпуса, RESEARCH_PACK §5)

| Слой | Эталон корпуса (score 407–448) | Требование к v2 | Проверка |
|---|---|---|---|
| ANCHOR | `hypnotic psychedelic soul` | жанр всегда (слово задумки сильнее жанра формы) | есть в 20/20, где жанр был в брифе или форме |
| L3 VOICE | `brutal male baritone spoken-sung` | пол + подача + фактура + язык | 19/19 вокальных брифов (20-й — инструментал) |
| L2 RHYTHM | `tight drum groove (kick + snare + ride)` | характер + состав кита + BPM + низ | 20/20 |
| L1 SPACE | `vintage Hammond organ, tape saturation, analog warmth, vinyl crackle` | инструменты + продакшн-цепочка (+ место) | 20/20 |
| L3 DEPTH | `close dry drums, wide room behind`, `plate reverb on the snare` | глубина = контраст близко/далеко + приёмы стиля | 20/20 базовая пара; стиль узнан в 11/20 (в остальных жанра в брифе нет) |
| TAIL | `cold sensuality, surreal lyrics, no climax` → позитивно | динамика + настроение + концепт | динамика там, где автор её назвал; концепт — где были ключевые слова |

## Таблица прогона

| # | Источник | Кейс | buildTags / buildCaption, симв. | self-check | caption (buildTags, бюджет 240) |
|---|---|---|---|---|---|
| b01 | owner | «Лови» v2.1 — провал ночи 15–16.11 | 203 / 334 | ok | `psychedelic soul, deep bass voice, whispered delivery, chest voice, register never rises, Russian lyrics, tight drum groove (kick + snare + ride), tape saturation, analog warmth, flat dynamics, loop-like` |
| b02 | owner | check-assembly: живой факт владельца | 155 / 155 | ok | `male vocals, intimate delivery, English lyrics, heavy groove (kick + snare), bass, analog warmth, close vocal, distant room, atmospheric, lyrics about city` |
| b03 | owner | каркас лирики: дождь | 179 / 179 | ok | `male vocals, intimate delivery, English lyrics, steady drum groove (kick + snare), rain atmosphere, analog warmth, close drums, distant reverb wash, melancholic, lyrics about rain` |
| b04 | owner | клубный пик | 239 / 268 | ok | `tech house, female vocals, breathy tone, English lyrics, fast driving four-on-the-floor kick groove (909 drums, offbeat hi-hats), clean modern production, wide stereo mix, short room on the hats, dry kick in the foreground, chords far back` |
| b05 | owner | лоуфай для работы | 207 / 218 | ok | `lo-fi, male vocals, warm timbre, English lyrics, laid-back dusty drum loop (soft kick + snare, brushed hats), analog warmth, vinyl crackle, tape saturation, narrow mono mix, everything near and slightly dull` |
| b06 | owner | речитатив, борьба с фальцетом | 169 / 169 | ok | `male vocals, spoken word, hoarse rasp, English lyrics, broken drum beat (kick + snare), analog warmth, close drums, distant reverb wash, full-voice delivery, atmospheric` |
| b07 | owner | инструментал | 201 / 219 | ok | `ambient, instrumental, beatless drift without a drum kit (sub-bass pulse), space ambience, tape saturation, deep reverb space, slow evolving drone, one close detail against an endless tail, atmospheric` |
| b08 | owner | SONIC-CONST альбома VELVET STATIC | 212 / 325 | ok | `psychedelic soul, male vocals, intimate delivery, English lyrics, live tight drum groove (kick + snare + ride), tape saturation, analog warmth, tape echo on the guitar, dry upfront vocal over a distant plate tail` |
| b09 | owner | фанк-вечер | 194 / 215 | ok | `funk, male vocals, intimate delivery, English lyrics, live drum groove (kick + snare), analog warmth, bass staccato, kick locked to the bass line, close drums, wide room behind, 70s, atmospheric` |
| b10 | owner | баллада без реверберации | 219 / 256 | ok | `female vocals, tender delivery, English lyrics, slow sparse ballad groove (soft kick + brushes), cello, intimate close-mic production, long plate behind the piano, close piano, hall tail behind, dry close-mic production` |
| s11 | synthetic | пустой бриф: только жанр формы | 199 / 216 | ok | `lo-fi, male vocals, intimate delivery, English lyrics, laid-back dusty drum loop (soft kick + snare, brushed hats), tape saturation, vinyl crackle, tape hiss, close cassette room, no air, atmospheric` |
| s12 | synthetic | одно слово | 143 / 143 | ok | `male vocals, intimate delivery, English lyrics, steady drum groove (kick + snare), analog warmth, dry foreground, wide room behind, atmospheric` |
| s13 | synthetic | только пол голоса | 152 / 152 | ok | `male vocals, chest voice, register never rises, English lyrics, steady drum groove (kick + snare), analog warmth, close vocal, distant room, atmospheric` |
| s14 | synthetic | только подача | 137 / 137 | ok | `male vocals, whispered delivery, English lyrics, steady drum groove (kick + snare), analog warmth, close vocal, distant room, atmospheric` |
| s15 | synthetic | только фактура | 145 / 145 | ok | `male vocals, hoarse rasp, English lyrics, steady drum groove (kick + snare), analog warmth, front-to-back depth, near and far layers, atmospheric` |
| s16 | synthetic | только темп | 136 / 136 | ok | `male vocals, intimate delivery, English lyrics, steady drum groove (kick + snare), analog warmth, close vocal, distant room, atmospheric` |
| s17 | synthetic | только ритм-слова | 157 / 157 | ok | `male vocals, intimate delivery, English lyrics, steady drum groove (kick + snare), bass, analog warmth, front-to-back depth, near and far layers, atmospheric` |
| s18 | synthetic | перегруз: 600+ символов разнородных тегов | 221 / 637 | ok | `psychedelic soul, trip-hop, deep bass voice, whispered delivery, spoken word, hoarse rasp, falsetto, English lyrics, slow live percussion groove (congas, kick + snare + ride), tape saturation, analog warmth, vinyl crackle` |
| s19 | synthetic | трэп | 239 / 268 | ok | `trap, male vocals, intimate delivery, English lyrics, sparse hi-hat pattern (808 kick, triplet hi-hats), 808 sub bass, clean modern production, punchy low end, sparse arrangement with clear depth, dry vocal close, 808 tail far behind, dark` |
| s20 | synthetic | негатив «без ударных» | 180 / 201 | ok | `orchestral, male vocals, intimate delivery, English lyrics, beatless drift, low strings and room tone only, analog warmth, deep hall tail, close soloist, hall far behind, cinematic` |

## Разбор

**Слоевой чек-лист исполнен на 20/20.** Ни один бриф — включая пустой (s11),
одно слово (s12) и перегруз 600+ символов (s18) — не остаётся без ритм-слоя,
без характера вокала (кроме инструментала b07) и без продакшн-цепочки.

**v3 — «полный трек, а не три тега».** Помимо трёх базовых слоёв мозг слышит
роли инструментов, микс, форму во времени и защиту от дрейфа — но только если
автор об этом сказал. Это проверяется тестом «ничего не выдумываем»: на брифе
«песня» блоки ролей, микса и формы пусты. Обоснование — RESEARCH_PACK, вопрос 1.

**Где v2 сознательно расходится с топ-промтами корпуса:**

1. **Негативы.** У корпуса в топах есть `no climax`, `no falsetto`, `no reverb`
   (эпоха FUZZ). v2 их не пишет — перефразирует позитивно
   (`flat dynamics, loop-like`, `chest voice, register never rises`,
   `dry close-mic production`), потому что у ACE-Step нет негативного поля
   (RESEARCH_PACK §2, S2/S8).
2. **`mood:`-перечисления.** Корпус любит `mood: secret ballroom, everyone
   dancing in fog`. v2 отдаёт настроение тегами таксономии (`dreamy`, `hypnotic`,
   `cold`) и выносит тему отдельной концепт-строкой `lyrics about …`. Гипотеза
   проверяется бенчмарком (BENCH-PROMPTS §3.4).
3. **Длина.** Топ-промты корпуса — 402–448 символов (медиана топ-100 402).
   Компактный путь студии ограничен 240 (обратная совместимость #109), полный
   продюсерский caption — 640. Оба значения внутри технического потолка
   ACE-Step (256 токенов umT5).

**Известные ограничения (кандидаты на следующую итерацию):**

- концепт-строка — маппинг ключевых слов, а не образ: `lyrics about fog and
  dreams` вместо «inventory of sleepless things»;
- словарь не знает `wow and flutter`, «хор призраков», «бас ведёт мелодию»;
- тонкие наречия («вкрадчиво», «наотмашь», «исподтишка») уходят в дефолт;
- жанр не распознан → общий `steady drum groove` (задокументированный fallback).

## Проверки в CI

`node tools/check-music-brain.cjs` — 9 групп ассертов приёмки §5:
ритм всегда; вокал с характером и разные теги для шёпота/хрипа/речитатива;
продакшн всегда; перегруз-защита и бюджеты; 20 брифов; обратная совместимость
`buildTags`; негативы не инвертируются; `self-check` в `notes`; антифальцетный страж.
