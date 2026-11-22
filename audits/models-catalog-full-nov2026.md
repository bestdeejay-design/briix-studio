# ПОЛНЫЙ КАТАЛОГ: self-host модели генерации песен с вокалом (22.11.2026)

Ресерч-агент (29 источников: HF API, GitHub, r/LocalLLaMA, обзоры). Владелец хотел
убедиться: «не может быть, что только ace». Подтверждено: модель НЕ одна — полный список.

## КЛЮЧЕВАЯ СИСТЕМНАЯ НАХОДКА: audio.cpp — единый рантайм

github.com/0xShug0/audio.cpp (уже собран у нас!) поддерживает GGUF-версии ПОЧТИ ВСЕГО:
ACE-Step 1.5 (Turbo/Base/XL), **YuE2-3B**, **HeartMuLa-oss-3B**, MuLaCover, MiniMax
Music 3, SoulX-Singer, Magenta RealTime 2, Vevo2, Stable Audio 3. Q8 GGUF: до +53%
скорость, −37% VRAM. LoRA-поддержка с v0.8.1. Pascal-оговорка: нет bf16, fp16 1:64 —
использовать Q8/fp32 ветки.

## МАСТЕР-ТАБЛИЦА (по запускаемости)

### Запускается на 3050 8GB (GGUF Q8)
| Модель | Лицензия | RU | Качество |
|---|---|---|---|
| ACE-Step 1.5 Turbo | Apache 2.0 | терпимо | известная, разочаровала |
| MiniMax Music 3 Q4/Q8 | коммерция ок (<$20M) | RU разочаровал вас | сильная, есть community-LoRA |
| **HeartMuLa-oss-3B** | **Apache 2.0** ✅ | не заявлена — тестить | **«Suno-класс, studio-quality»**, RL-апдейты 01–02.2026 |
| **YuE2-3B GGUF** | CC BY-NC ❌ | слабо/нестабильно (community) | **«Suno v5/v6-класс», лучший открытый вокал**, RTF<0.2, редактируемые партитуры (ABC) |

### Комфортно на P40 24GB
| Модель | Лицензия | Примечание |
|---|---|---|
| HeartMuLa | Apache 2.0 | + семейство: **MuLaCover** (каверы в любом голосе, CC BY-NC), HeartTranscriptor |
| YuE2-3B + **community-файнтюны** (goldhub/YuE2-RS-Finetunes: 1860 ч, 32.6k треков; 80s eurodisco LoRA jamespetts) | CC BY-NC | экосистема живая |
| DiffRhythm 2 | **Apache 2.0** | самая быстрая (песня за секунды) — для черновиков |
| LeVo2 GGUF (ckadirt/LeVo2-GGUF + LeVo2.cpp) | academic-only ❌ | возможно лучший чистый вокал; только сравнить |
| Muse (MIT, Qwen3-based, 116k датасет) | MIT ✅ | новая (01.2026), мало отзывов |
| JAM-0.5 (44.1kHz, word-timing) | кастом — проверять | 16GB+ |
| Magenta RealTime 2 (Google, realtime) | Apache-семейство — проверять | стриминг, full-song слабее YuE2 |

### Спец-модули (пайплайн, не генераторы)
SoulX-Singer (SVS/SVC, Apache), Vevo2 (MIT, SVS/SVC), MuLaCover (каверы, CC BY-NC),
NNSVS/DiffSinger — **единственные с русскими voicebank-ами**, RVC/Applio (пост-обработка).

### Отсеяно (проверено)
Stable Audio 3 (без вокала), MusicGen (без вокала), Seed-Music (закрыт), tencent/SongPrep-7B
(препроцессинг), Open-Qwen-Music (веса не выпущены — МОНИТОРИТЬ org Qwen!), Jukebox (не запускаемо).

## ЧЕСТНЫЙ ИТОГ ПО РУССКОМУ
Ни одна открытая full-song модель официально не умеет русский хорошо. Пути:
(а) файнтюн YuE2/HeartMuLa на русских данных — **ниша пуста, инфраструктура готова**;
(б) DiffSinger/NNSVS русские voicebank-и (вокал поверх своего инструментала);
(в) SVC-цепочка: генерация → RVC/Applio в нужный голос.

## ТОП-5 К УСТАНОВКЕ (ранжировано)
1. **YuE2-3B GGUF Q8 на P40 через audio.cpp** (уже собран!) — лучший открытый вокал, RTF<0.2, партитуры. Минус CC BY-NC.
2. **HeartMuLa-oss-3B GGUF** — второй по качеству, **единственный коммерчески чистый Apache 2.0**, лёгкий (даже 3050). Проверить RU экспериментально.
3. **DiffRhythm 2 на P40** — быстрый черновой контур (Apache 2.0).
4. **LeVo2 на P40** — только сравнить качество (academic).
5. **MiniMax Q4 на 3050 + community-LoRA** — первый трек мог быть неудачным семплом, не потолком.

## Не проверяемо честно
RU-качество HeartMuLa/Muse/MiniMax (только свой слух), YuE2 на Pascal (fp16 1:64 — GGUF Q8 обходит),
Open-Qwen-Music (мониторить), правовой статус AI-музыки в РФ.

Sources: HF, github (0xShug0/audio.cpp, ckadirt/LeVo2.cpp, yuhui1038/Muse, declare-lab/jamify,
multimodal-art-projection/YuE), r/LocalLLaMA, it-jim, Boppy, DataCamp, Habr.
