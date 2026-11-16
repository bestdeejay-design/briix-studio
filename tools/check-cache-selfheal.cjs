/* Кеш-самолечение (хвост T-35): версия на сервере побеждает кеш браузера.
 *
 * Сторож — инлайн-скрипт в studio/index.html; сюита проверяет его снаружи,
 * как это видит пользователь с устаревшим кешем:
 *   A. свежая страница — рукопожатие с version.json идёт, перезагрузок нет,
 *      служебный ?_b= вычищается из адреса и sessionStorage;
 *   B. устаревший HTML (браузер держит старый сборочный отпечаток) — страница
 *      сама перезагружается с ?_b=<отпечаток с сервера> и оживает;
 *   C. битый бут (studio.js из кеша битый/404) — boot-вотчдог перезагружает,
 *      вторая попытка грузится чисто;
 *   D. вечная поломка — не больше двух автоперезагрузок, дальше видимый
 *      fallback с кнопкой (не чёрный экран и не цикл);
 *   E. version.json недоступен — страница не сходит с ума, бут продолжается;
 *   F. живая вкладка, пользователь ничего не вводит — новая версия на сервере
 *      подтягивается молча при возвращении на вкладку;
 *   G. живая вкладка с несохранённым текстом — молча НЕ перезагружаем,
 *      показываем тост «Обновить»; клик — перезагрузка с ?_b=.
 * Self-contained: каждая сцена поднимает свой сервер на 127.0.0.1:1839x,
 * чтобы хуки (подмена версии, битые скрипты) не перетекали между сценами.
 * Run: node tools/check-cache-selfheal.cjs
 */
const { launch } = require('./browser-env.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'studio', 'index.html');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.m4a': 'audio/mp4' };
const REAL_BUILD = /window\.__BRIIX_BUILD__ = '([0-9a-f]{10})';/.exec(fs.readFileSync(INDEX, 'utf8'))[1];
const STALE_BUILD = '0000000000';
// Короткие таймауты — хуки сюиты; в проде 9 с (см. инлайн-сторож в index.html).
const BOOT_TIMEOUT = 1000, RECHECK_MS = 500;

/* Сервер с хуками. Хуки — мутабельное состояние, сюита дергает их по ходу сцены:
 *  htmlStaleFirst   — первому HTML-запросу подсунуть устаревший отпечаток (B);
 *  scripts          — 'ok' | 'until-bust' (404 на studio.js до первого запроса
 *                     с ?_b=) | 'always' (404 всегда) (C, D);
 *  versionBuild     — override build в version.json; снимается сам после
 *                     первого HTML-запроса с ?_b= (эмуляция «деплой доехал
 *                     целиком, HTML+version.json согласованы») (F, G);
 *  versionFail      — 500 на version.json (E);
 *  htmlRequests / versionRequests — полные URL запросов для ассертов. */
function makeServer(port, hooks) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const url = req.url;
      let p = decodeURIComponent(url.split('#')[0].split('?')[0]);
      if (p === '/' || p === '/studio' || p === '/studio/') p = '/studio/index.html';

      if (p === '/studio/version.json') {
        hooks.versionRequests.push(url);
        if (hooks.versionFail) { res.writeHead(500); res.end('boom'); return; }
        // «Деплой доехал целиком»: после автоперезагрузки HTML и version.json
        // снова согласованы — override снимаем, отдаём реальный отпечаток.
        if (hooks.htmlRequests.length >= 2) hooks.versionBuild = null;
        const build = hooks.versionBuild || REAL_BUILD;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ build }));
        return;
      }

      if (p === '/studio/index.html') {
        hooks.htmlRequests.push(url);
        let html = fs.readFileSync(INDEX, 'utf8');
        if (hooks.htmlStaleFirst) {
          html = html.replace('window.__BRIIX_BUILD__ = \'' + REAL_BUILD + '\'', 'window.__BRIIX_BUILD__ = \'' + STALE_BUILD + '\'');
          hooks.htmlStaleFirst = false; // подмена только для первого (устаревшего) запроса
        }
        if (url.includes('_b=') && hooks.scripts === 'until-bust') hooks.scripts = 'ok';
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
      }

      if (p === '/studio/studio.js' && hooks.scripts && hooks.scripts !== 'ok') {
        res.writeHead(404); res.end('nf');
        return;
      }

      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

const passed = [];
function ok(name) { passed.push(name); console.log('  ok ' + passed.length + '. ' + name); }
async function waitForServer(hooks, field, n, ms = 6000) {
  const t0 = Date.now();
  while (hooks[field].length < n && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100));
  return hooks[field].length;
}

async function scene(browser, port, hooks, fn) {
  const server = await makeServer(port, hooks);
  const ctx = await browser.newContext();
  await ctx.addInitScript([
    'window.__BRIIX_BOOT_TIMEOUT = ' + BOOT_TIMEOUT + ';',
    'window.__BRIIX_RECHECK_MS = ' + RECHECK_MS + ';'
  ].join('\n'));
  const page = await ctx.newPage();
  try {
    await fn(page, hooks, 'http://127.0.0.1:' + port);
  } finally {
    await ctx.close();
    await new Promise(r => server.close(r));
  }
}

const bootedSel = () => document.documentElement.getAttribute('data-booted');

(async () => {
  const browser = await launch();
  const base = 18392;
  const login = async (page, url, user) => page.addInitScript(([u, t, s]) => {
    localStorage.setItem('briix-media-live-token', t);
    localStorage.setItem('briix-media-live-server', JSON.stringify(s));
    localStorage.setItem('briix-studio-profiles', JSON.stringify({ [u]: { pinHash: 'x', created: 0 } }));
    localStorage.setItem('briix-studio-user', u);
  }, [user, 'test-token', url]);

  /* A. Свежая версия: рукопожатие прошло, никаких перезагрузок; служебный ?_b=
   *    из адреса и счётчик из sessionStorage вычищены после бота. */
  await scene(browser, base, { htmlRequests: [], versionRequests: [] }, async (page, hooks, url) => {
    await page.goto(url + '/studio/?_b=manual123');
    await page.waitForFunction('document.documentElement.getAttribute(\'data-booted\') === \'1\'', null, { timeout: 8000 });
    await page.waitForFunction('!location.search.includes(\'_b=\')', null, { timeout: 4000 });
    assert.equal(hooks.htmlRequests.length, 1, 'A: одна загрузка HTML, без автоперезагрузок');
    assert.ok(hooks.versionRequests.length >= 1, 'A: рукопожатие с version.json состоялось');
    assert.equal(await page.evaluate(bootedSel), '1', 'A: бот прошёл');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('briix-bust')), null, 'A: счётчик перезагрузок вычищен');
    ok('A: свежая версия — рукопожатие без перезагрузки, ?_b= вычищен');
  });

  /* B. Устаревший HTML: браузер держит старый отпечаток, сервер — новый.
   *    Страница сама перезагружается с ?_b=<отпечаток сервера> и оживает. */
  await scene(browser, base + 1, { htmlRequests: [], versionRequests: [], htmlStaleFirst: true }, async (page, hooks, url) => {
    await page.goto(url + '/studio/');
    await page.waitForFunction('document.documentElement.getAttribute(\'data-booted\') === \'1\'', null, { timeout: 8000 });
    assert.equal(hooks.htmlRequests.length, 2, 'B: автоперезагрузка ровно одна');
    assert.ok(hooks.htmlRequests[1].includes('_b=' + REAL_BUILD), 'B: перезагрузка с отпечатком сервера: ' + hooks.htmlRequests[1]);
    assert.equal(await page.evaluate(bootedSel), '1', 'B: после перезагрузки бот прошёл');
    ok('B: устаревший HTML — авто-сброс кеша и живой бот');
  });

  /* C. Битый бут: studio.js не грузится (кеш отдал битое) — boot-вотчдог
   *    перезагружает страницу, вторая попытка чистая. */
  await scene(browser, base + 2, { htmlRequests: [], versionRequests: [], scripts: 'until-bust' }, async (page, hooks, url) => {
    await page.goto(url + '/studio/');
    await page.waitForFunction('document.documentElement.getAttribute(\'data-booted\') === \'1\'', null, { timeout: 10000 });
    assert.equal(hooks.htmlRequests.length, 2, 'C: boot-вотчдог перезагрузил один раз');
    assert.ok(hooks.htmlRequests[1].includes('_b='), 'C: перезагрузка мимо кеша: ' + hooks.htmlRequests[1]);
    ok('C: битый бут — вотчдог оживил страницу');
  });

  /* D. Вечная поломка: две автоперезагрузки не помогли — не циклим, показываем
   *    видимый fallback с кнопкой (не чёрный экран). */
  await scene(browser, base + 3, { htmlRequests: [], versionRequests: [], scripts: 'always' }, async (page, hooks, url) => {
    await page.goto(url + '/studio/');
    await page.waitForSelector('#briixBootFallback', { state: 'visible', timeout: 12000 });
    assert.equal(hooks.htmlRequests.length, 3, 'D: начальная + две автоперезагрузки, не больше');
    assert.equal(await page.getAttribute('#briixBootFallback', 'role'), 'alert', 'D: fallback объявлен скринридеру');
    assert.match(await page.locator('#briixBootFallback button').innerText(), /Перезагрузить/, 'D: кнопка перезагрузки есть');
    await page.waitForTimeout(BOOT_TIMEOUT * 3); // цикл остановлен?
    assert.equal(hooks.htmlRequests.length, 3, 'D: третей перезагрузки не случилось — цикла нет');
    ok('D: вечная поломка — fallback с кнопкой, цикла перезагрузок нет');
  });

  /* E. version.json недоступен: сторож не сходит с ума, бот продолжается. */
  await scene(browser, base + 4, { htmlRequests: [], versionRequests: [], versionFail: true }, async (page, hooks, url) => {
    await page.goto(url + '/studio/');
    await page.waitForFunction('document.documentElement.getAttribute(\'data-booted\') === \'1\'', null, { timeout: 8000 });
    await page.waitForTimeout(BOOT_TIMEOUT * 2);
    assert.equal(hooks.htmlRequests.length, 1, 'E: перезагрузок не было');
    assert.ok(hooks.versionRequests.length >= 1, 'E: попытка рукопожатия была');
    assert.equal(await page.evaluate(bootedSel), '1', 'E: бот прошёл без version.json');
    ok('E: version.json недоступен — без паники, бот продолжается');
  });

  /* F. Живая вкладка, пользователь не занят: НА СЕРВЕРЕ выехал новый деплой —
   *    при возвращении на вкладку новая версия подтягивается молча. */
  await scene(browser, base + 5, { htmlRequests: [], versionRequests: [], versionBuild: null }, async (page, hooks, url) => {
    await page.goto(url + '/studio/');
    await page.waitForFunction('document.documentElement.getAttribute(\'data-booted\') === \'1\'', null, { timeout: 8000 });
    await page.waitForTimeout(3200); // страница «давно живая» (порог 3 с в стороже)
    hooks.versionBuild = 'newhot0001'; // на сервере новая версия
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitForServer(hooks, 'htmlRequests', 2);
    await page.waitForFunction('document.documentElement.getAttribute(\'data-booted\') === \'1\'', null, { timeout: 8000 });
    assert.equal(hooks.htmlRequests.length, 2, 'F: тихая автоперезагрузка на новую версию');
    assert.ok(hooks.htmlRequests[1].includes('_b=newhot0001'), 'F: перезагрузка с новой версией: ' + hooks.htmlRequests[1]);
    assert.notEqual(hooks.htmlRequests[1], hooks.htmlRequests[0], 'F: это не первая загрузка');
    ok('F: живая вкладка (пользователь не занят) — тихое обновление');
  });

  /* G. Живая вкладка с несохранённым текстом: молча НЕ перезагружаем — тост
   *    «Обновить»; клик по нему перезагружает с ?_b=. */
  await scene(browser, base + 6, { htmlRequests: [], versionRequests: [], versionBuild: null }, async (page, hooks, url) => {
    await login(page, url, 'tester');
    await page.goto(url + '/studio/');
    await page.waitForFunction('document.documentElement.getAttribute(\'data-booted\') === \'1\'', null, { timeout: 8000 });
    await page.fill('#prompt', 'Черновик трека, не потерять бы');
    await page.waitForTimeout(3200);
    hooks.versionBuild = 'newhot0002'; // на сервере новая версия
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForSelector('.toast', { timeout: 4000 });
    await page.waitForTimeout(1200);
    assert.equal(hooks.htmlRequests.length, 1, 'G: молча страницу не снесли');
    const toastText = await page.locator('.toast').first().innerText();
    assert.match(toastText, /новая версия/i, 'G: тост про новую версию: ' + toastText);
    await page.locator('.toast-action', { hasText: 'Обновить' }).click();
    await waitForServer(hooks, 'htmlRequests', 2);
    assert.equal(hooks.htmlRequests.length, 2, 'G: клик «Обновить» перезагрузил страницу');
    assert.ok(hooks.htmlRequests[1].includes('_b=newhot0002'), 'G: перезагрузка с новой версией: ' + hooks.htmlRequests[1]);
    ok('G: несохранённый ввод — тост вместо молчаливой перезагрузки');
  });

  await browser.close();
  console.log('PASS cache selfheal: ' + passed.length + '/7 — версия на сервере побеждает кеш браузера');
  console.log('  сборочный отпечаток сюиты: ' + REAL_BUILD + ' (совпадает с version.json: ' +
    (JSON.parse(fs.readFileSync(path.join(ROOT, 'studio', 'version.json'), 'utf8')).build === REAL_BUILD) + ')');
})().catch(e => { console.error('FAIL cache selfheal:', e.message); process.exit(1); });
