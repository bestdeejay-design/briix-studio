/* Смоук аудиторского стенда: вход, чат-стрим, музыкальная джоба. */
'use strict';
const H = require('./harness.cjs');

(async () => {
  const ctx = await H.boot({ storage: { 'briix-media-live-token': 'test-token' } });
  const { doc, win, bff } = ctx;
  console.log('gate hidden:', doc.getElementById('gate').hidden, '| studio hidden:', doc.getElementById('studio').hidden);
  const login = await H.login(ctx);
  console.log('login:', JSON.stringify(login));
  console.log('studio hidden after login:', doc.getElementById('studio').hidden, '| backend warning hidden:', doc.getElementById('storageWarning').hidden);
  console.log('errors:', win.__errors || []);

  // чат
  H.setVal(doc.getElementById('prompt'), 'Привет, расскажи про студию');
  H.click(doc.getElementById('send'));
  await H.settle(30, 20);
  const cards = [...doc.querySelectorAll('#feed .card')].map(c => c.className + ' :: ' + (c.textContent || '').slice(0, 60));
  console.log('--- feed cards ---'); cards.forEach(c => console.log(' ', c));
  console.log('chat requests:', bff.requests.filter(r => /chat\/completions/.test(r.url)).length);

  // музыка (vocal, автолирика)
  H.click(doc.querySelector('.mode[data-mode="music"]'));
  await H.settle();
  H.setVal(doc.getElementById('prompt'), 'психоделик соул про ночной город, женский вокал, на русском');
  H.click(doc.getElementById('genTrack'));
  await H.settle(80, 60);
  const jobPost = bff.requests.find(r => r.url.endsWith('/jobs') && r.method === 'POST' && /"music"/.test(r.body || ''));
  console.log('--- POST /jobs body ---');
  console.log(jobPost ? JSON.stringify(JSON.parse(jobPost.body), null, 1).slice(0, 1400) : 'НЕТ');
  console.log('Idempotency-Key header:', jobPost ? JSON.stringify(jobPost.headers) : '-');
  const polls = bff.requests.filter(r => /\/jobs\/job-audit/.test(r.url) && r.method === 'GET');
  console.log('polls:', polls.length);
  console.log('--- feed after music ---');
  [...doc.querySelectorAll('#feed .card')].forEach(c => console.log(' ', c.className, '::', (c.textContent || '').replace(/\s+/g, ' ').slice(0, 90)));
  console.log('waveform nodes:', doc.querySelectorAll('.waveform').length, '| canvases:', doc.querySelectorAll('canvas').length);
  console.log('audio nodes:', doc.querySelectorAll('audio').length);
  console.log('objectUrls:', JSON.stringify({ ...bff.objectUrls, live: bff.objectUrls.live.size }));
  console.log('intervals:', JSON.stringify({ ...bff.intervals, live: bff.intervals.live.size }));
  console.log('errors:', win.__errors || []);
  process.exit(0);
})().catch(e => { console.error('HARNESS FAIL', e); process.exit(1); });
