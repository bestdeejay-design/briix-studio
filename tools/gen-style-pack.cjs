/* Генератор стилевого пакета #45: audits/style-research/ → словари мозга.
 *
 * Ресёрч-пакет (116 семейств из dj1-архива) кодируется в brain по карте из
 * README ресёрча. Руками блок не правится — перегенерация целиком:
 *
 *   node tools/gen-style-pack.cjs          # записать блоки в оба мозга
 *   node tools/gen-style-pack.cjs --check  # только сверить свежесть (CI-стиль)
 *
 * Что делает:
 *   - читает index.json (машиночитаемый пакет) + families/*.md (там живёт
 *     сплит atmosphere на devices/depth, которого нет в index.json);
 *   - применяет кодировочные правки (см. FIXES ниже — каждая с причиной);
 *   - валидирует пакет по тем же правилам, что и check-music-brain
 *     (правило 0 владельца, запрет противоречий, ASCII, полнота осей);
 *   - перезаписывает маркированные блоки в studio/music-brain.js (слияние в
 *     боевые словари) и studio/producer-brain.js (список семейств наставника).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACK_DIR = path.join(ROOT, 'audits/style-research');
const BRAIN = path.join(ROOT, 'studio/music-brain.js');
const PRODUCER = path.join(ROOT, 'studio/producer-brain.js');
const BEGIN = '// ==== BEGIN STYLE PACK (#45) ====';
const END = '// ==== END STYLE PACK (#45) ====';

/* Кодировочные правки ресёрча → кода. Каждая честно объяснена: это решения
 * кодировщика, а не правка данных. Дублируются валидацией ниже. */
const MD_NAME_MAP = { // .md-заголовок → канонический ключ семейства index.json
  'latin pop': 'latin', 'celtic folk': 'celtic', 'gregorian chant': 'gregorian'
};
const DROP_RU = { // ложные срабатывания подстрокой (shortStem: кириллица >3 симв.)
  'ария': 'внутри «Мария» — частая тема песни, а не опера',
  'марш': 'внутри «маршрут» — ложный жанр march',
  'ска': 'в начале «сказка/скала/скамейка» — ложный жанр ska (граница только слева)'
};
const REPLACE_RU = { 'опера': 'оперн' }; // «операция» ловится подстрокой; стем «оперн» чист
const DROP_EN = {
  'nü metal': 'не-ASCII ключ',
  'fusion': 'подстрока внутри «confusion» — остаётся «jazz fusion»'
};
const TIMBRE_FILL = { // 3 семейства пришли без тембра; стем по жанровой практике
  'post-punk': 'thick midrange timbre',
  'gothic rock': 'warm timbre',
  'opera': 'bright timbre'
};
const GUARDS = {
  'no male growl, staying in her register': 'GUARD_FEMALE',
  'chest register throughout, no falsetto': 'GUARD_MALE',
  'staying in the basement throughout, no falsetto and no high-pitched screaming ever': 'GUARD_LOW_MALE',
  'no growl, choral register throughout': 'GUARD_CHOIR'
};
// «goa trance» числится алиасом и trance, и psytrance; детерминизм: точное
// совпадение с именем семьи побеждает (psytrance), остальные споры — первый
// пакет (batch 0) в порядке индекса.
const SHARED_ALIAS_RULE = 'name-match-wins-then-index-order';

const EXISTING26 = new Set(['psychedelic soul', 'soul', 'funk', 'dream pop', 'pop', 'rock', 'techno', 'tech house',
  'house', 'trap', 'rap', 'hip-hop', 'lo-fi', 'ambient', 'cinematic', 'orchestral', 'jazz', 'ballad', 'edm',
  'synthwave', 'trip-hop', 'r&b', 'folk', 'heavy metal', 'eurodance', 'drum and bass']);
const BRACKET_GROUP_SET = new Set(['club', 'synth', 'urban', 'band', 'mellow', 'groove', 'acoustic', 'score']);
const CONTA_PAIRS = [
  [/(?:hoarse rasp|gravel|rough texture|growl|screamo|scream|shout|rasp|gritty|aggressive)/i,
   /(?:smooth|clean tone|velvet|polished|soft|tender|delicate)/i],
  [/(?:growl|screamo|scream|shout|gritty|aggressive|powerful belting|full-voice)/i,
   /(?:breathy|whisper|half-whisper|intimate|soft|tender|fragile)/i]
];
const RULE0 = /(?<![\w-])(?:thin|light|breathy)(?![\w-])|high(?:-|\s)tenor|falsetto/i;
const isAscii = s => /^[\t\n\r\x20-\x7E]*$/.test(s);
const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const fail = msg => { console.error('gen-style-pack: ' + msg); process.exit(1); };

// ---- 1. Чтение пакета -------------------------------------------------------
const index = JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'index.json'), 'utf8'));
if (!Array.isArray(index.families) || index.count !== index.families.length) fail('index.json бит (count≠families)');
const byName = new Map();
for (const f of index.families) {
  if (EXISTING26.has(f.family)) fail('семейство «' + f.family + '» уже есть в базовых 26');
  if (byName.has(f.family)) fail('дубль семейства «' + f.family + '»');
  byName.set(f.family, f);
}
// devices/depth — только из .md (в index.json сплит потерян, у 5 семей пусто).
const mdAtmo = new Map();
for (const file of fs.readdirSync(path.join(PACK_DIR, 'families')).sort()) {
  if (!/\.md$/.test(file)) continue;
  const text = fs.readFileSync(path.join(PACK_DIR, 'families', file), 'utf8');
  const name = (text.match(/^# \d+\. (.+?) \//m) || [])[1];
  const atmo = text.match(/## STYLE_ATMOSPHERE[^\n]*\n- devices: (.*?)\n- depth: (.*?)\n/s);
  if (!name || !atmo) fail('не разобран ' + file);
  const split = s => s.split('`, `').map(t => t.replace(/[`\s]+$/g, '').replace(/^`/, '')).filter(Boolean);
  const key = MD_NAME_MAP[name.toLowerCase()] || name.toLowerCase();
  mdAtmo.set(key, { devices: split(atmo[1]), depth: split(atmo[2]) });
}

// ---- 2. Кодирование + правки ------------------------------------------------
const rhythm = {}, production = {}, atmosphere = {}, vocal = {}, brackets = {};
// Жанровые ключи — один ключ = одно семейство (споры решает то же правило,
// что и алиасы: точное совпадение с именем семьи, затем порядок индекса).
// Иначе два «psytrance» (от trance и от psytrance) в scan() убивают друг друга
// хитом-в-хите с одинаковым спаном.
const genreClaims = new Map();
const aliases = {};
const aliasClaims = new Map(); // alias → [family,…] для детерминизма споров
const claim = (map, key, fam) => { if (!map.has(key)) map.set(key, []); map.get(key).push(fam); };
const resolveClaims = map => {
  const out = {};
  for (const [key, claims] of map) {
    const uniq = [...new Set(claims)];
    if (uniq.length === 1) { out[key] = uniq[0]; continue; }
    const exact = uniq.find(c => c === key);
    out[key] = exact || uniq[0];
  }
  return out;
};
const genreKeys = new Map(); // ru-стемы и en-ключи вместе, разъезжаются только при выводе
for (const f of index.families) {
  const fam = f.family;
  const atmo = mdAtmo.get(fam) || fail('нет .md-атмосферы для «' + fam + '»');
  // rhythm: [char, groove, kit] — формат L2 справки
  if (f.rhythm.length !== 3) fail('«' + fam + '»: rhythm ≠ 3 элементов');
  rhythm[fam] = { char: f.rhythm[0].replace(/ü/g, 'u'), groove: f.rhythm[1].replace(/ü/g, 'u'), kit: f.rhythm[2].replace(/ü/g, 'u') };
  if (f.production.length < 1) fail('«' + fam + '»: пустой production');
  production[fam] = f.production.map(s => s.replace(/ü/g, 'u'));
  if (atmo.devices.length < 2 || atmo.depth.length < 2) fail('«' + fam + '»: атмосфера мала');
  atmosphere[fam] = { devices: atmo.devices.map(s => s.replace(/ü/g, 'u')), depth: atmo.depth.map(s => s.replace(/ü/g, 'u')) };
  // голос: оси + guard-константа + mood
  const v = f.vocal, axes = {};
  for (const axis of ['who', 'register', 'timbre', 'power', 'technique', 'character', 'processing']) {
    const vals = (v[axis] || []).map(s => s.replace(/ü/g, 'u')).filter(Boolean);
    if (vals.length) axes[axis] = vals;
  }
  if (TIMBRE_FILL[fam]) axes.timbre = (axes.timbre || []).concat([TIMBRE_FILL[fam]]);
  const guard = GUARDS[v.guard] || fail('«' + fam + '»: незнакомый guard «' + v.guard + '»');
  if (!v.mood) fail('«' + fam + '»: нет mood');
  vocal[fam] = Object.assign(axes, { guard: [guard], mood: v.mood });
  if (!BRACKET_GROUP_SET.has(f.brackets_group)) fail('«' + fam + '»: нет группы брекетов ' + f.brackets_group);
  brackets[fam] = f.brackets_group;
  // алиасы: RU-стемы + EN-ключи; каждая правка — из FIXES выше
  for (const ru of f.aliases_ru || []) {
    if (DROP_RU[ru]) continue;
    claim(genreKeys, REPLACE_RU[ru] || ru, fam);
  }
  for (const en of f.aliases_en || []) {
    if (DROP_EN[en]) continue;
    const key = en.replace(/ü/g, 'u');
    claim(genreKeys, key, fam);
    claim(aliasClaims, key, fam);
  }
}
const genreResolved = resolveClaims(genreKeys);
// семейство резолвится и самим именем ( STYLE_ALIASES['uk garage'] = 'uk garage' )
const aliasResolved = resolveClaims(aliasClaims);
for (const fam of byName.keys()) if (!aliasResolved[fam]) aliasResolved[fam] = fam;
Object.assign(aliases, aliasResolved);
// базовые GENRE_WORDS: дубль «ключ+тот же тег» не дублируем, конфликт тега — стоп
const baseGenre = new Map();
const baseSrc = fs.readFileSync(BRAIN, 'utf8');
const baseSection = baseSrc.slice(baseSrc.indexOf('const GENRE_WORDS'), baseSrc.indexOf('const FORM_GENRE'));
for (const [, key, tag] of baseSection.matchAll(/\['([^']+)', '([^']+)'\]/g)) {
  if (baseGenre.has(key) && baseGenre.get(key) !== tag) fail('базовый GENRE_WORDS уже конфликтует по ключу «' + key + '» — почисти руками до генерации');
  baseGenre.set(key, tag);
}
const genreWords = Object.entries(genreResolved)
  .filter(([key, fam]) => {
    if (!baseGenre.has(key)) return true;
    if (baseGenre.get(key) !== fam) fail('ключ «' + key + '» в базе ведёт к «' + baseGenre.get(key) + '», пакет — к «' + fam + '»: убери базовую запись (README #45, «удалить старые алиасы»)');
    return false; // дубль ключ+тег — не нужен
  });

// ---- 3. Валидация по правилам тестов ----------------------------------------
for (const [fam, p] of Object.entries(vocal)) {
  for (const axis of ['who', 'timbre', 'power']) if (!(p[axis] || []).length) fail('«' + fam + '»: пустая ось ' + axis);
  const tokens = Object.keys(p).filter(k => k !== 'mood' && k !== 'guard').flatMap(k => p[k]);
  for (const t of tokens) {
    if (!isAscii(t)) fail('«' + fam + '»: не-ASCII токен «' + t + '»');
    const isMale = (p.who || []).some(w => /male|man|boy(?!ish female)/i.test(w)) && !(p.who || []).some(w => /female|girl|choir/i.test(w));
    if (isMale && RULE0.test(t)) fail('«' + fam + '»: правило 0 нарушено («' + t + '»)');
  }
  for (const [rough, soft] of CONTA_PAIRS) for (const t of tokens) {
    const others = tokens.filter(o => o !== t).join(' ');
    if (rough.test(t) && soft.test(others)) fail('«' + fam + '»: противоречие профиля («' + t + '»)');
  }
}
for (const [fam, a] of Object.entries(atmosphere)) {
  for (const t of [...a.devices, ...a.depth]) if (!isAscii(t)) fail('«' + fam + '»: не-ASCII атмосферa «' + t + '»');
}
for (const [fam, r] of Object.entries(rhythm)) for (const t of [r.char, r.groove, r.kit]) {
  if (!isAscii(t)) fail('«' + fam + '»: не-ASCII ритм «' + t + '»');
  void t;
}
for (const [k, v] of genreWords) {
  if (!isAscii(v)) fail('не-ASCII тег жанра «' + v + '»');
  if (!byName.has(v)) fail('жанровый тег «' + v + '» не является семейством пакета');
  void k;
}
const packCount = byName.size;
if (packCount !== 116) fail('ожидалось 116 семейств, вышло ' + packCount);

// ---- 4. Генерация блока ------------------------------------------------------
const lines = [];
lines.push('  ' + BEGIN);
lines.push('  /* Сгенерировано tools/gen-style-pack.cjs из audits/style-research —');
lines.push('   * не редактировать руками (перегенерация перезапишет). Правки данных —');
lines.push('   * только в генераторе (карта правок с причинами) или в ресэрче. */');
lines.push('  const STYLE_PACK = {');
lines.push('    families: [' + [...byName.keys()].map(q).join(', ') + '],');
lines.push('    genreWords: [');
for (let i = 0; i < genreWords.length; i += 3) {
  lines.push('      ' + genreWords.slice(i, i + 3).map(([k, v]) => '[' + q(k) + ', ' + q(v) + ']').join(', ') + (i + 3 < genreWords.length ? ',' : ''));
}
lines.push('    ],');
lines.push('    aliases: {');
const aliasEntries = Object.entries(aliases);
for (let i = 0; i < aliasEntries.length; i += 4) {
  lines.push('      ' + aliasEntries.slice(i, i + 4).map(([k, v]) => q(k) + ': ' + q(v)).join(', ') + (i + 4 < aliasEntries.length ? ',' : ''));
}
lines.push('    },');
lines.push('    rhythm: {');
for (const [fam, r] of Object.entries(rhythm)) lines.push('      ' + q(fam) + ': { char: ' + q(r.char) + ', groove: ' + q(r.groove) + ', kit: ' + q(r.kit) + ' },');
lines.push('    },');
lines.push('    production: {');
for (let i = 0; i < Object.keys(production).length; i += 2) {
  const chunk = Object.entries(production).slice(i, i + 2);
  lines.push('      ' + chunk.map(([fam, p]) => q(fam) + ': [' + p.map(q).join(', ') + ']').join(', ') + (i + 2 < Object.keys(production).length ? ',' : ''));
}
lines.push('    },');
lines.push('    atmosphere: {');
for (const [fam, a] of Object.entries(atmosphere)) {
  lines.push('      ' + q(fam) + ': { devices: [' + a.devices.map(q).join(', ') + '],');
  lines.push('        depth: [' + a.depth.map(q).join(', ') + '] },');
}
lines.push('    },');
lines.push('    vocal: {');
for (const [fam, p] of Object.entries(vocal)) {
  const axis = Object.keys(p).filter(k => k !== 'guard' && k !== 'mood')
    .map(k => k + ': [' + p[k].map(q).join(', ') + ']');
  lines.push('      ' + q(fam) + ': { ' + axis.join(', ') + (axis.length ? ', ' : '') + 'guard: [' + p.guard[0] + '], mood: ' + q(p.mood) + ' },');
}
lines.push('    },');
lines.push('    brackets: {');
const bracketEntries = Object.entries(brackets);
for (let i = 0; i < bracketEntries.length; i += 6) {
  lines.push('      ' + bracketEntries.slice(i, i + 6).map(([k, v]) => q(k) + ': ' + q(v)).join(', ') + (i + 6 < bracketEntries.length ? ',' : ''));
}
lines.push('    }');
lines.push('  };');
lines.push('  // Слияние с боевыми словарями 26 семей: данные ресёрча — отдельно от логики.');
lines.push('  GENRE_WORDS.push(...STYLE_PACK.genreWords);');
lines.push('  Object.assign(STYLE_ALIASES, STYLE_PACK.aliases);');
lines.push('  Object.assign(RHYTHM_BY_GENRE, STYLE_PACK.rhythm);');
lines.push('  Object.assign(PROD_BY_GENRE, STYLE_PACK.production);');
lines.push('  Object.assign(STYLE_ATMOSPHERE, STYLE_PACK.atmosphere);');
lines.push('  Object.assign(VOCAL_PROFILES, STYLE_PACK.vocal);');
lines.push('  Object.assign(BRACKET_GROUPS, STYLE_PACK.brackets);');
lines.push('  ' + END);
const block = lines.join('\n');

// ---- 5. Запись/проверка music-brain.js ---------------------------------------
function splice(content, block, where) {
  const marker = content.indexOf(BEGIN), end = content.indexOf(END);
  if (marker >= 0 && end > marker) {
    // начало СТРОКИ маркера: блок в файле с отступом, без этого каждая
    // перегенерация наращивала бы по два пробела
    const begin = content.lastIndexOf('\n', marker) + 1;
    return content.slice(0, begin) + block + content.slice(end + END.length);
  }
  return content.replace(where, match => '\n' + block + '\n' + match);
}
const brainSrc = fs.readFileSync(BRAIN, 'utf8');
if (!/const VERSION = /.test(brainSrc)) fail('music-brain.js: не найдена точка вставки (VERSION)');
const newBrain = splice(brainSrc, block, /\n  const VERSION = [^\n]*;/);
const prodSrc = fs.readFileSync(PRODUCER, 'utf8');
if (!/\n  function normalizeStyle/.test(prodSrc)) fail('producer-brain.js: не найдена точка вставки (normalizeStyle)');
const prodBlock = [
  '  ' + BEGIN,
  '  /* Сгенерировано tools/gen-style-pack.cjs (см. music-brain.js): полный',
  '   * список семейств стиля — базовые 26 + 116 из ресёрча #45. Паритет с',
  '   * STYLE_ATMOSPHERE мозга проверяет check-music-brain (секция 14). */',
  '  STYLE_FAMILIES.push(...[' + [...byName.keys()].map(q).join(', ') + ']);',
  '  ' + END
].join('\n');
const newProd = splice(prodSrc, prodBlock, /\n  function normalizeStyle/);

if (process.argv.includes('--check')) {
  if (newBrain !== brainSrc || newProd !== prodSrc) fail('блоки.style pack устарели — перегенерируй: node tools/gen-style-pack.cjs');
  console.log('PASS style pack свежий (' + packCount + ' семейств, ' + genreWords.length + ' жанровых ключей, ' + Object.keys(aliases).length + ' алиасов)');
  process.exit(0);
}
fs.writeFileSync(BRAIN, newBrain);
fs.writeFileSync(PRODUCER, newProd);
console.log('OK style pack записан: ' + packCount + ' семейств → music-brain.js (' + block.split('\n').length + ' строк) и producer-brain.js');
