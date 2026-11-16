/* BRIIX — OperationRegistry (T-17 шаг 2, T-24): реестр активных операций.
 * Каждая генерация/стрим регистрируется с	handle'ом отмены (makeCancelHandle):
 * stop() гасит и локальный AbortController, и джобу на сервере (T-05).
 * Реестр закрывает: «стоп всё» при выходе, индикатор занятости в шапке,
 * и truthful-ответ на вопрос «мы что-то делаем прямо сейчас?».
 * Модуль пассивен: ничего не запускает сам, только собирает и останавливает.
 */
(() => {
  'use strict';
  let seq = 0;
  const ops = new Map();          // id → { id, kind, sessionId, title, stop }
  const listeners = new Set();

  function summary() {
    const list = [...ops.values()];
    return {
      count: list.length,
      byKind: list.reduce((acc, op) => { acc[op.kind] = (acc[op.kind] || 0) + 1; return acc; }, {}),
      sessionIds: [...new Set(list.map(op => op.sessionId).filter(Boolean))],
      ops: list.map(op => ({ id: op.id, kind: op.kind, sessionId: op.sessionId, title: op.title || '' }))
    };
  }
  function notify() { for (const cb of listeners) { try { cb(summary()); } catch { /* подписчик не должен ронять реестр */ } } }

  // register возвращает функцию снятия с реестра — вызывается в finally операции.
  function register({ kind = 'op', sessionId = '', title = '', stop }) {
    const id = 'op-' + String(++seq).padStart(3, '0');
    ops.set(id, { id, kind, sessionId, title, stop: typeof stop === 'function' ? stop : () => {} });
    notify();
    return () => unregister(id);
  }

  function unregister(id) { if (ops.delete(id)) notify(); }

  // stopAll: снять всё с реестра ДО запуска stop'ов — повторный вызов не двойной.
  // Возвращает количество остановленных операций.
  function stopAll() {
    const list = [...ops.values()];
    ops.clear();
    notify();
    for (const op of list) { try { op.stop(); } catch { /* stop не должен бросать */ } }
    return list.length;
  }

  function subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); }

  window.BRIIX_OPS = Object.freeze({ register, unregister, stopAll, subscribe, running: summary });
})();
