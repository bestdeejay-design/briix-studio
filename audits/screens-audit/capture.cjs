#!/usr/bin/env node
/* Скриншот-прогон аудита BRIIX Студии: 10 состояний × 4 вьюпорта.
 *
 * Зачем этот файл: аудит (audits/audit-full-arena-2026-11.md) выполнялся в песочнице без браузера,
 * поэтому снимков в этом каталоге нет — есть готовый прогон. Одна команда на машине с Chromium
 * даёт все кадры, сетевой журнал и геометрические замеры, на которые ссылается отчёт.
 *
 *   npm i -D playwright && npx playwright install chromium
 *   node audits/screens-audit/capture.cjs                 # всё (44 кадра)
 *   node audits/screens-audit/capture.cjs --state 09      # только «Библиотека»
 *   node audits/screens-audit/capture.cjs --vp mobile-390x844
 *   node audits/screens-audit/capture.cjs --server-only   # только поднять стенд (для curl/отладки)
 *
 * Что поднимается: один HTTP-сервер на 127.0.0.1:8080, который отдаёт
 *   /studio/*  — файлы репозитория как есть (ничего не правится),
 *   /assets/*  — creative-base.json и пр.,
 *   /api/*     — фейковый media-bff по контракту server-contract/ (bff.py + README).
 *
 * ВАЖНО (это часть аудита, а не ошибка скрипта): пики отдаются ОБЪЕКТОМ
 *   {"id": "...", "duration": 214.0, "peaks": [...]}   — как в server-contract/README.md.
 * Клиент принимает только голый массив (studio.js:566-573, `Array.isArray(peaks)`), поэтому на снимках
 * состояния 07/09 волны не будет — кадр документирует находку P1-01/T-01 в реальном браузере.
 * Чтобы снять «как должно быть», запустите с `--peaks=array`.
 *
 * Аудио отдаётся настоящим WAV (2 с тишины), чтобы плеер и живая волна WebAudio работали в Chromium.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = __dirname;
const PORT = Number(process.env.PORT || 8080);
// По умолчанию слушаем только loopback; HOST=0.0.0.0 (или --public) — чтобы показать стенд в live-preview Арены.
const HOST = process.env.HOST || (process.argv.includes('--public') ? '0.0.0.0' : '127.0.0.1');
const BASE_HOST = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
// В preview-режиме (HOST=0.0.0.0) сами добавляем ?key=... к /studio/index.html, чтобы студия открывалась
// без ручного ввода ключа. Заодно это наглядно показывает находку T-42: ключ остаётся в адресной строке.
const AUTO_KEY = process.env.AUTO_KEY !== '0' && HOST === '0.0.0.0';
const TOKEN = 'audit-capture-token';           // тестовый ключ, не секрет стенда
const STAGE_MS = Number(process.env.STAGE_MS || 20000);
const ARGV = process.argv.slice(2);
const arg = (name, dflt) => { const i = ARGV.indexOf('--' + name); return i >= 0 ? (ARGV[i + 1] || dflt) : dflt; };
const PEAKS_SHAPE = process.env.PEAKS || arg('peaks', 'object');   // 'object' (контракт) | 'array' (как в tools/check-studio.cjs)
const ONLY_STATE = arg('state', null);
const ONLY_VP = arg('vp', null);

/* ------------------------------------------------------------------ утилиты */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

/* CRC32 + минимальный энкодер PNG (обложки рисуем градиентом, без внешних зависимостей). */
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function makePng(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;                                    // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x / (w - 1), y / (h - 1));
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;  // 8-bit truecolor
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function coverPng(seed) {
  const hue = (seed * 47) % 360;
  const rgb = (h, s, l) => {                                     // hsl -> rgb (0..255)
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  };
  return makePng(120, 120, (u, v) => rgb((hue + u * 60) % 360, 0.55, 0.18 + v * 0.42));
}
/* Настоящий WAV: 2 с тишины, 8 кГц моно 16 бит — Chromium его декодирует (нужно для живой волны). */
function silenceWav(seconds = 2, rate = 8000) {
  const frames = seconds * rate, data = Buffer.alloc(frames * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const WAV = silenceWav();
const PNG_CACHE = new Map();

/* ------------------------------------------------------------------ фейковый bff */

const LYRICS_RU = '[Intro]\n\n[Verse 1]\nГород дышит неоном, стекло и бензин,\nЯ иду по проспекту, где каждый второй — чужой.\n\n[Pre-Chorus]\nСердце держит ритм, фонари считают такт.\n\n[Chorus]\nНочной город, пой со мной,\nПсиходелик-соул и дым над водой.\n\n[Bridge]\nТише, слышишь: бас ведёт домой.\n\n[Outro]\nГаснет свет, остаётся мотив.';
const IDEA_RU = 'психоделик соул про ночной город, женский вокал, на русском';
const PROMPT_EN = 'psychedelic soul, night city neon, female vocals, warm analog tape, slow groove';

function chatReply(messages) {
  const sys = String((messages && messages[0] && messages[0].content) || '');
  if (/briix-draft/.test(sys)) return 'Собрал черновик: настроение, темп и структура на месте. Проверьте название и пару строк — и можно в генерацию.\n\n[briix-draft]\n' +
    JSON.stringify({ title: 'Неон и вода', prompt: PROMPT_EN, lyrics: LYRICS_RU }) + '\n[/briix-draft]';
  if (/автор песен/i.test(sys)) return LYRICS_RU;
  if (/Translate the user's music idea/i.test(sys)) return PROMPT_EN;
  if (/музыкальный продюсер BRIIX/i.test(sys)) return JSON.stringify({ title: 'Неон и вода', prompt: PROMPT_EN, lyrics: LYRICS_RU });
  if (/редактор музыкальной студии BRIIX/i.test(sys)) return 'Ночной город, неон и тёплая плёнка; женский вокал ведёт мотив, бас держит медленный грув.';
  return 'Короткий ответ наставника по делу: идея понятна, предлагаю оставить психоделик-соул и добавить тёплую плёнку.';
}

const STAGES = {
  musicVocal: ['writing-lyrics', 'synthesizing', 'album-cover'],
  musicInstrumental: ['model-warmup', 'generating', 'album-cover'],   // реальный словарь bff.py:1287
  image: ['generating'],
};

const state = { jobs: new Map(), seq: 0, libCount: 0, failNext: null, log: [] };
const now = () => Date.now() / 1000;

function newJob(body) {
  const id = 'job-capture-' + (++state.seq);
  const type = body.type === 'image' ? 'image' : 'music';
  const instrumental = !!(body.params && body.params.instrumental);
  const stages = type === 'image' ? STAGES.image : (instrumental ? STAGES.musicInstrumental : STAGES.musicVocal);
  const job = {
    id, type, status: 'running', stage: stages[0], stages, stageAt: Date.now(), created_at: now(),
    prompt: String(body.prompt || '').slice(0, 4000), params: body.params || {},
    favorite: false, deleted: false,
    provenance: { model: (body.params && body.params.model) || 'ace-step-flash', capability: type, seed: 1234567, queued_ms: 412, wall_clock_ms: null },
  };
  state.jobs.set(id, job);
  return job;
}
function advance(job) {
  if (job.status !== 'running') return job;
  const i = job.stages.indexOf(job.stage);
  if (Date.now() - job.stageAt >= STAGE_MS) {
    if (i + 1 < job.stages.length) { job.stage = job.stages[i + 1]; job.stageAt = Date.now(); }
    else settle(job);
  }
  return job;
}
function settle(job) {
  job.status = 'ready'; job.stage = 'done';
  job.result_url = '/files/' + job.id + '.wav';
  if (job.type === 'music') job.cover_url = '/files/' + job.id + '-cover.png';
  job.mime = job.type === 'music' ? 'audio/mp4' : 'image/png';
  job.size = job.type === 'music' ? WAV.length : 8192;
  job.ttl_seconds = 86400; job.file_id = job.id; job.checksum = 'sha256:capture';
  job.provenance.wall_clock_ms = 91000;
  return job;
}
function jobFull(job) {
  return { id: job.id, type: job.type, status: job.status, stage: job.stage, created_at: job.created_at,
    prompt: job.prompt, params: job.params, result_url: job.result_url || null, cover_url: job.cover_url || null,
    mime: job.mime || null, size: job.size || null, checksum: job.checksum || null, ttl_seconds: job.ttl_seconds || null,
    file_id: job.file_id || null, provenance: job.provenance, warning: job.warning || null, favorite: job.favorite };
}
function jobPublic(job) {           // _job_public в bff.py: без peaks/title/artist/seed/mime/ttl
  return { id: job.id, type: job.type, status: job.status, created_at: job.created_at,
    prompt: String(job.prompt || '').slice(0, 200), params: { model: job.params && job.params.model, lyrics: job.params && job.params.lyrics },
    result_url: job.result_url || null, cover_url: job.cover_url || null, favorite: job.favorite };
}
function synthLibrary(n) {           // 100 «серверных» треков для состояния «Библиотека»
  const items = [];
  for (let i = 0; i < n; i++) {
    const id = 'job-lib-' + String(i + 1).padStart(3, '0');
    items.push({ id, type: i % 5 === 4 ? 'image' : 'music', status: 'ready', created_at: now() - i * 3600,
      prompt: (i % 5 === 4 ? 'Обложка: ' : '') + ['night city neon', 'warm tape ballad', 'dark trip-hop', 'ambient piano', 'lo-fi instrumental'][i % 5] + ' #' + (i + 1),
      params: { model: i % 3 === 0 ? 'ace-step-pro' : 'ace-step-flash', lyrics: i % 2 ? LYRICS_RU : '' },
      result_url: '/files/' + id + '.wav', cover_url: i % 5 === 4 ? null : '/files/' + id + '-cover.png', favorite: i % 7 === 0 });
  }
  return items;
}
function peaksFor(id) {
  const peaks = [];
  for (let i = 0; i < 240; i++) peaks.push(Math.round((0.25 + 0.7 * Math.abs(Math.sin(i / 9) * Math.cos(i / 23))) * 1000) / 1000);
  return PEAKS_SHAPE === 'array' ? peaks : { id, duration: 214.0, peaks };   // ← контракт README: объект
}

function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(status, Object.assign({
    'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json',
    'Content-Length': buf.length, 'X-Request-Id': 'req-capture-' + Math.random().toString(16).slice(2, 10),
    'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Expose-Headers': 'Retry-After, X-Request-Id, Idempotency-Replayed',
  }, headers));
  res.end(buf);
}
function err(res, status, code, message, extra = {}) {
  send(res, status, { error: Object.assign({ code, message, request_id: 'req-capture-err' }, extra) });
}
function readBody(req) {
  return new Promise(resolve => { let s = ''; req.on('data', d => { s += d; if (s.length > 4e6) req.destroy(); }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } }); });
}

async function api(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '') || '/';
  state.log.push({ at: new Date().toISOString(), method: req.method, path: p, auth: !!req.headers.authorization });

  if (p.startsWith('/__audit/')) {                                  // служебные ручки прогона (без auth)
    const body = req.method === 'POST' ? await readBody(req) : {};
    if (p === '/__audit/reset') { state.jobs.clear(); state.seq = 0; state.libCount = 0; state.failNext = null; state.log = []; return send(res, 200, { ok: true }); }
    if (p === '/__audit/library') { state.libCount = Number(body.count || 0); return send(res, 200, { ok: true, count: state.libCount }); }
    if (p === '/__audit/settle') {
      if (!body.id) { const done = []; for (const j of state.jobs.values()) if (j.status === 'running') { settle(j); done.push(j.id); } return send(res, 200, { ok: true, settled: done }); }
      const j = state.jobs.get(body.id); if (!j) return err(res, 404, 'job_not_found', 'Нет такой задачи'); settle(j); return send(res, 200, jobFull(j));
    }
    if (p === '/__audit/fail-next') { state.failNext = body; return send(res, 200, { ok: true, next: body }); }
    if (p === '/__audit/log') return send(res, 200, { requests: state.log });
    return err(res, 404, 'not_found', 'Неизвестная служебная ручка');
  }

  if (p === '/health') return send(res, 200, { status: 'ok', time: new Date().toISOString() });
  if (p === '/v1/models') return send(res, 200, { models: [
    { id: 'qwen3:4b-instruct', capability: 'text', status: 'ready', typical_latency_seconds: 12 },
    { id: 'flux-2-klein-4b', capability: 'image', status: 'ready', typical_latency_seconds: 261 },
    { id: 'musicgen-small', capability: 'music-instrumental', status: 'ready', typical_latency_seconds: 80 },
    { id: 'ace-step-flash', capability: 'music-vocal', status: 'ready', typical_latency_seconds: 111, max_duration_seconds: 600 },
    { id: 'ace-step-pro', capability: 'music-vocal', status: 'ready', typical_latency_seconds: 596, max_duration_seconds: 600 },
  ], max_concurrent_jobs: 1 });

  if (req.headers.authorization !== 'Bearer ' + TOKEN) return err(res, 401, 'unauthorized', 'Ключ отклонён стендом.');

  if (p === '/jobs' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.prompt || String(body.prompt).length > 4000) return err(res, 400, 'bad_params', 'prompt 1..4000');
    if (/запрещено|blocked/i.test(String(body.prompt))) return err(res, 422, 'content_blocked', 'Текст не прошёл проверку контента.');
    const job = newJob(body);
    return send(res, 200, { job_id: job.id, status: job.status, stage: job.stage });
  }
  if (p === '/jobs' && req.method === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
    const items = [];
    for (const j of state.jobs.values()) { advance(j); if (!j.deleted) items.push(jobPublic(j)); }
    for (const j of synthLibrary(state.libCount)) items.push(j);
    items.sort((a, b) => b.created_at - a.created_at);
    return send(res, 200, { items: items.slice(0, limit), total: items.length, limit, offset: 0 });
  }
  let m = p.match(/^\/jobs\/([^/]+)$/);
  if (m && req.method === 'GET') {
    if (state.failNext) { const f = state.failNext; state.failNext = null; return err(res, Number(f.status || 502), f.code || 'upstream_error', f.message || 'Бэкенд текста вернул http 500.'); }
    const j = state.jobs.get(m[1]);
    if (!j) return err(res, 404, 'job_not_found', 'Задача не найдена.');
    advance(j);
    return send(res, 200, jobFull(j));
  }
  if (m && req.method === 'DELETE') {
    const j = state.jobs.get(m[1]); if (!j) return err(res, 404, 'job_not_found', 'Задача не найдена.');
    j.deleted = true; return send(res, 200, { ok: true, id: j.id });
  }
  m = p.match(/^\/jobs\/([^/]+)\/favorite$/);
  if (m && req.method === 'POST') {
    const j = state.jobs.get(m[1]); const body = await readBody(req);
    if (j) j.favorite = !!body.favorite;
    return send(res, 200, { ok: true, id: m[1], favorite: !!body.favorite });   // для серверных треков библиотеки — тоже «ок»
  }
  m = p.match(/^\/jobs\/([^/]+)\/cancel$/);
  if (m && req.method === 'POST') {
    const j = state.jobs.get(m[1]); if (!j) return err(res, 404, 'job_not_found', 'Задача не найдена.');
    j.status = 'cancelled'; j.stage = 'cancelled'; return send(res, 200, { ok: true, id: j.id, status: 'cancelled' });
  }
  if (p === '/v1/chat/completions' && req.method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body.messages) || !body.messages.length) return err(res, 400, 'bad_schema', 'messages обязательны');
    if (state.failNext) { const f = state.failNext; state.failNext = null; return err(res, Number(f.status || 502), f.code || 'upstream_error', f.message || 'Бэкенд текста вернул http 500.'); }
    const text = chatReply(body.messages);
    if (body.stream === false) return send(res, 200, { choices: [{ message: { role: 'assistant', content: text } }] });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive',
      'X-Request-Id': 'req-capture-sse', 'Access-Control-Allow-Origin': '*' });
    const pieces = text.match(/[\s\S]{1,24}/g) || [text];
    (async () => {
      for (const piece of pieces) {
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n');
        await new Promise(r => setTimeout(r, Number(process.env.SSE_MS || 45)));
      }
      res.write('data: [DONE]\n\n'); res.end();
    })();
    return;
  }
  m = p.match(/^\/files\/(.+)$/);
  if (m && req.method === 'GET') {
    const name = m[1];
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return err(res, 400, 'bad_params', 'Недопустимое имя файла');
    if (/-peaks\.json$/.test(name)) {
      const id = name.replace(/-peaks\.json$/, '');
      const j = state.jobs.get(id);
      if (j && j.status !== 'ready' && !/^job-lib-/.test(id)) return err(res, 404, 'file_gone', 'WAV ещё не готов — пики не посчитаны.');
      return send(res, 200, peaksFor(id));
    }
    if (/\.png$/.test(name)) {
      if (!PNG_CACHE.has(name)) PNG_CACHE.set(name, coverPng(name.length + name.charCodeAt(name.length - 1)));
      return send(res, 200, PNG_CACHE.get(name), { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=60' });
    }
    if (/\.(wav|m4a|mp3)$/.test(name)) {
      if (state.failNext && state.failNext.files === true) { const f = state.failNext; state.failNext = null; return err(res, Number(f.status || 404), f.code || 'file_gone', f.message || 'Файл удалён по сроку хранения.'); }
      return send(res, 200, WAV, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'none' });
    }
    if (/\.txt$/.test(name)) return send(res, 200, Buffer.from(LYRICS_RU), { 'Content-Type': 'text/plain; charset=utf-8' });
    return err(res, 404, 'file_gone', 'Файл не найден.');
  }
  return err(res, 404, 'not_found', 'Нет такого эндпоинта: ' + p);
}

/* ------------------------------------------------------------------ статика */

function staticFile(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/studio/index.html';
  if (AUTO_KEY && (rel === '/studio/index.html' || rel === '/studio/') && !url.searchParams.get('key')) {
    res.writeHead(302, { Location: '/studio/index.html?key=' + encodeURIComponent(TOKEN) });
    return res.end();
  }
  const base = rel.startsWith('/assets/') ? path.join(ROOT, 'assets') : path.join(ROOT, 'studio');
  const file = path.join(base, rel.replace(/^\/(studio|assets)\//, '').replace(/^\/+/, ''));
  if (!file.startsWith(base) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });   // честно: favicon.ico здесь тоже 404 (T-35)
    return res.end('404 ' + rel);
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://' + HOST + ':' + PORT);
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else if (req.method === 'OPTIONS') send(res, 204, {});
      else staticFile(req, res, url);
    } catch (e) {
      if (!res.headersSent) err(res, 500, 'internal', 'Сбой стенда прогона: ' + e.message);
      else res.end();
    }
  });
  return new Promise(resolve => server.listen(PORT, HOST, () => resolve(server)));
}

/* ------------------------------------------------------------------ прогон состояний */

const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'mobile-390x844', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  { name: 'mobile-320x568', width: 320, height: 568, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: 'landscape-844x390', width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];

const wait = ms => new Promise(r => setTimeout(r, ms));
const BASE = 'http://' + BASE_HOST + ':' + PORT;

async function auditCall(request, name, body) {
  return request.post(BASE + '/api/__audit/' + name, { data: body || {} });
}
async function login(page, nick = 'audit') {
  await page.waitForSelector('#gate:not([hidden])', { timeout: 15000 });
  await page.fill('#nickInput', nick);
  for (const d of '0000') await page.click('.pk[data-digit="' + d + '"]');
  await page.click('#enterBtn');
  await page.waitForSelector('#studio:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(400);
}
async function musicMode(page, idea) {
  await page.click('.mode[data-mode="music"]');
  await page.waitForTimeout(200);
  if (idea) { await page.fill('#prompt', idea); await page.waitForTimeout(150); }
}
/* Метрики, которые jsdom дать не может: геометрия, DPR, тач-таргеты, видимые контролы. */
const METRICS = () => {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const btns = [...document.querySelectorAll('button, a.action, .playable, [role="button"], summary')].filter(vis);
  const small = btns.filter(b => { const r = b.getBoundingClientRect(); return r.height < 44 || r.width < 44; })
    .map(b => (b.className || b.tagName) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height));
  const canvas = [...document.querySelectorAll('canvas')].filter(vis);
  const audio = [...document.querySelectorAll('audio')];
  return {
    dpr: window.devicePixelRatio, viewport: window.innerWidth + 'x' + window.innerHeight,
    cards: document.querySelectorAll('#feed .card').length,
    libItems: document.querySelectorAll('.lib-item').length,
    waveforms: document.querySelectorAll('.waveform').length,
    canvas: canvas.length,
    canvasBox: canvas.map(c => { const r = c.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) + ' attr ' + c.width + 'x' + c.height; }).slice(0, 3),
    audio: audio.length, audioPlaying: audio.filter(a => !a.paused).length,
    visibleAudioControls: audio.filter(a => vis(a) && !a.closest('[hidden]')).length,
    statusText: (document.querySelector('#status') || {}).textContent || '',
    statusRole: (document.querySelector('#status') || {}).getAttribute ? document.querySelector('#status').getAttribute('role') : null,
    stagePhrase: (document.querySelector('.wait-line') || {}).textContent || null,
    docHeight: document.documentElement.scrollHeight,
    smallTargets: small.length, smallTargetsSample: small.slice(0, 8),
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
};

/* Каждое состояние — свой контекст (чистые localStorage/IndexedDB), чтобы кадры не влияли друг на друга. */
const STATES = [
  { id: '01-gate', title: 'Вход (гейт, PIN-пад)', run: async ({ page }) => { await page.waitForSelector('#gate:not([hidden])'); } },
  { id: '02-sessions', title: 'Диалог «История» (3 сессии)', run: async ({ page }) => {
    await login(page);
    await page.click('#newChat'); await page.waitForTimeout(500);
    await page.click('#newChat'); await page.waitForTimeout(500);
    await page.click('#sessionsOpen');
    await page.waitForSelector('#sessionsDialog:not([hidden])');
    await page.waitForTimeout(300);
  } },
  { id: '03-composer-music', title: 'Композер: режим «Музыка», идея в поле', run: async ({ page }) => {
    await login(page); await musicMode(page, IDEA_RU);
  } },
  { id: '04-mentor-stream', title: 'Стрим ответа наставника (середина потока)', run: async ({ page }) => {
    await login(page); await musicMode(page, IDEA_RU);
    await page.click('#send');
    await page.waitForSelector('#feed .card.assistant', { timeout: 20000 });
    await page.waitForTimeout(350);                      // ловим момент, когда текст ещё печатается
  } },
  { id: '05-producer-draft', title: 'Черновик продюсера (название/промпт/лирика)', run: async ({ page }) => {
    await login(page); await musicMode(page, IDEA_RU);
    await page.click('#send');
    await page.waitForSelector('.music-draft', { timeout: 30000 });
    await page.waitForTimeout(600);
  } },
  { id: '06-waiting', title: 'Ожидание генерации (стадии + фраза + таймер)', run: async ({ page }) => {
    await login(page); await musicMode(page, IDEA_RU);
    await page.click('#genTrack');
    await page.waitForSelector('#feed .card.stage', { timeout: 30000 });
    await page.waitForTimeout(2500);                     // вторая-третья фраза, таймер идёт
  } },
  { id: '07-track-ready', title: 'Готовый трек: обложка=PLAY, волна из пиков, transparency', run: async ({ page, request }) => {
    await login(page); await musicMode(page, IDEA_RU);
    await page.click('#genTrack');
    await page.waitForSelector('#feed .card.stage', { timeout: 30000 });
    await auditCall(request, 'settle', {});              // мгновенно завершаем все запущенные джобы
    await page.waitForSelector('#feed audio', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const d = page.locator('#feed .track-details').last();
    if (await d.count()) { await d.evaluate(el => { el.open = true; }); await page.waitForTimeout(300); }
  } },
  { id: '08-track-menu', title: 'Меню «⋯» трека (на мобайле — bottom-sheet)', run: async ({ page, request }) => {
    await login(page); await musicMode(page, IDEA_RU);
    await page.click('#genTrack');
    await page.waitForSelector('#feed .card.stage', { timeout: 30000 });
    await auditCall(request, 'settle', {});
    await page.waitForSelector('#feed audio', { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.click('#feed .menu-btn');
    await page.waitForSelector('.track-menu:not([hidden])');
    await page.waitForTimeout(300);
  } },
  { id: '09-library-100', title: 'Библиотека: 100 серверных треков (кадр до и после «В избранное»)', run: async ({ page, request }, shot) => {
    await auditCall(request, 'library', { count: 100 });
    await login(page);
    await page.click('.tab[data-tab="library"]');
    await page.waitForSelector('.lib-item', { timeout: 30000 });
    await page.waitForTimeout(2500);                     // обложки доезжают, список стабилизируется
    await shot('before-fav');
    // «В избранное»: у фото — видимая кнопка, у музыки — пункт меню «⋯» (studio.js:2194, 2231)
    let fav = page.locator('.lib-item .action', { hasText: 'В избранное' }).first();
    if (!(await fav.count())) {
      await page.locator('.lib-item .menu-btn').first().click();
      await page.waitForSelector('.track-menu:not([hidden])');
      fav = page.locator('.track-menu button', { hasText: 'В избранное' }).first();
    }
    if (await fav.count()) { await fav.click(); await page.waitForTimeout(2500); }
    await shot('after-fav');
  } },
  { id: '10-errors', title: 'Ошибки: 502 upstream_error и 422 content_blocked', run: async ({ page, request }) => {
    await login(page); await musicMode(page, IDEA_RU);
    await auditCall(request, 'fail-next', { status: 502, code: 'upstream_error', message: 'Бэкенд текста вернул http 500.' });
    await page.click('#genTrack');
    await page.waitForSelector('#feed .card.notice, #feed .card.error', { timeout: 30000 });
    await page.waitForTimeout(500);
    await page.fill('#prompt', 'запрещено к генерации');
    await auditCall(request, 'fail-next', { status: 422, code: 'content_blocked', message: 'Текст не прошёл проверку контента.' });
    await page.click('#genTrack');
    await page.waitForTimeout(1500);
  } },
];

async function capture() {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { try { ({ chromium } = require('playwright-core')); } catch {
    console.error('Нужен playwright: npm i -D playwright && npx playwright install chromium'); process.exit(2);
  } }

  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--font-render-hinting=none'] });
  const log = [];
  const say = (...a) => { const line = a.map(x => typeof x === 'string' ? x : JSON.stringify(x, null, 1)).join(' '); log.push(line); console.log(line); };

  say('# Скриншот-прогон аудита', new Date().toISOString());
  say('стенд:', BASE, '| форма пиков:', PEAKS_SHAPE, '| STAGE_MS:', STAGE_MS);
  say('состояний:', STATES.length, '| вьюпортов:', VIEWPORTS.length);

  for (const vp of VIEWPORTS) {
    if (ONLY_VP && vp.name !== ONLY_VP) continue;
    for (const st of STATES) {
      if (ONLY_STATE && st.id !== ONLY_STATE && !st.id.startsWith(ONLY_STATE)) continue;
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height },
        isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor || 1 });
      await context.addInitScript(([base, token]) => {
        try {
          localStorage.setItem('briix-media-live-server', base + '/api');   // SERVER_KEY studio.js:10
          localStorage.setItem('briix-media-live-token', token);            // TOKEN_KEY studio.js:11
        } catch { /* приватный режим */ }
      }, [BASE, TOKEN]);
      const page = await context.newPage();
      const console_ = [], failed = [];
      page.on('console', m => { if (['warning', 'error'].includes(m.type())) console_.push(m.type() + ': ' + m.text()); });
      page.on('requestfailed', r => failed.push(r.url() + ' — ' + (r.failure() || {}).errorText));
      const request = context.request;
      await auditCall(request, 'reset');
      const shots = [];
      const shot = async suffix => {
        const name = [st.id, vp.name, suffix].filter(Boolean).join('__') + '.png';
        const full = st.id.startsWith('09') || st.id.startsWith('02');
        await page.screenshot({ path: path.join(OUT, name), fullPage: !!full });
        shots.push(name);
      };
      let error = null;
      try {
        await page.goto(BASE + '/studio/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(300);
        await st.run({ page, request }, shot);
        if (!shots.length) await shot();
      } catch (e) { error = String(e && e.message || e).split('\n')[0]; }
      const metrics = error ? null : await page.evaluate(METRICS).catch(() => null);
      const reqs = await request.get(BASE + '/api/__audit/log').then(r => r.json()).catch(() => ({ requests: [] }));
      const byPath = {};
      for (const r of reqs.requests) { const k = r.method + ' ' + r.path.replace(/job-[^/]+/g, '{id}'); byPath[k] = (byPath[k] || 0) + 1; }
      say('\n== ' + st.id + ' · ' + vp.name + ' — ' + st.title);
      if (error) say('   ОШИБКА ПРОГОНА:', error);
      say('   кадры:', shots.join(', ') || '—');
      if (metrics) say('   метрики:', metrics);
      say('   запросы к /api:', byPath);
      say('   cancel-запросов:', (byPath['POST /jobs/{id}/cancel'] || 0), '| peaks-запросов:', (byPath['GET /files/{id}-peaks.json'] || 0));
      if (console_.length) say('   console.warn/error:', console_.slice(0, 6));
      if (failed.length) say('   requestfailed:', failed.slice(0, 6));
      await context.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'capture-log.txt'), log.join('\n'));
  console.log('\nжурнал: ' + path.join(OUT, 'capture-log.txt'));
}

/* ------------------------------------------------------------------ вход */

(async () => {
  const server = await startServer();
  console.log('стенд прогона: ' + BASE + '/studio/index.html  (api: ' + BASE + '/api, ключ: ' + TOKEN + ')');
  if (ARGV.includes('--server-only')) { console.log('Ctrl-C для остановки.'); return; }
  try { await capture(); } finally { server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
