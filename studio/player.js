/* Единственный активный звук студии — модуль вместо встроенного реестра
 * studio.js (T-51, вторая половина / спринт 2 плана): эксклюзивное
 * воспроизведение (новое ставит на паузу предыдущее), метаданные MediaSession
 * (экран блокировки/шторка знают, что играет), формат таймкодов для карточек.
 * Лента, библиотека и restore создают свои <audio>, но проходят через claim().
 * Модуль деградирует тихо: без navigator.mediaSession (jsdom, старые браузеры)
 * остаётся только эксклюзивный транспорт. */
(() => {
  'use strict';

  const live = new Set();
  let current = null;
  let sessionWired = false;

  function fmtTime(seconds) {
    const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  const session = () => {
    try { return typeof navigator !== 'undefined' && navigator.mediaSession ? navigator.mediaSession : null; }
    catch { return null; }
  };

  function setPlaybackState(playing) {
    const ms = session();
    try { if (ms) ms.playbackState = playing ? 'playing' : 'paused'; } catch { /* нет поддержки */ }
  }

  function wireSession() {
    const ms = session();
    if (sessionWired || !ms || typeof ms.setActionHandler !== 'function') return;
    sessionWired = true;
    const on = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* действие не поддерживается */ } };
    on('play', () => { if (current && current.paused) current.play().catch(() => {}); });
    on('pause', () => { if (current && !current.paused) current.pause(); });
    on('stop', () => { if (current) { current.pause(); current.currentTime = 0; } });
    on('seekbackward', () => { if (current) current.currentTime = Math.max(0, (current.currentTime || 0) - 10); });
    on('seekforward', () => { if (current) current.currentTime = Math.min(current.duration || 0, (current.currentTime || 0) + 10); });
  }

  // Метаданные экрана блокировки: название/исполнитель карточки + обложка.
  function setMetadata(meta) {
    wireSession();
    if (!session() || typeof MediaMetadata === 'undefined') return;
    let artwork = '';
    try { artwork = new URL(meta.artwork, location.href).href; } catch { artwork = ''; }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: meta.title || 'Трек BRIIX',
        artist: meta.artist || 'BRIIX Студия',
        album: 'BRIIX Студия',
        artwork: artwork ? [{ src: artwork, sizes: '512x512' }] : []
      });
    } catch { /* нет поддержки — не критично */ }
  }

  // claim(audio, meta): регистрирует аудио в едином реестре. На play гасит
  // остальные, делает себя текущим и выставляет метаданные MediaSession.
  function claim(audio, meta = null) {
    for (const a of [...live]) if (!a.isConnected) live.delete(a);
    if (!live.has(audio)) {
      live.add(audio);
      audio.addEventListener('play', () => {
        current = audio;
        for (const other of live) if (other !== audio && !other.paused) other.pause();
        setPlaybackState(true);
        if (meta) setMetadata(meta);
      });
      audio.addEventListener('pause', () => { if (current === audio) setPlaybackState(false); });
    }
  }

  globalThis.BriixPlayer = Object.freeze({
    claim,
    fmtTime,
    get current() { return current; }
  });
})();
