/* Real PCM peaks, decoded automatically when the player appears (no opt-in) and one
 * track at a time. Canvas click = seek, progress is highlighted on the wave.
 * Budgets and fallbacks stay: 8 MiB file, 60 s, 32 MiB PCM; native controls remain. */
(() => {
  'use strict';
  let queue = Promise.resolve();
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const MAX_PLAYBACK_SECONDS = 60;
  const RATE = 16000;
  const MAX_PCM_BYTES = 32 * 1024 * 1024;
  const FALLBACK = 'Форма звука недоступна для этого файла. Обычный плеер доступен.';

  function formatTime(seconds) {
    const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }
  function cssVar(box, name, fallback) {
    const value = getComputedStyle(box).getPropertyValue(name).trim();
    return value || fallback;
  }
  function attach(audio, blob, container) {
    const box = document.createElement('div'); box.className = 'waveform';
    const status = document.createElement('span'); status.className = 'waveform-status'; status.setAttribute('role', 'status');
    box.append(status); container.append(box);
    audio.addEventListener('play', () => {
      document.querySelectorAll('audio').forEach(other => { if (other !== audio) other.pause(); });
    });
    const start = () => {
      if (!box.isConnected || box.closest('[hidden]')) return;
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) { status.textContent = FALLBACK; return; }
      if (!blob || blob.size > MAX_FILE_BYTES || audio.duration > MAX_PLAYBACK_SECONDS) { status.textContent = FALLBACK; return; }
      status.textContent = 'Готовим форму звука…';
      const task = async () => {
        let context, observer, closing;
        const closeContext = () => {
          if (context && context.state !== 'closed' && !closing) closing = context.close().catch(() => {});
          return closing;
        };
        try {
          if (!box.isConnected || box.closest('[hidden]')) return;
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) throw new Error('Декодирование не поддерживается');
          context = new Audio({ sampleRate: RATE });
          observer = new MutationObserver(() => {
            if (!box.isConnected || box.closest('[hidden]')) { observer.disconnect(); closeContext(); }
          });
          observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
          if (context.sampleRate > RATE) throw new Error('Превышен бюджет памяти');
          const bytes = await blob.arrayBuffer();
          const buffer = await context.decodeAudioData(bytes);
          if (buffer.length * buffer.numberOfChannels * 4 > MAX_PCM_BYTES) throw new Error('Превышен бюджет памяти');
          if (!box.isConnected || box.closest('[hidden]')) return;
          const bars = 160;
          const peaks = new Float32Array(bars);
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const samples = buffer.getChannelData(channel);
            for (let bar = 0; bar < bars; bar++) {
              const startSample = Math.floor(bar * samples.length / bars), end = Math.floor((bar + 1) * samples.length / bars);
              let peak = peaks[bar];
              for (let n = startSample; n < end; n++) peak = Math.max(peak, Math.abs(samples[n]));
              peaks[bar] = peak;
            }
          }
          const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 72; canvas.className = 'waveform-canvas';
          canvas.setAttribute('aria-hidden', 'true');
          const ctx = canvas.getContext('2d');
          const accent = cssVar(box, '--accent', '#d97757');
          const dim = cssVar(box, '--faint', 'rgba(235, 235, 245, .35)');
          const paint = () => {
            const ratio = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.currentTime / audio.duration : 0;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (let i = 0; i < bars; i++) {
              const height = Math.max(1, peaks[i] * canvas.height);
              ctx.fillStyle = (i + 0.5) / bars <= ratio ? accent : dim; // прогресс подсвечен акцентом
              ctx.fillRect(i * 4, (canvas.height - height) / 2, 2, height);
            }
          };
          // Клик по волне = перемотка.
          canvas.addEventListener('click', event => {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
            const rect = canvas.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            audio.currentTime = ratio * audio.duration;
          });
          // Невидимый range-слайдер — клавиатурный a11y-фолбэк поверх волны.
          const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1000'; slider.value = '0';
          slider.className = 'waveform-seek'; slider.setAttribute('aria-label', 'Позиция воспроизведения');
          const sync = () => {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
            slider.value = String(Math.round(audio.currentTime / audio.duration * 1000));
            slider.setAttribute('aria-valuetext', formatTime(audio.currentTime) + ' из ' + formatTime(audio.duration));
          };
          slider.addEventListener('input', () => { if (Number.isFinite(audio.duration)) audio.currentTime = Number(slider.value) / 1000 * audio.duration; });
          audio.addEventListener('timeupdate', () => { paint(); sync(); });
          audio.addEventListener('seeked', () => { paint(); sync(); });
          audio.addEventListener('loadedmetadata', () => { paint(); sync(); });
          status.remove();
          box.append(canvas, slider);
          paint(); sync();
        } catch (_) {
          if (box.isConnected) status.textContent = 'Не удалось построить форму звука. Обычный плеер доступен.';
        } finally {
          if (observer) observer.disconnect();
          await closeContext();
        }
      };
      queue = queue.then(task, task);
    };
    if (audio.readyState >= 1) start();
    else audio.addEventListener('loadedmetadata', start, { once: true });
  }
  globalThis.BriixWaveform = Object.freeze({ attach });
})();
