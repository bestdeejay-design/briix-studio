# Ресёрч: целевой дизайн CI для no-build статик-SPA (issue #30, часть 2)

Автор: агент-ресёрчер, 16.11.2026. Ветка `research/ci-target-design` от `origin/main` (eef4ce2).
Нулевая предыстория: выводы опираются на внешние источники (дока GitHub Actions, Playwright,
обсуждения community) + на фактическое состояние текущего CI (`.github/workflows/ci.yml`).
Без финального выбора — выбор за коллегией и владельцем.

## 0. Контекст репозитория (факты, не мнения)

- Один workflow `ci.yml`: job `tests` (ubuntu-latest) → job `deploy-stand` (self-hosted `briix-ci`, push в main).
- `tests` каждый раз делает `npm init -y` + `npm i playwright @axe-core/playwright` +
  `npx playwright install --with-deps chromium` — **кеша нет вообще** (ни node_modules, ни браузеров).
- 11 JS-файлов студии, 15 сюит в `tools/*.cjs`, 37 markdown-файлов (`docs/`, `audits/`, `AGENTS.md`...).
- История коммитов: значительная часть — чисто docs (`docs:`, `review:`, отчёты в `audits/`),
  т.е. полный прогон playwright-сюит на таких пушах — чистая трата минут.
- Деплой — tar-конвейер на локальном runner'е, стоящем на стенде; верификация —
  `ls | wc -l` + `curl http_code`. Это уже неплохо, но concurrency-группы нет:
  два пуша в main подряд → два деплоя гоняют tar в одну папку.

## 1. Практика по темам задания

### 1.1 Path-фильтры и условные прогоны

| Механизм | Суть | Ловушка |
|---|---|---|
| `paths:` / `paths-ignore:` в `on:` | workflow не стартует вовсе | если чек required — PR висит в Pending вечно ([community #44490](https://github.com/orgs/community/discussions/44490)); у первого PR нет base для diff — фильтр может отработать неверно |
| `dorny/paths-filter` | job определяет changed-группы, дорогие job-ы гейтятся `if:` | skipped job всё равно репортит статус "skipped" — required-чек с ним не блокирует; action требует base, на первом PR/новой ветке нужен явный `base: main` |
| Статус-гейт (gatekeeper job) | финальный always-running job — required-чек | надёжный обход Pending, но лишний job |

Консенсус источников ([pantsbuild](https://www.pantsbuild.org/blog/2022/10/10/skipping-github-actions-jobs-without-breaking-branch-protection), [starsling.dev](https://starsling.dev/best-practices/github-actions/path-filter-workflows), [oneuptime](https://oneuptime.com/blog/post/2025-12-20-monorepo-path-filters-github-actions/view)): **не вешать path-фильтр на уровень workflow, если чек required**. Либо фильтровать job-ы (skipped-статус считается отчётом), либо иметь гейт-job. Для нашего репо required-чеков, судя по всему, нет (мерджи идут свободно) — тогда и workflow-level `paths-ignore` безопасен, но job-level через `dorny/paths-filter` гибче (один прогон может решить и «тесты», и «деплой» раздельно).

Отдельно: **skipped ≠ cancelled ≠ failed**. Skipped job в required checks не блокирует merge (после обхода Pending); cancelled — блокирует как failure. Это важная семантика при дизайне.

### 1.2 Разделение docs-only от code

- Полное игнорирование: `paths-ignore: ['docs/**', '**.md', 'audits/**']` — дёшево, но при required-чеках ловушка из 1.1; и риск: docs-коммит, меняющий, скажем, `docs/**` с embed-скриптом, не прогонит ничего.
- Лёгкий прогон вместо полного: markdown lint / проверка ссылок (lychee и т.п.) — минуты, ловит битые внутр. ссылки в `docs/` и `audits/`.
- `[skip ci]` / `[ci skip]` в сообщении head-коммита — нативно ([дока](https://docs.github.com/actions/managing-workflow-runs/skipping-workflow-runs)), работает только для `push`/`pull_request`, и при required-чеках оставляет их Pending. Ручной инструмент, не автоматика.
- Дискретные «маркеры DOC_ONLY» в теле PR — самодельный паттерн, надёжнее path-фильтр не делает ничего; обычно избыточен, когда path-фильтр уже есть.

Для нашего репо: типовой docs-коммит (`docs:`, отчёты в `audits/`) — это ~30–50% истории. Полное игнорирование CI на них оправдано, но **деплоить студию на такой пуш не нужно** — это важнее, чем экономия тестов.

### 1.3 Кеширование node_modules / playwright-браузеров

Канон — [playwright.dev/docs/ci](https://playwright.dev/docs/ci):

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: 'npm'
- uses: actions/cache@v4
  id: pw
  with:
    path: '~/.cache/ms-playwright'
    key: 'playwright-${{ runner.os }}-${{ hashFiles(''package-lock.json'') }}'
- run: npx playwright install --with-deps chromium
  if: steps.pw.outputs.cache-hit != 'true'
```

- `~/.cache/ms-playwright` на Linux — ~150–300 МБ; скачивание + `--with-deps` (apt) стабильно занимает 1.5–4 минуты на чистом runner'е. Кеш срезает до секунд на hit ([playwrightsolutions](https://playwrightsolutions.com/playwright-github-action-to-cache-the-browser-binaries), [currents.dev](https://currents.dev/posts/github-actions-cost-how-to-cut-playwright-ci-minutes-without-losing-coverage)).
- `--with-deps` (apt-пакеты) кешировать нельзя — их оставляют прогонять (apt на ubuntu-latest быстрый, пакеты почти всегда уже предустановлены, часто достаточно `npx playwright install chromium` без `--with-deps`).
- Ключ кеша: `hashFiles('package-lock.json')`. В нашем ci.yml **lockfile не коммитится** (`npm init -y` на лету) — это значит: (а) версии playwright плавающие от прогона к прогону — сюрприз «уехавшей» мажорной версии в CI; (б) `hashFiles` не сработает. Чтобы кеш был честным, нужен закоммиченный lockfile (или пин версий в ключе).
- `setup-node cache: 'npm'` кеширует `~/.npm`, ускоряя `npm i` — требует lockfile тоже.

Вердикт: да, реально срезать 2–4 мин/прогон, но ценой коммита lockfile. Для self-hosted runner на стенде кеш ещё проще: дисковый кеш persist между прогонами, actions/cache вообще не обязателен.

### 1.4 Быстрые vs полные прогоны (fast/live split)

Паттерн для малых проектов ([pie.inc](https://pie.inc/blog/regression-testing-in-ci-cd), [kodziak](https://www.kodziak.com/blog/smoke-testing-vs-regression-testing), [testing academy](https://app.thetestingacademy.com/blog/regression-testing-guide)):

- **PR / пуш**: smoke — подмножество самых дешёвых и самых «ловящих» проверок (у нас: `node --check`, `asset-versions`, `check-bench`, `check-assembly` — всё это без playwright, секунды).
- **main / nightly**: полный регресс (playwright-сюиты: `check-studio`, `check-wait-phrases`, `check-cache-selfheal`, `check-a11y`).
- Ключевые риски, названные во всех источниках: (1) флейки в блокирующей дорожке учат команду «перепрогонять, не читать»; (2) красный main при «зелёных PR» — если полный регресс уехал в nightly, найденные баги стареют; (3) smoke не должен быть отдельной ручной работой — это подмножество регресса.
- Дешёвая альтернатива для мелких репо: полный прогон на PR, но с кешем (1.3) + sha-пуш не триггерит повтор (см. 1.5), — часто хватает без разделения.

Нюанс для нас: сюиты на node с playwright у нас запускаются локально агентами и так; полный регресс на PR сейчас ~10 мин timeout — терпимо, а вот на docs-пушах — лишнее.

### 1.5 Деплой-гигиена

- **concurrency** ([дока](https://docs.github.com/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs)): для деплоя — `group: deploy-stand`, **`cancel-in-progress: false`** (отмена активного деплоя = риск полупереписанной папки; для tar-перезаписи в одну директорию последовательность обязательна). Отменять можно CI-прогоны (`cancel-in-progress: true` на тестовый job при новом пуше той же ветки).
  Ловушка: queued-раны с `cancel-in-progress: false` всё же могут быть отменены GitHub'ом при переполнении очереди — известное поведение ([community #5435](https://github.com/orgs/community/discussions/5435)).
- **post-deploy верификация**: сейчас `ls | wc -l` + `curl http_code`. Дешёвое усиление: сверять отпечаток сборки (`version.json` уже существует — его же использует сторож T-35) с `git rev-parse --short HEAD` коммита, с которого деплоили; `curl` не только код, но и содержимое маркера. Репо уже имеет инфраструктуру отпечатков (T-35, `asset-versions.cjs`) — переиспользовать, не изобретать.
- **Деплой только при изменении deployable-ассетов**: `dorny/paths-filter` с фильтром на `studio/**`, `assets/**`, `index.html` → деплой-job `if: needs.changes.outputs.deployable == 'true'`. Docs-пуш в main не трогает стенд вообще. Это самое дешёвое и самое ценное из всей темы.

### 1.6 Cost/скорость

- `ubuntu-latest` (2 vCPU Linux) в приватном репо = $0.006/мин; включённые минуты по плану; в публичном — бесплатно ([billing docs](https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions)).
- С 1 марта 2026 — платформа-сбор $0.002/мин и на self-hosted runner'ы в приватных репо ([анонс GitHub](https://github.com/resources/insights/2026-pricing-changes-for-github-actions)).
- Self-hosted оправдан, когда:usage высокий, нужен постоянный кеш/окружение, тяжёлые шаги (браузерные сюиты). У нас runner `briix-ci` уже есть и стоит на стенде — для него деплой это локальный tar, ноль сетевой боли.
- Правило: self-hosted для тяжёлых шагов (полный playwright-регресс) имеет смысл только если его maintenance дешевле минут ubuntu. При нашем объёме (десятки прогонов/мес) включённых минут хватит почти всегда — экономический аргумент слаб, аргумент «кеш браузера живёт между прогонами» — сильный.

## 2. Таблица «практика → применимость → усилие → риск»

| Практика | Применимость к нашему репо | Усилие | Риск при внедрении |
|---|---|---|---|
| `paths-ignore` на workflow для `docs/**`, `audits/**`, `**.md` | высокая: ~30–50% пушей чисто docs | низкая (5 строк) | required-чек Pending — не наш случай (required нет); пропуск «умного» docs-изменения — низкий |
| `dorny/paths-filter` на job-уровень (tests-smoke / tests-full / deploy) | высокая; даёт независимые решения «тесты да/нет», «деплой да/нет» | средняя | первый PR/new branch: нужен явный `base: main`; action — внешняя зависимость (пин по SHA) |
| Кеш `~/.cache/ms-playwright` + lockfile | высокая, −2–4 мин/прогон | средняя (нужно закоммитить lockfile, это изменение процесса) | кеш-отравление маловероятно; плавающие версии playwright исчезнут — это скорее плюс |
| `setup-node cache: 'npm'` | высокая | низкая | требует lockfile (см. выше) |
| Smoke на PR / полный регресс на main+nightly | средняя: полный прогон и так ~10 мин; выигрыш скромнее, чем от кеша | средняя (разделение сюит по меткам/группам в tools/) | красный main при зелёном PR — нужен полный прогон на main перед деплоем; флейки в nightly диагностируются медленнее |
| `concurrency: deploy-stand, cancel-in-progress: false` | высокая, сегодня её нет | низкая | queued-раны могут отмениться (упомянуто выше) — редкость |
| `concurrency` на tests с `cancel-in-progress: true` по ветке | высокая: спасает от двойных прогонов при fast-push | низкая | отмена «правильного» прогона при ручном rebase — редкость |
| Post-deploy верификация отпечатка (version.json ↔ HEAD) | высокая: инфраструктура T-35 уже есть | низкая | нет — это чистое усиление |
| Деплой только на изменение `studio/**` + `assets/**` | высокая | низкая (вместе с paths-filter) | забыть добавить новый deployable-путь — деплой молча не случится; mitigation: верификация отпечатка на стенде |
| Self-hosted runner для полного регресса | умеренная: кеш живёт, минусы — обслуживание и очередь на одном runner'е | средняя–высокая | runner на стенде = точка отказа стенда; занятость runner'а деплоем во время регресса |

## 3. Три варианта целевого дизайна

### Вариант A — минимальный (~1 день, только ci.yml)

- `paths-ignore: ['docs/**', 'audits/**', '**.md']` на `on:` (push+pull_request).
- `concurrency` на tests (cancel-in-progress по ref) и на deploy-stand (false).
- Post-deploy: curl не только `http_code`, но и сверка `version.json` с `github.sha`.
- Кеш playwright без lockfile: пин версий в ключе кеша (`playwright-${{ runner.os }}-v1.49`) — вручную обновлять при апгрейде.

**Trade-offs**: минимум изменений, docs-пуш перестаёт триггерить и тесты, и деплой. Нет: job-level гибкости, честного lockfile, ночного регресса. Кеш придётся пинить руками — забытый пин = тихий апгрейд браузера (или, наоборот, застревание на старом).

### Вариант B — сбалансированный (~2–3 дня, рекомендован к обсуждению) 

Всё из A, плюс:
- Закоммиченный `package-lock.json`; `setup-node cache: 'npm'`; ключ кеша `hashFiles('**/package-lock.json')`.
- `dorny/paths-filter` job `changes` (пин по SHA): выходы `code` (studio/tools/assets) и `deployable` (studio/** + assets/** + index.html).
  - `tests`: полный набор, `if: changes.outputs.code == 'true'` (PR и main).
  - `deploy-stand`: `if: github.event == push main && needs.changes.outputs.deployable == 'true'`.
  - docs-only PR: workflow стартует, tests уходит skipped, деплой не происходит — required-чеков нет, значит skipped безопасен; при появлении required-чеков — добавить гейт-job.
- Лёгкий docs-прогон: markdown/link-check job на docs-only изменениях (быстрый, без playwright).

**Trade-offs**: все шесть тем закрыты без резки покрытия; чуть сложнее workflow; внешнее действие в критическом пути (пин по SHA снимает). Красный main невозможен по дизайну: полный регресс стоит перед деплоем на main.

### Вариант C — полный (~неделя, включая runner-работы)

Всё из B, плюс:
- Fast/live split: PR = smoke (node --check + статические проверки без playwright) + дешёвые playwright-сюиты; полный регресс (a11y, wait-phrases, cache-selfheal) — на main и/или `schedule:` nightly с отчётом в issue при красном.
- Полный регресс частично или целиком на self-hosted `briix-ci` (дисковый кеш браузера без actions/cache), деплой — отдельным job-ом с `concurrency` на группу.
- Шардирование сюит по job-ам (matrix) для параллельности.
- Флейк-политика: retry только для известных флейков, quarantine-список в файле.

**Trade-offs**: максимальная скорость PR-цикла и лучший баланс «стоимость/покрытие» на горизонте роста сюит; но самый сложный для поддержки workflow, зависимость от здоровья self-hosted runner'а, и риск «зелёный PR / красный main» смягчается только дисциплиной ночного регресса. Для текущего масштаба (15 сюит, ~10 мин полный прогон) выгода над B — эволюционная, не революционная.

## 4. Рекомендации (без финального выбора)

1. Независимо от варианта: **concurrency на деплой (`cancel-in-progress: false`) и верификация отпечатка после деплоя** — самые дешёвые и самые «охраняющие прод» меры. Сегодня двух пушей подряд в main достаточно, чтобы деплои перемешались.
2. **Docs-пуш не должен триггерить деплой** — самое ценное применение path-фильтров именно здесь, а не в экономии тестов.
3. **Lockfile** — предварительное условие честного кеширования (1.3). Коллегии стоит решить отдельно: коммитить lockfile или пинить версии (вариант A).
4. Path-фильтры держать на job-уровне (dorny/paths-filter) или заведомо без required-чеков; при введении branch protection — гейт-job (1.1).
5. Fast/live split (вариант C) отложить до тех пор, пока полный прогон на PR не начнёт мешать; сейчас кеш + пропуск docs-пушей дают большую часть выгоды без резки покрытия.
6. Self-hosted для регресса — только если включённых минут станет не хватать или сюиты вырастут; с марта 2026 self-hosted тоже платный ($0.002/мин), экономический аргумент слабеет.

## 5. Что не проверено / ограничения

- Точная длительность текущего `tests` job (по логам Actions) не замерялась — оценка «1.5–4 мин на установку chromium» взята из источников, не из нашего прогона.
- Наличие branch protection / required checks на репо не проверял (нет доступа к настройкам) — вывод «skipped безопасен» верен только если required-чеков действительно нет.
- `ubuntu-slim` и расписание тарифов после 1.03.2026 — по анонсу GitHub, фактические счета не верифицировались.
- Дизайн не прогонялся в CI (ресёрч, не имплементация) — YAML-наброски в отчёте иллюстративны, не проверены линтером Actions.

## Источники

- [GitHub Actions: Workflow syntax (paths/paths-ignore)](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions)
- [GitHub Actions: Control concurrency](https://docs.github.com/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs)
- [GitHub Actions: Skipping workflow runs ([skip ci])](https://docs.github.com/actions/managing-workflow-runs/skipping-workflow-runs)
- [GitHub billing: Actions](https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
- [GitHub: 2026 Actions pricing changes](https://github.com/resources/insights/2026-pricing-changes-for-github-actions)
- [Playwright: CI docs (кеш браузеров)](https://playwright.dev/docs/ci)
- [playwrightsolutions: caching browser binaries](https://playwrightsolutions.com/playwright-github-action-to-cache-the-browser-binaries)
- [currents.dev: cutting GH Actions minutes with Playwright](https://currents.dev/posts/github-actions-cost-how-to-cut-playwright-ci-minutes-without-losing-coverage)
- [community #44490: paths-filter vs required checks Pending](https://github.com/orgs/community/discussions/44490)
- [pantsbuild: skipping jobs without breaking branch protection](https://www.pantsbuild.org/blog/2022/10/10/skipping-github-actions-jobs-without-breaking-branch-protection)
- [starsling.dev: path-filter workflows best practices](https://starsling.dev/best-practices/github-actions/path-filter-workflows)
- [oneuptime: monorepo path filters](https://oneuptime.com/blog/post/2025-12-20-monorepo-path-filters-github-actions/view)
- [dorny/paths-filter](https://github.com/dorny/paths-filter)
- [runs-on.com: concurrency guide (never cancel deploys)](https://runs-on.com/github-actions/concurrency)
- [community #5435: pending runs cancellation](https://github.com/orgs/community/discussions/5435)
- [pie.inc: regression testing PR vs nightly](https://pie.inc/blog/regression-testing-in-ci-cd)
- [kodziak: smoke vs regression](https://www.kodziak.com/blog/smoke-testing-vs-regression-testing)
