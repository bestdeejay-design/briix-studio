# Углублённый ресерч открытых моделей песен с вокалом (ноябрь 2026)

Автор: координатор-агент (web-ресерч, 22 источника). Задача владельца: «не может быть,
что только ace лежит в свободном доступе». Результат: владелец прав — появилась
**MiniMax Music 3**, прямая open-weights замена Suno.

## ГЛАВНАЯ НАХОДКА: MiniMax Music 3 (MiniMaxAI, ~09.2026)

- Weights: huggingface.co/MiniMaxAI/MiniMax-Music3 (8B Qwen3-based LLM + 0.6B local
  + 2.4B flow matching + VAE; до 5 минут, 32 kHz stereo, теги секций)
- **Лицензия: Community License — КОММЕРЦИЯ РАЗРЕШЕНА** при выручке <$20M/год
  (обязателен брендинг «MiniMax-Music3» в UI; свыше — письменная авторизация)
- Качество: консенсус r/LocalLLaMA — «state of the art open-weights, real alternative
  to Suno»; юзеры генерируют каталоги 4000+ песен и отписываются от Suno
- VRAM: <24 GB в полной точности; **8 GB через layer-streaming offload** (официально);
  огромная GGUF-экосистема (Comfy-Org 1.36M загрузок, audio-cpp/…-GGUF 681k),
  интеграции llama.cpp (issue #27158) и ComfyUI смержены
- 3050 8GB: да (GGUF/offload, медленно). P40 24GB: влезает целиком; Pascal-скорость
  НЕ подтверждена сообществом (риски: bf16→fp16, нет flash-attention, есть SDPA)
- **Русский**: систематических тестов нет; multilingual «solid English, малые языки
  с акцентом» — нужен свой A/B

## Прочее (кратко)

- Tencent SongGeneration/LeVo v2 — качество высокое, НО **лицензия academic-only,
  коммерция ЗАПРЕЩЕНА** (paid service невозможен без спец. разрешения Tencent)
- SongBloom — license «other», сообщество 9 загрузок; SongGen — заморожен 2024
- НЕ подтвердились: LongCAT-Music (не существует), ByteDance Seed-Music open (нет),
  Riffusion open weights (нет — FUZZ-2.0 проприетарный), ElevenLabs open (артефакт),
  Stable Audio 3.0 (только инструментал), Kimi-Audio/Step-Audio (речь, не песни)
- Русских LoRA на HF не найдено вообще; RU-путь = свой LoRA на своём архиве

## Сводная таблица

| Модель | Вокал+лирика | RU | 3050/P40 | Коммерция | Репутация |
|---|---|---|---|---|---|
| MiniMax Music 3 | да, до 5 мин | акцент? тестить | да/да | **да** <$20M | Suno-класс |
| ACE-Step 1.5 (MIT) | да | лучший из открытых | да/скорее да | да | топ, активное RU-сообщество |
| LeVo v2 | да | нет (zh/en) | вероятно | **НЕТ** | высокое, но заблокировано |

## Top-3 для реального теста

1. **MiniMax Music 3** — единственный Suno-класс open-weights с разрешённой коммерцией;
   тест на P40 + русский вокал A/B против ace-step
2. **ACE-Step 1.5** — бейзлайн + база под русский LoRA-тембр
3. LeVo v2 — только как референс качества (если RU сильно лучше — запросить коммерч.
   лицензию у Tencent AI Lab)

Pascal-оговорка: подтверждённых запусков на P40 в сообществе не найдено — «вероятно
работает, требует пилота».

Sources: HF MiniMax-Music3 + LICENSE, llama.cpp #27158, SongGeneration HF, SongBloom,
Stability news, Seed-Music, r/LocalLLaMA, Habr-обзоры ace-step.
