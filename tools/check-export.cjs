/* #35 волна 1: экспорт v1 (SPEC #35 §3, W1-4, П3).
 * Меню вариантов WAV/M4A/обложка, MP3 скрыт, имена файлов по запрошенному варианту
 * (дизамбиг extOf), честная деградация WAV до правок бэффа, allow-list ?refetch=1,
 * три статуса блока обложки (есть / не удалась), скачивание обложки.
 * Запуск: NODE_PATH=/opt/homebrew/lib/node_modules node tools/check-export.cjs
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./browser-env.cjs');
const ROOT = path.resolve(__dirname, '..');
const STATIC_PORT = Number(process.env.BRIIX_STUDIO_STATIC_PORT || 18392);
const BFF_PORT = Number(process.env.BRIIX_STUDIO_BFF_PORT || 18304);
const TOKEN = 'test-token';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.m4a': 'audio/mp4', '.json': 'application/json' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const M4A = fs.existsSync(path.join(ROOT, 'assets/media/showcase/ballad30.m4a')) ? fs.readFileSync(path.join(ROOT, 'assets/media/showcase/ballad30.m4a')) : Buffer.from('fake-m4a');

const state = { fileRequests: [] };
function resetBff() { state.fileRequests = []; }

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

function bffServer(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const origin = req.headers.origin;
      const cors = { 'Access-Control-Allow-Origin': origin === `http://127.0.0.1:${STATIC_PORT}` ? origin : '', Vary: 'Origin' };
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type' }); res.end(); return; }
      const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
      if (req.url === '/health') { send(200, { ok: true }); return; }
      if (req.url === '/v1/models') { send(200, { object: 'list', data: [{ id: 'ace-step-flash', object: 'model', status: 'ready', capabilities: ['song.vocal'], latency: { source: 'measured', seconds: 111, conditions: '' } }] }); return; }
      if (req.headers.authorization !== 'Bearer ' + TOKEN) { send(401, { error: { code: 'unauthorized', message: 'no' } }); return; }
      if (req.url === '/jobs' && req.method === 'POST') {
        send(202, { job_id: 'job-x1' });
        return;
      }
      const getJob = req.url.match(/^\/jobs\/([^/]+)$/);
      if (getJob && req.method === 'GET') {
        // Готовый трек БЕЗ cover_url: mux ушёл без обложки (sd-cli упал) — статус «не удалась».
        send(200, { id: getJob[1], type: 'music', status: 'ready', result_url: '/files/' + getJob[1] + '.m4a', cover_url: '' });
        return;
      }
      if (req.url.split('?')[0] === '/jobs' && req.method === 'GET') {
        const items = [
          { id: 'job-full', type: 'music', status: 'ready', prompt: 'трек с обложкой', params: { artist: 'tester', model: 'ace-step-flash', title: 'Полный', lyrics: '[Verse]\nСтрока' }, result_url: '/files/job-full.m4a', cover_url: '/files/job-full-cover.png', favorite: false, created_at: 1794000000 },
          { id: 'job-nocover', type: 'music', status: 'ready', prompt: 'трек без обложки', params: { artist: 'tester', model: 'ace-step-flash', title: 'Без обложки' }, result_url: '/files/job-nocover.m4a', cover_url: '', favorite: false, created_at: 1794000001 }
        ];
        send(200, { total: items.length, limit: 100, offset: 0, items });
        return;
      }
      if (req.url.startsWith('/files/')) {
        state.fileRequests.push(req.url);
        const noQuery = req.url.split('?')[0];
        if (noQuery.endsWith('.wav')) {
          // Спека §7а: до правок бэффа WAV из хранилища недоступен — честный 404.
          res.writeHead(404, { 'Content-Type': 'application/json', ...cors });
          res.end(JSON.stringify({ error: { code: 'not_found' } }));
          return;
        }
        if (noQuery.endsWith('-cover.png')) {
          res.writeHead(200, { 'Content-Type': 'image/png', ...cors });
          res.end(PNG);
          return;
        }
        if (noQuery.endsWith('.m4a')) {
          // ?refetch=1 разрешён (allow-list P3-2); другие query и до этого отвергались бы
          // клиентом — здесь просто отдаём файл.
          res.writeHead(200, { 'Content-Type': 'audio/mp4', ...cors });
          res.end(M4A);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', ...cors });
        res.end(Buffer.from('raw-bytes'));
        return;
      }
      const peaks = Array.from({ length: 40 }, (_, i) => 0.3 + 0.4 * Math.abs(Math.sin(i / 4)));
      const peaksM = req.url.match(/^\/files\/([^/]+)-peaks\.json$/);
      if (peaksM) { res.writeHead(200, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify({ id: peaksM[1], duration: 30, peaks })); return; }
      send(404, { error: { code: 'not_found', message: 'nf' } });
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

(async () => {
  const staticSrv = await staticServer(STATIC_PORT);
  const bff = await bffServer(BFF_PORT);
  const browser = await launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const p = await context.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(({ t, port }) => {
      localStorage.setItem('briix-media-live-token', t);
      localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:' + port));
      localStorage.setItem('briix-studio-profiles', JSON.stringify({ tester: { pinHash: 'x', created: 0 } }));
      localStorage.setItem('briix-studio-user', 'tester');
      localStorage.setItem('briix-studio-library-tester', JSON.stringify([
        { job: 'job-full', sessionId: 's0', kind: 'music', prompt: 'трек с обложкой', lyrics: '[Verse]\nСтрока', title: 'Полный', model: 'ace-step-flash', file: '/files/job-full.m4a', cover: '/files/job-full-cover.png', created: Date.now(), fav: false },
        { job: 'job-nocover', sessionId: 's0', kind: 'music', prompt: 'трек без обложки', lyrics: '', title: 'Без обложки', model: 'ace-step-flash', file: '/files/job-nocover.m4a', cover: '', created: Date.now() - 1, fav: false }
      ]));
    }, { t: TOKEN, port: BFF_PORT });
    await p.goto(`http://127.0.0.1:${STATIC_PORT}/studio/index.html`);
    await p.waitForSelector('#send');

    // 1. Карточка с обложкой: обложка показана, статуса «не удалась» нет.
    await p.locator('.tab[data-tab="library"]').click();
    await p.waitForSelector('.lib-results .lib-item', { timeout: 10000 });
    const fullItem = p.locator('.lib-item', { hasText: 'Полный' });
    await fullItem.locator('.lib-cover img').waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await fullItem.locator('.cover-status').count(), 0, 'есть обложка — плашки нет');

    // 2. Честный статус «не удалась» у трека без cover_url (П3 SPEC #35).
    const noCoverItem = p.locator('.lib-item', { hasText: 'Без обложки' });
    await noCoverItem.waitFor();
    const noCoverStatus = noCoverItem.locator('.cover-status');
    await noCoverStatus.waitFor({ timeout: 10000 });
    assert.match(await noCoverStatus.innerText(), /Обложка не сгенерировалась/, 'готовый трек без cover_url — видимая плашка, не молчаливый placeholder');

    // 3. Меню «⋯»: M4A + WAV + обложка; MP3 скрыт до бэффа (SPEC §3, W1-4).
    await fullItem.locator('.menu-btn').click();
    const menuTexts = await p.locator('.track-menu:not([hidden]) button').allInnerTexts();
    assert.ok(menuTexts.some(t => t.includes('Скачать аудио (M4A)')), 'M4A item present');
    assert.ok(menuTexts.some(t => t.includes('Скачать WAV — мастер без тегов')), 'WAV item with honest caption');
    assert.ok(menuTexts.some(t => t.includes('Скачать обложку')), 'cover item present');
    assert.ok(!menuTexts.some(t => /MP3/i.test(t)), 'MP3 item hidden until backend ships it');

    // 4. M4A скачивается с честным именем «Название - Исполнитель.m4a».
    const m4aDownload = p.waitForEvent('download');
    await p.locator('.track-menu:not([hidden]) button', { hasText: 'Скачать аудио (M4A)' }).click();
    assert.match((await m4aDownload).suggestedFilename(), /Полный - tester\.m4a$/, 'M4A download keeps the unified name');

    // 5. Обложка скачивается отдельным пунктом (.png).
    await fullItem.locator('.menu-btn').click(); // меню закрылось после выбора — открываем заново
    const coverDownload = p.waitForEvent('download');
    await p.locator('.track-menu:not([hidden]) button', { hasText: 'Скачать обложку' }).click();
    assert.match((await coverDownload).suggestedFilename(), /Полный - tester\.png$/, 'cover downloads as .png with the track name');

    // 6. WAV деградирует честно: 404 от сервера → тост-ошибка без фейков и крашей.
    await fullItem.locator('.menu-btn').click();
    await p.locator('.track-menu:not([hidden]) button', { hasText: 'Скачать WAV — мастер без тегов' }).click();
    await p.waitForSelector('.lib-error', { timeout: 10000 });
    assert.match(await p.locator('.lib-error').last().innerText(), /WAV-мастер/, 'WAV degrade is an explicit error, not a fake file');
    assert.ok(state.fileRequests.some(u => u.endsWith('/files/job-full.wav')), 'WAV request went to the server path');
    await p.keyboard.press('Escape');

    // 7. Allow-list ?refetch=1 (P3-2): запрос с ним уходит, сервер его получает.
    //    (клиентский fileBlob больше не отвергает refetch на /files/{id}.m4a)
    await p.evaluate(async () => {
      const { profile, backend } = await BriixSessionStore.open('tester');
      profile.sessions[0] ||= { id: 's0', title: 'x', createdAt: 1, updatedAt: 1, feed: [], history: [] };
      profile.sessions[0].feed.push({ t: 'media', who: 'Трек refetch', kind: 'music', job: 'job-full', file: '/files/job-full.m4a?refetch=1', cover: '/files/job-full-cover.png', input: { title: 'Полный', artist: 'tester', prompt: 'p' } });
      await BriixSessionStore.save(profile, profile.revision, backend);
    });
    // Приложение держит свой in-memory профиль — перечитываем из хранилища reload-ом.
    await p.reload();
    await p.waitForSelector('#feed .track-cover', { timeout: 15000 });
    await p.locator('#feed .track-cover').first().click();
    await p.waitForSelector('#feed audio', { timeout: 15000 });
    assert.ok(state.fileRequests.some(u => u === '/files/job-full.m4a?refetch=1'), '?refetch=1 passed the client allow-list and reached the server');

    // 8. Другие query по-прежнему отвергаются (unsafe_url → честная карточка ошибки).
    await p.evaluate(async () => {
      const { profile, backend } = await BriixSessionStore.open('tester');
      profile.sessions[0].feed.push({ t: 'media', who: 'Трек unsafe', kind: 'music', job: 'job-bad', file: '/files/job-full.m4a?evil=1', cover: '', input: { title: 'X', artist: 'tester' } });
      await BriixSessionStore.save(profile, profile.revision, backend);
    });
    await p.reload();
    await p.waitForFunction(() => document.querySelectorAll('#feed .track-cover').length >= 2, {}, { timeout: 15000 });
    await p.locator('#feed .track-cover').last().click(); // у unsafe-карточки обложка = повтор загрузки
    await p.waitForSelector('#feed .load-error', { timeout: 15000 });
    assert.match(await p.locator('#feed .load-error').first().innerText(), /недоступен|Недоверенный|ошибка/i, 'unknown query stays rejected');
    assert.ok(!state.fileRequests.some(u => u.includes('evil=1')), 'rejected URL never reached the server');

    // 9. Инвариант П3: у каждой карточки трека есть блок обложки (есть или честный статус).
    const invariant = await p.evaluate(() => {
      const feedCards = [...document.querySelectorAll('#feed .track-card')];
      const libCards = [...document.querySelectorAll('.lib-item .track-card')];
      const feedOk = feedCards.every(c => c.querySelector('.track-cover'));
      const libOk = libCards.every(c => c.closest('.lib-item')?.querySelector('.lib-cover'));
      return feedOk && libOk && document.querySelectorAll('.cover-status').length >= 1;
    });
    assert.equal(invariant, true, 'every track card has a cover block with an honest status');

    assert.deepEqual(errors, [], 'no page errors');
    console.log('PASS export v1: WAV/M4A/cover menu, honest degrade, refetch allow-list, cover statuses');
  } finally {
    await browser.close();
    await new Promise(resolve => staticSrv.close(resolve));
    await new Promise(resolve => bff.close(resolve));
  }
})().catch(error => { console.error('SUITE FAIL:', error); process.exit(1); });
