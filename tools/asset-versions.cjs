/* T-35: версионирование ассетов по контент-хэшу вместо ручных ?v=...
 *
 * Раньше версии в index.html были рассинхронизированы (?v=20261115, ?v=20261114-agent-b-1,
 * ?v=20261114-peaks-1) — при ошибке легко подать несовместимую пару studio.js/waveform.js
 * из кэша. Теперь ?v= — первые 10 символов sha256 содержимого файла, и CI проверяет
 * соответствие на каждом пушe.
 *
 * T-35 (хвост, кеш-самолечение): поверх ?v= — сборочный отпечаток
 *   build = sha256("имя:хэш|имя:хэш|...") всех ассетов страницы.
 * Он пишется в два места, всегда одинаковый:
 *   1) studio/version.json  — источник истины «что сейчас на сервере»;
 *   2) window.__BRIIX_BUILD__ = '...' (инлайн в index.html) — «что сейчас в браузере».
 * Инлайн-сторож в index.html при каждой загрузке сверяет их (version.json — с
 * cache: 'no-store') и при расхождении сам перезагружает страницу с параметром
 * _b= — новый URL гарантированно минует кеш браузера (деплой перезаписывает файлы
 * под старыми именами, и «старый HTML + новые JS» роняют бот до чёрного экрана).
 *
 *   node tools/asset-versions.cjs          — проверка (exit 1 при рассинхроне)
 *   node tools/asset-versions.cjs --fix    — перезаписать версии, маркер и version.json
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'studio', 'index.html');
const WAIT_UI = path.join(ROOT, 'studio', 'wait-ui.js');
const VERSION_JSON = path.join(ROOT, 'studio', 'version.json');
const BUILD_MARKER_RE = /window\.__BRIIX_BUILD__ = '([0-9a-f]{10})';/

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

  let phrasesHash = null;
  const pm = PHRASES_RE.exec(waitUi);
  if (!pm) problems.push('wait-ui.js: нет константы PHRASES_URL с версией');
  else {
    const actual = versionOf(path.join(ROOT, 'studio', 'wait-phrases.js'));
    phrasesHash = actual;
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

  /* ---- сборочный отпечаток (T-35, кеш-самолечение) ------------------------------
   * Считается по ИСПРАВЛЕННЫМ ?v= (fix уже применён к outHtml): любой изменённый
   * ассет меняет свой хэш → меняется отпечаток → браузер со старой страницей
   * видит расхождение с version.json и сам перезагружается. */
  const finalRefs = fix ? indexRefs(outHtml) : indexRefs(html);
  const assets = {};
  for (const ref of finalRefs) assets[ref.file] = ref.version;
  if (phrasesHash) assets['wait-phrases.js'] = phrasesHash;
  const fingerprintSource = Object.keys(assets).sort().map(k => k + ':' + assets[k]).join('|');
  const build = crypto.createHash('sha256').update(fingerprintSource).digest('hex').slice(0, 10);

  const marker = BUILD_MARKER_RE.exec(outHtml);
  if (!marker) problems.push('index.html: нет маркера window.__BRIIX_BUILD__ (кеш-самолечение)');
  else if (marker[1] !== build) {
    problems.push('index.html: __BRIIX_BUILD__=' + marker[1] + ' ≠ отпечаток ' + build);
    if (fix) outHtml = outHtml.replace(BUILD_MARKER_RE, "window.__BRIIX_BUILD__ = '" + build + "';");
  }

  let versionJson = null;
  if (!fs.existsSync(VERSION_JSON)) problems.push('нет studio/version.json — серверной стороне не с чем сверяться (кеш-самолечение)');
  else {
    try { versionJson = JSON.parse(fs.readFileSync(VERSION_JSON, 'utf8')); }
    catch { problems.push('studio/version.json не парсится как JSON'); }
  }
  if (versionJson && versionJson.build !== build) {
    problems.push('version.json: build=' + versionJson.build + ' ≠ отпечаток ' + build);
  }
  if (versionJson && JSON.stringify(versionJson.assets || {}) !== JSON.stringify(assets)) {
    problems.push('version.json: карта ассетов не совпадает с index.html');
  }
  if (fix) {
    const json = { build, assets };
    if (!versionJson || JSON.stringify(versionJson) !== JSON.stringify(json)) {
      fs.writeFileSync(VERSION_JSON, JSON.stringify(json, null, 2) + '\n');
      problems.push('version.json: обновлён (--fix)');
    }
  }

  if (!problems.length) {
    console.log('PASS asset versions: ?v= и сборочный отпечаток согласованы (index.html, wait-ui.js, version.json)');
    return 0;
  }
  if (fix) {
    fs.writeFileSync(INDEX, outHtml);
    fs.writeFileSync(WAIT_UI, outWait);
    console.log('FIXED asset versions: правок — ' + problems.length + '; отпечаток сборки ' + build);
    return 0;
  }
  console.error('FAIL asset versions:\n  ' + problems.join('\n  '));
  console.error('Запустите: node tools/asset-versions.cjs --fix');
  return 1;
}

process.exit(main());
