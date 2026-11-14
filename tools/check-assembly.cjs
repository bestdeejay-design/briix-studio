/* Регресс-сюита сборки музыкального запроса (issue briix.ru#109).
 *
 * Языковое правило владельца 15.11:
 *   1. Музыкальный prompt в модель — ВСЕГДА английский.
 *   2. Теги частей лирики — всегда латиницей ([Intro]/[Verse]/[Pre-Chorus]/[Chorus]/[Bridge]/[Outro]).
 *   3. Лирика — на языке пользователя; дефолт английский; русский/иной — только
 *      при явном указании. Отсутствие указания ≠ русский.
 *   4. Исходная идея сохраняется неизменной; в модель уходит сборка.
 *   5. Художественный текст не «исправлять»: sanitize снимает только
 *      markdown-обрамление и служебные обёртки.
 *
 * Плюс brain-ступень (детерминированный мозг DJ1, studio/music-brain.js):
 *   (и) русская идея → prompt содержит английские ACE-теги, <= 240 символов;
 *   (к) негатив «без кульминации» → позитивная форма flat dynamics;
 *   (л) BPM из идеи попадает в теги;
 *   (м) отсутствие указания языка → лирика/языковой тег английские.
 *
 * Запуск: node tools/check-assembly.cjs (vm, без браузера).
 */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

const scope = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'studio/producer-brain.js'), 'utf8'), scope);
const brain = scope.BriixProducer;
const scope2 = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'studio/music-brain.js'), 'utf8'), scope2);
const musicBrain = scope2.BRIIX_MUSIC_BRAIN;

// ---- Конвейер сборки — зеркало studio.js createMusic (модуль в IIFE, поэтому
// здесь та же логика в чистых функциях; правки конвейера в студии обязаны
// сопровождаться правками этой зеркальной сборки — ассерты ниже ловят расхождение).
function mergePromptTags(base, tags) {
  if (!base) return tags || '';
  if (!tags) return base;
  const low = base.toLowerCase();
  const add = tags.split(',').map(t => t.trim()).filter(t => t && !low.includes(t.toLowerCase()));
  return add.length ? base + ', ' + add.join(', ') : base;
}
(async () => {

async function assemble({ idea = '', manualLyrics = '', instrumental = false, advanced = false, translation = null }) {
  const style = brain.sanitize(idea);
  let lyrics = advanced ? brain.latinizeTags(brain.sanitize(manualLyrics)) : '';
  const explicit = brain.detectExplicitLanguage(idea);
  const tags = musicBrain.buildTags(style || lyrics || '', {
    kind: instrumental ? 'instrumental' : 'song',
    language: explicit || (instrumental ? null : 'en'),
    bpm: musicBrain.detectBpm(style || lyrics || '')
  });
  let finalPrompt;
  if (advanced && style && brain.isAsciiOnly(style)) finalPrompt = style;
  else if (style && !brain.isAsciiOnly(style)) finalPrompt = translation ? mergePromptTags(translation, tags.tags) : (tags.tags || style);
  else if (style) finalPrompt = mergePromptTags(style, tags.tags);
  else finalPrompt = lyrics;
  const params = { model: 'ace-step-flash' };
  if (instrumental) params.instrumental = true;
  if (lyrics) params.lyrics = lyrics;
  // В POST уходит сборка (prompt), в карточку/сессию — исходная идея (input.prompt).
  const requestBase = idea || lyrics;
  return { postPrompt: finalPrompt, inputPrompt: requestBase, params, brainTags: tags.tags };
}

// (д) sanitize на живом факте владельца: markdown и кавычки ушли, текст цел.
const ownerFact = '**"Глубокий, динамичный ритм с мощным басом…';
assert.equal(brain.sanitize(ownerFact), 'Глубокий, динамичный ритм с мощным басом…',
  'markdown-asterisks and quotes from the chat must not reach the model');
// (з) болтовня модели не утекает в params: служебные обёртки снимаются.
assert.equal(brain.sanitize('Конечно! Вот ваша песня:\n\n**[Verse]**\nСтрока про город'), '[Verse]\nСтрока про город');
assert.equal(brain.sanitize('Я подготовил для вас вот такую лирику:\nЛа-ла-ла'), 'Ла-ла-ла');
assert.equal(brain.sanitize("Here's your song:\n\nVerse one line"), 'Verse one line');
assert.equal(brain.validTranslation('Стрим пришёл: Глубокий, динамичный'), null, 'non-ASCII chatter is rejected');
assert.equal(brain.validTranslation('{"prompt":"dream pop"}'), null, 'JSON chatter is rejected');
assert.ok(brain.validTranslation('deep, driving rhythm with powerful bass'));

// (а) русская идея → params.prompt ASCII/английский (перевод не состоялся — brain-теги как гарантированный минимум).
const ru = await assemble({ idea: 'Глубокий, динамичный ритм с мощным басом, вечерний город' });
assert.ok(brain.isAsciiOnly(ru.postPrompt), 'Russian idea must produce an ASCII English prompt');
assert.ok(ru.postPrompt.length <= 240, 'brain tag prompt <= 240 chars');
// (и) русский prompt содержит английские теги таксономии ACE-Step.
assert.match(ru.postPrompt, /\bbass\b/);
assert.match(ru.postPrompt, /\b(?:dark|urban|atmospheric|vocals)\b/);
// (к) негатив «без кульминации» → позитивная форма flat dynamics.
const neg = await assemble({ idea: 'Глубокий ритм без кульминации, без реверберации' });
assert.match(neg.postPrompt, /flat dynamics/);
assert.match(neg.postPrompt, /dry close-mic production/);
// (л) BPM присутствует, если задан в идее.
const bpm = await assemble({ idea: 'Глубокий ритм, 72 BPM, вечерний город' });
assert.match(bpm.postPrompt, /72 BPM/);
// (м) без указания языка → лирика английская: brain-дефолт English lyrics.
assert.match(ru.postPrompt, /English lyrics/, 'no language stated = English lyrics tag (absence of a hint is not Russian)');
// (в) идея «…на русском» → языковой тег русской лирики, промпт всё равно английский.
const ruExplicit = await assemble({ idea: 'Глубокий ритм, песня на русском' });
assert.match(ruExplicit.postPrompt, /Russian lyrics/);
assert.ok(brain.isAsciiOnly(ruExplicit.postPrompt));

// (г) теги частей всегда латиницей, только теги переписываются.
assert.equal(brain.latinizeTags('[Куплет 2]\n[Припев]\n[Пред-Припев]\n[Интро]\n[Бридж]\n[Аутро]'),
  '[Verse 2]\n[Chorus]\n[Pre-Chorus]\n[Intro]\n[Bridge]\n[Outro]');
assert.equal(brain.latinizeTags('[verse]\n[chorus]\nтекст не трогаем'), '[Verse]\n[Chorus]\nтекст не трогаем');
const skel = musicBrain.buildLyricsSkeleton('грустная песня про дождь', { kind: 'song' });
const order = [...skel.matchAll(/\[([A-Za-z][^\]\n]*)\]/g)].map(m => m[1].replace(/\s+\d+$/, '').split(':')[0].trim());
assert.deepEqual([...new Set(order)], ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro'],
  'scaffold order intro -> verse -> pre-chorus -> chorus -> bridge -> outro, Latin only');
assert.equal(musicBrain.buildLyricsSkeleton('любой текст', { kind: 'instrumental' }), '[Instrumental]');

// (е) ручная лирика не заменяется: только латинизация тегов + предупреждение.
const manual = '[Verse]\nГород спит\n[Chorus]\nА я не сплю';
const manualAsm = await assemble({ idea: 'dream pop, 90 BPM, female vocals', manualLyrics: manual, advanced: true });
assert.equal(manualAsm.params.lyrics, manual, 'manual lyrics are sent as authored');
assert.equal(manualAsm.postPrompt, 'dream pop, 90 BPM, female vocals', 'ASCII advanced prompt is not rewritten');
assert.equal(manualAsm.inputPrompt, 'dream pop, 90 BPM, female vocals', 'original idea is kept in the card/session');
assert.equal(brain.structureWarnings(manual).length, 0, 'manual scaffold is valid, no nag');
const tagged = await assemble({ idea: 'dream pop', manualLyrics: '[Куплет 1]\nМой текст', advanced: true });
assert.equal(tagged.params.lyrics, '[Verse 1]\nМой текст', 'only the tags are latinized');
assert.equal(brain.structureWarnings('Просто текст без тегов').length, 1, 'missing tags warned, not enforced');
assert.ok(brain.structureWarnings('[Chorus]\nx\n[Verse]\ny').some(w => /раньше первого куплета/.test(w)));

// (ж) instrumental — без лирики, с флагом и brain-тегом instrumental.
const inst = await assemble({ idea: 'Глубокий техно-бит без вокала', instrumental: true });
assert.equal(inst.params.instrumental, true);
assert.equal(inst.params.lyrics, undefined);
assert.match(inst.postPrompt, /\binstrumental\b/);

// producer-канон: system держит языковое правило и дефолт английской лирики.
const sys = brain.messages({ idea: 'Песня про собаку', instrumental: false, existingLyrics: '' })[0].content;
assert.match(sys, /prompt пиши ТОЛЬКО по-английски/i);
assert.match(sys, /язык явно не указан — пиши лирику по-английски/i);
assert.match(sys, /латиниц[ыей].*\[Intro\]/i);
assert.match(sys, /не приписывай конкретный темп/i); // прежний канон сохранён
// перевод — producer-путь чата, только английский вывод.
const tr = brain.translateMessages('Глубокий ритм');
assert.equal(tr.length, 2);
assert.match(tr[0].content, /Output ONLY the English prompt/i);
// автолирика: дефолт английский, явное указание уважается (studio.js).
const studioSrc = fs.readFileSync(path.join(ROOT, 'studio/studio.js'), 'utf8');
assert.match(studioSrc, /Язык явно не указан — пиши текст песни по-английски/, 'autoLyrics defaults to English');
assert.match(studioSrc, /langLine = language === 'ru' \? ' Пиши текст песни на русском\.'/, 'explicit Russian is honored');
assert.match(studioSrc, /translatePrompt\(style, handle\.controller\.signal\)/, 'translation is abortable on the producer chat path');
// duration никуда не отправляется.
assert.doesNotMatch(studioSrc, /duration/i, 'no duration anywhere in studio.js');
console.log('PASS assembly: sanitize, language rule, Latin tags, brain stage, scaffold, manual/instrumental guards');

})().catch(error => { console.error('FAIL: ' + (error?.message || error)); process.exit(1); });
