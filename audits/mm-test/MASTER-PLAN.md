# МАСТЕР-ПЛАН ТЕСТОВ (рабочий, обновляется по ходу)

## Статус: [X] готово | [~] в работе | [ ] не начато | [!] упало

## ФАЗА A — YuE2-3B (модель собрана, веса на B)
- [!] A1 Тысячи Окон RU: FAILED «stopped before first code» (RU+170bpm)
- [x] A2 smoke EN 55с: «восхитительно», RTF 0.74
- [x] A3 short EN -n 2048: пик 5GB, RTF 0.68 — YuE2 РАБОТАЕТ на 3050 в short-режиме
- [~] A4 Твои 4 песни short-режим (-n 2048): скрипт yue2-owner-batch.sh создан, запуск прерван — ЗАПУСТИТЬ СЕЙЧАС
  - [ ] A4.1 Тысячи Окон RU (12 строк)
  - [ ] A4.2 A Thousand Lights RU (12 строк)
  - [ ] A4.3 You are here EN (16 строк)
  - [ ] A4.4 Cosmic Vibes EN (16 строк)
- [ ] A5 Вердикты владельца по каждой

## ФАЗА B — MiniMax Music 3 (v0.9.6 сборка)
- [!] B1 Сборка v0.9.6 deployment: earshot AVX2 упал; решение = custom model-set (minimax_music3,heartmula,yue2) — ЗАПУСТИТЬ ПЕРЕСБОРКУ
- [ ] B2 Проверить сборку (бинл audiocpp_cli + heartmula спека)
- [ ] B3 Smoke clean 30с: тест «плёнки» на новом рантайме
- [ ] B4 Если плёнки нет → 4 песни владельца (по чек-листу матрицы)
- [ ] B5 Если плёнка есть → MiniMax заморозка до BF16-P40

## ФАЗА C — HeartMuLa (Apache 2.0, прод-кандидат)
- [~] C1 Веса качаются на B (codec-компоненты добиваются)
- [ ] C2 Запуск: --family heartmula (спек есть в model_specs)
- [ ] C3 Smoke RU (Тысячи Окон short)
- [ ] C4 4 песни владельца
- [ ] C5 Вердикты (решает: прод-модель или нет)

## ФАЗА D — ace-step (базовая, работает)
- [x] D1 Room 7 No Knock (оригинал-промт) — delivered
- [x] D2 Legendary-вариации vA/vB/vC — delivered
- [ ] D3 Вердикты владельца по vA/vB/vC

## ФАЗА E — СВОДКА
- [ ] E1 Таблица: модель × песня × вердикт
- [ ] E2 Выбор стека пилота + план P40-дня

## ЗАПУЩЕНО/ЖДЁТ НА СТЕНДЕ
- MiniMax IQ4 «Тысячи Окон FINAL v2» (короткое интро-аутро) — генерация шла, файл /tmp/mm-okna-final.wav готов, НЕ ДОСТАВЛЕН (наблюдатель упал) — ДОСТАВИТЬ В ФАЗЕ B
- YuE2 owner-batch — запустить (A4)

## ФАЗА F — остальные модели из каталога (после A/B/C)
- [ ] F1 DiffRhythm 2 (Apache 2.0, быстрые черновики): установка, smoke, 1 песня
- [ ] F2 Muse (MIT, новая 01.2026): веса github yuhui1038/Muse + HF bolshyC — установка, smoke, RU?
- [ ] F3 JAM-0.5 (44.1kHz, word-timing): проверка лицензии («other») до установки
- [ ] F4 Magenta RealTime 2 (Google, realtime): только если full-song подтвердится
- [ ] F5 SoulX-Singer (SVC, Apache): модуль «спеть голосом» — после базового стека
- [ ] F6 LeVo2 запуск (рантайм ckadirt/LeVo2.cpp или официальный) — референс
- Статусы после YuE2-batch и HeartMuLa-теста
