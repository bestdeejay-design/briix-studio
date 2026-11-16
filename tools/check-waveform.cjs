/* Волна карточки трека из серверных пиков (решение владельца 14.11): рисуется сразу,
 * клик = seek, прогресс подсвечен, pending-seek до появления аудио, тихий отказ.
 * Клиентского декода больше нет — ни одного AudioContext во всей сюите. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { launch } = require('./browser-env.cjs');
(async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><style>:root{--accent:#d97757;--faint:rgba(235,235,245,.35)}</style><div id="a"></div><div id="b"></div>');
    await page.addScriptTag({ path: path.resolve(__dirname, '../studio/waveform.js') });
    // Настоящий играбельный WAV (2 с) — для аудио-перемотки по волне.
    const sampleRate = 16000, samples = sampleRate * 2;
    const bytes = new ArrayBuffer(44 + samples * 2), v = new DataView(bytes);
    const str = (offset, text) => [...text].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint32(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) {
      const amplitude = i < samples / 2 ? 0.03 : 0.8;
      v.setInt16(44 + i * 2, Math.round(amplitude * Math.sin(2 * Math.PI * 440 * i / sampleRate) * 32767), true);
    }
    const wavB64 = Buffer.from(bytes).toString('base64');
    await page.evaluate(async encoded => {
      const binary = atob(encoded), raw = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i);
      window.sampleBlob = new Blob([raw], { type: 'audio/wav' });
      // Пики: тихая первая половина, громкая вторая — волна обязана это показать.
      const peaks = Array.from({ length: 160 }, (_, i) => (i < 80 ? 0.03 : 0.8));
      window.wave = BriixWaveform.attachFromPeaks(peaks, document.getElementById('a'), {});
    }, wavB64);
    // Волна построена мгновенно из пиков — аудио ещё не существует вовсе.
    await page.waitForSelector('#a canvas');
    assert.equal(await page.locator('#a audio').count(), 0, 'wave exists before any audio element');
    // R4/T-38: два слоя — статичные бары + акцентный прогресс; тач-зона ≥44px (F-26).
    assert.equal(await page.locator('#a .waveform canvas').count(), 2, 'static base + accent progress layers (T-38)');
    const hitBox = await page.evaluate(() => document.querySelector('#a .waveform').getBoundingClientRect().height);
    assert.ok(hitBox >= 44, 'wave hit area >= 44px (F-26): ' + hitBox);
    const dprGeo = await page.evaluate(() => {
      const c = document.querySelector('#a .waveform-canvas');
      return { backing: c.width, css: c.clientWidth, dpr: Math.min(3, window.devicePixelRatio || 1) };
    });
    assert.ok(dprGeo.backing >= dprGeo.css * dprGeo.dpr - 2, 'canvas backing store = CSS size * devicePixelRatio (T-38): ' + JSON.stringify(dprGeo));
    // Привязываем настоящее аудио и проверяем клик-seek и подсветку прогресса.
    await page.evaluate(() => {
      const NativeAudio = window.AudioContext;
      window.AudioContext = class extends NativeAudio {
        constructor(...args) { super(...args); window.__ctxLeaks = (window.__ctxLeaks || 0) + 1; }
      };
      const audio = document.createElement('audio');
      audio.controls = true; audio.controlsList = 'nodownload'; audio.src = URL.createObjectURL(sampleBlob);
      document.getElementById('a').append(audio);
      window.wave.setAudio(audio);
    });
    await page.waitForFunction(() => Number.isFinite(document.querySelector('#a audio')?.duration) && document.querySelector('#a audio').duration > 0);
    const peaks = await page.evaluate(() => {
      const canvas = document.querySelector('#a canvas'), ctx = canvas.getContext('2d');
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let quiet = 0, loud = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3]) { if (x < canvas.width / 2) quiet++; else loud++; }
      }
      return { quiet, loud };
    });
    assert.ok(peaks.loud > peaks.quiet * 5, 'loud peaks produce larger bars than quiet peaks');
    await page.evaluate(() => {
      const canvas = document.querySelector('#a canvas');
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + rect.width * 0.5, clientY: rect.top + 10 }));
    });
    await page.waitForFunction(() => Math.abs(document.querySelector('#a audio').currentTime - 1) < 0.1, {}, { timeout: 5000 });
    const sliderInfo = await page.evaluate(() => {
      const slider = document.querySelector('#a .waveform-seek');
      slider.value = '750'; slider.dispatchEvent(new Event('input', { bubbles: true }));
      return { currentTime: document.querySelector('#a audio').currentTime, label: slider.getAttribute('aria-label') };
    });
    assert.ok(Math.abs(sliderInfo.currentTime - 1.5) < 0.1, 'hidden a11y slider still seeks native audio');
    assert.match(sliderInfo.label, /Позиция/);
    // Прогресс подсвечен: на слоях есть и акцентные, и приглушённые бары —
    // прогресс открывается CSS-клипом акцентного слоя (T-38), без repaint баров.
    await page.waitForFunction(() => {
      const canvases = document.querySelectorAll('#a canvas');
      const seen = new Set();
      for (const canvas of canvases) {
        const ctx = canvas.getContext('2d');
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) seen.add(pixels[i - 3] + ',' + pixels[i - 2] + ',' + pixels[i - 1]);
      }
      return seen.size >= 2;
    }, {}, { timeout: 5000 });
    assert.match(await page.evaluate(() => document.querySelector('#a .waveform-progress').style.clipPath), /inset\(0/, 'progress moves via CSS clip, not repaint (T-38)');
    // T-38: смена ширины пересобирает backing store (ResizeObserver).
    const widthBefore = await page.evaluate(() => document.querySelector('#a .waveform-canvas').width);
    await page.setViewportSize({ width: 500, height: 400 });
    await page.waitForFunction(w => document.querySelector('#a .waveform-canvas').width !== w, widthBefore, { timeout: 5000 });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForFunction(w => document.querySelector('#a .waveform-canvas').width === w, widthBefore, { timeout: 5000 });
    // Pending-seek: волна без аудио — клик вызывает onSeekPending и применяется при setAudio.
    await page.evaluate(() => {
      window.pending = [];
      window.wave2 = BriixWaveform.attachFromPeaks(Array.from({ length: 160 }, () => 0.5), document.getElementById('b'), {
        onSeekPending: ratio => window.pending.push(ratio)
      });
      const canvas = document.querySelector('#b canvas');
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + rect.width * 0.75, clientY: rect.top + 10 }));
      const audio = document.createElement('audio');
      audio.src = URL.createObjectURL(sampleBlob);
      document.getElementById('b').append(audio);
      window.wave2.setAudio(audio);
    });
    await page.waitForFunction(() => Math.abs(document.querySelector('#b audio').currentTime - 1.5) < 0.15, {}, { timeout: 5000 });
    assert.deepEqual(await page.evaluate(() => window.pending), [0.75], 'seek before audio is reported once and applied on setAudio');
    // Ни одного AudioContext: декода не существует, PCM-память не тратится вовсе.
    assert.equal(await page.evaluate(() => window.__ctxLeaks || 0), 0, 'no AudioContext is ever created — peaks render without decode');
    const m4a = fs.readFileSync(path.resolve(__dirname, '../assets/media/showcase/jingle.m4a')).toString('base64');
    await page.evaluate(encoded => {
      // Тот же peaks-путь работает с любым аудио (формат файла волне безразличен).
      const binary = atob(encoded), raw = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i);
      const blob = new Blob([raw], { type: 'audio/mp4' }), container = document.createElement('div');
      container.id = 'm4a'; document.body.append(container);
      const audio = document.createElement('audio'); audio.controls = true; audio.src = URL.createObjectURL(blob); container.append(audio);
      BriixWaveform.attachFromPeaks(Array.from({ length: 160 }, (_, i) => Math.abs(Math.sin(i / 7))), container, {}).setAudio(audio);
    }, m4a);
    await page.waitForSelector('#m4a canvas');
    console.log('PASS peaks waveform: instant draw, DPR+ResizeObserver, two layers with CSS-clip progress, click seek, a11y slider, pending seek, zero AudioContext', JSON.stringify(peaks));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
