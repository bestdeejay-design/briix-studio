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

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.m4a': 'audio/mp4', '.json': 'application/json', '.woff2': 'font/woff2' };
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
    chatPosts: [], chatBlocked: false, chatImproveText: 'УЛУЧШЕННЫЙ ТЕКСТ', chatSlow: false, improveDelay: 0, favoriteFail: false, coverRateLimit: 0, coverRequests: 0, audioRequests: 0, photoRequests: 0, fileOrder: [], fileDelay: 0, activeFiles: 0, maxActiveFiles: 0,
    jobPosts: [], jobBlock: false, pollFailures: [], pollAttempts: 0, polls: 0, deleted: {}, favs: {}, jobSeq: 1, pollsOf: {}, cancels: [], foreign: []
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
    }
  }, intervalMs);
  res.on('close', () => clearInterval(timer));
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
          if (state.chatSlow) return sse(res, 'медленное слово '.repeat(80), 120);
          // Разговорный музыкальный режим (вариант B): наставник отвечает разговорно
          // и всегда с draft-блоком в маркер-формате клиента.
          if (/Продюсер|Лирик|Автор песни/.test(body.messages[0]?.content || '')) {
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
        const finish = () => { current.activeFiles--; res.writeHead(200, { 'Content-Type': isWav ? 'audio/wav' : music ? 'audio/mp4' : 'image/png', ...cors }); res.end(isWav ? WAV : music ? M4A : PNG); };
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

  async function page({ viewport = { width: 1440, height: 1000 }, token = TOKEN, user = 'tester' } = {}) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const p = await context.newPage();
    p.on('pageerror', e => errors.push(e.message));
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

  // 1. Загрузка без ошибок, 3 режима, чип помощника по режимам, состояния send.
  let p = await page();
  await p.waitForTimeout(300);
  assert.deepEqual(errors, [], 'no page errors on load');
  assert.equal(await p.locator('.mode').count(), 3);
  assert.equal(await p.locator('.mode[data-mode="chat"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await p.locator('#send').isDisabled(), true, 'send disabled on empty field');
  assert.equal(await p.locator('#assistantChip').isVisible(), true, 'assistant is a toolbar chip');
  // Чат: 3 помощника в меню чипа.
  await p.locator('#assistantChip').click();
  assert.equal(await p.locator('#assistantMenu button').count(), 7, 'chat has 7 assistants');
  assert.match(await p.locator('#assistantMenu').innerText(), /Универсальный/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Маркетолог/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Наставник/);
  assert.equal(await p.locator('#assistantMenu button').first().evaluate(el => el === document.activeElement), true);
  await p.keyboard.press('ArrowDown');
  assert.equal(await p.locator('#assistantMenu button').nth(1).evaluate(el => el === document.activeElement), true);
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#assistantChip').evaluate(el => el === document.activeElement), true);
  assert.equal(await p.locator('#assistantMenu').isVisible(), false, 'Escape closes the menu');
  // Фото: 1 помощник, музыкальные чипы скрыты.
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#assistantChip').click();
  assert.equal(await p.locator('#assistantMenu button').count(), 2, 'photo has 2 assistants');
  assert.match(await p.locator('#assistantMenu').innerText(), /Арт-директор/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Визуальный дизайнер/);
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#modelChip').isVisible(), false, 'model chip hidden outside music');
  // Музыка: 2 помощника + муз-чипы видимы.
  await p.locator('.mode[data-mode="music"]').click();
  await p.locator('#assistantChip').click();
  assert.equal(await p.locator('#assistantMenu button').count(), 3, 'music has 3 assistants');
  assert.match(await p.locator('#assistantMenu').innerText(), /Продюсер/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Лирик/);
  assert.match(await p.locator('#assistantMenu').innerText(), /Автор песни/);
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#modelChip').isVisible(), true, 'model chip visible in music');
  assert.equal(await p.locator('#vocalSeg').isVisible(), true, 'track-mode segmented control visible in music');
  assert.equal(await p.locator('#tuneToggle').isVisible(), true, 'fine-tune toggle visible in music');
  assert.equal(await p.locator('#advanced').isVisible(), false, 'advanced fields hidden by default (Simple)');
  // Поле активно — send разблокируется.
  await p.locator('#prompt').fill('dream pop track');
  assert.equal(await p.locator('#send').isDisabled(), false, 'send enabled once the prompt is filled');
  assert.equal(await p.locator('#genTrack').isDisabled(), false, 'explicit Generate button enabled once the prompt is filled');
  await p.locator('#prompt').fill('');
  ok('loads clean, 3 modes, assistant chip menus per mode, music toolbar', {});

  // 2. Инлайн-ввод ключа, когда localStorage пуст.
  p = await page({ token: '' });
  await p.locator('.mode[data-mode="chat"]').click();
  await p.locator('#prompt').fill('привет');
  await p.locator('#send').click();
  await p.waitForSelector('#keyCard:not([hidden])');
  await p.locator('#keyInput').fill(TOKEN);
  await p.locator('#keySave').click();
  const stored = await p.evaluate(() => localStorage.getItem('briix-media-live-token'));
  assert.equal(stored, TOKEN);
  ok('missing key shows inline card, saved to localStorage', {});

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
  assert.match(await p.locator('#prompt').getAttribute('placeholder'), /Опиши трек/);
  ok('make-track switches to music with the brief prefilled', {});

  // 5. «Тонко настроить»: два поля, улучшение лирики (few-shot, non-stream, отмена).
  await p.locator('#prompt').fill('');
  await p.locator('#tuneToggle').click();
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
  assert.equal(musicPost.prompt, 'dream pop, 90 BPM, female vocals');
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
  await p.locator('.seg-btn[data-vocal="1"]').click();
  assert.equal(await p.locator('.seg-btn[data-vocal="1"]').getAttribute('aria-pressed'), 'true', 'instrumental mode explicitly selected');
  await p.locator('#modelChip').click();
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
  await p.locator('.seg-btn[data-vocal="0"]').click();
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

  // 9. Модерация 422 в чате и в джобе: карточка + сохранение текста.
  state.chatBlocked = true;
  await p.locator('.mode[data-mode="chat"]').click();
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

  // 11. Параллельная лента: стрим в чате + джоба одновременно; ✕ в карточке гасит только свой поток.
  p = await page();
  state.chatSlow = true;
  await p.locator('#prompt').fill('останови меня');
  await p.locator('#prompt').press('Enter'); // Enter = отправка в чате
  await p.waitForSelector('.card.assistant .stream-stop, .card.assistant .wait-row .stage-stop', { timeout: 10000 });
  // Не дожидаясь конца стрима — запускаем фото-джобу (переключение режимов и генерация параллельно).
  await p.locator('.mode[data-mode="photo"]').click();
  await p.locator('#prompt').fill('параллельный маяк');
  await p.locator('#send').click();
  await p.waitForSelector('.card.stage .stage-stop', { timeout: 10000 });
  // Пока ответ идёт, можно писать черновик, но второй ход ждёт завершения первого.
  await p.locator('.mode[data-mode="chat"]').click();
  await p.locator('#prompt').fill('пока жду — ещё вопрос');
  assert.equal(await p.evaluate(() => document.getElementById('send').disabled), true, 'second chat turn waits for current reply');
  assert.equal(await p.locator('#chatPending').isVisible(), true);
  // ✕ гасит только чат-стрим: джоба продолжает жить.
  await p.locator('.card.assistant .stage-stop').first().click();
  await p.waitForSelector('.card.assistant .stopped-note', { timeout: 10000 });
  assert.equal(await p.locator('#send').isDisabled(), false, 'chat draft can be sent after stopping reply');
  const stageStillThere = await p.locator('.card.stage').count();
  assert.equal(stageStillThere >= 1, true, 'job card survives chat stream stop');
  await p.waitForSelector('.card img.media-in', { timeout: 20000 }); // джоба завершилась успехом
  state.chatSlow = false;
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
  await p.locator('.mode[data-mode="chat"]').click();
  await p.locator('#newChat').click();
  await p.waitForFunction(() => document.querySelectorAll('#feed .session-feed:not([hidden]) .card').length === 0);
  await p.locator('#sessionsOpen').click();
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

  // 15. Профиль-меню: ник, ключ через «Ключ стенда…», Escape закрывает меню.
  await p.locator('#profileBtn').click();
  await p.waitForSelector('#profileMenu:not([hidden])');
  assert.match(await p.locator('#profileNick').innerText(), /^tester$/, 'profile menu shows the nick');
  await p.locator('#profileKeyBtn').click();
  await p.waitForSelector('#keyCard:not([hidden])');
  assert.equal(await p.locator('#keyCard').isVisible(), true, 'key card opens from the profile menu');
  assert.match(await p.locator('#keyStatus').innerText(), /сохранён ✓/, 'key status line reflects saved state');
  assert.match(await p.locator('#profileKeyBtn').innerText(), /Ключ стенда ✓/, 'menu item marks the saved key');
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
  p.once('dialog', d => d.accept());
  await p.locator('#profileBtn').click();
  await p.waitForSelector('#profileMenu:not([hidden])');
  await p.locator('#profileLogoutBtn').click();
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
  await p.locator('.seg-btn[data-vocal="0"]').click(); // явно выбрать «Песня» → вокальный трек
  assert.equal(await p.locator('.seg-btn[data-vocal="0"]').getAttribute('aria-pressed'), 'true');
  await p.locator('#prompt').fill('душевная песня про город');
  // Решение владельца 15.11: send в Simple-режиме = диалог; явная генерация — кнопка «Сгенерировать трек».
  await p.locator('#genTrack').click();
  await p.waitForSelector('.card.assistant audio', { timeout: 25000 });
  const autoPost = state.jobPosts.at(-1);
  assert.equal(autoPost.params.instrumental, undefined, 'vocal job');
  assert.ok(String(autoPost.params.lyrics || '').length > 20, 'auto-lyrics wrote the lyrics on a fresh page');
  // Языковое правило #109: русская идея быстрого пути → ASCII английский промпт из brain-тегов.
  assert.ok(/^[\x20-\x7E\r\n]*$/.test(autoPost.prompt), 'quick path: Russian idea -> ASCII English prompt');
  assert.ok(autoPost.prompt.length <= 240, 'brain tag prompt <= 240 chars');
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
  await p.locator('#tuneToggle').click();
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
  await musicItem.locator('.lib-cover img').waitFor({ state: 'visible', timeout: 10000 }); // обложка-миниатюра (infra#77)
  const musicWho = await musicItem.locator('.who').innerText();
  assert.match(musicWho, /ace-step/i, 'music .who carries the model');
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
  await p.locator('.lib-item .action', { hasText: 'В избранное' }).first().click();
  await p.waitForSelector('.lib-item.fav', { timeout: 10000 }); // флаг летит на шину и обратно — ждём перерисовку
  assert.ok(await p.locator('.lib-item.fav').count() >= 1, 'favorite applied');
  await p.locator('.lib-filters .tag', { hasText: '★ Избранное' }).click();
  assert.ok(await p.locator('.lib-item').count() >= 1, 'favorite filter shows it');
  await p.locator('.lib-filters .tag', { hasText: 'Все' }).click();
  const beforeDel = await p.locator('.lib-item').count();
  p.once('dialog', d => d.accept());
  await p.locator('.lib-item .action', { hasText: 'Удалить' }).first().click();
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
    const wrap = (document.querySelector('.tabs') || document.querySelector('.composer-wrap')).getBoundingClientRect();
    const sizes = [...document.querySelectorAll('button, textarea, input')]
      .filter(el => el.offsetParent !== null && !el.closest('[hidden]'))
      .map(el => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height));
    return { bottomGap: window.innerHeight - Math.round(wrap.bottom), minTarget: Math.min(...sizes.filter(s => s > 0)) };
  });
  assert.ok(geo.bottomGap >= 0 && geo.bottomGap <= 16, 'composer + tabs pinned to viewport bottom, gap=' + geo.bottomGap);
  assert.ok(geo.minTarget >= 44, 'smallest touch target >= 44px, got ' + geo.minTarget);
  await p.screenshot({ path: path.join(require('node:os').tmpdir(), 'studio-390.png'), fullPage: false });
  // Музыка на мобайле: тулбар не ломается.
  await p.locator('.mode[data-mode="music"]').click();
  await p.locator('#tuneToggle').click();
  const overflow2 = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow2 <= 0, 'no h-scroll in music advanced at 390px, overflow=' + overflow2);
  await p.screenshot({ path: path.join(require('node:os').tmpdir(), 'studio-390-music.png'), fullPage: false });
  ok('mobile 390x844: composer sticky bottom, no h-scroll, touch targets >=44', { ...geo });


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
  await p.locator('.mode[data-mode="chat"]').click();
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
  await p.locator('#genTrack').click();
  await p.waitForSelector('.card.stage .stage-stop');
  await p.locator('#modelChip').click();
  await p.locator('#modelMenu button', { hasText: 'Pro' }).click();
  await p.locator('.seg-btn[data-vocal="1"]').click();
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
  await p.locator('.track-menu:not([hidden]) button', { hasText: 'Скачать' }).first().click();
  const downloaded = await downloadPromise;
  assert.match(downloaded.suggestedFilename(), /\.m4a$/);
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

  // Во время активного ответа выход запрещён, пока ответ не остановлен/не завершился.
  resetBff(); state.chatSlow = true;
  p = await page();
  await p.locator('#prompt').fill('Долгий ответ');
  await p.locator('#send').click();
  await p.waitForSelector('.card.assistant .stage-stop');
  p.once('dialog', d => d.accept());
  await p.locator('#profileBtn').click();
  await p.locator('#profileLogoutBtn').click();
  assert.equal(await p.locator('#studio').isVisible(), true);
  assert.match(await p.locator('.card.notice').last().innerText(), /активных операций/);
  await p.locator('.card.assistant .stage-stop').click();
  await p.waitForFunction(() => !document.querySelector('#status').classList.contains('busy'));
  p.once('dialog', d => d.accept());
  await p.locator('#profileBtn').click();
  await p.locator('#profileLogoutBtn').click();
  await p.waitForSelector('#gate:not([hidden])');
  assert.equal(await p.locator('#gate').isVisible(), true);
  state.chatSlow = false;
  ok('active session cannot leak into another profile');


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
  // Волна из peaks.json строится сразу при карточке, до загрузки аудио.
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
  p = await page({ viewport: { width: 320, height: 568 } });
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
  await p.locator('#tuneToggle').click();
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
    await legacy.locator('#newChat').click();
    await legacy.waitForFunction(() => document.querySelectorAll('#feed .session-feed:not([hidden]) .card').length === 0);
    await legacy.locator('#prompt').fill('Новая идея'); await legacy.locator('#send').click();
    await legacy.waitForSelector('#feed .session-feed:not([hidden]) .make-track');
    await legacy.locator('#sessionsOpen').click();
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
  await p.locator('.seg-btn[data-vocal="1"]').click();
  const fullPrompt = 'Музыкальная идея ' + 'ритм '.repeat(70);
  await p.locator('#prompt').fill(fullPrompt);
  await p.locator('#genTrack').click();
  await p.locator('.mode[data-mode="chat"]').click();
  await p.locator('#newChat').click();
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
  await p.locator('#sessionsOpen').click();
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
  await p.locator('.seg-btn[data-vocal="1"]').click();
  const repeatPrompt = ('длинная музыкальная идея '.repeat(15)).trim();
  await p.locator('#prompt').fill(repeatPrompt); await p.locator('#genTrack').click();
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
  assert.equal(state.jobPosts[1].prompt, 'long musical idea, rhythmic, atmospheric, instrumental');
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
  await p.locator('#prepareMusic').click();
  await p.locator('.producer-draft').first().waitFor();
  assert.equal(state.jobPosts.length, 0, 'preparing does not start audio generation');
  assert.equal(await p.locator('#prompt').inputValue(), idea, 'original input is not overwritten');
  assert.match(state.chatPosts[0].messages[1].content, /собаке/);
  assert.equal(await p.locator('.producer-warning').first().isVisible(), true);
  const review = p.locator('.producer-draft').first();
  await review.locator('[data-producer-field="title"]').fill('Новые огни');
  await review.locator('[data-producer-field="lyrics"]').fill('[Verse]\nMa propre chanson');
  await review.getByRole('button', { name: 'Принять в поля студии' }).click();
  await p.waitForFunction(() => document.querySelector('#musicPrompt').value === 'dream pop, 72 BPM, no guitar');
  assert.equal(await p.locator('#lyrics').inputValue(), '[Verse]\nMa propre chanson');
  assert.equal(state.jobPosts.length, 0, 'accepting does not start audio generation');
  await p.reload();
  await p.locator('.producer-draft').first().waitFor();
  assert.equal(await p.locator('[data-producer-field="title"]').first().inputValue(), 'Новые огни');
  assert.equal(await p.locator('#musicPrompt').inputValue(), 'dream pop, 72 BPM, no guitar');
  p.once('dialog', dialog => dialog.accept());
  await p.getByRole('button', { name: 'Вернуть поля до принятия' }).first().click();
  await p.waitForFunction(() => !document.querySelector('#prompt').hidden);
  assert.equal(await p.locator('#prompt').inputValue(), idea);
  assert.equal(state.jobPosts.length, 0);
  ok('producer mobile: review/edit/apply/restore and reload, no implicit audio job');

  // Existing authored lyrics are sent as context but never replaced by the LLM.
  resetBff(); state.chatImproveText = JSON.stringify({ title: 'Моё', prompt: 'jazz piano', lyrics: 'другая лирика' });
  p = await page(); await p.locator('.mode[data-mode="music"]').click(); await p.locator('#tuneToggle').click();
  await p.locator('#musicPrompt').fill('джаз по моей лирике');
  await p.locator('#lyrics').fill('Моя собственная строка');
  await p.locator('#prepareMusic').click(); await p.locator('.producer-draft').waitFor();
  assert.equal(await p.locator('[data-producer-field="lyrics"]').inputValue(), 'Моя собственная строка');
  assert.match(state.chatPosts[0].messages[1].content, /Моя собственная строка/);
  await p.locator('#lyrics').fill('Новая правка в ожидании');
  p.once('dialog', dialog => dialog.dismiss());
  await p.getByRole('button', { name: 'Принять в поля студии' }).click();
  assert.equal(await p.locator('#lyrics').inputValue(), 'Новая правка в ожидании');
  p.once('dialog', dialog => dialog.accept());
  await p.getByRole('button', { name: 'Принять в поля студии' }).click();
  await p.waitForFunction(() => document.querySelector('#lyrics').value === 'Моя собственная строка');
  await p.locator('.producer-idea summary').click();
  assert.match(await p.locator('.producer-idea').innerText(), /Новая правка в ожидании/);
  ok('producer keeps authored lyrics and guards newer edits with recoverable backup');

  // Instrumental, incorrect JSON and moderation leave the source untouched.
  resetBff(); state.chatImproveText = JSON.stringify({ title: 'Рассвет', prompt: 'ambient synth', lyrics: '' });
  p = await page(); await p.locator('.mode[data-mode="music"]').click(); await p.locator('.seg-btn[data-vocal="1"]').click();
  await p.locator('#prompt').fill('инструментал без вокала'); await p.locator('#prepareMusic').click();
  await p.locator('.producer-draft').waitFor();
  assert.equal(await p.locator('[data-producer-field="lyrics"]').count(), 0);
  await p.getByRole('button', { name: 'Принять в поля студии' }).click();
  await p.waitForFunction(() => document.querySelector('#musicPrompt').value === 'ambient synth');
  await p.locator('#genTrack').click(); await p.waitForSelector('#feed audio', { timeout: 25000 });
  assert.equal(state.jobPosts[0].params.instrumental, true);
  assert.equal(state.jobPosts[0].params.duration, undefined);
  ok('instrumental review and explicit generation, no duration parameter');
  resetBff(); state.chatImproveText = '{broken';
  p = await page(); await p.locator('.mode[data-mode="music"]').click(); await p.locator('#prompt').fill('Сохранить идею');
  await p.locator('#prepareMusic').click(); await p.getByText('Ответ для ручного восстановления').waitFor();
  assert.equal(await p.locator('#prompt').inputValue(), 'Сохранить идею');
  assert.equal(await p.locator('.producer-draft').count(), 0);
  state.chatBlocked = true; await p.locator('#prepareMusic').click();
  await p.locator('.card.error', { hasText: 'Модерация' }).waitFor();
  assert.equal(await p.locator('#prompt').inputValue(), 'Сохранить идею');
  ok('malformed response and moderation preserve original');

  // Cancellation and a parallel chat must not modify the originating music input.
  resetBff(); state.improveDelay = 1200;
  state.chatImproveText = JSON.stringify({ title: 'Песня', prompt: 'jazz', lyrics: 'слова' });
  p = await page(); await p.locator('.mode[data-mode="music"]').click(); await p.locator('#prompt').fill('Отменяемая идея');
  await p.locator('#prepareMusic').click();
  await p.getByRole('button', { name: 'Отменить подготовку песни' }).click();
  await p.getByText('Подготовка отменена').waitFor();
  assert.equal(await p.locator('#prompt').inputValue(), 'Отменяемая идея');
  await p.waitForTimeout(1400); assert.equal(await p.locator('.producer-draft').count(), 0);
  await p.locator('#prepareMusic').click();
  await p.locator('.mode[data-mode="chat"]').click(); await p.locator('#prompt').fill('Параллельный вопрос'); await p.locator('#send').click();
  await p.locator('.card.assistant', { hasText: 'Стрим пришёл' }).waitFor();
  await p.locator('.producer-draft').waitFor();
  assert.equal(state.jobPosts.length, 0);
  await p.locator('.mode[data-mode="music"]').click(); assert.equal(await p.locator('#prompt').inputValue(), 'Отменяемая идея');
  ok('producer cancellation and parallel chat preserve the music draft');

  // A late response stays in its original session even while a new one is active.
  resetBff(); state.improveDelay = 3000;
  state.chatImproveText = JSON.stringify({ title: 'Первый', prompt: 'jazz trio', lyrics: 'исходные слова' });
  p = await page(); await p.locator('#prompt').fill('Первая сессия продюсера'); await p.locator('#send').click();
  await p.locator('.card.assistant', { hasText: 'Стрим пришёл' }).waitFor();
  await p.locator('.mode[data-mode="music"]').click(); await p.locator('#prompt').fill('Идея первой сессии');
  await p.locator('#prepareMusic').click(); await p.locator('.mode[data-mode="chat"]').click(); await p.locator('#newChat').click();
  await p.waitForFunction(() => document.querySelector('.mode[data-mode="chat"]').getAttribute('aria-pressed') === 'true');
  await p.waitForTimeout(3400);
  assert.equal(await p.locator('.session-feed:not([hidden]) .producer-draft').count(), 0);
  await p.locator('#sessionsOpen').click();
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
  await p.locator('#prepareMusic').click(); await p.locator('.card.error').waitFor();
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
  // Self-refine: второй ход сохраняет историю диалога.
  await p.locator('#prompt').fill('поправь припев');
  await p.locator('#send').click();
  await p.waitForFunction(() => document.querySelectorAll('.music-draft').length >= 2, {}, { timeout: 15000 });
  assert.equal(state.jobPosts.length, 0, 'refinement turn still does not generate');
  const refinePost = state.chatPosts.at(-1);
  assert.ok(refinePost.messages.some(m => m.role === 'user' && m.content === 'хочу песню про осень'), 'dialog history is sent to the mentor');
  // Явная генерация из draft-блока: promptReady-путь, промпт наставника уходит как есть.
  await p.locator('.music-draft').last().getByRole('button', { name: 'Сгенерировать трек' }).click();
  await p.waitForSelector('#feed audio', { timeout: 30000 });
  assert.equal(state.jobPosts.length, 1, 'draft Generate creates exactly one job');
  assert.equal(state.jobPosts[0].prompt, 'dream pop, 90 BPM, warm female vocals', 'promptReady path: the mentor prompt is not rewritten');
  assert.match(state.jobPosts[0].params.lyrics, /Новая строка/);
  assert.equal(state.jobPosts[0].params.title, 'Черновик наставника', 'params.title carries the draft title');
  assert.equal(state.jobPosts[0].params.artist, 'tester', 'params.artist is the user nick');
  assert.equal(state.chatPosts.filter(x => x.stream === false && x.max_tokens === 300).length, 0, 'promptReady path skips silent translation');
  // Диалог и черновики персистятся в session-store.
  const savedDialog = await p.evaluate(async () => {
    const { profile } = await BriixSessionStore.open('tester');
    const s = profile.sessions[0];
    return { history: s.musicChat?.history?.length || 0, assistant: s.musicChat?.assistant, drafts: s.feed.filter(x => x.t === 'music_draft').length };
  });
  assert.ok(savedDialog.history >= 4, 'music dialog persisted in session-store');
  assert.equal(savedDialog.assistant, 'lyricist');
  assert.ok(savedDialog.drafts >= 2, 'draft cards persisted in the feed');
  await p.reload();
  await p.waitForSelector('.music-draft', { timeout: 10000 });
  // Отдельная кнопка «Сгенерировать трек» в композере: явная генерация без диалога.
  await p.locator('#prompt').fill('спокойный эмбиент для чтения');
  await p.locator('#genTrack').click();
  await p.waitForFunction(() => document.querySelectorAll('#feed audio').length >= 1, {}, { timeout: 30000 });
  assert.equal(state.jobPosts.length, 2, 'composer Generate button creates a job without a dialog turn');
  assert.ok(/^[\x20-\x7E]*$/.test(state.jobPosts[1].prompt), 'quick-path assembly still yields an English prompt');
  ok('music chat: send converses without jobs, mentor system used, draft accept/generate, dialog persisted, explicit composer Generate');

  // ---- Анатомия карточки трека (общая для ленты и Библиотеки) --------------------
  resetBff();
  p = await page();
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
  // Единое меню «⋯»: ровно 7 действий.
  await p.locator('#feed .menu-btn').click();
  const menuTexts = await p.locator('.track-menu:not([hidden]) button').allInnerTexts();
  for (const label of ['Копировать промпт', 'Копировать лирику', 'Скачать', 'Повторить с правками', 'Создать обложку', 'В избранное', 'Удалить']) {
    assert.ok(menuTexts.some(t => t.includes(label)), 'menu contains: ' + label);
  }
  assert.equal(menuTexts.length, 7, 'exactly the seven actions in the unified menu');
  await p.keyboard.press('Escape');
  // Transparency: что уехало в модель + название/исполнитель + источник лирики.
  await p.locator('#feed .track-details summary').click();
  const transparency = await p.locator('#feed .track-details').innerText();
  assert.match(transparency, /Что уехало в модель/);
  assert.match(transparency, /assembled english prompt/);
  assert.match(transparency, /Название: Тест: Трек\/№1\?/);
  assert.match(transparency, /Исполнитель: tester/);
  assert.match(transparency, /Источник лирики: наставник: Лирик/);
  // Имя файла скачивания: sanitize с сохранением кириллицы, спецсимволы вырезаны.
  const dlCardPromise = p.waitForEvent('download');
  await p.locator('#feed .menu-btn').click();
  await p.locator('.track-menu:not([hidden]) button', { hasText: 'Скачать' }).click();
  assert.equal((await dlCardPromise).suggestedFilename(), 'Тест Трек №1 - tester.wav',
    'download name: sanitized title - artist, cyrillic kept, special characters removed');
  ok('track card: cover=play, auto waveform with click-seek, unified 7-action menu, transparency, sanitized filename');

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

  assert.deepEqual(errors, [], 'no page errors anywhere');
  await browser.close();
  staticSrv.close();
  bff.close();
  console.log('SUITE PASS: ' + results.length + ' checks');
})().catch(e => { console.error('SUITE FAIL:', e); process.exit(1); });
