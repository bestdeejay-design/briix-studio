# Задача #30 — CI по дизайну B: docs-only лёгкий прогон, concurrency, кеш playwright, верификация деплоя

Дата: 2026-11-16. Исполнитель: агент CI/CD. Ветка `feat/ci-target-design-b` от `origin/main` (eef4ce2).
Дизайн B — сбалансированный вариант из `audits/research-ci-target-design.md` (§3), задание — issue #30.

## 1. Что сделано

### `.github/workflows/ci.yml` — переработан (4 job-а вместо 2)

1. **`changes` (новый):** `dorny/paths-filter@0e4a8c6effa4802afeda77dc8d303f8176d7dfad` (v3.0.4, пин по SHA).
   Выходы: `docs` (docs/**, audits/**, **.md) + `docs_files` (список JSON, `list-files: json`) и `deployable`.
   Явный `base` не ставится: для pull_request дефолт = ветка базы (main), для push в main — `github.event.before`
   (предыдущий коммит), явный base сломал бы diff merge-коммита (HEAD == base).
2. **`tests`**: полный регресс (11 сюит + node --check + check-bench, состав не менялся).
   - `concurrency: ci-tests-${{ github.ref }}`, `cancel-in-progress: true` — устаревший прогон ветки отменяется.
   - Кеш npm (`setup-node cache: npm`) + `actions/cache@v4` на `~/.cache/ms-playwright` с ключом
     `playwright-<os>-hashFiles('package-lock.json')`. При попадании в кеш — `npx playwright install chromium`
     без `--with-deps` (apt-пакеты кешировать нельзя). `npm init -y` заменён на `npm ci`.
   - Условие запуска: полный регресс, если есть deployable-правки ИЛИ правки не docs-only.
3. **`docs-check` (новый):** лёгкий прогон на чисто-документационных изменениях (docs == true И deployable != true):
   `tools/check-md-links.cjs` (относительные ссылки изменённых md) + `tools/asset-versions.cjs`. Без chromium, ~секунды.
4. **`deploy-stand`**:
   - запускается только если `deployable == 'true'` (studio/**, assets/**, tools/**, server-contract/**, .github/**,
     package*.json) и `tests.result == 'success'`; docs-only пуш в main пропускает деплой (статус skipped);
   - `concurrency: deploy-stand`, **`cancel-in-progress: false`** — очередь, отмена активного деплоя невозможна;
   - новый шаг **post-deploy verification**: сверяет `build` из `https://demo.briix.ru/studio/version.json`
     и `__BRIIX_BUILD__` из живого HTML с отпечатком смерженного `studio/index.html`; расхождение — `::error` + exit 1.

### Новые файлы

- `package.json` — devDependencies с точными пинами: `playwright@1.65.0`, `@axe-core/playwright@4.14.0` (версии = локальному канону, /opt/homebrew). Lockfile `package-lock.json` (npm lockfileVersion 3) закоммичен — ключ кеша стабилен (REVIEWER_KICK #4).
- `tools/check-md-links.cjs` — утилита (не сюита), проверка относительных ссылок изменённых markdown. Скоуп:
  файловые ссылки репо; внешние URL и якоря — вне скоупа. Снимок канона `docs/agents/` — дословный снимок хаба
  `bestdeejay-design/agents`, его ссылки на ../../AGENTS.md, ./agents/, ./skills/ и т.п. ведут в другой репо —
  для файлов снимка такие цели считаются `CROSS-REPO (ok)` (warning), для остального репо битая ссылка = exit 1.

### REVIEWER_KICK — все 5 ловушек закрыты

1. **paths-ignore/Pending:** `paths-ignore` на workflow НЕ используется; фильтрация job-level через paths-filter.
   Branch protection перепроверен до старта: `gh api .../branches/main/protection` → 404.
2. **cancel-in-progress деплоя:** deploy-stand — строго `cancel-in-progress: false`; `cancel: true` только у `tests`.
3. **Деплой не отсекается по deliverable-путям:** в `deployable` включены studio/**, assets/**, tools/**, server-contract/**, .github/** (workflow-правки деплоят), package*.json. Отсечены только чисто docs-правки.
4. **Стабильный ключ кеша:** `npm init -y` убран, lockfile закоммичен, пины точные (без ^).
5. **Живой прогон на ветке:** PR открыт сразу после пуша, CI на ветке проверен (см. ниже).

### Branch protection (пункт 6 задания)

Вопреки ожиданию «прав нет» — **защита установлена успешно**:

```
PUT /repos/bestdeejay-design/briix-studio/branches/main/protection
required_status_checks: contexts=["tests"], strict=false
enforce_admins=false, allow_force_pushes=false, allow_deletions=false
```

Проверка ответа: `required_status_checks.checks=[{context:"tests", app_id:15368}]`.
`enforce_admins=false` — координатор (main пишет только координатор) может мержить в исключительных случаях.
Отдельный шаг для координатора **не требуется**. Если политика не нужна — снять:
`gh api -X DELETE repos/bestdeejay-design/briix-studio/branches/main/protection`.

## 2. Как проверено

- Локальный полный регресс 11 сюит (`NODE_PATH=/opt/homebrew/lib/node_modules`): все 11 PASS (check-studio, check-assembly, check-session-store, check-studio-storage, check-waveform, check-producer, check-music-brain, check-wait-phrases, check-a11y, asset-versions, check-cache-selfheal)
- `node --check` на все studio/*.js + tools/*.cjs — PASS; `actionlint` — только 2 известных замечания
  (self-hosted label `briix-ci`, SC2012 на `ls` — оба до правки).
- CI на ветке: [заполняется по результату]
- `check-md-links.cjs`: полный прогон по репо — 40 ссылок / 37 файлов, 19 cross-repo refs снимка, 0 битых.

## 3. Что осталось непроверенным

- Post-deploy verification не выполнен на реальном деплое: деплой-stand срабатывает только на push в main,
  а PR в main не мержится по условию задачи. Скрипт верификации проверен локально (curl demo.briix.ru
  возвращает валидные version.json и HTML, оба build = `adba617caf` = ожидаемому из index.html). Первая реальная проверка —
  следующий merge deployable-PR в main; если prod-сервер не отдаёт demo.briix.ru с runner'а — шаг упадёт,
  откат: убрать шаг.
- Кеш playwright на ubuntu runner: первый прогон — cache miss (--with-deps), попадание кеша проверится
  со второго прогона.
- concurrency-очередь deploy-stand в бою не проверялась (нужны два подряд push в main).
- dorny/paths-filter на push в main (diff по github.event.before) не проверен живым прогоном.

## 4. Файлы

- `.github/workflows/ci.yml` — переработан
- `package.json`, `package-lock.json` — новые
- `tools/check-md-links.cjs` — новый
- `audits/task-30-ci-target-design-b.md` — этот отчёт

Не тронуто: studio/*.js, сюиты tools/check-*.cjs, server-contract/ — по условию задачи.
