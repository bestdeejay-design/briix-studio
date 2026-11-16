/* Isolated browser checks for the not-yet-integrated storage foundation.
 * Run with the same Playwright dependencies as tools/check-studio.cjs.
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./browser-env.cjs');

(async () => {
  const script = fs.readFileSync(path.join(__dirname, '../studio/session-store.js'));
  const server = http.createServer((req, res) => {
    if (req.url === '/session-store.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(script); }
    else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><script src="/session-store.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const otherTab = await context.newPage();
    const url = 'http://127.0.0.1:' + server.address().port;
    await Promise.all([page.goto(url), otherTab.goto(url)]);
    const feed = Array.from({ length: 105 }, (_, i) => ({ t: 'user', who: 'Вы', text: 'Запрос ' + i }));
    feed.push({ t: 'media', who: 'Музыка', kind: 'music', job: 'job-a', file: '/files/job-a' });
    const history = [{ role: 'user', content: 'Привет' }, { role: 'assistant', content: 'Ответ' }];
    const feedRaw = JSON.stringify(feed), historyRaw = JSON.stringify(history);
    await page.evaluate(({ feedRaw, historyRaw }) => {
      localStorage.setItem('briix-studio-feed-Аня', feedRaw);
      localStorage.setItem('briix-studio-history-Аня', historyRaw);
    }, { feedRaw, historyRaw });
    const [first, second] = await Promise.all([
      page.evaluate(() => BriixSessionStore.openProfile('Аня')),
      otherTab.evaluate(() => BriixSessionStore.openProfile('Аня'))
    ]);
    assert.deepEqual(first, second, 'concurrent migration is idempotent');
    assert.deepEqual(first.sessions[0].feed, feed, 'feed is not truncated at 80 entries');
    assert.deepEqual(first.sessions[0].history, history);
    assert.equal(first.sessions[0].title, 'Запрос 0');
    assert.equal(first.legacyBackup.feedRaw, feedRaw);
    assert.equal(first.legacyBackup.historyRaw, historyRaw);
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem('briix-studio-feed-Аня'), localStorage.getItem('briix-studio-history-Аня')]), [feedRaw, historyRaw]);

    const saveInTab = (tab, title) => tab.evaluate(async ({ profile, title }) => {
      profile.sessions.push({ id: title, title, createdAt: 2, updatedAt: 2, feed: [], history: [] });
      profile.legacyBackup = null;
      try { return { profile: await BriixSessionStore.saveProfile(profile, 0) }; }
      catch (error) { return { code: error.code }; }
    }, { profile: first, title });
    const writes = await Promise.all([saveInTab(page, 'вторая'), saveInTab(otherTab, 'третья')]);
    assert.equal(writes.filter(x => x.profile).length, 1, 'exactly one writer wins');
    assert.equal(writes.filter(x => x.code === 'conflict').length, 1, 'stale writer is rejected');
    const saved = writes.find(x => x.profile).profile;
    assert.equal(saved.revision, 1);
    assert.equal(saved.legacyBackup.feedRaw, feedRaw, 'normal save cannot erase backup');
    await page.evaluate(() => localStorage.setItem('briix-studio-feed-Аня', '{broken'));
    assert.deepEqual(await page.evaluate(() => BriixSessionStore.openProfile('Аня')), saved, 'committed import is authoritative');
    const other = await page.evaluate(() => BriixSessionStore.openProfile('Борис'));
    assert.deepEqual(other.sessions, [], 'profiles are separate');

    const failures = await page.evaluate(async ({ feedRaw }) => {
      localStorage.setItem('briix-studio-feed-повреждено', '{bad');
      const result = {};
      try { await BriixSessionStore.openProfile('повреждено'); } catch (e) { result.corrupt = e.code; }
      result.original = localStorage.getItem('briix-studio-feed-повреждено');
      localStorage.setItem('briix-studio-feed-повреждено', feedRaw);
      result.afterRetry = (await BriixSessionStore.openProfile('повреждено')).sessions[0].feed.length;
      try { await BriixSessionStore.openProfile('нет-idb', { indexedDB: null }); } catch (e) { result.noIdb = e.code; }
      try { await BriixSessionStore.openProfile('нет-доступа', { storage: { getItem() { throw new Error('denied'); } } }); } catch (e) { result.denied = e.code; }
      try { await BriixSessionStore.saveProfile({ nick: 'x' }, 0); } catch (e) { result.invalid = e.code; }
      localStorage.setItem('briix-studio-feed-quota', feedRaw);
      const originalAdd = IDBObjectStore.prototype.add;
      try {
        IDBObjectStore.prototype.add = function () { throw new DOMException('full', 'QuotaExceededError'); };
        try { await BriixSessionStore.openProfile('quota'); } catch (e) { result.quota = e.cause?.name; }
      } finally { IDBObjectStore.prototype.add = originalAdd; }
      result.quotaOriginal = localStorage.getItem('briix-studio-feed-quota') === feedRaw;
      result.quotaRetry = (await BriixSessionStore.openProfile('quota')).sessions[0].feed.length;
      return result;
    }, { feedRaw });
    assert.deepEqual(failures, { corrupt: 'legacy_invalid', original: '{bad', afterRetry: 106, noIdb: 'idb_unavailable', denied: 'storage_unavailable', invalid: 'invalid_profile', quota: 'QuotaExceededError', quotaOriginal: true, quotaRetry: 106 });
    const fallback = await page.evaluate(async () => {
      const opts = { indexedDB: null };
      localStorage.setItem('briix-studio-feed-fallback', JSON.stringify([{ t: 'user', text: 'Старый текст' }]));
      const first = await BriixSessionStore.open('fallback', opts);
      first.profile.sessions[0].feed.push({ t: 'user', text: 'Новый текст' });
      const saved = await BriixSessionStore.save(first.profile, first.profile.revision, first.backend, opts);
      const reopened = await BriixSessionStore.open('fallback');
      let conflict;
      try { await BriixSessionStore.save(first.profile, 0, 'local', opts); } catch (e) { conflict = e.code; }
      return { backend: first.backend, reopenBackend: reopened.backend, saved, reopened: reopened.profile, conflict,
        legacy: localStorage.getItem('briix-studio-feed-fallback') };
    });
    assert.equal(fallback.backend, 'local');
    assert.equal(fallback.reopenBackend, 'local', 'fallback is sticky even when IDB returns');
    assert.deepEqual(fallback.reopened, fallback.saved);
    assert.equal(fallback.conflict, 'conflict');
    assert.equal(fallback.legacy, JSON.stringify([{ t: 'user', text: 'Старый текст' }]));
    const measured = await page.evaluate(async () => {
      const before = await navigator.storage.estimate();
      const { profile, backend } = await BriixSessionStore.open('измерение');
      profile.sessions.push({ id: 'measure', title: '100 событий', createdAt: Date.now(), updatedAt: Date.now(), history: [],
        feed: Array.from({ length: 100 }, (_, i) => ({ t: 'user', who: 'Вы', text: 'Тестовое сообщение ' + i + ' ' + 'пример '.repeat(30) })) });
      await BriixSessionStore.save(profile, profile.revision, backend);
      const after = await navigator.storage.estimate();
      return { jsonBytes: new TextEncoder().encode(JSON.stringify(profile)).length, beforeUsage: before.usage, afterUsage: after.usage };
    });
    assert.ok(measured.jsonBytes > 0);
    console.log('Storage estimate for 100 synthetic events (whole origin, approximate):', JSON.stringify(measured));

    // Хотфикс #23: профиль с [null, битая-без-feed, валидная] санируется при openProfile,
    // валидная запись остаётся нетронутой, санированный профиль записывается обратно.
    const sanitizeIdb = await page.evaluate(async () => {
      const valid = { id: 'valid-1', title: 'Живой чат', titleSet: true, createdAt: 1, updatedAt: 2,
        feed: [{ t: 'user', who: 'Вы', text: 'привет' }], history: [{ role: 'user', content: 'привет' }] };
      const broken = { id: 'broken-1', title: 'Битая' }; // есть id и title, нет feed/history
      const noTitle = { title: null }; // нет ни id, ни валидного title
      const raw = { schemaVersion: 1, nick: 'санирование', revision: 3, activeSessionId: 'broken-1', sessions: [null, noTitle, broken, valid], legacyBackup: null };
      const rawWrite = () => new Promise((resolve, reject) => {
        const req = indexedDB.open('briix-studio-sessions', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('profiles', 'readwrite');
          tx.objectStore('profiles').put(raw);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });
      const storedRead = () => new Promise((resolve, reject) => {
        const req = indexedDB.open('briix-studio-sessions', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('profiles', 'readonly');
          const get = tx.objectStore('profiles').get('санирование');
          tx.oncomplete = () => { db.close(); resolve(get.result); };
          tx.onerror = () => reject(tx.error);
        };
      });
      await rawWrite();
      const opened = await BriixSessionStore.openProfile('санирование');
      return { opened, stored: await storedRead(), valid };
    });
    assert.equal(sanitizeIdb.opened.sessions.length, 3, 'null-запись выброшена, остальные три починены/сохранены');
    const [repairedNoTitle, repaired, validKept] = sanitizeIdb.opened.sessions;
    assert.equal(repairedNoTitle.id.length > 0, true, 'записи без id сгенерирован новый id');
    assert.equal(repairedNoTitle.title, 'Новый чат', 'записи без title проставлен дефолтный title');
    assert.deepEqual(repairedNoTitle.feed, [], 'починенной записи проставлен пустой feed');
    assert.deepEqual(repairedNoTitle.history, [], 'починенной записи проставлен пустой history');
    assert.equal(repaired.id, 'broken-1', 'битой записи сохранён её id');
    assert.equal(repaired.title, 'Битая', 'валидный title битой записи сохранён, не затёрт дефолтом');
    assert.deepEqual(repaired.feed, [], 'битой записи проставлен пустой feed');
    assert.deepEqual(repaired.history, [], 'битой записи проставлен пустой history');
    assert.deepEqual(validKept, sanitizeIdb.valid, 'валидная запись не тронута');
    assert.equal(sanitizeIdb.stored.sessions.length, 3, 'санированный профиль записан обратно в IDB');
    assert.equal(sanitizeIdb.stored.revision, 3, 'revision при санитизации не меняется');
    assert.equal(sanitizeIdb.stored.sessions[2].title, 'Живой чат', 'валидная запись цела и в хранилище');

    // Тот же сценарий на локальном бэкенде (fallback-путь open()).
    const sanitizeLocal = await page.evaluate(async () => {
      localStorage.setItem('briix-studio-sessions-backend-локал-сан', 'local');
      localStorage.setItem('briix-studio-sessions-v1-локал-сан', JSON.stringify({
        schemaVersion: 1, nick: 'локал-сан', revision: 0, activeSessionId: 'b',
        sessions: [null, { id: 'b', title: 'битая' }], legacyBackup: null
      }));
      const opened = await BriixSessionStore.open('локал-сан');
      return { profile: opened.profile, stored: JSON.parse(localStorage.getItem('briix-studio-sessions-v1-локал-сан')) };
    });
    assert.equal(sanitizeLocal.profile.sessions.length, 1, 'local: null-запись выброшена');
    assert.deepEqual(sanitizeLocal.profile.sessions[0].feed, [], 'local: битая запись починена');
    assert.equal(sanitizeLocal.stored.sessions.length, 1, 'local: санированный профиль записан обратно');
    await context.close();
    console.log('PASS session storage: migration, backup, fallback, isolation, conflicts and failures');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
