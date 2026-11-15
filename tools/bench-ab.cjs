/* Генерация A/B для бенчмарка фазы 2 (issue #20, §7).
 *
 * Берёт bench/prompts-12.json (A = промт владельца, B = caption мозга v2) и
 * bench/lyrics-12.json (общая лирика — один и тот же текст для A и B), генерирует
 * ПОСЛЕДОВАТЕЛЬНО, wav-only, через media-bff (контракт: server-contract/README.md,
 * POST /jobs → GET /jobs/{id} → GET /files/{id}).
 *
 * Обезличивание: файлы кладутся в bench/out/ как track-NN-x.wav и track-NN-y.wav;
 * какая версия где — только в bench/KEY.md (владелец открывает его ПОСЛЕ
 * голосования). Порядок x/y случайный, но детерминированный (seed из env/даты),
 * одинаковые параметры модели у обеих версий.
 *
 * Без доступа к стенду скрипт НЕ притворяется, что сгенерировал: он печатает
 * план и выходит с кодом 0 (dry-run). Реальная генерация — только при заданных
 * MEDIA_BFF_URL и MEDIA_BFF_TOKEN.
 *
 * Запуск:
 *   node tools/bench-ab.cjs --dry-run
 *   MEDIA_BFF_URL=https://... MEDIA_BFF_TOKEN=... node tools/bench-ab.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'bench/out');
const KEY_FILE = path.join(ROOT, 'bench/KEY.md');
const BASE = process.env.MEDIA_BFF_URL || '';
const TOKEN = process.env.MEDIA_BFF_TOKEN || '';
const DRY = process.argv.includes('--dry-run') || !BASE || !TOKEN;
const MODEL = process.env.BENCH_MODEL || 'ace-step-pro';
const DURATION = Number(process.env.BENCH_DURATION || 150);
const SEED = process.env.BENCH_SEED || crypto.createHash('sha1').update(new Date().toISOString().slice(0, 10)).digest('hex').slice(0, 8);

const prompts = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench/prompts-12.json'), 'utf8'));
const lyrics = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench/lyrics-12.json'), 'utf8')).lyrics;
const lyricById = new Map(lyrics.map(l => [l.id, l]));

// Один seed на трек для ОБЕИХ версий: иначе A и B расходятся ещё и по шуму
// сэмплера, и слепое сравнение меряет удачу, а не caption. Одинаковый seed
// делает пару «x/y» парной — различие объясняется только промтом.
function pairSeed(trackId) {
  const h = crypto.createHash('sha1').update(SEED + ':seed:' + trackId).digest();
  return h.readUInt32BE(0) % 4294967295;
}

// Детерминированное «бросание монеты» на каждый трек: какая версия становится x.
function coin(trackId) {
  const h = crypto.createHash('sha1').update(SEED + ':' + trackId).digest();
  return h[0] % 2 === 0;
}

const plan = prompts.tracks.map(t => {
  const aFirst = coin(t.track);
  return {
    track: t.track,
    title: t.title,
    seed: pairSeed(t.track),
    lyrics: lyricById.get(t.track)?.lyrics || '',
    files: {
      x: { source: aFirst ? 'A' : 'B', prompt: aFirst ? t.promptA : t.promptB },
      y: { source: aFirst ? 'B' : 'A', prompt: aFirst ? t.promptB : t.promptA }
    }
  };
});

async function bff(method, url, body) {
  const res = await fetch(BASE.replace(/\/$/, '') + url, {
    method,
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`${method} ${url} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

async function generate(job, label) {
  const body = {
    type: 'music',
    prompt: job.files[label].prompt,
    params: {
      model: MODEL, lyrics: job.lyrics, language: 'en', duration: DURATION, format: 'wav',
      // Парный seed: тот же для x и y этого трека (server-contract: params.seed int).
      seed: job.seed
    }
  };
  const created = await (await bff('POST', '/jobs', body)).json();
  const id = created.id || created.job_id;
  if (!id) throw new Error('bff не вернул id задачи');
  process.stdout.write(`  ${label}: job ${id} …`);
  for (let i = 0; i < 240; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const st = await (await bff('GET', '/jobs/' + id)).json();
    if (st.status === 'error' || st.status === 'cancelled') throw new Error(`job ${id} ${st.status}: ${st.error || ''}`);
    if (st.status === 'done' || st.status === 'completed' || st.result) {
      const file = await bff('GET', '/files/' + (st.files?.wav || st.result?.wav || id));
      const buf = Buffer.from(await file.arrayBuffer());
      const dest = path.join(OUT_DIR, `track-${job.track}-${label}.wav`);
      fs.writeFileSync(dest, buf);
      console.log(` ${dest.replace(ROOT + '/', '')} (${(buf.length / 1048576).toFixed(1)} МБ)`);
      return dest;
    }
  }
  throw new Error(`job ${id}: таймаут ожидания`);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (DRY) {
    console.log('DRY-RUN: генерация не выполняется' + (BASE ? ' (нет MEDIA_BFF_TOKEN)' : ' (нет MEDIA_BFF_URL)'));
    console.log('План: ' + plan.length + ' треков × 2 версии, последовательно, wav, model=' + MODEL + ', duration=' + DURATION + ', парный seed на трек');
    for (const p of plan) console.log(`  track-${p.track}: x ← ${p.files.x.source}, y ← ${p.files.y.source}  seed=${p.seed}  (${p.title})`);
    console.log('\nКлюч НЕ пишется в dry-run: bench/KEY.md появится только вместе с файлами.');
    return;
  }
  console.log('Генерация A/B: ' + plan.length + ' треков, последовательно, wav-only');
  const key = [];
  for (const p of plan) {
    console.log(`track-${p.track} — ${p.title}`);
    // Строго последовательно: сначала x, потом y (никакой параллели — иначе
    // нагрузка на стенд разная и сравнение грязное).
    await generate(p, 'x');
    await generate(p, 'y');
    key.push(`| track-${p.track} | track-${p.track}-x.wav | ${p.files.x.source === 'A' ? 'владелец (A)' : 'мозг v2 (B)'} | track-${p.track}-y.wav | ${p.files.y.source === 'A' ? 'владелец (A)' : 'мозг v2 (B)'} |`);
  }
  fs.writeFileSync(KEY_FILE, [
    '# КЛЮЧ A/B — открывать ТОЛЬКО после голосования',
    '',
    '| Трек | файл x | x — это | файл y | y — это |',
    '|---|---|---|---|---|',
    ...key,
    '',
    `Генерация: model=${MODEL}, duration=${DURATION}s, wav, последовательно. Seed парный внутри трека (одинаковый у x и y), значения — в plan.`,
    'A = caption владельца (REFERENCE-ALBUM), B = caption music-brain v2 (buildCaption).',
    'VOCAL-блок у обеих версий одинаковый.'
  ].join('\n') + '\n');
  console.log('Готово. Ключ: bench/KEY.md (не открывать до голосования).');
})().catch(e => { console.error('FAIL: ' + (e?.message || e)); process.exit(1); });
