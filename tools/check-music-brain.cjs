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
// Короткий бриф не раздувается: caption остаётся в рамках трёх слоёв + хвост
// (+ одна базовая пара планов глубины, ~30 символов).
const short = brain.buildTags('песня', { kind: 'song' });
assert.ok(short.tags.length <= 150, `короткий бриф не раздувается (${short.tags.length} <= 150)`);
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

// ------------------------------- (11) голос — идентичность, а не переменная --
// Владелец на прогоне 15.11 услышал: пол вокала менялся от трека к треку без
// зависимости. Причина была в фолбэке «vocals» — модель бросала монетку.
// Теперь пол фиксируется детерминированно: задумка → профиль → дефолт канала.
const noGender = brain.buildTags('современный хит про приключения и любовь', { kind: 'song' });
assert.doesNotMatch(noGender.tags, /(^|, )vocals(,|$)/, 'голое «vocals» больше не уходит в модель');
assert.match(noGender.tags, /^(male|female) vocals/, 'пол лида назван всегда');
assert.equal(noGender.layers.voice.identityFrom, 'дефолт канала', 'источник идентичности виден');
assert.ok(noGender.notes.some(n => n.layer === 'voice.identity'), 'идентичность голоса в notes (не молчаливое решение)');
// Профиль слушателя переопределяет дефолт канала.
const profiled = brain.buildTags('песня про дорогу', { kind: 'song', voiceIdentity: 'female' });
assert.match(profiled.tags, /^female vocals/, 'профиль задаёт голос');
assert.equal(profiled.layers.voice.identityFrom, 'профиль', 'источник — профиль');
// Слово в задумке сильнее профиля.
const overridden = brain.buildTags('женский вокал шёпотом', { kind: 'song', voiceIdentity: 'male' });
assert.match(overridden.tags, /^female vocals/, 'задумка сильнее профиля');
assert.equal(overridden.layers.voice.identityFrom, 'задумка', 'источник — задумка');
// Названа только фактура — пол всё равно фиксируется, иначе лид поплывёт.
const backing = brain.buildTags('бэк-вокал в припеве', { kind: 'song' });
assert.match(backing.tags, /backing vocals/, 'бэк-вокал на месте');
assert.match(backing.tags, /(male|female) vocals/, 'пол лида зафиксирован рядом с бэк-вокалом');
// Детерминизм: один и тот же вход даёт один и тот же caption (важно для альбома).
const twice = [brain.buildTags('песня про море', { kind: 'song' }), brain.buildTags('песня про море', { kind: 'song' })];
assert.equal(twice[0].tags, twice[1].tags, 'caption детерминирован: голос не должен «перебрасываться» между прогонами');
// Инструментал голоса не получает вовсе.
const instru = brain.buildTags('тёмный техно-бит', { kind: 'instrumental' });
assert.doesNotMatch(instru.tags, /vocals/, 'инструментал без вокала');

// --------------------------- (12) глубина и стилевая атмосфера --------------
// Владелец по прогону v3: «насытили, но глубины не достигали, стилевые акценты
// не поднялись». Глубина — контраст близкого и далёкого, а не один эффект
// (audits/style-atmosphere/RESEARCH_PACK.md, §2).
const soulBrief = 'психоделик-соул, 96 BPM, живой бас, Hammond, тёплый аналог, мужской голос шёпотом, ночной порт';
const soul = brain.buildCaption(soulBrief, { kind: 'song' });
assert.equal(soul.layers.style.key, 'psychedelic soul', 'семейство стиля распознано из жанра');
assert.equal(soul.layers.depth.devices.length, 2, 'два стилевых приёма, не один');
assert.ok(soul.layers.depth.depth.length === 1, 'план глубины «близко/далеко» присутствует');
assert.match(soul.caption, /reverb|echo|room|depth|perspective|pocket|groove/i, 'глубина слышна в caption');
// Глубина — это контраст: в паре планов есть и близкое, и далёкое.
assert.match(soul.layers.depth.depth[0], /upfront|close|dry/i, 'в плане глубины есть близкий элемент');
assert.match(soul.layers.depth.depth[0], /distant|far|behind|tail|room|wash/i, 'в плане глубины есть далёкий элемент');
// Не жёсткий шаблон: три брифа одного стиля дают разные цепочки приёмов.
const soulVariants = [
  'психоделик-соул, 96 BPM, живой бас, Hammond, тёплый аналог, мужской голос шёпотом, ночной порт',
  'психоделик-соул, 72 BPM, бас, орган, шёпот, туман',
  'психоделик-соул, 102 BPM, грув, бас, орган'
].map(b => brain.buildCaption(b, { kind: 'song' }).layers.depth.devices.join(' + '));
assert.equal(new Set(soulVariants).size, 3, 'один стиль — разные наборы приёмов (перемешивание, а не шаблон)');
// Детерминизм: тот же бриф — тот же caption (условие единого альбома).
assert.equal(brain.buildCaption(soulBrief, { kind: 'song' }).caption, soul.caption, 'глубина выбирается детерминированно');
// Слова автора сильнее стиля и попадают первыми.
const askedDepth = brain.buildCaption('трип-хоп, сухо вблизи, эхо, бас', { kind: 'song' });
assert.match(askedDepth.caption, /dry close perspective/, 'слово автора «сухо вблизи» в caption');
assert.ok(askedDepth.layers.depth.tags.indexOf('dry close perspective') <= 1, 'слова автора идут первыми');
// Резолвер: подсказка стиля (из референса исполнителя) сильнее жанровых слов.
const byResolver = brain.buildCaption('грув, бас, 96 BPM', { kind: 'song', style: 'dream pop' });
assert.equal(byResolver.layers.style.key, 'dream pop', 'стиль из резолвера принят');
assert.equal(byResolver.layers.style.from, 'резолвер', 'источник стиля — резолвер');
assert.match(byResolver.caption, /plate|pads|shimmering|reverb/i, 'под стиль добавилась его атмосфера');
// Неизвестное семейство не выдумывает приёмы: падаем на жанр/тишину, но не врём.
const unknownStyle = brain.buildCaption('грув, бас, 96 BPM', { kind: 'song', style: 'нечто неслыханное' });
assert.equal(unknownStyle.layers.style.key, null, 'неизвестный стиль не подменяется выдумкой');
assert.equal(unknownStyle.layers.depth.devices.length, 0, 'без стиля приёмы не выдумываются');
// Ничего не выдумываем: пустая задумка не получает НИ СТИЛЯ, НИ ПРИЁМОВ.
// Базовая геометрия «близко/далеко» допустима — это утверждение о миксе, а не
// о жанре (тот же статус, что у дефолтного продакшна).
const bareSong = brain.buildCaption('песня', { kind: 'song' });
assert.equal(bareSong.layers.depth.style, null, 'на пустом брифе стиль не выдумывается');
assert.equal(bareSong.layers.depth.devices.length, 0, 'на пустом брифе стилевые приёмы не выдумываются');
assert.equal(bareSong.layers.depth.from, 'база', 'глубина на пустом брифе — базовая, и это видно');
assert.equal(bareSong.layers.depth.depth.length, 1, 'базовая пара планов глубины присутствует');
// Бюджет держится и с новым слоем.
assert.ok(soul.caption.length <= MAX_CAPTION, 'глубина укладывается в бюджет 640');
const squeezedSoul = brain.buildTags(soulBrief, { kind: 'song' });
assert.ok(squeezedSoul.tags.length <= MAX_TAGS, 'глубина укладывается в компактный бюджет 240');
assert.match(squeezedSoul.tags, RHYTHM_RE, 'под бюджетом ритм-слой всё равно на месте');

// -------------------- (13) разделение caption и лирики, потолок токенов -----
// Ресёрч (audits/limits/RESEARCH_PACK.md): у ACE-Step промт и лирика — разные
// аргументы и разные энкодеры; потолок промта 256 токенов (≈640–800 символов),
// потолок лирики 2048 токенов. Значит: секции — только в лирике, caption —
// однострочный comma-список, и он не должен упираться в токен-потолок.
const lyricsText = '[verse]\nСтрока про море\n[chorus]\nИ снова про море';
const fromLyrics = brain.buildCaption(lyricsText, { kind: 'song' });
assert.doesNotMatch(fromLyrics.caption, /\[(?:verse|chorus|intro|bridge|outro)\]/i,
  'секционные теги из лирики не переезжают в caption');
assert.doesNotMatch(fromLyrics.caption, /\n/, 'caption однострочный');
assert.equal(fromLyrics.selfCheck.notes.filter(n => /секционный|однострочный/.test(n)).length, 0,
  'self-check не ругается на собранный мозгом caption');
// Сторож реально срабатывает, если тег/перевод строки/перегруз всё-таки влезли.
assert.ok(brain.selfCheck('[chorus] male vocals, drum groove', { instrumental: false }).notes.some(n => /секционный/.test(n)),
  'секционный тег в caption ловится self-check');
assert.ok(brain.selfCheck('male vocals,\ndrum groove, analog warmth', { instrumental: false }).notes.some(n => /однострочный/.test(n)),
  'перевод строки в caption ловится self-check');
assert.ok(brain.selfCheck(('tag, '.repeat(200)).trim(), { instrumental: false }).notes.some(n => /обрезаться молча/.test(n)),
  'перегруз по словам ловится self-check');
// Бюджет 640 не упирается в потолок: считаем слова у самого длинного caption.
let maxWords = 0, maxLen = 0;
for (const f of fixtures) {
  const cap = brain.buildCaption(f.brief, Object.assign({ kind: 'song' }, f.options || {}));
  maxWords = Math.max(maxWords, cap.caption.split(/\s+/).filter(Boolean).length);
  maxLen = Math.max(maxLen, cap.caption.length);
}
assert.ok(maxWords <= brain.rules.MAX_CAPTION_WORDS,
  `самый длинный caption ${maxWords} слов ≤ ${brain.rules.MAX_CAPTION_WORDS} (запас до 256 токенов)`);
assert.ok(maxLen <= MAX_CAPTION, `самый длинный caption ${maxLen} символов ≤ ${MAX_CAPTION}`);

// ------------------------------- (14) паритет семейств стиля с резолвером ---
// Резолвер (producer-brain) отдаёт семейство строкой — оно должно существовать
// в STYLE_ATMOSPHERE, иначе мозг молча упадёт на базовую глубину.
const producerScope = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'studio/producer-brain.js'), 'utf8'), producerScope);
const families = producerScope.BriixProducer.STYLE_FAMILIES;
const known = Object.keys(brain.rules.STYLE_ATMOSPHERE);
for (const f of families) assert.ok(known.includes(f), `семейство резолвера «${f}» есть в STYLE_ATMOSPHERE`);
for (const k of known) assert.ok(families.includes(k), `семейство STYLE_ATMOSPHERE «${k}» известно резолверу`);
// Семейство от резолвера реально меняет конструкцию.
const rockish = brain.buildCaption('грув, бас, 96 BPM', { kind: 'song', style: 'rock' });
assert.equal(rockish.layers.style.key, 'rock', 'стиль из резолвера принят мозгом');
assert.match(rockish.caption, /room|close dry drums|live band/i, 'под рок добавились его приёмы');

// ---------------- (15) двуязычные словари: черновик наставника — английский --
// Механизм #40 («строка наставника идёт входом в мозг», 20.11) передаёт в
// buildCaption английскую строку из чата — а словари мозга были русскими.
// Живой кейс владельца: «dream pop, 90 BPM, warm female vocals» терял жанр,
// а «female singer» получал дефолтное «male vocals». Починка (#45): ~200
// английских ключей во всех словарях + граница слова для коротких латинских
// стемов + фильтр хита-в-хите по позиции («male vocals» внутри «female»).
const en = brain.buildCaption('dream pop, 90 BPM, warm female vocals', { kind: 'song' });
assert.ok(en.layers.anchor.genre.includes('dream pop'), 'английский жанр распознан (dream pop)');
assert.equal(en.layers.style.key, 'dream pop', 'семейство стиля из английского жанра');
assert.match(en.caption, /female vocals/, 'female vocals прочитан');
assert.doesNotMatch(en.caption, /(^|, )male vocals(,|$)/, 'дефолт male не дополняется к female');
// «female singer» — без слова «vocals» — тоже читается и не получает мужской дефолт.
const singer = brain.buildCaption('dream pop, female singer', { kind: 'song' });
assert.match(singer.caption, /female vocals/, 'female singer → female vocals');
assert.doesNotMatch(singer.caption.replace('female vocals', ''), /male vocals/, 'female singer без противоречия male');
// Короткий латинский стем — только на границе слова: rap ≠ trap, pop ≠ popular.
const trapEn = brain.buildCaption('trap, 808, dark synth', { kind: 'instrumental' });
assert.equal(trapEn.layers.anchor.genre.length, 1, '«trap» даёт один жанр, а не trap + rap');
assert.equal(trapEn.layers.anchor.genre[0], 'trap', '«trap» не распадается на trap + rap');
const popular = brain.buildTags('popular song about love', { kind: 'song' });
assert.doesNotMatch(popular.tags, /(^|, )pop(,|$)/, '«popular» не превращается в жанр pop');
// Английская безударность не получает грув («beatless ambient» — живой кейс).
const beatless = brain.buildTags('beatless ambient, no drums, deep space', { kind: 'song' });
assert.match(beatless.tags, /beatless drift/, 'beatless → безударный дрейф');
assert.doesNotMatch(beatless.tags, /drum groove/, 'грув не доклеивается к безударному треку');
// Английские вокал (подача/фактура), продакшн, настроение, эпоха.
const enVoice = brain.buildTags('hoarse whisper, intimate, male singer', { kind: 'song' });
assert.match(enVoice.tags, /hoarse rasp/, 'hoarse → hoarse rasp');
assert.match(enVoice.tags, /whispered delivery/, 'whisper → whispered delivery');
const enProd = brain.buildTags('vinyl, tape saturation, warm analog, 80s synthwave', { kind: 'instrumental' });
assert.match(enProd.tags, /vinyl crackle/, 'vinyl → vinyl crackle');
assert.match(enProd.tags, /tape saturation/, 'tape → tape saturation');
assert.match(enProd.tags, /80s/, 'английская эпоха распознана');
const enMood = brain.buildTags('melancholic dreamy ballad, grand piano', { kind: 'song' });
assert.match(enMood.tags, /melancholic/, 'melancholic → тег настроения');
assert.match(enMood.tags, /dreamy/, 'dreamy → тег настроения');
// «dream pop» — жанр, а не концепт «лирики о снах» (голого ключа dream нет).
const dreamPop = brain.buildCaption('dream pop, 90 BPM', { kind: 'song' });
assert.doesNotMatch(dreamPop.caption, /lyrics about dreams?/, 'dream pop не превращается в «лирику о снах»');
// Профили всех 23 семейств: ритм и продакшн строятся по семейству целиком —
// раньше профили покрывали 19/15 из 23, и новые семьи падали на безликую базу.
const families15 = Object.keys(brain.rules.STYLE_ATMOSPHERE);
assert.equal(families15.length, 23, '23 семейства стиля');
for (const f of families15) {
  assert.ok(brain.rules.dictionaries.RHYTHM_BY_GENRE[f], `ритм-профиль для «${f}»`);
  assert.ok(brain.rules.dictionaries.PROD_BY_GENRE[f], `продакшн-профиль для «${f}»`);
}
// Семейство из draft.style строит всю конструкцию, а не только глубину (#45):
// без жанровых слов оно становится якорем жанра и задаёт профили ритма/продакшна.
const byFamily = brain.buildCaption('warm intimate vocals, tape warmth', { kind: 'song', style: 'dream pop' });
assert.ok(byFamily.layers.anchor.genre.includes('dream pop'), 'семейство — якорь жанра');
assert.doesNotMatch(byFamily.caption, /steady drum groove \(kick \+ snare\)/, 'ритм не на фолбэке, а по профилю семейства');
assert.match(byFamily.caption, /soft|shimmer|reverb|pads/i, 'профиль семейства слышен в сборке');

// ------------------------------------------------------------------ вывод --
console.log('PASS music-brain v3: слои, ритм-всегда, вокал с характером и фиксированной идентичностью, продакшн, бюджет, негативы, self-check, полный трек (роли/микс/форма/защита), глубина и стилевая атмосфера, разделение caption/лирики и потолок токенов');
console.log('20 брифов (buildTags / buildCaption, символы):');
for (const r of rows) console.log(`  ${r.id} ${r.source.padEnd(9)} ${String(r.len).padStart(3)} / ${String(r.captionLen).padStart(3)}  ${r.tags}`);
