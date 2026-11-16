/* Статический анализ: пулы фраз ожидания, контрасты/таргеты CSS, метрики кода. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..', '..');
const out = [];
const say = (...a) => { const l = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); out.push(l); console.log(l); };
const head = t => say('\n===== ' + t + ' =====');

/* ---------------- 1. ФРАЗЫ ОЖИДАНИЯ ---------------- */
head('S1 · пулы фраз ожидания (wait-phrases.js)');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'studio/wait-phrases.js'), 'utf8'), sandbox);
const P = sandbox.window.BRIIX_WAIT_PHRASES;
const flat = o => Object.entries(o).filter(([k]) => k !== 'mock');
for (const [type, set] of Object.entries(P)) {
  const staged = flat(set);
  const total = staged.reduce((n, [, v]) => n + v.length, 0);
  const all = staged.flatMap(([, v]) => v);
  const uniq = new Set(all.map(s => s.trim().toLowerCase()));
  say(`тип «${type}»: пулов ${staged.length} (${staged.map(([k, v]) => k + ':' + v.length).join(', ')}), фраз ${total}, уникальных ${uniq.size}, дублей ${total - uniq.size}` +
    (set.mock ? `, mock-зоны: ${Object.entries(set.mock).map(([k, v]) => k + ':' + v.length).join(',')}` : ', mock-зон НЕТ'));
  const lens = all.map(s => s.length);
  if (lens.length) say(`   длина фраз: мин ${Math.min(...lens)}, макс ${Math.max(...lens)}, медиана ${lens.sort((a, b) => a - b)[Math.floor(lens.length / 2)]} симв.`);
  const longest = all.filter(s => s.length > 62);
  if (longest.length) say(`   длиннее 62 симв. (не влезут в одну строку на 320px): ${longest.length}, напр. «${longest[0].slice(0, 70)}…»`);
}
// кросс-типовые дубли
const allByType = {};
for (const [type, set] of Object.entries(P)) allByType[type] = new Set(flat(set).flatMap(([, v]) => v.map(s => s.trim().toLowerCase())));
for (const a of Object.keys(allByType)) for (const b of Object.keys(allByType)) if (a < b) {
  const inter = [...allByType[a]].filter(x => allByType[b].has(x));
  if (inter.length) say(`дубли между «${a}» и «${b}»: ${inter.length}`);
}
// анти-повтор против размера пула
head('S1.1 · анти-повтор (NO_REPEAT=15 в wait-ui.js) против размера пула стадии');
for (const [type, set] of Object.entries(P)) for (const [stage, list] of flat(set)) {
  const pool = list.length + (Array.isArray(set.any) ? set.any.length : 0);
  const stagedOnly = list.length;
  if (stagedOnly < 15) say(`«${type}.${stage}»: своих фраз ${stagedOnly} < окна 15 → при STAGED_PROBABILITY=0.65 окно съедает пул, фолбэк возвращает повторы`);
  if (pool < 15) say(`«${type}.${stage}»: весь пул ${pool} < 15 → анти-повтор не работает`);
}
// лексика: жаргон и «магия нейросетей»
head('S1.2 · лексика фраз (правило из шапки wait-phrases.js: «без магии нейросетей», тон тёплый)');
const WORDS = { 'стенд': /стенд/i, 'нейросеть/модель': /нейросет|модель|нейросети/i, 'диффузия/коды (техн.)': /диффузи|аудио-код|отсчёт|спектр/i, 'сервер': /сервер/i, 'обещание срока («почти готово», «скоро»)': /почти готов|скоро|осталось|ещё немного|ещё чуть/i, 'мок/демо (честность)': /мок|заглушк|демо/i };
for (const [label, re] of Object.entries(WORDS)) {
  const hits = [];
  for (const [type, set] of Object.entries(P)) for (const [stage, list] of Object.entries(set)) {
    const arrs = Array.isArray(list) ? [[stage, list]] : Object.entries(list).map(([z, v]) => [stage + '.' + z, v]);
    for (const [s, v] of arrs) v.forEach(f => { if (re.test(f)) hits.push(`${type}.${s}: «${f}»`); });
  }
  say(`${label}: ${hits.length} совпад.`);
  hits.slice(0, 6).forEach(h => say('   ' + h));
}
// стадии, которые реально отдаёт bff
head('S1.3 · соответствие стадий bff и пулов');
const bff = fs.readFileSync(path.join(ROOT, 'server-contract/bff.py'), 'utf8');
const serverStages = [...new Set([...bff.matchAll(/j\["stage"\]\s*=\s*"([a-z-]+)"/g)].map(m => m[1]).concat([...bff.matchAll(/run_stage\([^)]*"([a-z-]+)"/g)].map(m => m[1])))];
say('стадии в bff.py:', serverStages.join(', '));
say('стадии-ключи в пулах music:', flat(P.music).map(([k]) => k).join(', '));
say('стадии в progress-bar студии (studio.js):', (fs.readFileSync(path.join(ROOT, 'studio/studio.js'), 'utf8').match(/const stages = \[[^\]]+\]/) || [''])[0]);
for (const st of serverStages) if (!P.music[st]) say(`НЕТ пула для стадии «${st}» → фолбэк на music.any (потеря смысла стадии)`);

/* ---------------- 2. CSS: контрасты и таргеты ---------------- */
head('S2 · контраст текста (WCAG 2.2 AA) — токены палитры studio.css');
const css = fs.readFileSync(path.join(ROOT, 'studio/studio.css'), 'utf8');
const tokens = Object.fromEntries([...css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const parseColor = str => {
  str = str.trim();
  if (str.startsWith('#')) {
    const h = str.slice(1);
    const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), 1];
  }
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(',').map(x => parseFloat(x)); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  return null;
};
const over = (fg, bg) => [0, 1, 2].map(i => fg[3] * fg[i] + (1 - fg[3]) * bg[i]).concat(1);
const lum = c => { const f = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
const resolve = t => parseColor(tokens[t] || t);
const PAIRS = [
  ['--faint', '--surface-1', '.hint, .stopped-note, .stage-elapsed, .menu .sub, .ta::placeholder (11–13px)'],
  ['--faint', '--surface-2', '.tag/.lib-cover на surface-2, .waveform dim-бары'],
  ['--faint', '--canvas', '.lib-media на canvas'],
  ['--muted', '--surface-1', '.card .who, .meta, .composer-hint, .producer-note (11–13px)'],
  ['--muted', '--surface-2', '.lib-prompt, .mode (12–14px)'],
  ['--muted', '--canvas', '.feed:empty::after (14px)'],
  ['--placeholder', '--surface-1', '.prompt::placeholder (16px)'],
  ['--ink', '--canvas', 'основной текст'],
  ['--ink', '--surface-1', 'основной текст карточек'],
  ['--accent', '--surface-1', '.gen-track, .tool.toggle[aria-pressed] (13px)'],
  ['--accent', '--accent-soft', 'ссылка/акцент на мягкой подложке'],
  ['--accent-ink', '--accent', '.send, .save, .brand-mark (текст на акценте)'],
  ['--danger', '--danger-soft', '.card.error (13px)'],
  ['--amber', '--amber-soft', '.card.notice, .undo (12–13px)'],
  ['--blue', '--blue-soft', '.card.stage (13px)'],
];
say('пара (текст/фон) → контраст, вердикт AA (4.5:1 обычный, 3:1 крупный ≥18.66px bold/24px)');
for (const [fg, bg, where] of PAIRS) {
  const a = resolve(fg), b = resolve(bg);
  if (!a || !b) { say(`  ${fg} / ${bg} — не распознано`); continue; }
  const comp = a[3] < 1 ? over(a, b) : a;
  const r = ratio(comp, b[3] < 1 ? over(b, resolve('--canvas')) : b);
  const verdict = r >= 4.5 ? 'AA ✓' : r >= 3 ? 'AA только для крупного текста ⚠' : 'НЕ ПРОХОДИТ ✗';
  say(`  ${fg} на ${bg}: ${r.toFixed(2)}:1 — ${verdict}  [${where}]`);
}
head('S2.1 · тач-таргеты из CSS (минимум 44px на ≤480px, 24px AA на десктопе)');
const heights = [...css.matchAll(/([.#][^{}/]+)\{[^}]*min-height:\s*(\d+)px/g)].map(m => [m[1].trim(), Number(m[2])]);
say('десктопные min-height < 36px:', JSON.stringify(heights.filter(([, h]) => h < 36)));
say('десктопные min-height 36–43px:', JSON.stringify(heights.filter(([, h]) => h >= 36 && h < 44).map(x => x.join('='))));
say('мобильный блок @media(max-width:480px) покрывает:', [...css.matchAll(/@media \(max-width: 480px\) \{([\s\S]*?)\n\}/g)].map(m => [...m[1].matchAll(/([.#][^{]+)\{/g)].map(x => x[1].trim()).join(', ')).join(' | '));
head('S2.2 · prefers-reduced-motion и анимации');
say('анимаций/keyframes:', (css.match(/@keyframes/g) || []).length, (css.match(/animation:/g) || []).length, 'использований animation');
say('блоков prefers-reduced-motion:', (css.match(/prefers-reduced-motion/g) || []).length, '| глобальный гаситель (*{animation:none}) есть:', /\*\s*\{\s*transition:\s*none\s*!important;\s*animation:\s*none\s*!important;/.test(css));
say('transition объявлено:', (css.match(/transition:/g) || []).length);
head('S2.3 · мёртвые/дублирующиеся правила CSS');
const STUDIO_JS = fs.readFileSync(path.join(ROOT, 'studio/studio.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'studio/index.html'), 'utf8');
for (const sel of ['.feed-cover', '.lib-more', '.header-note', '.music-draft .draft-note', '.send.busy', '.send.stop', '.lib-results', '.waveform-seek']) {
  const cls = sel.split(/[\s.>]+/).filter(Boolean).pop();
  say(`  ${sel}: в CSS ${css.split(sel).length - 1} раз | класс «${cls}» в studio/index.html ${(STUDIO_JS + INDEX_HTML).split(cls).length - 1} раз`);
}
say('  .send.busy/.send.stop: классы в studio.js —', /send\.classList/.test(STUDIO_JS) ? 'есть' : 'НЕТ (кнопка отправки никогда не становится «стоп»)');
say('  .lib-more: упоминаний в JS —', STUDIO_JS.includes('lib-more') ? 'есть' : 'НЕТ (правила мертвы; «показать ещё» в библиотеке не реализовано)');
say('  :focus-visible объявлен дважды с разными свойствами:', (css.match(/:focus-visible\s*\{/g) || []).length, 'раз');

/* ---------------- 3. метрики кода ---------------- */
head('S3 · метрики кода');
const files = fs.readdirSync(path.join(ROOT, 'studio')).filter(f => /\.(js|css|html)$/.test(f));
let total = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, 'studio', f), 'utf8');
  const lines = src.split('\n').length;
  total += lines;
  const comments = (src.match(/^\s*(\/\/|\/\*|\*)/gm) || []).length;
  say(`  ${f}: строк ${lines}, комментариев ${comments}, байт ${Buffer.byteLength(src)}, gzip ~${require('node:zlib').gzipSync(src).length}`);
}
say('  всего строк в studio/:', total);
const js = fs.readFileSync(path.join(ROOT, 'studio/studio.js'), 'utf8');
say('  функций в studio.js:', (js.match(/function [a-zA-Z0-9_]+\s*\(/g) || []).length, '| стрелочных:', (js.match(/=>/g) || []).length);
say('  addEventListener:', (js.match(/addEventListener/g) || []).length, '| removeEventListener:', (js.match(/removeEventListener/g) || []).length);
say('  setInterval:', (js.match(/setInterval/g) || []).length, '| clearInterval:', (js.match(/clearInterval/g) || []).length, '| setTimeout:', (js.match(/setTimeout/g) || []).length, '| clearTimeout:', (js.match(/clearTimeout/g) || []).length);
say('  IntersectionObserver:', (js.match(/new IntersectionObserver/g) || []).length, '| MutationObserver:', (js.match(/new MutationObserver/g) || []).length, '| disconnect():', (js.match(/\.disconnect\(\)/g) || []).length);
say('  createObjectURL:', (js.match(/createObjectURL/g) || []).length, '| revokeObjectURL:', (js.match(/revokeObjectURL/g) || []).length);
say('  confirm():', (js.match(/[^.\w]confirm\(/g) || []).length, '| alert():', (js.match(/[^.\w]alert\(/g) || []).length);
say('  textContent:', (js.match(/textContent/g) || []).length, '| innerHTML:', (js.match(/innerHTML/g) || []).length, '(все innerHTML — только очистка \'\')');
say('  try/catch блоков:', (js.match(/catch\s*[({]/g) || []).length, '| пустых catch:', (js.match(/catch\s*(\([^)]*\))?\s*\{\s*\}/g) || []).length);
say('  обращений к localStorage:', (js.match(/localStorage\./g) || []).length);
say('  fetch( в studio.js:', (js.match(/[^.\w]fetch\(/g) || []).length);
say('  AbortSignal.timeout/any:', (js.match(/AbortSignal\.(timeout|any)/g) || []).length, '| fetch с signal:', (js.match(/signal[,:]?\s*(handle|signal|outerSignal)/g) || []).length);

/* ---------------- 4. покрытие тестов ---------------- */
head('S4 · что утверждают тесты (имена проверок) и чего в них нет');
for (const f of fs.readdirSync(path.join(ROOT, 'tools')).filter(x => x.startsWith('check-'))) {
  const src = fs.readFileSync(path.join(ROOT, 'tools', f), 'utf8');
  const names = [...src.matchAll(/\bok\('([^']+)'/g)].map(m => m[1]);
  const asserts = (src.match(/assert\./g) || []).length;
  say(`  ${f}: ok()=${names.length}, assert=${asserts}, строк=${src.split('\n').length}`);
  names.forEach(n => say('      • ' + n));
}
const studio = fs.readFileSync(path.join(ROOT, 'tools/check-studio.cjs'), 'utf8');
head('S4.1 · ключевые темы контракта в тестах (0 = не покрыто)');
for (const [label, re] of Object.entries({
  'params.language': /params\.language|"language"|'language'/,
  'params.seed / provenance.seed': /\bseed\b/,
  'parent_job_id': /parent_job/,
  'POST /jobs/{id}/cancel': /\/cancel/,
  'Idempotency-Key': /Idempotency/i,
  'ttl_seconds / retention-404': /ttl_seconds|retention/,
  'provenance в UI': /provenance/,
  'warning (model игнорируется)': /"warning"|\.warning/,
  'X-Request-Id в ошибке': /request_id|X-Request/i,
  'peaks как объект {id,duration,peaks}': /duration:\s*[\d.]+\s*,\s*peaks|peaks:\s*\[/,
  'стадии model-warmup/generating': /model-warmup|generating/,
  'axe-core (доступность)': /AxeBuilder|axe/,
  'несколько одновременно играющих аудио': /paused/,
  'перенос стрим-флага между сессиями': /chatPending/,
})) say(`  ${label}: ${(studio.match(re) || []).length} совпад.`);
say('  AxeBuilder импортируется в browser-env.cjs, но используется в сюитах:', fs.readdirSync(path.join(ROOT, 'tools')).filter(f => f.endsWith('.cjs')).filter(f => /AxeBuilder\(/.test(fs.readFileSync(path.join(ROOT, 'tools', f), 'utf8'))).join(', ') || 'НИГДЕ');

fs.writeFileSync(path.join(__dirname, '..', 'evidence', 'static-evidence.txt'), out.join('\n'));
say('\nпротокол сохранён: static-evidence.txt');
