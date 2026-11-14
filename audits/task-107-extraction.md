# Отчёт: вынос студии в bestdeejay-design/briix-studio (issue briix.ru#107)

Дата: 14.11.2026. Исполнитель: executor-саб (arena). База: origin/main briix.ru `c106870` (PR #108 внутри, проверено `gh pr list --state merged`).

## Что сделано

- Создан public-репозиторий https://github.com/bestdeejay-design/briix-studio (описание «BRIIX Studio — chat-first AI studio: sessions, music/photo generation UI, producer drafts»). Initial commit `c84772c` прямо в `main`.
- Переехали из briix.ru (побайтово, без правок логики):
  - `studio/`: `index.html`, `studio.js`, `studio.css`, `session-store.js`, `waveform.js`, `producer-brain.js`
  - копии `wait-phrases.js`, `wait-ui.js` внутрь `studio/`
  - `tools/`: `check-studio.cjs`, `check-session-store.cjs`, `check-studio-storage.cjs`, `check-waveform.cjs`, `check-producer.cjs`, `check-wait-phrases.cjs`, `browser-env.cjs`
  - `server-contract/`: `tools/media-bff-config/{bff.py,README.md}`; в README добавлена пометка «снимок контракта, живёт на стенде A, источник истины не здесь».
- Самодостаточность: в `studio/index.html` пути `../wait-*.js?v=20261114` → `./wait-*.js?v=20261114` (кеш-баст сохранён). Grep по studio/ — других `../` нет; studio.js делает только relative fetch (`/api/*`, `/assets/data/creative-base.json`, внешний URL только по пользовательскому credential в workflow-проверке).
- `README.md`: что это, прод https://demo.briix.ru/studio/, локальный запуск, как гонять 6 сюит, ссылка на `server-contract/`.
- `.github/workflows/ci.yml`: `ubuntu-latest` (не briix-ci), timeout 10 мин, npm playwright + chromium, `node --check` всех JS, 6 сюит. `check-wait-phrases` — `continue-on-error: true` с комментарием-пометкой (см. «Отклонения»).

## Отклонения от манифеста (честно)

1. **Добавлен каталог `assets/`** (`assets/data/creative-base.json`, `assets/media/showcase/ballad30.m4a`, `assets/media/showcase/jingle.m4a`) — в манифесте его не было. Причина: `check-studio.cjs` читает `ROOT/assets/data/creative-base.json` (строка 301) и `check-waveform.cjs` читает `assets/media/showcase/jingle.m4a` (строка 88), а runtime `studio.js:182` сам делает same-origin `fetch('/assets/data/creative-base.json')`. Без этих файлов 2 из 6 сюит не стартуют на новом клоне. Файлы побайтово из briix.ru, логика тестов и студии не тронута.
2. **Сюита `check-wait-phrases.cjs` на новом клоне НЕ проходит** (не «сеть», а зависимость от демо-корня briix.ru). Она поднимает свой сервер, но открывает ROOT `/index.html` (демо-сайт: `#main-content`, `#music-prompt`, `.music-page`, `demo.js`) — эти файлы по манифесту НЕ переезжают («не переезжают демо-разделы»). В briix.ru сюита зелёная (проверено: `DONE 10 checks`), здесь падает на `waitForSelector('#main-content')` — 404. По инструкции сделан шаг в CI `continue-on-error: true` с пометкой; ассерты не глушены. Если владелец захочет зелёную 6/6 — либо тащить демо-корень (против манифеста), либо адаптировать сюиту на studio-страницу (отдельная задача).
3. Проверка синтаксиса в CI покрывает `studio/*.js` + `tools/*.cjs` (в briix.ru в проверку входили и корневые `demo.js` — они не переехали, тут их нет).

## Гейт слепой копии (diff studio/ старый ↔ новый)

```
index.html: 193,194c193,194
< <script src="../wait-phrases.js?v=20261114"></script>
< <script src="../wait-ui.js?v=20261114"></script>
> <script src="./wait-phrases.js?v=20261114"></script>
> <script src="./wait-ui.js?v=20261114"></script>
studio.js, studio.css, session-store.js, waveform.js, producer-brain.js — без различий
wait-phrases.js, wait-ui.js — побайтово идентичны
```

Только пути wait-*. Основание копий сверено с origin/main (`git diff origin/main --stat` по всем копируемым файлам — пусто).

## Результаты 6 сюит на новом клоне (NODE_PATH=/opt/homebrew/lib/node_modules)

| Сюита | Результат |
|---|---|
| check-studio | PASS — SUITE PASS: 46 checks |
| check-session-store | PASS — migration, backup, fallback, isolation, conflicts and failures |
| check-studio-storage | PASS — integrated fallback and failed migration preserve source, with visible warning |
| check-waveform | PASS — real PCM waveform (WAV and repository M4A), seek, oversized and decode-error fallbacks |
| check-producer | PASS — producer parsing, limits, original lyrics and warning heuristics |
| check-wait-phrases | FAIL на новом клоне (нет демо-корня briix.ru) / PASS в briix.ru |

`node --check` всех `studio/*.js` + `tools/*.cjs` — чисто. Секрет-скан скопированных `server-contract/bff.py` и README — чисто (токены уже REDACTED в источнике).

## Что НЕ сделано / непроверено

- **Деплой на прод не делал** (манифест: это следующий шаг после приёмки координатора). Адрес demo.briix.ru/studio/ не трогался, md5 прод-состояния сверить вживую не мог.
- **CI нового репо не проверен вживую** (workflow запустится на push main — коммит уже сделал это, но результаты ранa надо смотреть в Actions; локально сюиты прогнаны с homebrew-путями, а не через npm-шаг workflow).
- **Правки briix.ru не делал** (demo-ci exclude, redirect-стаб studio/, ссылки в docs — по манифесту это отдельный PR координатора).
- Стенд A, caddy, юниты, prod-файлы — не трогал.
- `browser-env.cjs` в CI Ubuntu: в старом репо есть ветка `@sparticuz/chromium` — на ubuntu-latest с `playwright install --with-deps chromium` должен идти обычный chromium, но реальный прогон CI не видел.
