/* Smoke tests for the experimental estimator, not an accuracy benchmark. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const scope = {};
vm.runInNewContext(fs.readFileSync('studio/lyrics-brain.js', 'utf8'), scope);
const L = scope.BRIIX_LYRICS_BRAIN;
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
console.log('PASS lyrics-brain experimental smoke tests');
