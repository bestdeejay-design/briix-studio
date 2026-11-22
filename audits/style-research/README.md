# Ресерч-пакет #45: стилевые семейства из dj1-архива + жанрового ландшафта

**Статус:** ресерч-пакет для внешнего агента-кодера. Код мозга (music-brain.js / producer-brain.js) НЕ менялся.
**Объём:** 116 новых стилевых семейств (к текущим 26 → целевой паритет **142**), по одному файлу `families/NNN-<slug>.md` на семейство + машиночитаемый `index.json`.

## Как читать пакет

Каждый файл семейства даёт полный пакет параметров по системе проекта (формат «что добавляется для каждого стиля»):

| Секция файла | Куда ложится в коде |
|---|---|
| EN / RU-стемы / алиасы | `GENRE_WORDS` (RU+EN ключи → тег семейства) + `STYLE_ALIASES` + `STYLE_FAMILIES` в producer-brain.js |
| RHYTHM (char/groove/kit) | `RHYTHM_BY_GENRE[family]` |
| PRODUCTION | `PROD_BY_GENRE[family]` |
| STYLE_ATMOSPHERE (devices + depth) | `STYLE_ATMOSPHERE[family]` |
| VOCAL_PROFILE 7 осей + guard + mood | `VOCAL_PROFILES[family]` (оси 1–7 из §2 audits/vocal-profile-vocabulary.md) |
| Брекеты-группа | `BRACKET_GROUPS[family]` → одна из 8 существующих групп `BRACKETS_BY_GROUP` |
| Примеры промтов | тесты/фикстуры, 3–5 на семейство |

`index.json` — та же структура машиночитаемо: `{count, families:[{family, en, ru, batch, aliases_en, aliases_ru, rhythm[], production[], atmosphere[], vocal{оси, guard, mood}, brackets_group, bpm, examples[], sources[], archive_tracks, archive_favorites}]}`. Внешний агент может кодировать из index.json, не читая прозу.

## Паритет после кодирования

Все четыре места обязательны одновременно (ловит tools/check-music-brain.cjs):
1. `producer-brain.js` STYLE_FAMILIES — 26 → **142**;
2. `music-brain.js` — RHYTHM_BY_GENRE / PROD_BY_GENRE / STYLE_ATMOSPHERE / VOCAL_PROFILES / BRACKET_GROUPS / GENRE_WORDS — по записи на семейство;
3. тест: счётчик `families15.length` 26 → 142 + паритет всех словарей;
4. sim-30 — при желании добавить по 1 сценарию на яркие семейства (trance, drill, disco…).

Тесты уже проверяют за кодера: правило 0 (никаких thin/light/breathy в мужских профилях), запрет противоречивых токенов в профиле, EN ASCII брекетов, наличие всех осей. Профили пакета прошли ту же валидацию на этапе ресерча.

## Батчи (прогресс-коммиты)

| Батч | Семейства | Файлы |
|---|---|---|
| 0 | trance, industrial — крупнейшие семейства архива без своего профиля | 001–002 |
| A | Электронная танцевальная ветка (deep house … electro swing) | 003–016 |
| B | Электроника-текстура (idm, glitch, vaporwave, chiptune, dark ambient, drone, chillwave, witch house, footwork, moombahton, psytrance) | 017–027 |
| C | Урбан и латино (drill … latin) | 028–041 |
| D | Мир/этника и фолк-корни (bhangra … americana) | 042–054 |
| E | Соул/джаз-наследие (neo soul … indie folk) | 055–067 |
| F | Рок-ветка (punk … shoegaze) | 068–082 |
| G | Металл и кроссоверы (power metal … rap metal) | 083–091 |
| H | Поп и эпохи (disco … russian pop) | 092–104 |
| I | Классика и сцена (classical … children music) | 105–116 |

## Источники и честные расхождения

- **dj1-архив — первичный источник** (`arch-N` в каждом файле): поле `sound` 9705 треков, ранжирование по favorite_count. Два способа счёта, оба указаны честно: в шапке каждого файла — substring-совпадение алиасов по всему тексту sound (может завышать: «swing» ловит «swinging»); в `sources` строке — более строгий счёт координатора с сигнатурными токенами (например, trance: substring 582 vs сигнатурный 368). Где substring-счёт явно шумный (dub 103, drone 202, swing 191), это помечено в `sources`.
- **Веб-ресерч — второй источник** (`web:` ссылки в `sources`): hardstyle/gabber — kick-сигнатуры ([electronicmusic.fandom.com](https://electronicmusic.fandom.com/wiki/Types_of_Kicks_in_Hardcore_and_Hard_Dance)); amapiano (log drum + rolling shakers), city pop (DX7/Juno/slap bass), hyperpop (pitched-up vocals, clipped drums) — ресерч сигнатур #45; dubstep/UK garage — half-time wobble / 2-step shuffle из общей практики. Токены, не дословные тексты.
- **Только практика жанров** (архив 0–5 треков, ссылок нет): afro house, dub techno, happy hardcore, uk garage, witch house, moombahton, cumbia, tango, klezmer, rocksteady, bluegrass, post-punk, surf rock, stoner rock, post-rock, nu-disco, italo disco, new jack swing, j-pop, k-pop, easy listening, musical theatre и др. — в `sources` помечено «жанровая практика».
- **Пропущено (не смог заполнить все профили честно):** `epic` (91 вхождение — это маркер настроения cinematic, не отдельный звук), `east/west coast` (региональные вариации hip-hop, collapse в существующие rap/hip-hop), `phonk` (1 трек — остаётся алиасом trap), `chanson` (4 трека — остаётся алиасом folk), `russian rock` (112 — алиас rock), `synth-pop` (189 — алиас synthwave), `metalcore/thrash/nu metal` — где возможно, даны как свои семейства в батче G; `workout/marches-военные` — слились в march.
- **Дубли против существующих 26:** trance не должен больше алиаситься в edm, industrial — в techno, shoegaze — в dream pop (при кодировании удалить старые алиасы `['shoegaze','dream pop']`, `'trance':'edm'`, `'industrial':'techno'`).

## Правило 0 владельца (соблюдено во всех 116 профилях)

Мужские профили — только chest/full/warm/rough/gravel/gritty baritone + guard-запрет («staying in the basement…» / «chest register…»); ни одного thin/light/breathy/high tenor/falsetto. Женские профили этим не ограничены. Автовалидация ресерча: генератор падает при нарушении (прогон зелёный).
