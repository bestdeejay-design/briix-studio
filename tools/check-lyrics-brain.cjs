/* Сюита лирик-мозга: экспериментальный оценщик EN (smoke, не бенчмарк
 * точности) + механики проработки лирики #48 (мелодичность/консистентность).
 * Материал: audits/lyrics/RESEARCH_PACK.md (слоги — сравнение парных фраз,
 * не вердикт о певучести; RU-текст не оценивается английскими правилами —
 * для кириллицы свой точный счёт), находка «Тысячи окон»
 * (audits/prompt-mechanics-findings.md: RU + fast = десинк — предупреждаем).
 * Тестовая лирика ниже — специально написанные строки, не тексты справок. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const scope = {};
vm.runInNewContext(fs.readFileSync('studio/lyrics-brain.js', 'utf8'), scope);
const L = scope.BRIIX_LYRICS_BRAIN;

// ---- (1) smoke оценщика EN (прежнее поведение не тронуто) ------------------
for (const [w, count] of [['stay', 1], ['little', 2], ['wanted', 2], ['tomorrow', 3]]) {
  assert.equal(L.estimateWord(w), count, w);
}
const report = L.analyze('[verse]\nTwo cups on the counter\n\n[chorus]\nStay with me');
assert.equal(report.status, 'estimated');
assert.equal(report.sections.length, 2);
assert.equal(report.sections[0].tag, 'verse');
assert.equal(report.sections[0].lines[0].estimatedSyllables, 6);
assert.equal(L.analyze('[verse]\nПривет, world').status, 'unsupported');
assert.equal(L.analyze('[verse]\nMeet me at 9').status, 'unsupported');
assert.equal(L.analyze('').sections.length, 0);

// ---- (2) русский счёт слогов: слог = гласная (точное правило) --------------
assert.equal(L.countRuSyllables('Город спит'), 3, 'Город спит = 3 слога');
assert.equal(L.countRuSyllables('Ночной эфир'), 4, 'Ночной эфир = 4 слога');
assert.equal(L.countRuSyllables('Подмосковные вечера'), 8, 'Подмосковные вечера = 8 (5+3)');
assert.equal(L.countRuSyllables('Всё тихо'), 3, 'ё — гласная: Всё тихо = 3');
assert.equal(L.countRuSyllables('ЛАМПА ГОРИТ'), 4, 'регистр не влияет: ЛАМПА ГОРИТ = 4');
assert.equal(L.countRuSyllables('Город never sleeps'), 5, 'латинские слова внутри — через EN-оценщик (2+2+1)');
assert.equal(L.countRuSyllables('До 5 утра'), 3, 'цифры слогов не дают (до=1, утра=2)');
assert.equal(L.countRuSyllables('тсс'), 1, 'безгласная строка — минимум 1 слог (не ноль)');
assert.equal(L.countEnSyllables('Two cups on the counter'), 6, 'EN-строка — прежний оценщик');

// ---- (3) профиль секций: теги, ремарки, обогащённые теги --------------------
const prof = L.syllableProfile(
  '[Intro]\n[Verse 1]\nНочной город не спит\n[voice raw and visceral]\n[Pre-Chorus: фильтр]\nБлиже\n'
  + '[Chorus: wide echo]\nНочной эфир\n[Final Chorus]\nНочной эфир громче\n[Instrumental]\n[Outro]\nТишь');
assert.equal(prof.map(s => s.tag).join('|'), 'Intro|Verse|Pre-Chorus|Chorus|Chorus|Instrumental|Outro',
  'секции: канон по базе (номера сняты), Final Chorus — тоже припев, незнакомые скобки — ремарки');
assert.ok(!prof.some(s => s.lines.some(l => /visceral|фильтр|wide echo/.test(l.text))),
  'ремарки и эффекты тегов не считаются строками песни');
assert.equal(prof.find(s => s.tag === 'Verse').lines[0].syllables, 6, 'Ночной город не спит = 6 слогов (RU-счёт)');
assert.equal(prof.find(s => s.tag === 'Chorus').lines[0].counter, 'ru', 'счётчик ru у кириллицы');
assert.equal(prof.find(s => s.tag === 'Chorus').final, false, 'обычный припев не финальный');
assert.equal(prof.filter(s => s.tag === 'Chorus')[1].final, true, 'Final Chorus помечен финальным');
assert.equal(prof.find(s => s.tag === 'Instrumental').lines.length, 0, 'пустая секция — без строк');
const implicit = L.syllableProfile('Просто строка без тегов\nЕщё строка');
assert.equal(implicit.length, 1, 'текст до тегов — безымянная секция');
assert.equal(implicit[0].lines.length, 2, 'строки безымянной секции посчитаны');

// ---- (4) десинк-гарда RU + fast (находка «Тысячи окон») --------------------
const ruFast = '[Verse 1]\nГород спит и фонари гаснут\n[Chorus]\nА я не сплю\n[Verse 2]\nГород спит и фонари гаснут\n[Chorus]\nА я не сплю';
const desync = L.singability(ruFast, { bpm: 170 });
assert.ok(desync.warnings.some(w => /170 BPM/.test(w) && /десинк|разъедется/.test(w)),
  'RU + 170 BPM — предупреждение десинка до генерации (не молчим)');
assert.ok(L.singability(ruFast, { bpm: 120 }).warnings.length === 0, 'RU + 120 BPM — спокойно');
assert.ok(L.singability(ruFast, { bpm: 150 }).warnings.some(w => /150 BPM/), 'порог десинка — 150 BPM (находка: ≥~150)');
assert.ok(!L.singability('[Verse 1]\nCity sleeps at night\n[Chorus]\nSo do I', { bpm: 170 }).warnings.some(w => /BPM/),
  'EN + 170 BPM — десинк-гарда не срабатывает');
assert.ok(L.singability(ruFast).warnings.length === 0, 'RU без явного темпа — не паникуем (ничего не выдумываем)');

// ---- (5) повторяемость припевов: дословный повтор = устойчивый хук ---------
const driftChorus = '[Verse 1]\nстрока один\n[Chorus]\nПрипев с ветром\n[Verse 2]\nстрока два\n[Chorus]\nПрипев с дождём';
const drift = L.singability(driftChorus);
assert.ok(drift.warnings.some(w => /Припевы различаются/.test(w)), 'разные припевы — предупреждение хука');
const sameChorus = driftChorus.replace('Припев с дождём', 'Припев с ветром');
assert.ok(!L.singability(sameChorus).warnings.some(w => /Припевы различаются/), 'одинаковые припевы — молчим');
const liftOk = '[Verse 1]\nстрока один\n[Chorus]\nПрипев с ветром\n[Verse 2]\nстрока два\n[Chorus]\nПрипев с ветром\n[Bridge]\nмост\n[Final Chorus]\nПрипев с ветром и громче';
assert.ok(!L.singability(liftOk).warnings.some(w => /Припевы различаются/),
  'финальный припев с усилением — нормальный приём, не предупреждение');
const hookPair = '[Verse 1]\nстрока\n[Hook]\nХук один\n[Verse 2]\nстрока\n[Hook]\nХук другой';
assert.ok(L.singability(hookPair).warnings.some(w => /Припевы различаются/), '[Hook] проверяется как припев');
assert.ok(!L.singability('[Verse 1]\nстрока\n[Chorus]\nединственный припев').warnings.some(w => /Припевы/),
  'один припев — сравнивать не с чем, молчим');

// ---- (6) парность куплетов: число строк и слоговая длина парных строк ------
const uneven = '[Verse 1]\nодин\nдва\nтри\n[Chorus]\nприпев\n[Verse 2]\nодин\nдва';
assert.ok(L.singability(uneven).warnings.some(w => /Куплет 2 — 2 строки против 3/), 'разное число строк — предупреждение');
const shortV1 = '[Verse 1]\nНочной город\n[Chorus]\nприпев\n[Verse 2]\nГород';
const longLine = '[Verse 1]\nНочной город не спит и фонари гаснут\n[Chorus]\nприпев\n[Verse 2]\nТишь';
assert.ok(L.singability(longLine).warnings.some(w => /Куплет 2, строка 1: 1 слог против 12/),
  'грубая дельта слогов парных строк — предупреждение с числами (12 против 1)');
assert.ok(!L.singability(shortV1).warnings.some(w => /слогов против/), 'дельта 2 слога — в пределах нормы (порог 4)');
const balanced = '[Verse 1]\nНочной город не спит\nФонари гаснут к утру\n[Chorus]\nНочной эфир\n[Verse 2]\nУтренний поезд идёт\nВетки бьют в окна в такт\n[Chorus]\nНочной эфир';
assert.equal(L.singability(balanced).warnings.length, 0, 'ровные парные куплеты + дословный припев — тишина');
// EN-оценка в парности: дельта считается и по английским строкам.
const enVerse = '[Verse 1]\nCity lights are calling low tonight\n[Chorus]\nStay\n[Verse 2]\nStay\n[Chorus]\nStay';
assert.ok(L.singability(enVerse).warnings.some(w => /слогов против/), 'EN-строки участвуют в парности (оценка)');

// ---- (7) мягкость: ничего не меняется и не блокируется ---------------------
const before = driftChorus;
const after = L.singability(before, { bpm: 175 });
assert.equal(after.lyrics, undefined, 'singability не возвращает «исправленную» лирику — только диагностику');
assert.equal(after.bpm, 175, 'BPM виден в отчёте');
assert.equal(after.message.includes('не вердикт'), true, 'честная формулировка: не вердикт о певучести');
assert.equal(L.rules.DESYNC_BPM, 150, 'порог десинка зафиксирован в правилах');
assert.equal(L.rules.VERSE_SYLLABLE_DELTA, 4, 'порог грубой дельты зафиксирован');
assert.equal(L.VERSION, '2026-11-23-lyrics-1', 'версия лирик-мозга');
console.log('PASS lyrics-brain: EN smoke + RU-слоги, профиль секций, десинк-гарда, хук, парность куплетов');
