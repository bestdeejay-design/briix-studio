# Own-git deploy — быстрый релиз briix-studio через Forgejo (21.11.2026)

Быстрый канал выкладки client static + bff на стенд, **не зависящий от GitHub Actions**
(GH-раннер и очередь CI больше не в пути релиза; браузерные проверки остаются в CI
и идут параллельно — релиз их НЕ ждёт).

## Канон быстрого пути

**Один командой с мака, из корня репо:**

```bash
bash tools/release-studio.sh            # push main -> Forgejo + выкладка studio/ + assets/ на стенд
bash tools/release-studio.sh --with-bff # то же + ship server-contract/bff.py (бэкап + рестарт media-bff)
bash tools/release-studio.sh --no-push  # выложить текущее дерево без пуша в Forgejo
```

Что делает:
1. `git push forgejo main` → **https://git.briix.ru/bestdeejay-design/briix-studio** (Forgejo,
   remote `forgejo` в репо; доступ — basic-auth через helper `~/.ssh/forgejo-askpass`,
   креды из `~/.ssh/forgejo-creds`; токенов в командной строке и git config нет).
2. Tar-бандл `studio/ + assets/` по ssh на стенд → `/home/badai/briix-studio-deploy/deploy-studio.sh`.
3. Скрипт на стенде: проверяет fingerprint (`version.json.build == window.__BRIIX_BUILD__`),
   делает **dated .bak** (`studio.bak-<UTC>`, `assets/data.bak-<UTC>`), swap почти-атомарно,
   лог в `/home/badai/briix-studio-deploy/logs/deploy-<date>.log`, live-check `:8440/studio/`.
4. При `--with-bff`: если `bff.py` отличается — `.bak-<UTC>` + замена + `systemctl --user
   restart media-bff.service` + проверка ровно 1 процесса. Без изменений — не трогает сервис.
5. Live-verify на маке: `https://demo.briix.ru/studio/version.json` build == ожидаемому.

## Что автоматизировано / что вручную

- Автоматически: пуш в Forgejo, выкладка, бэкапы, fingerprint-гейт, лог, верификация.
- Вручную: поднятие версии (`__BRIIX_BUILD__` в `studio/index.html`) перед релизом —
  как раньше, T-35. Рестарт `media-bff` — только через `--with-bff` (иначе сервис не трогается).
- GitHub: `deploy-stand` в ci.yml остаётся как страховочный/параллельный канал; релиз
  быстрее через новый путь и не ждёт GH-очередь.

## Роль Forgejo

- `bestdeejay-design/briix-studio` — обычный (не pull-mirror) репозиторий-приёмник,
  пушится агентами из этого репо. **Не путать с pull-зеркалами (10:00/22:00)** — в них
  пушить запрещено (см. INFRA docs/SELFHOSTED-GIT.md). Создан 21.11 через API
  (forgejo-admin, basic-auth), приватный.
- Webhook Forgejo→стенд НЕ настроен: деплой принимает bundle по ssh-stdin, внешнего
  HTTP-эндпоинта на стенде для вебхука нет (и заводить его значило бы править Caddyfile).
  Если когда-нибудь нужен полный автотриггер — вопрос координатору infra.

## Откат (rollback)

- Static: на стенде `mv /home/badai/briix-demo/studio.bak-<UTC>` обратно поверх
  `studio/` (и при необходимости `assets/data.bak-<UTC>` → `assets/data/`).
  Ничего не удаляется: бэкапы копятся append-only, чистка — отдельным решением.
- bff: `mv /home/badai/briix-media/media-bff/bff.py.bak-<UTC>` поверх `bff.py` +
  `systemctl --user restart media-bff.service`.
- Git: `git push forgejo` не форсится; откат = коммит-реверт и новый релиз.

## Установка/восстановление инфраструктуры пути

- Скрипт на стенде: `/home/badai/briix-studio-deploy/deploy-studio.sh` (idempotent).
  Канон-копия для перезаливки scp-ом — в этом репо `tools/stand/deploy-studio.sh`
  (версия 21.11.2026, синхронны).
- Helper на маке: `~/.ssh/forgejo-askpass` (700): Username → `forgejo-admin`,
  Password → 3-е поле строки `admin ...` из `~/.ssh/forgejo-creds`. Токены не печатать.
- Remote: `git remote add forgejo https://git.briix.ru/bestdeejay-design/briix-studio.git`
