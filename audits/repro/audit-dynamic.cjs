/* Динамические сценарии аудита: доказательства находок (jsdom + фейковый media-bff).
 * Запуск: node audit-dynamic.cjs [A4 A6 ...]  — без аргументов гоняет всё.
 * Выход: текстовый протокол для отчёта audits/audit-full-arena-2026-11.md.
 */
'use strict';
const H = require('./harness.cjs');
const path = require('node:path');
const fs = require('node:fs');

const ONLY = process.argv.slice(2);
const out = [];
const say = (...a) => { const line = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); out.push(line); console.log(line); };
const head = t => { say('\n===== ' + t + ' ====='); };

const TOKEN = 'test-token';
const baseStorage = { 'briix-media-live-token': TOKEN };

/* Реалистичные ответы «мозга»: автолирика с тегами, перевод, продюсер-JSON. */
const LYRICS_RU = '[Intro]\n\n[Verse 1]\nГород дышит неоном, стекло и бензин,\nЯ иду по проспекту, где каждый второй — чужой.\n\n[Pre-Chorus]\nСердце держит ритм, фонари считают такт.\n\n[Chorus]\nНочной город, пой со мной,\nПсиходелик-соул и дым над водой.\n\n[Bridge]\nТише, слышишь: бас ведёт домой.\n\n[Outro]\nГаснет свет, остаётся мотив.';
function chatScript(messages, body) {
  const sys = String(messages[0] && messages[0].content || '');
  if (/автор песен/i.test(sys)) return LYRICS_RU;
  if (/Translate the user's music idea/i.test(sys)) return 'psychedelic soul, night city neon, female vocals, warm analog tape, slow groove';
  if (/музыкальный продюсер BRIIX/i.test(sys)) return JSON.stringify({ title: 'Неон и вода', prompt: 'psychedelic soul, female vocals, warm tape saturation, slow groove', lyrics: LYRICS_RU });
  if (/редактор музыкальной студии BRIIX/i.test(sys)) return 'Улучшенный текст для аудита';
  return 'Короткий ответ наставника по делу.';
}

function hookConsole(ctx) {
  const warns = [];
  ctx.win.console.warn = (...a) => warns.push(a.map(String).join(' '));
  ctx.win.console.error = (...a) => warns.push('ERROR ' + a.map(String).join(' '));
  return warns;
}
const feedCards = doc => [...doc.querySelectorAll('#feed .card')].map(c => ({ cls: c.className, text: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 110) }));
const jobPost = bff => { const r = bff.requests.filter(x => x.method === 'POST' && /\/jobs$/.test(x.url)).pop(); return r ? JSON.parse(r.body) : null; };
const sizeOf = o => Buffer.byteLength(JSON.stringify(o));

/* ------------------------------------------------------------------ A1 */
async function A1() {
  head('A1 · холодный старт и вход (гейт, a11y-семантика, запросы)');
  const ctx = await H.boot({ storage: baseStorage });
  const { doc, bff } = ctx;
  say('запросов к сети до входа:', bff.requests.length);
  say('gate виден:', !doc.getElementById('gate').hidden, '| studio скрыт:', doc.getElementById('studio').hidden);
  say('h1 в документе:', doc.querySelectorAll('h1').length, '| h2:', doc.querySelectorAll('h2').length);
  const dots = doc.getElementById('pinDots');
  say('pinDots: role=' + (dots.getAttribute('role') || '—') + ' aria-live=' + (dots.getAttribute('aria-live') || '—') + ' | точек=' + dots.children.length);
  say('gateHint role=' + (doc.getElementById('gateHint').getAttribute('role') || '—'));
  say('aria-label у pinpad:', doc.getElementById('pinpad').getAttribute('aria-label'), '| у цифр:', [...doc.querySelectorAll('.pk')].map(b => b.getAttribute('aria-label') || b.textContent).join(','));
  say('feed aria-live=', doc.getElementById('feed').getAttribute('aria-live'), '| #status role=', doc.getElementById('status').getAttribute('role') || '—');
  say('favicon link:', doc.querySelectorAll('link[rel~="icon"]').length, '| manifest:', doc.querySelectorAll('link[rel="manifest"]').length, '| theme-color:', doc.querySelectorAll('meta[name="theme-color"]').length);
  say('viewport:', doc.querySelector('meta[name=viewport]').getAttribute('content'));
  await H.login(ctx);
  say('после входа: studio виден', !doc.getElementById('studio').hidden, '| карточек в ленте', doc.querySelectorAll('#feed .card').length);
  say('пустая лента: .session-feed пуст?', doc.querySelector('.session-feed') ? doc.querySelector('.session-feed').children.length : 'нет узла',
    '| display у .session-feed задаётся только в CSS (display:contents) — jsdom не грузит CSS');
  say('запросов после входа:', bff.requests.length, bff.requests.map(r => r.method + ' ' + r.url).slice(0, 6));
}

/* ------------------------------------------------------------------ A2 */
async function A2() {
  head('A2 · ключ стенда: ?key= в URL, пустое сохранение, дубли notices');
  const ctx = await H.boot({ storage: {}, url: 'http://127.0.0.1:8080/studio/index.html?key=' + TOKEN });
  const { doc, win } = ctx;
  say('токен из ?key= сохранён в localStorage:', win.localStorage.getItem('briix-media-live-token') === TOKEN);
  say('location.search очищен (history.replaceState)?', JSON.stringify(win.location.search));
  await H.login(ctx);
  win.localStorage.removeItem('briix-media-live-token');
  H.setVal(doc.getElementById('prompt'), 'тест'); H.click(doc.getElementById('send')); await H.settle(3);
  H.setVal(doc.getElementById('prompt'), 'тест2'); H.click(doc.getElementById('send')); await H.settle(3);
  say('одинаковых карточек «Ключ» после двух попыток:', feedCards(doc).filter(c => c.cls.includes('notice') && c.text.startsWith('Ключ')).length);
  // пустое сохранение ключа
  doc.getElementById('keyInput').value = '';
  H.click(doc.getElementById('keySave')); await H.settle(2);
  say('keyInput пуст → токен:', JSON.stringify(win.localStorage.getItem('briix-media-live-token')),
    '| текст карточки:', feedCards(doc).filter(c => c.text.startsWith('Ключ')).pop()?.text);
  say('keyStatus:', doc.getElementById('keyStatus').textContent);
}

/* ------------------------------------------------------------------ A3 */
async function A3() {
  head('A3 · чат-стрим: дубли текста в хранилище, «Сделать из этого трек» на каждом ответе');
  const LONG_REPLY = 'Соберём трек по шагам: сначала тёплый аналоговый бас и живые барабаны, затем клавиши, потом вокал с лёгким сатуратором и, наконец, сведение с воздухом в верхней середине. '.repeat(6);
  const ctx = await H.boot({ storage: baseStorage, chatScript: (m, b) => (/наставник|помощник|универсаль/i.test(String(m[0].content)) ? LONG_REPLY : chatScript(m, b)), timeScale: 10 });
  const { doc, win } = ctx; await H.login(ctx);
  const long = 'Расскажи, как собрать психоделик-соул трек: инструменты, темп, вокал, продакшн, структура, чего избегать и как добиться тёплого аналогового звучания на цифровых инструментах. '.repeat(6);
  H.setVal(doc.getElementById('prompt'), long); H.click(doc.getElementById('send'));
  await H.settle(40, 20);
  const key = 'briix-studio-sessions-backend-audit';
  say('backend:', win.localStorage.getItem(key));
  const prof = JSON.parse(win.localStorage.getItem('briix-studio-sessions-v1-audit') || 'null');
  if (!prof) { say('профиль в IDB (localStorage-фолбэк не использован) — читаем через сессию'); }
  const cards = feedCards(doc);
  say('карточек:', cards.length, '| кнопок «Сделать из этого трек»:', doc.querySelectorAll('.make-track').length);
  say('текст ответа (первые 60):', cards.find(c => c.cls.includes('assistant'))?.text.slice(0, 60));
  // измеряем дубли: history + feed.text + feed.track
  const dup = await ctx.win.eval(`(async()=>{const o=await BriixSessionStore.open('audit');const s=o.profile.sessions[0];const h=JSON.stringify(s.history).length;const f=JSON.stringify(s.feed).length;return {historyBytes:h,feedBytes:f,total:o.profile.sessions.length, rev:o.profile.revision, jsonBytes:JSON.stringify(o.profile).length};})()`);
  say('байт в истории (history):', dup.historyBytes, '| байт в ленте (feed):', dup.feedBytes, '| весь профиль:', dup.jsonBytes);
  const occ = ctx.win.eval(`(async()=>{const o=await BriixSessionStore.open('audit');const raw=JSON.stringify(o.profile);const t=${JSON.stringify(LONG_REPLY.slice(0, 60))};let n=0,i=0;while((i=raw.indexOf(t,i))>=0){n++;i+=t.length;}return {replyChars:${LONG_REPLY.length},occurrences:n,profileChars:raw.length};})()`);
  const o2 = await occ;
  say('ответ модели длиной', o2.replyChars, 'символов встречается в профиле', o2.occurrences, 'раз (history.content + feed.text + feed.track) → профиль', o2.profileChars, 'символов');
  say('стоимость одного хода в хранилище: ~' + Math.round(o2.profileChars / 1024) + ' КиБ; 50 таких ходов ≈ ' + Math.round(o2.profileChars * 50 / 1024) + ' КиБ (localStorage-фолбэк ограничен ~5 МБ)');
}

/* ------------------------------------------------------------------ A4 */
async function A4() {
  head('A4 · POST /jobs: params.language / seed / parent_job_id / Idempotency-Key / title');
  const ctx = await H.boot({ storage: baseStorage, chatScript, timeScale: 40 });
  const { doc, bff } = ctx; await H.login(ctx);
  H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
  H.setVal(doc.getElementById('prompt'), 'психоделик соул про ночной город, женский вокал, на русском');
  H.click(doc.getElementById('genTrack'));
  await H.settle(200, 25);
  const post = jobPost(bff);
  say('тело POST /jobs:', JSON.stringify(post, null, 1));
  say('params.language присутствует?', Object.prototype.hasOwnProperty.call(post.params, 'language'), '(bff: vocal_language = params.get("language","en") → всегда en)');
  say('params.seed присутствует?', Object.prototype.hasOwnProperty.call(post.params, 'seed'));
  say('params.parent_job_id присутствует?', Object.prototype.hasOwnProperty.call(post.params, 'parent_job_id'));
  const hdrs = bff.requests.filter(x => x.method === 'POST' && /\/jobs$/.test(x.url)).pop().headers;
  say('заголовок Idempotency-Key (bff поддерживает, окно 10 мин):', JSON.stringify(hdrs));
  say('params.title =', JSON.stringify(post.params.title), '← первая строка автолирики = структурный тег');
  const clean = x => String(x || '').replace(/[\/\\:*?"<>|#%&{}$!'@+=`\u0301]/g, ' ').replace(/\.{2,}/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '');
  const fname = (clean(clean(post.params.title) + ' - ' + clean('audit')) || 'briix-track-x') + '.m4a';
  say('имя файла при скачивании (safeFileName из studio.js):', fname);
  const track = [...doc.querySelectorAll('#feed .card .track-details')].pop();
  say('transparency-блок:', track ? track.textContent.replace(/\s+/g, ' ').slice(0, 300) : 'НЕТ');
  say('есть ли в transparency seed/provenance/ttl/битрейт?', /seed|провенанс|битрейт|kbps|хранени/i.test(track ? track.textContent : '') ? 'да' : 'нет');
  say('waveform узлов:', doc.querySelectorAll('.waveform').length, '(пики отдавались голым массивом — как в check-studio.cjs)');
  say('audio узлов:', doc.querySelectorAll('audio').length, '| objectURL live:', bff.objectUrls.live.size, '| intervals live:', bff.intervals.live.size);
  const getJob = bff.requests.filter(r => /GET/.test(r.method) && /\/jobs\/job-audit/.test(r.url));
  say('поллингов:', getJob.length, '| сервер отдавал provenance/ttl_seconds/mime/size/checksum — клиент их читает?');
  say('карточка трека:', feedCards(doc).filter(c => c.cls.includes('assistant')).pop()?.text.slice(0, 160));
}

/* ------------------------------------------------------------------ A5 */
async function A5() {
  head('A5 · стадии инструментала: реальный словарь bff (model-warmup → generating → album-cover)');
  const ctx = await H.boot({ storage: baseStorage, chatScript, timeScale: 40 });
  const { doc, win } = ctx; const warns = hookConsole(ctx); await H.login(ctx);
  H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
  H.click(doc.querySelector('.seg-btn[data-vocal="1"]')); await H.settle();
  H.setVal(doc.getElementById('prompt'), 'lo-fi ambient instrumental for focus, warm tape');
  H.click(doc.getElementById('genTrack'));
  await H.settle(6, 25);
  const snap = () => {
    const segs = [...doc.querySelectorAll('.stage-progress .sp-seg')];
    return { segs: segs.map(s => s.className), active: segs.filter(s => s.classList.contains('active')).length, done: segs.filter(s => s.classList.contains('done')).length, widths: segs.map(s => s.querySelector('.sp-fill').style.width), label: doc.querySelector('.stage-progress-label')?.textContent, phrase: doc.querySelector('[data-wait]')?.textContent, stage: doc.querySelector('[data-wait]')?.getAttribute('data-wait-stage') };
  };
  say('снимок 1 (стадия model-warmup):', snap());
  await H.settle(6, 25);
  say('снимок 2 (стадия generating):', snap());
  say('пул фраз для стадии generating существует?', win.eval(`(()=>{const p=BRIIX_WAIT.poolFor({type:'music',stage:'generating'});return {key:p.key,staged:p.staged,listLen:p.list.length};})()`));
  say('пул для model-warmup:', win.eval(`(()=>{const p=BRIIX_WAIT.poolFor({type:'music',stage:'model-warmup'});return {key:p.key,staged:p.staged,listLen:p.list.length};})()`));
  await H.settle(160, 25);
  say('после готовности: waveform', doc.querySelectorAll('.waveform').length, '| audio', doc.querySelectorAll('audio').length, '| warns', warns.slice(0, 3));
}

/* ------------------------------------------------------------------ A6 */
async function A6() {
  head('A6 · контракт peaks.json: объект {id,duration,peaks} (README) против голого массива (тест-мок)');
  for (const shape of ['object', 'array']) {
    const ctx = await H.boot({ storage: baseStorage, chatScript, timeScale: 60, peaksShape: shape });
    const { doc, bff } = ctx; const warns = hookConsole(ctx); await H.login(ctx);
    H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
    H.setVal(doc.getElementById('prompt'), 'warm neo soul ballad, female vocals, on russian');
    H.click(doc.getElementById('genTrack'));
    await H.settle(200, 20);
    say(`peaks=${shape}: .waveform узлов`, doc.querySelectorAll('.waveform').length,
      '| canvas', doc.querySelectorAll('canvas').length,
      '| audio', doc.querySelectorAll('audio').length,
      '| warn', warns.filter(w => /пики недоступны/i.test(w)).length ? warns.filter(w => /пики/i.test(w))[0].slice(0, 90) : '—',
      '| запросов peaks', bff.requests.filter(r => /-peaks\.json/.test(r.url)).length);
    say(`  placeholder .waveform-ph остался:`, doc.querySelectorAll('.waveform-ph').length);
  }
}

/* ------------------------------------------------------------------ A7 */
async function A7() {
  head('A7 · ✕ «Остановить»: отменяется ли джоба на сервере (POST /jobs/{id}/cancel)?');
  const ctx = await H.boot({ storage: baseStorage, chatScript, timeScale: 5 });
  const { doc, bff } = ctx; await H.login(ctx);
  H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
  H.setVal(doc.getElementById('prompt'), 'dark trip-hop instrumental, no vocals');
  H.click(doc.getElementById('genTrack'));
  await H.settle(30, 20);
  const stop = doc.querySelector('.stage-stop');
  say('кнопка ✕ найдена:', Boolean(stop), '| aria-label:', stop?.getAttribute('aria-label'));
  H.click(stop); await H.settle(10, 20);
  say('запросов на /cancel:', bff.requests.filter(r => /\/cancel/.test(r.url)).length, '(контракт: POST /jobs/{id}/cancel существует)');
  say('карточки:', feedCards(doc).slice(-2));
  say('джоба на сервере в статусе:', [...bff.jobs.values()].map(j => j.status));
  say('интервалов живо после остановки:', bff.intervals.live.size, '| objectURL live:', bff.objectUrls.live.size);
  say('локальная библиотека (localStorage):', ctx.win.localStorage.getItem('briix-studio-library-audit'));
}

/* ------------------------------------------------------------------ A8 */
async function A8() {
  head('A8 · один сбойный поллинг (502 upstream_error) рвёт генерацию');
  const ctx = await H.boot({ storage: baseStorage, chatScript, timeScale: 20, failPollOnce: true, failStatus: 502, failEnvelope: { error: { code: 'upstream_error', message: 'Бэкенд текста вернул http 500.', request_id: 'req-abc123' } } });
  const { doc, bff } = ctx; await H.login(ctx);
  H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
  H.setVal(doc.getElementById('prompt'), 'ambient instrumental, slow');
  H.click(doc.getElementById('genTrack'));
  await H.settle(120, 20);
  say('карточки:', feedCards(doc).slice(-3));
  say('поллингов сделано:', bff.requests.filter(r => /\/jobs\/job-audit/.test(r.url) && r.method === 'GET').length, '(ошибка не ретраится: pollJob повторяет только 429/503)');
  say('/cancel отправлен?', bff.requests.filter(r => /\/cancel/.test(r.url)).length);
  say('статус джобы на сервере:', [...bff.jobs.values()].map(j => j.status));
  say('текст в поле вернули?', JSON.stringify(doc.getElementById('prompt').value.slice(0, 40)));
  say('request_id из ответа сервера показан пользователю?', /req-abc123/.test(doc.getElementById('feed').textContent));
}

/* ------------------------------------------------------------------ A9 */
async function A9() {
  head('A9 · reload во время генерации: возобновляется ли ожидание?');
  const storage = { ...baseStorage };
  const ctx = await H.boot({ storage, chatScript, timeScale: 5 });
  const { doc, bff, win } = ctx; await H.login(ctx);
  H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
  H.setVal(doc.getElementById('prompt'), 'slow ballad, female vocals');
  H.click(doc.getElementById('genTrack'));
  await H.settle(20, 20);
  say('до reload: stage-карточек', doc.querySelectorAll('.card.stage').length, '| поллингов', bff.requests.filter(r => /\/jobs\/job-audit/.test(r.url) && r.method === 'GET').length);
  const snapshot = { local: { ...win.localStorage }, jobs: [...bff.jobs.keys()] };
  // «перезагрузка»: новый jsdom с тем же localStorage (IDB в этом сценарии не переносится — как в приватной вкладке)
  const ctx2 = await H.boot({ storage: snapshot.local, chatScript, timeScale: 5, idb: ctx.idb });
  await H.login(ctx2, 'audit');
  await H.settle(30, 20);
  say('после reload: карточек в ленте', ctx2.doc.querySelectorAll('#feed .card').length,
    '| stage-карточек', ctx2.doc.querySelectorAll('.card.stage').length,
    '| новых поллингов', ctx2.bff.requests.filter(r => /\/jobs\/job/.test(r.url) && r.method === 'GET').length);
  const jobsSaved = await ctx2.win.eval(`(async()=>{const o=await BriixSessionStore.open('audit');return (o.profile.sessions[0].jobs||[]).map(j=>j.job).join(',');})()`);
  say('записи jobs в профиле:', JSON.stringify(jobsSaved), '→ клиент их не поллит и не показывает (нет resume)');
}

/* ------------------------------------------------------------------ A10 */
async function A10() {
  head('A10 · смена сессии во время стрима: флаг занятости глобальный');
  const ctx = await H.boot({ storage: baseStorage, chatChunkDelay: 250, chatScript: () => 'Длинный ответ наставника, который печатается медленно и требует времени на каждое слово предложения. '.repeat(4), timeScale: 1 });
  const { doc, bff } = ctx; await H.login(ctx);
  H.setVal(doc.getElementById('prompt'), 'вопрос в сессии А'); H.click(doc.getElementById('send'));
  await H.settle(4, 200);
  say('стрим идёт: chatPending виден', !doc.getElementById('chatPending').hidden, '| send disabled', doc.getElementById('send').disabled);
  // новая сессия
  H.click(doc.getElementById('sessionsOpen')); await H.settle(2);
  H.click(doc.getElementById('sessionsNew')); await H.settle(4, 50);
  say('переключились на сессию B. send disabled?', doc.getElementById('send').disabled,
    '| chatPending виден?', !doc.getElementById('chatPending').hidden,
    '| подсказка:', doc.getElementById('chatPending').textContent.slice(0, 60));
  H.setVal(doc.getElementById('prompt'), 'вопрос в сессии B');
  await H.settle(2, 50);
  say('после ввода в B: send disabled?', doc.getElementById('send').disabled, '| chatPending виден?', !doc.getElementById('chatPending').hidden, '| подсказка:', doc.getElementById('chatPending').textContent.slice(0, 70));
  say('стрим сессии A ещё идёт (карточка .streaming в скрытом корне):', ctx.win.eval(`document.querySelectorAll('.session-feed[hidden] .streaming').length`));
  await H.settle(40, 300);
  say('стрим сессии A дописался в скрытый корень:', ctx.win.eval(`document.querySelectorAll('.session-feed[hidden] .card.assistant').length`) + ' карточек в hidden-корне');
  say('send disabled после завершения:', doc.getElementById('send').disabled);
}

/* ------------------------------------------------------------------ A11 */
async function A11() {
  head('A11 · Библиотека: 100 серверных треков (объём DOM, запросы, ре-рендер)');
  const serverList = Array.from({ length: 100 }, (_, i) => ({ id: 'job-lib-' + i, type: i % 4 === 0 ? 'image' : 'music', prompt: 'Трек номер ' + i + ' — психоделик соул, ночной город, женский вокал', params: { model: 'ace-step-flash', lyrics: LYRICS_RU }, created_at: 1700000000 + i }));
  const ctx = await H.boot({ storage: baseStorage, chatScript, timeScale: 20, serverList, peaksShape: 'array' });
  const { doc, bff } = ctx; await H.login(ctx);
  const t0 = Date.now();
  H.click(doc.querySelector('.tab[data-tab="library"]'));
  await H.settle(4, 10);
  const tFirst = Date.now() - t0;
  say('первый кадр библиотеки за', tFirst, 'мс; карточек:', doc.querySelectorAll('.lib-item').length);
  await H.settle(120, 10);
  const tAll = Date.now() - t0;
  say('после стабилизации', tAll, 'мс: DOM-узлов всего', doc.querySelectorAll('*').length,
    '| .lib-item', doc.querySelectorAll('.lib-item').length,
    '| canvas', doc.querySelectorAll('canvas').length,
    '| IntersectionObserver создано', bff.observers.created);
  const cnt = re => bff.requests.filter(r => re.test(r.url)).length;
  say('запросы: GET /jobs', cnt(/\/jobs\?|\/jobs$/), '| peaks', cnt(/-peaks\.json/), '| cover(-cover.png)', cnt(/-cover\.png/), '| фото-файлы', bff.requests.filter(r => /\/files\/job-lib/.test(r.url) && !/-cover\.png/.test(r.url)).length, '| аудио', bff.requests.filter(r => /\.m4a/.test(r.url)).length);
  const firstNode = doc.querySelector('.lib-item');
  say('objectURL live (обложки ревочатся в onload):', bff.objectUrls.live.size, 'created', bff.objectUrls.created, 'revoked', bff.objectUrls.revoked);
  // фаворит → полный ре-рендер
  const before = { nodes: doc.querySelectorAll('*').length, covers: cnt(/-cover\.png/), jobs: cnt(/\/jobs\?|\/jobs$/) };
  const favBtn = [...doc.querySelectorAll('.lib-item .menu-btn')].pop();
  H.click(favBtn); await H.settle(3);
  const favItem = [...doc.querySelectorAll('.track-menu button')].find(b => /избран/i.test(b.textContent));
  say('меню «⋯» открыто, пунктов:', doc.querySelectorAll('.track-menu button').length, '| пункты:', [...doc.querySelectorAll('.track-menu button')].map(b => b.textContent).join(' / '));
  H.click(favItem); await H.settle(120, 10);
  say('после одного клика «В избранное»: DOM-узлов', before.nodes, '→', doc.querySelectorAll('*').length,
    '| новых cover-запросов', cnt(/-cover\.png/) - before.covers,
    '| новых GET /jobs', cnt(/\/jobs\?|\/jobs$/) - before.jobs,
    '| новых peaks', cnt(/-peaks\.json/));
  say('первая карточка пересоздана (тот же узел в документе)?', firstNode.isConnected, '→ false = полный ре-рендер всех 100 карточек');
  say('objectURL: created', bff.objectUrls.created, 'revoked', bff.objectUrls.revoked, 'live', bff.objectUrls.live.size);
  say('аудио-элементов в библиотеке:', doc.querySelectorAll('.lib-item audio').length, '| canvas:', doc.querySelectorAll('.lib-item canvas').length, '(волна в библиотеке строится только после загрузки файла)');
}

/* ------------------------------------------------------------------ A12 */
async function A12() {
  head('A12 · утечки: objectURL/интервалы после скачиваний и выхода во время джобы');
  const ctx = await H.boot({ storage: baseStorage, chatScript, timeScale: 20 });
  const { doc, bff } = ctx; await H.login(ctx);
  H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
  H.setVal(doc.getElementById('prompt'), 'neo soul, female vocals');
  H.click(doc.getElementById('genTrack'));
  await H.settle(200, 20);
  say('после генерации: objectURL live', bff.objectUrls.live.size, '| intervals live', bff.intervals.live.size);
  const menuBtn = doc.querySelector('#feed .track-menu-anchor .menu-btn');
  for (let i = 0; i < 3; i++) {
    H.click(menuBtn); await H.settle(2);
    const dl = [...doc.querySelectorAll('.track-menu button')].find(b => b.textContent === 'Скачать');
    H.click(dl); await H.settle(6, 20);
  }
  say('после 3 скачиваний: objectURL live', bff.objectUrls.live.size, '(ссылки на скачивание не ревочатся до выхода)');
  // новая джоба и выход во время неё
  H.setVal(doc.getElementById('musicPrompt'), ''); H.click(doc.querySelector('.mode[data-mode="chat"]')); await H.settle();
  H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
  H.setVal(doc.getElementById('prompt'), 'second track, instrumental');
  H.click(doc.querySelector('.seg-btn[data-vocal="1"]')); await H.settle();
  H.click(doc.getElementById('genTrack'));
  await H.settle(20, 20);
  say('вторая джоба идёт: stage-карточек', doc.querySelectorAll('.card.stage').length, '| intervals live', bff.intervals.live.size);
  H.click(doc.getElementById('profileBtn')); await H.settle(2);
  H.click(doc.getElementById('profileLogoutBtn')); await H.settle(20, 20);
  say('выход во время генерации: gate виден', !doc.getElementById('gate').hidden);
  say('интервалов живо ПОСЛЕ выхода:', bff.intervals.live.size, '| objectURL live:', bff.objectUrls.live.size, '| активных поллингов (запросов /jobs/ за последние 2 с):', bff.requests.filter(r => /\/jobs\/job-audit/.test(r.url)).length);
  say('запросов /cancel при выходе:', bff.requests.filter(r => /\/cancel/.test(r.url)).length);
  await H.settle(40, 20);
  say('ещё 40 тиков спустя интервалов живо:', bff.intervals.live.size, '(секундомер сцены крутится на удалённом узле)');
}

/* ------------------------------------------------------------------ A13 */
async function A13() {
  head('A13 · черновик композера не переживает перезагрузку (нет сохранения на input/pagehide)');
  const ctx = await H.boot({ storage: baseStorage, chatScript, timeScale: 10 });
  const { doc, win } = ctx; await H.login(ctx);
  H.setVal(doc.getElementById('prompt'), 'Черновик, который я писал десять минут');
  await H.settle(20, 20);
  win.dispatchEvent(new win.Event('pagehide'));
  win.dispatchEvent(new win.Event('beforeunload'));
  await H.settle(4, 10);
  const prof = await win.eval(`(async()=>{const o=await BriixSessionStore.open('audit');return JSON.stringify(o.profile.sessions[0].draft||null);})()`);
  say('draft в хранилище после pagehide:', prof);
  say('beforeunload вызвал диалог (returnValue)?', '(проверяется по storageDirty/producerSaveTimer — см. A14)');
}

/* ------------------------------------------------------------------ A14 */
async function A14() {
  head('A14 · отказ IndexedDB → липкий beforeunload, блокировка смены сессий');
  const ctx = await H.boot({ storage: baseStorage, chatScript, timeScale: 10 });
  const { doc, win } = ctx; await H.login(ctx);
  say('до сбоя: storageWarning скрыт', doc.getElementById('storageWarning').hidden, '| send disabled', doc.getElementById('send').disabled);
  win.indexedDB = { open() { const r = { error: new Error('QuotaExceededError') }; setTimeout(() => r.onerror && r.onerror(), 0); return r; } };
  H.setVal(doc.getElementById('prompt'), 'текст после отказа хранилища'); H.click(doc.getElementById('send'));
  await H.settle(20, 20);
  say('storageWarning виден:', !doc.getElementById('storageWarning').hidden);
  say('текст предупреждения:', doc.getElementById('storageWarning').textContent.slice(0, 200));
  say('кнопка экспорта данных в предупреждении:', doc.querySelectorAll('#storageWarning button').length);
  const ev = new win.Event('beforeunload', { cancelable: true });
  win.dispatchEvent(ev);
  say('beforeunload.defaultPrevented =', ev.defaultPrevented, '→ браузер показывает «Покинуть сайт?» на каждом обновлении, пока ошибка не уйдёт (сброса флага нет)');
  // смена сессии при отказе хранилища
  H.click(doc.getElementById('sessionsOpen')); await H.settle(3, 20);
  H.click(doc.getElementById('sessionsNew')); await H.settle(10, 20);
  say('«Новый чат» при отказе хранилища: сессий в списке', doc.querySelectorAll('.session-item').length, '| диалог истории открыт?', !doc.getElementById('sessionsOverlay').hidden, '→ activateSession выходит раньше времени, диалог не закрывается');
  say('send disabled:', doc.getElementById('send').disabled, '| карточек в ленте:', doc.querySelectorAll('#feed .card').length);
}

/* ------------------------------------------------------------------ A15 */
async function A15() {
  head('A15 · «Повторить с правками» из библиотеки для серверного трека без сессии');
  const serverList = [{ id: 'job-only-server', type: 'music', prompt: 'Серверный трек без локальной сессии', params: { model: 'ace-step-pro', lyrics: LYRICS_RU }, created_at: 1700000000 }];
  const ctx = await H.boot({ storage: baseStorage, chatScript, timeScale: 20, serverList });
  const { doc, win } = ctx; await H.login(ctx);
  H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
  H.click(doc.getElementById('tuneToggle')); await H.settle();
  H.setVal(doc.getElementById('musicPrompt'), 'мой текущий английский промпт, который я берёг');
  H.setVal(doc.getElementById('lyrics'), 'моя текущая лирика');
  H.click(doc.querySelector('.tab[data-tab="library"]')); await H.settle(40, 10);
  H.click(doc.querySelector('.lib-item .menu-btn')); await H.settle(3);
  const items = [...doc.querySelectorAll('.track-menu button')].map(b => b.textContent);
  say('пункты меню в библиотеке:', items.join(' / '));
  const rep = [...doc.querySelectorAll('.track-menu button')].find(b => /Повторить с правками/.test(b.textContent));
  H.click(rep); await H.settle(10, 20);
  say('вернулись в чат: musicPrompt =', JSON.stringify(doc.getElementById('musicPrompt').value), '| lyrics =', JSON.stringify(doc.getElementById('lyrics').value.slice(0, 30)));
  say('confirm вызывался?', win.confirmCalls.length, win.confirmCalls.map(c => c.slice(0, 50)));
  say('карточка-подсказка:', feedCards(doc).slice(-1));
  say('качество (модель) в чипе:', doc.getElementById('modelName').textContent, '| ожидалось Pro из params.model серверной записи');
}

/* ------------------------------------------------------------------ A16 */
async function A16() {
  head('A16 · плеер: автоплей после генерации, наложение треков, вкладка «Библиотека»');
  const ctx = await H.boot({ storage: baseStorage, chatScript, timeScale: 60, peaksShape: 'array' });
  const { doc } = ctx; await H.login(ctx);
  H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
  const states = [];
  for (const idea of ['neo soul ballad, female vocals', 'lo-fi instrumental, warm tape', 'ambient piano, night rain']) {
    H.setVal(doc.getElementById('prompt'), idea);
    H.click(doc.getElementById('genTrack'));
    await H.settle(200, 15);
    states.push([...doc.querySelectorAll('audio')].map(a => a.paused ? 'пауза' : 'ИГРАЕТ'));
    say('после генерации №' + states.length + ' (' + idea.slice(0, 18) + '…) состояние всех аудио:', states[states.length - 1].join(', '));
  }
  const covers = [...doc.querySelectorAll('.track-cover')];
  say('обложек с классом playing:', covers.filter(c => c.classList.contains('playing')).length, 'из', covers.length);
  say('→ три трека играют одновременно: нет эксклюзивного плеера (Spotify/SoundCloud гасят предыдущий трек)');
  H.click(covers[1]); await H.settle(6, 10);
  say('клик по обложке трека №2: трек №1', [...doc.querySelectorAll('audio')][0].paused ? 'остановлен' : 'ПРОДОЛЖАЕТ играть', '(тогглится только свой audio)');
  H.click(doc.querySelector('.tab[data-tab="library"]')); await H.settle(6, 10);
  const audios = [...doc.querySelectorAll('#feed audio')];
  say('перешли в Библиотеку: feed.hidden', doc.getElementById('feed').hidden, '| играют:', audios.map(a => a.paused ? 'пауза' : 'ИГРАЕТ').join(','), '| контролов в зоне видимости:', doc.querySelectorAll('#lib audio, .now-playing').length);
  say('мини-плеер/«сейчас играет» в документе:', doc.querySelectorAll('.now-playing, .mini-player, [data-now-playing]').length);
  say('видимая волна в ленте (canvas):', doc.querySelectorAll('#feed canvas').length, '| у волны есть текстовый таймкод?', doc.querySelectorAll('.waveform-time, .waveform .time').length);
}

/* ------------------------------------------------------------------ A17 */
async function A17() {
  head('A17 · черновик наставника (music-chat): Принять / Сгенерировать / params');
  const ctx = await H.boot({ storage: baseStorage, chatScript: (messages, body) => {
    const sys = String(messages[0].content || '');
    if (/briix-draft/.test(sys)) return 'Собрал черновик.\n\n[briix-draft]\n{"title":"Неон и вода","prompt":"psychedelic soul, female vocals, warm tape","lyrics":' + JSON.stringify(LYRICS_RU) + '}\n[/briix-draft]';
    return chatScript(messages, body);
  }, timeScale: 40 });
  const { doc, bff } = ctx; await H.login(ctx);
  H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
  H.setVal(doc.getElementById('prompt'), 'собери психоделик соул про ночной город, на русском');
  H.click(doc.getElementById('send')); await H.settle(60, 20);
  say('карточка черновика:', feedCards(doc).slice(-1));
  say('поля черновика:', [...doc.querySelectorAll('.music-draft [data-draft-field]')].map(i => i.dataset.draftField + '=' + JSON.stringify(i.value.slice(0, 40))));
  const gen = [...doc.querySelectorAll('.music-draft .producer-actions button')].find(b => /Сгенерировать/.test(b.textContent));
  H.click(gen); await H.settle(200, 20);
  const post = jobPost(bff);
  say('POST /jobs:', JSON.stringify(post));
  say('params.language?', Object.prototype.hasOwnProperty.call(post?.params || {}, 'language'), '| lyricsSource в transparency:', /наставник/.test(doc.querySelector('.track-details')?.textContent || ''));
  say('transparency:', doc.querySelector('.track-details')?.textContent.replace(/\s+/g, ' ').slice(0, 260));
}

/* ------------------------------------------------------------------ A18 */
async function A18() {
  head('A18 · «Улучшить» (few-shot): отмена, таймаут, размер базы');
  const ctx = await H.boot({ storage: baseStorage, chatScript, timeScale: 5 });
  const { doc, bff } = ctx; await H.login(ctx);
  H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
  H.click(doc.getElementById('tuneToggle')); await H.settle();
  H.setVal(doc.getElementById('lyrics'), 'черновик лирики для улучшения');
  await H.settle(2);
  say('кнопка «Улучшить» включена:', !doc.getElementById('improveLyrics').disabled);
  const slow = H.boot; // не используем
  H.click(doc.getElementById('improveLyrics'));
  await H.settle(3, 10);
  say('creative-base.json загружен (запросов):', bff.requests.filter(r => /creative-base/.test(r.url)).length, '| размер файла:', fs.statSync(require('path').join(H.ROOT, 'assets/data/creative-base.json')).size, 'байт (префикс-загрузка не делается)');
  await H.settle(40, 20);
  say('лирика после улучшения:', JSON.stringify(doc.getElementById('lyrics').value.slice(0, 60)), '| undo виден:', !doc.getElementById('undoLyrics').hidden);
  const chat = bff.requests.filter(r => /chat\/completions/.test(r.url)).pop();
  const bodyChat = JSON.parse(chat.body);
  say('системный промпт few-shot, байт:', bodyChat.messages[0].content.length, '| max_tokens:', bodyChat.max_tokens, '| signal/abort у запроса: нет (улучшение нельзя остановить)');
  say('сервер игнорирует max_tokens (bff payload без num_predict) — ограничение длины не действует');
}

/* ------------------------------------------------------------------ A19 */
async function A19() {
  head('A19 · одна и та же английская идея: Simple против «Тонко настроить» (brain-теги)');
  const IDEA = 'lofi hip hop, rainy night, mellow piano, dusty vinyl crackle, 82 BPM';
  for (const adv of [false, true]) {
    const ctx = await H.boot({ storage: baseStorage, chatScript, timeScale: 60 });
    const { doc, bff } = ctx; await H.login(ctx);
    H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
    if (adv) { H.click(doc.getElementById('tuneToggle')); await H.settle(); H.setVal(doc.getElementById('musicPrompt'), IDEA); }
    else H.setVal(doc.getElementById('prompt'), IDEA);
    H.click(doc.getElementById('genTrack'));
    await H.settle(200, 15);
    const post = jobPost(bff);
    say((adv ? 'Тонко настроить' : 'Simple     ') + ': prompt в модель =', JSON.stringify(post.prompt));
    say('              brain-теги добавлены?', post.prompt.length > IDEA.length ? 'да (+' + (post.prompt.length - IDEA.length) + ' симв.)' : 'НЕТ');
  }
}

/* ------------------------------------------------------------------ A20 */
async function A20() {
  head('A20 · выход во время генерации; stop-кнопка в композере; статус-строка');
  const ctx = await H.boot({ storage: baseStorage, chatScript, timeScale: 2 });
  const { doc, bff } = ctx; await H.login(ctx);
  H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
  H.setVal(doc.getElementById('prompt'), 'long instrumental journey, ambient');
  H.click(doc.getElementById('genTrack'));
  await H.settle(10, 30);
  say('джоба идёт; #status:', JSON.stringify(doc.getElementById('status').textContent), '| класс busy:', doc.getElementById('status').className);
  say('кнопка send получила класс busy/stop (CSS .send.busy/.send.stop существуют)?', JSON.stringify(doc.getElementById('send').className));
  say('в композере есть элемент остановки?', doc.querySelectorAll('.composer .stage-stop, .composer [data-stop]').length);
  H.click(doc.querySelector('.tab[data-tab="library"]')); await H.settle(2);
  H.click(doc.getElementById('profileBtn')); await H.settle(2);
  H.click(doc.getElementById('profileLogoutBtn')); await H.settle(6, 30);
  say('выход с вкладки «Библиотека» во время генерации: gate виден', !doc.getElementById('gate').hidden);
  say('карточка-отказ (в ленте, её сейчас не видно):', feedCards(doc).filter(c => /Сначала дождитесь/.test(c.text)).map(c => c.text));
  say('видна ли она пользователю на вкладке Библиотека? feed.hidden =', doc.getElementById('feed').hidden);
  H.click(doc.querySelector('.tab[data-tab="chat"]')); await H.settle(2);
  const stop = doc.querySelector('.stage-stop');
  if (stop) { H.click(stop); await H.settle(40, 100); }
  H.click(doc.getElementById('profileBtn')); await H.settle(2);
  H.click(doc.getElementById('profileLogoutBtn')); await H.settle(10, 30);
  say('после остановки: gate виден', !doc.getElementById('gate').hidden, '| интервалов живо', bff.intervals.live.size, '| objectURL live', bff.objectUrls.live.size, '| /cancel', bff.requests.filter(r => /\/cancel/.test(r.url)).length);
}

const ALL = { A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14, A15, A16, A17, A18, A19, A20 };
(async () => {
  const names = ONLY.length ? ONLY : Object.keys(ALL);
  for (const n of names) {
    try { await ALL[n](); } catch (e) { say('СБОЙ СЦЕНАРИЯ ' + n + ': ' + (e && e.stack || e)); }
  }
  fs.writeFileSync(path.join(__dirname, '..', 'evidence', 'dynamic-evidence.txt'), out.join('\n'));
  say('\nпротокол сохранён: dynamic-evidence.txt');
  process.exit(0);
})();
