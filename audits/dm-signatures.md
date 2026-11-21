# Depeche Mode — сигнатуры для промтов и брекетов (ресерч, 23.11.2026)

Автор: координатор-агент (web-ресерч по Gearspace/Vintage Synth/Wikipedia). Для мозговой
волны: токены описывают ЗВУК (без имён артистов) — для caption (ace-step) и брекет-тегов
лирики. Смежные: audits/vocal-profile-vocabulary.md, audits/lyrics-effect-brackets.md,
audits/prompt-mechanics-findings.md.

## 1. Продакшн классической эры (Violator / SOFAD / MFTM) — факты

- Аналоговые моно-басы (Minimoog-класс) с саб-контентом, часто с хорусом/фленжером на басу
- «Броусли-хорны»: PPG Wave / Jupiter-8 брасс-стабы с вибрато — мгновенно узнаваемый акцент
- Ранние семплеры (Emulator II / Emax): фабричные хор-пады, «оркестровые хиты», колокола;
  TR-808-семплы; живые барабаны, обрезанные гейтом
- Гейт-реверб на малом барабане; reverse reverb swell в даунбит; tape saturation,
  лёгкое виниловое шипение; SOFAD-эра: clangy industrial лупы, слайд-гитара, госпел-хор
- Темп 85–120 BPM; тональности минорные (натуральный минор/дориан, ходы i–VI–iv–v);
  длинные синт-интро (8–16 тактов), куплет с минимальными ударными, длинные фейды

## 2. Вокал — факты

- Баритон, тесситура ~Eb3–B3, верх до F#4
- Куплеты: почти говорящий, прохладный, интимный, близкий к микрофону (плотный SM7-класс)
- Припевы: полный грудной голос, длинные тянущиеся ноты, лёгкий гроул (SOFAD),
  «проповедническая» подача: акценты, синкопы, бенды на гласных
- Контр-голос: высокий светлый (альтино), контраст к основному; октавные дубли
- Вокал-эффекты: короткий slap-back delay, лёгкий хорус, реверб с коротким пред-делеем

## 3. Токены для caption (конвертированы в наш формат)

⚠️ Наш протокол: «belted/sustained/soaring» ЗАПРЕЩЕНЫ в мужских промтах (находка №7 —
дрейф вверх). Вокальные токены ниже адаптированы: chest-voice chorus с long held notes
+ явные замки «no head voice, no falsetto».

Инструменты/продакшн (топ по узнаваемости):
1. `punchy gated reverb snare, dry tight drums with huge short ambience`
2. `deep analog mono bass, sub-heavy, subtle chorus on bassline`
3. `brass synth stabs with vibrato, digital-analog hybrid`
4. `sampled breathy choir pad, ethereal sacred atmosphere`
5. `reverse reverb swell leading into downbeat hits`
6. `twangy guitar with slap-back delay, rockabilly-blues fusion`
7. `dark goth-gospel hybrid, electronic beats with gospel choir answers`
8. `clangy industrial drum loop, distorted percussive hits`
9. `tape saturation, warm analog mix with slight tape hiss`
10. `sparse cold hypnotic synth arpeggio`
11. `wide reverb synth pads contrasting dry punchy drums`
12. `vinyl crackle ambience over slow minor progression`
13. `wet slide guitar weaving through the electronic bed`
14. `moody fretless-style synth lead, late-night cruising feel`
15. `hypnotic two-chord minimal loop building into the chorus`

Вокал (адаптировано под наши замки):
16. `deep commanding male baritone, intimate close-mic verse`
17. `chorus in the same low chest voice with long held notes, no head voice, no falsetto`
18. `gritty growl texture on vocal peaks, preacher-like delivery`
19. `bluesy phrasing, bent vowels, syncopated accents`
20. `high airy counter-vocal floating above the baritone lead`
21. `octave-doubled wide stereo vocal doubles`
22. `whispered intro vocal with tape delay`

## 4. Брекет-теги (готовые строки)

```
[Intro: slow synth pads, vinyl noise, no drums]
[Intro: reverse reverb swell into first beat]
[Verse: bass + drums only, close intimate baritone]
[Verse: no drums, arpeggio and whisper vocal]
[Pre-chorus: rising pads, filtered drums entering]
[Chorus: gated snare, brass stabs, low chest voice]
[Chorus: full drums, wide reverbs, high counter-vocal answers]
[Chorus: gospel choir answers the lead line]
[Bridge: drums drop, choir pad + slide guitar]
[Bridge: industrial drum loop, distorted vocal growl]
[Solo: twangy guitar with slap delay]
[Breakdown: percussion and vocal chops only]
[Turnaround: reverse cymbal swell]
[Drop: drums slam in after silence]
[Outro: instruments peel away, pads + tape hiss, slow fade]
```

## 5. Структурный blueprint (bracket-ready)

```
[Intro: 8-16 bars, pads + arpeggio + vinyl noise, no drums]
[Verse 1: baritone close-mic, minimal percussion, bass line enters]
[Pre-chorus: reverse reverb swell, drums build with gate]
[Chorus: low chest voice, gated snare, brass stabs, counter-vocal high line]
[Verse 2: groove continues, preacher-like syncopated phrasing]
[Chorus 2: wider, choir pad doubles the harmony]
[Bridge: drums drop or industrial loop, slide guitar / sparse keys]
[Breakdown: percussion + vocal chops, tension riser]
[Final Chorus: biggest dynamics, growl texture, octave vocals, still low register]
[Outro: instruments peel away, pads + tape hiss, slow fade]
```

## 6. Связка с нашим протоколом

- v1–v3b Machine использовали часть этих токенов в «категорийной» форме; v4 (следующая
  итерация) = top-10 токенов + рецепт-победитель из Космоса v2 (замки «throughout the
  entire song, no falsetto and no high notes ever» + «low commanding dark chant»).
- Новое против уже опробованного: brass stabs with vibrato, breathy choir pad,
  reverse reverb swell, twangy slide guitar w/ slap delay, counter-vocal high line,
  octave doubles, industrial loop, vinyl crackle — этих сигнатур в v1–v3b не было.
- Источники: Gearspace (Violator sounds), Vintage Synth forum, r/synthesizers,
  Wikipedia (SOFAD, gated reverb). Техники описаны, тексты песен не использовались.
