/* Studio v2 checks: composer-first dark UI on the private bus.
 * Self-contained: repo on 127.0.0.1:18388, fake media-bff on 127.0.0.1:18300.
 * Run: node tools/check-studio.cjs
 */
const { launch } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const STATIC_PORT = Number(process.env.BRIIX_STUDIO_STATIC_PORT || 18388);
const BFF_PORT = Number(process.env.BRIIX_STUDIO_BFF_PORT || 18300);
const TOKEN = 'test-token';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.m4a': 'audio/mp4', '.json': 'application/json', '.woff2': 'font/woff2' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const M4A_PATH = path.join(ROOT, 'assets/media/showcase/ballad30.m4a');
const M4A = fs.existsSync(M4A_PATH) ? fs.readFileSync(M4A_PATH) : Buffer.from('fake-m4a');
// Настоящий играбельный WAV (2 с, 16 кГц, синус 440 Гц) — для проверки «обложка = PLAY».
function makeToneWav() {
  const sampleRate = 16000, samples = sampleRate * 2;
  const bytes = new ArrayBuffer(44 + samples * 2), v = new DataView(bytes);
  const str = (offset, text) => [...text].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint32(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 20000), true);
  return Buffer.from(bytes);
}
const WAV = makeToneWav();
const POLICY_MESSAGE = 'Запрос нарушает политику контента.';

let state;
function resetBff() {
  state = {
    chatPosts: [], chatBlocked: false, chatImproveText: 'УЛУЧШЕННЫЙ ТЕКСТ', chatSlow: false, improveDelay: 0, favoriteFail: false, coverRateLimit: 0, coverRequests: 0, audioRequests: 0, photoRequests: 0, fileOrder: [], fileDelay: 0, activeFiles: 0, maxActiveFiles: 0, jobsLists: 0,
    jobPosts: [], jobBlock: false, pollFailures: [], pollAttempts: 0, polls: 0, deleted: {}, favs: {}, jobSeq: 1, pollsOf: {}, cancels: [], foreign: [], chatCrlf: false, chatMidstreamError: false, streamEnds: 0, midstreamCloses: 0, slowFiles: [], chatSlowText: '', chatSlowTick: 0
  };
}
resetBff();

function staticServer(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('#')[0].split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

function sse(res, fullText, intervalMs = 5) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': `http://127.0.0.1:${STATIC_PORT}` });
  const words = fullText.split(' ');
  let i = 0;
  const timer = setInterval(() => {
    if (i < words.length) {
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: (i ? ' ' : '') + words[i] } }] }) + '\n\n');
      i++;
    } else {
      res.write('data: [DONE]\n\n');
      clearInterval(timer);
      res.end();
      state.streamEnds++;
    }
  }, intervalMs);
  res.on('close', () => clearInterval(timer));
}

/* T-15: жёсткие варианты SSE — прокси с \r\n\r\n, JSON, побитый на две
 * data:-строки внутри одного события, и ошибка посреди потока без [DONE]
 * (клиент обязан отменить reader — иначе соединение зависнет). */
function sseCrlf(res, fullText) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': `http://127.0.0.1:${STATIC_PORT}` });
  const words = fullText.split(' ');
  let i = 0;
  const timer = setInterval(() => {
    if (i < words.length) {
      const json = JSON.stringify({ choices: [{ delta: { content: (i ? ' ' : '') + words[i] } }] });
      const mid = Math.floor(json.length / 2);
      // один event = два data:-фрагмента одного JSON + \r\n-переводы (nginx-стиль)
      res.write('data: ' + json.slice(0, mid) + '\r\n');
      res.write('data: ' + json.slice(mid) + '\r\n\r\n');
      i++;
    } else {
      res.write('data: [DONE]\r\n\r\n');
      clearInterval(timer);
      res.end();
      state.streamEnds++;
    }
  }, 5);
  res.on('close', () => clearInterval(timer));
}

function sseMidstreamError(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': `http://127.0.0.1:${STATIC_PORT}` });
  res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'начало ответа ' } }] }) + '\n\n');
  setTimeout(() => {
    res.write('data: ' + JSON.stringify({ error: { code: 'upstream_error', message: 'Бэкенд лёг посреди потока' } }) + '\n\n');
    // [DONE] не шлём и соединение не закрываем: выживает только клиент,
    // который отменяет reader при ошибке (T-15). Фиксируем момент разрыва.
  }, 60);
  res.on('close', () => { state.midstreamCloses++; });
}

function bffServer(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const origin = req.headers.origin;
      const cors = { 'Access-Control-Allow-Origin': origin === `http://127.0.0.1:${STATIC_PORT}` ? origin : '', Vary: 'Origin' };
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type' }); res.end(); return; }
      const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
      const readBody = cb => { let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => cb(JSON.parse(raw || '{}'))); };

      if (req.url === '/health') { send(200, { ok: true }); return; }
      // Каталог моделей — как на живом bff: без авторизации (F-59).
      if (req.url === '/v1/models') {
        send(200, { object: 'list', data: [
          { id: 'ace-step-flash', object: 'model', status: 'ready', capabilities: ['song.vocal'], latency: { source: 'measured', seconds: 111, conditions: '30с трек' } },
          { id: 'ace-step-pro', object: 'model', status: 'unavailable', capabilities: ['song.vocal'], latency: { source: 'measured', seconds: 596, conditions: '150с трек' } },
          { id: 'flux-2-klein-4b', object: 'model', status: 'ready', capabilities: ['image.generate'], latency: { source: 'measured', seconds: 261, conditions: 'холодный и тёплый сопоставимы' } },
          { id: 'musicgen-small', object: 'model', status: 'ready', capabilities: ['music.generate'], latency: { source: 'none', seconds: null, conditions: '' } }
        ] });
        return;
      }
      if (req.headers.authorization !== 'Bearer ' + TOKEN) { send(401, { error: { code: 'unauthorized', message: 'no' } }); return; }

      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        readBody(body => {
          state.chatPosts.push(body);
          if (state.chatBlocked) { send(422, { error: { code: 'content_blocked', message: POLICY_MESSAGE } }); return; }
          const last = body.messages.at(-1)?.content || '';
          // Кнопка «Улучшить» ходит non-stream, чат — stream.
          if (body.stream === false) {
            const reply = () => send(200, { choices: [{ message: { content: state.chatImproveText } }] });
            if (state.improveDelay) setTimeout(reply, state.improveDelay); else reply();
            return;
          }
          if (state.chatMidstreamError) return sseMidstreamError(res);
          if (state.chatCrlf) return sseCrlf(res, 'Стрим через жёсткий прокси: ' + last.slice(-30));
          if (state.chatSlow) return sse(res, state.chatSlowText || 'медленное слово '.repeat(80), state.chatSlowTick || 120);
          // Автор песен (автолирика, studio.js autoLyrics): по контракту #109
          // дефолт — английский (язык в идее не указан). Прежний мок возвращал
          // русскую болтовню «Стрим пришёл…» — ассерт фиксировал противоречие
          // (тег English lyrics + params.language=ru). Мок обязан быть верен
          // контракту, как и реальная модель.
          if (/Ты — автор песен/.test(body.messages[0]?.content || '')) {
            return sse(res, '[Intro]\n[Verse]\nCity lights are calling low tonight\n[Chorus]\nWe walk the night alone');
          }
          // Разговорный музыкальный режим (#35: единый диалог): музыкальная роль
          // отвечает разговорно и всегда с draft-блоком в маркер-формате клиента.
          // Роль детектим по объявлению «Ты «…»» / «Ты музыкальный продюсер»
          // (prepareMusic, producer-brain) — в контексте студии есть слово
          // «Лирика:», которое ложно матчило старый /Лирик/.
          if (/Ты «(Продюсер|Лирик|Автор песни)»|музыкальный продюсер BRIIX/.test(body.messages[0]?.content || '')) {
            const draft = JSON.stringify({ title: 'Черновик наставника', prompt: 'dream pop, 90 BPM, warm female vocals', lyrics: '[Verse]\nНовая строка про осень' });
            return sse(res, 'Разговор пошёл. Вот черновик. [briix-draft] ' + draft + ' [/briix-draft]');
          }
          sse(res, 'Стрим пришёл: ' + last.slice(-40));
        });
        return;
      }

      if (req.url === '/jobs' && req.method === 'POST') {
        readBody(body => {
          state.jobPosts.push(body);
          if (state.jobBlock) { send(422, { error: { code: 'content_blocked', message: POLICY_MESSAGE } }); return; }
          body.id = 'job-' + String(state.jobSeq++).padStart(3, '0');
          send(202, { job_id: body.id });
        });
        return;
      }

      // infra#77 контракт: список / мягкое удаление / избранное (id уникальны, как на живом bff)
      if (req.url.split('?')[0] === '/jobs' && req.method === 'GET') { // клиент зовёт /jobs?limit=100
        state.jobsLists++;
        const own = state.jobPosts
          .filter(({ id }) => !state.deleted[id])
          .map(({ id, type, prompt, params }, i) => ({
            id,
            type: type || 'image',
            status: 'ready',
            prompt: prompt || '',
            params: { ...(params || {}) },
            result_url: type === 'music' ? '/files/' + id + '.m4a' : '/files/' + id + '.png',
            cover_url: type === 'music' ? '/files/' + id + '-cover.png' : '',
            favorite: !!state.favs[id],
            created_at: 1794000000 + i
          }));
        // T-41: чужие записи (params.artist ≠ текущий ник) — как на живом стенде
        // до скоупинга: общий ключ видит всё, фильтрация — на клиенте.
        const items = [...state.foreign.filter(({ id }) => !state.deleted[id]), ...own];
        send(200, { total: items.length, limit: 100, offset: 0, items });
        return;
      }
      const favM = req.url.match(/^\/jobs\/([^/]+)\/favorite$/);
      if (favM && req.method === 'POST') {
        if (state.favoriteFail) { send(503, { error: { code: 'unavailable' } }); return; }
        readBody(body => { if (typeof body.favorite !== 'boolean') return send(400, { error: { code: 'bad_schema', message: 'bad' } }); state.favs[favM[1]] = body.favorite; send(200, { id: favM[1], favorite: body.favorite }); });
        return;
      }
      // T-05: у реального bff есть POST /jobs/{id}/cancel — мок обязан отвечать на него.
      const cancelM = req.url.match(/^\/jobs\/([^/]+)\/cancel$/);
      if (cancelM && req.method === 'POST') {
        state.cancels.push(cancelM[1]);
        const post = state.jobPosts.find(p => p.id === cancelM[1]);
        send(200, { id: cancelM[1], status: post ? 'cancelled' : 'job_not_found' });
        return;
      }
      const delM = req.url.match(/^\/jobs\/([^/]+)$/);
      if (delM && req.method === 'DELETE') {
        state.deleted[delM[1]] = true;
        send(200, { id: delM[1], deleted: true });
        return;
      }

      const getM = req.url.match(/^\/jobs\/([^/]+)$/);
      if (getM && req.method === 'GET') {
        state.pollAttempts++;
        if (state.pollFailures.length) {
          const code = state.pollFailures.shift();
          res.writeHead(code, { 'Content-Type': 'application/json', 'Retry-After': '0', 'Access-Control-Expose-Headers': 'Retry-After', ...cors });
          res.end(JSON.stringify({ error: { code: 'busy' } })); return;
        }
        const post = state.jobPosts.find(p => p.id === getM[1]);
        if (!post || state.deleted[post.id]) { send(404, { error: { code: 'job_not_found', message: 'deleted' } }); return; }
        if ((state.pollsOf[post.id] || 0) < 2) {
          state.pollsOf[post.id] = (state.pollsOf[post.id] || 0) + 1;
          // Стадии по контракту bff: vocal — writing-lyrics → synthesizing,
          // instrumental — model-warmup → generating (T-02).
          let stage;
          if (post.type === 'music' && post.params?.instrumental) stage = state.pollsOf[post.id] === 1 ? 'model-warmup' : 'generating';
          else if (post.type === 'music') stage = state.pollsOf[post.id] === 1 ? 'writing-lyrics' : 'synthesizing';
          else stage = 'generating';
          send(200, { id: post.id, type: post.type, status: 'running', stage });
          return;
        }
        send(200, { id: post.id, type: post.type, status: 'ready', result_url: post.type === 'music' ? '/files/' + post.id + '.m4a' : '/files/' + post.id + '.png' });
        return;
      }

      const peaksM = req.url.match(/^\/files\/([^/]+)-peaks\.json$/);
      if (peaksM && req.method === 'GET') {
        if (peaksM[1].includes('nopeaks')) { res.writeHead(404, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify({ error: { code: 'not_found' } })); return; }
        const peaks = Array.from({ length: 160 }, (_, i) => 0.2 + 0.6 * Math.abs(Math.sin(i / 9)));
        // Контракт server-contract/README: объект {id, duration, peaks}; голый массив —
        // только для legacy-джоб: клиент обязан принимать обе формы (T-01).
        const body = peaksM[1].includes('legacy') ? peaks : { id: peaksM[1], duration: 187.4, peaks };
        res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
        res.end(JSON.stringify(body));
        return;
      }
      if (req.url.startsWith('/files/') && (req.url.includes('.m4a') || req.url.includes('.png') || req.url.includes('.wav'))) {
        if (req.url.includes('-cover.png')) {
          state.coverRequests++;
          if (state.coverRateLimit > 0) { state.coverRateLimit--; send(429, { error: { code: 'rate_limited' } }); return; }
        }
        const isWav = req.url.includes('.wav');
        const music = isWav || req.url.includes('.m4a');
        state.fileOrder.push(req.url);
        if (music) state.audioRequests++;
        else if (!req.url.includes('-cover.png')) state.photoRequests++;
        const current = state;
        current.activeFiles++;
        current.maxActiveFiles = Math.max(current.maxActiveFiles, current.activeFiles);
        let done = false;
        const release = () => { if (!done) { done = true; current.activeFiles--; } };
        res.on('close', release);
        // T-27: файлы из slowFiles висят вечно — слот очереди держит только
        // клиентский таймаут (#41: 90 с на первые байты); разрыв фиксируем
        // закрытием соединения.
        if (current.slowFiles.some(f => req.url.includes(f))) return;
        const finish = () => { release(); res.writeHead(200, { 'Content-Type': isWav ? 'audio/wav' : music ? 'audio/mp4' : 'image/png', ...cors }); res.end(isWav ? WAV : music ? M4A : PNG); };
        if (current.fileDelay) setTimeout(finish, current.fileDelay); else finish();
        return;
      }
      send(404, { error: { code: 'not_found', message: 'nf' } });
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

(async () => {
  const staticSrv = await staticServer(STATIC_PORT);
  const bff = await bffServer(BFF_PORT);
  const browser = await launch();
  const results = [];
  const ok = (name, data = {}) => { results.push({ name }); console.log('PASS', name, JSON.stringify(data)); };
  const errors = [];
  const URL_ = `http://127.0.0.1:${STATIC_PORT}/studio/index.html`;
  // Ожидание состояния Node-стороны мока (BFF-счётчики недоступны из страницы).
  async function waitForState(fn, { timeout = 15000, what = 'state' } = {}) {
    const started = Date.now();
    while (!fn(state)) {
      if (Date.now() - started > timeout) throw new Error('waitForState timeout: ' + what);
      await new Promise(r => setTimeout(r, 100));
    }
  }

  async function page({ viewport = { width: 1440, height: 1000 }, token = TOKEN, user = 'tester', objectUrls = false } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const p = await context.newPage();
    p.on('pageerror', e => errors.push(e.message));
    if (objectUrls) {
      // A12: считаем живые objectURL — обёртки стоят ДО скриптов страницы.
      await p.addInitScript(() => {
        window.__liveUrls = new Set();
        const create = URL.createObjectURL.bind(URL);
        URL.createObjectURL = blob => { const url = create(blob); window.__liveUrls.add(url); return url; };
        const revoke = URL.revokeObjectURL.bind(URL);
        URL.revokeObjectURL = url => { window.__liveUrls.delete(url); revoke(url); };
      });
    }
    const sessionScript = ({ t, port, user }) => {
      localStorage.setItem('briix-media-live-token', t);
      localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:' + port));
      if (user) { // предзаданная сессия v3: гейт входа пропускаем
        localStorage.setItem('briix-studio-profiles', JSON.stringify({ [user]: { pinHash: 'x', created: 0 } }));
        localStorage.setItem('briix-studio-user', user);
      }
    };
    if (token) await p.addInitScript(sessionScript, { t: token, port: BFF_PORT, user });
    else await p.addInitScript(({ port, user }) => {
      localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:' + port));
      if (user) {
        localStorage.setItem('briix-studio-profiles', JSON.stringify({ [user]: { pinHash: 'x', created: 0 } }));
        localStorage.setItem('briix-studio-user', user);
      }
    }, { port: BFF_PORT, user });
    await p.goto(URL_);
    await p.waitForSelector(user ? '#send' : '#gate');
    return p;
  }

  // #35 компакт: редкие контролы живут за панелями — открываем перед кликом.
  const openMore = async page => { if (!(await page.locator('#morePanel').isVisible())) await page.locator('#moreBtn').click(); };
  const openBurger = async page => { if (!(await page.locator('#profileMenu').isVisible())) await page.locator('#profileBtn').click(); };
  // #35 волна UX: продюсер переехал из «⋯»-панели в меню студии (бургер) —
  // точка входа «Подготовить песню» теперь там.
  const openProducer = async page => { await openBurger(page); await page.locator('#prepareMusic').click(); };


  // 1. Загрузка без ошибок, 2 фокуса (музыка — дефолт), чип наставников, состояния send.
  let p = await page();
  await p.waitForTimeout(300);
  assert.deepEqual(errors, [], 'no page errors on load');
  assert.equal(await p.locator('.mode').count(), 2, '#35: two focuses instead of three chats');
  assert.equal(await p.locator('.mode[data-mode="music"]').getAttribute('aria-pressed'), 'true', 'Создание музыки — default focus');
  assert.equal(await p.locator('#send').isDisabled(), true, 'send disabled on empty field');
  assert.equal(await p.locator('#assistantChip').isVisible(), true, 'assistant is a toolbar chip');
  // Единый диалог: 7 универсальных наставников + 3 музыкальные роли в одном меню.
  await p.locator('#assistantChip').click();
  assert.equal(await p.locator('#assistantMenu button').count(), 10, 'music focus has 7 universal mentors + 3 music roles');
  assert.match(await p.locator('#assistantMenu').innerText(), /Универсальный/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Маркетолог/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Наставник/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Продюсер/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Лирик/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Автор песни/);
  assert.equal(await p.locator('#assistantMenu button').first().evaluate(el => el === document.activeElement), true);
  await p.keyboard.press('ArrowDown');
  assert.equal(await p.locator('#assistantMenu button').nth(1).evaluate(el => el === document.activeElement), true);
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#assistantChip').evaluate(el => el === document.activeElement), true);
  assert.equal(await p.locator('#assistantMenu').isVisible(), false, 'Escape closes the menu');
  // Фото: 2 помощника, музыкальные чипы скрыты.
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#assistantChip').click();
  assert.equal(await p.locator('#assistantMenu button').count(), 2, 'photo has 2 assistants');
  assert.match(await p.locator('#assistantMenu').innerText(), /Арт-директор/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Визуальный дизайнер/);
  await p.keyboard.press('Escape');
  // #35 компакт: музыкальные контролы — за «⋯»-панелью; в фото её нет вовсе.
  assert.equal(await p.locator('#moreBtn').isVisible(), false, 'more panel is hidden outside music');
  await p.locator('.mode[data-mode="music"]').click();
  await openMore(p);
  assert.equal(await p.locator('#modelChip').isVisible(), true, 'model chip is available in the more panel (music)');
  assert.equal(await p.locator('#vocalSeg').isVisible(), true, 'track-mode segmented control is available in the more panel (music)');
  assert.equal(await p.locator('#tuneToggle').isVisible(), true, 'fine-tune toggle is available in the more panel (music)');
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#advanced').isVisible(), false, 'advanced fields hidden by default (Simple)');
  // Поле активно — send разблокируется.
  await p.locator('#prompt').fill('dream pop track');
  assert.equal(await p.locator('#send').isDisabled(), false, 'send enabled once the prompt is filled');
  assert.equal(await p.locator('#genTrack').isDisabled(), false, 'explicit Generate button enabled once the prompt is filled');
  await p.locator('#prompt').fill('');
  ok('loads clean, 2 focuses (music default), unified mentor menu, music toolbar', {});

  // 2. Инлайн-ввод ключа, когда хранилище пусто: по умолчанию — до закрытия
  //    вкладки (sessionStorage), чекбокс «запомнить» — в localStorage (T-42).
  p = await page({ token: '' });
  await p.locator('.mode[data-mode="music"]').click();
  await p.locator('#prompt').fill('привет');
  await p.locator('#send').click();
  await p.waitForSelector('#keyCard:not([hidden])');
  await p.locator('#keyInput').fill(TOKEN);
  await p.locator('#keySave').click();
  const stored = await p.evaluate(() => ({
    session: sessionStorage.getItem('briix-media-live-token-session'),
    local: localStorage.getItem('briix-media-live-token')
  }));
  assert.equal(stored.session, TOKEN, 'по умолчанию ключ — в sessionStorage (T-42)');
  assert.equal(stored.local, null, 'localStorage по умолчанию не трогаем');
  // «Запомнить на этом устройстве» — localStorage-путь.
  await p.locator('#profileBtn').click();
  await p.locator('#profileKeyBtn').click();
  await p.locator('#keyInput').fill(TOKEN);
  await p.locator('#keyRemember').check();
  await p.locator('#keySave').click();
  assert.equal(await p.evaluate(() => localStorage.getItem('briix-media-live-token')), TOKEN, 'чекбокс «запомнить» кладёт ключ в localStorage');
  ok('missing key shows inline card; sessionStorage by default, remember → localStorage (T-42)', {});

  // 3. Чат-стрим + inline-кнопка «Сделать из этого трек».
  p = await page();
  await p.locator('#prompt').fill('Вопрос про музыку');
  await p.locator('#send').click();
  await p.waitForFunction(() => document.querySelectorAll('.card.assistant .body').length &&
    document.querySelector('.card.assistant .body').textContent.includes('Стрим пришёл'), {}, { timeout: 15000 });
  assert.ok(state.chatPosts.at(-1).stream === true, 'chat went as SSE stream');
  assert.match(state.chatPosts.at(-1).messages[0].content, /система|Наставник|собеседник/i);
  assert.equal(await p.locator('.card.user').count(), 1);
  await p.waitForSelector('.card .action.make-track', { timeout: 5000 });
  ok('chat SSE stream lands in the feed with system prompt + make-track action', {});

  // 4. «Сделать из этого трек» → музыка с подставленным брифом.
  await p.locator('.card .action.make-track').click();
  assert.equal(await p.locator('.mode[data-mode="music"]').getAttribute('aria-pressed'), 'true', 'switched to music mode');
  assert.match(await p.locator('#prompt').inputValue(), /Стрим пришёл/, 'brief inserted into the music field');
  assert.match(await p.locator('#prompt').getAttribute('placeholder'), /Опишите трек/);
  ok('make-track switches to music with the brief prefilled', {});

  // 5. «Тонко настроить»: два поля, улучшение лирики (few-shot, non-stream, отмена).
  await p.locator('#prompt').fill('');
  await openMore(p); await p.locator('#tuneToggle').click();
  assert.equal(await p.locator('#advanced').isVisible(), true, 'advanced panel opens');
  assert.equal(await p.locator('#prompt').isVisible(), false, 'single field hides in advanced mode');
  assert.match(await p.locator('#lyrics').getAttribute('placeholder'), /Текст песни/);
  assert.equal(await p.locator('#improveLyrics').isDisabled(), true, 'improve disabled on empty lyrics');
  const originalLyrics = 'Город спит, а я не сплю';
  await p.locator('#lyrics').fill(originalLyrics);
  assert.equal(await p.locator('#improveLyrics').isDisabled(), false);
  await p.locator('#improveLyrics').click();
  await p.waitForFunction(() => document.getElementById('lyrics').value.includes('УЛУЧШЕННЫЙ ТЕКСТ'), {}, { timeout: 15000 });
  const improvePost = state.chatPosts.at(-1);
  assert.equal(improvePost.stream, false);
  assert.ok(Array.isArray(improvePost.messages) && improvePost.messages[0].role === 'system');
  const sys = improvePost.messages[0].content;
  assert.ok(/<example source=/.test(sys), 'system prompt carries few-shot examples');
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/data/creative-base.json'), 'utf8'));
  const exampleCount = (sys.match(/<example source=/g) || []).length;
  assert.equal(exampleCount, 5, 'exactly 5 few-shot examples');
  assert.ok(base.lyrics.some(l => sys.includes(l.text)), 'examples come from owner lyrics pool');
  assert.ok(improvePost.max_tokens <= 600);
  assert.equal(await p.locator('#undoLyrics').isVisible(), true);
  await p.locator('#undoLyrics').click();
  assert.equal(await p.locator('#lyrics').inputValue(), originalLyrics, 'undo restores original text');
  ok('lyrics improve: few-shot from creative-base, replace + undo, disabled when empty', { exampleCount });

  // 6. Структурные теги вставляются в лирику.
  await p.locator('#tags .tag[data-tag="[Chorus]"]').click();
  await p.locator('#tags .tag[data-tag="[Verse]"]').click();
  const tagged = await p.locator('#lyrics').inputValue();
  assert.match(tagged, /\[Chorus\]/);
  assert.match(tagged, /\[Verse\]/);
  ok('structure tags insert into lyrics field', { tagged: tagged.trim() });

  // 7. Музыка-джоба: лирика + стиль, длительность, инструментал по дефолту, Pro/вокал, стадии, плеер.
  await p.locator('#lyrics').fill('[Verse]\nГород спит\n[Chorus]\nА я не сплю');
  await p.locator('#musicPrompt').fill('dream pop, 90 BPM, female vocals');
  assert.equal(await p.locator('.seg-btn[data-vocal="0"]').getAttribute('aria-pressed'), 'true', 'vocal «Песня» is the default again (infra#79 fixed)');
  assert.equal(await p.locator('.seg-btn[data-vocal="1"]').getAttribute('aria-pressed'), 'false');
  await p.evaluate(() => {
    window.__stageSeen = [];
    new MutationObserver(muts => {
      for (const r of muts) {
        const el = r.target instanceof Element && r.target.matches('[data-wait]') ? r.target : null;
        const s = el?.getAttribute('data-wait-stage');
        if (s && !window.__stageSeen.includes(s)) window.__stageSeen.push(s);
      }
    }).observe(document.getElementById('feed'), { subtree: true, attributes: true, attributeFilter: ['data-wait-stage'] });
  });
  await p.locator('#send').click();
  await p.waitForSelector('.card.stage', { timeout: 10000 });
  // Фраза рядом со спиннером обязана заполниться (регресс: 404 на ../wait-ui.js молча убивал фразы).
  await p.waitForFunction(() => {
    const el = document.querySelector('.card.stage [data-wait]');
    return el && el.textContent.length > 5;
  }, {}, { timeout: 10000 });
  await p.waitForSelector('.stage-progress-label', { timeout: 5000 });
  assert.match(await p.locator('.stage-progress-label').innerText(), /этап:/i, 'progress bar label present');
  await p.waitForSelector('.card.assistant audio', { timeout: 20000 });
  // T-01: мок отдаёт пики объектом {id,duration,peaks} — волна обязана нарисоваться.
  await p.waitForSelector('.card.assistant .waveform-canvas', { timeout: 10000 });
  const seen = await p.evaluate(() => window.__stageSeen);
  assert.ok(seen.length >= 1, 'polling stages were shown: ' + seen.join(','));
  const musicPost = state.jobPosts.at(-1);
  assert.equal(musicPost.type, 'music');
  // Расширенный режим с ASCII-промтом: студия его НЕ переписывает (правило #109),
  // мозг v2 здесь не участвует — контракт остался прежним. Слоевая доводка
  // касается только путей, где промт собирает мозг (см. шаг 19 ниже).
  assert.equal(musicPost.prompt, 'dream pop, 90 BPM, female vocals',
    'advanced ASCII prompt is never rewritten by the brain');
  assert.match(musicPost.params.lyrics, /\[Chorus\]/);
  assert.equal(musicPost.params.model, 'ace-step-flash');
  assert.equal(musicPost.params.duration, undefined, 'duration must NOT be sent (infra#93: length follows lyrics)');
  assert.equal(musicPost.params.duration_seconds, undefined, 'legacy key must not be sent');
  assert.equal(musicPost.params.instrumental, undefined);
  // T-03: кириллическая лирика => params.language = ru (иначе bff поёт по-английски).
  assert.equal(musicPost.params.language, 'ru', 'cyrillic lyrics => params.language ru');
  // T-53: название — первая содержательная строка, а не структурный тег [Verse].
  assert.equal(musicPost.params.title, 'Город спит', 'title comes from a lyric line, not a [Verse] tag');
  // Pro через чип модели + снова инструментал (режим «Инструментал» выбран явно).
  await openMore(p); await p.locator('.seg-btn[data-vocal="1"]').click();
  assert.equal(await p.locator('.seg-btn[data-vocal="1"]').getAttribute('aria-pressed'), 'true', 'instrumental mode explicitly selected');
  await openMore(p); await p.locator('#modelChip').click();
  await p.locator('#modelMenu button', { hasText: 'Pro' }).click();
  assert.equal(await p.locator('#modelName').innerText(), 'Pro');
  await p.locator('#musicPrompt').fill('dream pop, 90 BPM, female vocals');
  await p.locator('#send').click();
  await p.waitForFunction(() => document.querySelectorAll('audio').length >= 2, {}, { timeout: 20000 });
  assert.equal(state.jobPosts.at(-1).params.model, 'ace-step-pro');
  assert.equal(state.jobPosts.at(-1).params.instrumental, true, 'instrumental mode adds the flag');
  assert.equal(state.jobPosts.at(-1).params.language, undefined, 'instrumental: no language field (no vocals)');
  const instSeen = await p.evaluate(() => window.__stageSeen);
  assert.ok(instSeen.includes('model-warmup') && instSeen.includes('generating'), 'instrumental stages model-warmup -> generating are shown (T-02)');
  // Вокал с английской лирикой: language=en по умолчанию (T-03).
  await openMore(p); await p.locator('.seg-btn[data-vocal="0"]').click();
  await p.locator('#lyrics').fill('[Verse]\nCity sleeps\n[Chorus]\nSo do I');
  await p.locator('#musicPrompt').fill('dream pop, 90 BPM');
  await p.locator('#send').click();
  await p.waitForFunction(() => document.querySelectorAll('audio').length >= 3, {}, { timeout: 25000 });
  assert.equal(state.jobPosts.at(-1).params.language, 'en', 'ASCII lyrics => params.language en (default)');
  assert.equal(state.jobPosts.at(-1).params.title, 'City sleeps', 'title from the first meaningful line');
  // T-51: эксклюзивный транспорт — одновременно играет не больше одного трека.
  const playing = await p.evaluate(() => [...document.querySelectorAll('audio')].filter(a => !a.paused).length);
  assert.ok(playing <= 1, 'exclusive audio transport: at most one track plays, got ' + playing);
  ok('music job: lyrics + style + instrumental/pro chips, stages, language/title params, exclusive player', {});

  // 8. Фото-джоба: превью в ленту.
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('neon city at night');
  await p.locator('#send').click();
  await p.waitForSelector('.card img.media-in', { timeout: 20000 });
  const photoPost = state.jobPosts.at(-1);
  assert.equal(photoPost.type, 'image');
  const natural = await p.locator('.card img.media-in').first().evaluate(img => img.naturalWidth);
  assert.ok(natural > 0, 'PNG preview actually decoded');
  ok('photo job renders decoded PNG preview', {});

  // 9. Модерация 422 в диалоге и в джобе: карточка + сохранение текста.
  state.chatBlocked = true;
  await p.locator('.mode[data-mode="music"]').click();
  // #35: после фото возвращаемся в music — в advanced (черновик секции 7) поле
  // один (#prompt скрыт); выключаем тонкую настройку, чтобы вернуть Simple-диалог.
  if (await p.locator('#advanced').isVisible()) { await openMore(p); await p.locator('#tuneToggle').click(); }
  const blockedText = 'запрещённый текст';
  await p.locator('#prompt').fill(blockedText);
  await p.locator('#send').click();
  await p.waitForSelector('.card.error', { timeout: 10000 });
  const errText = await p.locator('.card.error').last().innerText();
  assert.match(errText, /Не пройдена проверка контента/);
  assert.equal(await p.locator('#prompt').inputValue(), blockedText, 'blocked chat text kept in the field');
  state.chatBlocked = false;
  state.jobBlock = true;
  const errCount = await p.locator('.card.error').count();
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('запрещённая картинка');
  await p.locator('#send').click();
  await p.waitForFunction(n => document.querySelectorAll('.card.error').length > n, errCount, { timeout: 10000 });
  assert.equal(await p.locator('#prompt').inputValue(), 'запрещённая картинка', 'blocked job text kept in the field');
  state.jobBlock = false;
  ok('422 content_blocked: moderation card + text preserved (chat and jobs)', {});

  // 10. Кнопки-состояния: hover/active/disabled присутствуют в CSS.
  const css = fs.readFileSync(path.join(ROOT, 'studio', 'studio.css'), 'utf8');
  for (const sel of ['.send:hover', '.send:disabled', '.tool:hover', '.tag:hover', '.mode[aria-pressed="true"]', ':focus-visible']) {
    assert.ok(css.includes(sel), 'css defines state ' + sel);
  }
  assert.ok(css.includes('#d97757'), 'single accent color used');
  ok('interactive states defined in css (hover/active/disabled/focus + accent)', {});

  // 11. Параллельная лента: стрим в диалоге + джоба одновременно; ✕ в карточке гасит только свой поток.
  p = await page();
  state.chatSlow = true;
  state.chatSlowTick = 400; // #35: медленные операции конфигуратора делают обход длинным — стрим обязан пережить его
  await p.locator('#prompt').fill('останови меня');
  await p.locator('#prompt').press('Enter'); // Enter = отправка в чате
  await p.waitForSelector('.card.assistant .stream-stop, .card.assistant .wait-row .stage-stop', { timeout: 10000 });
  // Не дожидаясь конца стрима — запускаем фото-джобу (переключение режимов и генерация параллельно).
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('параллельный маяк');
  await p.locator('#send').click();
  await p.waitForSelector('.card.stage .stage-stop', { timeout: 10000 });
  // Пока ответ идёт, можно писать черновик, но второй ход ждёт завершения первого.
  await p.locator('.mode[data-mode="music"]').click();
  await p.locator('#prompt').fill('пока жду — ещё вопрос');
  if (process.env.BRIIX_DEBUG_11) {
    console.log('DBG11:', await p.evaluate(() => ({
      mode: document.querySelector('.mode[aria-pressed="true"]')?.dataset.mode,
      sendDisabled: document.getElementById('send').disabled,
      chatPendingHidden: document.getElementById('chatPending').hidden,
      waitRows: document.querySelectorAll('#feed .wait-row').length,
      streaming: document.querySelectorAll('#feed .card.assistant.streaming').length,
      bodies: [...document.querySelectorAll('#feed .card .body')].map(b => (b.textContent || '').slice(0, 30))
    })));
  }
  assert.equal(await p.evaluate(() => document.getElementById('send').disabled), true, 'second chat turn waits for current reply');
  assert.equal(await p.locator('#chatPending').isVisible(), true);
  // ✕ гасит только чат-стрим: джоба продолжает жить. Если ✕ пришёл до первого
  // слова стрима — карточка убирается вовсе (пустой ответ не висит), это тоже валидно.
  await p.locator('.card.assistant .stage-stop').first().click();
  await p.waitForFunction(() => {
    const note = document.querySelector('.card.assistant .stopped-note');
    const streaming = [...document.querySelectorAll('#feed .card.assistant')].some(c => c.classList.contains('streaming'));
    return Boolean(note) || !streaming;
  }, {}, { timeout: 10000 });
  assert.equal(await p.locator('#send').isDisabled(), false, 'chat draft can be sent after stopping reply');
  const stageStillThere = await p.locator('.card.stage').count();
  assert.equal(stageStillThere >= 1, true, 'job card survives chat stream stop');
  await p.waitForSelector('.card img.media-in', { timeout: 20000 }); // джоба завершилась успехом
  state.chatSlow = false; state.chatSlowTick = 0;
  ok('parallel feed: chat stream + job simultaneously, per-card stop kills only its own op', {});

  // 11b. Стоп поллинга джобы: ✕ на stage-карточке останавливает ожидание.
  p = await page();
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('стоп-маяк');
  // Джоба уже отправлена (jobId присвоен) — ✕ обязан отменить её и на сервере (T-05).
  const jobPosted = p.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/jobs', { timeout: 10000 });
  await p.locator('#send').click();
  await p.waitForSelector('.card.stage .stage-stop', { timeout: 10000 });
  await jobPosted;
  const cancelSent = p.waitForRequest(r => r.method() === 'POST' && /\/jobs\/[^/]+\/cancel$/.test(new URL(r.url()).pathname), { timeout: 10000 });
  await p.locator('.card.stage .stage-stop').click();
  await p.waitForSelector('.card.notice', { timeout: 10000 });
  assert.match(await p.locator('.card.notice').last().innerText(), /ожидание остановлено/i);
  await cancelSent;
  assert.ok(state.cancels.length >= 1, '✕ sends POST /jobs/{id}/cancel to the server (T-05)');
  ok('job polling stop via in-card ✕ cancels the job on the server, shows a notice, frees the composer', {});

  // 12. Новый чат сохраняет старый; его можно открыть через историю.
  await p.locator('.mode[data-mode="music"]').click();
  await openBurger(p); await p.locator('#newChat').click();
  await p.waitForFunction(() => document.querySelectorAll('#feed .session-feed:not([hidden]) .card').length === 0);
  await openBurger(p); await p.locator('#sessionsOpen').click();
  assert.equal(await p.locator('#sessionsList .session-item').count(), 2);
  await p.locator('#sessionsList .session-item').filter({ hasText: 'стоп-маяк' }).click();
  await p.waitForSelector('#feed .session-feed:not([hidden]) .card');
  assert.ok(await p.locator('#feed .session-feed:not([hidden]) .card').count() >= 1);
  ok('new chat preserves previous session', {});

  // 13. ✨ в Фото: арт-директор улучшает промпт, undo возвращает.
  await p.locator('.mode[data-mode="photo"]').click();
  const photoPrompt = 'кот в шляпе';
  await p.locator('#prompt').fill(photoPrompt);
  await p.locator('#improvePhoto').click();
  await p.waitForFunction(() => document.getElementById('prompt').value.includes('УЛУЧШЕННЫЙ ТЕКСТ'), {}, { timeout: 15000 });
  assert.equal(state.chatPosts.at(-1).stream, false, 'photo improve goes non-stream');
  assert.match(state.chatPosts.at(-1).messages[0].content, /Арт-директор/, 'photo improve uses the art-director system prompt');
  assert.equal(await p.locator('#undoPhoto').isVisible(), true);
  await p.locator('#undoPhoto').click();
  assert.equal(await p.locator('#prompt').inputValue(), photoPrompt, 'undo restores the prompt');
  ok('photo prompt improve via art-director + undo', {});

  // 14. Кнопка «Скачать» у готового фото.
  await p.locator('#prompt').fill('a lighthouse');
  await p.locator('#send').click();
  await p.waitForSelector('.card img.media-in', { timeout: 20000 });
  const dl = await p.locator('.card a.action[download]').last().getAttribute('download');
  assert.match(dl, /^briix-photo-.*\.png$/, 'download link carries a filename');
  ok('photo card carries a download link', { dl });

  // 15. Профиль-меню: ник, ключ через «Ключ доступа…», Escape закрывает меню.
  await p.locator('#profileBtn').click();
  await p.waitForSelector('#profileMenu:not([hidden])');
  assert.match(await p.locator('#profileNick').innerText(), /^tester$/, 'profile menu shows the nick');
  await p.locator('#profileKeyBtn').click();
  await p.waitForSelector('#keyCard:not([hidden])');
  assert.equal(await p.locator('#keyCard').isVisible(), true, 'key card opens from the profile menu');
  assert.match(await p.locator('#keyStatus').innerText(), /сохранён ✓/, 'key status line reflects saved state');
  assert.match(await p.locator('#profileKeyBtn').innerText(), /Ключ доступа ✓/, 'menu item marks the saved key');
  assert.equal(await p.locator('#profileMenu').isVisible(), false, 'menu closed after picking the item');
  await p.locator('#profileBtn').click();
  await p.waitForSelector('#profileMenu:not([hidden])');
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#profileMenu').isVisible(), false, 'Escape closes the profile menu');
  ok('profile menu: nick label, key card via menu item, Escape closes', {});

  // 16. Гейт входа: ник + PIN-пад, регистрация, сессия, выход, неверный PIN.
  p = await page({ user: '' });
  await p.waitForTimeout(200);
  assert.equal(await p.locator('#gate').isVisible(), true, 'gate shown without a session');
  assert.equal(await p.locator('#studio').isVisible(), false, 'studio hidden behind the gate');
  await p.locator('#nickInput').fill('owner');
  for (const digit of '1234') await p.locator(`.pk[data-digit="${digit}"]`).click();
  assert.equal(await p.locator('.pd.on').count(), 4, 'four pin dots lit');
  await p.locator('#enterBtn').click();
  await p.waitForSelector('#studio:not([hidden])');
  assert.equal(await p.locator('#profileNick').innerText(), 'owner');
  await p.reload();
  await p.waitForSelector('#studio:not([hidden])');
  assert.equal(await p.locator('#gate').isVisible(), false, 'session survives reload');
  await p.locator('#profileBtn').click();
  await p.waitForSelector('#profileMenu:not([hidden])');
  await p.locator('#profileLogoutBtn').click();
  // F-13: собственный диалог подтверждения вместо нативного confirm.
  await p.waitForSelector('.confirm-overlay:not([hidden])');
  await p.getByRole('button', { name: 'Выйти' }).click();
  await p.waitForSelector('#gate:not([hidden])');
  await p.locator('#nickInput').fill('owner');
  for (const digit of '9999') await p.locator(`.pk[data-digit="${digit}"]`).click();
  await p.locator('#enterBtn').click();
  await p.waitForFunction(() => document.getElementById('gateHint').textContent.includes('Неверный PIN'));
  ok('gate: nick+pinpad login, registration, session persistence, logout, wrong pin', {});

  // 17. Вкладки/библиотека: вокальный трек БЕЗ лирики (автолирика на свежей странице) и фото в библиотеке.
  resetBff(); // чистый список джобов для детерминированного мерджа библиотеки
  p = await page();
  // Вокальный джоб без лирики: автолирика обязана сработать на свежей странице (регресс null-controller).
  await p.locator('.mode[data-mode="music"]').click();
  await openMore(p); await p.locator('.seg-btn[data-vocal="0"]').click(); // явно выбрать «Песня» → вокальный трек
  assert.equal(await p.locator('.seg-btn[data-vocal="0"]').getAttribute('aria-pressed'), 'true');
  await p.locator('#prompt').fill('душевная песня про город');
  // Решение владельца 15.11: send в Simple-режиме = диалог; явная генерация — кнопка «Сгенерировать трек».
  await openMore(p); await p.locator('#genTrack').click();
  await p.waitForSelector('.card.assistant audio', { timeout: 25000 });
  const autoPost = state.jobPosts.at(-1);
  assert.equal(autoPost.params.instrumental, undefined, 'vocal job');
  assert.ok(String(autoPost.params.lyrics || '').length > 20, 'auto-lyrics wrote the lyrics on a fresh page');
  // Языковое правило #109: русская идея быстрого пути → ASCII английский промпт из brain-caption.
  assert.ok(/^[\x20-\x7E\r\n]*$/.test(autoPost.prompt), 'quick path: Russian idea -> ASCII English prompt');
  assert.ok(autoPost.prompt.length <= 640, 'brain caption prompt <= 640 chars (полный caption с 16.11)');
  assert.match(autoPost.prompt, /reverb|room|depth|perspective|distant/, 'depth layer reaches the model');
  // Ресёрч audits/limits: лирика и промт — разные поля, иначе модель поёт промт.
  assert.doesNotMatch(autoPost.prompt, /\[(?:verse|chorus|intro|bridge|outro)\]/i, 'prompt без секционных тегов');
  const lyricLine = String(autoPost.params.lyrics || '').split('\n').map(s => s.trim()).find(s => s.length > 12) || '';
  assert.ok(lyricLine && !autoPost.prompt.includes(lyricLine.slice(0, 20)), 'lyrics never leak into prompt');
  assert.match(autoPost.prompt, /\bvocals\b/);
  assert.match(autoPost.prompt, /English lyrics/, 'no language stated -> English lyrics tag (absence of a hint is not Russian)');
  assert.ok(!/Стрим|УЛУЧШЕННЫЙ/.test(autoPost.prompt), 'model chatter never leaks into params.prompt');
  assert.equal(autoPost.params.duration, undefined);
  assert.equal(autoPost.params.duration_seconds, undefined);
  // Не-ASCII идея переводится через producer-чат (abortable, ограниченный maxTokens) до submitJob.
  const translatePosts = state.chatPosts.filter(x => x.stream === false && x.max_tokens === 300);
  assert.ok(translatePosts.length >= 1, 'non-ASCII idea went through the producer-chat translation step');
  assert.match(translatePosts[0].messages[0].content, /Output ONLY the English prompt/i);
  // Второй джоб в advanced с ручной лирикой (для текста в библиотеке).
  await openMore(p); await p.locator('#tuneToggle').click();
  const libLyrics = '[Verse]\nГород спит\n[Chorus]\nА я не сплю';
  await p.locator('#lyrics').fill(libLyrics);
  await p.locator('#musicPrompt').fill('dream pop, 90 BPM');
  await p.locator('#send').click();
  await p.waitForFunction(() => document.querySelectorAll('audio').length >= 2, {}, { timeout: 25000 });
  // Фото-джоба.
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('a lighthouse in fog');
  await p.locator('#send').click();
  await p.waitForSelector('.card img.media-in', { timeout: 20000 });
  // Лента переживает перезагрузку (фид-журнал в localStorage).
  await p.reload();
  await p.waitForSelector('#studio:not([hidden])');
  await p.waitForSelector('.feed .card.user', { timeout: 10000 });
  const restored = await p.locator('#feed .card').count();
  assert.ok(restored >= 4, 'feed restored after reload: ' + restored + ' cards');
  assert.match(await p.locator('#feed .card.assistant .who').last().innerText(), /готов/i);
  await p.locator('.tab[data-tab="library"]').click();
  assert.equal(await p.locator('#lib').isVisible(), true, 'library tab opens');
  assert.equal(await p.locator('#composer').isVisible(), false, 'composer hidden in library');
  await p.waitForSelector('.lib-item', { timeout: 10000 });
  await p.waitForTimeout(300);
  assert.match(await p.locator('.lib-item .lib-prompt', { hasText: 'lighthouse' }).innerText(), /lighthouse/);
  // Музыкальная запись: модель в .who, подпись M4A, сворачиваемый текст песни.
  const musicItem = p.locator('.lib-item', { hasText: /Музыка/i }).first();
  // Карточки стали выше (заголовок F-18, таймкоды F-25) — музыкальная запись
  // может быть за складкой: скроллим к ней, как сделал бы читатель (обложки ленивые).
  await musicItem.scrollIntoViewIfNeeded();
  await musicItem.locator('.lib-cover img').waitFor({ state: 'visible', timeout: 10000 }); // обложка-миниатюра (infra#77)
  const musicWho = await musicItem.locator('.who').innerText();
  assert.match(musicWho, /flash/i, 'music .who carries the human model name (F-19)');
  assert.ok(!/ace-step/i.test(musicWho), 'no raw model ids in the library (F-19)');
  assert.ok(await musicItem.locator('.track-card').count() >= 1, 'library music card is the unified render (.track-card)');
  assert.ok(!(await musicItem.innerText()).includes('Слушать'), 'no Listen anywhere in the library card');
  assert.ok(!(await p.locator('#lib').innerText()).includes('Сессия неизвестна'), 'no unknown-session line');
  // Лирика доступна из меню «⋯» пунктом «Показать лирику».
  assert.equal(await musicItem.locator('.lib-lyrics-toggle').count(), 0, 'no separate lyrics row');
  await musicItem.locator('.menu-btn').click();
  await musicItem.locator('.track-menu:not([hidden]) button', { hasText: 'Показать лирику' }).click();
  await p.keyboard.press('Escape');
  const lyricsBlock = musicItem.locator('.lib-lyrics.open .lib-lyrics-text');
  assert.equal(await lyricsBlock.isVisible(), true, 'lyrics block opens from the menu');
  assert.match(await lyricsBlock.innerText(), /Город спит/, 'lyrics block carries the lyrics text');
  // F-18: название трека — видимый заголовок карточки (в ленте и в Библиотеке).
  assert.match(await musicItem.locator('.track-title').innerText(), /Город спит/, 'library card shows the track title as a heading (F-18)');
  assert.ok(await p.locator('.lib-item .photo-card').count() >= 1, 'library photo uses the unified photo card (R2/T-18)');
  // Единый рендер: каждая музыкальная карточка библиотеки — .track-card, старых строк нет.
  const libCheck = await p.evaluate(() => {
    const lib = document.getElementById('lib');
    const musicItems = [...document.querySelectorAll('.lib-item')].filter(d => d.querySelector('.track-card'));
    return {
      musicItems: musicItems.length,
      trackCards: document.querySelectorAll('.lib-item .track-card').length,
      listen: (lib.innerText.match(/Слушать/g) || []).length,
      unknown: (lib.innerText.match(/Сессия неизвестна/g) || []).length,
      lyricsRows: document.querySelectorAll('.lib-item .lib-lyrics-toggle').length
    };
  });
  assert.equal(libCheck.trackCards, libCheck.musicItems, 'every music library card is the unified render');
  assert.equal(libCheck.listen, 0, 'no Listen anywhere in the library');
  assert.equal(libCheck.unknown, 0, 'no unknown-session line anywhere in the library');
  assert.equal(libCheck.lyricsRows, 0, 'no separate lyrics rows in the library');
  await p.locator('.lib-filters .tag', { hasText: '★ Избранное' }).click();
  assert.equal(await p.locator('.lib-item').count(), 0, 'not a favorite yet');
  await p.locator('.lib-filters .tag', { hasText: 'Все' }).click();
  // T-36: клик ♥ — точечная мутация: тот же узел, без перекачки обложек и без лишнего GET /jobs.
  const favBtn = p.locator('.lib-item .action', { hasText: 'В избранное' }).first();
  await favBtn.evaluate(el => el.closest('.lib-item').setAttribute('data-t36', 'target'));
  const t36CoversBefore = state.coverRequests;
  const t36ListsBefore = state.jobsLists;
  await favBtn.click();
  await p.waitForSelector('.lib-item[data-t36="target"].fav', { timeout: 10000 });
  assert.equal(await p.locator('.lib-item[data-t36="target"].fav').count(), 1, 'the same card node was mutated in place (T-36)');
  assert.equal(state.coverRequests, t36CoversBefore, 'no cover re-fetch on favorite (T-36)');
  assert.equal(state.jobsLists, t36ListsBefore, 'no extra GET /jobs round-trip on favorite (T-36)');
  assert.ok(await p.locator('.lib-item.fav').count() >= 1, 'favorite applied');
  await p.locator('.lib-filters .tag', { hasText: '★ Избранное' }).click();
  assert.ok(await p.locator('.lib-item').count() >= 1, 'favorite filter shows it');
  await p.locator('.lib-filters .tag', { hasText: 'Все' }).click();
  const beforeDel = await p.locator('.lib-item').count();
  await p.locator('.lib-item .action', { hasText: 'Удалить' }).first().click();
  await p.waitForSelector('.confirm-overlay');
  assert.match(await p.locator('.confirm-dialog').innerText(), /Серверная запись будет удалена и на сервере/, 'серверное удаление объясняет последствия: DELETE на сервере (F-23)');
  await p.getByRole('button', { name: 'Удалить', exact: true }).click();
  await p.waitForFunction(n => document.querySelectorAll('.lib-item').length < n, beforeDel);
  await p.locator('.tab[data-tab="chat"]').click();
  assert.equal(await p.locator('#composer').isVisible(), true, 'chat tab restores composer');
  ok('library: entry from job, favorite toggle + filter, delete, tab switching', {});

  // T-41: общий ключ — чужие записи не показываются и не трогаются.
  resetBff();
  state.foreign = [
    { id: 'foreign-1', type: 'music', status: 'ready', prompt: 'чужой секретный трек', params: { artist: 'someone-else', model: 'ace-step-pro' }, result_url: '/files/foreign-1.m4a', cover_url: '', favorite: false, created_at: 1790000000 },
    { id: 'foreign-2', type: 'image', status: 'ready', prompt: 'чужое фото', params: { artist: 'someone-else' }, result_url: '/files/foreign-2.png', cover_url: '', favorite: false, created_at: 1790000001 }
  ];
  p = await page();
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('моё фото');
  await p.locator('#send').click();
  await p.waitForSelector('.card.assistant img', { timeout: 20000 });
  await p.locator('.tab[data-tab="library"]').click();
  await p.waitForSelector('.lib-results .lib-item');
  assert.equal(await p.locator('.lib-item').count(), 1, 'only the own photo is rendered');
  assert.equal(await p.locator('.lib-item', { hasText: 'чужой' }).count(), 0, 'foreign entries are not rendered');
  assert.equal(await p.locator('.lib-item', { hasText: 'чужое фото' }).count(), 0, 'foreign photos are not rendered');
  await p.waitForSelector('.lib-privacy:not([hidden])');
  assert.match(await p.locator('.lib-privacy').innerText(), /только ваши/i);
  assert.match(await p.locator('.lib-privacy').innerText(), /2/);
  assert.equal(state.jobPosts.at(-1).params?.artist, 'tester', 'photo job carries params.artist for attribution');
  assert.deepEqual(Object.keys(state.deleted), [], 'nothing foreign was deleted');
  assert.deepEqual(Object.keys(state.favs), [], 'nothing foreign was favorited');
  assert.equal(state.fileOrder.filter(u => u.includes('foreign')).length, 0, 'foreign files are never fetched');
  ok('library privacy: foreign /jobs entries hidden with an honest note, photo jobs attributed (T-41)', {});

  // 18. Мобильный 390×844: композер у низа, без горскролла, тач-таргеты ≥44.
  p = await page({ viewport: { width: 390, height: 844 } });
  await p.waitForTimeout(300);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, 'no horizontal scroll at 390px, overflow=' + overflow);
  const geo = await p.evaluate(() => {
    // #35 компакт: вкладки переехали в шапку — к низу прижат композер
    const wrap = document.querySelector('.composer-wrap').getBoundingClientRect();
    const sizes = [...document.querySelectorAll('button, textarea, input')]
      .filter(el => el.offsetParent !== null && !el.closest('[hidden]'))
      .map(el => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height));
    return { bottomGap: window.innerHeight - Math.round(wrap.bottom), minTarget: Math.min(...sizes.filter(s => s > 0)) };
  });
  assert.ok(geo.bottomGap >= 0 && geo.bottomGap <= 16, 'composer pinned to viewport bottom (tabs moved to header), gap=' + geo.bottomGap);
  assert.ok(geo.minTarget >= 44, 'smallest touch target >= 44px, got ' + geo.minTarget);
  await p.screenshot({ path: path.join(require('node:os').tmpdir(), 'studio-390.png'), fullPage: false });
  // Музыка на мобайле: тулбар не ломается.
  await p.locator('.mode[data-mode="music"]').click();
  await openMore(p); await p.locator('#tuneToggle').click();
  const overflow2 = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow2 <= 0, 'no h-scroll in music advanced at 390px, overflow=' + overflow2);
  await p.screenshot({ path: path.join(require('node:os').tmpdir(), 'studio-390-music.png'), fullPage: false });
  ok('mobile 390x844: composer sticky bottom, no h-scroll, touch targets >=44', { ...geo });

  // 18b. F-35/F-36/F-37 — мобайл глубже: клавиатура, ландшафт, 320px без обрезки.
  // F-35: meta даёт Android-уменьшение вьюпорта, visualViewport-подстраховка — iOS.
  const kbMeta = await p.evaluate(() => document.querySelector('meta[name="viewport"]').content);
  assert.match(kbMeta, /interactive-widget=resizableViewport/, 'F-35: viewport содержит interactive-widget=resizableViewport');
  // #35: режима «Чат» больше нет — для чистого замера уходим из advanced в Simple.
  if (await p.locator('#advanced').isVisible()) { await openMore(p); await p.locator('#tuneToggle').click(); }
  const lift = await p.evaluate(() => {
    const send = document.getElementById('send');
    const composer = document.getElementById('composer');
    const feed = document.getElementById('feed');
    const studio = document.querySelector('.studio');
    const padPx = s => parseFloat(getComputedStyle(s).paddingBottom) || 0;
    const padY = s => { const cs = getComputedStyle(s); return (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0); };
    const compHBefore = composer.getBoundingClientRect().height;
    const feedHBefore = feed.getBoundingClientRect().height;
    const padBefore = padPx(studio);
    const before = send.getBoundingClientRect().bottom;
    const kb = window.__syncKbInset({ height: window.innerHeight - 260, offsetTop: 0 });
    const after = send.getBoundingClientRect().bottom;
    const compShrink = compHBefore - composer.getBoundingClientRect().height;
    const feedShrink = feedHBefore - feed.getBoundingClientRect().height;
    const padDelta = padPx(studio) - padBefore;
    const css = getComputedStyle(document.documentElement).getPropertyValue('--kb-inset').trim();
    // Низ композера выше линии клавиатуры — главный UX-инвариант F-35.
    const aboveKb = after <= window.innerHeight - kb + 2;
    window.__syncKbInset(window.visualViewport); // вернуть как было
    return { kb, lifted: before - after, css, aboveKb, padDelta,
      compShrink: Math.round(compShrink * 10) / 10,
      feedShrink: Math.round(feedShrink * 10) / 10,
      feedPadY: Math.round(padY(feed)) };
  });
  // F-35 (факты CI #35, правка-2, из red-рана PR #38): kb=260, padding каркаса
  // применяет inset ровно (8→268), но send поднимается на 240: недостающие ~20px
  // — это СОБСТВЕННЫЙ padding ленты (#feed: 12+16px на ≤480px, studio.css:362/67):
  // лента — единственный упругий элемент каркаса и не может сжаться ниже своего
  // padding (border-box), остальное пространство отдаёт композеру. Величина
  // зависит от media-ветки, не от шрифтов/среды.
  // Семантика ассерта (констант нет — всё измерено из того же DOM):
  //  1) inset применён: kb = 260, --kb-inset = 260px, padDelta = 260;
  //  2) цепочка сходится: сдвиг send = padDelta − усадка ленты − усадка композера;
  //  3) пол подъёма: send поднялся не меньше, чем kb минус несжимаемый padding
  //     ленты (грубый UX-инвариант: даже при упоре ленты композер очищает
  //     клавиатуру на всё, кроме её собственного padding);
  //  4) низ композера выше линии клавиатуры (aboveKb).
  const KB = 260;
  assert.equal(lift.kb, KB, 'F-35: высота клавиатуры измерена');
  assert.equal(lift.padDelta, KB, 'F-35: inset применён в padding каркаса ровно на kb');
  assert.equal(lift.css, KB + 'px', 'F-35: --kb-inset проставлен');
  assert.ok(Math.abs(lift.lifted - (lift.feedShrink - lift.compShrink)) <= 1.5,
    'F-35: цепочка сходится — сдвиг send = усадка ленты минус усадка композера (±1.5px): сдвиг '
    + Math.round(lift.lifted) + ', лента ' + lift.feedShrink + ', композер ' + lift.compShrink);
  assert.ok(lift.padDelta - lift.feedShrink <= lift.feedPadY,
    'F-35: лента отдала всё, кроме собственного padding: остаток ' + Math.round(lift.padDelta - lift.feedShrink)
    + ' из padding ленты ' + lift.feedPadY + 'px');
  assert.ok(lift.lifted >= KB - lift.feedPadY,
    'F-35: композер очистил клавиатуру минус несжимаемый padding ленты: сдвиг ' + Math.round(lift.lifted)
    + ' из ' + KB + ' (padding ленты ' + lift.feedPadY + 'px)');
  assert.equal(lift.aboveKb, true, 'F-35: низ композера выше линии клавиатуры');
  await p.close();
  ok('keyboard lifts the composer: interactive-widget + visualViewport fallback (F-35)', lift);

  // F-36: ландшафт 844×390 — мета-полоса со статусом видна, тач-таргеты ≥44
  // (брейкпоинт по pointer:coarse, а не по ширине ≤480px).
  const landCtx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const lp = await landCtx.newPage();
  lp.on('pageerror', e => errors.push(e.message));
  await lp.addInitScript(({ t, port, user }) => {
    localStorage.setItem('briix-media-live-token', t);
    localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:' + port));
    localStorage.setItem('briix-studio-profiles', JSON.stringify({ [user]: { pinHash: 'x', created: 0 } }));
    localStorage.setItem('briix-studio-user', user);
  }, { t: TOKEN, port: BFF_PORT, user: 'tester' });
  await lp.goto(URL_);
  await lp.waitForSelector('#send');
  await lp.locator('.mode[data-mode="music"]').click();
  const land = await lp.evaluate(() => {
    const meta = document.querySelector('.meta');
    const small = [...document.querySelectorAll('button')].filter(e => e.offsetParent !== null && !e.closest('[hidden]'))
      .map(e => ({ t: e.textContent.trim().slice(0, 18), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) }))
      .filter(r => r.w < 44 || r.h < 44);
    return {
      metaVisible: !!meta && meta.offsetHeight > 0 && getComputedStyle(meta).display !== 'none',
      status: document.getElementById('status').textContent,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      small
    };
  });
  assert.ok(land.metaVisible, 'F-36: мета-полоса видна в ландшафте (раньше display:none прятал #status)');
  assert.equal(land.status, 'готов');
  assert.ok(land.overflow <= 0, 'F-36: без горскролла в ландшафте');
  assert.deepEqual(land.small, [], 'F-36: тач-таргеты ≥44px в ландшафте (pointer:coarse): ' + JSON.stringify(land.small));
  await landCtx.close();
  ok('landscape 844x390: status meta visible, coarse-pointer targets >=44 (F-36)', { small: land.small.length });

  // F-37: 320px — короткие лейблы без обрезки, полный смысл в aria-label,
  // пояснение продюсера видно.
  p = await page({ viewport: { width: 320, height: 568 } });
  await p.locator('.mode[data-mode="music"]').click();
  await p.locator('#prompt').fill('ночной джаз для двоих');
  // #35 компакт: на 320px редкие контролы открываются в «⋯»-панели — проверяем
  // её содержимое: полные лейблы без обрезки, панель в кадре.
  // #35 волна UX: продюсер больше не в «⋯» — его пояснение проверяем в бургере.
  await openMore(p);
  const narrow = await p.evaluate(() => {
    const panel = document.getElementById('morePanel');
    const visible = el => !!el && el.offsetParent !== null;
    const chips = [...document.querySelectorAll('.tool.chip')].filter(e => visible(e) && !e.closest('[hidden]'))
      .map(e => ({ t: (e.innerText || e.textContent).trim(), cut: e.scrollWidth > e.clientWidth + 1 }));
    const gen = document.getElementById('genTrack');
    const send = document.getElementById('send').getBoundingClientRect();
    return {
      chips,
      genFull: chips.some(c => c.t === 'Сгенерировать трек'),
      genAria: gen.getAttribute('aria-label'),
      sendVisible: send.bottom <= window.innerHeight && send.top >= 0,
      panelFits: panel.getBoundingClientRect().right <= window.innerWidth + 1,
      producerInMorePanel: !!document.querySelector('#morePanel #prepareMusic'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  assert.ok(narrow.overflow <= 0, 'F-37: без горскролла на 320px');
  assert.deepEqual(narrow.chips.filter(c => c.cut), [], 'F-37: ни один чип не обрезан: ' + JSON.stringify(narrow.chips));
  assert.ok(narrow.genFull, 'F-37: на 320px кнопка генерации — полный лейбл (панель не жмёт)');
  assert.ok(narrow.panelFits, 'F-37: «⋯»-панель не выходит за экран на 320px');
  assert.equal(narrow.genAria, 'Сгенерировать трек', 'F-37: полный смысл — в aria-label');
  assert.ok(narrow.sendVisible, 'F-37: кнопка отправки в кадре на 320px');
  assert.equal(narrow.producerInMorePanel, false, '#35 волна UX: продюсера больше нет в «⋯»-панели');
  await openBurger(p);
  const prod = await p.evaluate(() => {
    const visible = el => !!el && el.offsetParent !== null;
    const hint = document.getElementById('producerHint');
    const btn = document.getElementById('prepareMusic');
    return {
      prepareAria: btn.getAttribute('aria-label'),
      producerHintVisible: visible(hint),
      producerDescribedBy: btn.getAttribute('aria-describedby')
    };
  });
  assert.equal(prod.prepareAria, 'Подготовить песню', 'F-37: aria-label продюсера не зависит от ширины');
  assert.ok(prod.producerHintVisible, 'F-37: пояснение продюсера видно на 320px (в меню студии)');
  assert.equal(prod.producerDescribedBy, 'producerHint', 'F-37: кнопка продюсера связана с пояснением');
  ok('mobile 320x568: short chip labels + full aria, producer hint visible (F-37)', { chips: narrow.chips.length });
  await p.close();


  // Регресс: после reload в запрос действительно уходит восстановленный контекст.
  resetBff();
  p = await page();
  await p.locator('#prompt').fill('Первый вопрос для контекста');
  await p.locator('#send').click();
  await p.waitForSelector('.make-track');
  await p.reload();
  await p.locator('#prompt').fill('Второй вопрос');
  await p.locator('#send').click();
  await p.waitForFunction(() => document.querySelectorAll('.make-track').length >= 2);
  const lastChat = state.chatPosts.at(-1).messages;
  assert.ok(lastChat.some(m => m.role === 'user' && m.content === 'Первый вопрос для контекста'));
  assert.ok(lastChat.some(m => m.role === 'assistant' && m.content.includes('Первый вопрос для контекста')));
  ok('completed chat context survives reload');

  // Черновики режимов не подменяют друг друга.
  p = await page();
  await p.locator('#prompt').fill('черновик чата');
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('черновик фото');
  await p.locator('.mode[data-mode="music"]').click();
  assert.equal(await p.locator('#prompt').inputValue(), 'черновик чата');
  await p.locator('.mode[data-mode="photo"]').click();
  assert.equal(await p.locator('#prompt').inputValue(), 'черновик фото');
  ok('mode drafts remain separate');

  // Настройки фиксируются до автолирики, даже если пользователь меняет их во время ожидания.
  resetBff();
  state.chatSlow = true;
  state.coverRateLimit = 1;
  p = await page();
  await p.locator('.mode[data-mode="music"]').click();
  await p.locator('#prompt').fill('Песня о море');
  await openMore(p); await p.locator('#genTrack').click();
  await p.waitForSelector('.card.stage .stage-stop');
  await openMore(p); await p.locator('#modelChip').click();
  await p.locator('#modelMenu button', { hasText: 'Pro' }).click();
  await openMore(p); await p.locator('.seg-btn[data-vocal="1"]').click();
  await p.waitForSelector('.card.assistant audio', { timeout: 30000 });
  const frozen = state.jobPosts.at(-1);
  assert.equal(frozen.params.model, 'ace-step-flash');
  assert.equal(frozen.params.duration, undefined, 'duration is not sent');
  assert.equal(frozen.params.instrumental, undefined);
  assert.match(await p.locator('.card.assistant .who').last().innerText(), /Flash/i);
  await p.waitForSelector('.card.assistant .track-cover img', { timeout: 10000 });
  assert.ok(state.coverRequests >= 2, 'cover recovered from HTTP 429');
  state.chatSlow = false;
  ok('music snapshot and server artwork survive settings changes');

  // Серверная + локальная запись не дублируется, реальное скачивание не вызывает рекурсию.
  await p.locator('.tab[data-tab="library"]').click();
  await p.waitForSelector('.lib-item .lib-cover img', { timeout: 10000 });
  assert.equal(await p.locator('.lib-item').count(), 1, 'one merged record per job');
  assert.equal(await p.locator('.lib-item .lib-cover').count(), 1, 'one thumbnail per track');
  assert.equal(await p.locator('.lib-item .track-cover').count(), 0, 'no duplicate full-size cover in library');
  // Скачивание теперь в меню «⋯» (отдельной кнопки в единой карточке нет).
  const downloadPromise = p.waitForEvent('download');
  await p.locator('.lib-item .menu-btn').first().click();
  await p.locator('.track-menu:not([hidden]) button', { hasText: 'Скачать аудио (M4A)' }).first().click();
  const downloaded = await downloadPromise;
  assert.match(downloaded.suggestedFilename(), /\.m4a$/);
  assert.match(downloaded.suggestedFilename(), / - tester\.m4a$/, 'library download uses the unified «Title - Artist» name (F-22)');
  ok('merged library, artwork and actual file download');


  state.favoriteFail = true;
  await p.locator('.lib-item .menu-btn').first().click();
  await p.locator('.track-menu:not([hidden]) button', { hasText: 'В избранное' }).first().click();
  await p.waitForSelector('.lib-error');
  assert.equal(await p.locator('.lib-item.fav').count(), 0, 'failed server mutation is not shown as success');
  state.favoriteFail = false;
  ok('library reports failed favorite without corrupting state');

  // Помощник не перезаписывает текст, изменённый пока запрос был в пути.
  resetBff();
  state.improveDelay = 500;
  p = await page();
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('Первый вариант');
  await p.locator('#improvePhoto').click();
  await p.locator('#prompt').fill('Мои новые правки');
  await p.waitForSelector('.card.notice', { timeout: 5000 });
  assert.equal(await p.locator('#prompt').inputValue(), 'Мои новые правки');
  assert.match(await p.locator('.card.notice').last().innerText(), /УЛУЧШЕННЫЙ ТЕКСТ/);
  ok('late improvement preserves newer edits');

  // T-24: выход при живом стриме — явный диалог «остановить и выйти / остаться»,
  // а не тихий отказ карточкой в скрытой ленте (A20).
  resetBff(); state.chatSlow = true;
  p = await page();
  await p.locator('#prompt').fill('Долгий ответ');
  await p.locator('#send').click();
  await p.waitForSelector('.card.assistant .stage-stop');
  await p.locator('#profileBtn').click();
  await p.locator('#profileLogoutBtn').click();
  await p.waitForSelector('.confirm-overlay');
  await p.getByRole('button', { name: 'Выйти' }).click(); // F-13: свой диалог вместо confirm
  await p.waitForSelector('#opsOverlay:not([hidden])');
  assert.match(await p.locator('#opsText').innerText(), /ответ наставника/, 'диалог называет живые операции');
  assert.equal(await p.locator('#studio').isVisible(), true, 'после «Остаться» студия на месте');
  await p.locator('#opsStay').click();
  await p.waitForSelector('#opsOverlay', { state: 'hidden' });
  assert.equal(await p.locator('#studio').isVisible(), true, '«Остаться» закрывает диалог и не выходит');
  // «Остановить и выйти»: стрим гасится, профиль закрывается без потери данных.
  await p.locator('#profileBtn').click();
  await p.locator('#profileLogoutBtn').click();
  await p.waitForSelector('.confirm-overlay');
  await p.getByRole('button', { name: 'Выйти' }).click();
  await p.waitForSelector('#opsOverlay:not([hidden])');
  await p.locator('#opsStopLogout').click();
  await p.waitForSelector('#gate:not([hidden])', { timeout: 10000 });
  assert.equal(await p.locator('#gate').isVisible(), true, '«Остановить и выйти» завершает сессию');
  state.chatSlow = false;
  ok('logout with live ops: explicit stop-and-leave dialog (T-24, A20)');

  // F-06/A10 (T-20): смена сессии во время стрима — ввод в новой сессии свободен,
  // индикатор в шапке ведёт к занятой сессии, стрим можно остановить оттуда.
  resetBff(); state.chatSlow = true;
  p = await page();
  await p.locator('#prompt').fill('стрим в первой сессии');
  await p.locator('#send').click();
  await p.waitForSelector('.card.assistant .stage-stop');
  await openBurger(p); await p.locator('#sessionsOpen').click();
  await p.locator('#sessionsNew').click();
  await p.waitForSelector('#sessionsOverlay', { state: 'hidden' });
  await p.locator('#prompt').fill('вопрос из новой сессии');
  assert.equal(await p.locator('#send').isDisabled(), false, 'новая сессия не заблокирована стримом старой (F-06)');
  assert.equal(await p.locator('#chatPending').isVisible(), false, 'подсказка «дождитесь ответа» не висит в чужой сессии');
  await p.waitForSelector('#opsBadge:not([hidden])');
  assert.match(await p.locator('#opsBadge').innerText(), /ответ наставника/, 'бейдж называет операцию другой сессии');
  await p.locator('#opsBadge').click(); // вернуться к сессии со стримом
  await p.waitForSelector('.card.assistant .stage-stop');
  await p.locator('.card.assistant .stage-stop').click();
  await p.waitForSelector('#opsBadge', { state: 'hidden' });
  state.chatSlow = false;
  ok('session-bound busy: stream in A does not block B; header badge jumps to the busy session (T-20/F-06)');


  // Библиотека: миниатюры и аудио делят очередь, а не грузят все файлы одновременно.
  resetBff(); state.fileDelay = 150;
  state.jobPosts = Array.from({ length: 8 }, (_, i) => ({ id: 'job-seeded-' + i, type: 'music', prompt: 'Трек ' + i, params: { model: 'ace-step-flash' } }));
  p = await page({ viewport: { width: 320, height: 568 } });
  await p.locator('.tab[data-tab="library"]').click();
  await p.waitForSelector('.lib-item .lib-cover img', { timeout: 10000 });
  assert.equal(await p.locator('.lib-item').count(), 8);
  const libraryLayout = await p.evaluate(() => {
    const item = document.querySelector('.lib-item');
    const cover = item.querySelector('.lib-cover').getBoundingClientRect();
    const content = item.querySelector('.lib-main').getBoundingClientRect();
    return { documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      filterHeight: document.querySelector('.lib-filters').getBoundingClientRect().height,
      cardOverflow: item.scrollWidth - item.clientWidth, coverRight: cover.right, contentLeft: content.left };
  });
  assert.ok(libraryLayout.documentOverflow <= 0 && libraryLayout.cardOverflow <= 0, 'library fits narrow viewport');
  assert.ok(libraryLayout.filterHeight >= 44, 'filters remain visible and touchable on a long list');
  assert.ok(libraryLayout.coverRight <= libraryLayout.contentLeft, 'thumbnail is to the left of content');
  await p.screenshot({ path: path.join(require('node:os').tmpdir(), 'studio-library-320.png') });
  await p.locator('.lib-item').last().scrollIntoViewIfNeeded();
  await p.waitForSelector('.lib-item:last-child .lib-cover img', { timeout: 10000 });
  assert.ok(state.maxActiveFiles <= 2, 'media queue max concurrency is 2, got ' + state.maxActiveFiles);
  ok('narrow library layout and bounded media queue', { maxActiveFiles: state.maxActiveFiles });

  // A restored long history never fetches audio until a user asks for it.
  resetBff(); state.fileDelay = 250;
  p = await page({ viewport: { width: 320, height: 568 } });
  await p.evaluate(async () => {
    const { profile, backend } = await BriixSessionStore.open('tester');
    profile.sessions[0].feed = Array.from({ length: 100 }, (_, i) => ({
      // legacy-джобы: мок отдаёт им пики ГОЛЫМ МАССИВОМ — обе формы контракта должны работать (T-01).
      t: 'media', who: 'Трек ' + i, kind: 'music', job: 'legacy-' + i, file: '/files/shared.m4a'
    }));
    await BriixSessionStore.save(profile, profile.revision, backend);
  });
  await p.reload();
  await p.waitForFunction(() => document.querySelectorAll('#feed .track-cover').length === 100);
  // Обложка = PLAY и в restore-карточке: до загрузки файла запросов аудио нет.
  const coversBefore = await p.evaluate(() => [...document.querySelectorAll('#feed .track-cover')].every(f => f.classList.contains('playable')));
  assert.equal(coversBefore, true, 'restored covers are PLAY buttons right away');
  // Волна из peaks.json строится сразу при карточке, до загрузки аудио;
  // повторных запросов пиков нет — кэш (T-37).
  await p.waitForFunction(() => document.querySelectorAll('#feed .waveform-canvas').length === 100, {}, { timeout: 15000 });
  await p.waitForTimeout(500);
  assert.equal(state.audioRequests, 0, 'restored history does not fetch 100 audio files');
  await p.evaluate(() => [...document.querySelectorAll('#feed .track-cover')].slice(0, 2).forEach(f => f.click()));
  await p.waitForFunction(() => document.querySelectorAll('#feed audio').length === 2);
  assert.equal(state.audioRequests, 1, 'same in-flight audio request is deduplicated');
  assert.equal(await p.locator('#feed audio').first().getAttribute('controlslist'), 'nodownload');
  ok('100 restored tracks: zero audio requests until action, deduplicated transfer');

  resetBff(); state.fileDelay = 100;
  state.jobPosts = Array.from({ length: 100 }, (_, i) => ({ id: 'library-' + i, type: 'music', prompt: 'Трек ' + i, params: {} }));
  p = await page({ viewport: { width: 320, height: 568 } });
  await p.locator('.tab[data-tab="library"]').click();
  await p.waitForFunction(() => document.querySelectorAll('.lib-item').length === 100);
  await p.waitForTimeout(500);
  assert.equal(state.audioRequests, 0, 'library does not fetch audio merely for being visible');
  let attemptedAudio = 0;
  await p.route('**/files/*.m4a', route => {
    attemptedAudio++;
    return attemptedAudio === 1 ? route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': `http://127.0.0.1:${STATIC_PORT}` } }) : route.continue();
  });
  // Ленивая загрузка — кликом по обложке-мини (PLAY); «Слушать» в библиотеке больше нет.
  assert.equal(await p.locator('.lib-item .media-load').count(), 0, 'no Listen button in the library');
  await p.locator('.lib-item .lib-cover.playable').first().click();
  await p.waitForSelector('.lib-item .load-error', { timeout: 15000 });
  await p.locator('.lib-item .lib-cover.playable').first().click(); // повтор тем же PLAY
  await p.locator('.lib-item audio').first().waitFor();
  assert.equal(attemptedAudio, 2, 'failed audio is explicitly retried via the cover');
  assert.equal(state.audioRequests, 1, 'explicit retry loads one audio file');
  assert.ok(state.maxActiveFiles <= 2, 'all authenticated file transfers share the bound');
  ok('100 library tracks: lazy audio and bounded transfers');

  resetBff();
  // #35: сценарий ленивой загрузки гоняем на десктоп-вьюпорте — композер
  // музыкального фокуса выше старого чата, на 320px окно ленты сжимается до
  // полоски (известный долг компоновки v2, см. audits/task-35-ui-v2-w1.md).
  p = await page();
  await p.evaluate(async () => {
    const { profile, backend } = await BriixSessionStore.open('tester');
    profile.sessions[0].feed = Array.from({ length: 100 }, (_, i) => ({
      t: 'media', who: 'Изображение ' + i, kind: 'photo', file: '/files/photo-' + i + '.png'
    }));
    await BriixSessionStore.save(profile, profile.revision, backend);
  });
  await p.reload();
  await p.waitForFunction(() => document.querySelectorAll('#feed .card.assistant').length === 100);
  await p.waitForTimeout(1200);
  assert.ok(state.photoRequests > 0 && state.photoRequests < 100, 'only near-viewport restored images are requested: ' + state.photoRequests);
  ok('restored image history loads near the viewport', { requests: state.photoRequests });

  resetBff(); state.fileDelay = 800;
  p = await page({ viewport: { width: 390, height: 1200 } });
  await p.evaluate(async () => {
    const { profile, backend } = await BriixSessionStore.open('tester');
    profile.sessions[0].feed = [
      { t: 'media', who: 'Аудио', kind: 'music', file: '/files/priority.m4a' },
      ...Array.from({ length: 12 }, (_, i) => ({ t: 'media', who: 'Фото', kind: 'photo', file: '/files/priority-' + i + '.png' }))
    ];
    await BriixSessionStore.save(profile, profile.revision, backend);
  });
  await p.reload();
  await p.locator('#feed .track-cover').waitFor();
  await p.waitForTimeout(250);
  assert.equal(state.photoRequests, 2, 'two image transfers occupy the slots');
  await p.evaluate(() => document.querySelector('#feed .track-cover').click());
  await p.locator('#feed audio').waitFor({ state: 'attached', timeout: 10000 });
  const audioIdx = state.fileOrder.findIndex(u => u.includes('priority.m4a'));
  assert.ok(audioIdx >= 0 && audioIdx <= 2, 'user audio takes priority over queued images (position ' + audioIdx + ')');
  assert.ok(state.maxActiveFiles <= 2);
  await p.context().close();
  ok('interactive audio is prioritized over queued image transfers');

  // Polling retries safe GETs after temporary throttling, without resubmitting a job.
  resetBff(); state.pollFailures = [429, 503];
  p = await page();
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('Проверка временной ошибки');
  await p.locator('#send').click();
  await p.waitForSelector('.card img.media-in', { timeout: 25000 });
  assert.equal(state.jobPosts.length, 1, 'POST is never automatically retried');
  assert.equal(state.pollAttempts, 5, 'two temporary errors followed by three status requests');
  ok('429 and 503 polling recovers without duplicate generation');

  // Узкий и низкий экран: оба измерения видимых кнопок и отсутствие горизонтального переполнения.
  p = await page({ viewport: { width: 320, height: 568 } });
  await p.locator('.mode[data-mode="music"]').click();
  await openMore(p); await p.locator('#tuneToggle').click();
  const small = await p.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    send: document.getElementById('send').getBoundingClientRect().toJSON(),
    viewHeight: window.innerHeight,
    smallButtons: [...document.querySelectorAll('button')].filter(e => e.offsetParent !== null && !e.closest('[hidden]'))
      .map(e => ({ text: e.textContent.trim(), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }))
      .filter(r => r.w < 44 || r.h < 44)
  }));
  assert.ok(small.overflow <= 0, 'no overflow at 320px');
  assert.ok(small.send.bottom <= small.viewHeight && small.send.top >= 0, 'send visible in short viewport');
  assert.deepEqual(small.smallButtons, [], 'visible mobile buttons meet both 44px dimensions');
  ok('mobile 320x568 advanced controls remain accessible');

  // Вход с существующими legacy-данными: миграция, backup, возврат и контекст.
  resetBff();
  {
    const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
    const legacy = await context.newPage();
    legacy.on('pageerror', e => errors.push(e.message));
    const oldFeed = [{ t: 'user', who: 'Вы', text: 'Старый запрос' }, { t: 'assistant', who: 'Наставник', text: 'Старый ответ', track: 'Старый ответ' }];
    const oldHistory = [{ role: 'user', content: 'Старый запрос' }, { role: 'assistant', content: 'Старый ответ' }];
    await legacy.addInitScript(({ port, token, oldFeed, oldHistory }) => {
      localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:' + port));
      localStorage.setItem('briix-media-live-token', token);
      localStorage.setItem('briix-studio-user', 'legacy');
      localStorage.setItem('briix-studio-profiles', JSON.stringify({ legacy: { pinHash: 'x', created: 0 } }));
      if (!localStorage.getItem('briix-studio-feed-legacy')) localStorage.setItem('briix-studio-feed-legacy', JSON.stringify(oldFeed));
      if (!localStorage.getItem('briix-studio-history-legacy')) localStorage.setItem('briix-studio-history-legacy', JSON.stringify(oldHistory));
    }, { port: BFF_PORT, token: TOKEN, oldFeed, oldHistory });
    await legacy.goto(URL_);
    await legacy.getByText('Старый ответ').waitFor();
    await openBurger(legacy); await legacy.locator('#newChat').click();
    await legacy.waitForFunction(() => document.querySelectorAll('#feed .session-feed:not([hidden]) .card').length === 0);
    await legacy.locator('#prompt').fill('Новая идея'); await legacy.locator('#send').click();
    await legacy.waitForSelector('#feed .session-feed:not([hidden]) .make-track');
    await openBurger(legacy); await legacy.locator('#sessionsOpen').click();
    await legacy.locator('#sessionsList .session-item').filter({ hasText: 'Старый запрос' }).click();
    await legacy.getByText('Старый ответ').waitFor({ state: 'visible' });
    await legacy.locator('#prompt').fill('После миграции'); await legacy.locator('#send').click();
    await legacy.waitForFunction(() => [...document.querySelectorAll('#feed .session-feed:not([hidden]) .make-track')].length >= 2);
    assert.ok(state.chatPosts.at(-1).messages.some(m => m.content === 'Старый ответ'));
    const retained = await legacy.evaluate(() => [localStorage.getItem('briix-studio-feed-legacy'), localStorage.getItem('briix-studio-history-legacy')]);
    assert.deepEqual(retained, [JSON.stringify(oldFeed), JSON.stringify(oldHistory)]);
    await context.close();
  }
  ok('legacy feed and context migrate through studio without altering source keys');

  // Два диалога, результат генерации после переключения, возврат и контекст после reload.
  resetBff();
  p = await page({ viewport: { width: 390, height: 844 } });
  await p.locator('#prompt').fill('Идея первой сессии');
  await p.locator('#send').click();
  await p.waitForSelector('.make-track');
  await p.locator('.mode[data-mode="music"]').click();
  await openMore(p); await p.locator('.seg-btn[data-vocal="1"]').click();
  const fullPrompt = 'Музыкальная идея ' + 'ритм '.repeat(70);
  await p.locator('#prompt').fill(fullPrompt);
  await openMore(p); await p.locator('#genTrack').click();
  await p.locator('.mode[data-mode="music"]').click();
  await openBurger(p); await p.locator('#newChat').click();
  await p.waitForFunction(() => document.querySelectorAll('#feed .session-feed:not([hidden]) .card').length === 0);
  await p.locator('#prompt').fill('Вторая сессия');
  await p.locator('#send').click();
  await p.waitForSelector('#feed .session-feed:not([hidden]) .make-track');
  await p.waitForSelector('#feed .session-feed[hidden] audio', { state: 'attached', timeout: 25000 });
  assert.equal(await p.locator('#feed .session-feed:not([hidden]) audio').count(), 0, 'late track does not leak into active session');
  await p.locator('.tab[data-tab="library"]').click();
  const linkedItem = p.locator('.lib-item', { hasText: 'Сессия: Идея первой сессии' }).first();
  await linkedItem.locator('.menu-btn').click();
  await linkedItem.locator('.track-menu:not([hidden]) button', { hasText: 'Открыть сессию: Идея первой сессии' }).click();
  await p.waitForSelector('#feed .session-feed:not([hidden]) audio');
  assert.ok(await p.locator('#feed .session-feed:not([hidden])').innerText().then(t => t.includes('Идея первой сессии')));
  await p.reload();
  await p.locator('#feed .session-feed:not([hidden]) .track-cover').click();
  await p.waitForSelector('#feed .session-feed:not([hidden]) audio', { timeout: 15000 });
  await p.locator('#prompt').fill('Продолжение первой');
  await p.locator('#send').click();
  await p.waitForFunction(() => [...document.querySelectorAll('#feed .session-feed:not([hidden]) .make-track')].length >= 2);
  const sessionContext = state.chatPosts.at(-1).messages;
  assert.ok(sessionContext.some(m => m.content === 'Идея первой сессии'));
  assert.ok(!sessionContext.some(m => m.content === 'Вторая сессия'));
  const savedTrack = await p.evaluate(async () => {
    const { profile } = await BriixSessionStore.open('tester');
    return profile.sessions.flatMap(s => s.feed).find(item => item.kind === 'music');
  });
  assert.equal(savedTrack.input.prompt, fullPrompt.trim(), 'full sent prompt is saved without truncation');
  await openBurger(p); await p.locator('#sessionsOpen').click();
  await p.locator('#sessionsList .session-item').filter({ hasText: 'Вторая сессия' }).click();
  await p.waitForSelector('#sessionsOverlay[hidden]', { state: 'attached' });
  await p.waitForSelector('#feed .session-feed:not([hidden]) .card.user');
  assert.match(await p.locator('#feed .session-feed:not([hidden])').innerText(), /Вторая сессия/);
  assert.equal(await p.locator('#feed .session-feed:not([hidden]) audio').count(), 0);
  ok('two sessions keep context and late track isolated, linked in library after reload');

  // Повтор использует полный снимок и не отправляет запрос до явного подтверждения; обложка — отдельное изображение.
  resetBff();
  // Языковое правило #109: повтор правится в поле, но в модель уходит английская
  // сборка. Чат-заглушка отвечает готовым английским переводом (как producer-чат).
  state.chatImproveText = 'long musical idea, rhythmic, atmospheric';
  p = await page();
  await p.locator('.mode[data-mode="music"]').click();
  await openMore(p); await p.locator('.seg-btn[data-vocal="1"]').click();
  const repeatPrompt = ('длинная музыкальная идея '.repeat(15)).trim();
  await p.locator('#prompt').fill(repeatPrompt); await openMore(p); await p.locator('#genTrack').click();
  await p.waitForSelector('#feed audio', { timeout: 25000 });
  assert.equal(state.jobPosts.length, 1);
  // «Повторить с правками» теперь в едином меню «⋯» карточки трека.
  await p.locator('#feed .card.assistant .menu-btn').first().click();
  await p.locator('.track-menu:not([hidden]) button', { hasText: 'Повторить с правками' }).first().click();
  assert.equal(state.jobPosts.length, 1, 'no generation before confirmation');
  assert.equal(await p.locator('#musicPrompt').inputValue(), repeatPrompt, 'repeat pre-fills the ORIGINAL idea for editing');
  await p.locator('#musicPrompt').fill(repeatPrompt + ' новая версия');
  await p.locator('#send').click();
  await p.waitForFunction(() => document.querySelectorAll('#feed audio').length === 2, {}, { timeout: 25000 });
  assert.equal(state.jobPosts.length, 2);
  // Отредактированная не-ASCII идея переводится, brain-теги дедуплицируются.
  // #20: мозг v2 докладывает ритм-слой и продакшн даже инструменталу —
  // проверяем свойства (перевод во главе, теги не дублируются, лимит 640).
  const repeatPost = String(state.jobPosts[1].prompt);
  assert.ok(repeatPost.startsWith('long musical idea, rhythmic, atmospheric'), 'translation stays at the head');
  assert.match(repeatPost, /\binstrumental\b/, 'instrumental marker kept');
  assert.match(repeatPost, /groove|beat|drum/, 'v2 brain adds a rhythm layer for instrumentals too');
  assert.equal((repeatPost.match(/atmospheric/g) || []).length, 1, 'brain tags deduped against the translation');
  assert.ok(repeatPost.length <= 640, 'brain prompt stays within MAX_CAPTION');
  const linked = await p.evaluate(async () => {
    const { profile } = await BriixSessionStore.open('tester');
    return profile.sessions[0].feed.filter(x => x.kind === 'music').map(x => ({ job: x.job, parent: x.input.parentJobId }));
  });
  assert.equal(linked[1].parent, linked[0].job, 'repeat records source without overwriting original');
  await p.locator('#feed .card.assistant .menu-btn').first().click();
  await p.locator('.track-menu:not([hidden]) button', { hasText: 'Создать обложку' }).first().click();
  assert.match(await p.locator('.card.notice').last().innerText(), /не заменит обложку/);
  await p.locator('#prompt').fill('Обложка в неоновом стиле'); await p.locator('#send').click();
  await p.waitForSelector('#feed img.media-in', { timeout: 25000 });
  assert.equal(state.jobPosts[2].type, 'image');
  assert.equal(state.jobPosts[2].prompt, 'Обложка в неоновом стиле');
  assert.equal(await p.locator('#feed audio').count(), 2, 'cover image did not replace the audio');
  ok('editable text repeat and separate cover image, without pretending to remix or replace artwork');

  // F-20 (A15): серверный трек без локальной сессии — повтор не затирает черновик
  // пустотой, честно предупреждает о сокращённом промпте и подставляет модель записи.
  resetBff();
  p = await page();
  await p.evaluate(() => {
    // Серверная запись в библиотеке: сессии с таким job нет → input = {}.
    localStorage.setItem('briix-studio-library-tester', JSON.stringify([{
      job: 'job-foreign-1', kind: 'music', server: true, prompt: 'серверная короткая версия промпта',
      lyrics: '', model: 'ace-step-pro', instrumental: true, inputComplete: false,
      title: 'Чужой трек', file: '/files/job-foreign-1.m4a', cover: '', created: Date.now(), fav: false
    }]));
  });
  await p.locator('.mode[data-mode="music"]').click();
  await p.locator('#prompt').fill('мой текущий английский промпт, который я берегу');
  await p.locator('.tab[data-tab="library"]').click();
  await p.waitForSelector('.lib-item');
  await p.locator('.lib-item .menu-btn').first().click();
  await p.locator('.track-menu:not([hidden]) button', { hasText: 'Повторить с правками' }).first().click();
  // F-13: первый диалог — честный объём данных сервера (F-20).
  await p.waitForSelector('.confirm-overlay');
  assert.match(await p.locator('.confirm-dialog').innerText(), /только промпт \(33 зн\./, 'диалог честно называет объём данных сервера');
  await p.getByRole('button', { name: 'Продолжить' }).click();
  // Второй диалог — замена текущего черновика пользователя.
  await p.waitForSelector('.confirm-overlay');
  assert.match(await p.locator('.confirm-dialog').innerText(), /заменён данными этого трека/, 'диалог предупреждает о замене черновика');
  await p.getByRole('button', { name: 'Заменить' }).click();
  await p.waitForFunction(() => document.querySelector('#musicPrompt')?.value.includes('серверная короткая'));
  assert.equal(await p.locator('#musicPrompt').inputValue(), 'серверная короткая версия промпта', 'поля заполнены промптом серверной записи (F-20)');
  assert.match(await p.locator('#modelName').innerText(), /Pro/, 'модель переключена на запись сервера (ace-step-pro)');
  ok('repeat from server record: honest prompt-size confirm, no empty-draft wipe (F-20/A15)');

  // T-22: бэкап «✨ Улучшить» привязан к сессии — undo в сессии B не подставит
  // текст из сессии A (доказательство аудита: принял черновик в A → перешёл в B →
  // «↩ Вернуть как было» писал в поле B текст из A).
  resetBff(); state.chatImproveText = 'улучшенный вариант для сессии A';
  p = await page();
  // Лента непуста — иначе «Новый чат» не создаст вторую сессию (guard newChat).
  await p.locator('#prompt').fill('вопрос для наполнения ленты');
  await p.locator('#send').click();
  await p.waitForSelector('#feed .card.assistant');
  await p.locator('.mode[data-mode="music"]').click();
  await openMore(p); await p.locator('#tuneToggle').click(); // advanced: поля стиль/лирика
  await p.locator('#musicPrompt').fill('исходный стиль сессии A');
  await p.locator('#improvePrompt').click();
  await p.waitForFunction(() => document.querySelector('#musicPrompt')?.value === 'улучшенный вариант для сессии A', {}, { timeout: 15000 });
  assert.equal(await p.locator('#undoPrompt').isVisible(), true, 'в сессии A доступен возврат');
  // Новая сессия: своих бэкапов нет, кнопка возврата скрыта, поля не тронуты.
  await openBurger(p); await p.locator('#sessionsOpen').click();
  await p.locator('#sessionsNew').click();
  await p.waitForSelector('#sessionsOverlay', { state: 'hidden' });
  await p.locator('.mode[data-mode="music"]').click();
  await openMore(p); await p.locator('#tuneToggle').click();
  await p.locator('#musicPrompt').fill('свой стиль сессии B');
  assert.equal(await p.locator('#undoPrompt').isHidden(), true, 'в сессии B нет чужой кнопки возврата (T-22)');
  // Возврат в A: undo всё ещё знает исходный текст сессии A.
  await openBurger(p); await p.locator('#sessionsOpen').click();
  await p.locator('#sessionsList .session-item').filter({ hasText: 'вопрос для наполнения ленты' }).first().click();
  await p.waitForSelector('#sessionsOverlay', { state: 'hidden' });
  await p.locator('#undoPrompt').click();
  assert.equal(await p.locator('#musicPrompt').inputValue(), 'исходный стиль сессии A', 'undo возвращает текст своей сессии (T-22)');
  ok('session-bound undo backup: no cross-session restore (T-22)');

  // T-33: ход чата не хранит ответ дважды — track стал флагом, а не копией текста.
  resetBff();
  p = await page();
  await p.locator('#prompt').fill('расскажи длинно про хранение');
  await p.locator('#send').click();
  await p.waitForFunction(() => document.querySelectorAll('#feed .card.assistant').length >= 1
    && ![...document.querySelectorAll('#feed .card.assistant')].some(c => c.classList.contains('streaming')), {}, { timeout: 15000 });
  // Ждём коммита записи приложения (write-гонка IDB), иначе читается старая ревизия.
  let chatStored = null;
  for (let i = 0; i < 30 && chatStored?.track !== true; i++) {
    chatStored = await p.evaluate(async () => {
      const { profile } = await BriixSessionStore.open('tester');
      const s = profile.sessions[0];
      const entry = s.feed.find(x => x.t === 'assistant');
      return entry ? { track: entry.track, textLen: entry.text.length, history: s.history.length } : null;
    });
    if (chatStored?.track !== true) await p.waitForTimeout(500);
  }
  assert.equal(chatStored?.track, true, 'T-33: track — флаг, копия текста не хранится');
  assert.ok(chatStored.textLen > 10 && chatStored.history >= 2, 'текст и история на месте');
  // Restore после перезагрузки: кнопка «Сделать из этого трек» берёт text, не копию.
  await p.reload();
  await p.waitForSelector('#feed .card.assistant .make-track', { timeout: 10000 });
  ok('chat turn stored once (track flag), make-track survives reload (T-33)', chatStored);

  // F-33: черновик композера пишется на вводе — без смены сессии и перезагрузки.
  p = await page();
  await p.locator('#prompt').fill('черновик, который не должен потеряться');
  await p.waitForTimeout(700); // дебаунс 400 мс
  const draftSaved = await p.evaluate(async () => {
    const { profile } = await BriixSessionStore.open('tester');
    const s = profile.sessions.find(x => x.draft?.prompts?.music === 'черновик, который не должен потеряться');
    return !!s;
  });
  assert.equal(draftSaved, true, 'F-33: черновик сохранён дебаунсом на вводе');
  // T-29: beforeunload не липнет без записи в полёте (раньше — навсегда после сбоя).
  const sticky = await p.evaluate(() => {
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  assert.equal(sticky, false, 'T-29: системный диалог закрытия не вешается в покое');
  ok('composer draft auto-saves on input; beforeunload is not sticky (F-33/T-29)');

  // T-28: конфликт ревизий — диалог выбора, а не липкая плашка.
  resetBff();
  p = await page();
  await p.locator('#prompt').fill('вопрос до конфликта');
  await p.locator('#send').click();
  await p.waitForFunction(() => document.querySelectorAll('#feed .card.assistant').length >= 1
    && ![...document.querySelectorAll('#feed .card.assistant')].some(c => c.classList.contains('streaming')), {}, { timeout: 15000 });
  await p.evaluate(async () => {
    // «Другая вкладка» пишет с той же ревизией — ревизия приложения просрочена.
    const { profile } = await BriixSessionStore.open('tester');
    profile.sessions[0].title = 'Изменено в другой вкладке';
    await BriixSessionStore.save(profile, profile.revision, 'idb');
  });
  await p.locator('#prompt').fill('вопрос после конфликта');
  await p.locator('#send').click();
  await p.waitForSelector('.card.notice', { timeout: 15000 });
  assert.match(await p.locator('.card.notice').last().innerText(), /конфликт вкладок/i, 'T-28: конфликт показан диалогом выбора');
  await p.getByRole('button', { name: 'Заменить своей версией' }).click();
  await p.waitForFunction(() => ![...document.querySelectorAll('.card.notice')].some(c => /Конфликт вкладок/.test(c.textContent || '')), {}, { timeout: 15000 });
  const resolved = await p.evaluate(async () => {
    const { profile } = await BriixSessionStore.open('tester');
    const s = profile.sessions[0];
    return { title: s.title, feed: s.feed.length, questions: s.feed.filter(x => x.t === 'user').length };
  });
  assert.equal(resolved.title, 'вопрос до конфликта', 'наша версия перезаписала чужую (T-28)');
  assert.equal(resolved.questions, 2, 'оба вопроса сохранились после решения конфликта');
  ok('revision conflict resolves via explicit choice (T-28)');

  // Контролируемый 429-шторм: считаем реальные попытки и восстановленные карточки в mock.
  resetBff(); state.coverRateLimit = 4;
  state.jobPosts = Array.from({ length: 4 }, (_, i) => ({ id: 'job-storm-' + i, type: 'music', prompt: 'Шторм ' + i, params: { model: 'ace-step-flash' } }));
  p = await page();
  await p.locator('.tab[data-tab="library"]').click();
  await p.waitForFunction(() => document.querySelectorAll('.lib-cover img').length === 4, {}, { timeout: 30000 });
  assert.equal(await p.locator('.lib-cover img').count(), 4);
  assert.equal(state.coverRequests, 8, 'four failed attempts plus four successful cover fetches');
  ok('mock 429 storm: four failures, eight attempts, four covers recovered', { requests: state.coverRequests, recovered: 4 });
  resetBff(); state.coverRateLimit = 4;
  state.jobPosts = [{ id: 'job-limit', type: 'music', prompt: 'Ошибка лимита', params: { model: 'ace-step-flash' } }];
  p = await page(); await p.locator('.tab[data-tab="library"]').click();
  await p.waitForSelector('.lib-cover .cover-retry', { timeout: 20000 });
  assert.match(await p.locator('.cover-retry').getAttribute('aria-label'), /429/);
  assert.equal(state.coverRequests, 4);
  await p.locator('.cover-retry').click();
  await p.waitForSelector('.lib-cover img', { timeout: 10000 });
  assert.equal(state.coverRequests, 5);
  ok('mock persistent 429: visible retry recovers cover after limit clears', { failed: 4, recovered: 1 });

  // Сохранённые URL не могут заставить отправить ключ на чужой origin, даже через redirect.
  p = await page();
  let foreignRequests = 0, redirectRequests = 0, traversalRequests = 0;
  let redirectUrl = '', redirectHeader = '';
  p.on('request', request => {
    if (request.url().startsWith('http://127.0.0.1:19877/')) foreignRequests++;
    if (request.url().endsWith('/steal')) traversalRequests++;
    if (request.url().endsWith('/files/redirect-test')) { redirectRequests++; redirectUrl = request.url(); redirectHeader = request.headers().authorization; }
  });
  await p.route(`http://127.0.0.1:${BFF_PORT}/files/redirect-test`, route => route.fulfill({
    status: 302, headers: { Location: 'http://127.0.0.1:19877/steal', 'Access-Control-Allow-Origin': `http://127.0.0.1:${STATIC_PORT}` }
  }));
  await p.evaluate(async () => {
    const { profile, backend } = await BriixSessionStore.open('tester');
    profile.sessions[0].feed.push(
      { t: 'media', who: 'Чужой адрес', kind: 'photo', file: 'http://127.0.0.1:19877/steal' },
      { t: 'media', who: 'Переадресация', kind: 'photo', file: '/files/redirect-test' },
      { t: 'media', who: 'Обход', kind: 'photo', file: '/files/../steal' }
    );
    await BriixSessionStore.save(profile, profile.revision, backend);
  });
  await p.reload();
  await p.waitForFunction(() => [...document.querySelectorAll('#feed .card .body')].filter(x => x.textContent.includes('Файл недоступен')).length === 3);
  assert.equal(redirectRequests, 1, 'trusted URL was requested');
  assert.equal(redirectHeader, 'Bearer ' + TOKEN, 'token is sent only in the authorization header');
  assert.ok(!redirectUrl.includes(TOKEN), 'token is not embedded in the URL');
  assert.equal(foreignRequests, 0, 'neither foreign URL nor redirect target was requested');
  assert.equal(traversalRequests, 0, 'relative traversal outside /files was not requested');
  ok('file fetch blocks foreign origins, traversal and redirects without URL credentials');

  // Opt-in producer: review, preservation, no implicit music job, and restoration.
  resetBff();
  state.chatImproveText = JSON.stringify({ title: 'Огни', prompt: 'dream pop, 72 BPM, no guitar', lyrics: '[Verse]\nГород засыпает' });
  p = await page({ viewport: { width: 390, height: 844 } });
  await p.locator('.mode[data-mode="music"]').click();
  const idea = 'Песня о собаке на французском, 72 BPM, без гитары';
  await p.locator('#prompt').fill(idea);
  await openProducer(p);
  await p.locator('.producer-draft').first().waitFor();
  assert.equal(state.jobPosts.length, 0, 'preparing does not start audio generation');
  assert.equal(await p.locator('#prompt').inputValue(), idea, 'original input is not overwritten');
  assert.match(state.chatPosts[0].messages[1].content, /собаке/);
  assert.equal(await p.locator('.producer-warning').first().isVisible(), true);
  const review = p.locator('.producer-draft').first();
  // #41: черновик — только чтение: полей ввода в карточке нет, значения — строки.
  assert.equal(await review.locator('input, textarea').count(), 0, 'в карточке нет полей редактирования (#41)');
  assert.match(await review.locator('.draft-read-plain .draft-read-value').innerText(), /Огни/, 'название — строка для чтения');
  assert.ok((await review.getByRole('button', { name: 'Копировать' }).count()) >= 2, 'у строк есть копирование в буфер (#41)');
  await review.locator('.draft-read .draft-read-label').filter({ hasText: 'Лирика' }).click(); // развернуть строку (клик по метке — не по «Копировать»)
  assert.match(await review.locator('.draft-read[open] .draft-read-full').first().innerText(), /Город засыпает/, 'лирика читается после разворота');
  await review.getByRole('button', { name: 'Принять в поля' }).click();
  await p.waitForFunction(() => document.querySelector('#musicPrompt').value === 'dream pop, 72 BPM, no guitar');
  assert.equal(await p.locator('#lyrics').inputValue(), '[Verse]\nГород засыпает');
  assert.equal(state.jobPosts.length, 0, 'accepting does not start audio generation');
  assert.ok(await review.getByRole('button', { name: 'Сгенерировать трек' }).isVisible(), 'producer draft has the same Generate action as the mentor draft (F-11)');
  // #41: правки — в «Тонко настроить» (композер), не в карточке; автосохранение F-33 переживает перезагрузку.
  await p.locator('#lyrics').fill('[Verse]\nMa propre chanson');
  await p.waitForTimeout(700); // debounce автосохранения (400 мс)
  await p.reload();
  await p.locator('.producer-draft').first().waitFor();
  assert.equal(await p.locator('#lyrics').inputValue(), '[Verse]\nMa propre chanson', 'правка из композера пережила перезагрузку');
  assert.equal(await p.locator('#musicPrompt').inputValue(), 'dream pop, 72 BPM, no guitar');
  // F-13: возврат — через собственный диалог; Escape = отмена без действий.
  await p.getByRole('button', { name: 'Вернуть как было' }).first().click();
  await p.waitForSelector('.confirm-overlay');
  await p.keyboard.press('Escape');
  await p.waitForSelector('.confirm-overlay', { state: 'detached' });
  assert.equal(await p.locator('#musicPrompt').inputValue(), 'dream pop, 72 BPM, no guitar', 'Escape отменяет возврат');
  await p.getByRole('button', { name: 'Вернуть как было' }).first().click();
  await p.waitForSelector('.confirm-overlay');
  await p.getByRole('button', { name: 'Вернуть', exact: true }).click();
  await p.waitForFunction(() => !document.querySelector('#prompt').hidden);
  assert.equal(await p.locator('#prompt').inputValue(), idea);
  assert.equal(state.jobPosts.length, 0);
  ok('producer mobile: read-only review/apply/restore; edits live in the composer (#41), no implicit audio job');

  // Existing authored lyrics are sent as context but never replaced by the LLM.
  resetBff(); state.chatImproveText = JSON.stringify({ title: 'Моё', prompt: 'jazz piano', lyrics: 'другая лирика' });
  p = await page(); await p.locator('.mode[data-mode="music"]').click(); await openMore(p); await p.locator('#tuneToggle').click();
  await p.locator('#musicPrompt').fill('джаз по моей лирике');
  await p.locator('#lyrics').fill('Моя собственная строка');
  await openProducer(p); await p.locator('.producer-draft').waitFor();
  assert.match(await p.locator('.producer-draft .draft-read summary').filter({ hasText: 'Лирика' }).innerText(), /Моя собственная строка/, 'авторская лирика — в строке чтения (#41)');
  assert.match(state.chatPosts[0].messages[1].content, /Моя собственная строка/);
  await p.locator('#lyrics').fill('Новая правка в ожидании');
  await p.getByRole('button', { name: 'Принять в поля' }).click();
  await p.waitForSelector('.confirm-overlay');
  await p.getByRole('button', { name: 'Отменить' }).click(); // F-13: отмена в своём диалоге
  await p.waitForSelector('.confirm-overlay', { state: 'detached' });
  assert.equal(await p.locator('#lyrics').inputValue(), 'Новая правка в ожидании');
  await p.getByRole('button', { name: 'Принять в поля' }).click();
  await p.waitForSelector('.confirm-overlay');
  await p.getByRole('button', { name: 'Заменить', exact: true }).click();
  await p.waitForFunction(() => document.querySelector('#lyrics').value === 'Моя собственная строка');
  await p.locator('.producer-idea summary').click();
  assert.match(await p.locator('.producer-idea').innerText(), /Новая правка в ожидании/);
  ok('producer keeps authored lyrics and guards newer edits with recoverable backup');

  // Instrumental, incorrect JSON and moderation leave the source untouched.
  resetBff(); state.chatImproveText = JSON.stringify({ title: 'Рассвет', prompt: 'ambient synth', lyrics: '' });
  p = await page(); await p.locator('.mode[data-mode="music"]').click(); await openMore(p); await p.locator('.seg-btn[data-vocal="1"]').click();
  await p.locator('#prompt').fill('инструментал без вокала'); await openProducer(p);
  await p.locator('.producer-draft').waitFor();
  assert.equal(await p.locator('.producer-draft .draft-read summary').filter({ hasText: 'Лирика' }).count(), 0, 'у инструментала строки лирики нет (#41)');
  await p.getByRole('button', { name: 'Принять в поля' }).click();
  await p.waitForFunction(() => document.querySelector('#musicPrompt').value === 'ambient synth');
  await openMore(p); await p.locator('#genTrack').click(); await p.waitForSelector('#feed audio', { timeout: 25000 });
  assert.equal(state.jobPosts[0].params.instrumental, true);
  assert.equal(state.jobPosts[0].params.duration, undefined);
  ok('instrumental review and explicit generation, no duration parameter');
  resetBff(); state.chatImproveText = '{broken';
  p = await page(); await p.locator('.mode[data-mode="music"]').click(); await p.locator('#prompt').fill('Сохранить идею');
  await openProducer(p); await p.getByText('Ответ для ручного восстановления').waitFor();
  assert.equal(await p.locator('#prompt').inputValue(), 'Сохранить идею');
  assert.equal(await p.locator('.producer-draft').count(), 0);
  state.chatBlocked = true; await openProducer(p);
  await p.locator('.card.error', { hasText: 'Модерация' }).waitFor();
  assert.equal(await p.locator('#prompt').inputValue(), 'Сохранить идею');
  ok('malformed response and moderation preserve original');

  // Cancellation and a parallel chat must not modify the originating music input.
  resetBff(); state.improveDelay = 1200;
  state.chatImproveText = JSON.stringify({ title: 'Песня', prompt: 'jazz', lyrics: 'слова' });
  p = await page(); await p.locator('.mode[data-mode="music"]').click(); await p.locator('#prompt').fill('Отменяемая идея');
  await openProducer(p);
  await p.getByRole('button', { name: 'Отменить подготовку песни' }).click();
  await p.getByText('Подготовка отменена').waitFor();
  assert.equal(await p.locator('#prompt').inputValue(), 'Отменяемая идея');
  await p.waitForTimeout(1400); assert.equal(await p.locator('.producer-draft').count(), 0);
  await openProducer(p);
  await p.locator('.mode[data-mode="music"]').click(); await p.locator('#prompt').fill('Параллельный вопрос'); await p.locator('#send').click();
  await p.locator('.card.assistant', { hasText: 'Стрим пришёл' }).waitFor();
  await p.locator('.producer-draft').waitFor();
  assert.equal(state.jobPosts.length, 0);
  // #35: композер один — ход диалога пишется в то же поле, «Отменяемая идея»
  // осталась в снимке producer_draft (snapshot.idea), а не в поле композера.
  assert.equal(await p.locator('#prompt').inputValue(), '', 'диалоговый ход очистил общее поле');
  assert.equal(await p.locator('.producer-draft').count(), 1, 'черновик продюсера на месте');
  ok('producer cancellation and parallel dialog coexist; draft preserved in producer snapshot');

  // A late response stays in its original session even while a new one is active.
  resetBff(); state.improveDelay = 3000;
  state.chatImproveText = JSON.stringify({ title: 'Первый', prompt: 'jazz trio', lyrics: 'исходные слова' });
  p = await page(); await p.locator('#prompt').fill('Первая сессия продюсера'); await p.locator('#send').click();
  await p.locator('.card.assistant', { hasText: 'Стрим пришёл' }).waitFor();
  await p.locator('.mode[data-mode="music"]').click(); await p.locator('#prompt').fill('Идея первой сессии');
  await openProducer(p); await p.locator('.mode[data-mode="music"]').click(); await p.locator('#profileBtn').click(); await p.locator('#newChat').click();
  await p.waitForFunction(() => document.querySelector('.mode[data-mode="music"]').getAttribute('aria-pressed') === 'true');
  await p.waitForTimeout(3400);
  assert.equal(await p.locator('.session-feed:not([hidden]) .producer-draft').count(), 0);
  await openBurger(p); await p.locator('#sessionsOpen').click();
  await p.locator('#sessionsList .session-item').filter({ hasText: 'Первая сессия продюсера' }).click();
  await p.locator('.session-feed:not([hidden]) .producer-draft').waitFor();
  await p.locator('.mode[data-mode="music"]').click();
  assert.equal(await p.locator('#prompt').inputValue(), 'Идея первой сессии');
  ok('late producer result is isolated to the originating session');

  resetBff(); p = await page();
  await p.route(`http://127.0.0.1:${BFF_PORT}/v1/chat/completions`, route => route.fulfill({
    status: 429, headers: { 'Access-Control-Allow-Origin': `http://127.0.0.1:${STATIC_PORT}` },
    contentType: 'application/json', body: JSON.stringify({ error: { code: 'queue_full', message: 'Очередь заполнена' } })
  }));
  await p.locator('.mode[data-mode="music"]').click(); await p.locator('#prompt').fill('Идея при лимите');
  await openProducer(p); await p.locator('.card.error').waitFor();
  assert.equal(await p.locator('#prompt').inputValue(), 'Идея при лимите');
  assert.equal(state.jobPosts.length, 0);
  ok('producer 429 preserves the input and never starts a job');

  // ---- Вариант B «Студия-агент»: разговорный музыкальный режим ------------------
  // send в Simple-режиме НЕ создаёт джобу: это диалог с выбранным наставником.
  resetBff();
  p = await page({ viewport: { width: 390, height: 844 } });
  await p.locator('.mode[data-mode="music"]').click();
  await p.locator('#assistantChip').click();
  await p.locator('#assistantMenu button', { hasText: 'Лирик' }).click();
  await p.locator('#prompt').fill('хочу песню про осень');
  await p.locator('#send').click();
  await p.waitForSelector('.music-draft', { timeout: 15000 });
  assert.equal(state.jobPosts.length, 0, 'send in music mode does NOT create a job without explicit Generate');
  const mentorPost = state.chatPosts.at(-1);
  assert.equal(mentorPost.stream, true, 'music dialog goes as SSE stream');
  assert.match(mentorPost.messages[0].content, /Лирик/, 'the selected mentor system prompt is actually used (not decoration)');
  assert.match(mentorPost.messages[0].content, /briix-draft/, 'draft format instruction is in the system message');
  assert.match(mentorPost.messages[0].content, /Текущее состояние студии/, 'mentor sees the studio fields snapshot');
  const draftCard = p.locator('.music-draft').first();
  assert.ok(await draftCard.getByRole('button', { name: 'Принять в поля' }).isVisible(), 'draft has Accept button');
  assert.ok(await draftCard.getByRole('button', { name: 'Сгенерировать трек' }).isVisible(), 'draft has explicit Generate button');
  // Принять заполняет поля (с бэкапом), джобу не создаёт.
  await draftCard.getByRole('button', { name: 'Принять в поля' }).click();
  await p.waitForFunction(() => document.getElementById('musicPrompt').value === 'dream pop, 90 BPM, warm female vocals');
  assert.equal(state.jobPosts.length, 0, 'accepting the draft does not generate');
  // F-12: вместо автоперехода (он ломал бы второй ход диалога) — карточка
  // «Черновик принят» с явной кнопкой «Показать поля».
  const showBtn = p.getByRole('button', { name: 'Показать поля' });
  assert.ok(await showBtn.isVisible(), 'accept shows a «Показать поля» affordance (F-12)');
  assert.equal(await p.locator('#prompt').isHidden(), false, 'диалоговое поле остаётся для следующего хода наставника');
  await showBtn.click();
  await p.waitForFunction(() => !document.getElementById('advanced').hidden);
  assert.ok((await p.locator('#musicPrompt.field-flash').count()) >= 1, 'поля подсвечены после перехода (F-12)');
  await openMore(p); await p.locator('#tuneToggle').click(); // обратно в Simple — второй ход диалога
  await p.waitForFunction(() => !document.getElementById('prompt').hidden);
  // Self-refine: второй ход сохраняет историю диалога.
  await p.locator('#prompt').fill('поправь припев');
  await p.locator('#send').click();
  await p.waitForFunction(() => document.querySelectorAll('.music-draft').length >= 2, {}, { timeout: 15000 });
  assert.equal(state.jobPosts.length, 0, 'refinement turn still does not generate');
  const refinePost = state.chatPosts.at(-1);
  assert.ok(refinePost.messages.some(m => m.role === 'user' && m.content === 'хочу песню про осень'), 'dialog history is sent to the mentor');
  // Явная генерация из draft-блока (#40, «промт только через мозг», 20.11):
  // строка наставника — ВХОД для слоёв buildCaption, в модель уходит сборка
  // (строка + недостающие слои, ≤ 640), а не сырая строка как раньше.
  await p.locator('.music-draft').last().getByRole('button', { name: 'Сгенерировать трек' }).click();
  await p.waitForSelector('#feed audio', { timeout: 30000 });
  assert.equal(state.jobPosts.length, 1, 'draft Generate creates exactly one job');
  assert.match(state.jobPosts[0].prompt, /^dream pop, 90 BPM, warm female vocals/, '#40: строка наставника — вход, сохранена первой');
  assert.notEqual(state.jobPosts[0].prompt, 'dream pop, 90 BPM, warm female vocals', '#40: слоевой buildCaption собирает черновик чата, а не одна строка');
  assert.ok(state.jobPosts[0].prompt.length <= 640, '#40: сборка ≤ 640');
  assert.match(state.jobPosts[0].params.lyrics, /Новая строка/);
  assert.equal(state.jobPosts[0].params.title, 'Черновик наставника', 'params.title carries the draft title');
  assert.equal(state.jobPosts[0].params.artist, 'tester', 'params.artist is the user nick');
  // #40: честная плашка в карточке — «Промт собран мозгом: N слоёв» (#41: в .brain-badge мета-блока).
  const modelInfoText = await p.evaluate(() => [...document.querySelectorAll('.track-details')].map(el => el.textContent).join('\n'));
  assert.match(modelInfoText, /Промт собран мозгом: \d+ слоёв/, '#40: честная плашка слоёв в карточке трека');
  assert.equal(state.chatPosts.filter(x => x.stream === false && x.max_tokens === 300).length, 0, 'promptReady path skips silent translation');
  // Диалог и черновики персистятся в session-store (#35 W1-2: единый поток на сессии).
  const savedDialog = await p.evaluate(async () => {
    const { profile } = await BriixSessionStore.open('tester');
    const s = profile.sessions[0];
    return { history: s.history?.length || 0, assistant: s.assistantId, musicChat: s.musicChat,
      drafts: s.feed.filter(x => x.t === 'music_draft').length };
  });
  assert.ok(savedDialog.history >= 4, 'unified dialog persisted in session.history (2 хода = 4 элемента)');
  assert.equal(savedDialog.assistant, 'lyricist', 'роль — свойство сессии (P2-1)');
  assert.equal(savedDialog.musicChat, undefined, 'муз-диалога-отдельным-контейнером больше нет');
  assert.ok(savedDialog.drafts >= 2, 'draft cards persisted in the feed');
  await p.reload();
  await p.waitForSelector('.music-draft', { timeout: 10000 });
  // #41: после генерации из черновика композер остаётся в «Тонко настроить»;
  // сохранение advanced в сессии гоняется с перезагрузкой (асинхронная очередь
  // IndexedDB), поэтому после рестарта возвращаемся в Simple явным тумблером —
  // как это делает пользователь.
  if (await p.locator('#prompt').isHidden()) { await openMore(p); await p.locator('#tuneToggle').click(); }
  await p.waitForFunction(() => !document.getElementById('prompt').hidden);
  await p.locator('#prompt').fill('спокойный эмбиент для чтения');
  await openMore(p); await p.locator('#genTrack').click();
  await p.waitForFunction(() => document.querySelectorAll('#feed audio').length >= 1, {}, { timeout: 30000 });
  assert.equal(state.jobPosts.length, 2, 'composer Generate button creates a job without a dialog turn');
  assert.ok(/^[\x20-\x7E]*$/.test(state.jobPosts[1].prompt), 'quick-path assembly still yields an English prompt');
  // #40: авторский ASCII-промт, набранный руками в «Тонко настроить», не
  // переписывается (правило #109): ручная правка поля сняла метку мозга,
  // строка уходит в модель как есть — без слоёв и без плашки.
  await openMore(p); await p.locator('#tuneToggle').click();
  await p.locator('#musicPrompt').fill('author ascii line without brain tags');
  await openMore(p); await p.locator('#genTrack').click();
  await p.waitForFunction(() => document.querySelectorAll('#feed audio').length >= 2, {}, { timeout: 30000 });
  assert.equal(state.jobPosts.length, 3, 'author advanced generation creates the third job');
  assert.equal(state.jobPosts[2].prompt, 'author ascii line without brain tags', '#109: авторская ASCII-строка уходит как есть');
  const authorInfoText = await p.evaluate(() => { const blocks = [...document.querySelectorAll('.track-details')]; return blocks.length ? blocks[blocks.length - 1].textContent : ''; });
  assert.doesNotMatch(authorInfoText, /Промт собран мозгом/, '#40: у авторской строки нет плашки слоёв');
  ok('music chat: send converses without jobs, mentor system used, draft accept/generate (#40 brain assembly + badge), author ASCII path untouched, dialog persisted, explicit composer Generate');

  // ---- Анатомия карточки трека (общая для ленты и Библиотеки) --------------------
  resetBff();
  p = await page();
  // R1: стаб MediaSession стоит с загрузки страницы — первый же play привязывает
  // к нему хендлеры и метаданные (экран блокировки знает, что играет).
  await p.addInitScript(() => {
    window.__metaCalls = [];
    window.__mediaActions = {};
    window.MediaMetadata = class { constructor(m) { window.__metaCalls.push(m); } };
    try {
      Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: {
        metadata: null, playbackState: 'none',
        setActionHandler(action, fn) { window.__mediaActions[action] = typeof fn; }
      } });
    } catch { /* уже определён — не критично */ }
  });
  await p.evaluate(async wavB64 => {
    const binary = atob(wavB64), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const { profile, backend } = await BriixSessionStore.open('tester');
    profile.sessions[0].feed.push({ t: 'media', who: 'Трек готов (Flash)', kind: 'music', file: '/files/tone.wav', job: 'job-tone', cover: '',
      input: { prompt: 'тестовая идея', promptSent: 'assembled english prompt', lyrics: '[Verse]\nСтрока', model: 'ace-step-flash', instrumental: false,
        title: 'Тест: Трек/№1?', artist: 'tester', lyricsSource: 'наставник: Лирик' } });
    await BriixSessionStore.save(profile, profile.revision, backend);
  }, WAV.toString('base64'));
  await p.reload();
  // Restore-путь: волна из peaks.json и PLAY-обложка есть СРАЗУ, аудио не грузится без клика.
  await p.waitForSelector('#feed .waveform-canvas', { timeout: 10000 });
  assert.equal(await p.locator('#feed .track-cover.playable').count(), 1, 'cover is a PLAY button before any load');
  assert.equal(await p.locator('#feed .media-load').count(), 0, 'no Listen button: the cover replaced it');
  assert.equal(state.audioRequests, 0, 'restore does not fetch audio until the cover is clicked');
  assert.equal(await p.locator('#feed audio').count(), 0, 'no audio element before the cover click');
  await p.locator('#feed .track-cover.playable').click();
  await p.waitForSelector('#feed audio', { timeout: 15000 });
  // Обложка = PLAY (настоящий играбельный WAV в mock). tryPlay мог автозапустить
  // трек при загрузке — гасим и проверяем оба направления переключения.
  await p.evaluate(() => document.querySelector('#feed audio').pause());
  await p.locator('#feed .track-cover.playable').click();
  // Ждём именно класс на обложке: paused меняется раньше, чем срабатывает 'play'-обработчик.
  await p.waitForFunction(() => document.querySelector('#feed .track-cover.playing') && !document.querySelector('#feed audio').paused, {}, { timeout: 5000 });
  await p.locator('#feed .track-cover.playing').click();
  await p.waitForFunction(() => document.querySelector('#feed audio').paused && !document.querySelector('#feed .track-cover.playing'), {}, { timeout: 5000 });
  // Клик по волне = seek.
  await p.evaluate(() => { document.querySelector('#feed audio').currentTime = 0; });
  await p.evaluate(() => {
    const c = document.querySelector('#feed .waveform-canvas');
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * 0.5, clientY: r.top + r.height / 2 }));
  });
  await p.waitForFunction(() => Math.abs(document.querySelector('#feed audio').currentTime - 1) < 0.4, {}, { timeout: 5000 });
  // R1 (player.js): таймкоды под волной (F-25) и MediaSession-метаданные.
  const timecodes = await p.locator('#feed .waveform-time').innerText();
  assert.match(timecodes, /^\d+:\d\d \/ \d+:\d\d$/, 'timecodes rendered under the wave: ' + JSON.stringify(timecodes));
  assert.match(await p.locator('#feed .track-title').innerText(), /Тест: Трек/, 'feed card shows the track title as a heading (F-18)');
  const media = await p.evaluate(() => ({ calls: window.__metaCalls, state: navigator.mediaSession.playbackState, actions: window.__mediaActions }));
  assert.equal(media.state, 'paused', 'playbackState follows the audio (paused now)');
  assert.ok(media.calls.length >= 1, 'MediaMetadata is set on play');
  assert.match(media.calls.at(-1).title, /Тест: Трек/, 'lockscreen title comes from the card');
  assert.equal(media.calls.at(-1).artist, 'tester', 'lockscreen artist comes from the card');
  assert.equal(media.actions.play, 'function', 'play/pause/stop handlers are wired');
  assert.equal(media.actions.pause, 'function');
  assert.equal(media.actions.stop, 'function');
  await p.locator('#feed .track-cover.playable').click(); // снова play — состояние сессии оживает
  await p.waitForFunction(() => navigator.mediaSession.playbackState === 'playing' && !document.querySelector('#feed audio').paused, {}, { timeout: 5000 });
  await p.locator('#feed .track-cover.playing').click(); // пауза — не мешаем следующим проверкам
  await p.waitForFunction(() => document.querySelector('#feed audio').paused, {}, { timeout: 5000 });
  // Единое меню «⋯»: 9 действий (#35 W1-4: + WAV и обложка, MP3 скрыт до бэффа).
  await p.locator('#feed .menu-btn').click();
  const menuTexts = await p.locator('.track-menu:not([hidden]) button').allInnerTexts();
  for (const label of ['Копировать промпт', 'Копировать лирику', 'Скачать аудио (M4A)', 'Скачать WAV — мастер без тегов', 'Скачать обложку', 'Повторить с правками', 'Создать обложку', 'В избранное', 'Удалить']) {
    assert.ok(menuTexts.some(t => t.includes(label)), 'menu contains: ' + label);
  }
  assert.equal(menuTexts.length, 9, 'exactly the nine actions in the unified menu');
  assert.ok(!menuTexts.some(t => /MP3/i.test(t)), 'MP3 item is hidden until the backend ships it (SPEC #35 W1-4)');
  await p.keyboard.press('Escape');
  // Transparency: что уехало в модель + название/исполнитель + источник лирики.
  await p.locator('#feed .track-details > summary').click();
  const transparency = await p.locator('#feed .track-details').innerText(); // открытые draft-read строки включаются в innerText
  assert.match(transparency, /Что уехало в модель/);
  assert.match(transparency, /assembled english prompt/);
  assert.match(transparency, /Название: Тест: Трек\/№1\?/);
  assert.match(transparency, /Исполнитель: tester/);
  assert.match(transparency, /Источник лирики: наставник: Лирик/);
  // #41: строки чтения — те же draft-read, что в черновиках: разворачиваются,
  // копируются целиком; редактируемых полей в карточке нет.
  await p.locator('#feed .track-details .draft-read summary').first().click();
  assert.match(await p.locator('#feed .track-details .draft-read .draft-read-full').first().innerText(), /assembled english prompt/, 'клик по строке разворачивает полный текст');
  assert.ok(await p.locator('#feed .track-details .draft-read .draft-copy').first().isVisible(), 'у строки есть кнопка копирования целиком');
  assert.equal(await p.locator('#feed .track-details input, #feed .track-details textarea').count(), 0, '#41: в карточке трека нет редактируемых полей');
  // Имя файла скачивания: sanitize с сохранением кириллицы, спецсимволы вырезаны.
  const dlCardPromise = p.waitForEvent('download');
  await p.locator('#feed .menu-btn').click();
  await p.locator('.track-menu:not([hidden]) button', { hasText: 'Скачать аудио (M4A)' }).click();
  assert.equal((await dlCardPromise).suggestedFilename(), 'Тест Трек №1 - tester.wav',
    'download name: sanitized title - artist, cyrillic kept, special characters removed');
  ok('track card: cover=play, auto waveform with click-seek, unified 9-action menu, transparency, sanitized filename');

  // Мобильный 320×568: меню «⋯» — bottom-sheet и не вылезает за экран.
  p = await page({ viewport: { width: 320, height: 568 } });
  await p.evaluate(async wavB64 => {
    const binary = atob(wavB64), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const { profile, backend } = await BriixSessionStore.open('tester');
    profile.sessions[0].feed.push({ t: 'media', who: 'Трек готов (Flash)', kind: 'music', file: '/files/tone.wav', job: 'job-tone', cover: '',
      input: { prompt: 'тестовая идея', promptSent: 'assembled english prompt', lyrics: '[Verse]\nСтрока', model: 'ace-step-flash', instrumental: false,
        title: 'Тест: Трек/№1?', artist: 'tester', lyricsSource: 'наставник: Лирик' } });
    await BriixSessionStore.save(profile, profile.revision, backend);
  }, WAV.toString('base64'));
  await p.reload();
  await p.locator('#feed .track-cover.playable').click();
  await p.waitForSelector('#feed audio', { timeout: 15000 });
  await p.locator('#feed .menu-btn').click();
  const sheet = await p.locator('.track-menu:not([hidden])').boundingBox();
  assert.ok(sheet, 'bottom sheet opens on mobile');
  assert.ok(sheet.x >= 0 && sheet.y >= 0, 'bottom sheet starts inside the viewport');
  assert.ok(sheet.x + sheet.width <= 320.5 && sheet.y + sheet.height <= 568.5, 'bottom sheet fits 320x568: ' + JSON.stringify(sheet));
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, 'no h-scroll with open sheet');
  await p.screenshot({ path: path.join(require('node:os').tmpdir(), 'studio-320-sheet.png'), fullPage: false });
  ok('mobile 320x568: track menu is a bottom sheet inside the viewport');

  // F-59: каталог моделей — честные ориентиры ожидания и статус в меню.
  p = await page();
  await p.waitForFunction(() => window.BRIIX_CATALOG.size() >= 4, {}, { timeout: 10000 });
  const catalog = await p.evaluate(() => ({
    flash: window.BRIIX_CATALOG.etaSeconds('ace-step-flash'),
    pro: window.BRIIX_CATALOG.etaSeconds('ace-step-pro'),
    musicgen: window.BRIIX_CATALOG.etaSeconds('musicgen-small'), // source:none — не ориентир
    proStatus: window.BRIIX_CATALOG.model('ace-step-pro').status
  }));
  assert.equal(catalog.flash, 111, 'замеренная латентность Flash читается');
  assert.equal(catalog.pro, 596, 'замеренная латентность Pro читается');
  assert.equal(catalog.musicgen, null, 'source:none не притворяется ориентиром');
  assert.equal(catalog.proStatus, 'unavailable');
  // Ориентир в карточке ожидания: инструментал без автолирики — сразу джоба.
  await p.locator('.mode[data-mode="music"]').click();
  await openMore(p); await p.locator('.seg-btn[data-vocal="1"]').click();
  await p.locator('#prompt').fill('весёлый лоу-фай этюд');
  await openMore(p); await p.locator('#genTrack').click();
  // Мок делает джобу готовой через ~5 с — снимаем ориентир в тот же момент,
  // когда карточка ожидания появилась (без отдельного re-query).
  const etaState = await p.waitForFunction(() => {
    const el = document.querySelector('.card.stage .stage-eta');
    return el && !el.hidden ? { text: el.textContent, late: el.classList.contains('late') } : false;
  }, {}, { timeout: 15000 }).then(h => h.jsonValue());
  assert.match(etaState.text, /Ориентир: ~2 минуты \(Flash\) — по замеру сервера/, 'ориентир из каталога в карточке ожидания: ' + JSON.stringify(etaState.text));
  assert.equal(etaState.late, false, 'тон задержки включается только после ×1,5 — не раньше');
  // Дожидаемся конца генерации (мок быстро отдаёт ready), затем — меню моделей.
  await p.waitForSelector('.card.stage', { state: 'detached', timeout: 20000 });
  await openMore(p); await p.locator('#modelChip').click();
  const menuText = (await p.locator('#modelMenu button').allInnerTexts()).join('\n');
  assert.match(menuText, /Flash\s*ace-step-flash · ~2 минуты/, 'меню Flash показывает ориентир: ' + JSON.stringify(menuText));
  assert.match(menuText, /Pro\s*ace-step-pro · ~10 минут · недоступна/, 'меню Pro честно показывает ориентир и недоступность');
  ok('catalog /v1/models: measured ETA in the wait card and honest model menu (F-59)', catalog);

  // R6: тосты (F-38), дедупликация notice (F-42), мини-плеер (T-51-остаток).
  resetBff();
  p = await page();
  // F-42: две неудачные попытки без ключа — одна карточка «Ключ», не две (A2).
  await p.evaluate(() => localStorage.removeItem('briix-media-live-token'));
  await p.locator('.mode[data-mode="music"]').click();
  await openMore(p); await p.locator('.seg-btn[data-vocal="1"]').click();
  await p.locator('#prompt').fill('без ключа один');
  await openMore(p); await p.locator('#genTrack').click();
  await p.waitForSelector('.card.notice');
  await p.locator('#prompt').fill('без ключа два');
  await openMore(p); await p.locator('#genTrack').click();
  await p.waitForTimeout(400);
  assert.equal(await p.locator('.card.notice').count(), 1, 'F-42: одинаковые notice не стакаются — одна карточка на причину');
  // F-38: копирование отвечает тостом, а не строкой статуса.
  await p.locator('#keyInput').fill('test-token'); // вернуть ключ для следующих шагов
  await p.locator('#keySave').click();
  // Материал для библиотеки и плеера: один инструментальный трек (мок ~5 с).
  await p.locator('#prompt').fill('спокойный инструментальный этюд для проверки');
  await openMore(p); await p.locator('#genTrack').click();
  await p.locator('#feed audio', { timeout: 30000 }).waitFor();
  await p.locator('.tab[data-tab="library"]').click();
  await p.waitForSelector('.lib-item');
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write']); // headless: иначе writeText падает
  await p.locator('.lib-item .menu-btn').first().click();
  await p.locator('.track-menu:not([hidden]) button', { hasText: 'Копировать промпт' }).first().click();
  await p.waitForSelector('.toast.done', { timeout: 5000 });
  assert.match(await p.locator('.toast.done').last().innerText(), /Скопировано: промпт/, 'F-38: тост «Скопировано» виден поверх вкладки Библиотека');
  // Мини-плеер: трек играет — полоса под шапкой с названием и таймкодом.
  await p.locator('.tab[data-tab="chat"]').click();
  await p.waitForFunction(() => window.BriixPlayer.current, {}, { timeout: 10000 });
  if (await p.evaluate(() => window.BriixPlayer.current.paused)) {
    await p.locator('#feed .track-cover.playable').first().click(); // тоггл: играть, если молчит
  }
  await p.waitForFunction(() => !document.getElementById('miniPlayer').hidden
    && document.getElementById('mpTitle').textContent.length > 1
    && !window.BriixPlayer.current.paused, {}, { timeout: 10000 });
  const mpState = await p.evaluate(() => ({
    title: document.getElementById('mpTitle').textContent,
    time: document.getElementById('mpTime').textContent,
    playing: !window.BriixPlayer.current.paused
  }));
  assert.match(mpState.time, /^\d+:\d\d \/ \d+:\d\d$/, 'мини-плеер показывает таймкод');
  assert.equal(mpState.playing, true, 'мини-плеер видит играющий трек');
  await p.locator('#mpToggle').click();
  await p.waitForFunction(() => window.BriixPlayer.current.paused, {}, { timeout: 5000 });
  ok('R6: toasts over library tab, notice dedupe, mini-player with timecode', mpState);

  // T-42: ключ из ?key= живёт в sessionStorage и НЕ остаётся в URL.
  resetBff();
  {
    const context = await browser.newContext();
    const kp = await context.newPage();
    kp.on('pageerror', e => errors.push(e.message));
    await kp.addInitScript(({ port }) => {
      localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:' + port));
    }, { port: BFF_PORT });
    await kp.goto(`http://127.0.0.1:${STATIC_PORT}/studio/index.html?key=${TOKEN}`);
    await kp.waitForSelector('#gate:not([hidden])'); // первый визит без профиля — гейт
    assert.equal(await kp.evaluate(() => location.search), '', 'T-42: ?key= вычищен из URL (replaceState)');
    assert.equal(await kp.evaluate(() => sessionStorage.getItem('briix-media-live-token-session')), TOKEN, 'ключ живёт в sessionStorage');
    assert.equal(await kp.evaluate(() => localStorage.getItem('briix-media-live-token')), null, 'в localStorage ключ НЕ попал');
    // запрос с этим ключом проходит авторизацию мока
    await kp.evaluate(() => fetch(JSON.parse(localStorage.getItem('briix-media-live-server')) + '/jobs?limit=1', { headers: { Authorization: 'Bearer ' + sessionStorage.getItem('briix-media-live-token-session') } }).then(r => r.status)).then(status => assert.equal(status, 200));
    await kp.close();
  }

  // F-43 + T-43: пустой ключ — честное удаление; «Очистить устройство» — тотальное.
  resetBff();
  p = await page();
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('маяк для очистки');
  await p.locator('#send').click();
  await p.waitForSelector('#feed img.media-in', { timeout: 25000 });
  // F-43: пустое сохранение = удаление ключа (подтверждение), а не «сохранено».
  await p.locator('#profileBtn').click();
  await p.locator('#profileKeyBtn').click();
  await p.locator('#keyInput').fill('');
  await p.locator('#keySave').click();
  await p.waitForSelector('.confirm-overlay');
  assert.match(await p.locator('.confirm-dialog').innerText(), /Удалить сохранённый ключ\?/, 'F-43: пустой ключ спрашивает удаление');
  await p.getByRole('button', { name: 'Удалить', exact: true }).click();
  await p.waitForFunction(() => !sessionStorage.getItem('briix-media-live-token-session') && !localStorage.getItem('briix-media-live-token'));
  // T-43: «Выйти и очистить это устройство» — профиль, сессии, библиотека, ключ.
  await p.locator('#profileBtn').click();
  await p.locator('#profileKeyBtn').click();
  await p.locator('#keyInput').fill(TOKEN);
  await p.locator('#keyRemember').check(); // localStorage-путь тоже проверим
  await p.locator('#keySave').click();
  await p.waitForSelector('.toast.done');
  assert.equal(await p.evaluate(() => localStorage.getItem('briix-media-live-token')), TOKEN, '«запомнить» кладёт ключ в localStorage');
  await p.locator('#profileBtn').click();
  await p.locator('#profileWipeBtn').click();
  await p.waitForSelector('.confirm-overlay');
  assert.match(await p.locator('.confirm-dialog').innerText(), /ключ доступа, все профили и PIN/, 'T-43: диалог перечисляет, что будет удалено');
  await p.getByRole('button', { name: 'Очистить и выйти' }).click();
  await p.waitForSelector('#gate:not([hidden])', { timeout: 10000 });
  const wiped = await p.evaluate(async () => {
    const leftovers = Object.keys(localStorage).filter(k => /^briix-/.test(k));
    let idbFresh = null;
    try { const { profile } = await BriixSessionStore.open('tester'); idbFresh = profile.sessions.length === 0; }
    catch { idbFresh = 'error'; }
    return { leftovers, idbFresh, token: localStorage.getItem('briix-media-live-token'), session: sessionStorage.getItem('briix-media-live-token-session') };
  });
  assert.deepEqual(wiped.leftovers, [], 'T-43: в localStorage не осталось briix-* ключей');
  assert.equal(wiped.token, null, 'ключ удалён');
  assert.equal(wiped.session, null, 'сессионный ключ удалён');
  assert.equal(wiped.idbFresh, true, 'IndexedDB пересоздана пустой');
  ok('login privacy: ?key= cleaned+sessionStorage, honest empty key, full device wipe (T-42/F-43/T-43)');
  await p.close();

  // ==== Этап 3.8: стриминг, память, сеть, стартовая загрузка =====================

  // T-15: SSE через «жёсткий прокси» — \r\n-переводы и JSON, побитый на две
  // data:-строки внутри события. Раньше парсер терял такие события целиком.
  resetBff(); state.chatCrlf = true;
  p = await page();
  await p.locator('#prompt').fill('привет через прокси');
  await p.locator('#send').click();
  await waitForState(() => state.streamEnds >= 1, { what: 'CRLF stream reached [DONE]' });
  await p.waitForFunction(() => [...document.querySelectorAll('#feed .card.assistant .body')].some(b => b.textContent.includes('Стрим через жёсткий прокси')), {}, { timeout: 15000 });
  assert.equal(state.streamEnds, 1, 'стрим дошёл до [DONE]');
  ok('chatStream survives CRLF separators and multi-line data events (T-15)');

  // T-15: ошибка посреди потока без [DONE] — reader обязан отмениться,
  // иначе соединение висит вечно (сервер держит его открытым специально).
  resetBff(); state.chatMidstreamError = true;
  p = await page();
  await p.locator('#prompt').fill('ошибка посреди потока');
  await p.locator('#send').click();
  await p.waitForFunction(() => [...document.querySelectorAll('#feed .card')].some(c => c.textContent.includes('Бэкенд лёг посреди потока')), {}, { timeout: 15000 });
  await waitForState(() => state.midstreamCloses >= 1, { what: 'midstream connection closed' });
  ok('chatStream cancels the reader on mid-stream error (T-15)', { closes: state.midstreamCloses });
  await p.close();

  // T-39: чанки применяются одним requestAnimationFrame — без кадра в DOM
  // ничего не пишется (раньше — запись+чтение геометрии на каждый токен).
  resetBff(); state.chatSlow = true; state.chatSlowText = 'кадр '.repeat(24); state.chatSlowTick = 60;
  p = await page();
  await p.evaluate(() => {
    // Держим rAF: колбэки копятся в очереди, кадры «не наступают».
    window.__rafQueue = [];
    window.__rafOrig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => { window.__rafQueue.push(cb); return window.__rafQueue.length; };
    window.__rafCancelOrig = window.cancelAnimationFrame;
    window.cancelAnimationFrame = () => {};
  });
  await p.locator('#prompt').fill('стрим по кадрам');
  await p.locator('#send').click();
  await p.waitForFunction(() => window.__rafQueue.length > 0, {}, { timeout: 15000 });
  await p.waitForTimeout(450); // сервер успел дописать ещё много чанков
  const held = await p.evaluate(() => ({
    queued: window.__rafQueue.length,
    text: document.querySelector('#feed .card.assistant .body span')?.textContent || ''
  }));
  assert.equal(held.text, '', 'T-39: без кадра DOM не трогается (в ожидании кадра: ' + held.queued + ')');
  assert.equal(held.queued, 1, 'T-39: запланирован ровно один кадр-флеш, а не по чанку');
  const afterFrame = await p.evaluate(() => {
    const cbs = window.__rafQueue.splice(0);
    for (const cb of cbs) cb();
    return document.querySelector('#feed .card.assistant .body span')?.textContent || '';
  });
  const batched = afterFrame.split('кадр').length - 1;
  assert.ok(batched >= 5, 'T-39: один кадр применил сразу ' + batched + ' чанков (а не по одному на токен)');
  await p.evaluate(() => {
    window.requestAnimationFrame = window.__rafOrig;
    window.cancelAnimationFrame = window.__rafCancelOrig;
  });
  await p.waitForFunction(() => [...document.querySelectorAll('#feed .card.assistant .body')].some(b => b.textContent.trim().startsWith('кадр кадр')), {}, { timeout: 15000 });
  ok('stream chunks flush once per animation frame (T-39)', { queued: held.queued });
  await p.close();

  // F-39: читатель выше низа ленты — готовое фото считается, пилюля «↓ N новых»
  // ведёт к нему и исчезает у низа.
  resetBff();
  p = await page();
  await p.evaluate(async () => {
    const { profile, backend } = await BriixSessionStore.open('tester');
    profile.sessions[0].feed = Array.from({ length: 40 }, (_, i) => ({
      t: i % 2 ? 'assistant' : 'user', who: i % 2 ? 'Наставник' : 'Вы', text: 'строка истории номер ' + i
    }));
    await BriixSessionStore.save(profile, profile.revision, backend);
  });
  await p.reload();
  await p.waitForFunction(() => document.querySelectorAll('#feed .card').length === 40);
  assert.equal(await p.locator('#newBelow').count() === 0 || await p.locator('#newBelow').isHidden(), true, 'F-39: после restore пилюли нет');
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('пилюля новых сообщений');
  await p.locator('#send').click();
  await p.waitForSelector('#feed .card.stage');
  await p.evaluate(() => { document.getElementById('feed').scrollTop = 0; }); // ушли читать старое
  // результат приходит, пока читатель у верха: карточка есть, картинки ещё нет (observer)
  await p.waitForFunction(() => [...document.querySelectorAll('#feed .card.assistant .who')].some(w => w.textContent.includes('Фото готово')), {}, { timeout: 25000 });
  await p.waitForSelector('#newBelow:not([hidden])');
  assert.match(await p.locator('#newBelow').innerText(), /новое|новых/, 'F-39: пилюля считает новое');
  await p.locator('#newBelow').click();
  await p.waitForFunction(() => document.getElementById('newBelow')?.hidden === true, {}, { timeout: 10000 });
  // Ленивая карточка дорисовалась после докрутки (F-39 reStick) — новый низ в кадре.
  await p.waitForSelector('#feed img.media-in', { timeout: 10000 });
  // Клик должен привести к новому: лента у низа или карточка «Фото готово» в кадре.
  // Ленивое медиа дорисовывается ПОСЛЕ скролла и дотягивается докруткой
  // (F-39 reStick) — состояние оседает несколько кадров, поэтому ждём до 4с,
  // а не снимаем мгновенный срез (гонка роста ленты).
  const landed = await p.waitForFunction(() => {
    const f = document.getElementById('feed');
    const photo = [...f.querySelectorAll('.card.assistant')].find(c => c.textContent.includes('Фото готово'));
    return f.scrollHeight - f.scrollTop - f.clientHeight < 140
      || (photo && photo.getBoundingClientRect().bottom <= f.getBoundingClientRect().bottom + 4);
  }, {}, { timeout: 4000 }).then(() => true, () => false);
  assert.equal(landed, true, 'F-39: клик привёл к новому (фото в кадре)');
  ok('new-content pill appears for readers above the feed bottom (F-39)');
  await p.close();

  // T-30/T-31 (A12): живые objectURL не растут — повторные скачивания делят
  // один URL, LRU держит ≤8 файлов, вытесненный файл перезагружается.
  resetBff();
  p = await page({ objectUrls: true });
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('один url на файл');
  await p.locator('#send').click();
  await p.waitForSelector('#feed img.media-in', { timeout: 25000 });
  assert.equal(await p.evaluate(() => window.__liveUrls.size), 1, 'A12: фото — ровно один objectURL');
  const photoDl = p.locator('#feed .card a.action[download]').last();
  await photoDl.click(); await photoDl.click(); await photoDl.click();
  await p.waitForTimeout(400);
  assert.equal(await p.evaluate(() => window.__liveUrls.size), 1, 'A12: три скачивания — по-прежнему один URL (раньше live=4)');
  ok('repeat downloads reuse the cached objectURL (A12/T-30)');
  await p.close();

  resetBff();
  p = await page({ objectUrls: true });
  await p.evaluate(() => {
    localStorage.setItem('briix-studio-library-tester', JSON.stringify(
      Array.from({ length: 9 }, (_, i) => ({ job: 'lru-' + i, sessionId: 's0', kind: 'music', prompt: 'трек ' + i, file: '/files/lru-' + i + '.m4a', created: Date.now() - i, fav: false }))
    ));
  });
  await p.locator('.tab[data-tab="library"]').click();
  await p.waitForFunction(() => document.querySelectorAll('.lib-item').length === 9);
  async function libDownload(i) {
    await p.locator('.lib-item').nth(i).locator('.menu-btn').click();
    await p.locator('.track-menu:not([hidden]) button', { hasText: 'Скачать аудио (M4A)' }).click();
  }
  for (let i = 0; i < 9; i++) await libDownload(i);
  await p.waitForFunction(() => window.__liveUrls.size <= 8, {}, { timeout: 15000 });
  assert.equal(await p.evaluate(() => window.__liveUrls.size), 8, 'T-31: LRU вытеснил девятый файл (≤8)');
  await libDownload(0); // вытесненный lru-0 перезагружается, живых всё ещё 8
  await p.waitForFunction(() => window.__liveUrls.size === 8 && document.querySelectorAll('.toast.done').length >= 1, {}, { timeout: 15000 });
  assert.equal(state.fileOrder.filter(u => u.includes('lru-')).length, 10, 'T-31: вытесненный файл перезагружен, остальные — из кэша');
  ok('media LRU: 9 files → 8 live URLs, evicted file reloads on demand (T-31/A12)');
  await p.close();

  // T-27/#41: зависший сервер не держит слоты очереди вечно — таймаут
  // «на первые байты» (90 с, молчаливый сервер) и честная ошибка; ожидающая
  // очередь оживает. Обрыв на середине (progressed) ретраится отдельно.
  resetBff(); state.slowFiles = ['slow-a.m4a', 'slow-b.m4a'];
  p = await page();
  await p.evaluate(() => {
    localStorage.setItem('briix-studio-library-tester', JSON.stringify([
      { job: 'slow-1', sessionId: 's0', kind: 'music', prompt: 'медленный а', file: '/files/slow-a.m4a', created: Date.now(), fav: false },
      { job: 'slow-2', sessionId: 's0', kind: 'music', prompt: 'медленный б', file: '/files/slow-b.m4a', created: Date.now() - 1, fav: false },
      { job: 'fast-1', sessionId: 's0', kind: 'music', prompt: 'быстрый', file: '/files/fast-1.m4a', created: Date.now() - 2, fav: false }
    ]));
  });
  await p.locator('.tab[data-tab="library"]').click();
  await p.waitForFunction(() => document.querySelectorAll('.lib-item').length === 3);
  await p.clock.install(); // таймеры страницы — под нашим контролем
  await libDownload(0);
  await libDownload(1);
  await waitForState(() => state.fileOrder.filter(u => u.includes('slow-')).length === 2, { what: 'slow files requested' });
  await libDownload(2); // оба слота заняты — быстрый ждёт
  await p.waitForTimeout(400);
  assert.equal(state.fileOrder.some(u => u.includes('fast-1')), false, 'T-27: быстрый файл ждёт за зависшими слотами');
  await p.clock.fastForward(91000); // #41: 90 секунд виртуально — молчащий сервер рвётся без ретраев
  await p.waitForFunction(() => [...document.querySelectorAll('.lib-error')].some(e => e.textContent.includes('90 с')), {}, { timeout: 15000 });
  await p.waitForFunction(() => [...document.querySelectorAll('.toast.done')].some(t => t.textContent.includes('Скачано')), {}, { timeout: 15000 });
  assert.ok(state.fileOrder.some(u => u.includes('fast-1')), 'T-27: очередь ожила после таймаута — быстрый файл скачан');
  await waitForState(() => state.activeFiles === 0, { what: 'file slots released' });
  ok('hung file server releases queue slots after the 90s first-byte timeout (T-27/#41)');
  await p.close();

  // T-26: фоновая вкладка не поллит; возврат — немедленный опрос.
  resetBff();
  p = await page();
  await p.locator('.mode[data-mode="music"]').click();
  await p.locator('#prompt').fill('спокойный инструментальный этюд для проверки видимости');
  await openMore(p); await p.locator('#genTrack').click();
  await waitForState(() => state.pollAttempts >= 1, { what: 'first poll' });
  await p.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const frozenPolls = state.pollAttempts;
  await p.waitForTimeout(5000);
  assert.equal(state.pollAttempts, frozenPolls, 'T-26: скрытая вкладка не поллит стенд');
  await p.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitForState(() => state.pollAttempts > frozenPolls, { timeout: 6000, what: 'poll resumes on visible' });
  ok('background tab stops polling, visible tab polls immediately (T-26)');
  await p.close();

  // T-26: офлайн-баннер + быстрый честный отказ без похода на сервер.
  resetBff();
  p = await page();
  await p.evaluate(() => window.dispatchEvent(new Event('offline')));
  await p.waitForSelector('#netBanner:not([hidden])');
  assert.match(await p.locator('#netBanner').innerText(), /Нет соединения/);
  const postsBefore = state.chatPosts.length;
  await p.locator('#prompt').fill('сообщение без сети');
  await p.locator('#send').click();
  await p.waitForFunction(() => [...document.querySelectorAll('#feed .card')].some(c => c.textContent.includes('Нет соединения с сервером')), {}, { timeout: 10000 });
  assert.equal(state.chatPosts.length, postsBefore, 'T-26: запрос не ушёл на сервер');
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await p.waitForFunction(() => document.getElementById('netBanner')?.hidden === true, {}, { timeout: 10000 });
  ok('offline banner + immediate honest failure, online restores (T-26)');
  await p.close();

  // T-26: BroadcastChannel — вторая вкладка видит избранное первой без reload.
  resetBff();
  {
    const bcCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await bcCtx.addInitScript(({ t, port, user }) => {
      localStorage.setItem('briix-media-live-token', t);
      localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:' + port));
      localStorage.setItem('briix-studio-profiles', JSON.stringify({ [user]: { pinHash: 'x', created: 0 } }));
      localStorage.setItem('briix-studio-user', user);
      localStorage.setItem('briix-studio-library-' + user, JSON.stringify([
        { job: 'bc-photo', sessionId: 's0', kind: 'photo', prompt: 'фото для синхронизации', file: '/files/bc-1.png', created: Date.now(), fav: false }
      ]));
    }, { t: TOKEN, port: BFF_PORT, user: 'syncer' });
    const pa = await bcCtx.newPage(); pa.on('pageerror', e => errors.push(e.message));
    const pb = await bcCtx.newPage(); pb.on('pageerror', e => errors.push(e.message));
    await pa.goto(URL_); await pa.waitForSelector('#send');
    await pb.goto(URL_); await pb.waitForSelector('#send');
    await pa.locator('.tab[data-tab="library"]').click();
    await pb.locator('.tab[data-tab="library"]').click();
    await pa.waitForSelector('.lib-item img.media-in', { timeout: 15000 });
    await pb.waitForSelector('.lib-item', { timeout: 15000 });
    await pa.locator('.lib-item button.action', { hasText: 'В избранное' }).click();
    await pb.waitForFunction(() => document.querySelector('.lib-item')?.classList.contains('fav'), {}, { timeout: 10000 });
    assert.match(await pb.locator('.lib-item button.action').first().innerText(), /В избранном/, 'вкладка B увидела ♥ из вкладки A');
    await bcCtx.close();
  }
  ok('BroadcastChannel syncs library favorites across tabs (T-26)');

  // T-35: старт — defer на всех скриптах, версии по контент-хэшу,
  // favicon/manifest/theme-color, словарь ожидания ленивый.
  resetBff();
  p = await page();
  const startInfo = await p.evaluate(() => ({
    scripts: [...document.scripts].filter(s => s.src).map(s => ({ src: s.getAttribute('src'), defer: s.defer })),
    head: document.head.innerHTML
  }));
  assert.ok(startInfo.scripts.length >= 9, 'все модули подключены');
  assert.ok(startInfo.scripts.every(s => s.defer), 'T-35: каждый скрипт defer');
  assert.ok(startInfo.scripts.every(s => /\?v=[0-9a-f]{10}$/.test(s.src)), 'T-35: версии — контент-хэши, а не ручные даты');
  assert.match(startInfo.head, /rel="icon"/, 'favicon подключён');
  assert.match(startInfo.head, /rel="manifest"/, 'manifest подключён');
  assert.match(startInfo.head, /theme-color/, 'theme-color объявлен');
  assert.equal(await p.evaluate(() => performance.getEntriesByType('resource').some(e => e.name.includes('wait-phrases'))), false,
    'T-35: словарь ожидания не грузится на старте');
  await p.locator('#prompt').fill('прогрев словаря ожидания');
  await p.locator('#send').click();
  await p.waitForFunction(() => performance.getEntriesByType('resource').some(e => e.name.includes('wait-phrases')), {}, { timeout: 10000 });
  ok('defer + content-hash versions + favicon/manifest/theme-color + lazy wait-phrases (T-35)');
  await p.close();

  // Хотфикс #23: профиль с [null, битой, валидной] записями не роняет вход —
  // баннер «Не удалось открыть сессии» не показывается, студия открыта.
  resetBff();
  p = await page({ user: '' }); // путь через гейт, как у владельца на проде
  const seeded = await p.evaluate(async () => {
    const valid = { id: 'valid-1', title: 'Живой чат', titleSet: true, createdAt: 1, updatedAt: 2,
      feed: [
        { t: 'user', who: 'Вы', text: 'привет из живой сессии' },
        // Репродукция на проде (#23): черновики без draft/snapshot в валидной сессии.
        { t: 'music_draft', who: 'Наставник', draft: null },
        { t: 'music_draft', who: 'Наставник' }, // draft undefined
        { t: 'producer_draft', who: 'Продюсер', snapshot: null },
        // Хвост #23 (P3): producer_draft с мусорными элементами backups —
        // refreshBackups раньше читал b.quick у null и ронял рендер карточки.
        { t: 'producer_draft', who: 'Продюсер', snapshot: { idea: 'идея с бэкапами' }, backups: [null, { quick: 'живой бэкап' }] }
      ],
      history: [{ role: 'user', content: 'привет из живой сессии' }] };
    const broken = { id: 'broken-1', title: 'Битая' }; // нет feed/history
    const raw = { schemaVersion: 1, nick: 'сломан', revision: 0, activeSessionId: 'broken-1', sessions: [null, broken, valid], legacyBackup: null };
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('briix-studio-sessions', 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('profiles')) req.result.createObjectStore('profiles', { keyPath: 'nick' }); };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('profiles', 'readwrite');
        tx.objectStore('profiles').put(raw);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    return true;
  });
  assert.equal(seeded, true, 'битый профиль посеян в IDB');
  await p.locator('#nickInput').fill('сломан');
  for (const digit of '1234') await p.locator(`.pk[data-digit="${digit}"]`).click();
  await p.locator('#enterBtn').click();
  await p.waitForSelector('#studio:not([hidden])');
  await p.waitForFunction(() => document.getElementById('storageWarning').hidden, {}, { timeout: 10000 });
  assert.equal(await p.locator('#storageWarning').innerText().then(t => t.trim()), '', 'баннер «Не удалось открыть сессии» не показывается');
  const boot = await p.evaluate(async () => {
    const opened = await BriixSessionStore.open('сломан');
    return opened.profile.sessions.map(s => ({ id: s.id, title: s.title, feedIsArray: Array.isArray(s.feed), historyIsArray: Array.isArray(s.history) }));
  });
  assert.equal(boot.length, 2, 'null-запись выброшена, осталось две сессии');
  assert.ok(boot.every(s => s.feedIsArray && s.historyIsArray), 'все записи санированы: feed/history — массивы');
  assert.ok(boot.some(s => s.title === 'Живой чат'), 'валидная сессия цела');
  assert.ok(boot.some(s => s.id === 'broken-1' && s.title === 'Битая' && s.feedIsArray), 'битая запись починена с сохранением id');
  // Лента живой сессии доступна: открываем список сессий и переходим в «Живой чат».
  await openBurger(p); await p.locator('#sessionsOpen').click();
  await p.waitForSelector('#sessionsOverlay:not([hidden])');
  const items = await p.locator('.session-item').allInnerTexts();
  assert.ok(items.some(t => t.includes('Живой чат')), 'список сессий показывает валидную сессию: ' + JSON.stringify(items));
  await p.locator('.session-item', { hasText: 'Живой чат' }).click();
  await p.waitForSelector('#feed .card.user', { timeout: 10000 });
  assert.match(await p.locator('#feed .card.user .body').first().innerText(), /привет из живой сессии/, 'лента валидной сессии восстановлена');
  // Репродукция на проде (#23): битые черновики рендерятся карточками, а не роняют бут.
  await p.waitForSelector('#feed .producer-draft', { timeout: 10000 });
  const draftCards = await p.locator('#feed .producer-draft').count();
  assert.ok(draftCards >= 3, 'все три битых черновика отрендерились без краша: ' + draftCards);
  // Хвост #23 (P3): карточка с backups:[null] отрендерилась, мусор вычищен на всех уровнях.
  const backupsText = await p.locator('#feed .producer-draft .producer-idea').last().textContent(); // details закрыт: innerText скрытое не отдаёт
  assert.ok(backupsText.includes('идея с бэкапами'), 'producer_draft с backups:[null] отрендерился без краша');
  const storedBackups = await p.evaluate(async () => {
    const opened = await BriixSessionStore.open('сломан');
    const s = opened.profile.sessions.find(s => s.id === 'valid-1');
    return s.feed.map(f => f.t === 'producer_draft' ? f.backups : undefined).filter(b => b !== undefined);
  });
  assert.ok(storedBackups.some(b => Array.isArray(b) && b.length === 1 && b[0] && b[0].quick === 'живой бэкап'),
    'мусор [null] вычищен из backups в хранилище: ' + JSON.stringify(storedBackups));
  ok('restore с null/битой записью: бут не падает, баннера нет, сессии санированы (#23)');
  await p.close();

  // ==== #35 W1-1/П1: миграция v1→v2 в точке загрузки + temporary-ключ v1-вкладки ====

  // (а) v1-профиль в IDB мигрирует при входе: ленты на месте, муз-история влита
  // в конец общего потока, assistantId/draft из musicChat; feed побайтово не тронут.
  resetBff();
  p = await page({ user: '' });
  await p.evaluate(async () => {
    const v1Session = {
      id: 'old-1', title: 'Старая сессия', titleSet: true, createdAt: 1, updatedAt: 2,
      feed: [{ t: 'user', who: 'Вы', text: 'старое сообщение' }],
      history: [{ role: 'user', content: 'старое сообщение' }, { role: 'assistant', content: 'старый ответ' }],
      musicChat: { assistant: 'producer', history: [{ role: 'user', content: 'муз-вопрос' }, { role: 'assistant', content: 'муз-ответ' }] }
    };
    const raw = { schemaVersion: 1, nick: 'мигрант', revision: 5, activeSessionId: 'old-1', sessions: [v1Session], legacyBackup: null };
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('briix-studio-sessions', 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('profiles')) req.result.createObjectStore('profiles', { keyPath: 'nick' }); };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('profiles', 'readwrite');
        tx.objectStore('profiles').put(raw);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await p.locator('#nickInput').fill('мигрант');
  for (const digit of '1234') await p.locator(`.pk[data-digit="${digit}"]`).click();
  await p.locator('#enterBtn').click();
  await p.waitForSelector('#studio:not([hidden])');
  await p.waitForSelector('html[data-storage-ready="1"]', { timeout: 45000 });
  const migrated = await p.evaluate(async () => {
    const opened = await BriixSessionStore.open('мигрант');
    const s = opened.profile.sessions[0];
    return { schemaVersion: opened.profile.schemaVersion, revision: opened.profile.revision, s,
      rawFeed: (await new Promise(resolve => {
        const req = indexedDB.open('briix-studio-sessions', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('profiles', 'readonly');
          const get = tx.objectStore('profiles').get('мигрант');
          tx.oncomplete = () => { db.close(); resolve(get.result.sessions[0].feed); };
        };
      })) };
  });
  assert.equal(migrated.schemaVersion, 2, 'v1-профиль мигрировал в v2 при загрузке');
  assert.ok(migrated.revision >= 6, 'revision повышен миграцией (5 → 6, далее живое приложение может наращивать)');
  assert.equal(migrated.s.assistantId, 'producer', 'assistantId восстановлен из musicChat');
  assert.equal(migrated.s.draft.quality, 'flash', 'draft.quality проставлен дефолт');
  assert.equal(migrated.s.draft.instrumental, false, 'draft.instrumental проставлен из трека/дефолта');
  assert.equal(migrated.s.musicChat, undefined, 'musicChat удалён');
  assert.equal(migrated.s.history.length, 5, 'муз-история влита в конец общего потока (2+1 маркер+2)');
  assert.equal(migrated.s.history[2].role, 'system', 'служебный маркер-граница в контексте');
  assert.equal(migrated.s.history[3].via, 'music-chat', 'влитые элементы помечены via: music-chat');
  assert.deepEqual(migrated.rawFeed, [{ t: 'user', who: 'Вы', text: 'старое сообщение' }], 'feed не мигрирует — побайтово исходный');
  ok('v1→v2 migration at load: history merged, assistantId/draft restored, feed untouched');
  await p.close(); // освободить IDB/локи перед сценарием (б) — на 2-ядерном CI иначе open() конкурирует

  // (б) v1-вкладка пишет в v2-хранилище → schema_unsupported, баннер + temporary-ключ;
  // после перезагрузки v2-код предлагает «Восстановить несохранённое» и удаляет ключ.
  resetBff();
  p = await page({ user: '' });
  await p.locator('#nickInput').fill('вкладка-v1');
  for (const digit of '1234') await p.locator(`.pk[data-digit="${digit}"]`).click();
  await p.locator('#enterBtn').click();
  await p.waitForSelector('#studio:not([hidden])');
  // Гонка теста: fill сразу после снятия hidden мог быть затёрт loadDraft'ом,
  // когда startSession ещё открывает хранилище (медленнее на CI). Ждём явный
  // сигнал готовности хранилища (data-storage-ready), потом вводим текст.
  await p.waitForSelector('html[data-storage-ready="1"]', { timeout: 45000 });
  // Живой диалог — чтобы в pending-снапшоте было что сохранять.
  await p.locator('#prompt').fill('несохранённый текст вкладки');
  await p.locator('#send').click();
  await p.waitForSelector('#feed .card.assistant', { timeout: 15000 });
  // «Старая вкладка»: откатываем схему записи в хранилище до v1 (как будто её оставил v1-код).
  await p.evaluate(async () => {
    const opened = await BriixSessionStore.open('вкладка-v1');
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('briix-studio-sessions', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('profiles', 'readwrite');
        tx.objectStore('profiles').put({ ...opened.profile, schemaVersion: 1 });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  // Следующая запись приложения падает с schema_unsupported → баннер + pending-ключ.
  await p.locator('#prompt').fill('ещё текст после отката');
  await p.waitForSelector('.schema-banner', { timeout: 15000 });
  assert.match(await p.locator('.schema-banner').innerText(), /обновите страницу/, 'баннер «обновите страницу» виден');
  const pending = await p.evaluate(() => {
    const raw = localStorage.getItem('briix-studio-pending-v1-вкладка-v1');
    return raw ? JSON.parse(raw) : null;
  });
  assert.ok(pending?.profile?.sessions?.length >= 1, 'несохранённое сериализовано в temporary-ключ briix-studio-pending-v1-<nick>');
  assert.ok(pending.capturedAt > 0, 'capturedAt проставлен');
  // Хранилище не изменилось записью v1-вкладки (гейт стоит на месте).
  await p.reload();
  await p.waitForSelector('#studio:not([hidden])');
  await p.waitForSelector('.confirm-overlay:not([hidden])', { timeout: 15000 });
  assert.match(await p.locator('.confirm-dialog').innerText(), /Восстановить несохранённое/, 'после обновления предложено восстановить pending');
  await p.getByRole('button', { name: 'Восстановить' }).click();
  await p.waitForFunction(() => localStorage.getItem('briix-studio-pending-v1-вкладка-v1') === null, {}, { timeout: 10000 });
  const restoredCount = await p.evaluate(async () => (await BriixSessionStore.open('вкладка-v1')).profile.sessions.length);
  assert.ok(restoredCount >= 1, 'pending-сессии влиты в профиль (дедуп по id)');
  assert.equal(await p.locator('.schema-banner').count(), 0, 'после перезагрузки баннер снят (v2-код пишет снова)');
  ok('schema gate: v1 tab gets honest banner + pending key; v2 restores and clears it (П1 SPEC #35)');
  await p.close();

  assert.deepEqual(errors, [], 'no page errors anywhere');
  await browser.close();
  staticSrv.close();
  bff.close();
  console.log('SUITE PASS: ' + results.length + ' checks');
})().catch(e => { console.error('SUITE FAIL:', e); process.exit(1); });
