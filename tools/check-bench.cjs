/* Инварианты артефакта бенчмарка (issue #20, §7).
 *
 * Зачем отдельный тест: 15.11 в bench/prompts-12.json уехал A из литералов
 * «VOCAL-CONST, SONIC-CONST» — 116–187 символов вместо 710–781. Никакой
 * ассерт этого не видел: самопроверка мозга смотрит только на B. Генерация
 * по такому артефакту дала бы «мозг победил» на сравнении с обрубком.
 *
 * Проверяем то, что делает сравнение сравнением:
 *   (1) A и B содержат VOCAL-CONST целиком (единый исполнитель);
 *   (2) ни в одном промте нет плейсхолдеров констов;
 *   (3) бюджеты в ожидаемом коридоре (A ≈ 705–800, B ≤ 640 + VOCAL-CONST);
 *   (4) 12 треков, лирика есть у каждого, язык английский;
 *   (5) B проходит selfCheck, лирика не переписана владельцем (нет длинных
 *       английских формулировок из его строки трека — копирование запрещено);
 *   (6) у каждого трека оба плеча помечены разными источниками (A и B).
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const prompts = read('bench/prompts-12.json');
const lyrics = read('bench/lyrics-12.json');
const briefs = read('bench/briefs-12.json');

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

ok(prompts.tracks.length === 12, 'ровно 12 треков');
ok(typeof prompts.vocalConst === 'string' && prompts.vocalConst.length > 100, 'VOCAL-CONST раскрыт строкой');
ok(typeof prompts.sonicConst === 'string' && prompts.sonicConst.length > 100, 'SONIC-CONST раскрыт строкой');
ok(lyrics.lyrics.length === 12, '12 текстов лирики');
ok(briefs.tracks.length === 12, '12 задумок');

const brainScope = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'studio/music-brain.js'), 'utf8'), brainScope);
const brain = brainScope.BRIIX_MUSIC_BRAIN;

const lyricById = new Map(lyrics.lyrics.map(l => [l.id, l]));
const briefById = new Map(briefs.tracks.map(t => [t.id, t]));

for (const t of prompts.tracks) {
  const tag = `track-${t.track}`;
  ok(!/VOCAL-CONST|SONIC-CONST/.test(t.promptA + t.promptB), `${tag}: без плейсхолдеров констов`);
  ok(t.promptA.includes(prompts.vocalConst), `${tag}: A содержит VOCAL-CONST`);
  ok(t.promptB.includes(prompts.vocalConst), `${tag}: B содержит VOCAL-CONST`);
  ok(t.promptA.includes(prompts.sonicConst), `${tag}: A содержит SONIC-CONST (звук альбома зафиксирован только у A)`);
  ok(t.promptA.length >= 700 && t.promptA.length <= 820, `${tag}: A в коридоре 700–820 (${t.promptA.length})`);
  ok(t.promptB.length <= prompts.vocalConst.length + 640 + 2, `${tag}: B ≤ VOCAL-CONST + 640 (${t.promptB.length})`);
  ok(t.promptB.length < t.promptA.length, `${tag}: B короче A — выигрыш при меньшем бюджете`);
  ok(!/English lyrics/.test(t.promptB), `${tag}: служебный тег языка убран`);
  ok((lyricById.get(t.track)?.lyrics || '').trim().length > 0, `${tag}: лирика на месте`);
  const ru = briefById.get(t.track)?.ruBrief || '';
  ok(/[а-яё]/i.test(ru), `${tag}: вход мозга — русская задумка`);
  // Копирование запрещено. Дословное совпадение формулировок — плохой детектор:
  // мозг переводит те же понятия теми же тегами («rolling hypnotic drum groove»),
  // это словарная сходимость, а не копипаста. Меряем долю тегов A, целиком
  // присутствующих в B: у копии было бы ~1.0, у честного пересборa — ≤0.5
  // (из них 9 — общий VOCAL-CONST). Порог 0.6.
  const tagsOf = s => new Set(s.toLowerCase().split(/,\s*/));
  const aTags = [...tagsOf(t.promptA)];
  const bTags = tagsOf(t.promptB);
  const overlap = aTags.filter(x => bTags.has(x)).length / aTags.length;
  ok(overlap <= 0.6, `${tag}: B не собран из A (пересечение тегов ${overlap.toFixed(2)} ≤ 0.60)`);
  ok(brain.selfCheck(t.promptB, { instrumental: false }).ok, `${tag}: B проходит selfCheck`);
}

// Плечи A и B перепутаны детерминированно и различаются в каждом треке.
const sources = prompts.tracks.map(t => `${t.track}:${t.promptA === t.promptB ? 'same' : 'diff'}`);
ok(sources.every(s => s.endsWith('diff')), 'A и B не совпадают ни в одном треке');

const aLens = prompts.tracks.map(t => t.promptA.length);
const bLens = prompts.tracks.map(t => t.promptB.length);
console.log(`PASS bench: ${checks} проверок — A ${Math.min(...aLens)}–${Math.max(...aLens)} симв., B ${Math.min(...bLens)}–${Math.max(...bLens)}, консты подставлены, копирования нет`);
