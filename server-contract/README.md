# Media-bff config snapshot — снапшот конфигурации живого контура (для аудита Арены)

**Дата:** 08.11.2026. **Основание:** просьба владельца — «собери весь конфиг с моделями в репо, пусть Арена глянет, что у нас не так». **Контекст:** issue #23, PR #29, follow-up #28. **Секреты убраны** (токен — `MEDIA_BFF_TOKEN=<REDACTED>`).

## Что в каталоге

| Файл | Что это (живой стенд A, `~/briix-media/media-bff/`) |
|---|---|
| `bff.py` | adapter/очередь: aiohttp :8390, bearer, POST /jobs, GET /jobs/{id}, cancel, GET /files/{id}, GET /health, GET /v1/models, POST /v1/chat/completions (JSON+SSE), ThreadBudget(8), retention 24ч |
| `cron-cleanup` | hourly-обёртка очистки results/ и jobs.json (артефакт: cron-строка удалена 08.11 — гонка с in-process retention bff) |
| `units-and-env.txt` | systemd --user юниты (media-bff, ollama-briix), имена env-переменных (значение токена вырезано), бинды, crontab-строки контура |
| `musicgen-cli.py` | CLI-обёртка MusicGen small (torch-cpu, `--threads` передаётся bff'ом из тяжёлого бюджета; 750 токенов ≈ 15 c) |
| `host-cpu.txt` | CPU/RAM стенда A + пиковые треды контура |
| `versions.txt` | версии ollama/python-venv/systemd/Linger/acestep.cpp |
| `health-sample.json` | живой ответ GET /health (08.11) |
| `jobs-schema-sample.json` | одна запись jobs.json (checksum sha256 отредактирован) |
| `bff-errors-tail.txt` | хвост журнала с типовыми ошибками (без токенов) |
| `manifest.txt` | копия `tools/media-pilot/manifest.txt` (sha256 весов фото) |
| `v1-models-snapshot.json` | живой ответ GET /v1/models (4 модели, ace-step-1.5 = unavailable) |
| `ru30.json` | параметры сбойного ACE-Step-прогона (см. «Что не так») |

## Сопутствующие версии (стенд A)

- runtime: stable-diffusion.cpp `master-1056-9234ad8` (AVX2-сборка), sd-cli; aiohttp 3.14.5 в `adapter-venv`; torch 2.15.0+cpu / transformers 5.22.2 в `musicgen-venv`
- ollama-briix: `~/ollama/bin/ollama serve`, `OLLAMA_HOST=127.0.0.1:11436`, `OLLAMA_MODELS=~/briix-media/ollama-models`, `NUM_PARALLEL=1`, `KEEP_ALIVE=5m`, модель `qwen3:4b-instruct`
- веса фото: FLUX.2-klein-4B Q8_0 + Qwen3-4B-Q6_K (text encoder) + VAE small-decoder (sha256 в `tools/media-pilot/manifest.txt`)
- веса ACE-Step: `acestep-v15-turbo-Q4_K_M` + `vae-BF16` + `acestep-5Hz-lm-0.6B-Q8_0` + `Qwen3-Embedding-0.6B-Q8_0` (~3.2 GB, acestep.cpp 07abf07)

## ⚠️ Что не так (главный вопрос к Арене)

**ACE-Step 1.5 не выдаёт вокал на русской лирике.** Замер технически ок (88 c @ 8 тредов, peak RSS 5.4 GB), но в WAV только инструментал: спектрограммы обоих прогонов (`ru30`, `ru300`) показывают гармоническую музыкальную дорожку БЕЗ голосовых формант, после ~20 c — затухание в тишину (аудио принимал владелец и координатор). Параметры прогона — в `ru30.json`: **turbo-квант Q4_K_M, inference_steps=8, guidance_scale=1.0, shift=3.0, LM 0.6B-Q8_0**.

Гипотезы для проверки (в порядке дешевизны):
1. **Минимальные параметры генерации**: 8 шагов / guidance 1.0 — вне рекомендованных настроек; у официальных примеров ACE-Step шаги 27+ и guidance выше. Ретрай: sft-веса вместо turbo, steps 27, guidance 4–5.
2. **turbo-квант и русский**: заявленная поддержка русского относится к полным весам v1.5; квант Q4_K_M turbo + LM 0.6B могут не тянуть русский вокал (тест en vs ru на одних параметрах).
3. **Формат лирики**: структура `[verse]/[chorus]` и разметка — сверить с ожиданиями acestep.cpp (возможен другой тег-формат/языковой токен).
4. **VAE BF16 vs квант синтезатора**: известны ли проблемы turbo-Q4 + BF16 VAE комбинации в acestep.cpp?

### Результат ретрая 08.11 (волна 2, follow-up #28)

**R0-диагностика старого прогона:** request0.json технически валиден — audio_codes непустые, vocal_language=ru не перезаписан. Значит, пайплайн работал, но LM **0.6B** генерировал слабые коды. Главная гипотеза ресёрча: **LM 0.6B слишком мал для осмысленного кодирования вокала на русском; confidence гипотезы 0.6**.

**R1-ретрай:** скачан `acestep-5Hz-lm-1.7B-Q8_0.gguf` (1.9 GB, HF Serveurperso/ACE-Step-1.5-GGUF); та же 30с русская лирика, тот же turbo-Q4_K_M синтезатор, steps 8 / guidance 1.0 / shift 3.0, wav16. LM 1.7B сгенерировал audio_codes, синтез 30с прошёл за ~2 мин (LM ~30с, DiT ~23с, VAE ~34с на CPU).

**R2-спектрограмма-гейт:** в новом WAV (`samples/ru30-lm17.wav`, спектрограмма `ru30-lm17-spectrogram.png`) есть формантная гармоническая структура в полосе 300–3400 Гц с вертикальной слоговой нарезкой и синхронной сменой секций [verse]→[chorus] на ~12.5с — то, чего не было в прогоне LM 0.6B (там — ровная инструментальная дорожка с затуханием в тишину). **По спектрограмме вокал-подобная структура подтверждается; финальный вердикт — по прослушиванию координатором (WAV передан, /tmp/acestep-v2.wav на маке).** К bff ничего не подключено, route по-прежнему закрыт (`ace-step-1.5: unavailable`), полный запрос — `ru30-lm17-request.json`.

Вопрос-приговор остаётся: если прослушивание не подтвердит голос — vocal на CPU закрывается окончательно (hosted API или отдельный GPU).

## Как поднять контур для повторения

Туннель: `tools/briix-media-live-up.sh` (autossh, ветка feat/media-live, PR #29); юниты стартуют при Linger (включён), оба юнита под systemd hardening (см. `units-and-env.txt`).

### Фиксы 08.11 (волна аудита/ревью), применены на стенде

- F1: POST /v1/chat/completions теперь идёт через ThreadBudget (503 при недоступном текст-бэкенде; бюджет держится на всё время SSE-стрима).
- F2: ThreadBudget.acquire атомарен при отмене посреди ожидания (частично взятые токены возвращаются).
- F3: cron-строка cron-cleanup удалена (гонка с in-process retention; prune проверен живьём: 4/5 тест-записей вычищено, running не тронут).
- F4: systemd hardening обоих юнитов (drop-ins, см. units-and-env.txt); смок после рестарта зелёный.
- F5: warmup ждёт освобождения бюджета, токены 64→128; честно: греет page-cache, не RAM.
- F6: musicgen-cli получил `--threads`; bff передаёт фактический тяжёлый бюджет.
- F7: save_jobs() после stage-апдейтов music-стадий.
Смок 08.11: health green; image 245с; music 87с; text JSON + SSE — через бюджет (лог held=4/8, превышений нет). Полная команда генерации фото — `tools/media-pilot/README.md`; музыка — `musicgen-cli.py`. Замеры: фото 261 c / 512px @ 8 тредов; music 60–80 c тёплая / 356 c холодная (bff греет модель при старте).

## Границы снапшота

Это конфигурационный снимок 08.11, не эталонный деплой; пароли/токены вне репо; серверные пути — домашние каталоги badai. Публикация только в приватном `briix.ru`.


## Решение владельца 08.11 (волна 2): vocal-route ОТКРЫТ — три режима

- **musicgen-small** — инструментал (как раньше).
- **ace-step-flash** — vocal 30с, LM 1.7B-Q8_0: POST /jobs type=music + `params.model="ace-step-flash"`, `params.lyrics` (теги [intro]/[verse]/[chorus]/[bridge]/[outro]), `params.language` ru|en, `params.duration` 5..30. Smoke 08.11: wall **111с**, stages `writing-lyrics → synthesizing`.
- **ace-step-pro** — vocal до 150с, LM 4B-Q8_0. Smoke: 60с трек за **240с**; полная композиция 150с (Room 7, No Knock, лирика из chats-audit владельца, автор DeepSeek-чат) — LM 215с + синтез 381с = **596с**, peak RSS 8.7 GB (fallback нет: RAM 94 GB). Тренд качества вокала по размеру LM: 0.6B — инструментал, 1.7B — вокал-структура 30с, 4B — держит структуру 60–150с.
- Provenance vocal-джобов: `capability: "song.vocal"` (не instrumental). Таймауты: flash 300с / pro 900с, процесс-группа убивается, OOM/padение acestep превращается в error-джоб (bff не роняется).

## Модерация контента (серверно, до очереди)

Двухступенчатый gate на POST /jobs (все типы, prompt+lyrics) и POST /v1/chat/completions:
1. **Regex-блэклист** явного (порно/половые акты, minors+sexual — комбинация двух словарей, преступные инструкции) → мгновенный **422 content_blocked** без LLM.
2. **Серая зона** → qwen3-классификатор (:11436, num_thread 2, timeout 15с, temperature 0) одним словом safe|suggestive|explicit; explicit → 422; suggestive/safe → проход. **Fail-open** при недоступности ollama (проверено живьём: 2 таймаута → allowed + лог).
- Кэш вердиктов 30 мин по sha256; лог `{ts} {source} {prompt-hash} {verdict} {endpoint}` в `moderation.log` (сам промпт не пишется).
- **Политика**: explicit = порнография/половые акты/сексуализация несовершеннолетних — жёстко; suggestive = художественная нагота, «полуголые», эротика без актов — РАЗРЕШЕНО (проверено: «полуголая женщина в стиле нуар» → 202).
- Тесты 08.11: явный RU → 422 за 3мс; школьница+обнажённая → 422; «как сделать бомбу» → 422; нуар-нагота → 202; пустой prompt → 400; chat explicit → 422.

## Брендинг-пакет music-джобов

После успешной генерации (любой режим): обложка 512px (sd-cli, prompt=caption+«album cover art, square, atmospheric, no text», stage `album-cover`) → ffmpeg mux WAV → **MP3 192k** с обложкой attached_pic и ID3v2: title (params.title или первая строка лирики), artist **BRIIX**, album **BRIIX Generative Music**, comment «Generated on briix.ru — локальные AI-модели», url https://briix.ru. result_url отдаёт MP3 (audio/mpeg), WAV внутренний. E2E smoke 08.11: musicgen 60с + обложка 240с + mux = 313с, ffprobe: `codec_name=png, DISPOSITION:attached_pic=1`, все теги на месте. UI-заметка для Арены: скачивание/плеер получают MP3 со встроенным cover — jsmediatags не нужен, просто fallback-обложка.

## Showcase — реальные генерации стенда A

`assets/media/showcase/` — MP3 192k с обложками и брендинг-тегами, manifest.json (title/prompt/model/date/duration/license demo-only). Источники: реальные прогоны стенда (ACE-Step ru-баллада 30с/60с, Room 7 No Knock, musicgen lofi/ambient/jingle). Room 7: лирика — chats-audit репо владельца (автор DeepSeek-чат владельца).

## Формат раздачи → M4A со встроенными текстами (08.11, волна 3)

- music_package: WAV → **M4A (AAC 192k)** с обложкой (attached_pic) и **тегом lyrics (©lyr)** — полный текст песни из `params.lyrics` (vocal-джобы; у musicgen-инструменталов текста нет). result_url отдаёт `.m4a` (audio/mp4); fallback в get_file: .mp3 → .wav (legacy).
- Проверено ffprobe на живом джобе: `codec_name=aac`, `png + attached_pic=1`, `TAG:lyrics=<полный текст>`; size 1.3 MB при 30с-треке.
- Нюанс mp4-муксера: тег `url` не пишется, а с `-movflags use_metadata_tags` url пишется, но теряется attached_pic — поэтому адрес вшит в comment. Обложка важнее.
- **UI-заметка для Арены (два варианта показа текста)**: (а) читать ©lyr прямо из m4a (jsmediatags умеет MP4 ilst); (б) брать текст из `assets/media/showcase/manifest.json` / GET /jobs/{id} provenance.params.lyrics.
- Showcase пересобран в m4a: room7/ballad30/ballad60 — со встроенными текстами, lofi/ambient/jingle — инструменталы без текста.

---

> **ПРИМЕЧАНИЕ (issue briix.ru#107, 14.11.2026):** это снимок контракта media-bff. Живой сервис — на стенде A (`briix-demo-server.py` + `media-bff-config/bff.py` в репо briix.ru); **источник истины не здесь**, этот каталог — справочник для CI/аудита. Проверяйте актуальность по стенду A.

## Контрактное ожидание (студия-агент B, 15.11.2026): params.title / params.artist

Клиент студии теперь передаёт в `POST /jobs` для `type: "music"`:

- `params.title` — название песни (из черновика наставника или первой осмысленной
  строки лирики, fallback `BRIIX track <дата>`, лимит 160);
- `params.artist` — ник пользователя (клиентский профиль, gate).

**Ожидание от сервера (INFRA-задача выполняется параллельно этим PR):** bff должен
писать `params.title` / `params.artist` в теги аудиофайла (M4A) и отдавать
`Content-Disposition: attachment; filename="Title - Artist.m4a"`. До внедрения
инфра-задачи поля безопасно игнорируются — клиент не зависит от них.

## Контрактное ожидание (fix restore + волна, 14.11.2026): /files/{id}-peaks.json

Решение владельца (23:18): волна карточки трека строится из **серверных пиков**, клиентский
декод аудио убран полностью (и бюджет 60с/8МиБ, и его расширение 10мин/40МиБ не понадобились).

- Клиент запрашивает `GET /files/{id}-peaks.json` (bearer как у /files) при построении карточки трека.
- Ожидаемый ответ: JSON-массив чисел 0..1 — нормированные пики (сервер считает из WAV мгновенно),
  рекомендованная длина ~160–400 значений.
- **INFRA-задача выполняется параллельно этим PR.** До внедрения клиент молча живёт на нативном
  плеере (404/ошибка → console.warn, без сообщений в UI) — зависимости от сервера нет.

## Реализация на сервере (mux-кластер, INFRA #105/#107/#108 + seed, 15.11.2026)

Внедрено на стенде A (media-bff), PR briix.ru `fix/mux-cluster`:

- **Битрейт-матрица mux** (решение владельца 15.11): vocal flash → 192k; vocal pro → 320k;
  instrumental (musicgen, любой model) → 320k. Формула: `320k если (instrumental или
  model==ace-step-pro) иначе 192k`. Примечание: нативный ffmpeg AAC-энкодер на mono/32kHz
  (musicgen) физически не набирает 320k — фактический потолок ~130k (замер 15.11);
  vocal 48kHz отдают 195–322k по матрице.
- **Mux-on-download**: M4A собирается из живого WAV в момент скачивания
  (`GET /files/{id}.m4a` или прежний `GET /files/{id}`), кэш в рамках retention WAV (24 ч),
  повторный GET из кэша <100ms. Теги: title = `params.title` (fallback первая строка лирики),
  artist = `params.artist` (fallback «BRIIX»), ©lyr = `params.lyrics`, обложка attached_pic.
- **Content-Disposition**: `attachment; filename="ascii-fallback.m4a"; filename*=UTF-8''{pct}
  {Sanitized Title} - {Artist}.m4a` (sanitize: буквы/цифры/пробел/дефис, unicode сохраняется).
  Параметр `?refetch=1` принудительно пересобирает M4A из WAV.
- **peaks.json**: `GET /files/{id}-peaks.json` — ленивая генерация при первом запросе, один
  проход ffmpeg по WAV → `{id, duration: float, peaks: [0..1...]}` (160–400 значений),
  кэш рядом с WAV; WAV удалён (retention) → 404, клиент деградирует тихо. **Внимание:** сервер
  отдаёт объект `{id, duration, peaks}`, а не голый массив, как в ожидании выше — клиенту
  брать поле `peaks`.
- **SEED-воспроизводимость** (дополнение владельца 15.11): `POST /jobs` принимает
  `params.seed` (int 0..2^32-1, опционально) и `params.parent_job_id` (строка ≤64, опционально,
  связка вариаций). Seed попадает в ace-lm request; после генерации provenance джобы получает
  снапшот `{seed, lm_temperature, lm_cfg_scale, lm_top_p, inference_steps, parent_job_id?}` —
  виден в `GET /jobs/{id}` и списке. Без seed — urandom как раньше.


## Снимок 20.11.2026 (координатор)

- `bff.py` — дословная копия живого `/home/badai/briix-media/media-bff/bff.py` стенда A
  на момент 20.11.2026 (1913 строк; включает mux-матрицу 15.11, peaks, GLM-primary/qwen-фолбэк).
  Секретов в файле нет: ключи читаются из env/.env стенда. Проверено diff-ом при копировании.
- Для внешних агентов: этот снимок — основание для чтения/аудита бекенда. Локальный запуск
  НЕ требуется: клиентские тест-сюиты (`tools/check-*.cjs`) работают с мок-bff
  (`tools/check-studio.cjs`, порт 8300-диапазон, токен test-token).
- Инфра-поставка #37 (конвейер экспорта WAV→MP3/M4A+теги) меняет живой bff: после её
  приёмки сюда кладётся НОВЫЙ снимок, старый сохраняется как bff.py.bak-<дата>.

## Поставка #37 — экспорт-конвейер WAV→MP3 320 + M4A с тегами (20.11.2026, исполнитель-саб)

Новый снимок `bff.py` (+ новый модуль `export_pipeline.py`, живёт рядом с bff на стенде)
после деплоя на стенд A. Бэкап до деплоя: `bff.py.bak-20261120-export37` на стенде
(инструкция отката: `server-contract/rollback-37.md`).

- **WAV-мастер**: живёт 48ч (WAV_RETENTION_SECONDS), переживает 24ч-retention производных;
  отдельный URL `GET /files/{id}.wav` (audio/wav, attachment). Производные (m4a/mp3/cover/peaks)
  живут 24ч и пересобираются mux-on-download из живого мастера; job-запись живёт, пока жив мастер.
  WAV без тегов — по критерию; в `GET /jobs/{id}` поле `formats.wav.note = "мастер без тегов"`.
- **MP3 320k**: `GET /files/{id}.mp3`, mux-on-download (Semaphore(1), ретрай mux при падении).
  ID3v2.4 (проверено mutagen на живом джобе): TIT2/TPE1/TALB/TCON, COMM брендинг, **USLT** (лирика),
  **TXXX `briix_prompt`** (промт), **APIC** (обложка, front cover). Теги ставит mutagen 1.48.1
  (поставлен в adapter-venv; ffmpeg пишет лирику как TXXX=USLT, не настоящий USLT — проверено
  эмпирически 20.11, поэтому mutagen обязателен). Без mutagen — честный фолбэк ffmpeg-тегов
  (лирика деградирует в TXXX), статус в `GET /health → export`.
- **M4A**: прежний mux-on-download + mutagen-пасс: **©lyr**, **©gen** («Generative Music»),
  **freeform `----:com.briix:prompt`** (промт), covr (attached_pic ffmpeg + страховочная досадка).
- **Обложка**: `GET /files/{id}-cover.png` (как было); ретрай генерации 1 раз (stage
  `album-cover-retry`); честный статус в `GET /jobs/{id}` → `cover: {status: ok|unavailable, url, detail}`
  (detail при невозможности, не молчание). В `_job_public` (GET /jobs) добавлены cover_url/cover_status.
- **GET /jobs/{id}**: новые поля `formats: {wav, mp3, m4a: {url, available}}` и `cover`;
  `ttl_seconds` для music считается от 48ч мастера.
- **retention**: производные файлы 24ч, `*.wav` 48ч; `expired` ставится только при удалении
  мастера; `prune_records(cutoff, master_cutoff)` — music-записи живут с мастером.
- **/health**: новое поле `export: {mutagen, mp3_uslt, m4a_freeform_prompt}` — честный статус
  возможностей конвейера.
- Существующие пути не сломаны: result_url (m4a) как был, /files/{id} fallback-цепочка
  расширена до `.m4a → .mp3 → .wav`; peaks/moderation/chat/image без изменений.

Проверено на живом стенде 20.11 (sub-test, duration 30): vocal flash 30с — все три формата
200 OK, MP3 stream 320000 bps, ID3v2.4 все кадры, M4A atoms ©lyr/©gen/covr/freeform,
WAV 31.04с без тегов, peaks/moderation/ chat/image/instrumental — регресс зелёный
(полный список — письмо «📦 ПОСТАВКА #37» в issue).
