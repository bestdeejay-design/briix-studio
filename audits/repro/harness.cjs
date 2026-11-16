/* Audit harness (НЕ прод-код, не часть репозитория).
 * Поднимает studio/ в jsdom + fake-indexeddb с фейковым media-bff, чтобы доказать
 * динамические находки аудита без Chromium (в песочнице Арены браузер недоступен).
 * Ничего в studio/ не меняется: файлы читаются как есть и исполняются в window.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { webcrypto } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const STUDIO = path.join(ROOT, 'studio');
const SCRIPTS = ['wait-phrases.js', 'wait-ui.js', 'session-store.js', 'waveform.js', 'producer-brain.js', 'music-brain.js', 'studio.js'];

/* ---------- фейковая шина (контракт берётся из server-contract/) ---------- */
function makeBff(opts = {}) {
  const bff = {
    requests: [],            // {method,url,headers,body}
    jobs: new Map(),
    jobSeq: 0,
    token: 'test-token',
    chatScript: opts.chatScript || null,   // fn(messages) -> string | async chunks
    peaksShape: opts.peaksShape || 'array', // 'array' (как в check-studio.cjs) | 'object' (как в server-contract/README)
    stages: opts.stages || null,            // массив стадий для music-джобы (реальный bff: model-warmup|generating)
    imageStage: opts.imageStage === undefined ? null : opts.imageStage,
    failPollOnce: opts.failPollOnce || false,
    failStatus: opts.failStatus || 0,
    failEnvelope: opts.failEnvelope || null,
    chatChunkDelay: opts.chatChunkDelay,
    serverList: opts.serverList || [],
    getJobExtra: opts.getJobExtra || {},
    listExtra: opts.listExtra || {},
    files: opts.files || {},
    objectUrls: { created: 0, revoked: 0, live: new Set() },
    intervals: { created: 0, cleared: 0, live: new Set() },
    observers: { created: 0, disconnected: 0 },
  };
  bff.log = (m, u, init) => bff.requests.push({ method: m, url: u, headers: (init && init.headers) || {}, body: init && init.body ? String(init.body) : null, at: Date.now() });
  bff.callsTo = re => bff.requests.filter(r => re.test(r.url + ' ' + r.method));
  return bff;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-audit-0001', ...headers } });
}

function sseResponse(chunks, delayMs = 1) {
  const stream = new ReadableStream({
    async start(controller) {
      for (const c of chunks) {
        controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: c } }] }) + '\n\n'));
        if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      }
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function router(bff) {
  return async function fetchMock(input, init = {}) {
    const url = String(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    bff.log(method, url, init);
    const u = new URL(url, 'http://doc.local');
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
    if (auth !== 'Bearer ' + bff.token && !/creative-base|\/assets\//.test(u.pathname)) {
      return json({ error: { code: 'unauthorized', message: 'Требуется bearer-токен.' } }, 401);
    }
    if (/creative-base\.json$/.test(u.pathname)) {
      const p = path.join(ROOT, 'assets/data/creative-base.json');
      return new Response(fs.readFileSync(p), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (u.pathname === '/v1/chat/completions') {
      const body = JSON.parse(init.body || '{}');
      if (bff.failStatus && bff.failOn === 'chat') {
        return json(bff.failEnvelope || { error: { code: 'upstream_error', message: 'Бэкенд текста вернул http 500.' } }, bff.failStatus);
      }
      if (typeof bff.chatScript === 'function') {
        const out = await bff.chatScript(body.messages, body);
        if (body.stream) return sseResponse(Array.isArray(out) ? out : String(out).match(/\S+\s*/g) || [String(out)], bff.chatChunkDelay === undefined ? 1 : bff.chatChunkDelay);
        return json({ choices: [{ message: { role: 'assistant', content: Array.isArray(out) ? out.join('') : String(out) } }] });
      }
      const text = 'Ответ наставника: тестовая строка для аудита.';
      if (body.stream) return sseResponse(text.match(/\S+\s*/g) || [text], bff.chatChunkDelay === undefined ? 1 : bff.chatChunkDelay);
      return json({ choices: [{ message: { role: 'assistant', content: text } }] });
    }
    if (u.pathname === '/jobs' && method === 'POST') {
      const body = JSON.parse(init.body || '{}');
      const id = 'job-audit-' + (++bff.jobSeq);
      const stages = bff.stages || (body.type === 'music' && body.params && body.params.instrumental
        ? ['model-warmup', 'generating', 'album-cover']
        : body.type === 'music' ? ['writing-lyrics', 'synthesizing', 'album-cover'] : [bff.imageStage]);
      bff.jobs.set(id, { id, type: body.type, prompt: body.prompt, params: body.params || {}, stageIndex: 0, polls: 0, stages, status: 'running', deleted: false, favorite: false });
      return json({ job_id: id }, 202);
    }
    if (u.pathname === '/jobs' && method === 'GET') {
      const items = bff.serverList.map(j => ({ id: j.id, type: j.type, status: 'ready', prompt: j.prompt || '', params: j.params || {}, favorite: !!j.favorite, created_at: j.created_at || 1700000000, result_url: '/files/' + j.id, cover_url: j.cover_url || ('/files/' + j.id + '-cover.png'), ...bff.listExtra }));
      return json({ total: items.length, limit: 100, offset: 0, items });
    }
    let m = u.pathname.match(/^\/jobs\/([^/]+)$/);
    if (m && method === 'GET') {
      const j = bff.jobs.get(m[1]);
      if (!j || j.deleted) return json({ error: { code: 'job_not_found', message: 'Задача не найдена.' } }, 404);
      j.polls++;
      if (bff.failPollOnce) { bff.failPollOnce = false; return bff.failEnvelope ? json(bff.failEnvelope, bff.failStatus || 502) : json({ error: { code: 'upstream_error', message: 'Бэкенд текста вернул http 500.' } }, bff.failStatus || 502); }
      if (bff.networkFailOnce) { bff.networkFailOnce = false; throw new TypeError('fetch failed'); }
      const stage = j.stages[Math.min(j.stageIndex, j.stages.length - 1)];
      j.stageIndex++;
      const done = j.stageIndex > j.stages.length;
      if (done) {
        j.status = 'ready';
        return json({ id: j.id, type: j.type, status: 'ready', result_url: '/files/' + j.id + (j.type === 'music' ? '.m4a' : '.png'), cover_url: j.type === 'music' ? '/files/' + j.id + '-cover.png' : undefined, mime: j.type === 'music' ? 'audio/mp4' : 'image/png', size: 1300000, checksum: 'sha256:deadbeef', ttl_seconds: 86000, provenance: { model: 'ace-step-flash', params: j.params, seed: 12345, capability: 'song.vocal', wall_clock_ms: 91000, queued_ms: 400 }, ...bff.getJobExtra });
      }
      return json({ id: j.id, type: j.type, status: 'running', stage, provenance: { model: 'ace-step-flash', params: j.params }, ...bff.getJobExtra });
    }
    m = u.pathname.match(/^\/jobs\/([^/]+)\/cancel$/);
    if (m && method === 'POST') { const j = bff.jobs.get(m[1]); if (j) j.status = 'cancelled'; return json({ id: m[1], status: 'cancelled' }); }
    m = u.pathname.match(/^\/jobs\/([^/]+)\/favorite$/);
    if (m && method === 'POST') { const j = bff.jobs.get(m[1]) || { id: m[1] }; const body = JSON.parse(init.body || '{}'); j.favorite = !!body.favorite; if (!bff.jobs.has(m[1])) bff.serverList.forEach(x => { if (x.id === m[1]) x.favorite = !!body.favorite; }); return json({ id: m[1], favorite: j.favorite }); }
    m = u.pathname.match(/^\/jobs\/([^/]+)$/);
    if (m && method === 'DELETE') { const j = bff.jobs.get(m[1]); if (j) j.deleted = true; bff.serverList = bff.serverList.filter(x => x.id !== m[1]); return json({ id: m[1], deleted: true }); }
    m = u.pathname.match(/^\/files\/(.+)-peaks\.json$/);
    if (m && method === 'GET') {
      if (bff.peaksShape === 'none') return json({ error: { code: 'not_found', message: 'nf' } }, 404);
      const peaks = Array.from({ length: 160 }, (_, i) => 0.2 + 0.6 * Math.abs(Math.sin(i / 9)));
      // server-contract/README: «сервер отдаёт объект {id, duration, peaks}, а не голый массив»
      return json(bff.peaksShape === 'object' ? { id: m[1], duration: 91.4, peaks } : peaks);
    }
    if (u.pathname.startsWith('/files/') && method === 'GET') {
      const name = u.pathname.slice('/files/'.length);
      const ct = /-cover\.png|\.png$/.test(name) ? 'image/png' : /\.wav$/.test(name) ? 'audio/wav' : /\.m4a$/.test(name) ? 'audio/mp4' : 'audio/mp4';
      const body = bff.files[name] || (ct === 'image/png' ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') : Buffer.from('fake-audio-bytes'));
      return new Response(body, { status: 200, headers: { 'Content-Type': ct, 'Content-Disposition': 'attachment; filename="audit.m4a"' } });
    }
    if (u.pathname === '/v1/models') return json({ object: 'list', data: [] });
    return json({ error: { code: 'not_found', message: 'nf' } }, 404);
  };
}

/* ---------- полифилы, которых в jsdom нет ---------- */
function patchWindow(win, bff, opts = {}) {
  const io = opts.intersect === undefined ? 'immediate' : opts.intersect;
  Object.defineProperty(win, 'crypto', { value: webcrypto, configurable: true });
  win.TextEncoder = TextEncoder; win.TextDecoder = TextDecoder;
  win.AbortSignal = AbortSignal; win.AbortController = AbortController;
  win.Response = Response; win.Headers = Headers; win.Request = Request;
  win.ReadableStream = ReadableStream;
  win.matchMedia = q => ({ matches: /no-preference/.test(q) ? !opts.reducedMotion : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null });
  win.IntersectionObserver = class {
    constructor(cb, o) { this.cb = cb; this.o = o; this.targets = []; bff.observers.created++; }
    observe(el) { this.targets.push(el); if (io === 'immediate') setTimeout(() => this.cb([{ target: el, isIntersecting: true }], this), 0); }
    unobserve(el) { this.targets = this.targets.filter(t => t !== el); }
    disconnect() { this.targets = []; bff.observers.disconnected++; }
    takeRecords() { return []; }
  };
  win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  win.URL.createObjectURL = blob => { const u = 'blob:audit/' + (++bff.objectUrls.created); bff.objectUrls.live.add(u); return u; };
  win.URL.revokeObjectURL = u => { if (bff.objectUrls.live.delete(u)) bff.objectUrls.revoked++; };
  const rawGetContext = win.HTMLCanvasElement.prototype.getContext;
  win.HTMLCanvasElement.prototype.getContext = function (kind) {
    if (kind !== '2d') return rawGetContext.call(this, kind);
    const ops = { fillRect: 0, clearRect: 0 };
    this.__ctxOps = ops;
    return { canvas: this, fillStyle: '', ops, clearRect: () => ops.clearRect++, fillRect: () => ops.fillRect++, measureText: () => ({ width: 10 }), beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, save() {}, restore() {}, translate() {}, scale() {}, drawImage() {}, setTransform() {}, createLinearGradient: () => ({ addColorStop() {} }), getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {} };
  };
  // play/pause: честная эмуляция события, чтобы видеть «два трека играют одновременно»
  Object.defineProperty(win.HTMLMediaElement.prototype, 'paused', { get() { return this.__paused !== false; }, set(v) { this.__paused = !!v; }, configurable: true });
  Object.defineProperty(win.HTMLMediaElement.prototype, 'currentTime', { get() { return this.__ct || 0; }, set(v) { this.__ct = Number(v) || 0; this.dispatchEvent(new win.Event('seeked')); }, configurable: true });
  win.HTMLMediaElement.prototype.play = function () { this.paused = false; this.dispatchEvent(new win.Event('play')); return Promise.resolve(); };
  win.HTMLMediaElement.prototype.pause = function () { this.paused = true; this.dispatchEvent(new win.Event('pause')); };
  Object.defineProperty(win.HTMLMediaElement.prototype, 'duration', { get() { return this.__duration === undefined ? 91.4 : this.__duration; }, set(v) { this.__duration = v; }, configurable: true });
  // Image: onload срабатывает (в jsdom без загрузчика ресурсов — нет)
  win.Image = function Image(w, h) {
    const el = win.document.createElement('img');
    if (w !== undefined) el.width = w;
    if (h !== undefined) el.height = h;
    let v = '';
    Object.defineProperty(el, 'src', {
      configurable: true,
      get() { return v; },
      set(nv) { v = nv; el.setAttribute('src', nv); setTimeout(() => el.dispatchEvent(new win.Event('load')), 0); }
    });
    return el;
  };
  // Web Locks (нужен session-store для local-fallback и для open())
  const locksHeld = new Map();
  win.navigator.locks = {
    async request(name, cb) {
      while (locksHeld.get(name)) await locksHeld.get(name);
      let release; const p = new Promise(r => { release = r; });
      locksHeld.set(name, p);
      try { return await cb(); } finally { locksHeld.delete(name); release(); }
    }
  };
  // счётчик живых интервалов (утечки таймеров)
  const scale = opts.timeScale || 1;
  const rawTimeout = win.setTimeout.bind(win);
  win.setTimeout = (fn, ms, ...a) => rawTimeout(fn, Math.max(1, Math.round((ms || 0) / scale)), ...a);
  const rawSet = win.setInterval.bind(win), rawClear = win.clearInterval.bind(win);
  win.setInterval = (fn, ms, ...a) => { const id = rawSet(fn, Math.max(1, Math.round((ms || 0) / scale)), ...a); bff.intervals.created++; bff.intervals.live.add(id); return id; };
  win.clearInterval = id => { if (bff.intervals.live.delete(id)) bff.intervals.cleared++; return rawClear(id); };
  win.confirmCalls = [];
  win.confirm = msg => { win.confirmCalls.push(msg); return opts.confirm === undefined ? true : opts.confirm(msg); };
  win.alert = () => {};
  win.scrollTo = () => {};
  win.fetch = router(bff);
  win.addEventListener('error', e => { (win.__errors ||= []).push(String(e.error || e.message)); });
}

/* ---------- загрузка студии ---------- */
async function boot(opts = {}) {
  const bff = makeBff(opts);
  const html = fs.readFileSync(path.join(STUDIO, 'index.html'), 'utf8')
    .replace(/<script src="[^"]+"><\/script>/g, '');   // скрипты исполняем сами, по порядку из HTML
  const dom = new JSDOM(html, {
    url: opts.url || 'http://127.0.0.1:8080/studio/index.html',
    runScripts: 'dangerously', pretendToBeVisual: true, resources: undefined
  });
  const win = dom.window;
  const FDB = require('fake-indexeddb');
  win.indexedDB = opts.idb || new FDB.IDBFactory();
  win.IDBKeyRange = require('fake-indexeddb').IDBKeyRange;
  patchWindow(win, bff, opts);
  if (opts.storage) for (const [k, v] of Object.entries(opts.storage)) win.localStorage.setItem(k, v);
  for (const name of SCRIPTS) {
    const code = fs.readFileSync(path.join(STUDIO, name), 'utf8');
    try { win.eval(code); } catch (e) { (win.__errors ||= []).push(name + ': ' + (e && e.stack || e)); }
  }
  await tick(opts.bootMs || 60);
  return { dom, win, doc: win.document, bff, opts, idb: win.indexedDB };
}
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
async function settle(times = 6, ms = 25) { for (let i = 0; i < times; i++) await tick(ms); }

/* ---------- помощники сценариев ---------- */
function click(el) { el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true })); }
function setVal(el, v) { el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true })); }
function key(el, k, extra = {}) { el.dispatchEvent(new el.ownerDocument.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })); }
async function login(ctx, nick = 'audit', pin = '0000') {
  const { doc, win } = ctx;
  doc.getElementById('nickInput').value = nick;
  for (const d of pin) click(doc.querySelector(`.pk[data-digit="${d}"]`));
  click(doc.getElementById('enterBtn'));
  await settle(8, 20);
  return { backend: doc.getElementById('storageWarning').hidden ? 'idb' : 'local', errors: win.__errors || [] };
}
function txt(el) { return el ? (el.textContent || '').trim() : null; }
function visible(el) { return Boolean(el) && !el.hidden; }

module.exports = { boot, tick, settle, click, setVal, key, login, txt, visible, makeBff, json, sseResponse, SCRIPTS, STUDIO, ROOT };
