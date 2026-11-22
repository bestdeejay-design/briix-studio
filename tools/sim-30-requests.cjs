/* Симуляция 30 пользовательских запросов через реальную студию (task #51).
 *
 * Прогоняет НАСТОЯЩИЙ studio.js в реальном браузере (Playwright) против
 * фейкового media-bff:.chat-модель (автор песен / переводчик / наставник)
 * отвечает сценарными скриптами, генерация аудио мгновенно готова.
 * Что проверяется на каждом запросе:
 *   - что МОЗГ решил: перевод, семейство, слои, голос, язык (одно решение);
 *   - что УЕХАЛО В МОДЕЛЬ: prompt (≤640, ASCII), params (language, lyrics
 *     с брекетами, title, instrumental), брекеты EN и без дублей с caption;
 *   - что ПОЛЬЗОВАТЕЛЬ УВИДЕЛ: карточки предупреждений и бейджи.
 *
 * Запуск: node tools/sim-30-requests.cjs
 * Выход: audits/sim-30/results.json + консольный PASS/FAIL по сценариям.
 */
const { launch } = require('./browser-env.cjs');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const STATIC_PORT = 18390;
const BFF_PORT = 18391;
const TOKEN = 'test-token';
const OUT_JSON = path.join(ROOT, 'audits', 'sim-30', 'results.json');

/* ---- Сценарные ответы «модели» (chat): ключ = подстрока входа --------------- */

// Переводчик (не-ASCII идея → английский промт). Ключ — подстрока исходной идеи.
const TRANSLATIONS = [
  ['ночную трассу', 'dark synthwave, night highway mood, analog arpeggios, 100 BPM, warm male vocals'],
  ['про осень и дожди', 'sad acoustic ballad, autumn mood, soft piano, warm male vocals, 80 BPM'],
  ['джангл 170', 'jungle, 170 BPM, fast chopped breakbeats, deep sub bass'],
  ['который спит на подоконнике', 'warm cozy pop song about a sleeping cat, soft acoustic guitar, gentle female vocals, 90 BPM'],
  ['в стиле Руки Вверх', 'energetic eurodance, 90s euro-pop, catchy male vocals, 150 BPM'],
  ['про Париж и дождь', 'french pop chanson, parisian rainy mood, accordion, warm female vocals'],
  ['как у Metallica', 'heavy thrash metal, aggressive guitars, 140 BPM, powerful male vocals'],
  ['про ночной город, мужской', 'dark trap, 140 BPM, deep 808 bass, night city mood, male vocals'],
  ['девичий поп', 'sad young female pop, 100 BPM, soft synths, intimate vocals'],
  ['финальной битвы', 'epic cinematic orchestral score, final battle, choir, timpani, 90 BPM'],
  ['Мощный динамичный трек', 'powerful dynamic techno, heavy bass, 90 BPM'],
  ['космос', 'dark ambient, deep space drones, no drums'],
  ['ночной джаз', 'late-night jazz, upright bass, brush drums, smoky club mood'],
  ['быстрая сетка', 'jungle, 170 BPM, fast chopped breakbeats, deep sub bass'],
  ['лирическая баллада', 'lyrical ballad, 80 BPM, soft piano, warm male vocals'],
  ['в стиле Кино', 'post-punk rock, 120 BPM, cold guitars, male baritone'],
  ['брутальный металл', 'brutal heavy metal, growl vocals, 145 BPM, down-tuned guitars'],
];

// Автор песен (автолирика). Ключ — подстрока «Тема песни: …».
// Лирика следует механикам промта: дословный припев, парные куплеты.
const SONGS = [
  ['ночную трассу', '[Intro]\n[Verse 1]\nChrome horizon bleeding into night\nEngine humming low beneath the stars\n[Pre-Chorus]\nAnd the radio fades to gold\n[Chorus]\nNight highway, carry me home\nNight highway, I ride alone\n[Verse 2]\nChrome horizon bleeding into night\nEngine humming low beneath the stars\n[Chorus]\nNight highway, carry me home\nNight highway, I ride alone\n[Bridge]\nSlow down, let the morning wait\n[Final Chorus]\nNight highway, carry me home\nNight highway, I ride alone\n[Outro]'],
  ['про осень и дожди', '[Intro]\n[Verse 1]\nЛистья падают на мокрый асфальт\nТёплый свет из окон поздний час\n[Pre-Chorus]\nЯ иду сквозь тишину\n[Chorus]\nОсень в моих глазах\nДождь на моих плечах\n[Verse 2]\nЛистья падают на мокрый асфальт\nТёплый свет из окон поздний час\n[Chorus]\nОсень в моих глазах\nДождь на моих плечах\n[Bridge]\nТише, тише, лето спит\n[Final Chorus]\nОсень в моих глазах\nДождь на моих плечах\n[Outro]'],
  ['песню на русском', '[Intro]\n[Verse 1]\nГород спит и фонари гаснут\nБыстрый пульс неоновых снов\n[Pre-Chorus]\nНочь несёт меня\n[Chorus]\nБыстрее света я лечу\nБыстрее света я молчу\n[Verse 2]\nГород спит и фонари гаснут\nБыстрый пульс неоновых снов\n[Chorus]\nБыстрее света я лечу\nБыстрее света я молчу\n[Bridge]\nСтоп, дыхание, стоп\n[Final Chorus]\nБыстрее света я лечу\nБыстрее света я молчу\n[Outro]'],
  ['melodic techno', '[Intro]\n[Verse 1]\nCold machines are dreaming in the dark\nSilver pulses underneath my skin\n[Pre-Chorus]\nOne more cycle, one more wave\n[Chorus]\nHypnotic, we become the light\nHypnotic, dancing through the night\n[Verse 2]\nCold machines are dreaming in the dark\nSilver pulses underneath my skin\n[Chorus]\nHypnotic, we become the light\nHypnotic, dancing through the night\n[Bridge]\nLet the pattern take control\n[Final Chorus]\nHypnotic, we become the light\nHypnotic, dancing through the night\n[Outro]'],
  ['про кота', '[Intro]\n[Verse 1]\nSunlight spills across the windowsill\nFur like honey, paws are twitching slow\n[Pre-Chorus]\nLittle dreams of chasing string\n[Chorus]\nSleepy cat, drift away\nSleepy cat, stay all day\n[Verse 2]\nSunlight spills across the windowsill\nFur like honey, paws are twitching slow\n[Chorus]\nSleepy cat, drift away\nSleepy cat, stay all day\n[Bridge]\nPurr a little softer now\n[Final Chorus]\nSleepy cat, drift away\nSleepy cat, stay all day\n[Outro]'],
  ['евродэнс', '[Intro]\n[Verse 1]\nNeon disco flashing in my eyes\nSummer heat is calling us outside\n[Pre-Chorus]\nTurn the volume up tonight\n[Chorus]\nDance with me until the sunrise\nDance with me, we touch the sky\n[Verse 2]\nNeon disco flashing in my eyes\nSummer heat is calling us outside\n[Chorus]\nDance with me until the sunrise\nDance with me, we touch the sky\n[Bridge]\nHands up high, the night is ours\n[Final Chorus]\nDance with me until the sunrise\nDance with me, we touch the sky\n[Outro]'],
  ['на французском', '[Intro]\n[Verse 1]\nLes lampes de Paris s’allument doucement\nLa pluie dessine des reflets d’argent\n[Pre-Chorus]\nEt je marche sans fin\n[Chorus]\nParis sous la pluie\nMon cœur oublie la nuit\n[Verse 2]\nLes lampes de Paris s’allument doucement\nLa pluie dessine des reflets d’argent\n[Chorus]\nParis sous la pluie\nMon cœur oublie la nuit\n[Bridge]\nReste encore un moment\n[Final Chorus]\nParis sous la pluie\nMon cœur oublie la nuit\n[Outro]'],
  ['тяжёлый', '[Intro]\n[Verse 1]\nIron thunder rolling through my chest\nBlack horizon swallowing the light\n[Pre-Chorus]\nNo retreat, no remorse\n[Chorus]\nRide the storm, break the chain\nRide the storm, through the pain\n[Verse 2]\nIron thunder rolling through my chest\nBlack horizon swallowing the light\n[Chorus]\nRide the storm, break the chain\nRide the storm, through the pain\n[Bridge]\nLouder than the raging sky\n[Final Chorus]\nRide the storm, break the chain\nRide the storm, through the pain\n[Outro]'],
  ['трэп 140', '[Intro]\n[Verse 1]\nMidnight streets are humming low and deep\nCity lights are flickering like sleep\n[Pre-Chorus]\nCounting blocks, counting stars\n[Chorus]\nNight is mine, shadows fade\nNight is mine, unafraid\n[Verse 2]\nMidnight streets are humming low and deep\nCity lights are flickering like sleep\n[Chorus]\nNight is mine, shadows fade\nNight is mine, unafraid\n[Bridge]\nLow and slow, the bass rolls on\n[Final Chorus]\nNight is mine, shadows fade\nNight is mine, unafraid\n[Outro]'],
  ['девичий поп', '[Intro]\n[Verse 1]\nPaper hearts are scattered on my floor\nEvery song reminds me of before\n[Pre-Chorus]\nBut I smile anyway\n[Chorus]\nBlue skies after the rain\nI am whole once again\n[Verse 2]\nPaper hearts are scattered on my floor\nEvery song reminds me of before\n[Chorus]\nBlue skies after the rain\nI am whole once again\n[Bridge]\nSoftly now, I let you go\n[Final Chorus]\nBlue skies after the rain\nI am whole once again\n[Outro]'],
  ['киномузык', '[Intro]\n[Verse 1]\nAshes falling on the broken ground\nFinal drums across the burning sky\n[Pre-Chorus]\nStand and face the end\n[Chorus]\nRise, we rise, the last of all\nRise, we rise, before we fall\n[Verse 2]\nAshes falling on the broken ground\nFinal drums across the burning sky\n[Chorus]\nRise, we rise, the last of all\nRise, we rise, before we fall\n[Bridge]\nOne more breath before the dawn\n[Final Chorus]\nRise, we rise, the last of all\nRise, we rise, before we fall\n[Outro]'],
  ['Мощный динамичный', '[Intro]\n[Verse 1]\nConcrete pulse is beating in my veins\nEvery corner echoes with the bass\n[Pre-Chorus]\nFeel the pressure building up\n[Chorus]\nPower surge, wide awake\nPower surge, no escape\n[Verse 2]\nConcrete pulse is beating in my veins\nEvery corner echoes with the bass\n[Chorus]\nPower surge, wide awake\nPower surge, no escape\n[Bridge]\nDrop it deeper, hold the line\n[Final Chorus]\nPower surge, wide awake\nPower surge, no escape\n[Outro]'],
];

// Наставник (чат с draft-блоком). Ключ — подстрока сообщения пользователя.
const MENTORS = [
  ['про звёзды', { text: 'Мечтательный дрим-поп — отличный выбор. Вот черновик.',
    draft: { title: 'Starlight Drift', prompt: 'dream pop, 95 BPM, warm shimmering guitars, soft female vocals, hazy reverb', lyrics: '[Intro]\n[Verse 1]\nCounting satellites above the bay\nEvery star a letter I never sent\n[Pre-Chorus]\nAnd the tide pulls me away\n[Chorus]\nStarlight, carry me out tonight\nStarlight, I am made of light\n[Verse 2]\nCounting satellites above the bay\nEvery star a letter I never sent\n[Chorus]\nStarlight, carry me out tonight\nStarlight, I am made of light\n[Bridge]\nDrift until the morning comes\n[Final Chorus]\nStarlight, carry me out tonight\nStarlight, I am made of light\n[Outro]', style: 'dream pop' } }],
  ['на русском про море', { text: 'Грустный синтвейв на русском — держите черновик.',
    draft: { title: 'Ночной прибой', prompt: 'synthwave, 100 BPM, analog arpeggios, gated snare, warm male vocals', lyrics: '[Intro]\n[Verse 1]\nНочной прибой о камни бьётся тихо\nОгни маяка скользят по волнам\n[Pre-Chorus]\nЯ слушаю тишину\n[Chorus]\nМоре ждёт меня в ночи\nМоре гасит все лучи\n[Verse 2]\nНочной прибой о камни бьётся тихо\nОгни маяка скользят по волнам\n[Chorus]\nМоре ждёт меня в ночи\nМоре гасит все лучи\n[Bridge]\nВолна уносит голоса\n[Final Chorus]\nМоре ждёт меня в ночи\nМоре гасит все лучи\n[Outro]', style: 'synthwave' } }],
  ['мощный эмбиент', { text: 'Сделал длинный промт — проверьте потолок сборки.',
    draft: { title: 'Deep Field', prompt: ('dark ambient, deep space drones, ').repeat(14).replace(/,\s*$/, '').slice(0, 560), lyrics: '[Intro]\n[Verse 1]\nStars are falling into silent water\nEvery breath becomes a distant sun\n[Pre-Chorus]\nAnd the dark holds me close\n[Chorus]\nDeep field, endless night\nDeep field, quiet light\n[Verse 2]\nStars are falling into silent water\nEvery breath becomes a distant sun\n[Chorus]\nDeep field, endless night\nDeep field, quiet light\n[Bridge]\nDrift beyond the edge of time\n[Final Chorus]\nDeep field, endless night\nDeep field, quiet light\n[Outro]', style: 'ambient' } }],
  ['как у Руки Вверх', { text: 'Евродэнс так евродэнс. Вот черновик.',
    draft: { title: 'Руки Вверх Style Party', prompt: 'energetic eurodance, 150 BPM, 90s synth stabs, catchy chorus, male vocals', lyrics: '[Intro]\n[Verse 1]\nDiscoball is spinning round the room\nSummer night is calling us to move\n[Pre-Chorus]\nTurn it up, the beat is hot\n[Chorus]\nParty night, hands up high\nParty night, touch the sky\n[Verse 2]\nDiscoball is spinning round the room\nSummer night is calling us to move\n[Chorus]\nParty night, hands up high\nParty night, touch the sky\n[Bridge]\nOne more time, the night is young\n[Final Chorus]\nParty night, hands up high\nParty night, touch the sky\n[Outro]', style: '' } }],
  ['припев мощнее', { text: 'Усилил припев и динамику.',
    draft: { title: 'Starlight Drift (Wide)', prompt: 'dream pop, 95 BPM, big shimmering guitars, soft female vocals, hazy reverb, wide chorus', lyrics: '[Intro]\n[Verse 1]\nCounting satellites above the bay\nEvery star a letter I never sent\n[Pre-Chorus]\nAnd the tide pulls me away\n[Chorus]\nStarlight, carry me out tonight\nStarlight, I am made of light\n[Verse 2]\nCounting satellites above the bay\nEvery star a letter I never sent\n[Chorus]\nStarlight, carry me out tonight\nStarlight, I am made of light\n[Bridge]\nDrift until the morning comes\n[Final Chorus]\nStarlight, carry me out tonight\nStarlight, I am made of light\n[Outro]', style: 'dream pop' } }],
];

/* ---- Фейковый media-bff ---------------------------------------------------- */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+manifest', '.m4a': 'audio/mp4', '.json': 'application/json', '.woff2': 'font/woff2' };
function makeToneWav() {
  const sampleRate = 16000, samples = sampleRate;
  const bytes = new ArrayBuffer(44 + samples * 2), v = new DataView(bytes);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 20000), true);
  return Buffer.from(bytes);
}
const WAV = makeToneWav();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function staticServer(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('#')[0].split('?')[0]);
      if (p === '/' || p === '/studio/') p = '/studio/index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

function sse(res, fullText) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': `http://127.0.0.1:${STATIC_PORT}` });
  const words = fullText.split(' ');
  let i = 0;
  const timer = setInterval(() => {
    if (i < words.length) {
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: (i ? ' ' : '') + words[i] } }] }) + '\n\n');
      i++;
    } else { res.write('data: [DONE]\n\n'); clearInterval(timer); res.end(); }
  }, 2);
  res.on('close', () => clearInterval(timer));
}

const state = { chatPosts: [], jobPosts: [], jobSeq: 1, pollsOf: {} };
const findScripted = (table, text) => (table.find(([k]) => text.includes(k)) || [null, null])[1];

function bffServer(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const origin = req.headers.origin || '';
      const cors = { 'Access-Control-Allow-Origin': origin === `http://127.0.0.1:${STATIC_PORT}` ? origin : '', Vary: 'Origin' };
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type' }); res.end(); return; }
      const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
      const readBody = cb => { let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => cb(JSON.parse(raw || '{}'))); };

      if (req.url === '/v1/models') {
        send(200, { object: 'list', data: [
          { id: 'ace-step-flash', object: 'model', status: 'ready', capabilities: ['song.vocal'], latency: { source: 'measured', seconds: 111, conditions: '30с трек' } },
          { id: 'ace-step-pro', object: 'model', status: 'unavailable', capabilities: ['song.vocal'], latency: { source: 'measured', seconds: 596, conditions: '150с трек' } }
        ] });
        return;
      }
      if (req.headers.authorization !== 'Bearer ' + TOKEN) { send(401, { error: { code: 'unauthorized', message: 'no' } }); return; }

      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        readBody(body => {
          state.chatPosts.push(body);
          const sys0 = body.messages[0]?.content || '';
          const last = body.messages.at(-1)?.content || '';
          if (body.stream === false) {
            // Переводчик не-ASCII идеи тоже ходит non-stream (translatePrompt).
            if (/Output ONLY the English prompt/.test(sys0))
              return send(200, { choices: [{ message: { content: findScripted(TRANSLATIONS, last) || 'experimental indie pop' } }] });
            return send(200, { choices: [{ message: { content: 'УЛУЧШЕННЫЙ ТЕКСТ' } }] });
          }
          // Автор песен (автолирика): язык/атмосфера приходят в system, тема — в user.
          if (/Ты — автор песен/.test(sys0)) return sse(res, findScripted(SONGS, last) || SONGS[3][1]);
          // Переводчик не-ASCII идеи.
          if (/Output ONLY the English prompt/.test(sys0)) return sse(res, findScripted(TRANSLATIONS, last) || 'experimental indie pop');
          // Музыкальный наставник: ответ всегда с draft-блоком.
          if (/блоком черновика строго в таком формате/.test(sys0)) {
            const m = findScripted(MENTORS, last) || MENTORS[0][1];
            return sse(res, m.text + ' [briix-draft] ' + JSON.stringify(m.draft) + ' [/briix-draft]');
          }
          sse(res, 'Стрим пришёл: ' + last.slice(-40));
        });
        return;
      }
      if (req.url === '/jobs' && req.method === 'POST') {
        readBody(body => { state.jobPosts.push(body); body.id = 'job-' + String(state.jobSeq++).padStart(3, '0'); send(202, { job_id: body.id }); });
        return;
      }
      if (req.url.split('?')[0] === '/jobs' && req.method === 'GET') {
        const items = state.jobPosts.map(({ id, type, prompt, params }) => ({ id, type: type || 'image', status: 'ready', prompt: prompt || '', params: { ...(params || {}) }, result_url: '/files/' + id + (type === 'music' ? '.m4a' : '.png'), cover_url: type === 'music' ? '/files/' + id + '-cover.png' : '', favorite: false, created_at: 1794000000 }));
        send(200, { total: items.length, limit: 100, offset: 0, items });
        return;
      }
      const getM = req.url.match(/^\/jobs\/([^/]+)$/);
      if (getM && req.method === 'GET') {
        const post = state.jobPosts.find(p => p.id === getM[1]);
        if (!post) { send(404, { error: { code: 'job_not_found', message: 'nf' } }); return; }
        state.pollsOf[post.id] = (state.pollsOf[post.id] || 0) + 1;
        if (state.pollsOf[post.id] < 2) {
          const stage = post.type === 'music' && post.params?.instrumental ? 'model-warmup' : (post.type === 'music' ? 'writing-lyrics' : 'generating');
          send(200, { id: post.id, type: post.type, status: 'running', stage });
          return;
        }
        send(200, { id: post.id, type: post.type, status: 'ready', result_url: '/files/' + post.id + (post.type === 'music' ? '.m4a' : '.png'), cover_url: post.type === 'music' ? '/files/' + post.id + '-cover.png' : '' });
        return;
      }
      const peaksM = req.url.match(/^\/files\/([^/]+)-peaks\.json$/);
      if (peaksM && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
        res.end(JSON.stringify({ id: peaksM[1], duration: 121.4, peaks: Array.from({ length: 160 }, (_, i) => 0.2 + 0.6 * Math.abs(Math.sin(i / 9))) }));
        return;
      }
      if (req.url.startsWith('/files/')) {
        const isCover = req.url.includes('-cover.png');
        res.writeHead(200, { 'Content-Type': isCover ? 'image/png' : 'audio/wav', ...cors });
        res.end(isCover ? PNG : WAV);
        return;
      }
      send(404, { error: { code: 'not_found', message: 'nf' } });
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

/* ---- 30 сценариев ------------------------------------------------------------ */

const R = String.raw;
const SCENARIOS = [
  // ===== Простой режим (кнопка «Сгенерировать трек», автолирика) ============
  { id: '01-ru-synthwave', path: 'simple', name: 'RU-идея synthwave → EN-лирика по дефолту',
    idea: 'тёмный synthwave про ночную трассу',
    expect: { family: 'synthwave', language: 'en', moodLine: 'nostalgic', warnings: [] } },
  { id: '02-ru-explicit-ru', path: 'simple', name: 'RU-идея «на русском» → RU-лирика (Н1: жанр из перевода)',
    idea: 'грустная песня на русском про осень и дожди',
    expect: { family: 'ballad', moodLine: 'emotional', language: 'ru', warnings: [] } },
  { id: '03-ru-fast-desync', path: 'simple', name: 'джангл 170 BPM + «на русском» → десинк-гарда (Н2: drum and bass)',
    idea: 'быстрый джангл 170 BPM, песню на русском',
    expect: { family: 'drum and bass', moodLine: 'euphoric', language: 'ru', warnings: ['desync'] } },
  { id: '04-en-techno', path: 'simple', name: 'EN-идея melodic techno (без перевода)',
    idea: 'melodic techno, 125 BPM, hypnotic pads',
    expect: { family: 'techno', language: 'en', warnings: [] } },
  { id: '05-no-genre', path: 'simple', name: 'RU-идея без жанра (кот на подоконнике)',
    idea: 'песня про кота, который спит на подоконнике',
    expect: { language: 'en', warnings: [] } },
  { id: '06-eurodance-artist', path: 'simple', name: '«в стиле Руки Вверх» + мужской голос (Н2: eurodance из RU-стема)',
    idea: 'весёлый евродэнс в стиле Руки Вверх, мужской голос, 150 BPM',
    expect: { family: 'eurodance', moodLine: 'euphoric', language: 'en', warnings: ['artist-lyrics'] } },
  { id: '07-french', path: 'simple', name: '«на французском» → FR-лирика, без params.language',
    idea: 'песня на французском про Париж и дождь',
    expect: { language: null, lyricsTag: 'French lyrics', warnings: [] } },
  { id: '08-metallica', path: 'simple', name: '«как у Metallica» — имя в идее (Н1+Н2: heavy metal из перевода)',
    idea: 'тяжёлый трек как у Metallica',
    expect: { family: 'heavy metal', moodLine: 'aggressive', language: 'en', warnings: [] } },
  { id: '09-trap-male', path: 'simple', name: 'RU-идея трэп + «мужской голос»',
    idea: 'трэп 140 BPM про ночной город, мужской голос',
    expect: { family: 'trap', language: 'en', warnings: [] } },
  { id: '10-girl-pop', path: 'simple', name: '«девичий поп» → женский профиль',
    idea: 'девичий поп, грустный, 100 BPM',
    expect: { family: 'pop', language: 'en', warnings: [] } },
  { id: '11-cinematic', path: 'simple', name: 'эпичная киномузыка (Н2: RU-стем киномузык → cinematic)',
    idea: 'эпичная киномузыка для финальной битвы',
    expect: { family: 'cinematic', moodLine: 'cinematic', language: 'en', warnings: [] } },
  { id: '12-markdown-mess', path: 'simple', name: 'markdown-мусор в идее (sanitize)',
    idea: '**"Мощный динамичный трек с басом"**, 90 BPM, техно',
    expect: { language: 'en', warnings: [] } },
  // ===== Инструментал (тумблер «Инструментал») ==============================
  { id: '13-inst-ambient-ru', path: 'instrumental', name: 'RU-идея эмбиент, инструментал',
    idea: 'мрачный эмбиент, космос, без ритма',
    expect: { family: 'ambient', language: null, warnings: [] } },
  { id: '14-inst-techno-en', path: 'instrumental', name: 'EN-идея techno, инструментал',
    idea: 'hypnotic techno, 130 BPM, warehouse',
    expect: { family: 'techno', language: null, warnings: [] } },
  { id: '15-inst-jazz-ru', path: 'instrumental', name: 'RU-идея ночной джаз, инструментал',
    idea: 'ночной джаз, контрабас, щётки',
    expect: { family: 'jazz', language: null, warnings: [] } },
  // ===== Тонкая настройка (ручная лирика) ====================================
  { id: '16-adv-en-dreampop', path: 'advanced', name: 'EN-промт + EN-лирика с каркасом (авторский ASCII не переписывается)',
    idea: 'dream pop, 90 BPM, female vocals',
    lyrics: '[Intro]\n[Verse 1]\nSilver morning through the curtain lace\nQuiet coffee, letters I don\'t send\n[Pre-Chorus]\nAnd the day begins to hum\n[Chorus]\nSlow light, hold me in the haze\nSlow light, endless summer days\n[Verse 2]\nSilver morning through the curtain lace\nQuiet coffee, letters I don\'t send\n[Chorus]\nSlow light, hold me in the haze\nSlow light, endless summer days\n[Bridge]\nFade the city, fade the noise\n[Final Chorus]\nSlow light, hold me in the haze\nSlow light, endless summer days\n[Outro]',
    expect: { family: 'dream pop', language: 'en', promptUntouched: true, warnings: [] } },
  { id: '17-adv-ru-fast', path: 'advanced', name: 'RU-лирика на 170 BPM → десинк-гарда (Н2: брейкбиты вместо generic)',
    idea: 'джангл, 170 BPM, быстрая сетка',
    lyrics: '[Verse 1]\nГород спит и фонари гаснут\n[Chorus]\nА я не сплю\n[Verse 2]\nГород спит и фонари гаснут\n[Chorus]\nА я не сплю',
    expect: { family: 'drum and bass', language: 'ru', warnings: ['desync'] } },
  { id: '18-adv-ru-ballad', path: 'advanced', name: 'та же RU-лирика на 80 BPM → гарда молчит (Н1: ballad из перевода)',
    idea: 'лирическая баллада, 80 BPM',
    lyrics: '[Verse 1]\nГород спит и фонари гаснут\n[Chorus]\nА я не сплю\n[Verse 2]\nГород спит и фонари гаснут\n[Chorus]\nА я не сплю',
    expect: { family: 'ballad', language: 'ru', warnings: [] } },
  { id: '19-adv-hook-drift', path: 'advanced', name: 'разные припевы → предупреждение хука',
    idea: 'dream pop, 100 BPM',
    lyrics: '[Verse 1]\nстрока один\n[Chorus]\nПрипев с ветром\n[Verse 2]\nстрока один\n[Chorus]\nПрипев с дождём',
    expect: { language: 'ru', promptUntouched: true, warnings: ['hook'] } },
  { id: '20-adv-verse-parity', path: 'advanced', name: 'куплет 2 длиннее → слоговая дельта',
    idea: 'dream pop, 100 BPM',
    lyrics: '[Verse 1]\nстрока один\n[Chorus]\nПрипев один\n[Verse 2]\nстрока два короткая совсем некстати длинная\n[Chorus]\nПрипев один',
    expect: { language: 'ru', promptUntouched: true, warnings: ['parity'] } },
  { id: '21-adv-authored-brackets', path: 'advanced', name: 'авторские брекеты эффектов — проходят как есть',
    idea: 'rock, 120 BPM, male vocals',
    lyrics: '[Intro: clean guitar arpeggio]\n[Verse 1: bass only]\nStanding on the edge of something new\n[Chorus: full band, gang vocals]\nBreak the silence, break the night\n[Verse 2: drums enter]\nStanding on the edge of something new\n[Chorus: full band, gang vocals]\nBreak the silence, break the night\n[Bridge: guitar feedback swell]\nOne last time before the fall\n[Final Chorus: double tempo, key change]\nBreak the silence, break the night\n[Outro: feedback fades]',
    expect: { family: 'rock', language: 'en', promptUntouched: true, authoredBrackets: true, warnings: [] } },
  { id: '22-adv-no-tags', path: 'advanced', name: 'лирика без секционных тегов → предупреждение структуры',
    idea: 'lo-fi, 80 BPM',
    lyrics: 'Просто текст без тегов\nВторая строка песни\nТретья строка',
    expect: { language: 'ru', promptUntouched: true, warnings: ['structure'] } },
  { id: '23-adv-mixed-lang', path: 'advanced', name: 'смешанная RU/EN лирика → язык ru, EN-строки в профиле',
    idea: 'trip-hop, 95 BPM',
    lyrics: '[Verse 1]\nТени на стенах старого дома\nCity lights are humming low\n[Chorus]\nНочь держит меня\nCity lights are humming low\n[Verse 2]\nТени на стенах старого дома\nCity lights are humming low\n[Chorus]\nНочь держит меня\nCity lights are humming low',
    expect: { family: 'trip-hop', language: 'ru', promptUntouched: true, warnings: [] } },
  { id: '24-adv-artist-lyrics', path: 'advanced', name: '«в стиле Кино» + слово «кино» в лирике (Н3: title без дыры посередине)',
    idea: 'рок в стиле Кино, 120 BPM',
    lyrics: '[Verse 1]\nМы смотрели кино до утра\n[Chorus]\nНочные окна\n[Verse 2]\nМы смотрели кино до утра\n[Chorus]\nНочные окна',
    expect: { family: 'rock', language: 'ru', title: 'Ночные окна', warnings: ['artist-lyrics'] } },
  { id: '25-adv-metal-ru', path: 'advanced', name: '«брутальный металл» + рык (Н2: heavy metal из RU-стема)',
    idea: 'брутальный металл, рык, 145 BPM',
    lyrics: '[Verse 1]\nСталь и пепел на моём пути\n[Chorus]\nЯрость рвётся наружу\n[Verse 2]\nСталь и пепел на моём пути\n[Chorus]\nЯрость рвётся наружу',
    expect: { family: 'heavy metal', language: 'ru', warnings: [] } },
  // ===== Чат-наставник → черновик → генерация =================================
  { id: '26-mentor-dreampop', path: 'mentor', name: 'наставник: дрим-поп черновик → Принять → Сгенерировать',
    chat: 'хочу мечтательный дрим-поп про звёзды',
    expect: { family: 'dream pop', language: 'en', brainPending: true, warnings: [] } },
  { id: '27-mentor-ru-lyrics', path: 'mentor', name: 'наставник: RU-лирика в черновике → language=ru (#45)',
    chat: 'сделай грустный синтвейв на русском про море',
    expect: { family: 'synthwave', language: 'ru', brainPending: true, warnings: [] } },
  { id: '28-mentor-long-prompt', path: 'mentor', name: 'наставник: промт 560 символов → потолок 640',
    chat: 'сделай мощный эмбиент для медитации',
    expect: { family: 'ambient', language: 'en', brainPending: true, warnings: [] } },
  { id: '29-mentor-artist-title', path: 'mentor', name: 'наставник: имя «Руки Вверх» в названии → автоочистка',
    chat: 'сделай трек как у Руки Вверх',
    expect: { language: 'en', brainPending: true, warnings: ['artist-title'] } },
  { id: '30-mentor-second-turn', path: 'mentor2', name: 'наставник: второй ход диалога «припев мощнее» → новая генерация',
    chat: 'хочу мечтательный дрим-поп про звёзды',
    chat2: 'сделай припев мощнее',
    expect: { family: 'dream pop', language: 'en', brainPending: true, warnings: [] } },
];

/* ---- Прогон ------------------------------------------------------------------ */

const ASCII = s => !/[^\x00-\x7F]/.test(s);

(async () => {
  const staticSrv = await staticServer(STATIC_PORT);
  const bff = await bffServer(BFF_PORT);
  const browser = await launch();
  const results = [];
  const openMore = async p => { if (!(await p.locator('#morePanel').isVisible())) await p.locator('#moreBtn').click(); };
  async function waitForState(fn, { timeout = 30000, what = 'state' } = {}) {
    const started = Date.now();
    while (!fn(state)) {
      if (Date.now() - started > timeout) throw new Error('waitForState timeout: ' + what);
      await new Promise(r => setTimeout(r, 80));
    }
  }

  for (const sc of SCENARIOS) {
    const rec = { id: sc.id, name: sc.name, path: sc.path, ok: true, problems: [], notes: [] };
    const jobCount = state.jobPosts.length;
    const chatCount = state.chatPosts.length;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const p = await context.newPage();
    const pageErrors = [];
    p.on('pageerror', e => pageErrors.push(e.message));
    try {
      await p.addInitScript(({ t, port }) => {
        localStorage.setItem('briix-media-live-token', t);
        localStorage.setItem('briix-media-live-server', JSON.stringify('http://127.0.0.1:' + port));
        localStorage.setItem('briix-studio-profiles', JSON.stringify({ tester: { pinHash: 'x', created: 0 } }));
        localStorage.setItem('briix-studio-user', 'tester');
      }, { t: TOKEN, port: BFF_PORT });
      await p.goto(`http://127.0.0.1:${STATIC_PORT}/studio/index.html`);
      await p.waitForSelector('#send');

      if (sc.path === 'simple' || sc.path === 'instrumental') {
        if (sc.path === 'instrumental') { await openMore(p); await p.locator('.seg-btn[data-vocal="1"]').click(); }
        await p.locator('#prompt').fill(sc.idea);
        await openMore(p);
        await p.locator('#genTrack').click();
      } else if (sc.path === 'advanced') {
        await openMore(p); await p.locator('#tuneToggle').click();
        await p.locator('#musicPrompt').fill(sc.idea);
        await p.locator('#lyrics').fill(sc.lyrics);
        await p.locator('#send').click();
      } else { // mentor / mentor2
        await p.locator('#prompt').fill(sc.chat);
        await p.locator('#send').click();
        await p.waitForSelector('.card.assistant .music-draft', { timeout: 15000 });
        const applyDraft = async () => {
          const card = p.locator('.card.assistant .music-draft').last();
          await card.getByRole('button', { name: 'Принять в поля' }).click();
          // Поля уже заполнены и отличаются — студия спрашивает подтверждение.
          const confirm = p.locator('.confirm-dialog');
          try { await confirm.waitFor({ state: 'visible', timeout: 2500 }); await confirm.getByRole('button', { name: 'Заменить' }).click(); } catch { /* диалог не нужен */ }
          await p.waitForTimeout(250);
        };
        await applyDraft();
        if (sc.path === 'mentor2') {
          await p.locator('#prompt').fill(sc.chat2);
          await p.locator('#send').click();
          await p.waitForFunction(() => document.querySelectorAll('.card.assistant .music-draft').length >= 2, {}, { timeout: 15000 });
          await applyDraft();
        }
        await p.locator('.card.assistant .music-draft').last().getByRole('button', { name: 'Сгенерировать трек' }).click();
      }

      await waitForState(() => state.jobPosts.length > jobCount, { what: sc.id + ': job POST' });
      await p.waitForSelector('.card.assistant audio', { timeout: 30000 });
      await p.waitForTimeout(300); // карточки предупреждений рендерятся до аудио, даём досесть

      // ---- что уехало в модель ----
      const post = state.jobPosts.at(-1);
      rec.post = { prompt: post.prompt, params: { ...post.params } };
      if (post.type !== 'music') throw new Error(sc.id + ': job type ' + post.type);
      rec.promptLen = post.prompt.length;
      // ---- что увидел пользователь ----
      const notices = await p.$$eval('.card.notice', els => els.map(e => ({ title: e.querySelector('.who')?.textContent || '', text: (e.querySelector('.body')?.textContent || '').slice(0, 220) })));
      rec.notices = notices;
      const draftWarnings = await p.$$eval('.draft-warning', els => els.map(e => e.textContent.replace(/^⚠\s*/, '').slice(0, 220)));
      rec.draftWarnings = draftWarnings;
      const badges = await p.$$eval('.card.assistant .brain-badge', els => els.map(e => e.textContent));
      rec.badges = badges;
      rec.pageErrors = pageErrors;

      // ---- чат-каналы (что мозг сказал моделям) ----
      const chats = state.chatPosts.slice(chatCount);
      const songwriter = chats.find(c => /Ты — автор песен/.test(c.messages[0]?.content || ''));
      const translator = chats.find(c => /Output ONLY the English prompt/.test(c.messages[0]?.content || ''));
      rec.songwriterPrompt = songwriter ? {
        language: /по-английски/.test(songwriter.messages[0].content) ? 'en'
          : /на русском/.test(songwriter.messages[0].content) ? 'ru'
          : /français/.test(songwriter.messages[0].content) ? 'fr' : '?',
        atmosphere: (songwriter.messages[0].content.match(/Атмосфера трека: ([^—]+) —/) || [])[1]?.trim() || null
      } : null;
      rec.translated = translator ? translator.messages.at(-1).content : null;

      // ---- инварианты ----
      const fail = msg => { rec.ok = false; rec.problems.push(msg); };
      if (post.prompt.length > 640) fail('prompt > 640: ' + post.prompt.length);
      if (!ASCII(post.prompt)) fail('prompt не ASCII');
      if (/\[(?:verse|chorus|intro|bridge|outro|pre-chorus)/i.test(post.prompt)) fail('секционные теги в prompt');
      const par = post.params || {};
      if (sc.path === 'instrumental') {
        if (par.lyrics !== undefined) fail('instrumental: params.lyrics есть');
        if (par.language !== undefined) fail('instrumental: params.language есть');
        if (!/instrumental/.test(post.prompt)) fail('instrumental: тега instrumental нет в prompt');
      } else {
        const tag = /Russian lyrics/.test(post.prompt) ? 'ru' : /French lyrics/.test(post.prompt) ? 'fr' : /English lyrics/.test(post.prompt) ? 'en' : null;
        const lang = par.language === 'ru' ? 'ru' : par.language === 'en' ? 'en' : null;
        // Авторский ASCII-промт (#109) мозг не собирает — тега языка в caption нет,
        // язык говорит только params.language (одно указание, без противоречия).
        // Французский живёт только тегом: bff не валидирует params.language=fr.
        const brainBuilt = !sc.expect.promptUntouched;
        const tagOk = tag === lang || (tag === 'fr' && lang === null) || (!brainBuilt && tag === null && lang);
        if (!tagOk) fail('язык: тег caption ' + tag + ' ≠ params.language ' + lang);
        if (sc.expect.language !== undefined) {
          const want = sc.expect.language;
          if (want === 'en' && lang !== 'en') fail('ожидали en, получили ' + lang);
          if (want === 'ru' && lang !== 'ru') fail('ожидали ru, получили ' + lang);
          if (want === null && lang !== null) fail('ожидали без language, получили ' + lang);
        }
        if (sc.expect.lyricsTag && !post.prompt.includes(sc.expect.lyricsTag)) fail('нет тега ' + sc.expect.lyricsTag);
      }
      if (par.model !== 'ace-step-flash') fail('модель не flash: ' + par.model);
      // брекеты: EN ASCII, в тегах секций
      const sentLyrics = par.lyrics || '';
      const fx = sentLyrics.match(/\[[^\]\n]+: [^\]\n]+\]/g) || [];
      rec.brackets = { count: fx.length, sample: fx.slice(0, 4) };
      if (fx.some(b => !/^[\[\]:A-Za-z0-9 ,'+-]+$/.test(b))) fail('не-EN брекет: ' + fx.find(b => !/^[\[\]:A-Za-z0-9 ,'+-]+$/.test(b)));
      // §3 «без дословных повторов» — правило МОЗГА; автор может повторять эффект
      // на повторяющихся секциях — это его художественный выбор.
      if (!sc.expect.authoredBrackets && new Set(fx).size !== fx.length) fail('дубли брекетов');
      // текст лирики не переписан (ручная лирика)
      if (sc.path === 'advanced' && sc.lyrics) {
        const userLines = sc.lyrics.split('\n').map(s => s.trim()).filter(s => s && !/^\[/.test(s));
        const sentText = sentLyrics.split('\n').map(s => s.trim()).filter(s => s && !/^\[/.test(s)).join('\n');
        for (const line of userLines) if (!sentText.includes(line)) { fail('строка лирики изменена: ' + line); break; }
      }
      // авторские брекеты — проходят без перезаписи
      if (sc.expect.authoredBrackets) {
        const authored = sc.lyrics.match(/\[[^\]\n]+: [^\]\n]+\]/g) || [];
        const missing = authored.filter(b => !sentLyrics.includes(b));
        if (missing.length) fail('авторский брекет не прошёл: ' + missing[0]);
        if (!badges.some(b => /Аранжировка автора/.test(b))) fail('нет бейджа «Аранжировка автора»');
      }
      // title не тег и не имя
      if (par.title && /^\[[^\]]+\]$/.test(par.title.trim())) fail('title — секционный тег: ' + par.title);
      // ожидаемые предупреждения
      const noticeText = notices.map(n => n.title + ' ' + n.text).join(' | ');
      const warns = sc.expect.warnings || [];
      if (warns.includes('desync') && !/Мелодичность лирики/.test(noticeText)) fail('нет карточки десинка');
      if (warns.includes('hook') && !/Припевы различаются/.test(noticeText)) fail('нет предупреждения хука');
      if (warns.includes('parity') && !/Куплет 2, строка 1/.test(noticeText)) fail('нет предупреждения парности');
      if (warns.includes('structure') && !/Структура лирики/.test(noticeText)) fail('нет предупреждения структуры');
      if (warns.includes('artist-lyrics') && !/Имя исполнителя в тексте песни/.test(noticeText)) fail('нет предупреждения имени в лирике');
      // Имя в названии чистит ещё guardMusicDraft на этапе черновика — варн в карточке черновика.
      if (warns.includes('artist-title') && !/Название совпало с именем исполнителя/.test(draftWarnings.join(' | '))) fail('нет карточки очистки названия');
      // ложные срабатывания
      if (!warns.length && /Мелодичность лирики|Структура лирики|Припевы различаются|Имя исполнителя в тексте/.test(noticeText))
        rec.notes.push('предупреждение вне ожиданий: ' + noticeText.slice(0, 160));
      // семейство, слои и атмосфера (Н1/Н2 #51): ожидания стали строгими —
      // семейный голос/настроение больше не могут молча потеряться.
      if (sc.expect.family) {
        const famOk = (rec.badges.join(' ') + ' ' + post.prompt).toLowerCase().includes(sc.expect.family)
          || (rec.songwriterPrompt?.atmosphere || '').toLowerCase().includes(sc.expect.family);
        if (!famOk) fail('семейство ' + sc.expect.family + ' не видно в сборке (бейджи: ' + rec.badges.join(' | ') + ')');
      }
      if (sc.expect.moodLine !== undefined && rec.songwriterPrompt
        && !(rec.songwriterPrompt.atmosphere || '').includes(sc.expect.moodLine))
        fail('атмосфера автору песен: ' + (rec.songwriterPrompt.atmosphere || 'null') + ' (ожидали ' + sc.expect.moodLine + ')');
      if (sc.expect.title && par.title !== sc.expect.title)
        fail('title: ' + JSON.stringify(par.title) + ' (ожидали ' + JSON.stringify(sc.expect.title) + ')');
      if (sc.expect.promptUntouched && post.prompt !== sc.idea) fail('авторский ASCII-промт переписан: ' + post.prompt.slice(0, 80));
      if (sc.expect.brainPending) {
        if (!badges.some(b => /Промт собран мозгом/.test(b))) fail('нет плашки слоёв мозга (brainPending-путь)');
        if (post.prompt.length <= (sc.id === '28-mentor-long-prompt' ? 560 : 0)) fail('мозг не добавил слои к строке наставника');
      }
      if (sc.id === '28-mentor-long-prompt' && !post.prompt.startsWith('dark ambient, deep space drones')) fail('строка наставника не первая');
      if (pageErrors.length) fail('ошибки страницы: ' + pageErrors[0]);
      // vocalist: карточка «Мелодичность» должна существовать для RU+fast, отсутствовать для остальных
    } catch (e) {
      rec.ok = false;
      rec.problems.push('CRASH: ' + (e && e.message ? e.message : String(e)).slice(0, 300));
    }
    await context.close();
    results.push(rec);
    console.log((rec.ok ? 'PASS' : 'FAIL') + ' ' + sc.id + ' — ' + sc.name + (rec.problems.length ? ' :: ' + rec.problems.join('; ') : '') + (rec.notes.length ? ' NOTE: ' + rec.notes.join('; ') : ''));
  }

  await browser.close();
  bff.close(); staticSrv.close();
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2));
  const failed = results.filter(r => !r.ok);
  console.log('\nИТОГ: ' + (results.length - failed.length) + '/' + results.length + ' сценариев без нарушений');
  if (failed.length) { console.log('FAIL ids: ' + failed.map(f => f.id).join(', ')); process.exitCode = 1; }
  console.log('JSON: ' + OUT_JSON);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
