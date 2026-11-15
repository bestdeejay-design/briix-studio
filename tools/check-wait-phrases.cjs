/* Фаза 3, п.4: живое ожидание — пулы, привязка к стадии, анти-повтор, ротация.
 * Сюита адаптирована под вынос студии из briix.ru (briix.ru#107): страница —
 * /studio/index.html (не корень репо), вход — предзаданный профиль, пробный узел —
 * в #feed, а живой хук проверяется реальной музыкальной джобой и чатом против
 * мини-mock bff (T-50/F-56: раньше сюита ходила на несуществующий /index.html
 * и ждала селекторы старого сайта, из-за чего молча падала под continue-on-error).
 * Self-contained: репозиторий на 127.0.0.1:18390, mock-bff на 127.0.0.1:18301.
 * Run: node tools/check-wait-phrases.cjs
 */
const { launch } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const STATIC_PORT = Number(process.env.BRIIX_WAIT_STATIC_PORT || 18390);
const BFF_PORT = Number(process.env.BRIIX_WAIT_BFF_PORT || 18301);
const TOKEN = 'test-token';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm' };

function staticServer(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('#')[0].split('?')[0]);
      if (p === '/') p = '/studio/index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

/* Мини-mock bff: музыкальная джоба вечно «generating» (для стадии), отмена
 * фиксируется, чат отвечает медленным SSE (чтобы увидеть живую фразу ожидания). */
function bffServer(port) {
  return new Promise(resolve => {
    const state = { jobSeq: 1, cancels: [], jobs: {} };
    const s = http.createServer((req, res) => {
      const origin = req.headers.origin;
      const cors = { 'Access-Control-Allow-Origin': origin === `http://127.0.0.1:${STATIC_PORT}` ? origin : '', Vary: 'Origin' };
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type' }); res.end(); return; }
      const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
      const readBody = cb => { let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => cb(JSON.parse(raw || '{}'))); };

      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        readBody(() => {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...cors });
          // Медленный первый чанк: строка ожидания видна до начала стрима.
          setTimeout(() => {
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Ответ наставника готов.' } }] }) + '\n\n');
            res.write('data: [DONE]\n\n');
            res.end();
          }, 1500);
        });
        return;
      }
      if (req.url === '/jobs' && req.method === 'POST') {
        readBody(body => {
          const id = 'job-wait-' + String(state.jobSeq++).padStart(3, '0');
          state.jobs[id] = body;
          send(202, { job_id: id });
        });
        return;
      }
      const getM = req.url.match(/^\/jobs\/([^/]+)$/);
      if (getM && req.method === 'GET') { send(200, { id: getM[1], type: 'music', status: 'running', stage: 'generating' }); return; }
      const cancelM = req.url.match(/^\/jobs\/([^/]+)\/cancel$/);
      if (cancelM && req.method === 'POST') { state.cancels.push(cancelM[1]); send(200, { id: cancelM[1], status: 'cancelled' }); return; }
      send(404, { error: { code: 'not_found', message: 'nf' } });
    });
    s.listen(port, '127.0.0.1', () => resolve({ server: s, state }));
  });
}

(async () => {
  const srv = await staticServer(STATIC_PORT);
  const { server: bff, state: bffState } = await bffServer(BFF_PORT);
  const browser = await launch();
  const results = [];
  const ok = (name, data = {}) => { results.push({ name, ...data }); console.log('PASS', name, JSON.stringify(data)); };
  const errors = [];
  const contexts = [];
  async function page({ reducedMotion = 'no-preference' } = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion });
    contexts.push(context);
    const p = await context.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(({ t, port, user }) => {
      localStorage.setItem('briix-media-live-token', t);
      localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:' + port));
      if (user) { // предзаданная сессия: гейт входа пропускаем (как в check-studio)
        localStorage.setItem('briix-studio-profiles', JSON.stringify({ [user]: { pinHash: 'x', created: 0 } }));
        localStorage.setItem('briix-studio-user', user);
      }
    }, { t: TOKEN, port: BFF_PORT, user: 'waiter' });
    await p.goto(`http://127.0.0.1:${STATIC_PORT}/studio/index.html`);
    await p.waitForSelector('#studio:not([hidden])');
    await p.waitForFunction(() => !!window.BRIIX_WAIT, {}, { timeout: 10000 });
    return p;
  }

  // 1. Пулы: объём, уникальность, стадии сервера (включая instrumental), зоны мока
  //    и тональные зоны по времени (F-62).
  let p = await page();
  const pools = await p.evaluate(() => {
    const data = window.BRIIX_WAIT_PHRASES;
    const out = {};
    for (const [type, set] of Object.entries(data)) {
      const all = Array.isArray(set) ? set.slice()
        : Object.values(set).flatMap(v => Array.isArray(v) ? v : Object.values(v).flat());
      out[type] = { total: all.length, unique: new Set(all).size, stages: Array.isArray(set) ? [] : Object.keys(set), mock: !Array.isArray(set) && set.mock ? Object.keys(set.mock) : [] };
    }
    return out;
  });
  for (const [type, info] of Object.entries(pools)) {
    if (type === 'easter') { assert.ok(info.total >= 3, 'пасхалок мало'); continue; }
    assert.ok(info.total >= 40, type + ': пул меньше 40 фраз');
    assert.equal(info.total, info.unique, type + ': повторы внутри пула');
  }
  assert.ok(pools.music.stages.includes('writing-lyrics') && pools.music.stages.includes('synthesizing') && pools.music.stages.includes('album-cover'), 'vocal стадии');
  assert.ok(pools.music.stages.includes('model-warmup') && pools.music.stages.includes('generating'), 'instrumental стадии model-warmup/generating (T-02)');
  const genCount = await p.evaluate(() => (window.BRIIX_WAIT_PHRASES.music['generating'] || []).length);
  assert.ok(genCount >= 10, 'пул generating заполнен (>= 10 фраз), есть ' + genCount);
  assert.deepEqual(pools.music.mock, ['start', 'middle', 'final']);
  assert.ok(!('video' in pools), 'мёртвый видео-пул удалён (F-61)');
  const zones = await p.evaluate(() => {
    const z = window.BRIIX_WAIT_PHRASES.music.zones || {};
    return { keys: Object.keys(z), early: (z.early || []).length, mid: (z.mid || []).length, late: (z.late || []).length };
  });
  assert.deepEqual(zones.keys, ['early', 'mid', 'late'], 'три тональные зоны (F-62)');
  assert.ok(zones.early >= 4 && zones.mid >= 4 && zones.late >= 4, 'зоны не пустые');
  assert.ok(await p.evaluate(() => !!window.BRIIX_WAIT_PHRASES.image.zones?.late?.length), 'у фото тоже зоны');
  ok('pools: 40+ unique phrases per type, stages, zones (F-62), no dead video pool', { types: Object.keys(pools) });

  // 1c. Словарь (F-58): жаргона инфраструктуры и «магии нейросетей» в фразах нет;
  //     обещания сроков («почти готов», «скоро») — только в зонах мока, где
  //     длительность известна и коротка. Ассерт ходит по данным, не по файлу.
  const lexicon = await p.evaluate(() => {
    const out = [];
    const walk = (node, mock, where) => {
      if (typeof node === 'string') { out.push({ text: node, mock, where }); return; }
      if (Array.isArray(node)) { node.forEach(x => walk(x, mock, where)); return; }
      for (const [k, v] of Object.entries(node)) walk(v, mock || k === 'mock', where ? where + '.' + k : k);
    };
    walk(window.BRIIX_WAIT_PHRASES, false, '');
    return out;
  });
  const hardBan = /стенд|нейросет|диффузи|аудио-код/i;
  const timingBan = /почти готов|скоро/i;
  for (const item of lexicon) {
    if (hardBan.test(item.text)) assert.fail('F-58: жаргон в фразе (' + item.where + '): ' + item.text);
    if (!item.mock && timingBan.test(item.text)) assert.fail('F-58: обещание сроков вне мока (' + item.where + '): ' + item.text);
  }
  assert.ok(lexicon.length >= 120, 'словарь unexpectedly мал: ' + lexicon.length);
  ok('banned lexicon absent: no stand/neural/diffusion jargon, timing promises only inside mock zones', { phrases: lexicon.length, mock: lexicon.filter(x => x.mock).length });

  // 1b. Тональная зона и пасхалки в выборе (F-62): зона подмешивается к стадии,
  //     пасхалка — редкая. Проверяем детерминированно через Math.random.
  const tone = await p.evaluate(() => {
    const W = window.BRIIX_WAIT, D = window.BRIIX_WAIT_PHRASES;
    W.reset();
    const random = Math.random;
    let zonePicks = 0, easterPicks = 0;
    Math.random = () => 0.001; // зона (0.5) и пасхалка (0.05) срабатывают всегда
    const easterPick = W.pick({ type: 'music', stage: 'synthesizing', zone: 'late' });
    Math.random = random;
    // Пасхалка: малое значение рандома → выбор из easter-пула.
    if (D.easter.includes(easterPick)) easterPicks++;
    // Зона без пасхалки: рандом между 0.05 и 0.5 обходит пасхалку и попадает в зону.
    Math.random = () => 0.2;
    for (let i = 0; i < 8; i++) {
      const phrase = W.pick({ type: 'music', stage: 'synthesizing', zone: 'late' });
      if (D.music.zones.late.includes(phrase)) zonePicks++;
    }
    Math.random = random;
    // Без зоны — старое поведение: стадия + общие фразы.
    const pool = W.poolFor({ type: 'music', stage: 'synthesizing' });
    return { easterPicks, zonePicks, zoneList: W.poolFor({ type: 'music', stage: 'synthesizing', zone: 'late' }).zoneList, noZone: pool.zoneList };
  });
  assert.equal(tone.easterPicks, 1, 'малый рандом даёт пасхалку');
  assert.ok(tone.zonePicks >= 5, 'рандом 0.2 берёт фразу из зоны, пока пул зоны не исчерпан: ' + tone.zonePicks);
  assert.deepEqual(tone.zoneList, await p.evaluate(() => window.BRIIX_WAIT_PHRASES.music.zones.late), 'zoneList отдаёт пул зоны');
  assert.deepEqual(tone.noZone, [], 'без зоны zoneList пуст');
  ok('tone zones and easter eggs participate in pick (F-62)', tone);

  // 2. Привязка к стадии и к зоне мока.
  const binding = await p.evaluate(() => {
    const W = window.BRIIX_WAIT, D = window.BRIIX_WAIT_PHRASES;
    const staged = W.poolFor({ type: 'music', stage: 'album-cover' });
    const instStaged = W.poolFor({ type: 'music', stage: 'generating' });
    const unknown = W.poolFor({ type: 'music', stage: 'несуществующая' });
    const mock = W.poolFor({ type: 'image', mock: true, zone: 'final' });
    return {
      stagedHasCover: D.music['album-cover'].every(x => staged.list.includes(x)),
      stagedFlag: staged.staged,
      instHasGenerating: D.music['generating'].every(x => instStaged.list.includes(x)),
      unknownFallsBack: unknown.staged === null && unknown.list.length === D.music.any.length,
      mockOnlyZone: mock.list.every(x => D.image.mock.final.includes(x))
    };
  });
  assert.deepEqual(binding, { stagedHasCover: true, stagedFlag: 'album-cover', instHasGenerating: true, unknownFallsBack: true, mockOnlyZone: true });
  ok('stage and mock-zone binding', binding);

  // 3. Анти-повтор: окно 15 на длинной серии + малый пул не повторяется подряд (F-60).
  const repeat = await p.evaluate(() => {
    const W = window.BRIIX_WAIT;
    W.reset();
    const window_ = W.noRepeatWindow();
    const seen = [];
    let violations = 0;
    for (let i = 0; i < 60; i++) {
      const phrase = W.pick({ type: 'music', stage: 'synthesizing' });
      const last = seen.slice(-window_);
      if (last.includes(phrase)) violations++;
      seen.push(phrase);
    }
    // Малый пул (model-warmup, 10 фраз при окне 15): клэмп не даёт повторяться подряд.
    const warm = [];
    let backToBack = 0;
    for (let i = 0; i < 40; i++) {
      const phrase = W.pick({ type: 'music', stage: 'model-warmup' });
      if (i && warm[warm.length - 1] === phrase) backToBack++;
      warm.push(phrase);
    }
    return { window: window_, violations, stored: W.recentFor('music').length, distinct: new Set(seen).size, warmBackToBack: backToBack, warmDistinct: new Set(warm).size };
  });
  assert.ok(repeat.window >= 15);
  assert.equal(repeat.violations, 0, 'фраза повторилась внутри окна анти-повтора');
  assert.ok(repeat.distinct > 20);
  assert.equal(repeat.warmBackToBack, 0, 'малый пул: подряд одинаковых фраз нет (F-60)');
  assert.ok(repeat.warmDistinct >= 8, 'малый пул: используется почти весь');
  ok('no repeat inside the window; small pools clamp the window', repeat);

  // 4. История переживает перезагрузку страницы.
  const before = await p.evaluate(() => window.BRIIX_WAIT.recentFor('music').slice(-5));
  await p.reload();
  await p.waitForFunction(() => !!window.BRIIX_WAIT);
  const after = await p.evaluate(() => window.BRIIX_WAIT.recentFor('music').slice(-5));
  assert.deepEqual(after, before);
  ok('anti-repeat history survives reload', { kept: after.length });
  await p.close();

  // 5. Ротация 4–6 секунд на постоянном узле (проба живёт в ленте студии).
  p = await page();
  await p.evaluate(() => {
    window.BRIIX_WAIT.reset();
    const el = document.createElement('p');
    el.className = 'wait-line';
    el.id = 'wait-probe';
    el.setAttribute('data-wait', '');
    el.dataset.waitType = 'music';
    el.dataset.waitStage = 'writing-lyrics';
    document.getElementById('feed').appendChild(el);
    window.BRIIX_WAIT.refresh();
    window.__waitLog = [];
    let last = el.textContent;
    window.__waitTimer = setInterval(() => {
      if (el.textContent !== last) { last = el.textContent; window.__waitLog.push({ t: Date.now(), text: last }); }
    }, 100);
  });
  const firstText = await p.locator('#wait-probe').innerText();
  assert.ok(firstText.length > 10, 'новый узел заполняется сразу');
  await p.waitForFunction(() => window.__waitLog.length >= 3, {}, { timeout: 25000 });
  const rotation = await p.evaluate(() => {
    clearInterval(window.__waitTimer);
    const log = window.__waitLog;
    const gaps = log.slice(1).map((x, i) => x.t - log[i].t);
    return { changes: log.length, gaps, interval: window.BRIIX_WAIT.interval(), texts: log.map(x => x.text) };
  });
  assert.ok(rotation.changes >= 3);
  for (const gap of rotation.gaps) assert.ok(gap >= 3800 && gap <= 7100, 'интервал вне 4–6 с: ' + gap);
  assert.equal(new Set(rotation.texts).size, rotation.texts.length, 'фразы повторяются при ротации');
  ok('rotation every 4–6 seconds without repeats', { changes: rotation.changes, gaps: rotation.gaps });

  // 6. Смена стадии меняет пул немедленно.
  const stageSwitch = await p.evaluate(async () => {
    const el = document.querySelector('#wait-probe');
    el.dataset.waitStage = 'album-cover';
    await new Promise(r => setTimeout(r, 300));
    const D = window.BRIIX_WAIT_PHRASES.music;
    return { text: el.textContent, allowed: [...D['album-cover'], ...D.any].includes(el.textContent) };
  });
  assert.equal(stageSwitch.allowed, true);
  ok('stage change re-pools the line immediately', stageSwitch);
  await p.close();

  // 7. Уменьшенное движение: одна фраза, без ротации.
  p = await page({ reducedMotion: 'reduce' });
  await p.evaluate(() => {
    window.BRIIX_WAIT.reset();
    const el = document.createElement('p');
    el.id = 'wait-probe';
    el.setAttribute('data-wait', '');
    el.dataset.waitType = 'image';
    document.body.appendChild(el);
    window.BRIIX_WAIT.refresh();
  });
  const still = await p.locator('#wait-probe').innerText();
  await p.waitForTimeout(7500);
  assert.equal(await p.locator('#wait-probe').innerText(), still, 'при reduced-motion ротации быть не должно');
  assert.equal(await p.evaluate(() => window.BRIIX_WAIT.stats().rotations), 0);
  ok('reduced motion: no rotation', { phrase: still });
  await p.close();

  // 8. Живой хук: инструментальная джоба против mock-bff — строка под прогрессом,
  //    серверная стадия generating и подпись «генерация» (T-02), ✕ отменяет джобу (T-05).
  p = await page();
  await p.locator('.mode[data-mode="music"]').click();
  await p.locator('.seg-btn[data-vocal="1"]').click(); // инструментал: без автолирики, сразу POST /jobs
  await p.locator('#prompt').fill('спокойный инструментальный этюд для вечернего города');
  await p.locator('#genTrack').click();
  await p.waitForSelector('.card.stage [data-wait]', { timeout: 15000 });
  const hook = await p.evaluate(() => {
    const el = document.querySelector('.card.stage [data-wait]');
    const bar = document.querySelector('.stage-progress');
    return {
      text: el.textContent, type: el.dataset.waitType, stage: el.dataset.waitStage,
      bothInStageCard: !!(bar && el.closest('.card.stage')?.contains(bar)),
      fontSize: parseFloat(getComputedStyle(el).fontSize)
    };
  });
  assert.ok(hook.text.length > 10, 'фраза ожидания заполнена');
  assert.equal(hook.type, 'music', 'тип фразы — music');
  assert.ok(hook.bothInStageCard, 'фраза и прогресс живут в одной карточке ожидания');
  assert.ok(hook.fontSize <= 14, 'мелкий кегль');
  // Серверная стадия generating приходит первым поллингом (интервал 2,5 с).
  await p.waitForFunction(() => document.querySelector('.card.stage [data-wait]')?.dataset.waitStage === 'generating', {}, { timeout: 15000 });
  assert.match(await p.locator('.stage-progress-label').innerText(), /генерация/i, 'подпись этапа — «генерация» (T-02)');
  // F-15: полоса стадий — настоящий progressbar с текстовым значением этапа.
  const barRole = await p.evaluate(() => {
    const bar = document.querySelector('.stage-progress');
    return { role: bar?.getAttribute('role'), valuetext: bar?.getAttribute('aria-valuetext'), label: bar?.getAttribute('aria-label') };
  });
  assert.equal(barRole.role, 'progressbar', 'F-15: stage-progress имеет роль progressbar');
  assert.match(barRole.valuetext || '', /генерация/i, 'F-15: aria-valuetext называет этап');
  assert.equal(barRole.label, 'Генерация трека');
  ok('live music job shows the wait line under the progress with the server stage', hook);
  // ✕ отменяет джобу на сервере (T-05).
  const cancelSent = p.waitForRequest(r => r.method() === 'POST' && /\/jobs\/[^/]+\/cancel$/.test(new URL(r.url()).pathname), { timeout: 10000 });
  await p.locator('.card.stage .stage-stop').click();
  await cancelSent;
  assert.ok(bffState.cancels.length >= 1, '✕ шлёт POST /jobs/{id}/cancel (T-05)');
  assert.match(await p.locator('.card.notice').last().innerText(), /ожидание остановлено/i);
  ok('stop cancels the job on the mock bff', { cancels: bffState.cancels.length });
  await p.close();

  // 9. Чат: строка ожидания видна до первого чанка стрима и исчезает с ответом.
  p = await page();
  await p.locator('#prompt').fill('Что ты умеешь?');
  await p.locator('#send').click();
  await p.waitForSelector('#feed [data-wait-type="chat"]', { timeout: 10000 });
  await p.waitForFunction(() => !document.querySelector('#feed [data-wait]'), {}, { timeout: 15000 });
  assert.match(await p.locator('#feed .card.assistant').last().innerText(), /Ответ наставника готов/);
  ok('chat wait line appears before the first chunk and leaves with the reply', {});

  assert.deepEqual(errors, [], 'page errors');
  ok('no page errors', {});
  console.log('DONE', results.length, 'checks');
  for (const c of contexts) await c.close();
  await browser.close();
  srv.close();
  bff.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
