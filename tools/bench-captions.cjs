/* Бенчмарк фазы 2 (issue #20, §7): caption'ы «его мозг vs мой альбом».
 *
 * Для каждого из 12 треков референс-альбома VELVET STATIC:
 *   A = промт владельца (VOCAL-CONST + SONIC-CONST + строка трека) — эталон;
 *   B = VOCAL-CONST + caption, собранный buildCaption v2 из РУССКОЙ задумки.
 *
 * Правила честности (REVIEWER_KICK, ловушка 5):
 *   - VOCAL-блок у A и B одинаковый (единый исполнитель), иначе сравнение грязное;
 *   - в B нет ни одной английской формулировки владельца: вход — только ruBrief,
 *     собранный мной по СМЫСЛУ лирики;
 *   - бюджеты одинаковые по духу: A ≈ 780 симв., B ≈ VOCAL-CONST + ≤640.
 *
 * Выход: bench/prompts-12.json (для tools/bench-ab.cjs) + markdown-таблица
 * сравнения в stdout (её я переношу в audits/brain-v2/BENCH-PROMPTS.md).
 *
 * Запуск: node tools/bench-captions.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const scope = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'studio/music-brain.js'), 'utf8'), scope);
const brain = scope.BRIIX_MUSIC_BRAIN;

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench/briefs-12.json'), 'utf8'));

const rows = spec.tracks.map(t => {
  const bpm = brain.detectBpm(t.ruBrief) || brain.detectBpm(t.bpm + ' BPM');
  const built = brain.buildCaption(t.ruBrief, {
    kind: 'song',
    language: 'en',
    bpm: t.bpm,
    // Единый исполнитель: вокальный слой не дублируем, он зафиксирован VOCAL-CONST.
    skipBlocks: ['voice.gender', 'voice.character'],
    maxTags: brain.rules.MAX_CAPTION
  });
  // «English lyrics» — служебный тег языка, при бенчмарке он не нужен: лирика и так
  // английская и указана отдельным полем.
  const body = built.caption.replace(/, English lyrics/g, '').replace(/English lyrics, /g, '');
  const captionB = (spec.vocalConst + ', ' + body.replace(new RegExp('^' + t.bpm + ' BPM, '), '')).trim();
  // A = полная строка владельца: консты ПОДСТАВЛЯЮТСЯ, а не остаются именами.
  // Раньше здесь стояли литералы 'VOCAL-CONST, SONIC-CONST' — A уезжал в
  // генерацию как обрубок в 120–190 символов, и сравнение было бы фальшивым.
  const captionA = [spec.vocalConst, spec.sonicConst, t.referenceTrackLine].join(', ');
  return {
    track: t.id,
    title: t.title,
    bpm: t.bpm,
    briefRu: t.ruBrief,
    promptA: captionA,
    promptB: captionB,
    layersB: {
      rhythm: built.layers.rhythm.phrase,
      bpm: built.layers.rhythm.bpm,
      bass: built.layers.rhythm.bass,
      instruments: built.layers.space.instruments,
      production: built.layers.space.production,
      atmosphere: built.layers.space.atmosphere,
      dynamics: built.layers.tail.dynamics,
      mood: built.layers.tail.mood,
      concept: built.layers.tail.concept
    },
    lengths: { a: captionA.length, b: captionB.length },
    // Самопроверка считается по ФАКТИЧЕСКОМУ caption B (VOCAL-CONST + слои мозга):
    // голос в нём есть, просто он зафиксирован единым блоком.
    selfCheck: brain.selfCheck(captionB, built.layers)
  };
});

// Инварианты артефакта: их отсутствие уже один раз пропустило обрубленный A
// (см. tools/check-bench.cjs — теперь это проверяется в CI).
for (const r of rows) {
  for (const [k, v] of [['A', r.promptA], ['B', r.promptB]]) {
    if (/VOCAL-CONST|SONIC-CONST/.test(v)) throw new Error(`${r.track}: ${k} содержит плейсхолдер конста`);
    if (!v.includes(spec.vocalConst)) throw new Error(`${r.track}: ${k} не содержит VOCAL-CONST целиком`);
  }
}
const out = { vocalConst: spec.vocalConst, sonicConst: spec.sonicConst, tracks: rows };
fs.mkdirSync(path.join(ROOT, 'bench'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'bench/prompts-12.json'), JSON.stringify(out, null, 2) + '\n');

console.log('# Сравнение caption: A (владелец) vs B (мозг v2)\n');
console.log('| # | Трек | A, симв. | B, симв. | Ритм-слой B | Продакшн B | Самопроверка B |');
console.log('|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.track} | ${r.title} | ${r.lengths.a} | ${r.lengths.b} | ${r.layersB.rhythm} | ${r.layersB.production.join(', ')} | ${r.selfCheck.ok ? 'ok' : r.selfCheck.missing.join(', ')} |`);
}
console.log('\n## Полные строки\n');
for (const r of rows) {
  console.log(`### ${r.track}. ${r.title} (${r.bpm} BPM)`);
  console.log('A: ' + r.promptA);
  console.log('B: ' + r.promptB + '\n');
}
console.log('bench/prompts-12.json записан.');
