/* BRIIX — каталог моделей (GET /v1/models, контракт модель-шины PR #24).
 * Единственный источник честных ориентиров ожидания (F-59): клиент берёт
 * только измеренные латентности (latency.source === "measured") и ничего
 * не выдумывает. Маршрут не требует авторизации, грузится один раз за
 * сессию (TTL 10 минут — статус моделей может измениться); сбой каталога
 * не мешает работе — ожидание просто остаётся без ориентира.
 */
(() => {
  'use strict';
  const TTL_MS = 10 * 60 * 1000;
  let cache = null;      // { byId: Map<string, model>, at: number }
  let inflight = null;

  function normalize(m) {
    const latency = m && typeof m.latency === 'object' && m.latency ? m.latency : {};
    const seconds = typeof latency.seconds === 'number' && latency.seconds > 0 ? latency.seconds : null;
    return {
      id: typeof m.id === 'string' ? m.id : '',
      status: m.status === 'unavailable' ? 'unavailable' : 'ready',
      ready: m.status !== 'unavailable',
      latencySeconds: seconds,
      // Ориентир можно показывать только при source:"measured" —
      // оценка/None честно считается «неизвестно».
      measured: seconds !== null && latency.source === 'measured',
      conditions: typeof latency.conditions === 'string' ? latency.conditions : ''
    };
  }

  async function load(base, { force = false } = {}) {
    if (!base) throw new Error('catalog: адрес сервера не задан');
    if (!force && cache && Date.now() - cache.at < TTL_MS) return true;
    if (inflight) return inflight;
    inflight = (async () => {
      const response = await fetch(String(base).replace(/\/+$/, '') + '/v1/models');
      if (!response.ok) throw new Error('catalog: HTTP ' + response.status);
      const payload = await response.json();
      const list = Array.isArray(payload && payload.data) ? payload.data : [];
      const byId = new Map();
      for (const m of list) if (m && typeof m.id === 'string') byId.set(m.id, normalize(m));
      cache = { byId, at: Date.now() };
      return true;
    })();
    try { return await inflight; } finally { inflight = null; }
  }

  function model(id) { return cache ? (cache.byId.get(id) || null) : null; }

  // Честный ориентир: только измеренные секунды.
  function etaSeconds(id) {
    const m = model(id);
    return m && m.measured ? m.latencySeconds : null;
  }

  window.BRIIX_CATALOG = {
    load, model, etaSeconds,
    loadedAt: () => (cache ? cache.at : 0),
    size: () => (cache ? cache.byId.size : 0)
  };
})();
