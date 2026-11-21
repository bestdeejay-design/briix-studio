# LYRICS EFFECT BRACKETS — правила брекет-вставок для обогащения композиции

Автор: координатор (arena), 22.11.2026. Для мозговой волны / внешнего агента.
Проверено на стенде ace-step (flash/pro): модель читает квадратные брекеты в лирике
как указания по аранжировке и динамике. Назначение: разнообразить звучание каждой
композиции и убрать монотонность, НЕ засоряя caption.

## 0. Главный принцип: разделение труда

| Канал | Что несёт | Лимит |
|---|---|---|
| **caption (промт)** | стиль, голос (7 осей), темп, общий микс, атмосфера | ≤640 симв., без брекетов |
| **лирика + брекеты** | динамика ПО СЕКЦИЯМ: что случается в интро/куплете/припеве/бридже/аутро | брекеты в квадратных скобках перед/внутри секций |

Брекет НЕ дублирует caption, а добавляет **изменение во времени**: «барабаны ушли», «фильтр открывается», «хор подхватил». Caption описывает «как звучит песня», брекеты — «как она живёт».

## 1. Пять категорий брекетов

| # | Категория | Токены (EN) | Пример |
|---|---|---|---|
| 1 | **Аранжировка** | synth drop out, drums only, strings enter, bass solo, brass fanfare, guitar swell | `[Verse 2: drums drop out, sparse bass]` |
| 2 | **Динамика/дыхание** | slow build, filtered drums rising, quiet breakdown, sudden stop, fade in, crescendo | `[Pre-Chorus: filtered drums slowly rising]` |
| 3 | **Вокальная обработка** | layered harmonies, gang vocals, whisper, double vocal, distant echo, choir answer | `[Chorus: layered low harmonies, gang vocals]` |
| 4 | **Эффекты/пространство** | cathedral reverb, wide stereo echo, tape saturation, underwater vocal, rotary organ, wah-wah | `[Bridge: organ swell, distant choir pad]` |
| 5 | **Сольные вставки** | guitar solo, synth solo, sax solo, instrumental break, drum fill | `[Guitar Solo: wide-vibrato lead, buried in echo]` |

## 2. Правила сборки (для мозга)

1. **Место**: брекет на ОТДЕЛЬНОЙ строке перед секцией или внутри `[Chorus: ...]`. Внутри строк лирики брекеты не писать.
2. **Норма плотности**: 1 брекет на секцию; допускается 2 на интро/аутро (текстура + динамика). Больше — засор.
3. **Язык брекетов — EN**, вне зависимости от языка лирики (тот же принцип, что и caption).
4. **Не противоречить caption**: стиль/темп в брекетах не повторять; если в caption «gated reverb drums» — в брекетах только их ИЗМЕНЕНИЯ («gated snare drops out»).
5. **Чистые брекеты структуры** (`[Verse]`, `[Chorus]`) — как раньше, отдельная строка; обогащённая форма: `[Chorus: <эффекты>]` — структура и эффекты в одной строке.
6. **Секция без брекета = наследует caption.** Это нормально; не каждая секция требует указания.
7. **Финальный припев** — почти всегда получает брекет (last-chorus lift): «bigger harmonies», «key change», «double tempo drums». Это стандартный хит-приём против монотонности.

## 3. Анти-монотонность: чек-лист разнообразия (мозг проверяет перед отдачей)

- [ ] Есть хотя бы ОДНА секция с уходом инструментов (`drums drop out`, `sparse`) — контраст тишины
- [ ] Есть riser/build перед главным припевом (`filtered drums rising`, `slow build`)
- [ ] Последний припев отличается от предыдущих (lift-брекет)
- [ ] Куплет 2 ≠ куплет 1 по брекету (например, в 1-м — «бас соло», во 2-м — «струнные входят»)
- [ ] Есть брекет пространства (reverb/echo/panning) хотя бы в одном месте
- [ ] Не более ~6 брекетов на всю лирику до 3 мин (короткие треки — 3–4)
- [ ] Ни один брекет не повторяет другой дословно

## 4. Референсные примеры (реальные заявки 22.11, модель их приняла)

**Тёмный синт-поп (Midnight Machine):**
```
[Intro: cold arpeggiated synth, deep analog bass pulse, gated snare]
[Verse 1]
...
[Pre-Chorus: filtered drums slowly rising]
[Chorus: full drums, cathedral reverb, layered low harmonies]
...
[Verse 2: drums drop out, sparse bass]
...
[Bridge: organ swell, distant choir pad]
...
[Outro: cold arpeggio fading, deep bass pulse]
```

**Евродиско (Everlove):**
```
[Intro: shimmering arpeggio, bright synth brass hit, soft electronic kick]
[Chorus: wide stereo echo, layered harmony stack]
...
[Bridge: dreamy filtered pads, vocal echoing]
[Outro: arpeggio fading into soft breeze]
```

## 5. Интеграция в мозг (buildCaption / guardMusicDraft)

1. Лирика проходит через мозг С БРЕКЕТАМИ без потерь — guardMusicDraft не должен вычищать `[...]` как мусор.
2. Мозг ДОБАВЛЯЕТ брекеты к секциям по чек-листу §3, если автор-лирика их не содержит (все брекеты EN).
3. Мозг НЕ пишет эффекты из брекетов в caption (не раздувать 640) и наоборот не дублирует caption-слои в брекетах.
4. Честный badge расширить: «Аранжировка размечена: N секций с эффектами».
5. Валидация — A/B: одна лирика/seed, версия без брекетов vs с брекетами → на слух: вариативность секций, финальный lift, отсутствие монотонности. Flash-модель реагирует на брекеты заметно.

## 6. Связь с другими документами

- Голос — `audits/vocal-profile-vocabulary.md` (7 осей, VOCAL_PROFILE семей, голос первым в caption)
- Стилевые слои caption — находка 22.11 «generic-хвост» (семейные слои должны быть стилеспецифичными)
- Вместе: caption = голос + стиль + микс (≤640); брекеты = динамика секций. Один трек описывается двумя каналами без дублирования.
