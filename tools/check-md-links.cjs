/* Проверка относительных markdown-ссылок на изменённых файлах (issue #30, дизайн B).
 *
 * Лёгкий docs-прогон в CI: на чисто-документационных PR вместо полного chromium-регресса
 * гоняется этот чек на изменённых .md файлах. Скоуп — только ССЫЛКИ МЕЖДУ ФАЙЛАМИ РЕПО:
 *   - внешние URL (http/https/mailto) не проверяются — не флейтить по сети;
 *   - якоря (#...) не проверяются;
 *   - у файловой ссылки якорь отбрасывается, проверяется существование файла.
 * Список изменённых файлов приходит из dorny/paths-filter (list-files: json) в env CHANGED.
 * Без CHANGED проверяет все .md в репо (локальный запуск: node tools/check-md-links.cjs).
 *
 * Exit 1: битая ссылка или изменённого файла больше нет в репо.
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

let changed = [];
if (process.env.CHANGED) {
  changed = JSON.parse(process.env.CHANGED).filter((f) => f.endsWith('.md'));
} else {
  const walk = (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) =>
        e.name === 'node_modules' || e.name.startsWith('.')
          ? []
          : e.isDirectory()
            ? walk(path.join(dir, e.name))
            : e.name.endsWith('.md')
              ? [path.relative(ROOT, path.join(dir, e.name))]
              : []
      );
  changed = walk(ROOT);
}

if (changed.length === 0) {
  console.log('no changed markdown files — nothing to check');
  process.exit(0);
}

// docs/agents/ — ДОСЛОВНЫЙ снимок хаба bestdeejay-design/agents (см. README там):
// внутренние ссылки снимка законно ведут на файлы хаба (../../AGENTS.md, ./agents/,
// ./skills/ и т.д.), которых в этом репо нет. Для файлов снимка такие цели —
// предупреждение, не провал. Для остального репо битая ссылка = провал.
const SNAPSHOT_DIR = 'docs/agents/';

// [text](target) и ![alt](target); target в скобках, возможно <>-обёрнутый
const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
let broken = 0;
let external = 0;
let checked = 0;

for (const relFile of changed) {
  const absFile = path.join(ROOT, relFile);
  if (!fs.existsSync(absFile)) {
    console.error(`BROKEN SOURCE: ${relFile} — изменённый файл отсутствует в репо`);
    broken++;
    continue;
  }
  const content = fs.readFileSync(absFile, 'utf8');
  // код-блоки не вырезаем: битая ссылка в коде тоже сигнал
  for (const m of content.matchAll(LINK_RE)) {
    let target = m[1].replace(/^<|>$/g, '');
    if (!target || target.startsWith('#')) continue;
    if (/^(https?:|mailto:)/.test(target)) continue;
    checked++;
    const filePart = target.split('#')[0];
    if (!filePart) continue; // ссылка только на якорь внутри этого же файла
    const absTarget = path.resolve(path.dirname(absFile), decodeURIComponent(filePart));
    if (!fs.existsSync(absTarget)) {
      if (relFile.startsWith(SNAPSHOT_DIR)) {
        console.warn(`CROSS-REPO (canon snapshot, ok): ${relFile} -> ${target}`);
        external++;
      } else {
        console.error(`BROKEN: ${relFile} -> ${target}`);
        broken++;
      }
    }
  }
}

console.log(`checked ${checked} relative link(s) in ${changed.length} markdown file(s) (${external} cross-repo snapshot refs)`);
if (broken > 0) {
  console.error(`FAILED: ${broken} broken link(s)/source(s)`);
  process.exit(1);
}
console.log('markdown links OK');
