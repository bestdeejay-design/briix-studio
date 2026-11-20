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
assert.match(studioSrc, /musicDraftInstruction[\s\S]{0,1200}Имена исполнителей в любом виде[\s\S]{0,200}в title, prompt и lyrics не пиши/, 'draft-инструкция запрещает имена (включая транслит)');
assert.match(studioSrc, /musicDraftInstruction[\s\S]{0,900}"style"/, 'draft-инструкция содержит поле style');

// Гвар-блок: чистые функции, BriixProducer из producer-brain (как в проде).
const scope = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../studio/producer-brain.js'), 'utf8'), scope);
const guardSrc = studioSrc.match(/\/\/ >>> chat-draft-guard[^\n]*\n([\s\S]*?)\/\/ <<< chat-draft-guard/);
assert.ok(guardSrc, 'маркеры chat-draft-guard в studio.js на месте');
vm.runInNewContext(guardSrc[1], scope);
const { guardMusicDraft, extractArtistRefs } = scope;

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

// ---- #40 hit-quality: дисциплина хука, усиленный #109, гварды ----------------

// Дисциплина хука в «Автор песни» и «Лирик»: якорная фраза, слоговой ориентир, рифма.
for (const id of ['songwriter', 'lyricist']) {
  const s = systemOf(id);
  assert.match(s, /якорн[а-я]* фраз[аыу]/i, id + ': хук = якорная фраза припева');
  assert.match(s, /5[–-]8 слогов/i, id + ': слоговой ориентир хука');
  assert.match(s, /8[–-]12 слогов/i, id + ': слоговой ориентир куплета');
  assert.match(s, /рифм[ау]/i, id + ': рифма обязательна');
  assert.match(s, /без канцелярита|канцелярит/i, id + ': запрет канцелярита');
  assert.match(s, /повторяет|повторяемая/i, id + ': повторяемость хука');
}
assert.match(systemOf('songwriter'), /читается как хит за один раз/i, 'songwriter: самопроверка хука');
assert.match(systemOf('songwriter'), /перечислен/i, 'songwriter: запрет перечислений-криков');

// Усиленное языковое правило #109 во всех трёх промтах (мягкую GLM обходил).
for (const id of ['producer', 'lyricist', 'songwriter']) {
  const s = systemOf(id);
  assert.match(s, /высшего приоритета/i, id + ': правило языка помечено высшим приоритетом');
  assert.match(s, /ДАЖЕ ЕСЛИ идея/i, id + ': явный запрет «русская идея → русская лирика»');
}
assert.match(studioSrc, /musicDraftInstruction[\s\S]{0,1600}правило высшего приоритета/, 'draft-инструкция: усиленный #109');

// Гвард инструментала в промте и в постгварде.
assert.match(systemOf('songwriter'), /ГВАРД ИНСТРУМЕНТАЛА[\s\S]{0,200}НЕ ПИШИ ЛИРИКУ/i, 'songwriter: системный запрет лирики при инструментале');
assert.match(studioSrc, /musicDraftInstruction[\s\S]{0,1600}поле lyrics ОБЯЗАНО быть пустой строкой/, 'draft-инструкция: инструментал → пустая лирика');
const instr = guardMusicDraft(
  { title: 'Night Club', prompt: 'club instrumental 128 BPM, pulsating basslines, no vocals', lyrics: '[Verse]\nстарая лирика\nмелодическое 主题', style: '' },
  'клубный трек без вокала', true);
assert.equal(instr.draft.lyrics, '', 'инструментал: лирика вычищена постгвардом');
assert.ok(instr.warnings.some(w => /инструментал/.test(w)), 'предупреждение про инструментал в карточке');
assert.doesNotMatch(instr.draft.lyrics + instr.draft.prompt, /[\u4e00-\u9fff]/, 'CJK-токены вырезаны');
const instrByIdea = guardMusicDraft({ title: 'T', prompt: 'deep house', lyrics: '[Chorus] la-la' }, 'трек-инструментал для бега', false);
assert.equal(instrByIdea.draft.lyrics, '', 'инструментал распознан из идеи (гвард без флага)');
const vocalOk = guardMusicDraft({ title: 'T', prompt: 'warm ballad', lyrics: '[Chorus] hold me' }, 'песня про осень', false);
assert.equal(vocalOk.draft.lyrics, '[Chorus] hold me', 'вокальный черновик лирики не лишается');
assert.equal(vocalOk.warnings.length, 0, 'чистый вокальный черновик без предупреждений');

// Анти-утечка транслита: «в стиле Тихий Электрик» → латиница в prompt вырезается.
const leakTr = guardMusicDraft(
  { title: 'Огни', prompt: 'Indie Electronic track in the style of Tikhii Elektrik, Russian male vocals, analog synth', lyrics: '', style: '' },
  'трек в стиле Тихий Электрик', false);
assert.doesNotMatch(leakTr.draft.prompt, /tikhii/i, 'транслит имени вырезан из prompt');
assert.ok(leakTr.warnings.some(w => /транслите/.test(w)), 'предупреждение о транслите в карточке');
assert.match(leakTr.draft.prompt, /Indie Electronic/, 'остальной prompt не пострадал');
const leakTr2 = guardMusicDraft(
  { title: 'Т', prompt: 'dream pop like Kino, airy guitars', lyrics: '', style: '' },
  'в стиле Кино', false);
assert.doesNotMatch(leakTr2.draft.prompt, /\bKino\b/i, 'вариант транслита (и→i, но латинское имя в идее) ловится');
const noLeak = guardMusicDraft({ title: 'Т', prompt: 'eurodance 90s, four-on-the-floor', lyrics: '', style: '' }, 'евродэнс 90-х', false);
assert.equal(noLeak.warnings.length, 0, 'ложных срабатываний транслита нет');

// Хенд-офф Лирик → Автор песни: маркер-кнопка в studio.js (не автозапуск).
assert.match(studioSrc, /Довести до полной песни → Автор песни/, 'кнопка хенд-оффа Лирика');
assert.match(studioSrc, /assistant\.id === 'lyricist'[\s\S]{0,400}Довести до полной песни/, 'хенд-офф только у Лирика без лирики');

console.log('check-chat-draft: OK');
