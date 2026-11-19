/* #35 волна 1: миграция schema v1 → v2 в точке загрузки (SPEC #35 §2, П1, П2).
 * Фикстуры: пустой профиль, с муз-историей, с producer_draft, битый backups,
 * legacy-fallback; идемпотентность; гейт ≥3; «v1-клиент пишет в v2-хранилище»;
 * feed побайтово не трогается; двойное открытие двух вкладок под миграцией.
 * Запуск: NODE_PATH=/opt/homebrew/lib/node_modules node tools/check-session-migration.cjs
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
    await page.evaluate(() => localStorage.clear());

    // --- Фикстуры v1 -----------------------------------------------------------
    const v1Fixtures = await page.evaluate(async () => {
      const put = raw => new Promise((resolve, reject) => {
        const req = indexedDB.open('briix-studio-sessions', 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('profiles')) req.result.createObjectStore('profiles', { keyPath: 'nick' }); };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('profiles', 'readwrite');
          tx.objectStore('profiles').put(raw);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });
      const feed = [
        { t: 'user', who: 'Вы', text: 'привет' },
        { t: 'music_draft', who: 'Наставник', text: '', draft: { title: 'Черновик', prompt: 'dream pop' }, assistant: 'Наставник', instrumental: false, applied: true, createdAt: 1, backups: [null, 'мусор', { style: 'живой', lyrics: 'л' }] },
        { t: 'producer_draft', who: 'Продюсер', snapshot: { idea: 'идея' }, backups: 'не-массив' },
        { t: 'media', who: 'Трек', kind: 'music', job: 'j1', file: '/files/j1.m4a', cover: '', input: { instrumental: true, prompt: 'p' } }
      ];
      const empty = { schemaVersion: 1, nick: 'пустой', revision: 0, activeSessionId: null, sessions: [], legacyBackup: null };
      const withMusic = {
        schemaVersion: 1, nick: 'с-муз-историей', revision: 5, activeSessionId: 's1',
        sessions: [{ id: 's1', title: 'Сессия', titleSet: true, createdAt: 1, updatedAt: 2, feed,
          history: [{ role: 'user', content: 'привет' }],
          musicChat: { assistant: 'producer', history: [{ role: 'user', content: 'муз-вопрос' }, { role: 'assistant', content: 'муз-ответ' }] } }],
        legacyBackup: null
      };
      await put(empty);
      await put(withMusic);
      return { feed: JSON.parse(JSON.stringify(feed)) };
    });

    // --- Пустой профиль: миграция без потерь, revision+1 -----------------------
    const empty = await page.evaluate(() => BriixSessionStore.openProfile('пустой'));
    assert.equal(empty.schemaVersion, 2, 'пустой v1 → v2');
    assert.equal(empty.revision, 1, 'revision повышен на 1');
    assert.deepEqual(empty.sessions, []);

    // --- Муз-история: merge в конец, маркер, assistantId, draft ----------------
    const withMusic = await page.evaluate(() => BriixSessionStore.openProfile('с-муз-историей'));
    assert.equal(withMusic.schemaVersion, 2);
    assert.equal(withMusic.revision, 6, 'revision 5 → 6');
    const s = withMusic.sessions[0];
    assert.equal(s.musicChat, undefined, 'musicChat удалён');
    assert.equal(s.assistantId, 'producer', 'assistantId восстановлен из musicChat');
    assert.equal(s.history.length, 4, '1 общий + 1 маркер + 2 муз');
    assert.deepEqual(s.history[0], { role: 'user', content: 'привет' }, 'исходная история не тронута');
    assert.equal(s.history[1].role, 'system', 'служебный маркер участвует в контексте');
    assert.match(s.history[1].content, /Муз-диалог перенесён/);
    assert.equal(s.history[2].via, 'music-chat', 'влитые элементы помечены via');
    assert.equal(s.history[2].assistant, 'producer');
    assert.deepEqual(s.history[2], { role: 'user', content: 'муз-вопрос', via: 'music-chat', assistant: 'producer' });
    assert.equal(s.draft.quality, 'flash', 'draft.quality дефолт');
    assert.equal(s.draft.instrumental, true, 'draft.instrumental восстановлен из первого трека сессии');
    assert.equal(s.draft.styleFamily, undefined, 'styleFamily осознанно не восстанавливается');
    // Санитизация music_draft.backups (P3-1 аудита #35) прошла в той же миграции.
    assert.deepEqual(s.feed[1].backups, [{ style: 'живой', lyrics: 'л' }], 'мусор в music_draft.backups вычищен');
    assert.deepEqual(s.feed[2].backups, [], 'не-массив backups у producer_draft → []');
    // П2 SPEC #35: миграция feed НЕ меняет. Ожидание = исходная лента минус
    // санитизация битых backups (это ремонт #23-класса, не миграция).
    const expectedFeed = JSON.parse(JSON.stringify(v1Fixtures.feed));
    expectedFeed[1].backups = [{ style: 'живой', lyrics: 'л' }];
    expectedFeed[2].backups = [];
    assert.deepEqual(s.feed, expectedFeed, 'feed не мигрируется (только sanitize-ремонт мусора)');

    // --- Чистая лента: побайтово равна исходной (П2, без оговорок) --------------
    const cleanFeed = await page.evaluate(async () => {
      const put = raw => new Promise(resolve => {
        const req = indexedDB.open('briix-studio-sessions', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('profiles', 'readwrite');
          tx.objectStore('profiles').put(raw);
          tx.oncomplete = () => { db.close(); resolve(); };
        };
      });
      const feed = [{ t: 'user', who: 'Вы', text: 'чистая лента' }, { t: 'assistant', who: 'Наставник', text: 'ответ', track: true }];
      await put({ schemaVersion: 1, nick: 'чистая-лента', revision: 1, activeSessionId: 'c',
        sessions: [{ id: 'c', title: 'Чистая', createdAt: 1, updatedAt: 1, feed, history: [], musicChat: { assistant: 'mentor', history: [] } }], legacyBackup: null });
      const opened = await BriixSessionStore.openProfile('чистая-лента');
      return { stored: opened.sessions[0].feed, original: feed };
    });
    assert.deepEqual(cleanFeed.stored, cleanFeed.original, 'чистая feed побайтово равна исходной после миграции');

    // --- Идемпотентность: v2-профиль проходит как есть, миграция не меняет ------
    const again = await page.evaluate(async () => {
      const first = await BriixSessionStore.openProfile('с-муз-историей');
      const second = await BriixSessionStore.openProfile('с-муз-историей');
      return { revStable: first.revision === second.revision, same: JSON.stringify(first) === JSON.stringify(second) };
    });
    assert.equal(again.revStable, true, 'повторное открытие не повышает revision (миграция идемпотентна)');
    assert.equal(again.same, true, 'повторное открытие возвращает тот же профиль');

    // --- Гейт: schemaVersion ≥ 3 → schema_unsupported ---------------------------
    const tooNew = await page.evaluate(async () => {
      const put = raw => new Promise(resolve => {
        const req = indexedDB.open('briix-studio-sessions', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('profiles', 'readwrite');
          tx.objectStore('profiles').put(raw);
          tx.oncomplete = () => { db.close(); resolve(); };
        };
      });
      await put({ schemaVersion: 3, nick: 'будущее', revision: 1, activeSessionId: null, sessions: [], legacyBackup: null });
      try { await BriixSessionStore.openProfile('будущее'); return null; }
      catch (e) { return e.code; }
    });
    assert.equal(tooNew, 'schema_unsupported', 'схема ≥3 отвергается');

    // --- П1 п.4: «v1-клиент пишет в v2-хранилище» -------------------------------
    const v1Write = await page.evaluate(async () => {
      const result = {};
      const current = await BriixSessionStore.openProfile('с-муз-историей');
      // Старый код шлёт профиль со schemaVersion: 1 — гейт записи отвергает.
      const stale = { ...current, schemaVersion: 1 };
      try { await BriixSessionStore.saveProfile(stale, current.revision); }
      catch (e) { result.invalid = e.code; }
      // Подмена записи в хранилище назад в v1 (как прочитала бы её старая вкладка) —
      // транзакционный гейт даёт schema_unsupported, хранилище не изменилось.
      const put = raw => new Promise(resolve => {
        const req = indexedDB.open('briix-studio-sessions', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('profiles', 'readwrite');
          tx.objectStore('profiles').put({ ...current, schemaVersion: 1 });
          tx.oncomplete = () => { db.close(); resolve(); };
        };
      });
      await put(current);
      // v2-код пишет поверх записи, откатанной в v1: транзакционный гейт —
      // schema_unsupported, хранилище не перезаписано (П1: не тихая потеря).
      const attempt = { ...current, sessions: [...current.sessions, { id: 'чужая', title: 'x', createdAt: 1, updatedAt: 1, feed: [], history: [] }] };
      try { await BriixSessionStore.saveProfile(attempt, current.revision); }
      catch (e) { result.tx = e.code; }
      // В хранилище по-прежнему v1-запись (не изменилась); при следующем открытии
      // миграция вернёт v2 без 'чужой' сессии.
      const after = await BriixSessionStore.openProfile('с-муз-историей');
      result.notInserted = !after.sessions.some(x => x.id === 'чужая');
      return result;
    });
    assert.equal(v1Write.invalid, 'invalid_profile', 'v1-снапшот отвергнут гейтом save (invalid_profile)');
    assert.equal(v1Write.tx, 'schema_unsupported', 'запись поверх записи чужой версии отвергнута транзакционным гейтом');
    assert.equal(v1Write.notInserted, true, 'хранилище не изменилось (старая вкладка не теряет данные тихо — П1)');

    // --- Двойное открытие v1 двумя вкладками: одна миграция ---------------------
    const freshV1 = await page.evaluate(async () => {
      const put = raw => new Promise(resolve => {
        const req = indexedDB.open('briix-studio-sessions', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('profiles', 'readwrite');
          tx.objectStore('profiles').put(raw);
          tx.oncomplete = () => { db.close(); resolve(); };
        };
      });
      await put({ schemaVersion: 1, nick: 'гонка', revision: 2, activeSessionId: 'a',
        sessions: [{ id: 'a', title: 'Гонка', createdAt: 1, updatedAt: 1, feed: [], history: [], musicChat: { assistant: 'lyricist', history: [] } }], legacyBackup: null });
      return true;
    });
    assert.equal(freshV1, true);
    const race = await Promise.all([
      page.evaluate(() => BriixSessionStore.openProfile('гонка')),
      otherTab.evaluate(() => BriixSessionStore.openProfile('гонка'))
    ]);
    assert.equal(race[0].schemaVersion, 2);
    assert.deepEqual(race[0], race[1], 'двойное открытие v1 двумя вкладками даёт одинаковый v2-профиль');
    assert.equal(race[0].sessions[0].assistantId, 'lyricist', 'муз-история пуста, assistantId всё равно восстановлен');

    // --- Локальный fallback: та же миграция (SPEC §2) ---------------------------
    const fallback = await page.evaluate(async () => {
      localStorage.setItem('briix-studio-sessions-backend-локал-v1', 'local');
      localStorage.setItem('briix-studio-sessions-v1-локал-v1', JSON.stringify({
        schemaVersion: 1, nick: 'локал-v1', revision: 0, activeSessionId: 'a',
        sessions: [{ id: 'a', title: 'Локал', createdAt: 1, updatedAt: 1, feed: [], history: [{ role: 'user', content: 'x' }],
          musicChat: { assistant: 'songwriter', history: [{ role: 'user', content: 'м' }, { role: 'assistant', content: 'о' }] } }], legacyBackup: null
      }));
      const opened = await BriixSessionStore.open('локал-v1');
      const stored = JSON.parse(localStorage.getItem('briix-studio-sessions-v1-локал-v1'));
      return { schemaVersion: opened.profile.schemaVersion, stored, assistantId: opened.profile.sessions[0].assistantId };
    });
    assert.equal(fallback.schemaVersion, 2, 'локальный fallback мигрирует той же функцией');
    assert.equal(fallback.stored.schemaVersion, 2, 'мигрированный локальный профиль записан обратно');
    assert.equal(fallback.assistantId, 'songwriter');

    // --- v2-санитизация: неизвестная роль, битые draft-поля --------------------
    const dirtyV2 = await page.evaluate(async () => {
      const put = raw => new Promise(resolve => {
        const req = indexedDB.open('briix-studio-sessions', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('profiles', 'readwrite');
          tx.objectStore('profiles').put(raw);
          tx.oncomplete = () => { db.close(); resolve(); };
        };
      });
      await put({ schemaVersion: 2, nick: 'грязный-v2', revision: 1, activeSessionId: 'a', sessions: [
        { id: 'a', title: 'Грязная', createdAt: 1, updatedAt: 1, feed: [], history: [],
          assistantId: 'хакер', draft: { styleFamily: 42, quality: 'ultra', instrumental: 'да' } }
      ], legacyBackup: null });
      const opened = await BriixSessionStore.openProfile('грязный-v2');
      return opened.sessions[0];
    });
    assert.equal(dirtyV2.assistantId, 'mentor', 'неизвестная роль → mentor');
    assert.equal(dirtyV2.draft.styleFamily, undefined, 'не-строка styleFamily удалена');
    assert.equal(dirtyV2.draft.quality, 'flash', 'неизвестное качество → flash');
    assert.equal(dirtyV2.draft.instrumental, true, 'instrumental приведён к boolean');

    await context.close();
    console.log('PASS session migration v1→v2: fixtures, idempotency, gates, pending-write rejection, fallback');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
