# VOCAL PROFILE VOCABULARY — голос через промт (для мозговой волны студии)

Автор: координатор (arena), 22.11.2026. Источник: проверенные генерации на стенде
(ace-step flash/pro, caption читается как свободный текст). Задача владельца:
задавать голос ХАРАКТЕРИСТИКАМИ, не копировать голоса (клонирование — вне скоупа).
Имена артистов в промт запрещены (#109) — резолвер превращает имя → профиль ниже.

## 1. Семь осей голоса

| # | Ось | EN-токены для caption | RU-подсказки пользователя |
|---|---|---|---|
| 1 | Кто поёт | male / female vocals, young girl ~20s, boyish, mature man, child-like | девочка, парень, мужской, женский, юный, взрослый |
| 2 | Регистр | soprano, alto, high-pitched, tenor, baritone, deep bass voice | высокий, низкий, бас, тонкий голос |
| 3 | Тембр | bright, warm, breathy, nasal, raspy, gravelly, smooth, thin, thick midrange, clean | грубый, хриплый, нежный, мягкий, звонкий, бархатный |
| 4 | Мощь / подача | powerful belting, soft intimate, gritty aggressive, laid-back, whispered, shouted | брутальный, мощный, тихий, на пределе, шёпотом |
| 5 | Техника | melodic pop phrasing, sung-to-shouted chorus, growl, screamo, wide vibrato, staccato punchy phrasing, spoken-word | рык, скрим, с вибрато, речитатив |
| 6 | Характер | playful, cheerful, confident, menacing, melancholic, seductive, heroic | весёлый, дерзкий, злой, тоскливый |
| 7 | Обработка | dry upfront vocal, doubled vocals, layered harmonies, wide reverb vocal, autotune-light polish, radio-polished | с эхо, хором, чистый студийный голос |

## 2. Готовые профили по стилевым семьям (VOCAL_PROFILE для STYLE_FAMILIES)

| Семья | VOCAL_PROFILE (готовый блок для caption) |
|---|---|
| eurodance / Руки Вверх | young male pop vocals, bright boyish tenor, playful cheerful delivery, simple catchy melodic phrasing, energetic singalong chorus, dry upfront vocal, 90s euro-pop timbre, clean without rasp |
| classic heavy metal / Metallica | gritty male baritone sliding into tenor, raspy aggressive delivery, sung verses shouted into a full-throated chorus, thick midrange timbre, stretched vowel phrasing, punchy upfront vocal, no clean pop smoothness |
| женственный европоп | young female vocals, bright sweet soprano, light breathy verses into a confident chorus, glossy radio polish, playful ad-libs |
| лирическая баллада | mature warm male vocals, intimate soft delivery, breathy low verses opening into an emotional belt, close-mic dry vocal, minimal processing |
| девичий поп (грустный) | young female vocals ~20s, tender slightly nasal timbre, fragile intimate delivery, soft breathy verses, restrained emotional chorus |
| брутальный металл | aggressive gravelly male vocals, low growl verses into shouted power chorus, harsh midrange, menacing delivery |
| рэп/хип-хоп | confident male spoken-word flow, rhythmic staccato phrasing, dry upfront vocal, casual swagger |
| ретро диско 80-х | polished male falsetto accents, confident mid-register lead, layered harmony answers, bright vintage reverb |

## 3. Правила сборки в caption (для buildCaption)

0. **ЖЁСТКОЕ ПРАВИЛО ВЛАДЕЛЬЦА: тонкие мужские голоса запрещены.** В мужских
   VOCAL_PROFILE никогда не использовать thin/light/breathy/high tenor/falsetto;
   всегда chest register / full / warm / wide chesty timbre. При сомнении — ниже
   и тяжелее. На женские профили не распространяется.
1. **Голосовой блок — ПЕРВЫМ** в caption (модели весят начало строки выше): vocals → форма/инструменты → микс.
2. **Приоритет запроса пользователя над семьёй**: если в реплике есть голосовые RU-подсказки (колонка 3 осей) — словарь синонимов RU→EN перекрывает семейный VOCAL_PROFILE по затронутым осям, остальные остаются от семьи.
3. **Не дублировать противоречия**: profile не должен содержать взаимоисключающие токены (raspy + smooth, growl + breathy) — резолвер проверяет совместимость внутри профиля и пользовательских добавок.
4. **Имена артистов никогда не попадают в caption** — только характеристики (styleLeaks продолжает ловить утечки).
5. **Честный badge**: «Голос задан характеристиками: N признаков (свой выбор)» при пользовательском перекрытии; иначе «Голос из стиля: <семья>».
6. **Без слоёв ≠ тихий провал**: если семья не распознана и пользователь ничего не задал — ставится нейтральный «clear male/female pop vocals, upfront dry» вместо generic-хвоста.

## 4. Верификация (A/B, на flash — разница слышна сразу)

- Одна лирика, один seed, два caption с разными голосовыми профилями
  (например девичий поп vs брутальный металл) → оба трека на прослушку владельцу.
- Критерий: различие голосов очевидно без подсказки; профиль семьи звучит «в характере» жанра.
- Регресс: существующие семьи не должны ухудшиться (та же лирика/seed, старый vs новый caption).

## 5. Связь с другими выводами обогащения (22.11)

- Слои caption должны быть СТИЛЕСПЕЦИФИЧНЫМИ: сейчас buildCaption дописывает один
  generic-хвост всем семьям («intimate delivery… atmospheric» у europop и metal одинаково).
  VOCAL_PROFILE + семейные инструментальные слои решают это вместе.
- Валидация: голосовые оси 1–7 переиспользуют ту же механику слоёв (layers[] в buildCaption),
  новый тип слоя `vocal` с приоритетом поверх остальных.
