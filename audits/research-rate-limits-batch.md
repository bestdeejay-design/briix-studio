# Ресёрч #22: rate-limit и пакетная загрузка Библиотеки (429 на проде, 15.11)

**Задача:** issue #22 — владелец открыл Библиотеку с телефона (сотовый IP, ~15 треков) и получил 429 на всё. Направление владельца: «одним запросом — весь лист, а не каждый по отдельности». Ресёрч → дизайн → правки в этой ветке → отчёт. Интеграция серверной части — координатор/INFRA после вердикта владельца.

## Контекст (что уже есть к 17.11)

- **Прокси** `briix-demo-server.py` (репо briix.ru, источник истины не здесь): жёсткие **30 req/min с одного IP на ВСЁ подряд** — включая дешёвые GET медиа. Это единственный источник 429.
- **bff** (`server-contract/bff.py`): `/jobs?limit` (потолок 200), `/files/{id}` mux-on-download с кешем <100мс, peaks.json лениво с кешем, retention 24ч, ThreadBudget(8), 429 `queue_full` с Retry-After.
- **Клиент** (`studio/studio.js`): список Библиотеки — УЖЕ один запрос `GET /jobs?limit=100`; обложки — ленивые (IntersectionObserver 150px), общая очередь из 2 слотов с приоритетами (интерактив обгоняет миниатюры), LRU-кеши в памяти (медиа ≤8/32МБ, обложки ≤60), ретраи 429/503 (3 попытки, Retry-After → экспонента + джиттер).

## Замер: сколько запросов стоит первый экран Библиотеки

| Сценарий | До этого PR | После (эта ветка) |
|---|---|---|
| Первое открытие | 1× `/jobs` + обложки видимых карточек (≤2 параллельно, лениво) | то же |
| Повторное открытие (переход чат↔библиотека) | **1× `/jobs` каждое** + in-flight дедупликация только одновременных | **0** — TTL 60с |
| После ♥/удаления/новой джобы | 1× `/jobs` | 1× `/jobs` (инвалидация кеша) |
| Fallback обложки без cover_url | 1× `/jobs` на карточку (после дедупликации — 1 на волну) | 0, пока жив TTL |

Итого: на телефоне с ~15 треками первый экран ≈ **1 + 3–5 видимых обложек ≈ 4–6 запросов**, повторы бесплатны. Основной генератор 429 устраним и клиентски (сделано), и серверно (рекомендации ниже).

## Рекомендации

### P1 — блокеры владельца

**R1. Разделить лимиты прокси по классам операций (INFRA, briix-demo-server.py).**
Сейчас 30 req/min per IP бьёт и POST генерации, и листание обложек. Практика tiered limits — e-commerce-паттерн: дешёвое чтение свободнее дорогой записи (Postman: browsing 100/min vs checkout 10/min; api7.ai — обзор алгоритмов). Конкретно для нас (token bucket с бёрстом, не fixed window):
- `GET /files/*`, `*-peaks.json`, `*-cover.png` — **120/min, burst 8** (дешёвые, кешируемые);
- `GET /jobs*` — **30/min, burst 3** (список и так один thanks TTL);
- `POST /jobs`, `POST /v1/chat/completions` — **10/min, burst 2** (дорогие: GPU/ThreadBudget);
- 429 ВСЕГДА с `Retry-After` (секунды) — клиент уже уважает его (`retryDelay`, studio.js).

**R2. Per-token лимиты вместо per-IP для авторизованных (INFRA).**
Bearer уже есть — прокси может считать по токену, а не по IP. Сотовые шлюзы — CGNAT: один выходной IP делят сотни-тысячи абонентов; «10 req/min на IP щедро для одного и абсурдно для 2000 за ним» (Guarda CGNAT; Cloudflare — детекция CGNAT снижает collateral damage при фильтрации; v.ps — пер-IP ломается на мобильном трафике). per-IP оставить только неавторизованным (анти-скан). Это главный фикс «не бьёт владельца по лимитам»: владелец и незнакомец за тем же IP перестают делить счётчик.

**R3. «Одним запросом — весь лист» (клиент — СДЕЛАНО в этой ветке).**
`/jobs?limit=100` уже batch; узкое место было в повтах. TTL 60с + инвалидация при мутациях (создание/♥/удаление) — повторные открытия Библиотеки теперь без сети, список всегда свеж после собственных действий. Регресс: сцена #22 в check-studio (jobsLists не растёт при переоткрытии, растёт после ♥).

### P2 — заметные улучшения

**R4. HTTP-кеш на медиа (INFRA): `Cache-Control: public, max-age=86400, immutable` + ETag на `/files/*`.**
Файлы контентно-неизменны до retention-удаления (24ч) — идеальный кейс immutable (MDN: «static immutable files cache best»; Simon Hearne: max-age=31536000+immutable для версионированного; web.dev — HTTP cache убирает повторные запросы; BlazingCDN — практики для медиа). Эффект: после reload страницы обложки/плеер не перекачиваются вообще (сейчас кеш в памяти — умирает со страницей). С ETag удаление файла корректно даёт 404, а не вечный кеш.

**R5. Прилипание к низу после «↓ новое» (клиент — СДЕЛАНО в этой ветке).**
Продуктовый хвост 429-истории: после клика по пилюле карточка дорастала при догрузке обложки (~700px) — читатель оставался «не у нового» и жмукал ещё. Теперь клик держит низ 1.2с (rAF-цикл). Заодно стабилизирован известный флейк F-39 в check-studio (падал ~50% прогонов и на main, и в прогонах ревью PR #24).

**R6. Приоритеты видимого — закреплены как регресс (клиент, уже было).**
Очередь из 2 слотов сортируется по приоритету: интерактивное скачивание обгоняет фоновые миниатюры; обложки грузит только IntersectionObserver (rootMargin 150px). Практика progressive display — «показывать каждую картинку по готовности, не ждать весь батч» (pctechmag, async image APIs) — у нас ровно так.

### P3 — по мере роста

**R7. `X-RateLimit-Remaining/Reset` заголовки (INFRA).** Клиент покажет «до сброса N сек» в тосте вместо глухого «слишком много запросов»; сейчас только Retry-After на самом 429.

**R8. SVG-заглушки обложек (клиент, опция).** Вместо символа «♫» — лёгкий сгенерированный SVG-градиент по hash id: мгновенная визуальная плотность без сети (SPA-презеты из вопроса задачи). Не трогает сеть вовсе.

**R9. Batch-covers endpoint `POST /files/covers-batch` (INFRA, НЕ спешить).**
С ленивыми обложками + immutable-кешем + TTL списка потребности нет: первый экран и так 4–6 запросов. Вернуться к батчу, когда появятся сетки-галереи или пагинация больших библиотек (Suno держит library как dock с фильтрами и живёт с ленивыми превью; жалобы их пользователей — про mass-operations, не про загрузку).

**R10. Пагинация/виртуализация Библиотеки (клиент, >300 записей).** bff отдаёт до 200; при росте — `offset` уже в контракте (`limit`/`offset` в /jobs), рендер у нас уже точечный (T-36, карточки живут между рендерами) — добавить подгрузку по скроллу.

**R11. Мониторинг 429 (INFRA):** счётчики по классам и по токенам в лог прокси — иначе настройка R1 не сверяема с жизнью.

## Что сделано в этой ветке (клиентское, PR не открывается по заданию)

1. `serverJobs()` — TTL 60с + инвалидация при `POST /jobs`, ♥, `DELETE` (5 точек мутаций) — студия перестала дёргать список на каждое открытие.
2. Пилюля «↓ новое» — прилипание к низу 1.2с после клика (догрузка контента не уводит цель) + стабилизирован флейк-ассерт F-39 (поллинг вместо разового замера).
3. Регресс-сцена #22 в check-studio (78/78).

## Что уходит в INFRA (координатору)

R1 (tiered лимиты + Retry-After), R2 (per-token), R4 (immutable-кеш на /files/*), R7 (X-RateLimit), R11 (мониторинг). Рекомендованные числа — в R1/R2; всё остальное — по вердикту владельца.

## Источники

- Postman — What is API Rate Limiting (tiered limits, e-commerce GET/POST разнесение, exponential backoff): https://blog.postman.com/what-is-api-rate-limiting/
- API7 — Rate Limiting Guide: алгоритмы (token bucket/sliding window) и best practices против 429: https://api7.ai/blog/rate-limiting-guide-algorithms-best-practices
- ByteByteGo — Design a Rate Limiter (token bucket и бёрсты): https://bytebytego.com/courses/system-design-interview/design-a-rate-limiter
- Cloudflare — Detecting CGNAT to reduce collateral damage: https://blog.cloudflare.com/detecting-cgn-to-reduce-collateral-damage
- Guarda — CGNAT Explained: One IP ≠ One User (лимиты на общий IP): https://guarda.net/blog/cgnat-explained-why-one-ip-address-is-not-one-user
- v.ps — Rate limiting для мобильного/CGNAT-трафика: https://v.ps/blog/rate-limiting-for-china-traffic
- MDN — HTTP caching (immutable-ресурсы): https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching
- Simon Hearne — Caching Header Best Practices (max-age + immutable): https://simonhearne.com/2022/caching-header-best-practices/
- web.dev — Prevent unnecessary network requests with the HTTP Cache: https://web.dev/articles/http-cache
- BlazingCDN — Cache-Control headers for media: https://blog.blazingcdn.com/en-us/cdn-cache-control-headers-best-practices-media-files
- PCTechMag — How AI Image APIs Work (прогрессивный показ по готовности): https://pctechmag.com/2026/10/how-image-generation-apis-work-under-the-hood-async-tasks-reference-images-and-resolution-explained/
- Suno Help — Library in Studio (dock, фильтры, ленивые превью): https://help.suno.com/en/articles/13670849
