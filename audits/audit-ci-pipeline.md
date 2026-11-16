# Аудит CI-конвейера briix-studio (issue #30, часть 1)

Дата: 2026-11-16. Исполнитель: агент аудита (нулевая история проекта, всё проверено с нуля).
Объект: `.github/workflows/ci.yml` (единственный workflow в репо), история прогонов GitHub Actions.

## 1. Карта workflow

Файл: `.github/workflows/ci.yml` — единственный workflow, два job.

### Triggers (ci.yml:2-5)
- `push: branches [main]`
- `pull_request:` — **без фильтров веток и путей** (все PR, все типы правок)
- `concurrency` — **отсутствует** (не отменяются устаревшие прогоны)

### Job `tests` (ci.yml:8-91)
- Runner: `ubuntu-latest`, timeout 10 минут, один последовательный job.
- Шаги:
  1. checkout + setup-node 20 (без `cache:`)
  2. Install playwright: `npm init -y && npm i playwright @axe-core/playwright && npx playwright install --with-deps chromium` (без кеша, каждый прогон)
  3. `node --check` studio/*.js + tools/*.cjs
  4. VM-only чеки (не требуют браузера): `asset-versions`, `check-bench`, `check-assembly`, `check-music-brain`, `check-producer`
  5. Chromium-сюиты (через `tools/browser-env.cjs`, свой сервер на 127.0.0.1): `check-session-store`, `check-studio-storage`, `check-waveform`, `check-studio`, `check-wait-phrases`, `check-cache-selfheal`, `check-a11y`
- Обработка падения check-studio: tee в файл + `::error` аннотация + артефакт лога (`if: always()`) — продумано.

### Job `deploy-stand` (ci.yml:93-111)
- `if: push && refs/heads/main`, `needs: [tests]` — красный tests блокирует деплой (проверено на прогоне 43847849106: deploy пропущен).
- Runner: `[self-hosted, briix-ci]` (стенд A), timeout 5 мин.
- Деплой: tar-конвейер `studio/` → `/home/badai/briix-demo/studio/`, `assets/` → `briix-demo/assets/data/`.
- Проверка после деплоя: `ls | wc -l` и HTTP-код `127.0.0.1:8440/studio/`. **Хеши/version.json на проде не сверяются.**

## 2. Карта «правка → что прогонится»

Пути нет — **любая правка в любом файле гоняет полный набор** (кроме deploy-stand, который только на push в main):

| Правка | tests (≈6 мин) | deploy-stand |
|---|---|---|
| `studio/*.js` (код) | node --check + все 11 чеков (5 VM + 6 chromium) | да (push main) |
| `tools/*.cjs` | весь набор | да (push main) |
| `docs/*`, `audits/*`, README | весь набор, включая 6 chromium-сюит | да (push main, контент студии не менялся — rsync идемпотентен) |
| `version.json`, `studio/index.html` | весь набор | да |
| `.github/workflows/ci.yml` | весь набор | да |

Хронометраж (прогон 43925536541, merge docs-PR #29 в main — **docs-only правка**):

| Шаг | Время |
|---|---|
| checkout + setup-node | 8 с |
| Install playwright | 20 с |
| node --check + 5 VM-чеков | 3 с суммарно |
| **check-studio (2295 строк, 404 ассерта)** | **4:29 — 75% джобы** |
| check-wait-phrases | 35 с |
| check-cache-selfheal | 18 с |
| check-a11y | 3 с |
| Итого tests | ≈5:55 |
| deploy-stand | ≈5 с |

Сравнение docs-only vs code (gh run list --limit 30):
- docs-only PR #29 (run 43924397627): 6:17; merge-push того же (43925536541): 6:13
- docs-only PR #28 (run 43919462863): 6:00; merge-push (43920566402): 6:52
- code PR #27 fix/feed-draft-guards (43875868045): 6:39; merge-push: 20:11 (стоял в очереди, тестовая часть ≈6 мин)

Вывод: docs-only и code-правки стоят одинаково (~6 мин), и каждый смерженный PR съедает **два** полных прогона (PR + push в main) ≈ 12 мин CI. Дублирующий push-прогон на merge-коммите имеет ценность только как гейт деплоя — но можно было бы гонять только его при push и skip PR, либо кешировать.

## 3. Находки

### P1 (влияет на всё, каждый прогон/каждый PR)

**P1-1. Docs-only правки гоняют полный chromium-регресс.**
Доказательство: прогоны 43924397627 (docs PR #29, 6:17) и 43919462863 (docs PR #28, 6:00) — по 6 chromium-сюит на правки только в `docs/`. `ci.yml:2-5` не содержит `paths:`. При текущей частоте docs-коммитов (3 из последних 8 прогонов — docs) это ~20 мин чистого waste в день.

**P1-2. Нет concurrency — прогоны не отменяются и не дедуплицируются.**
`ci.yml` не содержит секции `concurrency`. Доказательство: code-пуш прогона 43875916749 шёл 20 мин (13:27→13:47) при типичных 6 — ожидание очереди за ещё идущими прогонами (10:14→10:21 у 43847070388 и параллельный 10:14 PR #27). Новый пуш в ту же ветку не отменяет старый прогон (нет `cancel-in-progress`).

**P1-3. main не защищён в GitHub — красный CI не блокирует merge.**
Доказательство: `GET /branches/main/protection` → 404 Branch not protected. Реальный инцидент: PR #25 (run 43847805097, failure, asset-versions рассинхрон) был смержен, push в main упал (run 43847849106, failure, та же причина), деплой стенд-а не шёл до фикса #26 (10:19→10:32). Гейт деплоя сработал, но процесс позволил довести красный код до main.

### P2 (заметный выигрыш / дыра в гарантии)

**P2-1. Деплой не проверяет содержимое прода.**
`ci.yml:110-111`: после tar-конвейера только `ls | wc -l` и HTTP-код. `version.json` с отпечатком сборки (`studio/version.json`, build `adba617caf`) есть в самом деплое — сравнение отпечатка `http://127.0.0.1:8440/studio/version.json` с ожидаемым было бы бесплатным (репо без сборки, хеши известны заранее) и поймало бы частичный/пустой tar.

**P2-2. Ноль кеширования: npm-пакеты и браузер ставятся каждый прогон.**
`ci.yml:13-20`: setup-node без `cache:`; `npm i playwright @axe-core/playwright` + `npx playwright install --with-deps chromium` = 20 с на каждый из 30 последних прогонов. ~10 мин waste за день. Кандидаты: `actions/setup-node` с `cache: npm` + кеш `~/.cache/ms-playwright` (actions/cache) или `npx playwright install --with-deps` только при промахе кеша.

**P2-3. check-studio монолит: 4:29 в одном шаге, ширина 10-минутного timeout почти исчерпана при росте.**
`ci.yml:10` (timeout 10), `ci.yml:50-58`, `tools/check-studio.cjs` (2295 строк, 404 ассерта, 6 прогонов браузера). 75% времени джобы. С ростом сетки job упрётся в 10 мин целиком (нет per-step таймаута, нет шардирования). Сейчас запас есть, но каждый новый блок ассертов добавляется прямо в критический путь.

**P2-4. Битрейт-матрица mux не проверяется нигде в этом репо.**
Правило: flash→192k, pro→320k, instrumental→320k (`docs/agents/BRIIX-STUDIO-PROJECT.md:16`). Реализация — в `server-contract/bff.py:66` (WAV+cover → MP3 192k), но `bff.py` — контракт, а не исполняемый код этого репо; ни один чек в `tools/` не знает про битрейт (grep `bitrate|192|320` по studio/ и tools/ — пусто). CI студии защищать это правило не может — либо оно проверяется в репо сервера, либо не проверяется вовсе. Требует решения координатора.

### P3 (гигиена)

**P3-1. safeFileName не покрыт напрямую.**
`studio/studio.js:1266-1274` — чистка спецсимволов, кириллица, fallback. В `tools/` нет ни одного теста `safeFileName` (grep пуст). Косвенно прикрыто download-тестами: `check-studio.cjs:636-637` (`briix-photo-*.png`) и `:998-999` (`Title - Artist.m4a`), т.е. два happy-path, но краевые случаи (кавычки, `..`, пустой title) не гоняются.

**P3-2. CI шире канонического локального регресса на один чек — это ок, но задокументировать.**
Канон (`docs/agents/BRIIX-STUDIO-PROJECT.md:24-36`) — 11 сюит. В CI: те же 11 + `check-bench` (`ci.yml:28-31`) + `node --check` + `asset-versions` как гейт. Локально `check-bench` в канон-список не входит — расхождение безвредное (CI строго сильнее), но канон-документ стоит синхронизировать.

**P3-3. deploy-stand на self-hosted runner без ограничений по ветке job'а.**
`ci.yml:96-98`: job честно ограничен `push && main`, но сам факт, что writer прода — GitHub-hosted job на self-hosted машине, означает: любой workflow-файл, добавленный в будущем с `runs-on: [self-hosted, briix-ci]`, получит доступ к стенду. При неизменённой политике это норм, при росте репо — точка контроля.

## 4. Что CI защищает из правил продукта (проверка покрытия)

| Правило | Покрытие | Доказательство |
|---|---|---|
| Длительность не уходит модели | ДА | `tools/check-assembly.cjs:160-164`: в studio.js допустимы только `audio.duration`/`durationchange` |
| Промт в модель — английский | ДА | `tools/check-assembly.cjs:4-5, 79-103` (рус. идея → ASCII/английский, latinizeTags) |
| Битрейт-матрица mux | НЕТ (вне репо) | см. P2-4 |
| safeFileName | ЧАСТИЧНО | см. P3-1 |

Сюиты, которых нет локально, но есть в CI — нет; наоборот, локальный канон = CI (кроме P3-2). Локальный «тест на реальных данных владельца» (PROTOCOL §7, формат данных) в CI невозможен и не претендует.

## 5. Черновик «как должно быть» (не решение — материал для ресёрча и коллегии)

1. `concurrency: { group: ci-${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }` — дешёво, без минусов для PR, для push в main осторожно (не отменять деплоящийся прогон — возможно `cancel-in-progress: false` для main).
2. Path-фильтрация: либо `paths-ignore: [docs/**, audits/**, '**.md']` на `pull_request`, либо jobs `vm` (быстрые 5 чеков) и `browser` (6 chromium), где browser-job через `dorny/paths-filter`/`paths` скипается на docs-only. Для push в main фильтры не ставить (гейт деплоя всегда честный).
3. Кеш: `actions/setup-node` с `cache: npm` + явный `package.json` в корне (сейчас `npm init -y` на лету, lockfile нет — кеш npm всё равно слабый; вариант — коммитнуть package-lock.json) + `actions/cache` на `~/.cache/ms-playwright` с ключом по версии playwright.
4. Разделение `tests` на `vm` (≈10 с) и `browser` (≈5:30) — параллельно, branch protection на два required check; заодно открывает путь к шардированию check-studio позже.
5. Деплой: после tar сверять `curl -s http://127.0.0.1:8440/studio/version.json` с `studio/version.json` из checkout (прод = копия main, совпадение обязано быть точным).
6. Branch protection на main: required check `tests` + запрет own-approve (канон «ревьюер не автор»). Решение за владельцем/координатором — затрагивает процесс, не только CI.
7. Занести в канон (`docs/agents/BRIIX-STUDIO-PROJECT.md`) check-bench в список регресса, чтобы канон = CI.

## 6. Что не проверено (честно)

- Сюиты локально не запускал — хронометраж взят из телеметрии Actions, не из локальных прогонов.
- Не видел логов self-hosted runner'а briix-ci (очередь, heartbeat) — вывод о простоях очереди косвенный, по длительности push-прогонов.
- Не проверял bff.py исполняемо (он контракт, вне CI): битрейт-матрица могла проверяться в репо сервера — вне скоупа этого аудита.
- Не проверял, сколько стоит `--with-deps chromium` отдельно от npm-шага (шаг один, разбиение невозможно из телеметрии).
- Защиту от fork-PR на self-hosted runner не оценивал: `pull_request` открыт для форков, а deploy-stand срабатывает только на push в main — ок сейчас, но точка контроля P3-3 актуальна при включении fork-конрибьюторов.
