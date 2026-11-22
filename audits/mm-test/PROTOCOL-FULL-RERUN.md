# ПРОТОКОЛ КОРРЕКТНОГО ПОВТОРНОГО ПРОГОНА — все модели, все тесты

Принцип: КАЖДАЯ генерация проверяется по чек-листу ДО отправки. Одна модель за раз
(3050). Файлы промтов/лирик — на стенде B, содержание проверяется cat'ом перед запуском.

## Чек-лист каждой генерации (обязателен)
1. Промт = дословный из dj1-corpus (файл на B, cat перед запуском)
2. Лирика = файл владельца, СООТВЕТСТВУЮЩАЯ своей песне (md5 сверен с эталонами)
3. Язык лирики: RU для Тысячи Окон/Lights, EN для You are here/Cosmos
4. Seed фиксирован: okna/lights=51003/51004, youare=51001, cosmos=51002
5. duration: YuE2 short=60-80с (-n 2048); MiniMax=120с (граница); ace=196с
6. Название файла/тега: «модель версия — песня (что)»
7. После готовности: afinfo (валидность) + доставка + ретаг

## МАТРИЦА ТЕСТОВ (4 песни × модели)

| # | Песня | Промт | Лирика (файл на B) | seed | Язык |
|---|---|---|---|---|---|
| 1 | Тысячи Окон | fast jungle beats, female vocals, reverb guitar, deep bass, dreamy atmospheric, warm beat, 170bpm | mm-batch-lyr-orig-okna.txt (7d9fcc3d) | 51003 | ru |
| 2 | A Thousand Lights | fast jungle beats, female vocals, reverb guitar, deep bass, dreamy atmospheric | lyr-lights-correct (98a21b11 «Всегда одна») | 51004 | ru |
| 3 | You are here | tempo changes, dynamic r&b, atmospheric vocals, falsetto singing… | lyr-orig-youare.txt | 51001 | en |
| 4 | Cosmic Vibes 1973 | psychedelic 70s, vintage synth, wah guitar… | lyr-orig-cosmos.txt | 51002 | en |

## Статусы (перезапуск 22.11 утро)

### MiniMax Music 3 (IQ4, ≤120с) — модели ✅, очередь после HeartMuLa
- [ ] 1 Тысячи Окон (2 куска по 90с? нет — 120с кусок = 1-й куплет+припев)
- [ ] 2 A Thousand Lights (120с)
- [ ] 3 You are here (120с)
- [ ] 4 Cosmic Vibes (120с)

### YuE2-3B (short, -n 2048, ≤60с) — модели ✅
- [x] 1 Тысячи Окон? — НЕТ, first short был EN smoke. RU-тест впереди
- [ ] 1 Тысячи Окон RU (12 строк)
- [ ] 2 A Thousand Lights RU (12 строк)
- [ ] 3 You are here EN (14 строк)
- [ ] 4 Cosmic Vibes EN (14 строк)

### HeartMuLa — установка идёт (веса качаются)
- [ ] Установка + smoke
- [ ] 4 генерации

### ACE-Step — ✅ ВСЕ ГОТОВЫ
- [x] Тысячи Окон (оригинал-промт) — delivered
- [x] vA/vB/vC Legendary variations — delivered (vB, vC; vA перегенерация job-91a91bd6)
- [x] You are here, Cosmic Vibes, Legendary — delivered
