/* T-35: версионирование ассетов по контент-хэшу вместо ручных ?v=...
 *
 * Раньше версии в index.html были рассинхронизированы (?v=20261115, ?v=20261114-agent-b-1,
 * ?v=20261114-peaks-1) — при ошибке легко подать несовместимую пару studio.js/waveform.js
 * из кэша. Теперь ?v= — первые 10 символов sha256 содержимого файла, и CI проверяет
 * соответствие на каждом пушe.
 *
 *   node tools/asset-versions.cjs          — проверка (exit 1 при рассинхроне)
 *   node tools/asset-versions.cjs --fix    — перезаписать версии в index.html и wait-ui.js
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'studio', 'index.html');
const WAIT_UI = path.join(ROOT, 'studio', 'wait-ui.js');

function versionOf(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
}

// Ссылки в index.html: <script defer src="./x.js?v=...">, <link href="x.css?v=...">,
// <link rel=preload href="x.js?v=...">. Относительные — от studio/.
function indexRefs(html) {
  const refs = [];
  const re = /(?:src|href)="(\.\/)?([^"?]+)\?v=([0-9a-zA-Z._-]+)"/g;
  let m;
  while ((m = re.exec(html))) refs.push({ raw: m[0], file: m[2], version: m[3] });
  return refs;
}

// Ссылка на словарь фраз внутри wait-ui.js (ленивая загрузка, T-35).
const PHRASES_RE = /(const PHRASES_URL = '\.\/wait-phrases\.js\?v=)([0-9a-f]+)';/;

function main() {
  const fix = process.argv.includes('--fix');
  const html = fs.readFileSync(INDEX, 'utf8');
  const waitUi = fs.readFileSync(WAIT_UI, 'utf8');
  const problems = [];
  let outHtml = html, outWait = waitUi;

  for (const ref of indexRefs(html)) {
    const file = path.join(ROOT, 'studio', ref.file);
    if (!fs.existsSync(file)) { problems.push('нет файла: studio/' + ref.file); continue; }
    const actual = versionOf(file);
    if (ref.version !== actual) {
      problems.push(ref.file + ': ?v=' + ref.version + ' ≠ хэш ' + actual);
      if (fix) outHtml = outHtml.replace(ref.raw, ref.raw.replace('?v=' + ref.version, '?v=' + actual));
    }
  }

  const pm = PHRASES_RE.exec(waitUi);
  if (!pm) problems.push('wait-ui.js: нет константы PHRASES_URL с версией');
  else {
    const actual = versionOf(path.join(ROOT, 'studio', 'wait-phrases.js'));
    if (pm[2] !== actual) {
      problems.push('wait-ui.js PHRASES_URL: ?v=' + pm[2] + ' ≠ хэш ' + actual);
      if (fix) outWait = waitUi.replace(PHRASES_RE, '$1' + actual + "';");
    }
  }

  // Манифест и favicon обязаны существовать и быть связанными (T-35).
  for (const must of ['favicon.svg', 'manifest.webmanifest']) {
    if (!fs.existsSync(path.join(ROOT, 'studio', must))) problems.push('нет файла: studio/' + must);
  }
  const manifest = fs.readFileSync(path.join(ROOT, 'studio', 'manifest.webmanifest'), 'utf8');
  if (!/"favicon\.svg"/.test(manifest)) problems.push('manifest.webmanifest не ссылается на favicon.svg');

  if (!problems.length) {
    console.log('PASS asset versions: все ?v= совпадают с контент-хэшами (index.html + wait-ui.js)');
    return 0;
  }
  if (fix) {
    fs.writeFileSync(INDEX, outHtml);
    fs.writeFileSync(WAIT_UI, outWait);
    console.log('FIXED asset versions: обновлено ссылок — ' + problems.length);
    return 0;
  }
  console.error('FAIL asset versions:\n  ' + problems.join('\n  '));
  console.error('Запустите: node tools/asset-versions.cjs --fix');
  return 1;
}

process.exit(main());
