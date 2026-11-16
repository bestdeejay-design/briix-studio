/* Волна карточки трека из СЕРВЕРНЫХ пиков /files/{id}-peaks.json (решение владельца
 * 14.11): рисуется мгновенно из массива пиков — без клиентского декода, без бюджетов.
 * R4 (T-38/F-25/F-26): два слоя — статичные бары и акцентный прогресс-слой
 * открываются CSS-клипом (O(1) на timeupdate вместо перерисовки 400 баров);
 * canvas под devicePixelRatio (Retina без мыла), ResizeObserver перерисовывает
 * при смене ширины, офскрин-волна освобождает canvas, тач-зона ≥44px.
 * Клик по волне = seek (если аудио ещё не загружено — запоминается и применяется
 * после). Нет пиков (старые треки) — тихий нативный плеер, без сообщений в UI. */
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
    const base = document.createElement('canvas'); base.className = 'waveform-canvas';
    base.setAttribute('aria-hidden', 'true');
    const progress = document.createElement('canvas'); progress.className = 'waveform-progress';
    progress.setAttribute('aria-hidden', 'true');
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1000'; slider.value = '0';
    slider.className = 'waveform-seek'; slider.setAttribute('aria-label', 'Позиция воспроизведения');
    box.append(base, progress, slider); container.append(box);

    let audio = null;
    let pendingRatio = null;
    let lastRatio = 0;
    const accent = cssVar(box, '--accent', '#d97757');
    const dim = cssVar(box, '--faint', 'rgba(235, 235, 245, .35)');

    // Слой баров одним цветом; оба слоя живут в своих canvas.
    const paintLayer = (canvas, color) => {
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      for (let i = 0; i < bars; i++) {
        const height = Math.max(1, values[i] * h);
        ctx.fillRect(i * (w / bars), (h - height) / 2, Math.max(2, w / bars - 2), height);
      }
    };
    // T-38: прогресс — CSS-клип готового акцентного слоя: на каждый timeupdate
    // меняется одна строка стиля, 400 баров не перерисовываются вовсе.
    const setProgress = ratio => {
      const clamped = Math.min(1, Math.max(0, ratio));
      progress.style.clipPath = 'inset(0 ' + (Math.round((1 - clamped) * 1000) / 10) + '% 0 0)';
    };
    // T-38: backing store = CSS-размер × devicePixelRatio; при отсутствии layout
    // (карточка ещё не в DOM) — безопасный fallback, ResizeObserver поправит.
    const sizeCanvases = () => {
      const cssWidth = Math.floor(box.clientWidth) || 640;
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      for (const canvas of [base, progress]) {
        canvas.width = Math.max(80, Math.round(cssWidth * dpr));
        canvas.height = Math.round(36 * dpr);
      }
      paintLayer(base, dim);
      paintLayer(progress, accent);
      setProgress(lastRatio);
    };
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => sizeCanvases());
      ro.observe(box);
    }
    // T-38: волна вне вьюпорта не держит 184 КБ canvas-памяти — освобождаем,
    // при возврате перерисовываем.
    if (typeof IntersectionObserver === 'function') {
      let inView = true;
      const io = new IntersectionObserver(records => {
        const visible = records.some(r => r.isIntersecting);
        if (visible === inView) return;
        inView = visible;
        if (visible) sizeCanvases();
        else { base.width = 0; progress.width = 0; }
      });
      io.observe(box);
    }
    sizeCanvases();

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
      setProgress(lastRatio);
    };
    // Клик-зона — весь блок волны (F-26: ≥44px на мобайле), не только 36px canvas.
    box.addEventListener('click', event => {
      const rect = base.getBoundingClientRect();
      if (!rect.width) return;
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
      if (audio && Number.isFinite(audio.duration) && audio.duration > 0) lastRatio = audio.currentTime / audio.duration;
      setProgress(lastRatio); sync();
    };

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
