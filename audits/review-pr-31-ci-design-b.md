# Ревью PR #31 — CI «дизайн B» (issue #30)

Дата: 2026-11-16. Ревьюер: независимый агент (нулевая история, не автор).
Ветка: `feat/ci-target-design-b` @ `a87714a8`. Опора: диф построчно, audits/task-30-ci-target-design-b.md,
audits/audit-ci-pipeline.md (ветка `audit/ci-pipeline`), audits/research-ci-target-design.md (ветка `research/ci-target-design`),
WORKFLOW §6.1/§4, BRIIX-STUDIO-PROJECT.md, живые прогоны CI и локальный регресс.

## ВЕРДИКТ: **PASS** (без блокирующих находок; P2/P3 — см. ниже)

## 1. Бриф: сделано ровно заявленное

Построчная сверка дифа `origin/main...HEAD` с брифом:

- **4 job: changes / tests / docs-check / deploy-stand** — есть, состав совпадает (ci.yml:16-243).
- **Кеш npm + playwright** — `setup-node cache: npm` (ci.yml:113) + `actions/cache@v4` на `~/.cache/ms-playwright`,
  ключ по `hashFiles('package-lock.json')` (ci.yml:121-127). Ветка ветвления cache-hit/miss корректна (ci.yml:135-141).
- **Lockfile с пинами** — `package.json` с точными пинами без `^` (playwright 1.65.0, @axe-core/playwright 4.14.0),
  `package-lock.json` закоммичен, `npm init -y` убран → `npm ci`. `.gitignore` — только раскомментирование двух строк,
  node_modules по-прежнему игнорируется.
- **Concurrency**: tests `ci-tests-${{ github.ref }}` cancel:true (ci.yml:69-72); deploy-stand `deploy-stand`
  cancel:false (ci.yml:203-206). Группы разные — cancel тестов не задевает деплой.
- **Post-deploy верификация отпечатка** — отдельный шаг ПОСЛЕ деплой-шага в том же job (последовательность
  шагов гарантирует завершение tar-деплоя), сверка `version.json.build` и `__BRIIX_BUILD__` живого HTML
  с отпечатком смерженного `studio/index.html`, `::error` + exit 1 при расхождении (ci.yml:216-243).
- **tools/check-md-links.cjs** — есть, скоуп как заявлен (файловые ссылки репо; внешние URL/якори вне скоупа;
  снимок docs/agents/ — cross-repo как warning). Смоук локально: `CHANGED='["README.md","docs/agents/README.md"]'` → OK.
- **Ничего сверх**: .gitignore/package*.json/check-md-links.cjs/отчёт — всё из брифа. studio/, сюиты, server-contract не тронуты.

## 2. Краевые случаи (проверено независимо)

- **deployable-фильтр vs фактический деплой**: деплой tar'ит только `studio/` → `/home/badai/briix-demo/studio/`
  и `assets/` → `briix-demo/assets/data/` (ci.yml:212-214). Оба пути в фильтре — **деплой молча не скипнется ни на одном
  деплоируемом пути** (корень репо: README.md, assets, audits, bench, docs, package*.json, server-contract, studio, tools —
  ничего deployable вне фильтра). Обратное направление — filter шире деплоя (tools/, server-contract/, .github/, package*.json
  триггерят деплой, но не отгружаются): деплой идемпотентен (тот же studio/ перетаривается целиком), отпечаток совпадает,
  верификация проходит. Не баг, цена ~секунды — сознательный safety-first (REVIEWER_KICK #3). P3.
- **docs-фильтр**: `**.md` + `docs/**` + `audits/**` против deployable — пересечение разрешено правильно:
  `studio/*.md` матчится и в docs, и в deployable → условия job'ов дают tests (deployable=true), docs-check скипается
  (требует deployable != 'true'). Правка не-кода вне фильтров (например bench/) → docs != 'true' → tests. Дефолт безопасный:
  при падении changes tests всё равно гоняются (`docs != 'true'` на пустом выходе = true).
- **Post-deploy верификация**: после завершения деплой-шага (последовательность шагов); URL `https://demo.briix.ru/studio/`
  — актуальный прод (BRIIX-STUDIO-PROJECT §1). Локальная сверка прямо сейчас: expected `adba617caf` = prod version.json =
  prod HTML — скрипт на живом проде воспроизводим. При недоступности demo.briix.ru job красный (curl -fsS --max-time 10) —
  это честный сигнал «прод недоступен после деплоя», но ложная тревога возможна при инфра-проблеме вне деплоя (P3,
  см. находку 4). Развёртывание не гоняется до завершения tar — ок.
- **concurrency deploy cancel:false**: на уровне GitHub concurrency в группе держится максимум 1 running + 1 pending
  (более новые pending вытесняют старые) — бесконечная очередь невозможна.
- **lockfile / npm ci**: пины точные; CI-прогон 43935628813 — `npm ci` + `npx playwright install chromium` (cache hit)
  и все chromium-сюиты зелёные. Нюанс: lockfile содержит root `playwright-core@1.65.1` (peer от axe) рядом с
  `playwright@1.65.0` → дублирование пакета; не ломает, P3. Сюитам, требующим node-пакеты вне этого набора, — нет:
  все 11 сюит используют NODE_PATH, состав не менялся.
- **Ветка актуальна**: `git merge-base --is-ancestor origin/main HEAD` → OK (eef4ce2 внутри).

## 3. Регресс (канонический список, локально)

Все 11 сюит PASS (`NODE_PATH=/opt/homebrew/lib/node_modules`, ветка a87714a): check-studio, check-assembly,
check-session-store, check-studio-storage, check-waveform, check-producer, check-music-brain, check-wait-phrases,
check-a11y, asset-versions, check-cache-selfheal. `node --check tools/check-md-links.cjs` — OK.

## 4. CI на ветке PR

- Прогон 43936922094 (HEAD a87714a): changes pass 13s, **tests pass 6m02s**, docs-check skipped, deploy-stand skipped.
  `gh pr checks 31` — зелёные, mergeStateStatus **CLEAN**, MERGEABLE.
- Прогон 43935628813: **playwright-кеш подтверждён живьём** — «Cache hit for: playwright-Linux-d503420a…»,
  выполнена ветка без `--with-deps`, chromium-сюиты зелёные (авторский пункт «hit со второго прогона» уже снят).
- Семантика фильтров в прогоне 43933275078 (docs-only коммит 697b001): лог dorny — `Filter docs = true`,
  `Filter deployable = true` (дифф всего PR содержит ci.yml/package.json) → tests полные, docs-check skipped.
  Ведёт себя ровно как заявлено в отчёте исполнителя.
- Branch protection на main: required check `tests`, app_id 15368, enforce_admins=false. Skipped-джобы PR #31
  не вешают мерж (mergeStateStatus CLEAN при 2 skipped) — «skipped satisfying required checks» подтверждено на живом PR.
- actionlint: только 2 известных замечания (self-hosted label `briix-ci`, SC2012 на `ls`) — оба до этой правки.

## 5. Мерж-безопасность

MERGEABLE / CLEAN. После мержа main не зависнет: required `tests` на push в main стартует всегда
(deployable==true или docs!=true — см. п.2; на пустом/упавшем changes — дефолт в tests), skipped docs-check
required-ом не является. На push в main deployable считается по `github.event.before` — направление отказа безопасное:
при null/нестандартном before dorny считает всё изменённым → deployable=true → tests+deploy отрабатывают, а не скипаются.

## Находки

1. **P3 — расхождение отчёта с фактом по branch protection.** Отчёт (§1, task-30) утверждает `strict=false`;
   фактически `required_status_checks.strict = true` (gh api branches/main/protection). Strict=true требует
   «ветка up-to-date с main» перед мержем — координатору при мерже учитывать. Правке не мешает, но отчёт неточен.
2. **P3 — удаление .md файла покрасит docs-check.** `tools/check-md-links.cjs:44-48`: изменённый файл, которого
   нет в репо = «BROKEN SOURCE» → exit 1. dorny list-files на PR включает удалённые файлы → легитимное удаление
   устаревшего документа даст красный docs-check. Не блокер: docs-check не required, деплой не задет
   (deployable != true). Если сочтётся фичей («удаление требует явного решения») — ок, но лучше задокументировать
   в шапке скрипта. Не подтверждено живым прогоном (нет docs-only PR с удалением).
3. **P3 — deployable шире фактического деплоя.** tools/**, server-contract/**, .github/**, package*.json триггерят
   tests + deploy-stand, но деплой отгружает только studio/ и assets/. Безвредно (идемпотентный tar, верификация
   пройдёт), цена — лишний деплой-прогон ~секунды на правке, например, регресс-скрипта. Сознательный safety-first.
4. **P3 — post-deploy верификация зависит от внешней доступности demo.briix.ru.** При инфра-инциденте вне деплоя
   (Caddy/DNS) deploy-stand будет красным с вменяемым ::error — сигнал полезный, но канал «деплой vs прод-инфра»
   не разделяется. Также не проверено поведение при кеширующем слое перед demo.briix.ru (устаревший index.html
   на проде = ложный красный). Шаг живьём не выполнялся (деплой — только push в main), что автор честно указал.
5. **P3 — skew playwright-core в lockfile.** root `playwright-core@1.65.1` (auto-peer от @axe-core/playwright)
   рядом с `playwright@1.65.0` (внутри — core 1.65.0). Работает, но `npm ls playwright-core` покажет дубль;
   при желании — пере-генерация lockfile или `overrides`.
6. **P3 — governance-наблюдение.** Текст issue #30 ограничивает объём «аудит + ресёрч + предложение на согласование»;
   авторизация имплементации дизайна B в issue не зафиксирована (0 комментариев) — решение живёт в брифе
   координатора. Для канона (задание = issue) стоит закрыть вопрос явным словом владельца на issue #30 при приёмке.

## Непроверенное ревьюером

- Post-deploy верификация и concurrency-очередь деплоя в бою (нужен первый merge deployable-PR в main).
- dorny на push в main (github.event.before) живьём — сработает на первом мерже после этого PR.
- Ветка «чисто docs-only PR → tests skipped + docs-check» живым прогоном не покрыта (логика фильтров сверена
  статически + по логам dorny на 43933275078).
- Поведение docs-check при удалении .md (находка 2) — только статический разбор.
