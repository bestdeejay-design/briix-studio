/* Волна карточки трека из СЕРВЕРНЫХ пиков /files/{id}-peaks.json (решение владельца
 * 14.11): рисуется мгновенно из массива пиков — без клиентского декода, без бюджетов,
 * трек любой длины. Клик по волне = seek (если аудио ещё не загружено — запоминается
 * и применяется после), прогресс подсвечивается по событиям audio. Нет пиков (старые
 * треки) — тихий нативный плеер, без сообщений в UI (console.warn допустим). */
(() => {
  'use strict';

  function formatTime(seconds) {
    const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }
  function cssVar(box, name, fallback) {
    const value = getComputedStyle(box).getPropertyValue(name).trim();
    return value || fallback;
  }

  // peaks — массив чисел 0..1 (сервер считает из WAV). onSeekPending(ratio) вызывается,
  // когда пользователь тянет волну до появления аудио (карточка может загрузить трек).
  function attachFromPeaks(peaks, container, { onSeekPending } = {}) {
    const values = Array.from(peaks, v => Math.min(1, Math.max(0, Number(v) || 0)));
    const bars = Math.min(values.length, 400);
    if (!bars) throw new Error('Пустой массив пиков.');
    const box = document.createElement('div'); box.className = 'waveform';
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 72; canvas.className = 'waveform-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d');
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1000'; slider.value = '0';
    slider.className = 'waveform-seek'; slider.setAttribute('aria-label', 'Позиция воспроизведения');
    box.append(canvas, slider); container.append(box);

    let audio = null;
    let pendingRatio = null;
    let lastRatio = 0;
    const accent = cssVar(box, '--accent', '#d97757');
    const dim = cssVar(box, '--faint', 'rgba(235, 235, 245, .35)');
    const paint = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < bars; i++) {
        const height = Math.max(1, values[i] * canvas.height);
        ctx.fillStyle = (i + 0.5) / bars <= lastRatio ? accent : dim; // прогресс подсвечен акцентом
        ctx.fillRect(i * (canvas.width / bars), (canvas.height - height) / 2, Math.max(2, canvas.width / bars - 2), height);
      }
    };
    const sync = () => {
      if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
      lastRatio = audio.currentTime / audio.duration;
      slider.value = String(Math.round(lastRatio * 1000));
      slider.setAttribute('aria-valuetext', formatTime(audio.currentTime) + ' из ' + formatTime(audio.duration));
    };
    const seekTo = ratio => {
      lastRatio = ratio;
      if (audio && Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = ratio * audio.duration;
      else { pendingRatio = ratio; if (onSeekPending) onSeekPending(ratio); }
      paint();
    };
    canvas.addEventListener('click', event => {
      const rect = canvas.getBoundingClientRect();
      seekTo(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
    });
    slider.addEventListener('input', () => seekTo(Number(slider.value) / 1000));
    const onTime = () => {
      // Pending-seek применяется, как только длительность стала известна.
      if (audio && pendingRatio != null && Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = pendingRatio * audio.duration;
        pendingRatio = null;
        return;
      }
      paint(); sync();
    };
    paint();

    return {
      box,
      // Аудио может появиться позже карточки (restore-путь): привязываем при готовности.
      setAudio(a) {
        audio = a;
        a.addEventListener('timeupdate', onTime);
        a.addEventListener('seeked', onTime);
        a.addEventListener('loadedmetadata', onTime);
        onTime();
      }
    };
  }

  globalThis.BriixWaveform = Object.freeze({ attachFromPeaks });
})();
