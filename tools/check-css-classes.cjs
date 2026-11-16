/* T-19 (3.9): мёртвые CSS-классы ловятся на каждом пушe.
 *
 * Ассерт из плана аудита: «каждый CSS-класс встречается в JS/HTML». Собираем
 * классы из studio.css и проверяем, что каждый упомянут хотя бы раз в
 * studio/*.js или studio/index.html — с границей токена (дефис и подчёркивание
 * считаются частью имени: .advanced ≠ .is-advanced). Это ловит стили,
 * оставшиеся от удалённых компонентов (R1–R6 собирали такие хвосты).
 *
 * ALLOWED_UNUSED — осознанные исключения: классы, которые живут только в
 * CSS-состояниях браузера/генерируются вне исходников. Пуст по умолчанию:
 * каждое исключение должно быть обосновано в самом списке.
 *
 *   node tools/check-css-classes.cjs   — проверка (exit 1 при мёртвом классе)
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CSS = path.join(ROOT, 'studio', 'studio.css');
const SOURCES_DIR = path.join(ROOT, 'studio');

const ALLOWED_UNUSED = [
  // (пусто: исключение — всегда с причиной)
];

function cssClasses(css) {
  // Классы из селекторов: отсекаем декларации (до '{'), в них числа/пути не ищем.
  const selectorsOnly = css.split('{').map((chunk, i, arr) => (i === arr.length - 1 ? chunk : chunk.slice(chunk.lastIndexOf('}') + 1)));
  const found = new Set();
  const re = /\.([a-zA-Z_][\w-]*)/g;
  for (const chunk of selectorsOnly) {
    let m;
    while ((m = re.exec(chunk))) found.add(m[1]);
  }
  return found;
}

function sourcesBundle() {
  const files = fs.readdirSync(SOURCES_DIR)
    .filter(f => /\.(js|html)$/.test(f))
    .map(f => fs.readFileSync(path.join(SOURCES_DIR, f), 'utf8'));
  return files.join('\n');
}

function main() {
  const css = fs.readFileSync(CSS, 'utf8');
  const classes = cssClasses(css);
  const sources = sourcesBundle();
  const dead = [];
  for (const cls of [...classes].sort()) {
    if (ALLOWED_UNUSED.includes(cls)) continue;
    // Граница токена: не [a-zA-Z0-9_-] с обеих сторон (конкатенации 'card ' + kind
    // и 'pd'+' on' проходят; .advanced не матчится внутри .is-advanced).
    const re = new RegExp('(?:^|[^\\w-])' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^\\w-])');
    if (!re.test(sources)) dead.push(cls);
  }
  if (!dead.length) {
    console.log('PASS css classes: все ' + classes.size + ' классов studio.css используются в JS/HTML');
    return 0;
  }
  console.error('FAIL css classes: мёртвые классы (ни разу не встречаются в studio/*.js и index.html):');
  for (const cls of dead) console.error('  .' + cls);
  console.error('Вычистите их из studio.css или добавьте обоснование в ALLOWED_UNUSED.');
  return 1;
}

process.exit(main());
