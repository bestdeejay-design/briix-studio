/* Diagnostic only: hand-curated words are not a representative benchmark. */
const fs = require('node:fs');
const vm = require('node:vm');
const scope = {};
vm.runInNewContext(fs.readFileSync('studio/lyrics-brain.js', 'utf8'), scope);
const estimate = scope.BRIIX_LYRICS_BRAIN.estimateWord;
const cases = [
  ['stay', 1], ['little', 2], ['wanted', 2], ['tomorrow', 3],
  ['beautiful', 3], ['every', 2], ['family', 3], ['different', 3],
  ['chocolate', 2], ['fire', 1], ['hour', 1], ['poem', 2],
  ['people', 2], ['queue', 1], ['rhythm', 2], ['business', 2],
  ['island', 2], ['walked', 1], ['watches', 2],
];
let exact = 0;
let absoluteError = 0;
const rows = cases.map(([word, expected]) => {
  const actual = estimate(word);
  const error = Math.abs(actual - expected);
  exact += error === 0 ? 1 : 0;
  absoluteError += error;
  return { word, expected, actual, error };
});
console.table(rows);
console.log(`Diagnostic only: exact ${exact}/${cases.length}; MAE ${(absoluteError / cases.length).toFixed(3)} syllables.`);
console.log('This small hand-curated set is not representative and is not evidence of singability.');
