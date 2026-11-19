# Откат поставки #37 (экспорт-конвейер) на стенде A — 20.11.2026

Деплой затронул: `~/briix-media/media-bff/bff.py` (перезаписан) и новый файл
`~/briix-media/media-bff/export_pipeline.py`. Бэкап ДО деплоя:
`~/briix-media/media-bff/bff.py.bak-20261120-export37`.

## Откат (полный)

```bash
ssh fonotext-stand
cd ~/briix-media/media-bff
cp bff.py bff.py.export37-retired.bak            # сохранить «на всякий»
cp bff.py.bak-20261120-export37 bff.py
rm -f export_pipeline.py __pycache__/bff.cpython*.pyc __pycache__/export_pipeline.cpython*.pyc
systemctl --user restart media-bff
sleep 3 && systemctl --user is-active media-bff
curl -s -H "Authorization: Bearer $MEDIA_BFF_TOKEN" https://demo.briix.ru/api/health
```

Ожидание после отката: `health.ok = true`, поля `export` в health НЕТ (это признак новой версии).

## Частичный откат (оставить конвейер, убрать только mutagen)

mutagen-пассы отключаются сами: `pip uninstall mutagen` из `~/briix-media/adapter-venv` →
bff продолжает отдавать MP3/M4A с ffmpeg-тегами (лирика TXXX вместо USLT), `/health → export`
честно покажет `mp3_uslt: false`. Код трогать не нужно.

## Данные

Бэкап и новая версия работают на одной структуре results/ (файлы `*.wav`, `*.m4a`, `*.mp3`,
`*-cover.png`, `*-peaks.json` — все уже существовали до #37, кроме `*.mp3`). Откат не требует
чистки results; новые `*.mp3`-кэши безвредны для старой версии (fallback-цепочка их читает).
jobs.json: новая версия пишет необязательные поля `cover` в записи — старая версия их игнорирует.

## Ретеншн после отката

Старая версия удаляет все файлы по 24ч — WAV-мастера старше 24ч будут потеряны при первом
проходе retention (в течение часа после отката). Если нужно сохранить мастера — скопировать
`results/*.wav` до отката.
