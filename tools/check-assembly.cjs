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
 *   (и) русская идея → prompt содержит английский caption, <= 640 символов;
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
// Кап строки звучания — зеркало capStyleLine из studio.js (#45).
const capStyleLine = (text, budget) => {
  const v = String(text || '');
  const max = budget || musicBrain.rules.MAX_CAPTION;
  if (v.length <= max) return v;
  let cut = v.slice(0, max + 1).lastIndexOf(',');
  if (cut <= 0) cut = max;
  return v.slice(0, cut).trim();
};
(async () => {

async function assemble({ idea = '', manualLyrics = '', instrumental = false, advanced = false, translation = null, brainPending = false }) {
  const style = brain.sanitize(idea);
  let lyrics = advanced ? brain.latinizeTags(brain.sanitize(manualLyrics)) : '';
  // Язык лирики — одно решение на всю сборку (#45): тег мозга и params.language
  // совпадают всегда (зеркало songLanguage из createMusic).
  const explicitLang = brain.detectExplicitLanguage(idea) || brain.detectExplicitLanguage(lyrics || '');
  const songLanguage = instrumental ? null
    : (explicitLang === 'ru' || explicitLang === 'en' || explicitLang === 'fr' ? explicitLang
      : (lyrics && /[\u0400-\u04FF]/.test(lyrics) ? 'ru' : 'en'));
  // Полный caption (≤ 640) — как в студии с 16.11; компактный 240 остался
  // только как legacy-путь buildTags.
  const CAPTION_BUDGET = musicBrain.rules.MAX_CAPTION;
  const build = budget => musicBrain.buildCaption(style || lyrics || '', {
    kind: instrumental ? 'instrumental' : 'song',
    language: songLanguage,
    bpm: musicBrain.detectBpm(style || lyrics || ''),
    maxTags: budget
  });
  const budgetFor = extra => Math.max(240, CAPTION_BUDGET - (extra ? extra.length + 2 : 0));
  let tags = build(CAPTION_BUDGET);
  let finalPrompt;
  let brainApplied = false;
  if (advanced && style && brain.isAsciiOnly(style)) {
    // #40 («промт только через мозг», 20.11): ASCII-строка из чат-сценария —
    // черновик наставника/продюсера/✨, она ВХОД для слоёв мозга, не замена.
    // Авторская строка (brainPending=false) не переписывается (#109).
    if (brainPending) {
      tags = build(budgetFor(style));
      finalPrompt = mergePromptTags(style, tags.tags);
      brainApplied = true;
    } else finalPrompt = style;
  }
  else if (style && !brain.isAsciiOnly(style)) {
    if (translation) tags = build(budgetFor(translation));
    finalPrompt = translation ? mergePromptTags(translation, tags.tags) : (tags.tags || style);
    brainApplied = true;
  } else if (style) {
    tags = build(budgetFor(style));
    finalPrompt = mergePromptTags(style, tags.tags);
    brainApplied = true;
  } else finalPrompt = lyrics;
  // Потолок сборки (#45): зеркало createMusic — сборка с мозгом не уезжает за 640.
  if (brainApplied) finalPrompt = capStyleLine(finalPrompt, CAPTION_BUDGET);
  const params = { model: 'ace-step-flash' };
  if (instrumental) params.instrumental = true;
  if (!instrumental && (songLanguage === 'ru' || songLanguage === 'en')) params.language = songLanguage;
  if (lyrics) params.lyrics = lyrics;
  // В POST уходит сборка (prompt), в карточку/сессию — исходная идея (input.prompt).
  const requestBase = idea || lyrics;
  const layerCount = layers => {
    if (!layers || typeof layers !== 'object') return 0;
    const some = v => Array.isArray(v) ? v.length > 0 : Boolean(v);
    let n = 0;
    if (layers.anchor && (some(layers.anchor.genre) || some(layers.anchor.era))) n++;
    if (layers.voice && (some(layers.voice.tags) || layers.voice.identityTag)) n++;
    if (layers.rhythm && (layers.rhythm.bpm || layers.rhythm.phrase || some(layers.rhythm.bass))) n++;
    if (layers.space && (some(layers.space.instruments) || some(layers.space.atmosphere) || some(layers.space.production) || some(layers.space.place))) n++;
    if (layers.depth && (some(layers.depth.tags) || layers.depth.style)) n++;
    if (layers.tail && (some(layers.tail.dynamics) || some(layers.tail.mood) || some(layers.tail.concept))) n++;
    return n;
  };
  return { postPrompt: finalPrompt, inputPrompt: requestBase, params, brainTags: tags.tags,
    brainLayers: brainApplied ? layerCount(tags.layers) : 0 };
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
assert.ok(ru.postPrompt.length <= 640, 'brain caption prompt <= 640 chars');
// Разделение полей (audits/limits/RESEARCH_PACK.md): лирика не уходит в prompt,
// секционные теги не уезжают в caption — иначе модель может спеть промт.
assert.doesNotMatch(ru.postPrompt, /\[(?:verse|chorus|intro|bridge|outro)\]/i, 'prompt без секционных тегов');
const advancedAsm = await assemble({ idea: 'dream pop, 90 BPM, female vocals', manualLyrics: '[verse]\nпервая строка песни\n[chorus]\nвторая строка', advanced: true });
assert.equal(advancedAsm.postPrompt, 'dream pop, 90 BPM, female vocals', 'авторский промт не переписан');
assert.equal(advancedAsm.brainLayers, 0, 'авторская строка — без плашки слоёв');
// (н) #40: ASCII-строка наставника из чат-сценария — вход для слоёв мозга,
// не замена: сборка содержит строку + недостающие слои, ≤ 640, плашка N слоёв.
const mentorAsm = await assemble({ idea: 'dream pop, 90 BPM, warm female vocals', advanced: true, brainPending: true });
assert.ok(mentorAsm.postPrompt.startsWith('dream pop, 90 BPM, warm female vocals'), 'строка наставника — вход (не переписана, стоит первой)');
assert.ok(mentorAsm.postPrompt.length > 'dream pop, 90 BPM, warm female vocals'.length, '#40: мозг добавил слои к строке наставника');
assert.ok(mentorAsm.postPrompt.length <= 640, 'сборка наставника ≤ 640');
assert.ok(mentorAsm.brainLayers >= 3, 'честная плашка: не меньше трёх слоёв мозга');
assert.match(mentorAsm.postPrompt, /dream pop/i, 'жанр автора сохранён');
assert.match(mentorAsm.postPrompt, /90 BPM/i, 'явный BPM автора приоритетен');
assert.ok(!advancedAsm.postPrompt.includes('первая строка'), 'лирика не попадает в prompt');
assert.match(advancedAsm.params.lyrics, /первая строка песни/, 'лирика уходит отдельным params.lyrics');
assert.doesNotMatch(advancedAsm.postPrompt, /\[/, 'в prompt нет скобочных меток');
assert.match(ru.postPrompt, /reverb|room|depth|perspective|distant/, 'глубина и стилевая атмосфера доходят до промта');
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

// (р) точность черновиков (#45): язык тега мозга = params.language — одно решение.
// Живой кейс: черновик наставника (англ. промт, без явного языка) + русская лирика
// раньше получал тег English lyrics при params.language=ru — два разных указания.
const ruLyricsAsm = await assemble({ idea: 'dream pop, warm female vocals', manualLyrics: '[Verse]\nГород спит\n[Chorus]\nА я не сплю', advanced: true, brainPending: true });
assert.match(ruLyricsAsm.postPrompt, /Russian lyrics/, 'русская лирика черновика → тег русской лирики');
assert.equal(ruLyricsAsm.params.language, 'ru', 'тег мозга и params.language совпадают (нет двух указаний)');
const enLyricsAsm = await assemble({ idea: 'dream pop, warm female vocals', manualLyrics: '[Verse]\nCity sleeps\n[Chorus]\nSo do I', advanced: true, brainPending: true });
assert.match(enLyricsAsm.postPrompt, /English lyrics/);
assert.equal(enLyricsAsm.params.language, 'en', 'английская лирика → en везде');
// (с) потолок сборки 640 (#45): длинная строка наставника + слои мозга не уезжают
// за потолок ACE-Step (пол бюджета 240 давал до 640+240; модель молча резала хвост).
// Авторская строка (~560, как реальный путь — parseMusicDraft капит промт на входе)
// сохраняется целиком, режутся только добавленные мозгом хвостовые теги.
const longLine = ('dream pop, warm shimmering pads, slow burn, ').repeat(13).replace(/,\s*$/, '').slice(0, 560);
assert.ok(longLine.length > 500 && longLine.length <= 560, 'строка наставника ~560 символов: ' + longLine.length);
const longAsm = await assemble({ idea: longLine, advanced: true, brainPending: true });
assert.ok(longAsm.postPrompt.length <= 640, `потолок сборки 640 (${longAsm.postPrompt.length})`);
assert.ok(longAsm.postPrompt.startsWith(longLine), 'строка наставника сохранена целиком — резались только теги мозга');

// (г) теги частей всегда латиницей, только теги переписываются.
assert.equal(brain.latinizeTags('[Куплет 2]\n[Припев]\n[Пред-Припев]\n[Интро]\n[Бридж]\n[Аутро]'),
  '[Verse 2]\n[Chorus]\n[Pre-Chorus]\n[Intro]\n[Bridge]\n[Outro]');
assert.equal(brain.latinizeTags('[verse]\n[chorus]\nтекст не трогаем'), '[Verse]\n[Chorus]\nтекст не трогаем');
// (н) живой кейс GLM: теги-строки в markdown — распознаются и канонизируются
// (строка-имя части на любом известном языке — тоже тег-строка: 'Припев' → [Chorus]).
assert.equal(brain.latinizeTags('[Verse]\nМой куплет\n**Chorus**\nПрипев\n**Outro**'),
  '[Verse]\nМой куплет\n[Chorus]\n[Chorus]\n[Outro]', 'markdown tag-lines (GLM) become canonical tags');
assert.equal(brain.normalizeSectionTags('__Verse 2__\n##Припев\n*Outro'), '[Verse 2]\n[Chorus]\n[Outro]',
  'bold/heading/loose-asterisk tag-lines normalize');
assert.equal(brain.normalizeSectionTags('Куплет 1\nOutro'), '[Verse 1]\n[Outro]', 'plain and numbered tag-lines normalize');
// (о) ремарки вокала в скобках — валидны для ace-step, не трогаются.
assert.equal(brain.latinizeTags('[Verse]\n[voice raw and visceral]\nСтрока (шёпотом) **не тег**'),
  '[Verse]\n[voice raw and visceral]\nСтрока (шёпотом) **не тег**',
  'vocal-direction brackets and inline markdown are preserved');
// (п) markdown-теги = структура: предупреждение «нет тегов» не выдаётся.
assert.equal(brain.structureWarnings('**Verse**\nстроки\n**Chorus**\nстроки').length, 0,
  'markdown tag-lines satisfy the scaffold check');
const bridgeWarns = brain.structureWarnings('**Bridge**\n' + 'lines');
assert.ok(bridgeWarns.some(w => /Verse/.test(w)) && bridgeWarns.some(w => /Chorus/.test(w)),
  'incomplete markdown scaffold still warns (verse/chorus missing), never auto-added');
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
// duration никуда не отправляется. Единственные допустимые вхождения в studio.js —
// чтение audio.duration и событие durationchange для таймкодов карточки (F-25,
// локальный показ); в params/запросах/именах полей duration по-прежнему нет.
assert.doesNotMatch(studioSrc.replace(/audio\.duration|durationchange/g, ''), /duration/i,
  'duration appears only as audio playback display, never in requests/params');
console.log('PASS assembly: sanitize, language rule, Latin tags, brain stage, scaffold, manual/instrumental guards');

})().catch(error => { console.error('FAIL: ' + (error?.message || error)); process.exit(1); });
