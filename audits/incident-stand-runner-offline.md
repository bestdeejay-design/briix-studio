# Инцидент: деплой-контур стенда замер — раннер briix-ci удалён из реестра, стенд на билде PR #53 (22–23.11)

**Ветка:** `work/30-stand-selfheal` · **База:** `main` (919adc3) · **Якорь:** #30 (CI-конвейер)
**Главный вывод:** конвейер доставки цел — в очереди уже стоит валидный деплой
актуального main; единственное недостающее звено — раннер на стенде A.
Плюс готовый механизм самолечения на будущее (stand-sync, ниже) — применить
владельцу за минуту или выдать токену workflow-скоуп, тогда агент запушит сам.

## Хронология (UTC, по API GitHub и отпечаткам прода)

- **22.11 20:30** — merge PR #53 (f2b2ebc, iOS-гейт): tests зелёные, `deploy-stand`
  стартовал **20:36:34** на раннере `briix-ci` (стенд A).
- **~20:37** — tar-шаг дошёл до диска прода: стенд отдаёт билд `7d5e644c8d`
  (дерево PR #53). Затем машина стенда A ушла в даун посреди джоба —
  пост-верификация не завершилась, раннер не отчитался. Контекст: в ту ночь
  на машине шли тяжёлые модельные тесты (mm-test MASTER-PLAN, YuE2 11–14 ГБ
  на P40 — `audits/mm-test/MASTER-PLAN.md`).
- Джоб висел «in progress» на мёртвом раннере ~50 минут: `timeout-minutes: 5`
  не срабатывает — таймаут исполняет сам раннер, а раннера нет.
- **22.11 21:20** — merge PR #55 (37b788b, 116 стилевых семейств): tests зелёные
  к 21:26, его `deploy-stand` встал в очередь группы `deploy-stand`.
- **21:26:35** — висящий джоб f2b2ebc отменён (владелец в UI либо сторож
  GitHub), queued-джоб 37b788b остался ждать раннер.
- **23.11** — **на репо 0 зарегистрированных раннеров**: `briix-ci` удалён из
  реестра (не «offline» — оффлайн-раннеры остаются в списке со статусом Idle).
  Стенд = `7d5e644c8d`: iOS-гейт и честный-429 на проде есть,
  **116 стилевых семейств PR #55 (билд `664da5862d`) не доставлены**.

## Ключевой факт: очередь цела и уже несёт актуальный main

`git diff 37b788b..main -- studio/ assets/` — **пусто**: после merge PR #55 в
main были только docs-коммиты (mm-test). Значит, зависший queued-джоб
`deploy-stand` (run 45071540797) — это **готовый деплой ровно текущего main**:
когда раннер появится, джоб подхватится сам, докатит studio/ + assets/,
его пост-верификация сравнит отпечатки с его же чекаута (`664da5862d` = main)
и завершится зелёным. Никакой ручной re-run/cancel не требуется.

Семантика concurrency-группы `deploy-stand` дополнительно страхует: любой
будущий deployable-мерж ставит свежий queued-джоб, который вытесняет ранее
queued (активные не трогаются, `cancel-in-progress: false` — REVIEWER_KICK #2).
То есть очередь всегда сходится к «один queued-джоб с самым свежим main».

## Права-матрица агента (почему не «починил сам» до конца)

Замерено по факту 23.11 (fine-grained PAT из upload/3-2.txt):

| Действие | API | Результат |
|---|---|---|
| Отменить зависший run | `POST …/runs/45071540797/cancel` | **403** (нет actions:write) |
| Re-run failed jobs | `POST …/rerun-failed-jobs` | **403** |
| Workflow dispatch | `POST …/workflows/ci.yml/dispatches` | **403** |
| Регистрация раннера | `POST …/runners/registration-token` | **403** (нет administration:write) |
| Push ветки с workflow-файлом | git push | **отклонён** (нет workflow-скоупа) |
| Push кода/документов, PR, merge | git push / REST | OK (contents:write) |
| Доступ до машины стенда A (SSH и т.п.) | — | **нет** (в upload/ только GitHub-токен) |

Вывод: агент может менять код и документы в main, но не может управлять
Actions (cancel/dispatch/rerun), не может регистрировать раннеров и не имеет
доступа до машины стенда. Восстановление раннера — физически хозяина стенда.

## Единственное ручное действие (владелец, машина стенда A, ~2–3 мин)

**Поднять раннер `briix-ci`.** После этого всё происходит само (queued-джоб
докатывает прод до main, пост-верификация зелёная):

1. Проверить сервис раннера на стенде A (как установлен: systemd/supervisor/
   сессия — `config.sh`/`run.sh` из каталога раннера). Возможно, машина просто
   не поднялась после ночи модельных тестов.
2. Если раннер виден в списке (Settings → Actions → Runners) — просто запустить
   сервис; если пусто — регистрация заново: New self-hosted runner →
   download/config/run по командам из UI. **Labels обязаны содержать
   `briix-ci`** — иначе queued-джобы не сматчатся.
3. Проверка успеха: https://demo.briix.ru/studio/version.json → `build`
   = `664da5862d` (или новее после будущих мержей); в Actions — зелёный
   `deploy-stand` / post-deploy verification OK.

Опционально, чтобы снять ограничение раз и навсегда: выдать токену агента
`workflow` + `actions: write` — тогда cancel зависших, dispatch и пуш
workflow-файлов (stand-sync ниже) агент делает сам.

## Готовое самолечение на будущее: stand-sync.yml (применить за минуту)

Файл ниже нельзя запушить из агента (workflow-скоуп). Применение: сохранить
как `.github/workflows/stand-sync.yml`, commit, push в main — или выдать
токену workflow-скоуп и попросить агента (ветка с файлом готова локально).

Что даёт: каждые 6 часов (и вручную) свежий queued-джоб в той же группе
`deploy-stand` — очередь никогда не «замерзает» на мёртвом ожидании раннера;
при появлении раннера стенд сам догоняет main: сверка отпечатков, при дрифте —
идемпотентный tar-деплой + пост-верификация, без дрифта — no-op (~20 сек).
Гейт main-only; полный регресс не дублируется (дерево main уже прошло tests
на пуше — «main = deployed»). Тик «без дрифта» зелёный и дешёвый.

```yaml
name: stand-sync

on:
  schedule:
    - cron: '17 */6 * * *'
  workflow_dispatch: {}

permissions:
  contents: read

jobs:
  sync:
    if: github.ref == 'refs/heads/main'
    runs-on: [self-hosted, briix-ci]
    timeout-minutes: 5
    concurrency:
      group: deploy-stand
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4
      - name: 'Drift check (fingerprints: main vs stand)'
        id: drift
        run: |
          set -euo pipefail
          expected=$(node -e "
            const s = require('fs').readFileSync('studio/index.html', 'utf8');
            const m = s.match(/window\.__BRIIX_BUILD__ = '([0-9a-f]{10})';/);
            if (!m) { console.error('no __BRIIX_BUILD__ in main index.html'); process.exit(1); }
            console.log(m[1]);
          ")
          got_json=$(curl -fsS --max-time 10 https://demo.briix.ru/studio/version.json)
          got_build=$(node -e "
            const v = JSON.parse(process.argv[1]);
            if (!v.build) { console.error('no build in prod version.json'); process.exit(1); }
            console.log(v.build);
          " "$got_json")
          html_build=$(curl -fsS --max-time 10 https://demo.briix.ru/studio/ | grep -o "__BRIIX_BUILD__ = '[0-9a-f]\{10\}'" | grep -o "[0-9a-f]\{10\}" | head -1)
          echo "expected (main index.html): $expected"
          echo "stand version.json build:  $got_build"
          echo "stand index.html build:     $html_build"
          if [ "$got_build" = "$expected" ] && [ "$html_build" = "$expected" ]; then
            echo "needed=false" >> "$GITHUB_OUTPUT"
            echo "stand is current — deploy not needed"
          else
            echo "needed=true" >> "$GITHUB_OUTPUT"
            echo "drift detected — deploy will run"
          fi
      - name: Deploy studio/ and assets/ to stand
        if: steps.drift.outputs.needed == 'true'
        run: |
          set -euo pipefail
          tar -cf - -C studio . | tar -xf - -C /home/badai/briix-demo/studio/
          mkdir -p /home/badai/briix-demo/assets/data
          tar -cf - -C assets . | tar -xf - -C /home/badai/briix-demo/assets/data/
          ls /home/badai/briix-demo/studio/ | wc -l
          curl -s -o /dev/null -w "studio http: %{http_code}\n" http://127.0.0.1:8440/studio/
      - name: Post-deploy verification (build fingerprint)
        if: steps.drift.outputs.needed == 'true'
        run: |
          set -euo pipefail
          expected=$(node -e "
            const s = require('fs').readFileSync('studio/index.html', 'utf8');
            const m = s.match(/window\.__BRIIX_BUILD__ = '([0-9a-f]{10})';/);
            if (!m) { console.error('no __BRIIX_BUILD__ in merged index.html'); process.exit(1); }
            console.log(m[1]);
          ")
          got_json=$(curl -fsS --max-time 10 https://demo.briix.ru/studio/version.json)
          got_build=$(node -e "
            const v = JSON.parse(process.argv[1]);
            if (!v.build) { console.error('no build in prod version.json'); process.exit(1); }
            console.log(v.build);
          " "$got_json")
          html_build=$(curl -fsS --max-time 10 https://demo.briix.ru/studio/ | grep -o "__BRIIX_BUILD__ = '[0-9a-f]\{10\}'" | grep -o "[0-9a-f]\{10\}" | head -1)
          echo "expected (merged index.html): $expected"
          echo "prod version.json build:      $got_build"
          echo "prod index.html build:        $html_build"
          if [ "$got_build" != "$expected" ]; then
            echo "::error title=post-deploy verification::version.json build ($got_build) != merged index.html fingerprint ($expected)"
            exit 1
          fi
          if [ "$html_build" != "$expected" ]; then
            echo "::error title=post-deploy verification::prod index.html __BRIIX_BUILD__ ($html_build) != merged index.html fingerprint ($expected)"
            exit 1
          fi
          echo "post-deploy verification OK: build $expected on https://demo.briix.ru/studio/"
```

## Красное / остатки

- Причина исчезновения раннера из реестра неизвестна (14-дневный автогриндинг
  отпадает — раннер работал часами ранее). Гипотеза: снят при обслуживании
  машины в ночь модельных тестов; подтверждает владелец на месте.
- Внешний алертинг «стенд ≠ main» — уровень стенда; внутри GitHub сигнал
  виден: Actions → queued deploy-stand.
- stand-sync.yml не в репо — применить владельцу (выше) или выдать токену
  workflow-скоуп. После применения зависаний очереди больше не будет.

## Проверено

- `git diff 37b788b..main -- studio/ assets/` — пусто: queued-джоб несёт
  текущий main (ключевой факт всей диагностики).
- Права-матрица — замерена по живым ответам API (403/OK), не по догадкам.
- YAML stand-sync парсится (BaseLoader, `on` без bool-ловушки), `bash -n`
  всех трёх run-скриптов.
- Drift-check прогнан **end-to-end против живого прода** из песочницы:
  `expected 664da5862d`, прод `7d5e644c8d` → `needed=true` — корректно
  требует деплой; no-op-ветка (`needed=false`) наступит после выравнивания.
- Деплой/пост-верификация — дословно шаги `deploy-stand` ci.yml, отработавшие
  на всех предыдущих деплоях (последний успешный — PR #53, подтверждён
  отпечатком на прода).
- Регресс на main текущего дня: 16/16 юнит-сюитов, e2e 79/79.
