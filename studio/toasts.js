/* BRIIX — тосты и подтверждения (R6, спринт 3): единый слой мгновенной
 * обратной связи (F-38) и собственный диалог подтверждения вместо нативных
 * confirm() (F-13) — с Escape и кликом по фону как отменой. Одинаковые
 * сообщения не стакаются: ключ дедупликации обновляет живой тост (F-42).
 * Модуль самодостаточен: студия может не подключать его — деградирует тихо.
 */
(() => {
  'use strict';
  const AUTO_MS = 4000;
  const ERROR_MS = 7000;
  const MAX_STACK = 3;
  let layer = null;
  const timers = new WeakMap();

  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div');
    layer.className = 'toast-layer';
    layer.setAttribute('role', 'region');
    layer.setAttribute('aria-label', 'Уведомления');
    document.body.append(layer);
    return layer;
  }

  function dismiss(el) {
    const timer = timers.get(el);
    if (timer) { clearTimeout(timer); timers.delete(el); }
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  }

  // toast(text, { kind: 'info'|'error'|'done', action: {label, onClick}, key })
  // key — дедупликация: тот же ключ убирает старый тост и ставит новый (F-42).
  function toast(text, { kind = 'info', action = null, key = '' } = {}) {
    const root = ensureLayer();
    const dedupe = key || text;
    const existing = [...root.querySelectorAll('.toast')].find(t => t.dataset.key === dedupe);
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.dataset.key = dedupe;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const body = document.createElement('span');
    body.className = 'toast-text';
    body.textContent = text;
    el.append(body);
    if (action && action.label) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toast-action';
      button.textContent = action.label;
      button.addEventListener('click', () => { dismiss(el); try { action.onClick && action.onClick(); } catch { /* действие не должно ронять слой */ } });
      el.append(button);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Закрыть уведомление');
    close.textContent = '✕';
    close.addEventListener('click', () => dismiss(el));
    el.append(close);
    root.append(el);
    while (root.children.length > MAX_STACK) dismiss(root.firstElementChild);
    timers.set(el, setTimeout(() => dismiss(el), kind === 'error' ? ERROR_MS : AUTO_MS));
    return el;
  }

  /* ---- Диалог подтверждения (F-13): вместо нативного confirm(). --------------
   * Возвращает Promise<boolean>: true — подтверждение, false — отмена
   * (Escape, клик по фону, кнопка «Отменить»). Второй вызов закрывает первый
   * как отменённый — двух диалогов не бывает. */
  let pendingConfirm = null;

  function confirmDialog({ title = 'Подтвердите действие', body = '', confirmLabel = 'Подтвердить', cancelLabel = 'Отменить', danger = false } = {}) {
    return new Promise(resolve => {
      if (pendingConfirm) { const prev = pendingConfirm; pendingConfirm = null; prev.overlay.remove(); prev.resolve(false); }
      const overlay = document.createElement('div');
      overlay.className = 'sessions-overlay confirm-overlay';
      const dialog = document.createElement('section');
      dialog.className = 'sessions-dialog confirm-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'confirm-title');
      dialog.tabIndex = -1;
      const head = document.createElement('div');
      head.className = 'sessions-head';
      const h = document.createElement('h2');
      h.id = 'confirm-title';
      h.textContent = title;
      head.append(h);
      const text = document.createElement('p');
      text.className = 'sessions-help confirm-body';
      text.textContent = body;
      const actions = document.createElement('div');
      actions.className = 'ops-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'action';
      cancel.textContent = cancelLabel;
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'session-new' + (danger ? ' danger' : '');
      confirm.textContent = confirmLabel;
      actions.append(confirm, cancel);
      dialog.append(head, text, actions);
      overlay.append(dialog);
      document.body.append(overlay);
      const finish = value => {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        pendingConfirm = null;
        resolve(value);
      };
      const onKey = e => {
        if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
        if (e.key === 'Tab') { // простой цикл: только две кнопки
          e.preventDefault();
          (document.activeElement === confirm ? cancel : confirm).focus();
        }
      };
      document.addEventListener('keydown', onKey);
      overlay.addEventListener('click', e => { if (e.target === overlay) finish(false); });
      cancel.addEventListener('click', () => finish(false));
      confirm.addEventListener('click', () => finish(true));
      pendingConfirm = { overlay, resolve };
      confirm.focus();
    });
  }

  globalThis.BRIIX_TOASTS = Object.freeze({ toast, confirmDialog });
})();
