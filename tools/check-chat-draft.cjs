/* #39: постобработка чат-черновиков наставников — vm, без браузера.
 * Единое языковое правило #109 + запрет имён исполнителей в prompt/title.
 * Гвар-блок читается из studio/studio.js между маркерами chat-draft-guard,
 * producer-brain.js грузится как в проде (globalThis.BriixProducer).
 * Run: node tools/check-chat-draft.cjs
 */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Промты наставников: язык #109 и запрет имён — прямо в studio.js.
const studioSrc = fs.readFileSync(path.join(__dirname, '../studio/studio.js'), 'utf8');
const systemOf = id => {
  const m = studioSrc.match(new RegExp("id: '" + id + "', name: '[^']*', system: '([^']+)'"));
  assert.ok(m, 'наставник ' + id + ' найден в ASSISTANTS.music');
  return m[1];
};

// Языковое правило #109 — единственный источник, «Всегда по-русски» убрано из всех путей.
for (const id of ['producer', 'lyricist', 'songwriter']) {
  const s = systemOf(id);
  assert.doesNotMatch(s, /Всегда по-русски/i, id + ': дефолт «всегда по-русски» удалён');
  assert.match(s, /(?:язык явно не указан[^.]*по-английски|по умолчанию \(язык не указан\)[^.]*на английском)/i, id + ': не указан язык → английский');
  assert.match(s, /(?:явно указал язык[^.]*на нём|на русском — только если пользователь явно попросил)/i, id + ': явно указан → язык пользователя');
}
assert.ok(!/Всегда по-русски/.test(studioSrc), '«Всегда по-русски» не осталось нигде в studio.js');
// Имена исполнителей запрещены в системных промтах наставников и в draft-инструкции.
for (const id of ['producer', 'lyricist', 'songwriter']) {
  assert.match(systemOf(id), /им[яуе][^.]*не пиши|имена исполнител/i, id + ': запрет имён артистов есть');
}
assert.match(studioSrc, /musicDraftInstruction[\s\S]{0,900}Имена исполнителей в title, prompt и lyrics не пиши/, 'draft-инструкция запрещает имена');
assert.match(studioSrc, /musicDraftInstruction[\s\S]{0,900}"style"/, 'draft-инструкция содержит поле style');

// Гвар-блок: чистые функции, BriixProducer из producer-brain (как в проде).
const scope = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../studio/producer-brain.js'), 'utf8'), scope);
const guardSrc = studioSrc.match(/\/\/ >>> chat-draft-guard[^\n]*\n([\s\S]*?)\/\/ <<< chat-draft-guard/);
assert.ok(guardSrc, 'маркеры chat-draft-guard в studio.js на месте');
vm.runInNewContext(guardSrc[1], scope);
const { guardMusicDraft, extractArtistRefs, stripArtistNameAtEdges, rebuildTitleWithoutNames } = scope;

// Ссылки на артиста извлекаются из идеи.
const refsEq = (idea, expected, msg) => assert.equal(JSON.stringify(extractArtistRefs(idea)), JSON.stringify(expected), msg);
refsEq('песня в стиле Руки Вверх про осень', ['Руки Вверх']);
refsEq('something in the style of Portishead, moody', ['Portishead']);
refsEq('трек в духе Kafka и дождь', ['Kafka']);
refsEq('песня про осень', [], 'без ссылки имён нет');

// 1) title равен имени артиста → пересобран, предупреждение есть.
const a = guardMusicDraft(
  { title: 'Руки Вверх!', prompt: 'Upbeat russian eurodance, bright synth brass, male lead vocals', lyrics: '[Verse]\nline', style: '' },
  'песня в стиле Руки Вверх про осень');
assert.doesNotMatch(a.draft.title, /руки\s*вверх/i, 'title больше не имя артиста');
assert.ok(a.draft.title.length > 0, 'title пересобран');
assert.ok(a.warnings.some(w => /Название совпало с именем исполнителя/.test(w)), 'предупреждение о title в карточке');

// 2) title-фолбэк на семейство стиля, когда из темы ничего не осталось.
const b = guardMusicDraft(
  { title: 'Руки Вверх', prompt: 'eurodance, catchy synth hook', lyrics: 'line', style: 'Dream Pop' },
  'в стиле Руки Вверх');
assert.equal(b.draft.title, 'Dream Pop', 'пустой остаток → title из семейства стиля');

// 3) имя артиста в prompt → styleLeaks-предупреждение (prompt не режем — правит модель/пользователь).
const c = guardMusicDraft(
  { title: 'Осень', prompt: 'moody trip-hop like Portishead', lyrics: 'line', style: 'trip-hop' },
  'в духе Portishead');
assert.ok(c.warnings.length >= 1, 'styleLeaks-эвристика срабатывает на чат-черновике');
assert.match(c.prompt || '', /^/, ''); // no-op guard
assert.equal(c.draft.title, 'Осень', 'чистый title не трогается');
assert.equal(c.draft.style, 'trip-hop', 'известное семейство сохраняется');

// 4) style нормализуется через normalizeStyle, неизвестное — отбрасывается.
const d = guardMusicDraft({ title: 'Т', prompt: 'warm pads', lyrics: 'line', style: 'Dream  Pop' }, 'песня про осень');
assert.equal(d.draft.style, 'dream pop');
const e = guardMusicDraft({ title: 'Т', prompt: 'warm pads', lyrics: 'line', style: 'как у Portishead' }, 'песня про осень');
assert.equal(e.draft.style, '', 'неизвестное семейство отброшено');
assert.equal(e.warnings.length, 0, 'чистый черновик без предупреждений');

// 5) язык по умолчанию en — правило #109 в мозге не задублировано и дошло до промтов.
assert.match(scope.BriixProducer.messages({ idea: 'песня про осень', instrumental: false, existingLyrics: '' })[0].content,
  /язык явно не указан[^.]*по-английски/i, 'правило #109 в системном промте мозга');
// detectExplicitLanguage: отсутствие указания ≠ русский.
assert.equal(scope.BriixProducer.detectExplicitLanguage('песня про осень'), null);
assert.equal(scope.BriixProducer.detectExplicitLanguage('песня про осень на русском'), 'ru');

// 6) утечка имени/псевдонима в ЛИРИКЕ (Brain Upgrade Spec §5.1: бан имён
//    распространяется и на лирику; живой кейс — «Hands up» = «Руки Вверх»).
//    Художественный текст не переписываем — честное предупреждение.
const g = guardMusicDraft(
  { title: 'Осень', prompt: 'eurodance, bright synth brass', lyrics: '[Verse]\nHands up, лето кончилось\n[Chorus]\nруки вверх к небесам', style: 'edm' },
  'песня в стиле Руки Вверх про осень');
assert.ok(g.warnings.some(w => /звучит в тексте песни/.test(w)), 'утечка имени/псевдонима в лирике замечена');
assert.match(g.draft.lyrics, /Hands up/, 'текст не переписывается — только предупреждение');
// Чистая лирика без имён — предупреждений нет (ложных срабатываний не плодим).
const h = guardMusicDraft({ title: 'Осень', prompt: 'eurodance', lyrics: '[Verse]\nпросто строка', style: 'edm' }, 'песня про осень');
assert.equal(h.warnings.length, 0, 'чистая лирика — без предупреждений');

// 7) Н3 (симуляция #51): имя из названия не вырезается из середины фразы —
//    «Мы смотрели кино до утра» больше не превращается в битое «Мы смотрели
//    до утра»; название пересобирается из чистой строки лирики.
assert.equal(stripArtistNameAtEdges('Мы смотрели кино до утра', ['Кино']), '',
  'имя в середине → пустой остаток (сигнал пересборки), не битая фраза');
assert.equal(stripArtistNameAtEdges('Кино — ночная песня', ['Кино']), '— ночная песня'.replace('— ', ''),
  'имя на краю → честный срез края'); // → 'ночная песня'
assert.equal(stripArtistNameAtEdges('Руки Вверх Style Party', ['Руки Вверх']), 'Style Party',
  'псевдоним на краю срезается, содержательная часть названия остаётся');
assert.equal(stripArtistNameAtEdges('Песня про кино', ['Кино']), 'Песня',
  'свисающий предлог после среза тоже уходит');
assert.equal(stripArtistNameAtEdges('Песня про осень', ['Кино']), 'Песня про осень',
  'чистое название не трогается');
assert.equal(rebuildTitleWithoutNames('Мы смотрели кино до утра',
  { names: ['Кино'], lyrics: '[Verse 1]\nМы смотрели кино до утра\n[Chorus]\nНочные окна', idea: 'рок в стиле Кино, 120 BPM', style: 'rock' }),
  'Ночные окна', 'пересборка: первая чистая строка лирики вместо дыры посередине');
assert.equal(rebuildTitleWithoutNames('Моя песня про кино и дождь',
  { names: ['Кино'], lyrics: '', idea: 'рок в стиле Кино, 120 BPM', style: 'rock' }),
  'Рок 120 BPM', 'пересборка: тема идеи без фразы-ссылки');
assert.equal(rebuildTitleWithoutNames('навсегда Portishead в сердце',
  { names: ['Portishead'], lyrics: '', idea: 'трек в духе Portishead', style: 'trip-hop' }),
  'Trip-Hop', 'пересборка: фолбэк на семейство стиля');
assert.equal(rebuildTitleWithoutNames('навсегда Portishead в сердце',
  { names: ['Portishead'], lyrics: '', idea: 'трек в духе Portishead', style: null }),
  '', 'пересборка не удалась — вызывающий ставит свой fallback');

console.log('check-chat-draft: OK');
