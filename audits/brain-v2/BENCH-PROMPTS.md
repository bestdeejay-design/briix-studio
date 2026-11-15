# BENCH-PROMPTS — «его мозг vs мой альбом» (фаза 2, 12 треков)

> Issue [#20](https://github.com/bestdeejay-design/briix-studio/issues/20), §7.
> Референс: ветка `brain-v2-reference` → `audits/brain-v2/REFERENCE-ALBUM.md`
> (VELVET STATIC, 12 треков). Генерация: `tools/bench-captions.cjs`
> (собирает `bench/prompts-12.json`), запуск A/B — `tools/bench-ab.cjs`.
> **Статус: промты собраны, генерация НЕ выполнена** — media-bff доступен только
> на стенде владельца (см. `bench/README.md`, `docs/MAIL.md`).

## 0. Правила честности

1. **Вокал зафиксирован.** У A и B одинаковый блок VOCAL-CONST (единый
   исполнитель). Значит, вокальный слой мозга в этом бенчмарке **не участвует**:
   `buildCaption` вызывается со `skipBlocks: ['voice.gender','voice.character']`.
   Это осознанное сужение — иначе сравнение грязное.
2. **Ни одной английской формулировки владельца в B.** Вход для мозга — русская
   задумка (`ruBrief` в `bench/briefs-12.json`), написанная мной по смыслу лирики.
   Совпадения возможны только там, где это неизбежно (жанр «psychedelic soul»,
   `live bass guitar`, `organ` — это факты сонического мира, а не украшения).
3. **Сониковый контекст одинаковый.** В задумку B входит то же, что у A вынесено
   в SONIC-CONST: психоделик-соул, живая бас-гитара впереди микса, Hammond с
   Leslie, плёнка/аналог, глубокий низ, волновая динамика с почти-тишиной.
   У A это блок из ~377 символов, у B — русская фраза-вход (≈280 символов).
4. **Бюджеты не подгонялись.** A: VOCAL-CONST (239) + SONIC-CONST (377) + строка
   трека → **705–776 символов**. B: VOCAL-CONST (239) + caption мозга
   → **459–540 символов**. То есть B короче на 25–30 %: если он выигрывает,
   выигрывает за счёт точности, а не объёма.
5. **Одна и та же лирика.** `bench/lyrics-12.json` — тексты владельца, общий вход.
6. **Слепое прослушивание.** `track-NN-x.wav` / `track-NN-y.wav`, ключ — в
   `bench/KEY.md`, открывается только после голосования.

## 1. Сводка

| # | Трек | A, симв. | B, симв. | Ритм-слой B (чего нет в A) | Что B указывает иначе |
|---|---|---|---|---|---|
| 01 | Sign-On | 746 | 540 | `slow tight drum groove (kick + snare + ride)` | состав кита; `tight mix`; `pirate radio studio` как место |
| 02 | Fog-Ledger | 713 | 514 | `soft drum groove (brushed drums, kick + snare + ride)` | метёлки названы частью состава, а не отдельным словом |
| 03 | Salt in the Wires | 763 | 472 | `rolling hypnotic drum groove (k+sn+r)` | `rhythmic organ stabs` — отдельным слоем, не «organ-driven flow» |
| 04 | Caller 03:14 | 744 | 467 | `hypnotic drum groove` | call-and-response в B нет — уступил общему гипнотизму (см. §3.4) |
| 05 | The Velvet Public | 758 | 498 | `soft hypnotic drum groove (k+sn+r)` | `swirling organ` + `foggy room tone` вместо «gentle organ swirls, mood:» |
| 06 | Deep Water Frequency | 776 | 471 | `heavy hypnotic drum groove (k+sn+r)` | `deep sub-bass` отдельным тегом; нет «bass carries the melody» |
| 07 | Interference Prayer | 725 | 477 | `soft rolling drum groove (k+sn+r)` | `radio static` как атмосфера + `hypnotic` тегом |
| 08 | Room Above the Radio | 706 | 476 | `sparse drum groove (k+sn+r)` | `studio room tone` вместо «close-mic warmth» |
| 09 | Ghosts of the Harbour Choir | 746 | 503 | `slow hypnotic drum groove (k+sn+r)` | `deep low end` + `foggy room tone`; хор призраков не назван |
| 10 | Sign-Off Delayed | 705 | 462 | `slow tight drum groove (k+sn+r)` | `tape echo delay` вынесен в продакшн-цепочку |
| 11 | The Tape That Outlives Us | 728 | 503 | `slow soft drum groove (k+sn+r)` | `reverse tape textures`; wow-and-flutter пока не в словаре |
| 12 | Sign-Off, Finally | 741 | 459 | `slow drum groove (k+sn+r)` | `slow build` + `radio static`; `organ swell` не выведен |

## 2. Полные строки B (трек-специфичная часть)

Общий префикс (для всех 12, это VOCAL-CONST):
`deep low male voice, hypnotic hoarse whisper flowing into melodic rasp, whisper-sung throughout, intimate confessional delivery, chest voice always, register never rises, layered whisper backing vocals in choruses, haunting and mesmerizing,`

| # | B (после префикса) |
|---|---|
| 01 | psychedelic soul, slow tight drum groove (kick + snare + ride), 72 BPM, live bass guitar, organ, slow Leslie speaker, radio static, analog warmth, tight mix, AM radio broadcast texture, pirate radio studio, wave dynamics, near-silent suspensions before drums re-enter, lyrics about radio and harbour |
| 02 | psychedelic soul, soft drum groove (brushed drums, kick + snare + ride), 76 BPM, live bass guitar, organ, slow Leslie speaker, foggy room tone, analog warmth, tape saturation, wave dynamics, near-silent suspensions before drums re-enter, dreamy, lyrics about fog and dreams |
| 03 | psychedelic soul, rolling hypnotic drum groove (kick + snare + ride), 84 BPM, live bass guitar, slow Leslie speaker, rhythmic organ stabs, analog warmth, tape saturation, wave dynamics, near-silent suspensions before drums re-enter |
| 04 | psychedelic soul, hypnotic drum groove (kick + snare + ride), 90 BPM, live bass guitar, organ, slow Leslie speaker, analog warmth, tape saturation, studio room tone, wave dynamics, near-silent suspensions before drums re-enter |
| 05 | psychedelic soul, soft hypnotic drum groove (kick + snare + ride), 96 BPM, live bass guitar, slow Leslie speaker, swirling organ, foggy room tone, analog warmth, tape saturation, wave dynamics, near-silent suspensions before drums re-enter, lyrics about fog |
| 06 | psychedelic soul, heavy hypnotic drum groove (kick + snare + ride), 102 BPM, live bass guitar, deep sub-bass, organ, slow Leslie speaker, analog warmth, tape saturation, wave dynamics, near-silent suspensions before drums re-enter |
| 07 | psychedelic soul, soft rolling drum groove (kick + snare + ride), 88 BPM, live bass guitar, slow Leslie speaker, organ, radio static, analog warmth, tape saturation, wave dynamics, near-silent suspensions before drums re-enter, hypnotic |
| 08 | psychedelic soul, sparse drum groove (kick + snare + ride), 84 BPM, live bass guitar, organ, slow Leslie speaker, analog warmth, tape saturation, studio room tone, wave dynamics, near-silent suspensions before drums re-enter, emotional |
| 09 | psychedelic soul, slow hypnotic drum groove (kick + snare + ride), 78 BPM, live bass guitar, deep low end, organ, slow Leslie speaker, foggy room tone, analog warmth, tape saturation, wave dynamics, near-silent suspensions before drums re-enter, lyrics about fog |
| 10 | psychedelic soul, slow tight drum groove (kick + snare + ride), 72 BPM, live bass guitar, organ, slow Leslie speaker, analog warmth, tight mix, tape echo delay, wave dynamics, near-silent suspensions before drums re-enter |
| 11 | psychedelic soul, slow soft drum groove (kick + snare + ride), 66 BPM, live bass guitar, organ, slow Leslie speaker, analog warmth, reverse tape textures, tape saturation, wave dynamics, near-silent suspensions before drums re-enter, emotional, lyrics about tape |
| 12 | psychedelic soul, slow drum groove (kick + snare + ride), 60 BPM, live bass guitar, slow Leslie speaker, organ, radio static, analog warmth, tape saturation, wave dynamics, slow build, near-silent suspensions before drums re-enter |

A по каждому треку = VOCAL-CONST + SONIC-CONST + строка трека из
`REFERENCE-ALBUM.md` (см. `bench/prompts-12.json`, поле `promptA`; строка трека —
`referenceTrackLine` в `bench/briefs-12.json`).

## 3. Обоснование расхождений — что я указал иначе и почему жду лучший результат

### 3.1. Состав кита в скобках — у B во всех 12 треках, у A — один раз

A: `slow tight drum groove with ride cymbal` (трек 1), `soft deep drum groove` (2),
`rolling hypnotic drum groove` (3) — характер есть, **состава нет**.
B: `slow tight drum groove (kick + snare + ride)` и т.д.

*Почему жду лучшего:* корпус — топ-промт `BREATH IS VOW` (score 407) содержит
именно `tight drum groove (kick + snare + ride)`; доля промтов с составом кита в
топ-100 — 25 % против 14,5 % по корпусу. Без состава модель свободна заменить
рейд на шейкер, и «сонный портовый» грув теряет воздух. Риск: перечисление
занимает ~30 символов бюджета.

### 3.2. Характер грува привязан к намерению трека, а не к «deep»

A повторяет `deep` в большинстве строк (`soft deep`, `round deep`, `very slow deep`).
B разводит: `sparse` (8 — комната, разреженность), `heavy` (6 — гимн глубины),
`rolling` (3, 7), `tight` (1, 10), `soft` (2, 5, 11).

*Почему жду лучшего:* `deep` — про низ, который уже задан SONIC-CONST/басом;
в позиции характеристики кита он ничего не различает между треками, а альбом
задуман как BPM-волна с разными состояниями.

### 3.3. Динамика вынесена в caption, а не спрятана в общем блоке

A: `soft dynamics with near-silent suspensions before drums re-enter` живёт внутри
SONIC-CONST — то есть звучит один раз и в середине длинного перечисления.
B: `wave dynamics, near-silent suspensions before drums re-enter` — отдельными
маркерами ближе к концу, но ДО концепт-строки.

*Почему жду лучшего:* динамика — самый сильный признак в корпусе (29 % топ-100
против 7 %), но она должна читаться как указание к форме, а не как описание
характера. Риск: дублирование с SONIC-CONST у A — если модель и так получила
этот маркер, выигрыша не будет, а бюджет сгорит.

### 3.4. Концепт-строка: у A — образ, у B — ключевые слова

A: `mood: secret ballroom, everyone dancing in fog`, `inventory of sleepless
things`, `the frequency sleeps` — поэтические строки.
B: `lyrics about fog and dreams`, `lyrics about radio and harbour`, `lyrics about
tape` — грубый маппинг ключевых слов.

**Это самое слабое место B, и я это признаю заранее (§3.5).** Но по корпусу
концепт-строка в топ-100 встречается в 3 раза чаще, чем в среднем (25 % против
8 %), а «mood:»-перечисления — это конструкция FUZZ-эпохи. Проверяем гипотезу:
работает ли явная тема («lyrics about …») не хуже, чем поэтическая строка.

### 3.5. Где B, скорее всего, проиграет (честный прогноз)

| Трек | Почему A может выиграть |
|---|---|
| 02 Fog-Ledger | «inventory of sleepless things» — уникальный образ, B даёт `dreamy, lyrics about fog and dreams` |
| 04 Caller 03:14 | `call-and-response drum pattern` + `telephone-line hum texture`; B потерял call-and-response (словарь сработал на общий «гипнотичный паттерн») |
| 05 The Velvet Public | «secret ballroom, everyone dancing in fog» — сцена, которой у B нет |
| 09 Ghosts of the Harbour Choir | «layered whisper choirs low in the mix, distant foghorn texture» — хор призраков B не назвал |
| 11 The Tape That Outlives Us | `gentle wow and flutter` — в словаре B нет wow-and-flutter (есть только reverse tape) |
| 12 Sign-Off, Finally | `dissolving into organ swell` — B дал `slow build`, но не `organ swell` |

То есть гипотеза бенчмарка узкая и проверяемая: **B ставит на ритм-состав,
подачу продакшна и явную динамику; A — на образ и сцену.** Если B побеждает на
6+ треках, значит для ACE-Step важнее первые; если проигрывает — усилить надо
концепт-слой (образы и сцены), а не ритм.

### 3.6. Что B не делает сознательно

- Не копирует `no climax`, `no falsetto`, `no reverb` из промтов A: у ACE-Step
  нет негативного поля (RESEARCH_PACK §2, S2/S8); у B вместо запретов —
  `chest voice, register never rises` (в VOCAL-CONST) и позитивные маркеры.
- Не пишет `VOCAL-CONST`/`SONIC-CONST` плейсхолдерами: в `bench/prompts-12.json`
  оба блока раскрыты в полные строки, чтобы генератор не спотыкался.
- Не добавляет бренды, имена, `(x3)` и прочие запреты `prompt-rules.md`.

## 4. Как будет считаться результат

1. Владелец слушает `bench/out/track-NN-x.wav` и `-y.wav` вслепую (12 пар).
2. Голосует по каждому треку: x / y / ничья.
3. Открывается `bench/KEY.md`, считается счёт.
4. Критерий успеха (§7 issue): B побеждает на большинстве треков → апгрейд
   мозга продуктивен. Проигрыш — не провал, а точный список слоёв на усиление
   (см. §3.5).

## 5. Воспроизведение

```bash
node tools/bench-captions.cjs           # пересобрать bench/prompts-12.json + таблицу
node tools/bench-ab.cjs --dry-run       # план генерации (без стенда)
MEDIA_BFF_URL=… MEDIA_BFF_TOKEN=… node tools/bench-ab.cjs   # реальная генерация
```
