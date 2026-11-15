/* Сюита музыкального мозга v2 (issue briix-studio#20).
 *
 * Проверяет не «красоту тегов», а приёмку §5 issue:
 *   (1) ритм-слой в caption есть ВСЕГДА — включая бриф без слов о ритме;
 *   (2) вокальный слой содержит подачу/фактуру, и «шЁпот / хрип / речитатив»
 *       дают РАЗНЫЕ английские теги;
 *   (3) продакшн-слой есть всегда (дефолт по жанру, если о записи не сказано);
 *   (4) перегруз-защита: длинный бриф не раздувает caption, MAX_TAGS соблюдается,
 *       при усечении режется хвост, а не ритм/голос/продакшн;
 *   (5) 20 тестовых брифов (tools/fixtures/briefs-20.json) проходят слоевой чек-лист;
 *   (6) обратная совместимость buildTags(brief, options) → {tags, notes, source};
 *   (7) негативы перефразируются позитивно и НЕ инвертируются
 *       («без фальцета» не превращается в falsetto);
 *   (8) self-check: если слоя физически нет — в notes есть утверждение об этом;
 *   (9) антифальцетный страж для низкого голоса.
 *
 * Запуск: node tools/check-music-brain.cjs (vm, без браузера и без сети).
 */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

const scope = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'studio/music-brain.js'), 'utf8'), scope);
const brain = scope.BRIIX_MUSIC_BRAIN;
assert.ok(brain, 'music-brain exports BRIIX_MUSIC_BRAIN');

const MAX_TAGS = brain.rules.MAX_TAGS;
const MAX_CAPTION = brain.rules.MAX_CAPTION;
const RHYTHM_RE = /groove|beat|drum|kick|percussion|pulse/;
const PROD_RE = /production|mix|saturation|warmth|close-mic|reverb|stereo|room sound|room tone|vinyl|low end|sub-bass|atmosphere|ambience|static|broadcast/;
const VOICE_RE = /vocal|baritone|tenor|choir|voice/;
const VOICE_CHAR_RE = /whisper|spoken|sung|rasp|gravel|velvet|breath|hoarse|chest voice|delivery|tone|timbre/;

// ---------------------------------------------------------------- (1) ритм ---
// Бриф, в котором нет ни одного слова о ритме: drums всё равно обязаны быть.
const noRhythm = brain.buildTags('тёплая песня про лето и друзей', { kind: 'song' });
assert.match(noRhythm.tags, RHYTHM_RE, 'ритм-слой присутствует даже без слов о ритме');
assert.equal(noRhythm.selfCheck.ok, true, 'self-check зелёный на брифе без ритма');
// Жанровый дефолт ритма: тех-хаус получает four-on-the-floor, а не абстрактный beat.
const house = brain.buildTags('тех-хаус', { kind: 'song' });
assert.match(house.tags, /four-on-the-floor/, 'жанр задаёт характер ритм-секции');
const trap = brain.buildTags('трэп', { kind: 'song' });
assert.match(trap.tags, /808/, 'трэп получает 808-кит, а не поп-кит');

// --------------------------------------------------------------- (2) вокал ---
const whisper = brain.buildTags('мужской голос шёпотом', { kind: 'song' });
const rasp = brain.buildTags('мужской голос с хрипом', { kind: 'song' });
const spoken = brain.buildTags('мужской голос речитативом', { kind: 'song' });
assert.match(whisper.tags, /whispered delivery/, 'шёпот → whispered delivery');
assert.match(rasp.tags, /hoarse rasp/, 'хрип → hoarse rasp');
assert.match(spoken.tags, /spoken word/, 'речитатив → spoken word');
assert.notEqual(whisper.tags, rasp.tags, 'разные подачи дают разные caption');
assert.notEqual(rasp.tags, spoken.tags, 'разные подачи дают разные caption');
for (const r of [whisper, rasp, spoken]) {
  assert.match(r.tags, VOICE_RE, 'вокальный слой с полом');
  assert.match(r.tags, VOICE_CHAR_RE, 'вокальный слой с характером (подача/фактура)');
  assert.equal(r.selfCheck.missing.length, 0, 'self-check не находит дыр в вокальном слое');
}
// Голос без характера раньше описывался одним «vocals» — теперь есть дефолтная подача.
const bare = brain.buildTags('женский вокал', { kind: 'song' });
assert.match(bare.tags, VOICE_CHAR_RE, 'дефолтная подача вместо голого «vocals»');

// ---------------------------------------------------------- (3) продакшн ----
const bareProd = brain.buildTags('песня про дорогу', { kind: 'song' });
assert.match(bareProd.tags, PROD_RE, 'продакшн-слой есть даже без слов о записи');
const dry = brain.buildTags('вокал без реверберации', { kind: 'song' });
assert.match(dry.tags, /dry close-mic production/, 'негатив «без реверберации» → позитивный тег');

// --------------------------------------------------- (4) перегруз-защита -----
const fixtures = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/briefs-20.json'), 'utf8')).briefs;
const longBrief = fixtures.find(f => f.id === 's18');
const overload = brain.buildTags(longBrief.brief, longBrief.options);
assert.ok(overload.tags.length <= MAX_TAGS, `MAX_TAGS соблюдается (${overload.tags.length} <= ${MAX_TAGS})`);
assert.match(overload.tags, RHYTHM_RE, 'при усечении ритм-слой выживает');
assert.match(overload.tags, PROD_RE, 'при усечении продакшн-слой выживает');
assert.match(overload.tags, VOICE_CHAR_RE, 'при усечении характер вокала выживает');
assert.ok(overload.notes.some(n => /срезано/.test(n.tag)), 'усечение видно в notes (не молчаливое)');
// Короткий бриф не раздувается: caption остаётся в рамках трёх слоёв + хвост.
const short = brain.buildTags('песня', { kind: 'song' });
assert.ok(short.tags.length <= 140, `короткий бриф не раздувается (${short.tags.length} <= 140)`);
assert.ok(short.tags.split(', ').length <= 9, 'не больше 9 блоков на короткой задумке');

// ------------------------------------------------------ (5) 20 брифов -------
const rows = [];
for (const f of fixtures) {
  const tags = brain.buildTags(f.brief, f.options);
  const caption = brain.buildCaption(f.brief, f.options);
  assert.ok(tags.tags.length <= MAX_TAGS, `${f.id}: buildTags <= ${MAX_TAGS}`);
  assert.ok(caption.caption.length <= MAX_CAPTION, `${f.id}: buildCaption <= ${MAX_CAPTION}`);
  assert.match(tags.tags, RHYTHM_RE, `${f.id}: ритм-слой`);
  if (f.options.kind !== 'instrumental') assert.match(tags.tags, VOICE_CHAR_RE, `${f.id}: характер вокала`);
  assert.match(tags.tags, PROD_RE, `${f.id}: продакшн-слой`);
  assert.equal(tags.selfCheck.ok, true, `${f.id}: self-check ok (${tags.selfCheck.missing.join(',')})`);
  rows.push({ id: f.id, source: f.source, len: tags.tags.length, captionLen: caption.caption.length, tags: tags.tags });
}

// ------------------------------------------------- (6) обратная совместимость -
const compat = brain.buildTags('грустная песня про дождь', { kind: 'song', language: 'en', bpm: 72 });
assert.equal(typeof compat.tags, 'string', 'tags — строка (как ждёт студия)');
assert.ok(Array.isArray(compat.notes) && compat.notes.every(n => typeof n.tag === 'string'), 'notes — провенанс {tag}');
assert.ok(compat.notes.every(n => 'from' in n || n.from === null), 'notes сохраняют from');
assert.ok(typeof compat.source === 'string' && compat.source.length > 0, 'source на месте');
assert.match(compat.tags, /72 BPM/, 'явный темп из options');
assert.match(compat.tags, /English lyrics/, 'дефолт языка — английский (#109)');
const ru = brain.buildTags('песня про море', { kind: 'song', language: 'ru' });
assert.match(ru.tags, /Russian lyrics/, 'явный русский уважается');
const inst = brain.buildTags('тёмный техно-бит', { kind: 'instrumental' });
assert.match(inst.tags, /instrumental/, 'инструментал помечен');
assert.doesNotMatch(inst.tags, VOICE_RE, 'у инструментала нет вокального слоя');
assert.match(inst.tags, RHYTHM_RE, 'у инструментала есть ритм-слой');

// ------------------------------------------- (7) негативы не инвертируются ---
const noFalsetto = brain.buildTags('мужской баритон, без фальцета', { kind: 'song' });
assert.doesNotMatch(noFalsetto.tags, /falsetto/, '«без фальцета» не превращается в falsetto');
assert.match(noFalsetto.tags, /full-voice delivery/, 'негатив перефразирован позитивно');
const noDrums = brain.buildTags('оркестр, без ударных', { kind: 'song' });
assert.match(noDrums.tags, /beatless drift/, '«без ударных» → безударный дрейф');
assert.doesNotMatch(noDrums.tags, /drum groove/, 'при «без ударных» грув не добавляется');

// ------------------------------------------------------- (8) self-check -----
// Крошечный бюджет: слои срезаются — и это обязано быть видно в notes.
const squeezed = brain.buildTags('психоделик-соул, мужской баритон шёпотом, живой бас, 72 BPM, туман', { kind: 'song', maxTags: 60 });
assert.ok(squeezed.tags.length <= MAX_TAGS, 'жёсткий бюджет не ломает общий лимит');
assert.ok(squeezed.notes.some(n => n.layer === 'budget'),
  'срез/недобор бюджета виден в notes (не молчаливая деградация)');
assert.match(squeezed.tags, RHYTHM_RE, 'даже под давлением бюджета ритм-слой на месте');

// --------------------------------------------- (9) антифальцетный страж -----
const low = brain.buildTags('глубокий мужской бас-голос, 72 BPM', { kind: 'song' });
assert.match(low.tags, /chest voice, register never rises/, 'низкий голос защищён от фальцет-дрейфа');
const high = brain.buildTags('женский фальцет, поп', { kind: 'song' });
assert.match(high.tags, /falsetto/, 'явно запрошенный фальцет не подавляется');
assert.doesNotMatch(high.tags, /register never rises/, 'страж не срабатывает на явный фальцет');

// ----------------------------------- (10) полный трек: роли, микс, форма ----
// «Полный трек со всем необходимым»: помимо трёх базовых слоёв мозг обязан
// слышать роли инструментов, микс, форму во времени и защиту от дрейфа —
// но только если автор об этом сказал (ничего не выдумываем).
const full = brain.buildCaption(
  'психоделик-соул, 96 BPM, ведущая живая бас-гитара несёт главную мелодию, Hammond фоном, '
  + 'середина плотная, широкий стерео, вступление на помехах, нарастание к последнему припеву, '
  + 'тихая пауза перед возвращением барабанов, тёплый аналог, без автотюна, ночной порт, мужской голос шёпотом',
  { kind: 'song', language: 'en' });
assert.match(full.caption, /carrying the main melody/, 'роль инструмента: бас несёт мелодию');
assert.match(full.caption, /present midrange|wide stereo image/, 'микс: середина/стерео');
assert.match(full.caption, /build into the last chorus|near-silent suspensions/, 'форма: нарастание и пауза');
assert.match(full.caption, /unprocessed natural voice/, 'защита от дрейфа в позитивной форме');
assert.ok(full.caption.length <= MAX_CAPTION, `полный трек укладывается в бюджет (${full.caption.length})`);
assert.ok(full.caption.split(', ').length >= 12, 'полный трек не сведён к трём тегам');
// Ничего не выдумываем: пустая задумка не получает ролей, микса и формы.
const lean = brain.buildCaption('песня', { kind: 'song' });
assert.equal(lean.layers.roles.length, 0, 'роли не выдумываются');
assert.equal(lean.layers.mix.length, 0, 'микс не выдумывается');
assert.equal(lean.layers.arrangement.length, 0, 'форма не выдумывается');
// Короткий стем не ловится внутри слова: «широкий стерео» — не рок, «убитый» — не бит.
const noFalseGenre = brain.buildTags('широкий стерео, тёплый аналог', { kind: 'song' });
assert.doesNotMatch(noFalseGenre.tags, /\brock\b/, '«широкий» не превращается в жанр rock');
assert.match(noFalseGenre.tags, /wide stereo image/, '«широкий стерео» → wide stereo image');

// ------------------------------------------------------------------ вывод --
console.log('PASS music-brain v2: слои, ритм-всегда, вокал с характером, продакшн, бюджет, негативы, self-check, полный трек (роли/микс/форма/защита)');
console.log('20 брифов (buildTags / buildCaption, символы):');
for (const r of rows) console.log(`  ${r.id} ${r.source.padEnd(9)} ${String(r.len).padStart(3)} / ${String(r.captionLen).padStart(3)}  ${r.tags}`);
