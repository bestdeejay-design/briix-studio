/* Session storage: transactional IndexedDB with a sticky, lock-protected local fallback. */
(() => {
  'use strict';

  const DB_NAME = 'briix-studio-sessions';
  const DB_VERSION = 1;
  // #35 волна 1: схема v2 — session.assistantId, draft.{quality,instrumental,styleFamily},
  // единый history-поток (musicChat влит в конец). feed НЕ мигрирует никогда (SPEC #35 П2).
  const SCHEMA_VERSION = 2;
  // Известные роли диалога (список синхронизирован со studio.js ASSISTANTS).
  // Неизвестная/битая роль при санитизации откатывается к наставнику.
  const KNOWN_ASSISTANTS = new Set(['mentor', 'universal', 'editor', 'analyst', 'developer', 'marketer', 'mentor2',
    'producer', 'lyricist', 'songwriter']);
  const STORE = 'profiles';
  const feedKey = nick => 'briix-studio-feed-' + nick;
  const historyKey = nick => 'briix-studio-history-' + nick;

  class SessionStoreError extends Error {
    constructor(code, message, cause) {
      super(message);
      this.name = 'SessionStoreError';
      this.code = code;
      this.cause = cause;
    }
  }

  function parseLegacy(raw, key) {
    if (raw === null) return [];
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (error) { throw new SessionStoreError('legacy_invalid', 'Старые данные повреждены: ' + key, error); }
    if (!Array.isArray(parsed)) throw new SessionStoreError('legacy_invalid', 'Старые данные имеют неожиданный формат: ' + key);
    return parsed;
  }

  function legacyProfile(nick, storage, now = Date.now()) {
    let feedRaw, historyRaw;
    try {
      feedRaw = storage.getItem(feedKey(nick));
      historyRaw = storage.getItem(historyKey(nick));
    } catch (error) {
      throw new SessionStoreError('storage_unavailable', 'Не удалось прочитать старые данные.', error);
    }
    const feed = parseLegacy(feedRaw, feedKey(nick));
    const history = parseLegacy(historyRaw, historyKey(nick));
    const first = feed.find(item => item && item.t === 'user' && typeof item.text === 'string' && item.text.trim());
    const title = first ? first.text.trim().replace(/\s+/g, ' ').slice(0, 80) : 'Предыдущая сессия';
    const hasLegacy = feedRaw !== null || historyRaw !== null;
    return {
      schemaVersion: SCHEMA_VERSION,
      nick,
      revision: 0,
      activeSessionId: hasLegacy ? 'legacy' : null,
      sessions: hasLegacy ? [{ id: 'legacy', title, titleSet: Boolean(first), createdAt: now, updatedAt: now, feed, history }] : [],
      // Exact originals are committed in the same transaction as the import; legacy keys remain untouched.
      legacyBackup: { feedRaw, historyRaw, capturedAt: now }
    };
  }

  // T-32: одно соединение IDB на вкладку (WeakMap по инстансу indexedDB) —
  // раньше каждая запись открывала и закрывала базу. onversionchange закрывает
  // соединение и сбрасывает кэш; неудачное открытие не кэшируется.
  const dbCache = new WeakMap();
  function openDatabase(indexedDB) {
    if (!indexedDB) return Promise.reject(new SessionStoreError('idb_unavailable', 'IndexedDB недоступна.'));
    const cached = dbCache.get(indexedDB);
    if (cached) return cached;
    const promise = new Promise((resolve, reject) => {
      let request;
      try { request = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (error) { reject(new SessionStoreError('idb_unavailable', 'Не удалось открыть IndexedDB.', error)); return; }
      let settled = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'nick' });
      };
      request.onerror = () => { if (!settled) { settled = true; reject(new SessionStoreError('idb_unavailable', 'Не удалось открыть IndexedDB.', request.error)); } };
      request.onblocked = () => { if (!settled) { settled = true; reject(new SessionStoreError('idb_blocked', 'Другая вкладка блокирует открытие хранилища.')); } };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true;
        const db = request.result;
        db.onversionchange = () => { db.close(); dbCache.delete(indexedDB); };
        resolve(db);
      };
    });
    promise.catch(() => dbCache.delete(indexedDB)); // отказ не должен залипнуть в кэше
    dbCache.set(indexedDB, promise);
    return promise;
  }

  function transact(db, operation) {
    return new Promise((resolve, reject) => {
      let transaction, result, reason;
      try {
        transaction = db.transaction(STORE, 'readwrite');
        operation(transaction.objectStore(STORE), value => { result = value; }, error => { reason = error; transaction.abort(); });
      } catch (error) {
        if (transaction) { try { transaction.abort(); } catch (_) {} }
        reject(error instanceof SessionStoreError ? error : new SessionStoreError('storage_write', 'Не удалось сохранить данные.', error));
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(reason || new SessionStoreError('storage_write', 'Не удалось сохранить данные.', transaction.error));
      transaction.onerror = () => { /* onabort carries the final failure */ };
    });
  }

  // Хотфикс #23: запись сессии из чужой/старой версии или повреждённого хранилища
  // может оказаться null или без обязательных полей — раньше это роняло студию
  // на «Cannot read properties of null (reading 'title')». Валидные записи не
  // трогаем (тот же объект), null/не-объекты выбрасываем, битые чиним до
  // валидной пустой сессии (id и title сохраняем, если они осмысленны).
  function newEmptySession(id, now) {
    return { id, title: 'Новый чат', titleSet: false, createdAt: now, updatedAt: now, feed: [], history: [] };
  }
  // Возврат: валидная запись возвращается КАК ЕСТЬ (тот же объект) — по ней
  // sanitizeProfile понимает, что профиль не менялся и его не нужно переписывать
  // в хранилище (хвост #23: раньше копия создавалась всегда и open() перезаписывал
  // профиль при каждом открытии без изменений). Битая — починенной копией.
  // #35 W1-1: миграция v1 → v2 в точке загрузки (PROTOCOL §7, tolerant intake).
  // Меняет ТОЛЬКО LLM-контекст и мета-поля сессии; feed (лента) не трогается вообще —
  // она остаётся источником экрана и после миграции побайтово та же (SPEC #35 П2).
  // styleFamily осознанно не восстанавливается: в v1 он жил на DOM-элементе, не в данных.
  function migrateSessionV1toV2(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const session = { ...raw };
    const mc = session.musicChat && typeof session.musicChat === 'object' && !Array.isArray(session.musicChat) ? session.musicChat : null;
    const mcHistory = mc && Array.isArray(mc.history)
      ? mc.history.filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
      : [];
    if (mcHistory.length) {
      // Merge «в конец»: у v1-элементов нет временных меток, честный порядок —
      // дозапись муз-диалога после общего потока. Служебный маркер-граница
      // участвует в контексте (system-роль), но никогда не рендерится.
      session.history = (Array.isArray(session.history) ? session.history : []).concat(
        [{ role: 'system', content: 'Муз-диалог перенесён из предыдущей версии' }],
        mcHistory.map(m => ({ role: m.role, content: m.content, via: 'music-chat', assistant: mc.assistant || 'producer' }))
      );
    }
    session.assistantId = typeof session.assistantId === 'string' && KNOWN_ASSISTANTS.has(session.assistantId)
      ? session.assistantId
      : (mc && typeof mc.assistant === 'string' && KNOWN_ASSISTANTS.has(mc.assistant) ? mc.assistant : 'mentor');
    const draft = session.draft && typeof session.draft === 'object' && !Array.isArray(session.draft) ? { ...session.draft } : {};
    if (draft.quality !== 'pro') draft.quality = 'flash';
    if (typeof draft.instrumental !== 'boolean') {
      // Восстановление из первого трека сессии; старый глобальный тумблер сюда не попадает.
      const firstTrack = (Array.isArray(session.feed) ? session.feed : []).find(x => x && x.t === 'media' && x.kind === 'music');
      draft.instrumental = Boolean(firstTrack && firstTrack.input && firstTrack.input.instrumental);
    }
    session.draft = draft;
    delete session.musicChat;
    return session;
  }
  function migrateV1toV2(profile, now = Date.now()) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
    const sessions = (Array.isArray(profile.sessions) ? profile.sessions : [])
      .map(migrateSessionV1toV2)
      .filter(Boolean);
    return {
      ...profile,
      schemaVersion: SCHEMA_VERSION,
      sessions,
      revision: (Number.isSafeInteger(profile.revision) && profile.revision >= 0 ? profile.revision : 0) + 1
    };
  }

  function sanitizeSession(raw, now) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    let changed = false;
    const fixed = { ...raw };
    if (typeof fixed.id !== 'string' || !fixed.id) {
      fixed.id = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : 's-' + now + '-' + Math.random().toString(36).slice(2);
      changed = true;
    }
    if (typeof fixed.title !== 'string' || !fixed.title) { fixed.title = 'Новый чат'; fixed.titleSet = false; changed = true; }
    if (!Array.isArray(fixed.feed)) { fixed.feed = []; changed = true; }
    if (!Array.isArray(fixed.history)) { fixed.history = []; changed = true; }
    // Находка ревью PR #25: null-ЭЛЕМЕНТЫ внутри feed/history тоже роняли бут
    // (ensureRoot читает item.t у null). Чистим мусор, валидные элементы не трогаем.
    const cleanFeed = fixed.feed.filter(item => item && typeof item === 'object');
    if (cleanFeed.length !== fixed.feed.length) { fixed.feed = cleanFeed; changed = true; }
    const cleanHistory = fixed.history.filter(item => item && typeof item === 'object');
    if (cleanHistory.length !== fixed.history.length) { fixed.history = cleanHistory; changed = true; }
    // Репродукция на проде (#23): черновики без контейнера полей —
    // renderMusicDraftContent читает entry.draft[name], renderProducerDraft —
    // entry.snapshot.idea и соседи. Битый контейнер чиним до {}, валидный не трогаем.
    const fixContainer = (item, field) => {
      if (typeof item[field] !== 'object' || item[field] === null || Array.isArray(item[field])) { item[field] = {}; changed = true; }
    };
    for (const item of fixed.feed) {
      if (item.t === 'music_draft') fixContainer(item, 'draft');
      if (item.t === 'producer_draft') fixContainer(item, 'snapshot');
      // P3-1 аудита #35: sanitize backups теперь и для music_draft (рендер
      // делает (entry.backups ||= []).push — битый не-массив ронял «Принять в поля»).
      if (item.t === 'music_draft' || item.t === 'producer_draft') {
        if (item.backups !== undefined) {
          if (!Array.isArray(item.backups)) { item.backups = []; changed = true; }
          else {
            const cleanBackups = item.backups.filter(b => b && typeof b === 'object');
            if (cleanBackups.length !== item.backups.length) { item.backups = cleanBackups; changed = true; }
          }
        }
      }
    }
    // v2-поля сессии (SPEC #35 §2): неизвестная роль → mentor; draft-контейнер,
    // styleFamily/quality/instrumental чинятся до валидных значений.
    if (fixed.assistantId !== undefined && (typeof fixed.assistantId !== 'string' || !KNOWN_ASSISTANTS.has(fixed.assistantId))) {
      fixed.assistantId = 'mentor';
      changed = true;
    }
    if (fixed.draft === undefined || fixed.draft === null || typeof fixed.draft !== 'object' || Array.isArray(fixed.draft)) {
      if (fixed.draft !== undefined) { fixed.draft = {}; changed = true; }
    } else {
      const draftChanged = (() => {
        let d = false;
        if (fixed.draft.styleFamily !== undefined && typeof fixed.draft.styleFamily !== 'string') { const { styleFamily, ...rest } = fixed.draft; fixed.draft = rest; d = true; }
        if (fixed.draft.quality !== undefined && fixed.draft.quality !== 'flash' && fixed.draft.quality !== 'pro') { fixed.draft.quality = 'flash'; d = true; }
        if (fixed.draft.instrumental !== undefined && typeof fixed.draft.instrumental !== 'boolean') { fixed.draft.instrumental = Boolean(fixed.draft.instrumental); d = true; }
        return d;
      })();
      if (draftChanged) changed = true;
    }
    if (!Number.isFinite(fixed.createdAt)) { fixed.createdAt = now; changed = true; }
    if (!Number.isFinite(fixed.updatedAt)) { fixed.updatedAt = fixed.createdAt; changed = true; }
    return changed ? fixed : raw;
  }
  function sanitizeProfile(profile) {
    if (!profile || typeof profile !== 'object') return null;
    const now = Date.now();
    const rawSessions = Array.isArray(profile.sessions) ? profile.sessions : [];
    const sessions = [];
    let changed = !Array.isArray(profile.sessions);
    for (const raw of rawSessions) {
      const fixed = sanitizeSession(raw, now);
      if (!fixed) { changed = true; continue; } // null/мусор — выбросить
      if (fixed !== raw) changed = true;
      sessions.push(fixed);
    }
    // Ничего не изменилось — возвращаем профиль как есть: open() не переписывает
    // валидную запись в хранилище при каждом открытии. Битые записи по-прежнему
    // перезаписываются (хотфикс #23).
    if (!changed) return { profile, changed: false };
    return { profile: { ...profile, sessions }, changed: true };
  }

  async function openProfile(nick, options = {}) {
    if (typeof nick !== 'string' || !nick) throw new SessionStoreError('invalid_nick', 'Нужен ник профиля.');
    const db = await openDatabase(options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB);
    const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
    // T-32: соединение живёт на вкладке (dbCache) — закрывать на каждую операцию не нужно.
    // A single write transaction serializes concurrent first opens and commits backup + import together.
    return await transact(db, (store, done, fail) => {
      const get = store.get(nick);
      get.onsuccess = () => {
        if (get.result !== undefined) {
          if (get.result.schemaVersion !== SCHEMA_VERSION) {
            // #35 W1-1: v1-профиль мигрирует в точке загрузки, а не отбивается.
            // Идемпотентно: v2 проходит как есть, миграция под тем же замком транзакции
            // (гонка двойной миграции двух вкладок исключена порядком get→put в IDB).
            if (get.result.schemaVersion !== 1) {
              fail(new SessionStoreError('schema_unsupported', 'Версия данных сессий не поддерживается.'));
              return;
            }
            const migrated = migrateV1toV2(get.result);
            const sanitized = sanitizeProfile(migrated);
            if (!sanitized) { fail(new SessionStoreError('schema_unsupported', 'Неизвестный формат данных сессий.')); return; }
            store.put(sanitized.profile);
            done(sanitized.profile);
            return;
          }
          // Хотфикс #23: санированный профиль сразу записываем обратно,
          // чтобы битые записи не жили вечно.
          const sanitized = sanitizeProfile(get.result);
          if (!sanitized) { fail(new SessionStoreError('schema_unsupported', 'Неизвестный формат данных сессий.')); return; }
          if (sanitized.changed) store.put(sanitized.profile);
          done(sanitized.profile);
          return;
        }
        try {
          const profile = legacyProfile(nick, storage);
          store.add(profile);
          done(profile);
        } catch (error) {
          fail(error instanceof SessionStoreError ? error : new SessionStoreError('storage_write', 'Не удалось сохранить данные.', error));
        }
      };
    });
  }

  async function saveProfile(profile, expectedRevision, options = {}) {
    if (!profile || typeof profile.nick !== 'string' || !profile.nick || profile.schemaVersion !== SCHEMA_VERSION ||
        !Array.isArray(profile.sessions) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new SessionStoreError('invalid_profile', 'Некорректные данные сессий.');
    }
    const db = await openDatabase(options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB);
    // T-32: постоянное соединение — без open/close на каждую запись.
    return await transact(db, (store, done, fail) => {
      const get = store.get(profile.nick);
      get.onsuccess = () => {
        try {
          const current = get.result;
          if (!current || current.revision !== expectedRevision) {
            fail(new SessionStoreError('conflict', 'Данные сессии изменились в другой вкладке. Перезагрузите их перед сохранением.'));
            return;
          }
          if (current.schemaVersion !== SCHEMA_VERSION) {
            fail(new SessionStoreError('schema_unsupported', 'Версия данных сессий не поддерживается.'));
            return;
          }
          // A normal save cannot destroy the recovery copy, even if the caller supplies an outdated object.
          const next = { ...profile, legacyBackup: current.legacyBackup, revision: expectedRevision + 1 };
          store.put(next);
          done(next);
        } catch (error) { fail(new SessionStoreError('storage_write', 'Не удалось сохранить данные.', error)); }
      };
    });
  }

  const modeKey = nick => 'briix-studio-sessions-backend-' + nick;
  const fallbackKey = nick => 'briix-studio-sessions-v1-' + nick;

  function withProfileLock(nick, operation, options, allowIdbWithoutLock = false) {
    const locks = options.locks === undefined ? globalThis.navigator?.locks : options.locks;
    if (!locks) {
      if (allowIdbWithoutLock) return operation();
      throw new SessionStoreError('lock_unavailable', 'Без блокировки вкладок нельзя безопасно открыть локальное хранилище.');
    }
    return locks.request('briix-studio-sessions:' + nick, operation);
  }

  function localRead(storage, key) {
    try { return storage.getItem(key); }
    catch (error) { throw new SessionStoreError('storage_unavailable', 'Не удалось прочитать локальное хранилище.', error); }
  }
  function localWrite(storage, key, value) {
    try { storage.setItem(key, value); }
    catch (error) { throw new SessionStoreError('storage_write', 'Не удалось сохранить локальные данные.', error); }
  }

  // The backend choice is sticky: returning to IDB automatically after fallback would fork history.
  async function open(nick, options = {}) {
    if (typeof nick !== 'string' || !nick) throw new SessionStoreError('invalid_nick', 'Нужен ник профиля.');
    const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
    return withProfileLock(nick, async () => {
      let mode = localRead(storage, modeKey(nick));
      if (mode !== null && mode !== 'idb' && mode !== 'local') throw new SessionStoreError('schema_unsupported', 'Неизвестный тип хранилища сессий.');
      const locks = options.locks === undefined ? globalThis.navigator?.locks : options.locks;
      if (mode === 'local' && !locks) throw new SessionStoreError('lock_unavailable', 'Локальные сессии доступны только с блокировкой вкладок.');
      if (!mode) {
        try {
          // T-32: проба открытия переиспользует постоянное соединение (или создаёт его).
          await openDatabase(options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB);
          mode = 'idb';
        } catch (error) {
          if (error.code !== 'idb_unavailable') throw error;
          if (!locks) throw new SessionStoreError('lock_unavailable', 'IndexedDB и блокировка вкладок недоступны; безопасное сохранение невозможно.', error);
          mode = 'local';
        }
        // Set before any profile write: an interruption cannot silently create two histories.
        localWrite(storage, modeKey(nick), mode);
      }
      if (mode === 'idb') return { backend: mode, profile: await openProfile(nick, { ...options, storage }) };
      const raw = localRead(storage, fallbackKey(nick));
      if (raw !== null) {
        let profile;
        try { profile = JSON.parse(raw); } catch (error) { throw new SessionStoreError('legacy_invalid', 'Локальные сессии повреждены.', error); }
        if (!profile || profile.nick !== nick || !Array.isArray(profile.sessions)) {
          throw new SessionStoreError('schema_unsupported', 'Неизвестный формат локальных сессий.');
        }
        if (profile.schemaVersion !== SCHEMA_VERSION) {
          if (profile.schemaVersion !== 1) throw new SessionStoreError('schema_unsupported', 'Неизвестный формат локальных сессий.');
          // Локальный fallback мигрирует той же функцией (SPEC #35 §2) и сразу
          // записывается обратно — как IDB-путь в openProfile.
          profile = sanitizeProfile(migrateV1toV2(profile)).profile;
          localWrite(storage, fallbackKey(nick), JSON.stringify(profile));
        }
        // Хотфикс #23: локальный бэкенд санируем так же, как IDB.
        const sanitized = sanitizeProfile(profile);
        if (!sanitized) throw new SessionStoreError('schema_unsupported', 'Неизвестный формат локальных сессий.');
        if (sanitized.changed) localWrite(storage, fallbackKey(nick), JSON.stringify(sanitized.profile));
        return { backend: mode, profile: sanitized.profile };
      }
      const profile = legacyProfile(nick, storage);
      localWrite(storage, fallbackKey(nick), JSON.stringify(profile));
      return { backend: mode, profile };
    }, options, true);
  }

  async function save(profile, expectedRevision, backend, options = {}) {
    if (backend === 'idb') return saveProfile(profile, expectedRevision, options);
    if (backend !== 'local' || !profile || !profile.nick || profile.schemaVersion !== SCHEMA_VERSION || !Array.isArray(profile.sessions)) {
      throw new SessionStoreError('invalid_profile', 'Некорректные данные сессий.');
    }
    const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
    return withProfileLock(profile.nick, () => {
      const raw = localRead(storage, fallbackKey(profile.nick));
      let current;
      try { current = JSON.parse(raw); } catch (error) { throw new SessionStoreError('legacy_invalid', 'Локальные сессии повреждены.', error); }
      if (!current || current.schemaVersion !== SCHEMA_VERSION || current.nick !== profile.nick || current.revision !== expectedRevision) {
        throw new SessionStoreError('conflict', 'Данные сессии изменились в другой вкладке.');
      }
      const next = { ...profile, revision: expectedRevision + 1, legacyBackup: current.legacyBackup };
      localWrite(storage, fallbackKey(profile.nick), JSON.stringify(next));
      return next;
    }, options);
  }

  // T-43: полное стирание сессий с устройства: закрыть общее соединение
  // (иначе deleteDatabase заблокирован) и удалить базу. Локальные ключи —
  // на вызывающем (студия знает весь свой префикс).
  async function wipe(options = {}) {
    const idb = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
    const cached = dbCache.get(idb);
    if (cached) {
      try { (await cached).close(); } catch { /* уже закрыто */ }
      dbCache.delete(idb);
    }
    if (!idb) return false;
    await new Promise(resolve => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      try {
        const request = idb.deleteDatabase(DB_NAME);
        request.onsuccess = request.onerror = request.onblocked = done;
        setTimeout(done, 2000); // блокировка чужой вкладкой не должна вешать выход
      } catch { done(); }
    });
    return true;
  }

  globalThis.BriixSessionStore = Object.freeze({ open, save, openProfile, saveProfile, wipe, migrateV1toV2, SessionStoreError });
})();
