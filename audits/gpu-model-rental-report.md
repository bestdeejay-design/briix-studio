# Аренда GPU с готовыми моделями (музыка/изображения) — ресерч, ноябрь 2026

Автор: координатор-агент (web-ресерч, цены 2025–2026 проверены по первоисточникам,
часть — из агрегаторов, перед решением сверяться). Курс ~100 ₽/$.

## 1. Model-hosting (задеплоил модель → плати за инференс)

- **ACE-Step уже «из коробки»**: Replicate (lucataco/ace-step ~**$0.022/трек**;
  fishaudio/ace-step-1.5 ~$0.10), fal.ai (~$0.007/трек) — ровно искомый middle-ground
- **RunPod Serverless / Modal** — свой Docker-worker (наш LoRA): 4090 24GB ~$1.10/ч →
  **$0.01–0.03/трек**, scale-to-zero
- Baseten ~2–3× дороже RunPod; Together/Fireworks — не для музыки; HF Dedicated —
  оплата за uptime (постоянный L4 = $720/мес — только при устойчивом трафике)

## 2. Raw GPU аренда

- **Vast.ai** RTX 3090 **$0.11–0.20/ч** (дешевейший 24GB), деплой минутами, крипта
- **RunPod** 3090 ~$0.22–0.34/ч, 4090 ~$0.34/ч Community; **есть one-click community-
  шаблон ACE-Step 1.5** (подтверждено одним Reddit-постом — проверить)
- Hetzner выделенные RTX €110–214/мес; Timeweb RF **3090 59 ₽/ч**, Selectel GPU-
  colocation **от 14 000 ₽/мес** (свои 3050/P40 можно поставить туда)
- Иностранные платформы RF-платежи не принимают; RU-облака в 3–5× дороже Vast,
  но легальны; serverless с оплатой за секунды в РФ-облаках почти нет (plain VM)

## 3. Break-even (35с GPU + копедии)

| Путь | $/трек | Когда выгодно |
|---|---|---|
| Свой 3050 (есть) | ~$0.001–0.01 | «коленки», но без SLA |
| Vast 3090 24/7 | fully-loaded ~$108/мес | >2 160 треков/мес (против $0.05 API) |
| RunPod Serverless 4090 | $0.02–0.03 | **500–5000 треков/мес** |
| Replicate ACE-Step | $0.022 | <500 треков/мес — дешевле всего |
| Mureka API | $0.20 → $0.03 при 1000+/мес | легальный официальный fallback |

**Итог**: <500 тр/мес → API (Replicate/fal/Mureka); 500–5000 → RunPod Serverless
свой worker; >5000 → свои 2–4×24GB (colocation Selectel или Vast dedicate).

## 4. Три конфигурации (по стратегии владельца)

1. **Коленки (сейчас)**: локальный 3050 — sd.cpp (картинки, уже работает) +
   ace-step локально; прототипы без инфраструктурных затрат
2. **Пилот 2–4×24GB**: RunPod Serverless 4090 worker с ACE-Step 1.5 (community-шаблон)
   + будущий LoRA + Flux.schnell в том же workerе; ~$0.02–0.03/трек; если зарубежная
   карта недоступна — Timeweb RTX 3090 59 ₽/ч как VM-заменитель
3. **Коммерция**: основной трафик на своём serverless, overflow на Replicate/fal,
   официальный **Mureka API** как легальный fallback; при >5000 тр/мес — свои карты
   (Selectel colocation 14 000 ₽/мес)

## 5. Изображения

- fal.ai Flux.schnell $0.003–0.005/картинка; Replicate от $0.003; RunPod worker ~$0.001
- Пилот: продолжать sd.cpp на 3050 (5–10 с/картинка 1024² Q8) — бесплатно и достаточно

## Честные оговорки

- Цены fal/Timeweb/Yandex/VK/TensorDock/Hetzner — из обзоров, могли измениться
- «One-click ACE-Step шаблон RunPod» — один Reddit-пост
- RF-платежи на зарубежных платформах: только обходы (крипта/зарубежная карта) —
  ToS-риски; для коммерческого продукта нужен легальный маршрут (Timeweb/Selectel)

Sources: replicate.com/pricing, replicate.com/lucataco/ace-step, fal.ai/pricing,
runpod.io/pricing, vast.ai/pricing, huggingface.co/docs/inference-endpoints/pricing,
hetzner.com/dedicated-rootserver/matrix-gpu, timeweb.cloud/services/gpu,
selectel.ru/services/gpu, yandex.cloud GPU docs, cloud.vk.ru/cloud-gpu,
platform.mureka.ai/pricing, suno-automation.com/api-cost-comparison.
