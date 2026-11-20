/* BRIIX Studio v2 — composer-first standalone screen: chat / photo / music.
 * Own minimal transport (pattern of bus-live.js, no shared code). No secrets in git.
 * Chat: SSE stream from /v1/chat/completions. Photo/Music: POST /jobs + polling.
 * "Улучшить": few-shot from assets/data/creative-base.json (owner's own style base).
 */
(() => {
  'use strict';

  const DEFAULT_SERVER = 'http://127.0.0.1:8300';
  const SERVER_KEY = 'briix-media-live-server';
  const TOKEN_KEY = 'briix-media-live-token';
  const TOKEN_SESSION_KEY = 'briix-media-live-token-session'; // T-42: ключ до закрытия вкладки
  const MUSIC_MODELS = { flash: 'ace-step-flash', pro: 'ace-step-pro' };
  const MODEL_LABELS = { flash: 'Flash', pro: 'Pro' };
  // #35 UI v2: два фокуса — «Создание музыки» (дефолт) и «Фото»; отдельного режима
  // «Чат» больше нет: универсальные наставники — роли внутри музыкального диалога.
  const MODE_LABELS = { photo: 'Фото', music: 'Создание музыки' };
  const SEND_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
  const PLACEHOLDERS = {
    photo: 'Что рисуем? Опишите изображение…',
    music: 'Опишите трек или спросите наставника…' // F-52: единое «вы»
  };

  const ASSISTANTS = {
    chat: [
      { id: 'mentor', name: 'Наставник (общий)', system: 'Ты «Наставник» — дружелюбный универсальный собеседник студии BRIIX. Отвечай по-русски, по делу и кратко: 2–6 абзацев максимум. Если вопрос про музыку, фото или промпты — помоги практическим советом и предложи, какой режим студии (чат/фото/музыка) удобнее для следующего шага.' },
      { id: 'universal', name: 'Универсальный', system: 'Ты «Универсальный» помощник BRIIX. Для повседневных задач: разложи мысль по полочкам, предложи идеи и наметь следующий шаг. Отвечай по-русски, просто и структурировано (шаги/списки), без канцелярита. Если задача сложная — сначала короткий план, потом детали.' },
      { id: 'editor', name: 'Редактор', system: 'Ты «Редактор» BRIIX. Делай текст точнее и живее: убирай воду и канцелярит, усиливай глаголы, чини ритм предложений. Сначала дай исправленную версию целиком, потом 2–4 пункта «что изменил и почему» по-русски. Стиль автора сохраняй.' },
      { id: 'analyst', name: 'Аналитик', system: 'Ты «Аналитик» BRIIX. Видишь главное в данных и текстах: структурируй факты, выделяй 3–5 ключевых выводов, отделяй факты от предположений, указывай, чего не хватает для уверенного вывода. Отвечай по-русски, таблицы/списки приветствуются.' },
      { id: 'developer', name: 'Разработчик', system: 'Ты «Разработчик» BRIIX. От логики до рабочего кода: уточни требования одним коротким вопросом, если неясно; давай рабочее решение с краткими комментариями; предупреждай о крайних случаях и ошибках. Языки — по задаче. Пояснения по-русски.' },
      { id: 'marketer', name: 'Маркетолог', system: 'Ты «Маркетолог» BRIIX. Попадаешь в потребность аудитории: формулируй офферы, заголовки, тексты объявлений и постов; объясняй, на какой триггер опирается каждый вариант. Давай 2–3 варианта на выбор. По-русски, живым языком.' },
      { id: 'mentor2', name: 'Наставник (обучение)', system: 'Ты «Наставник (обучение)» BRIIX. Цель — понять, а не просто запомнить: объясняй от простого к сложному, на примерах из жизни, с аналогиями; проверяй понимание короткими вопросами; по-русски.' }
    ],
    photo: [
      { id: 'art-dir', name: 'Арт-директор (FLUX)', system: 'Ты «Арт-директор» — улучшаешь промпты для генерации изображений (FLUX). Преврати идею пользователя в детальный англоязычный промпт: субъект, композиция, свет, палитра, стиль, объектив/ракурс, атмосфера. Без воды — только готовый промпт и одно короткое пояснение по-русски.' },
      { id: 'visual-designer', name: 'Визуальный дизайнер', system: 'Ты «Визуальный дизайнер» BRIIX (фото/кадр/свет/стиль). Помогай придумать визуальную концепцию: сюжет, настроение, палитру, свет, ракурс, стиль референса — и собирай из этого готовый англоязычный промпт для FLUX. Пояснения по-русски.' }
    ],
    music: [
      // #39: языковое правило #109 (producer-brain) — единый источник для всех путей:
      // язык не указан → английский; явно указан → язык пользователя.
      // Имена исполнителей не писать: артист → семейство стиля (STYLE_FAMILIES producer-brain).
      { id: 'producer', name: 'Продюсер', system: 'Ты «Продюсер» — помогаешь довести музыкальный промпт для ACE-Step. Работай с англоязычным описанием стиля: жанр, BPM, вокал, инструменты, продакшн, структура, негативные указания. Отвечай по-русски кратко и конкретно, сам промпт — по-английски одной строкой. Язык лирики: если пользователь явно указал язык (например «на русском») — на нём; если язык явно не указан — по-английски (отсутствие указания не означает русский). Если пользователь ссылается на исполнителя или группу, его имя в prompt и названии не пиши: выдели стиль и передай его семейством (pop, rock, edm, house, rap, hip-hop, funk, soul, jazz, ballad, techno, trap, ambient, cinematic, folk, lo-fi, synthwave и близкими).' },
      { id: 'lyricist', name: 'Лирик', system: 'Ты «Лирик» — поэт-песенник. Помогай доработать лирику: образность, ритм, рифма, структура (куплет/припев/бридж), характер вокала в ремарках. Язык лирики: если пользователь явно указал язык (например «на русском») — на нём; если язык явно не указан — по-английски (отсутствие указания не означает русский). Держи строку пропеваемой, избегай штампов. Имена исполнителей в лирику и названия не пиши — передавай стиль через жанр и звучание. Предлагай правки точечно, не переписывая всё без нужды.' },
      { id: 'songwriter', name: 'Автор песни', system: 'Ты «Автор песни» BRIIX. Из темы пользователя пиши полную лирику: [verse], [pre-chorus], [chorus], [bridge], [outro] — образно и пропеваемо, без штампов, 16–40 строк. Языковое правило строго: по умолчанию (язык не указан) лирика — НА АНГЛИЙСКОМ; на русском — только если пользователь явно попросил («на русском»); идея на русском не означает русскую лирику. Если тема ссылается на исполнителя («в стиле X»), его имя в названии и тексте не пиши — передай стиль через жанр, эпоху и звучание. Пояснений минимум: коротко об управлении настроением и характером вокала.' }
    ]
  };

  // ---- transport (as v1) ----------------------------------------------------
  const server = () => {
    const host = location.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') return location.origin + '/api';
    try { return JSON.parse(localStorage.getItem(SERVER_KEY)) || DEFAULT_SERVER; } catch { return DEFAULT_SERVER; }
  };
  const token = () => sessionStorage.getItem(TOKEN_SESSION_KEY) || localStorage.getItem(TOKEN_KEY) || '';
  // T-42: по умолчанию ключ живёт в sessionStorage (до закрытия вкладки);
  // в localStorage — только явное «запомнить на этом устройстве». Ранее
  // сохранённые localStorage-ключи продолжают работать (миграция безболезненна).
  const setToken = (v, { remember = false } = {}) => {
    const s = String(v || '').trim();
    sessionStorage.removeItem(TOKEN_SESSION_KEY);
    if (remember) localStorage.setItem(TOKEN_KEY, s); else localStorage.removeItem(TOKEN_KEY);
    if (s && !remember) sessionStorage.setItem(TOKEN_SESSION_KEY, s);
    else if (!s) sessionStorage.removeItem(TOKEN_SESSION_KEY);
  };
  const tokenRemembered = () => Boolean(localStorage.getItem(TOKEN_KEY));
  // Ключ из ссылки (?key=...) — для показов: открыл ссылку с ключом, ключ
  // сохранился сам. T-42: только на сессию вкладки, и URL чистится сразу —
  // ключ не остаётся в адресной строке, истории, закладках и логах прокси.
  try {
    const urlKey = new URLSearchParams(location.search).get('key');
    if (urlKey && urlKey.trim()) {
      setToken(urlKey);
      history.replaceState(null, '', location.pathname + location.hash);
    }
  } catch { /* ignore */ }
  const headers = () => ({ Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' });

  // Каталог моделей (F-59): один запрос за сессию. P3 #35: без ключа /v1/models
  // не дёргаем (каждая загрузка студии давала 401 в консоли); сбой не мешает
  // работе — ожидание просто останется без ориентира времени.
  function loadCatalog() {
    const key = token();
    if (!key) return;
    BRIIX_CATALOG.load(server(), { key }).catch(() => {});
  }
  loadCatalog();

  class BusError extends Error {
    constructor(code, message, status = 0) { super(message || code); this.code = code; this.status = status; }
  }

  async function request(path, options = {}) {
    // T-26: если сеть точно отвалилась (событие offline), не жжём браузерные
    // таймауты на каждый запрос — сразу честная ошибка с понятной причиной.
    if (!netOnline) throw new BusError('offline', 'Нет соединения с сервером. Проверьте сеть и повторите — данные не потеряются.');
    let response;
    try { response = await fetch(server() + path, options); }
    catch (error) {
      if (error?.name === 'AbortError') throw error;
      // F-53: без служебного URL и внутреннего жаргона.
      throw new BusError('network', 'Сервер не отвечает. Проверьте подключение — мы повторим автоматически.');
    }
    if (response.status === 401) throw new BusError('unauthorized', 'Ключ не принят. Проверьте ключ в профиле — меню рядом с историей.', 401);
    if (response.status === 422 || response.status === 400) {
      let payload = null;
      try { payload = await response.json(); } catch { /* пустое тело */ }
      const code = payload?.error?.code || (response.status === 422 ? 'content_blocked' : 'bad_params');
      const message = payload?.error?.message || (response.status === 422 ? 'Не пройдена проверка контента.' : 'Сервер отклонил параметры запроса.');
      throw new BusError(code, message, response.status);
    }
    if (response.status === 429 || response.status === 503) {
      // P1-2 (#35): прокси отдаёт 429 без Retry-After и с пустой очередью —
      // «очередь заполнена» было враньём. Честно: сервер временно не отвечает.
      const error = response.status === 429
        ? new BusError('queue_full', 'Сервер временно не отвечает — перегружен. Мы повторим автоматически.', 429)
        : new BusError('unavailable', 'Сервер или бэкенд недоступен.', 503);
      error.retryAfter = response.headers.get('Retry-After');
      throw error;
    }
    if (!response.ok) {
      // T-09: сервер отдаёт конверт {error:{code,message,request_id}} и для 404/5xx —
      // показываем его, а не голый статус; код запроса идёт в карточку ошибки.
      let payload = null;
      try { payload = await response.json(); } catch { /* пустое тело */ }
      const code = payload?.error?.code || 'http';
      const message = payload?.error?.message || ('Сервер ответил ' + response.status + '.');
      const error = new BusError(code, message, response.status);
      if (payload?.error?.request_id) error.requestId = payload.error.request_id;
      throw error;
    }
    return response;
  }

  async function chatNonStream({ messages, maxTokens, signal }) {
    const response = await request('/v1/chat/completions', {
      method: 'POST', headers: headers(), signal,
      body: JSON.stringify({ messages, stream: false, max_tokens: maxTokens || 600 })
    });
    const payload = await response.json();
    if (payload?.error) throw new BusError(payload.error.code || 'upstream_error', payload.error.message);
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new BusError('bad_response', 'Сервер вернул ответ без текста.');
    return text;
  }

  // T-15: одно SSE-событие может состоять из нескольких data:-строк — по
  // спецификации они склеиваются; \r\n (nginx/прокси) нормализуем. Раньше
  // парсер понимал только одиночный data: с \n\n.
  function parseEvent(raw) {
    const lines = [];
    for (const line of raw.split('\n')) {
      const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (clean.startsWith('data:')) lines.push(clean.slice(5).replace(/^ /, ''));
    }
    if (!lines.length) return null;
    const payload = lines.join('\n').trim();
    if (!payload) return null;
    if (payload === '[DONE]') return { done: true };
    try { return JSON.parse(payload); } catch { /* возможно, прокси побил JSON на строки */ }
    if (lines.length > 1) {
      const joined = lines.join('').trim();
      if (joined === '[DONE]') return { done: true };
      try { return JSON.parse(joined); } catch { return null; }
    }
    return null;
  }

  async function chatStream({ messages, onChunk, signal }) {
    const response = await request('/v1/chat/completions', {
      method: 'POST', headers: headers(), signal,
      body: JSON.stringify({ messages, stream: true })
    });
    if (!response.body) throw new BusError('stream_unsupported', 'Браузер не отдал тело потока.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', delivered = '';
    // T-15: reader отменяется при ЛЮБОМ выходе — ошибке события, исключении в
    // onChunk, отмене по ✕. Раньше тело ответа оставалось открытым до GC.
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let match;
        // T-15: разделитель — и \n\n, и \r\n\r\n (прокси перекодируют переводы строк).
        while ((match = buffer.match(/\r\n\r\n|\n\n/))) {
          const event = parseEvent(buffer.slice(0, match.index));
          buffer = buffer.slice(match.index + match[0].length);
          if (!event) continue;
          if (event.done) { buffer = ''; break; }
          if (event.error) throw new BusError(event.error.code || 'upstream_error', event.error.message || 'Ошибка бэкенда посреди потока.');
          const piece = event.choices?.[0]?.delta?.content;
          if (piece) { delivered += piece; onChunk?.(piece); }
        }
      }
    } finally {
      try { reader.cancel().catch(() => {}); } catch { /* поток уже закрыт */ }
    }
    if (!delivered) throw new BusError('empty_stream', 'Сервер закрыл поток без текста.');
    return delivered;
  }

  async function submitJob(body) {
    const response = await request('/jobs', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const payload = await response.json();
    if (!payload?.job_id) throw new BusError('bad_response', 'Сервер не вернул job_id.');
    return payload.job_id;
  }

  let activePolls = 0;
  async function pollJob(id, { onStatus, intervalMs = 2000, timeoutMs = 40 * 60000, shouldStop, onRetry }) {
    const started = Date.now();
    let failures = 0, retryWait = 0;
    activePolls++;
    try {
      // T-26: время в скрытой вкладке не сжигает бюджет ожидания — серверная
      // задача там продолжает работать, поллинг возобновится при возврате.
      while (Date.now() - started - hiddenMs() < timeoutMs) {
        if (shouldStop?.()) throw new BusError('cancelled', 'Ожидание остановлено. Задача продолжает выполняться на сервере — результат не сохранится.');
        await new Promise(r => setTimeout(r, Math.max(intervalMs, activePolls * 2500, retryWait)));
        // T-26: фоновой вкладке поллинг не нужен (THREAD_BUDGET=8 на стенде) —
        // паркуемся до возврата; при возврате запрос уходит сразу же.
        await waitPageVisible();
        await waitNetOnline();
        if (shouldStop?.()) throw new BusError('cancelled', 'Ожидание остановлено. Задача продолжает выполняться на сервере — результат не сохранится.');
        let response;
        try { response = await request('/jobs/' + encodeURIComponent(id), { headers: headers() }); }
        catch (error) {
          // 404 — задача исчезла (retention/перезапуск): ретраить бессмысленно (T-14).
          if (error.status === 404) throw new BusError('job_gone', 'Задача исчезла на сервере (404) — возможно, истёк срок хранения.', 404);
          // 401 ретраить нет смысла; остальное (сеть, 5xx, очередь) — транзиентное:
          // держим удар до 5 сбоев подряд с бэкоффом (T-14: один потерянный пакет
          // больше не рвёт 10-минутную pro-генерацию).
          if (error.status === 401 || error.name === 'AbortError') throw error;
          // T-26: известный офлайн — не сбой, а пауза: счётчик не растёт.
          if (error.code === 'offline') { failures = 0; retryWait = 0; onRetry?.(0); continue; }
          // P1-2 (#35): молча не сдаёмся после 5 сбоев — экспоненциальный backoff
          // (Retry-After → 1/2/4/8… с, потолок паузы 30 с) до общего потолка
          // ожидания (timeoutMs). Честный статус в карточке — через onRetry.
          failures++;
          retryWait = retryDelay({ headers: { get: () => error.retryAfter } }, failures - 1);
          if (retryWait > 30000) retryWait = 30000;
          onRetry?.(failures, retryWait);
          continue;
        }
        if (failures) { failures = 0; retryWait = 0; onRetry?.(0); }
        const data = await response.json();
        onStatus?.(data);
        if (data.status === 'ready') {
          if (!data.result_url) throw new BusError('bad_response', 'Сервер сообщил о готовности, но не отдал ссылку на файл.');
          return data;
        }
        if (['error', 'failed', 'cancelled', 'expired'].includes(data.status)) {
          // F-53: сырой английский статус не показываем — переводим причину.
          const reason = data.status === 'expired' ? 'истёк срок хранения файла'
            : data.status === 'cancelled' ? 'задача отменена'
            : (data.error?.message || 'сервер не смог завершить задачу');
          throw new BusError(data.status, 'Задача не завершилась: ' + reason + '.');
        }
      }
      // P1-2 (#35): исчерпание поллинга не теряет джобу — она продолжает
      // выполняться на сервере, продолжить наблюдение можно из Библиотеки
      // (серверный список /jobs) или при следующем открытии сессии
      // (session.jobs не settles — restore возобновит поллинг).
      throw new BusError('watch_expired', 'Сервер долго не отвечал на статус — мы перестали следить, но генерация продолжается на сервере. Результат появится в Библиотеке.');
    } finally { activePolls--; }
  }

  // ---- creative base --------------------------------------------------------
  let baseCache = null;
  async function creativeBase() {
    if (baseCache) return baseCache;
    const response = await fetch('/assets/data/creative-base.json');
    if (!response.ok) throw new BusError('base_unavailable', 'База стилей владельца недоступна (' + response.status + ').');
    baseCache = await response.json();
    return baseCache;
  }

  function pickRandom(items, n) {
    const copy = items.slice();
    const out = [];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    return out;
  }

  async function improveText(fieldText, kind /* 'lyrics' | 'prompt' */) {
    const base = await creativeBase();
    const pool = kind === 'lyrics' ? (base.lyrics || []) : (base.prompts || []);
    const examples = pickRandom(pool, 5);
    const sources = [...new Set(pool.map(e => e.source).filter(Boolean))];
    const fewShot = examples.map(e => '<example source="' + (e.source || '') + '">\n' + e.text + '\n</example>').join('\n\n');
    const what = kind === 'lyrics' ? 'лирику песни' : 'музыкальный промпт для модели ACE-Step';
    const system = 'Ты редактор музыкальной студии BRIIX. Улучшай ' + what + ' пользователя, сохраняя его замысел, язык и тему. '
      + 'Опирайся на стиль владельца: ' + sources.join('; ') + '. '
      + (kind === 'lyrics'
        ? 'Держи строки пропеваемыми, усили образность и структуру (куплет/припев), ремарки вокала — в скобках по-английски. '
        : 'Промпт — компактная строка на английском: жанр, BPM, вокал, инструменты, продакшн, уточняй ограничения без противоречий и не выдумывай темп. ')
      + 'Верни ТОЛЬКО улучшенный текст без пояснений и кавычек.\n\nПримеры стиля владельца:\n' + fewShot;
    return chatNonStream({ messages: [{ role: 'system', content: system }, { role: 'user', content: 'Улучши:\n\n' + fieldText }], maxTokens: 600 });
  }

  // ---- UI -------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const els = {
    modes: $('modes'), prompt: $('prompt'), advanced: $('advanced'),
    lyrics: $('lyrics'), musicPrompt: $('musicPrompt'),
    improveLyrics: $('improveLyrics'), improvePrompt: $('improvePrompt'),
    undoLyrics: $('undoLyrics'), undoPrompt: $('undoPrompt'),
    tags: $('tags'), addBtn: $('addBtn'),
    assistantChip: $('assistantChip'), assistantName: $('assistantName'), assistantMenu: $('assistantMenu'),
    modelChip: $('modelChip'), modelName: $('modelName'), modelMenu: $('modelMenu'),
    vocalSeg: $('vocalSeg'), tuneToggle: $('tuneToggle'), prepareMusic: $('prepareMusic'),
    styleFamilyBadge: $('styleFamilyBadge'),
    genTrack: $('genTrack'),
    send: $('send'), feed: $('feed'), status: $('status'), metaLeft: $('metaLeft'),
    composer: $('composer'), keyCard: $('keyCard'), keyInput: $('keyInput'), keySave: $('keySave'),
    newChat: $('newChat'), improvePhoto: $('improvePhoto'), undoPhoto: $('undoPhoto'),
    gate: $('gate'), nickInput: $('nickInput'), pinDots: $('pinDots'), pinpad: $('pinpad'),
    enterBtn: $('enterBtn'), gateHint: $('gateHint'), studio: $('studio'),
    profileBtn: $('profileBtn'), profileMenu: $('profileMenu'), profileNick: $('profileNick'),
    profileKeyBtn: $('profileKeyBtn'), profileLogoutBtn: $('profileLogoutBtn'), keyStatus: $('keyStatus'),
    tabs: $('tabs'), lib: $('lib'), sessionsOpen: $('sessionsOpen'), sessionsOverlay: $('sessionsOverlay'),
    sessionsDialog: $('sessionsDialog'), sessionsClose: $('sessionsClose'), sessionsNew: $('sessionsNew'),
    sessionsList: $('sessionsList'), storageWarning: $('storageWarning'),
    opsOverlay: $('opsOverlay'), opsText: $('opsText'), opsStopLogout: $('opsStopLogout'),
    opsStay: $('opsStay'), opsCancel: $('opsCancel'), opsBadge: $('opsBadge'),
    keyRemember: $('keyRemember'), profileWipeBtn: $('profileWipeBtn'), netBanner: $('netBanner')
  };

  let mode = 'music';
  let quality = 'flash';
  let instrumental = false; // зеркала session.draft: пишутся в draft активной сессии (P2-2/P2-3 аудита #35)
  try { const savedInstr = localStorage.getItem('briix-studio-instrumental'); if (savedInstr !== null) instrumental = savedInstr === '1'; } catch {}
  // localStorage выше — только ДЕФОЛТ для новых сессий; персистится выбор в session.draft.
  let advanced = false;
  // T-20/F-06: занятость диалога — свойство сессии, а не модуля: стрим в сессии A
  // не блокирует ввод в сессии B. Ключ — id сессии, значение { kind, stop }.
  const sessionBusy = new Map();
  // P2-4 аудита #35: «Повторить с правками» клеит parentJobId к СЛЕДУЮЩЕЙ генерации
  // именно этой сессии; ключ живёт до первого createMusic и не переживает reload.
  const pendingRepeats = new Map();
  // ✨-улучшения — на сессию (аудит #35): «Улучшить лирику» в A не блокирует кнопку в B.
  const improvingBySession = new Map();
  function improvingHas(sessionId, field) { return improvingBySession.get(sessionId)?.has(field) || false; }
  function improvingAdd(sessionId, field) { (improvingBySession.get(sessionId) || improvingBySession.set(sessionId, new Set()).get(sessionId)).add(field); }
  function improvingDelete(sessionId, field) { improvingBySession.get(sessionId)?.delete(field); }
  let sessionProfile = null, sessionBackend = null, activeSession = null;
  let storageBlocked = true, storageDirty = false, pendingSaves = 0, saveQueue = Promise.resolve();
  const sessionRoots = new Map();
  // #35 W1-2: отдельного канала занятости продюсера больше нет — один sessionBusy
  // на сессию с типом операции (chat | producer | photo | resume).
  let producerSaveTimer = null;
  const feedObjectUrls = new Set();
  function feedObjectURL(blob) {
    const url = URL.createObjectURL(blob);
    feedObjectUrls.add(url);
    return url;
  }

  // ---- T-30/T-31: единый LRU-кэш медиа-файлов --------------------------------
  // Аудио/фото/скачивания делят один кэш: objectURL у каждого файла ОДИН,
  // выталкивание по давности (≤8 файлов и ≤32 МБ) ревочит URL. Файл, который
  // прямо сейчас виден (img/audio в DOM) или играется, не выталкиваем.
  // Прежде: blobCache/blobTypes/blobBytes без предела роста (65 МБ на 50 треков)
  // плюс одноразовый URL на каждый клик «Скачать», живший до выхода.
  const MEDIA_CACHE_MAX_FILES = 8;
  const MEDIA_CACHE_MAX_BYTES = 32 * 1024 * 1024;
  const mediaFiles = new Map(); // key → { blob, url }; порядок = давность использования
  let mediaFilesBytes = 0;
  let mediaTmpSeq = 0;
  function mediaKey(path) { return currentUser() + '|' + (path || ''); }
  function mediaCacheGet(key) {
    const entry = mediaFiles.get(key);
    if (!entry) return null;
    mediaFiles.delete(key); mediaFiles.set(key, entry); // касание — в конец
    return entry;
  }
  function mediaCachePut(key, blob) {
    const existing = mediaFiles.get(key);
    if (existing) { mediaFiles.delete(key); mediaFiles.set(key, existing); return existing; }
    const entry = { blob, url: URL.createObjectURL(blob) };
    mediaFiles.set(key, entry);
    mediaFilesBytes += blob.size;
    mediaCacheTrim();
    return entry;
  }
  function mediaCacheDrop(key) {
    const entry = mediaFiles.get(key);
    if (!entry) return;
    mediaFiles.delete(key); mediaFilesBytes -= entry.blob.size;
    URL.revokeObjectURL(entry.url);
  }
  function mediaInUse(url) {
    if (BriixPlayer.current?.src === url) return true;
    try { return !!document.querySelector('audio[src="' + url + '"], img[src="' + url + '"]'); } catch { return false; }
  }
  function mediaCacheTrim() {
    for (const [key, entry] of mediaFiles) {
      if (mediaFiles.size <= MEDIA_CACHE_MAX_FILES && mediaFilesBytes <= MEDIA_CACHE_MAX_BYTES) break;
      if (mediaInUse(entry.url)) continue; // видимый/играющий файл закреплён
      mediaCacheDrop(key);
    }
  }
  function mediaCacheClear() {
    for (const key of [...mediaFiles.keys()]) mediaCacheDrop(key);
  }
  // Кэш или загрузка: ключ — путь файла (с пользователем), чтобы чужой профиль
  // не читал чужие блобы; без пути (in-memory блоб) — временный ключ.
  function mediaEnsure(path, load) {
    const key = path ? mediaKey(path) : 'tmp:' + (++mediaTmpSeq);
    const entry = path ? mediaCacheGet(key) : null;
    if (entry) return Promise.resolve(entry);
    return Promise.resolve().then(load).then(blob => mediaCachePut(key, blob));
  }

  // T-51: единственный активный звук — модуль player.js (лента/библиотека/restore
  // проходят через BriixPlayer.claim): новое воспроизведение гасит предыдущее,
  // метаданные MediaSession уходят на экран блокировки.
  // Мини-плеер (R6): полоса под шапкой — заголовок, таймкод, play/pause;
  // клик по названию возвращает к карточке трека.
  const mp = { root: $('miniPlayer'), toggle: $('mpToggle'), title: $('mpTitle'), time: $('mpTime') };
  BriixPlayer.subscribe(state => {
    if (!state.audio || !state.audio.isConnected) { mp.root.hidden = true; return; }
    mp.root.hidden = false;
    mp.title.textContent = (state.meta?.title || 'Трек') + (state.meta?.artist ? ' — ' + state.meta.artist : '');
    mp.toggle.textContent = state.playing ? '⏸' : '▶';
    mp.toggle.setAttribute('aria-label', state.playing ? 'Пауза' : 'Продолжить воспроизведение');
    mp.time.textContent = BriixPlayer.fmtTime(state.audio.currentTime || 0) + ' / ' + BriixPlayer.fmtTime(state.audio.duration || 0);
  });
  mp.toggle.addEventListener('click', () => {
    const audio = BriixPlayer.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  });
  mp.title.addEventListener('click', () => {
    const card = BriixPlayer.current?.closest('.card');
    if (card) { setView('chat'); card.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  });

  // П1 SPEC #35: смешанные версии вкладок — явный отказ, не тихая потеря.
  // Старая v1-вкладка не может писать в v2-хранилище (schema_unsupported/invalid_profile);
  // несохранённое состояние уходит в temporary-ключ и предлагается к восстановлению.
  const pendingKey = nick => 'briix-studio-pending-v1-' + nick;
  let schemaRejected = false, schemaBanner = null;
  function storePendingV1() {
    if (!sessionProfile) return;
    try {
      localStorage.setItem(pendingKey(currentUser()), JSON.stringify({ profile: structuredClone(sessionProfile), capturedAt: Date.now() }));
    } catch { /* переполнение — баннер всё равно виден, текст в полях */ }
  }
  function showSchemaBanner() {
    if (schemaBanner?.isConnected) return;
    const el = document.createElement('div');
    el.className = 'schema-banner';
    el.setAttribute('role', 'alert');
    const text = document.createElement('p');
    text.textContent = 'Приложение обновлено. Сохранения остановлены — обновите страницу. Ваш текст не потерян.';
    const actions = document.createElement('div');
    actions.className = 'actions';
    const reload = document.createElement('button');
    reload.type = 'button'; reload.className = 'action';
    reload.textContent = 'Обновить';
    reload.addEventListener('click', () => location.reload());
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'action';
    copy.textContent = 'Скопировать данные';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(sessionProfile, null, 2));
        BRIIX_TOASTS.toast('Данные сессий скопированы в буфер обмена.', { kind: 'done' });
      } catch { BRIIX_TOASTS.toast('Не удалось скопировать. Нажмите «Обновить» — несохранённое восстановится из temporary-ключа.', { kind: 'error' }); }
    });
    actions.append(reload, copy);
    el.append(text, actions);
    (document.querySelector('.composer-wrap') || document.body).append(el);
    schemaBanner = el;
  }
  function warnStorage(error) {
    storageDirty = true;
    els.storageWarning.hidden = false;
    els.storageWarning.textContent = 'Сессии не сохранены: ' + (error.message || 'ошибка хранилища') + ' Не закрывайте вкладку; сохраните важный текст отдельно. ';
    if (sessionProfile) {
      const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.className = 'action';
      exportButton.textContent = 'Скачать данные сессий';
      exportButton.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(sessionProfile, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob); const link = document.createElement('a');
        link.href = url; link.download = 'briix-sessions-backup.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      els.storageWarning.append(exportButton);
    }
  }
  // T-28: конфликт ревизий (другая вкладка записала раньше) — выбор версий,
  // а не липкая плашка: «Заменить своей версией» / «Обновить».
  let conflictOffered = false;
  async function reloadProfileInPlace() {
    const opened = await BriixSessionStore.open(currentUser());
    sessionProfile = opened.profile; sessionBackend = opened.backend;
    conflictOffered = false; storageDirty = false;
    els.storageWarning.hidden = sessionBackend !== 'local';
    activeSession = sessionProfile.sessions.find(s => s && s.id === sessionProfile.activeSessionId) || sessionProfile.sessions[0];
    // Хотфикс #23: как в startSession — битая запись заменяется пустой сессией, а не крашит восстановление.
    if (!activeSession || typeof activeSession !== 'object' || !activeSession.id || !Array.isArray(activeSession.feed)) {
      activeSession = newSessionRecord();
      sessionProfile.sessions.push(activeSession);
    }
    sessionProfile.activeSessionId = activeSession.id;
    sessionRoots.clear();
    els.feed.textContent = '';
    ensureRoot(activeSession);
    rootFor(activeSession).hidden = false;
    loadDraft(activeSession);
    renderOpsBadge();
  }
  function handleStorageConflict() {
    if (conflictOffered) return; // один диалог за раз — не спамить на каждый ход очереди
    conflictOffered = true;
    const body = card('notice', 'Конфликт вкладок', 'Данные сессий изменились в другой вкладке. Эта вкладка не может сохранить свои изменения, пока не решён конфликт.', activeSession);
    const actions = document.createElement('div'); actions.className = 'actions';
    const mine = document.createElement('button'); mine.type = 'button'; mine.className = 'action'; mine.textContent = 'Заменить своей версией';
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'action'; refresh.textContent = 'Обновить (потерять несохранённое)';
    mine.addEventListener('click', async () => {
      try {
        const opened = await BriixSessionStore.open(currentUser());
        sessionProfile.revision = opened.profile.revision; // перезаписать версию другой вкладки
        conflictOffered = false;
        if (await persistSessions()) body.closest('.card').remove();
      } catch (error) { warnStorage(error); }
    });
    refresh.addEventListener('click', async () => {
      try { await reloadProfileInPlace(); body.closest('.card').remove(); }
      catch (error) { warnStorage(error); }
    });
    actions.append(mine, refresh); body.append(actions);
  }
  function persistSessions() {
    if (!sessionProfile) return Promise.resolve(false);
    // П1 SPEC #35: после schema-отказа записи не ретраятся (каждый ретрай v1-снапшота
    // гарантированно падает) — снапшот освежается в temporary-ключе, баннер уже виден.
    if (schemaRejected) {
      storePendingV1();
      storageDirty = true;
      showSchemaBanner();
      return Promise.resolve(false);
    }
    // T-32: structuredClone вместо JSON-раундтрипа — в 2–4 раза быстрее и не
    // теряет undefined-поля; состояние сессий — только клонируемые данные
    // (занятость живёт в sessionBusy вне профиля, undo/repeatOf — простые значения).
    const snapshot = structuredClone(sessionProfile);
    storageDirty = true;
    pendingSaves++;
    saveQueue = saveQueue.then(async () => {
      try {
        const saved = await BriixSessionStore.save(snapshot, sessionProfile.revision, sessionBackend);
        sessionProfile.revision = saved.revision;
        storageDirty = false;
        els.storageWarning.hidden = sessionBackend !== 'local';
        if (sessionBackend === 'local') els.storageWarning.textContent = 'IndexedDB недоступна: сессии хранятся в localStorage этого браузера, объём ограничен.';
        return true;
      } catch (error) {
        if (error?.code === 'conflict') handleStorageConflict(); // T-28
        else if (error?.code === 'invalid_profile' || error?.code === 'schema_unsupported') {
          // П1 SPEC #35: хранилище на новой схеме — старая вкладка не пишет в него.
          schemaRejected = true;
          storePendingV1();
          showSchemaBanner();
        }
        else warnStorage(error);
        return false;
      }
      finally { pendingSaves--; }
    });
    return saveQueue;
  }
  // П1 SPEC #35: восстановление несохранённого из прошлой v1-вкладки.
  // Вызывается после открытия v2-профиля; ключ удаляется в любом случае
  // (восстановил юзер или осознанно отказался; протухший >7 дней — предложить один раз).
  async function restorePendingV1() {
    let raw = null;
    try { raw = localStorage.getItem(pendingKey(currentUser())); } catch { return; }
    if (raw === null) return;
    try {
      const rec = JSON.parse(raw);
      const stale = !rec || !Number.isFinite(rec.capturedAt) || Date.now() - rec.capturedAt > 7 * 24 * 3600 * 1000;
      const fresh = rec && rec.profile && Array.isArray(rec.profile.sessions) && rec.profile.sessions.length;
      if (fresh) {
        const ok = await BRIIX_TOASTS.confirmDialog({
          title: 'Восстановить несохранённое?',
          body: 'В прошлой вкладке остались несохранённые сессии (приложение было обновлено). Восстановить их в этот профиль?',
          confirmLabel: 'Восстановить'
        });
        if (ok) {
          const migrated = BriixSessionStore.migrateV1toV2(rec.profile); // тот же tolerant-пайплайн, что у миграции v1→v2
          for (const session of migrated.sessions) {
            if (session && !sessionProfile.sessions.some(x => x && x.id === session.id)) sessionProfile.sessions.push(session);
          }
          await persistSessions();
        }
      } else if (!stale) { /* пустой pending-профиль — просто удалить */ }
      else {
        const ok = await BRIIX_TOASTS.confirmDialog({
          title: 'Старые несохранённые данные',
          body: 'Найдены несохранённые сессии недельной давности. Восстановить их? После этого ответа копия будет удалена.',
          confirmLabel: 'Восстановить'
        });
        if (ok) {
          const migrated = BriixSessionStore.migrateV1toV2(rec.profile);
          for (const session of migrated.sessions) {
            if (session && !sessionProfile.sessions.some(x => x && x.id === session.id)) sessionProfile.sessions.push(session);
          }
          await persistSessions();
        }
      }
    } catch { /* битый ключ — удаляем */ }
    try { localStorage.removeItem(pendingKey(currentUser())); } catch { /* приватный режим */ }
  }
  // T-25/F-33: черновик композера и продюсера пишутся с дебаунсом; pagehide
  // флэшит оба таймера — закрытие вкладки больше не теряет последний ввод.
  let draftSaveTimer = null;
  function saveDraftSoon() {
    if (draftSaveTimer || !activeSession) return;
    draftSaveTimer = setTimeout(() => { draftSaveTimer = null; saveDraft(activeSession); persistSessions(); }, 400);
  }
  window.addEventListener('pagehide', () => {
    if (producerSaveTimer) { clearTimeout(producerSaveTimer); producerSaveTimer = null; persistSessions(); }
    if (draftSaveTimer) { clearTimeout(draftSaveTimer); draftSaveTimer = null; saveDraft(activeSession); persistSessions(); }
  });
  // T-29: системный диалог закрытия — только когда реально теряется запись,
  // которая идёт прямо сейчас. Неудачная запись раньше делала диалог липким
  // навсегда; теперь об этом говорит только плашка с экспортом внутри страницы.
  window.addEventListener('beforeunload', e => {
    if (pendingSaves > 0) { e.preventDefault(); e.returnValue = ''; }
  });

  // F-35: клавиатура не накрывает композер. На Android Chrome 108+ это делает
  // meta interactive-widget=resizableViewport (dvh уменьшается вместе с вьюпортом);
  // на iOS meta не действует — там поднимаем композер сами, по visualViewport.
  function syncKbInset(vv) {
    const kb = Math.max(0, Math.round((window.innerHeight || 0) - (vv.height + (vv.offsetTop || 0))));
    document.documentElement.style.setProperty('--kb-inset', kb > 24 ? kb + 'px' : '0px');
    return kb;
  }
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const onVv = () => syncKbInset(vv);
    window.addEventListener('resize', onVv);
    vv.addEventListener('resize', onVv);
    vv.addEventListener('scroll', onVv);
    onVv();
    // Фокус в поле — держим каретку в видимой области, пока клавиатура выезжает.
    document.addEventListener('focusin', e => {
      if (!e.target.matches || !e.target.matches('textarea, input:not([type="checkbox"])')) return;
      setTimeout(() => e.target.scrollIntoView({ block: 'nearest' }), 150);
    });
  }
  window.__syncKbInset = syncKbInset; // hook для сюиты (F-35)
  function rootFor(session) { return sessionRoots.get(session.id); }
  function recordSessionJob(session, job, kind, input) {
    if (!session.jobs) session.jobs = [];
    session.jobs.push({ job, kind, input, createdAt: Date.now() });
    session.updatedAt = Date.now();
    persistSessions();
  }
  // P1-2 (#35): защита от дублей GPU-джоб. После сбоя поллинга джоба продолжает
  // работать на сервере (запись остаётся в session.jobs); повторное «Сгенерировать»
  // с теми же данными не создаёт вторую генерацию, а предлагает наблюдать
  // существующую. Отпечаток — нормализованные входные данные генерации.
  function jobFingerprint(kind, data) {
    const norm = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return JSON.stringify(kind === 'photo'
      ? ['photo', norm(data.prompt)]
      : ['music', norm(data.prompt), norm(data.lyrics), data.model || '', data.instrumental ? 1 : 0]);
  }
  async function guardDuplicateJob(session, kind, data) {
    const fp = jobFingerprint(kind, data);
    const rec = (Array.isArray(session.jobs) ? session.jobs : []).find(r => r?.kind === kind && jobFingerprint(r.kind, r.input || {}) === fp);
    if (!rec) return true;
    const watch = await BRIIX_TOASTS.confirmDialog({
      title: 'Такая генерация уже выполняется',
      body: 'Задача с этими же данными ещё выполняется на сервере — новая генерация создала бы дубль. Наблюдать существующую?',
      confirmLabel: 'Наблюдать'
    });
    if (watch) resumeWaitingJob(session, rec);
    return false;
  }
  // T-52: выполненная джоба покидает session.jobs — результат уже в ленте (feed),
  // повторный рендер при следующей загрузке не нужен.
  function settleSessionJob(session, jobId) {
    if (!session?.jobs?.length) return;
    const before = session.jobs.length;
    session.jobs = session.jobs.filter(x => x.job !== jobId);
    if (session.jobs.length !== before) { session.updatedAt = Date.now(); persistSessions(); }
  }
  function feedPush(d, session = activeSession) {
    if (!session) return;
    session.feed.push(d);
    if (d.t === 'user' && !session.titleSet && typeof d.text === 'string' && d.text.trim()) {
      session.title = d.text.trim().replace(/\s+/g, ' ').slice(0, 80);
      session.titleSet = true;
    }
    session.updatedAt = Date.now();
    return persistSessions();
  }
  // T-33: track — флаг, а не копия текста (раньше ответ хранился дважды:
  // в text и в track). Старые записи со строкой в track читаются как раньше.
  const trackBriefOf = d => (d.track === true ? d.text : (typeof d.track === 'string' ? d.track : ''));
  function feedRestore(session) {
    // F-39: восстановленная история — не «новые» карточки; пилюля не считается.
    restoringFeed = true;
    try {
      for (const d of session.feed) {
        if (!d || typeof d !== 'object') continue;
        if (d.t === 'producer_draft') {
          renderProducerDraft(d, session);
        } else if (d.t === 'music_draft') {
          renderMusicDraftCard(d, session);
        } else if (d.t === 'media') {
          if (d.kind === 'music') {
            renderTrackCard(session, { who: d.who, job: d.job, cover: d.cover, input: d.input || {}, file: d.file,
              loadBlob: () => fileBlob(d.file, 0) });
          } else {
            const body = card('assistant', d.who, '', session);
            body.textContent = '';
            // R2/T-18: фото-restore — тот же компонент, что fresh и Библиотека.
            body.append(photoCard({ file: d.file, loadBlob: () => fileBlob(d.file, 1), alt: d.prompt || '' }).body);
            if (d.track) addMakeTrackAction(body.closest('.card'), trackBriefOf(d));
          }
        } else {
          const body = card(d.t, d.who, d.text, session);
          if (d.t === 'assistant' && d.track) addMakeTrackAction(body.closest('.card'), trackBriefOf(d));
        }
      }
    } finally { restoringFeed = false; }
  }
  const assistantId = { photo: 'art-dir' }; // P2-1 аудита #35: музыкальная роль — свойство СЕССИИ (session.assistantId), не глобал
  // Роли музыкального фокуса: 7 универсальных наставников + 3 музыкальные роли.
  const CHAT_ROLES = [...ASSISTANTS.chat, ...ASSISTANTS.music];
  // T-22: бэкап полей перед «✨ Улучшить» живёт на сессии — undo в сессии B
  // больше не подставляет текст из сессии A (и переживает перезагрузку).
  function sessionUndo(session, field, value) {
    if (!session) return;
    if (value === undefined) return session.undo?.[field];
    (session.undo ||= {})[field] = value;
  }

  // ---- T-52: ожидание переживает перезагрузку -------------------------------
  // session.jobs пишется при отправке (recordSessionJob). На старте сессии
  // спрашиваем сервер о судьбе каждой джобы: готовая — карточка результата,
  // живая — карточка ожидания с поллингом, умершая — заметка. Мёртвые записи
  // вычищаются, чтобы следующий reload не рисовал их заново.
  async function resumeSessionJobs(session) {
    if (!session || session !== activeSession) return;
    const jobs = Array.isArray(session.jobs) ? session.jobs.slice() : [];
    for (const rec of jobs) {
      if (!rec?.job || (rec.kind !== 'music' && rec.kind !== 'photo')) continue;
      try {
        const response = await request('/jobs/' + encodeURIComponent(rec.job), { headers: headers() });
        const data = await response.json();
        if (data.status === 'ready' && data.result_url) {
          settleSessionJob(session, rec.job);
          await finishResumedJob(session, rec, data);
        } else if (['error', 'failed', 'cancelled', 'expired'].includes(data.status)) {
          settleSessionJob(session, rec.job);
          card('notice', 'Генерация не завершена', 'Задача из прошлой сессии завершилась со статусом «' + data.status + '» — результат не сохранён.', session);
        } else {
          resumeWaitingJob(session, rec);
        }
      } catch (error) {
        if (error.status === 404) {
          settleSessionJob(session, rec.job);
          card('notice', 'Задача исчезла', 'Задача прошлой сессии не найдена на сервере — срок хранения мог истечь.', session);
        }
        // транзиентные ошибки: запись остаётся в session.jobs — попробуем при следующей загрузке
      }
    }
  }
  async function finishResumedJob(session, rec, data) {
    if (rec.kind === 'music') {
      renderTrackCard(session, { who: 'Трек готов', job: rec.job, cover: data.cover_url, input: rec.input || {},
        file: data.result_url, loadBlob: () => fileBlob(data.result_url, 0) });
      feedPush({ t: 'media', who: 'Трек готов', kind: 'music', file: data.result_url, job: rec.job, cover: data.cover_url || '', input: rec.input || {} }, session);
      if (!libEntry(rec.job)) libAdd({ job: rec.job, sessionId: session.id, kind: 'music', prompt: rec.input?.prompt || '',
        lyrics: rec.input?.lyrics || '', instrumental: rec.input?.instrumental, inputComplete: true, title: rec.input?.title || '',
        model: rec.input?.model || '', file: data.result_url, cover: data.cover_url || '', created: Date.now(), fav: false });
    } else {
      const body = card('assistant', 'Фото готово', '', session);
      body.textContent = 'Загружаем файл…';
      try {
        const blob = await fileBlob(data.result_url, 1);
        if (session !== activeSession || !body.isConnected) return;
        body.textContent = '';
        // R2/T-18: восстановление готовой джобы — единая фото-карточка.
        body.append(photoCard({ eagerBlob: blob, file: data.result_url }).body);
      } catch (error) { if (body.isConnected) body.textContent = 'Файл недоступен. ' + (error.message || ''); }
      feedPush({ t: 'media', who: 'Фото готово', kind: 'photo', file: data.result_url, job: rec.job }, session);
      if (!libEntry(rec.job)) libAdd({ job: rec.job, sessionId: session.id, kind: 'photo', prompt: rec.input?.prompt || '', file: data.result_url, created: Date.now(), fav: false });
    }
  }
  function resumeWaitingJob(session, rec) {
    if (session !== activeSession) return;
    const stageBody = card('stage', rec.kind === 'music' ? 'Музыка (продолжение)' : 'Фото (продолжение)', '', session);
    const eta = etaNote(rec.kind === 'music' ? (rec.input?.model || '') : 'flux-2-klein-4b', 'продолжение');
    // P3 (#35): начальная стадия — честная: вокал на сервере всегда начинается
    // с «лирика», инструментал — с «разогрев модели» (не прыгаем вперёд).
    const resumeStages = rec.kind === 'music'
      ? (rec.input?.instrumental ? ['model-warmup', 'generating', 'album-cover'] : ['writing-lyrics', 'synthesizing', 'album-cover'])
      : ['generating'];
    const wait = waitRow(rec.kind === 'music' ? 'music' : 'image', resumeStages[0], { onTick: eta.update });
    const handle = trackedHandle('resume', session, rec.kind === 'music' ? 'ожидание трека' : 'ожидание фото');
    handle.jobId = rec.job;
    appendStop(wait.row, handle);
    stageBody.append(wait.row, eta.el);
    let resumeStageIdx = 0;
    (async () => {
      try {
        const result = await pollJob(rec.job, { shouldStop: () => handle.cancelled, onStatus: d => {
          // P3 (#35): этапы только вперёд — серверный откат не отматывает прогресс.
          if (!d.stage) return;
          const i = resumeStages.indexOf(d.stage);
          if (i < resumeStageIdx) return;
          resumeStageIdx = i;
          stageBody.querySelector('[data-wait]')?.setAttribute('data-wait-stage', d.stage);
        }, onRetry: retryStatus });
        wait.stop();
        stageBody.closest('.card').remove();
        await finishResumedJob(session, rec, result);
      } catch (error) {
        wait.stop();
        stageBody.closest('.card').remove();
        if (error.name === 'AbortError' || error.code === 'cancelled') {
          const note = card('notice', 'Ожидание остановлено', 'Отменяем задачу на сервере…', session);
          const applyCancelNote = ok => {
            if (ok) settleSessionJob(session, rec.job);
            if (note?.isConnected) note.textContent = ok
              ? 'Задача отменена на сервере — очередь и GPU освобождены.'
              : 'Отменить задачу на сервере не удалось. Проверьте результат в библиотеке.';
          };
          if (handle.serverCancelled === null) handle.onServerCancel = applyCancelNote; else applyCancelNote(handle.serverCancelled);
        } else {
          card('error', 'Ошибка', error.message || 'Неизвестная ошибка.', session);
        }
      } finally { handle.unregister?.(); }
    })();
  }

  // Каждая генерация — независимая: свой контроллер отмены и свой ✕ в карточке.
  // Параллельно можно: писать в чат, запускать новые генерации, менять режимы/модели.
  function makeCancelHandle() {
    const h = { cancelled: false, controller: new AbortController(), stopBtn: null, jobId: null, serverCancelled: null, onServerCancel: null };
    h.stop = () => {
      h.cancelled = true;
      h.controller.abort();
      // T-05: ✕ гасит не только ожидание, но и саму джобу на сервере, иначе
      // стенд дожёвывает GPU вхолостую (POST /jobs/{id}/cancel, есть в bff.py).
      if (h.jobId) {
        request('/jobs/' + encodeURIComponent(h.jobId) + '/cancel', { method: 'POST', headers: headers() })
          .then(() => { h.serverCancelled = true; h.onServerCancel?.(true); })
          .catch(() => { h.serverCancelled = false; h.onServerCancel?.(false); });
      }
    };
    return h;
  }
  // ✕ в строке ожидания: гасит только свою генерацию.
  function appendStop(row, handle) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stage-stop';
    b.setAttribute('aria-label', 'Остановить генерацию');
    b.title = 'Остановить';
    b.textContent = '✕';
    b.addEventListener('click', () => handle.stop());
    row.append(b);
    handle.stopBtn = b;
    return b;
  }

  // T-24: операция с ✕ попадает в реестр (ops.js) — «остановить и выйти» гасит
  // их все: локальный abort + cancel джобы на сервере (T-05). Снятие — в finally.
  function trackedHandle(kind, session, title = '') {
    const handle = makeCancelHandle();
    handle.unregister = BRIIX_OPS.register({ kind, sessionId: session?.id || '', title, stop: () => handle.stop() });
    return handle;
  }

  function setStatus(text, isBusy) {
    // P3 (#35): при оффлайне строка композера не рапортует «готов».
    els.status.textContent = text || (netOnline ? 'готов' : 'нет сети');
    els.status.classList.toggle('busy', Boolean(isBusy));
  }
  // P1-2 (#35): честный статус при сбоях поллинга — не «связь прерывается (n/5)»,
  // а «сервер не отвечает на статус, продолжаем ждать» без обещанной сдачи после 5.
  function retryStatus(n, waitMs) {
    setStatus(n
      ? 'Сервер не отвечает на статус, продолжаем ждать (сбой ' + n + ', пауза ' + Math.max(1, Math.round((waitMs || 0) / 1000)) + ' с)…'
      : 'Работаем…', true);
  }

  function currentAssistant() {
    if (mode === 'photo') return ASSISTANTS.photo.find(a => a.id === assistantId.photo) || ASSISTANTS.photo[0];
    // Музыкальный фокус: роль — свойство активной сессии (#35 P2-1).
    const id = activeSession?.assistantId;
    return CHAT_ROLES.find(a => a.id === id) || CHAT_ROLES[0];
  }

  function meta() {
    const bits = [location.hostname, MODE_LABELS[mode]];
    if (mode === 'music') bits.push(MODEL_LABELS[quality]);
    else bits.push(currentAssistant().name.replace(/\s*\(.*\)\s*$/, ''));
    els.metaLeft.textContent = bits.join(' · ');
  }

  // ---- дропдауны ------------------------------------------------------------
  function closeMenus() {
    document.querySelectorAll('.menu').forEach(m => { m.hidden = true; });
    document.querySelectorAll('[aria-haspopup="menu"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }

  function attachMenu(chip, menu, buildItems) {
    chip.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = menu.hidden;
      closeMenus();
      if (!willOpen) return;
      menu.innerHTML = '';
      for (const item of buildItems()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitemradio');
        button.setAttribute('aria-checked', String(item.selected));
        button.tabIndex = -1;
        const label = document.createElement('span');
        label.textContent = item.label;
        button.append(label);
        if (item.sub) { const sub = document.createElement('span'); sub.className = 'sub'; sub.textContent = item.sub; button.append(sub); }
        button.addEventListener('click', () => { closeMenus(); item.onPick(); chip.focus(); });
        menu.append(button);
      }
      menu.hidden = false;
      chip.setAttribute('aria-expanded', 'true');
      menu.querySelector('button')?.focus();
    });
  }
  document.addEventListener('click', closeMenus);
  document.addEventListener('keydown', e => {
    const menu = e.target.closest?.('.menu:not([hidden])');
    if (e.key === 'Escape') {
      const opener = document.querySelector('[aria-haspopup="menu"][aria-expanded="true"]');
      closeMenus();
      opener?.focus();
      return;
    }
    if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(e.key)) return;
    if (e.key === 'Tab') { closeMenus(); return; }
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    if (!items.length) return;
    e.preventDefault();
    const index = items.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next].focus();
  });

  attachMenu(els.assistantChip, els.assistantMenu, () => (mode === 'photo' ? ASSISTANTS.photo : CHAT_ROLES).map(a => ({
    label: a.name, selected: a.id === (mode === 'photo' ? assistantId.photo : activeSession?.assistantId),
    onPick: () => {
      // #35 W1-2: смена роли НЕ обнуляет историю — единый диалог, новый system-промпт;
      // смена видима системной карточкой в ленте.
      if (mode === 'photo') assistantId.photo = a.id;
      else if (activeSession) {
        if (activeSession.assistantId !== a.id) {
          activeSession.assistantId = a.id;
          card('notice', 'Роль переключена', 'Дальше отвечает: ' + a.name + '. История диалога сохранена.');
          feedPush({ t: 'notice', who: 'Роль', text: 'Дальше отвечает: ' + a.name }, activeSession);
          persistSessions();
        }
      }
      renderChrome();
    }
  })));
  attachMenu(els.modelChip, els.modelMenu, () => {
    // Честная карточка модели (F-59): идентификатор + замеренный ориентир +
    // статус из каталога. Каталог может быть не загружен — тогда без статуса.
    loadCatalog();
    return Object.keys(MUSIC_MODELS).map(q => {
      const id = MUSIC_MODELS[q];
      const cat = BRIIX_CATALOG.model(id);
      const etaS = BRIIX_CATALOG.etaSeconds(id);
      const bits = [id];
      if (etaS) bits.push('~' + fmtMinutes(etaS));
      if (cat && !cat.ready) bits.push('недоступна');
      return { label: MODEL_LABELS[q], sub: bits.join(' · '), selected: q === quality, onPick: () => { setQuality(q); } };
    });
  });

  // ---- карточки ленты ---------------------------------------------------------
  // Автоскролл только когда лента у низа: читающие выше не выдёргиваются.
  // force — для нового сообщения пользователя (всегда показываем его).
  function isFeedNearBottom() {
    return els.feed.scrollHeight - els.feed.scrollTop - els.feed.clientHeight < 140;
  }
  function scrollFeed(force = false) {
    if (force || isFeedNearBottom()) els.feed.scrollTop = els.feed.scrollHeight;
  }

  // ---- F-39: пилюля «↓ N новых» ----------------------------------------------
  // Читатель выше низа ленты не пропускает готовые треки/фото: пока он не у
  // низа, живые (не restore) карточки считаются, пилюля у нижней границы
  // ленты ведёт к ним. Убранные карточки (stage → результат) счёт уменьшают.
  let newBelowPill = null;
  const newBelowCards = new Set();
  function ensurePill() {
    if (!newBelowPill) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.id = 'newBelow';
      pill.className = 'new-below';
      pill.hidden = true;
      pill.addEventListener('click', () => { scrollFeed(true); });
      newBelowPill = pill;
    }
    els.feed.append(newBelowPill); // append переносит узел в конец — за карточками сессии
    return newBelowPill;
  }
  function paintPill() {
    const n = newBelowCards.size;
    if (!n || isFeedNearBottom() || els.feed.hidden) {
      newBelowCards.clear();
      if (newBelowPill) newBelowPill.hidden = true; // пустой счёт не создаёт узел
      return;
    }
    const pill = ensurePill();
    pill.textContent = '↓ ' + n + (n === 1 ? ' новое' : ' новых');
    pill.setAttribute('aria-label', n === 1 ? 'К новому сообщению в ленте' : 'К ' + n + ' новым сообщениям в ленте');
    pill.hidden = false;
  }
  // Уход карточки (stage снят, ошибка убрана) уменьшает счёт; свои сообщения
  // пользователь видит всегда (force-скролл) — их не считаем.
  function noteNewCard(cardEl) {
    newBelowCards.add(cardEl);
    paintPill();
  }
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => {
      let changed = false;
      for (const el of newBelowCards) if (!el.isConnected) { newBelowCards.delete(el); changed = true; }
      if (changed) paintPill();
    }).observe(els.feed, { childList: true, subtree: true });
  }
  els.feed.addEventListener('scroll', () => { if (isFeedNearBottom() && newBelowCards.size) paintPill(); }, { passive: true });

  // Флаг «идёт восстановление истории»: старые карточки не считаются новыми.
  let restoringFeed = false;

  function card(kind, who, text, session = activeSession) {
    const div = document.createElement('div');
    div.className = 'card ' + kind;
    if (kind === 'stage') div.setAttribute('role', 'status'); // F-50: карточка ожидания объявляется скринридеру
    const whoEl = document.createElement('div');
    whoEl.className = 'who';
    whoEl.textContent = who;
    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = text || '';
    div.append(whoEl, body);
    const root = session && rootFor(session);
    (root || els.feed).append(div);
    if (session === activeSession) {
      if (kind === 'user') scrollFeed(true);
      else if (kind !== 'stage' && !restoringFeed) {
        // читатель у низа — едем за карточкой; выше низа — пилюля (F-39)
        if (isFeedNearBottom()) scrollFeed();
        else noteNewCard(div);
      } else scrollFeed(kind === 'user');
    }
    return body;
  }

  // ---- T-39: стрим без layout thrash -----------------------------------------
  // Чанки копятся и применяются ОДНИМ requestAnimationFrame — один reflow на
  // кадр вместо записи+чтения геометрии на каждый токен. Автоскролл — только
  // если на момент кадра читатель был у низа, и тоже не чаще кадра.
  function streamSink(textSpan, wait) {
    let buffer = '', rafId = 0, first = true;
    const flush = () => {
      rafId = 0;
      if (!buffer) return;
      const stick = isFeedNearBottom(); // геометрию читаем ДО записи текста
      if (first && wait?.isConnected) { wait.remove(); first = false; }
      textSpan.textContent += buffer;
      buffer = '';
      if (stick) els.feed.scrollTop = els.feed.scrollHeight;
    };
    return {
      push(piece) {
        buffer += piece;
        if (!rafId) rafId = requestAnimationFrame(flush);
      },
      // Досрочно применить накопленное (отмена/ошибка): недоставленный текст
      // не должен пропасть из-за того, что кадр не успел наступить.
      sync() { if (rafId) { cancelAnimationFrame(rafId); flush(); } },
      dispose() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }
    };
  }

  // Мини-спиннер + ротация фраз живого ожидания (wait-ui.js). Клик по ленте не нужен:
  // блок сам исчезает, когда приходит результат.
  function waitLine(type, stage) {
    const line = document.createElement('div');
    line.className = 'wait-line';
    const spin = document.createElement('span');
    spin.className = 'wait-spin';
    const phrase = document.createElement('span');
    phrase.setAttribute('data-wait', '');
    phrase.setAttribute('data-wait-type', type);
    if (stage) phrase.setAttribute('data-wait-stage', stage);
    line.append(spin, phrase);
    return line;
  }

  // Секундомер stage-карточки: «М:СС» с табличными цифрами (CSS .stage-elapsed).
  function fmtElapsed(ms) {
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  // Человекочитаемые минуты для ориентира: «минуту» / «2 минуты» / «10 минут».
  function fmtMinutes(seconds) {
    const m = Math.round(seconds / 60);
    if (m <= 1) return 'минуту';
    const plural = m % 10 >= 2 && m % 10 <= 4 && (m % 100 < 10 || m % 100 >= 20) ? 'ы' : '';
    return m + ' минут' + plural;
  }
  // Тональная зона фраз (F-62): 0–30 с — ранний тон, 30–180 с — рабочий, дальше — долгий.
  function waitZone(ms) { return ms < 30000 ? 'early' : ms < 180000 ? 'mid' : 'late'; }
  // Честный ориентир ожидания из каталога моделей (F-59): не процент и не обещание,
  // а замер стенда + мягкая шкала «прошло X из ~Y». Превышение ×1,5 — смена тона.
  function etaNote(modelId, humanLabel) {
    const el = document.createElement('div');
    el.className = 'stage-eta';
    const sec = typeof BRIIX_CATALOG !== 'undefined' ? BRIIX_CATALOG.etaSeconds(modelId) : null;
    if (!sec) { el.hidden = true; return { el, seconds: null, update: () => {} }; }
    const approx = fmtMinutes(sec);
    const base = 'Ориентир: ~' + approx + (humanLabel ? ' (' + humanLabel + ')' : '') + ' — по замеру сервера.';
    el.textContent = base;
    let shownLate = false;
    return {
      el, seconds: sec,
      update(ms) {
        const late = ms > sec * 1500;
        if (late !== shownLate) { shownLate = late; el.classList.toggle('late', late); }
        el.textContent = late
          ? 'Дольше обычного (~' + approx + '). Задача продолжается на сервере и появится в библиотеке — можно подождать или остановить (✕).'
          : (ms < 20000 ? base : 'Прошло ' + fmtElapsed(ms) + ' из ~' + approx + '.');
      }
    };
  }
  // wait-line + секундомер в один ряд; таймер чистится при удалении карточки.
  // onTick — подписка на ежесекундный тик (ориентир F-59 обновляется тем же тиком);
  // он же переводит фразы в тональную зону по времени (F-62).
  function waitRow(type, stage, { onTick } = {}) {
    const t0 = Date.now();
    const elapsed = document.createElement('span');
    elapsed.className = 'stage-elapsed';
    elapsed.textContent = fmtElapsed(0);
    const row = document.createElement('div');
    row.className = 'wait-row';
    row.append(waitLine(type, stage), elapsed);
    const phrase = () => row.querySelector('[data-wait]');
    const timer = setInterval(() => {
      const ms = Date.now() - t0;
      elapsed.textContent = fmtElapsed(ms);
      const p = phrase();
      if (p && p.dataset.waitMock !== '1') {
        const zone = waitZone(ms);
        if (p.dataset.waitZone !== zone) p.dataset.waitZone = zone; // смена зоны обновляет фразу
      }
      onTick?.(ms);
    }, 1000);
    return { row, stop: () => clearInterval(timer) };
  }

  // F-55: заголовок карточки ошибки называет тип неполадки — не всё «Ошибка».
  function errorTitle(error) {
    if (error.code === 'network') return 'Нет соединения';
    if (error.code === 'unauthorized') return 'Ключ';
    if (error.code === 'queue_full' || error.code === 'unavailable') return 'Сервер перегружен';
    if (error.code === 'job_gone' || error.code === 'expired') return 'Файл устарел';
    if (error.code === 'timeout') return 'Долго нет ответа';
    if (error.code === 'watch_expired') return 'Наблюдение прервано';
    if (error.code === 'bad_response' || error.code === 'empty_stream') return 'Сервер ответил странно';
    return 'Ошибка';
  }
  function errorCard(error, session = activeSession) {
    if (error.name === 'AbortError' || error.code === 'cancelled') {
      card('notice', 'Остановлено', 'Генерацию остановили — текст остался в поле, можно править и запустить снова.', session);
      return;
    }
    if (error.code === 'content_blocked') {
      const body = card('error', 'Модерация', 'Не пройдена проверка контента: ' + (error.message || 'запрос нарушает политику.') + ' Текст сохранён в поле ввода — отредактируйте и попробуйте снова.', session);
      body.dataset.code = 'content_blocked';
      return;
    }
    if (error.code === 'unauthorized' && session === activeSession) { els.keyCard.hidden = false; els.keyInput.focus(); }
    const support = error.requestId ? ' Код запроса для поддержки: ' + error.requestId + '.' : '';
    // F-54: что случилось → что сделать; F-55: тип в заголовке.
    const hint = error.code === 'network' ? ' Проверьте интернет и попробуйте снова.'
      : error.code === 'not_found' || error.code === 'job_gone' ? ' Нажмите «Повторить с правками», чтобы сгенерировать заново.'
      : '';
    card('error', errorTitle(error), (error.message || 'Неизвестная ошибка.') + hint + support, session);
  }

  async function repeatMusic(entry, input) {
    if (storageBlocked) return;
    const has = v => typeof v === 'string' && v.trim();
    // F-20: пустой input (серверный трек без локальной сессии) не должен затирать
    // черновик пользователя пустотой — источник собирается из того, что сохранилось.
    const source = (input && (has(input.prompt) || has(input.lyrics)))
      ? { ...input, prompt: input.prompt || entry.prompt || '', lyrics: input.lyrics || entry.lyrics || '', model: input.model || entry.model || '', instrumental: input.instrumental ?? !!entry.instrumental }
      : { prompt: entry.prompt || '', lyrics: entry.lyrics || '', model: entry.model || '', instrumental: !!entry.instrumental };
    if (!has(source.prompt) && !has(source.lyrics)) {
      card('notice', 'Повтор с правками', 'Для этого трека не сохранилось ни промпта, ни лирики — повторять не с чем. Текущий черновик не тронут.');
      return;
    }
    if (input && (has(input.prompt) || has(input.lyrics))) {
      // inputComplete === false — флаг старых записей библиотеки; у карточек ленты
      // полного снимка input считается полным.
      if (entry.inputComplete === false && !(await BRIIX_TOASTS.confirmDialog({ title: 'Повтор с правками', body: 'Данные старого трека могут быть неполными: промпт мог быть сокращён. Продолжить с тем, что сохранилось?', confirmLabel: 'Продолжить' }))) return;
    } else {
      // Серверная запись: промпт обрезан до 200 знаков, лирика — до лимита сервера.
      const what = has(source.prompt) && has(source.lyrics) ? 'промпт и лирика (возможно, сокращённые)'
        : (has(source.prompt) ? 'только промпт (' + source.prompt.length + ' зн. — сервер хранит сокращённую версию)' : 'только лирика');
      if (!(await BRIIX_TOASTS.confirmDialog({ title: 'Повтор с правками', body: 'Для этого трека сохранился ' + what + '. Продолжить с тем, что есть?', confirmLabel: 'Продолжить' }))) return;
    }
    const musicDraft = mode === 'music' ? (els.prompt.value || els.musicPrompt.value || els.lyrics.value) : (drafts.music || els.musicPrompt.value || els.lyrics.value);
    if (musicDraft.trim() && !(await BRIIX_TOASTS.confirmDialog({ title: 'Заменить черновик?', body: 'Текущий музыкальный черновик будет заменён данными этого трека. Прежний текст можно вернуть кнопкой ↩ после «Улучшить», но лучше скопировать его сейчас.', confirmLabel: 'Заменить', danger: true }))) return;
    setView('chat'); setMode('music'); advanced = true;
    els.musicPrompt.value = source.prompt || ''; els.lyrics.value = source.lyrics || '';
    instrumental = !!source.instrumental;
    quality = Object.keys(MUSIC_MODELS).find(key => MUSIC_MODELS[key] === source.model) || quality;
    // P2-4 аудита #35: parentJobId живёт до следующего явного запуска генерации
    // ИМЕННО этой сессии (pendingRepeats по id сессии), не съедается чужой
    // генерацией и не переживает перезагрузку как липкое поле сессии.
    pendingRepeats.set(activeSession.id, { jobId: entry.job, at: Date.now() });
    renderChrome(); els.musicPrompt.focus();
    card('notice', 'Повтор с правками', 'Проверьте и измените данные перед отправкой. Это новая генерация по тексту, не аудиоремикс.');
  }
  async function createCoverDraft(entry) {
    if (storageBlocked) return;
    const photoDraft = mode === 'photo' ? els.prompt.value : drafts.photo;
    if (photoDraft.trim() && !(await BRIIX_TOASTS.confirmDialog({ title: 'Заменить черновик изображения?', body: 'Текущий текст запроса будет заменён заготовкой обложки. Прежний текст лучше скопировать сейчас.', confirmLabel: 'Заменить', danger: true }))) return;
    setView('chat'); setMode('photo');
    els.prompt.value = 'Обложка для трека: ' + (entry.title || entry.prompt || '').slice(0, 200);
    renderChrome(); els.prompt.focus();
    card('notice', 'Отдельное изображение', 'Отредактируйте запрос и отправьте его. Картинка появится отдельно и не заменит обложку трека или скачиваемого файла.');
  }

  // ---- карточка трека: обложка = PLAY, единое меню «⋯», transparency ----------
  // Серверные пики волны: /files/{id}-peaks.json (контракт для INFRA — параллельная
  // задача; нет пиков — карточка тихо живёт на нативном плеере).
  function fetchPeaks(job) {
    return request('/files/' + encodeURIComponent(job) + '-peaks.json', { headers: headers() })
      .then(r => r.json())
      .then(raw => {
        // Контракт server-contract/README: пики приходят объектом с полем peaks;
        // ранние стенды отдавали голый массив — принимаем обе формы (T-01).
        const peaks = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.peaks) ? raw.peaks : null);
        if (!peaks || !peaks.length) throw new Error('Пики недоступны.');
        return peaks;
      });
  }
  // T-37: пики кэшируются в памяти (успех и отказ) — восстановление сессии с
  // 20 треками больше не даёт лавину параллельных запросов, а 404 не
  // повторяется при каждом пересоздании карточки.
  const peaksCache = new Map();
  function peaksFor(job) {
    let rec = peaksCache.get(job);
    if (!rec) {
      rec = fetchPeaks(job); // резолвит массив пиков
      peaksCache.set(job, rec);
      rec.catch(() => {}); // отказ кэшируется: тихая деградация без повторных запросов
    }
    return rec;
  }
  // Обложка — единый рендер-путь для fresh и restore: если аудио ещё не загружено
  // (restore после перезагрузки страницы), клик по обложке запускает загрузку и
  // сразу play по готовности; иначе это обычный play/pause-тоггл.
  function makeCoverPlayable(frame, state, ensureLoaded) {
    if (!frame || frame.dataset.playBound) return;
    frame.dataset.playBound = '1';
    frame.classList.add('playable');
    frame.setAttribute('role', 'button');
    frame.setAttribute('aria-label', 'Слушать трек');
    frame.tabIndex = 0;
    let started = false;
    const toggle = () => {
      if (!state.audio) {
        if (started) return;
        started = true;
        frame.classList.add('loading');
        ensureLoaded().then(audio => audio.play().catch(() => {}))
          .catch(() => {})
          .finally(() => { started = false; frame.classList.remove('loading'); });
        return;
      }
      if (state.audio.paused) state.audio.play().catch(() => {}); else state.audio.pause();
    };
    frame.addEventListener('click', toggle);
    frame.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }

  // P3 #35: jobId → ленивая загрузка карточки ленты. restoreMiniPlayer доигружает
  // последний игравший трек после перезагрузки: карточка претендует на аудио
  // (BriixPlayer.claim) — мини-плеер возвращается вpaused-состоянии, звук сам
  // не включается.
  const feedCardLoaders = new Map();
  function restoreMiniPlayer() {
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem('briix-mini-last') || 'null'); } catch { return; }
    const job = saved && saved.job;
    if (!job) return;
    const load = feedCardLoaders.get(job);
    if (load) load().catch(() => { /* карточка недоступна — плеер не показываем */ });
  }
  // Единый рендер трек-карточки (лента fresh/restore и Библиотека — один компонент,
  // класс-маркер .track-card): обложка (или внешняя мини-обложка), название трека
  // заголовком (F-18), волна из серверных пиков (сразу, до загрузки аудио),
  // аудио-фолбэк, transparency, меню «⋯».
  function buildTrackCard({ job, cover, input = {}, file, loadBlob, coverFrame, menuItems }) {
    const wrap = document.createElement('div');
    wrap.className = 'track-card';
    let frame = coverFrame || null;
    if (!frame) {
      addTrackCover(wrap, job, cover);
      frame = wrap.querySelector('.track-cover');
    }
    // П3 SPEC #35: у каждой карточки трека — блок обложки со честным статусом.
    // «Генерируется» показывает stage-карточка; готовый трек без cover_url —
    // видимая плашка, не молчаливый placeholder «как будто всё нормально».
    if (!cover) {
      const coverStatus = document.createElement('div');
      coverStatus.className = 'cover-status';
      coverStatus.setAttribute('role', 'status');
      coverStatus.textContent = 'Обложка не сгенерировалась — генерация не удалась на сервере';
      wrap.append(coverStatus);
    }
    // F-18: название трека видно сразу — раньше его не было в интерфейсе вовсе
    // (только внутри свёрнутого transparency-блока).
    const trackTitle = String(input.title || input.prompt || '').slice(0, 120).trim();
    if (trackTitle) {
      const titleEl = document.createElement('div');
      titleEl.className = 'track-title';
      titleEl.textContent = trackTitle;
      wrap.append(titleEl);
    }
    const waveSlot = document.createElement('div');
    waveSlot.className = 'waveform-track';
    const waveHolder = document.createElement('div');
    waveHolder.className = 'waveform-holder'; // min-height: пустой холдер всё равно «интерсектится» (T-37)
    // F-25: таймкоды «текущее / длительность» под волной (формат — BriixPlayer.fmtTime).
    const timeEl = document.createElement('div');
    timeEl.className = 'waveform-time';
    timeEl.setAttribute('aria-hidden', 'true');
    waveSlot.append(waveHolder, timeEl);
    const placeholder = document.createElement('div');
    placeholder.className = 'waveform-ph';
    placeholder.setAttribute('aria-hidden', 'true');
    waveHolder.append(placeholder);
    wrap.append(waveSlot);
    const audioSlot = document.createElement('div');
    audioSlot.hidden = true;
    wrap.append(audioSlot);
    addMusicDetails(wrap, input);
    let cardBlob = null;
    const ctx = { job, input, file, get blob() { return cardBlob; } };
    addTrackMenu(wrap, ctx, menuItems);
    const state = { audio: null };
    // Волна из пиков строится сразу при карточке — до загрузки аудио (решение
    // владельца 14.11: сервер отдаёт /files/{id}-peaks.json, посчитанный из WAV).
    // Нет пиков (старые треки) — тихо остаётся нативный плеер, шимер убирается.
    let wave = null;
    const loadError = document.createElement('div');
    loadError.className = 'load-error';
    // T-37: пики идут через кэш (успех и отказ кэшируются — 404 не повторяется
    // при каждом пересоздании карточки). Observer-гейтинг опробован и отложен:
    // конфликтует со scroll-restoration при восстановлении длинных лент.
    const attachWave = () => peaksFor(job).then(peaks => {
      if (!frame.isConnected) throw new Error('Карточка недоступна.');
      placeholder.remove();
      wave = BriixWaveform.attachFromPeaks(peaks, waveHolder, {
        onSeekPending: () => { if (!state.audio) ensureLoaded(); } // seek до загрузки — грузим трек
      });
      if (state.audio) wave.setAudio(state.audio);
    }).catch(error => {
      console.warn('BRIIX waveform: пики недоступны (' + job + ') — только нативный плеер.', error?.message || error);
      placeholder.remove();
    });
    attachWave();
    let pending = null;
    const ensureLoaded = () => pending ||= (async () => {
      try {
        // T-30/T-31: блоб и objectURL трека — в общем LRU-кэше: повторное
        // воспроизведение и «Скачать» не создают новых URL (A12).
        const entry = await mediaEnsure(file, loadBlob);
        if (!frame.isConnected || currentUser() !== sessionProfile?.nick) throw new BusError('cancelled', 'Карточка недоступна.');
        cardBlob = entry.blob;
        loadError.remove();
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.controlsList = 'nodownload'; // скачивание только через меню «⋯»: имя «Название - Исполнитель»
        audio.preload = 'metadata';
        audio.src = entry.url;
        audioSlot.hidden = false;
        audioSlot.append(audio);
        placeholder.remove();
        if (wave) wave.setAudio(audio);
        state.audio = audio;
        BriixPlayer.claim(audio, { // T-51/R1: эксклюзивный транспорт + MediaSession
          title: input.title || '',
          artist: input.artist || currentUser(),
          artwork: cover || ''
        });
        // F-25: таймкоды обновляются событиями аудио, табличные цифры не пляшут.
        const paintTime = () => {
          timeEl.textContent = BriixPlayer.fmtTime(audio.currentTime)
            + ' / ' + BriixPlayer.fmtTime(Number.isFinite(audio.duration) ? audio.duration : 0);
        };
        audio.addEventListener('timeupdate', paintTime);
        audio.addEventListener('loadedmetadata', paintTime);
        audio.addEventListener('durationchange', paintTime);
        paintTime();
        // P4 (#35): сервер вернул трек длиннее запрошенного — расхождение
        // называется честно в карточке (фактическая длительность и так видна
        // в таймкоде, но «дольше, чем заказывали» выделяем отдельно).
        // Поле lengthHint — только клиентская память о заказанной длине;
        // в params/запросах длительность по-прежнему не отправляется (SPEC).
        audio.addEventListener('loadedmetadata', () => {
          const requested = Number(input.lengthHint);
          if (!Number.isFinite(requested) || requested <= 0 || !(audio.duration > requested + 2)) return;
          let note = wrap.querySelector('.length-note');
          if (!note) {
            note = document.createElement('div');
            note.className = 'length-note';
            note.setAttribute('role', 'status');
            wrap.append(note);
          }
          note.textContent = 'Трек длиннее запрошенного: фактически ' + BriixPlayer.fmtTime(audio.duration)
            + ' при заказанных ' + BriixPlayer.fmtTime(requested) + '.';
        });
        audio.addEventListener('play', () => {
          frame.classList.add('playing');
          frame.setAttribute('aria-label', 'Пауза');
          // P3 #35: запоминаем последний игравший трек — после перезагрузки
          // мини-плеер возвращается к нему (restoreMiniPlayer).
          if (job) { try { sessionStorage.setItem('briix-mini-last', JSON.stringify({ job, at: Date.now() })); } catch { /* приватный режим */ } }
        });
        audio.addEventListener('pause', () => { frame.classList.remove('playing'); frame.setAttribute('aria-label', 'Слушать трек'); });
        return audio;
      } catch (error) {
        pending = null; // обложка остаётся кнопкой повтора
        if (frame.isConnected && currentUser() === sessionProfile?.nick) {
          loadError.textContent = 'Файл недоступен. ' + (error.message || '') + ' Нажмите на обложку — попробуем загрузить ещё раз.';
          waveSlot.append(loadError);
        }
        throw error;
      }
    })();
    makeCoverPlayable(frame, state, ensureLoaded);
    // P3 #35: реестр ленивых загрузок карточек ленты — для восстановления
    // мини-плеера после перезагрузки (без автозвука: аудио остаётся на паузе).
    if (job) feedCardLoaders.set(job, ensureLoaded);
    return { body: wrap, ensureLoaded };
  }

  // Ленточная обёртка единого компонента (fresh и restore).
  function renderTrackCard(session, opts) {
    // card() скроллит ещё пустую карточку; после наполнения она вырастает —
    // если читатель был у низа, доводим до низа ещё раз, иначе волна, ждущая
    // вьюпорта (T-37), остаётся за складкой.
    const stick = els.feed.scrollHeight - els.feed.scrollTop - els.feed.clientHeight < 140;
    const body = card('assistant', opts.who, '', session);
    const t = buildTrackCard(opts);
    body.append(t.body);
    if (stick) scrollFeed(true);
    return { body, ensureLoaded: t.ensureLoaded };
  }

  // Имя файла трека: «Название - Исполнитель.ext» с сохранением юникода (кириллица
  // разрешена), спецсимволы файловой системы вырезаются, пустой результат — fallback.
  function safeFileName(title, artist, ext) {
    const clean = s => String(s || '')
      .replace(/[/\\:*?"<>|#%&{}$!'@+=`\u0301]/g, ' ')
      .replace(/\.{2,}/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '');
    const safe = clean(clean(title) + ' - ' + clean(artist));
    return (safe || 'briix-track-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')) + '.' + ext;
  }

  // F-22: единое правило имени файла для ленты и Библиотеки — «что скачано»
  // не зависит от того, из какой части интерфейса нажали «Скачать».
  // #35 W1-4: variant (wav|m4a|png) дизамбигует расширение по ЗАПРОШЕННОМУ
  // варианту экспорта, а не только по blob.type (пустой type у mp3 больше
  // не даёт .m4a — P3-3 аудита #35).
  function mediaFileName(kind, meta, blob, variant) {
    if (kind === 'music') {
      const title = String(meta.title || meta.prompt || '').trim();
      return safeFileName(title.length > 2 ? title : 'BRIIX track', meta.artist || currentUser(), variant || extOf(blob));
    }
    return 'briix-photo-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.' + (variant || extOf(blob));
  }

  async function copyText(value, label) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      BRIIX_TOASTS.toast('Скопировано: ' + label, { kind: 'done' }); // F-38: видно при любом скролле
    } catch {
      BRIIX_TOASTS.toast('Не удалось скопировать: ' + label + '. Выделите текст и нажмите Ctrl+C.', { kind: 'error' });
    }
  }

  function libEntry(job) { return libLoad().find(x => x.job === job); }

  // Единое меню «⋯» карточки трека: 7 действий вместо россыпи кнопок.
  // Мобильный — bottom-sheet (CSS), десктоп — dropdown у кнопки.
  function attachTrackMenu(button, menu, buildItems) {
    button.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = menu.hidden;
      closeMenus();
      if (!willOpen) return;
      menu.innerHTML = '';
      for (const item of buildItems()) {
        const itemButton = document.createElement('button');
        itemButton.type = 'button';
        itemButton.setAttribute('role', 'menuitem');
        itemButton.tabIndex = -1;
        itemButton.textContent = item.label;
        if (item.danger) itemButton.classList.add('danger');
        itemButton.addEventListener('click', () => { closeMenus(); item.onPick(); button.focus(); });
        menu.append(itemButton);
      }
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      menu.querySelector('button')?.focus();
    });
  }

  // Человекочитаемый размер файла для тостов (F-38/F-21).
  function fmtBytes(n) {
    if (!Number.isFinite(n)) return '';
    if (n < 1024) return n + ' Б';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' КБ';
    return (n / (1024 * 1024)).toFixed(1).replace('.', ',') + ' МБ';
  }

  function trackMenuItems(cardEl, ctx) {
    const input = ctx.input || {};
    const download = async () => {
      try {
        // T-30: URL из LRU-кэша — повторные скачивания не плодят objectURL (A12).
        const entry = ctx.blob
          ? await mediaEnsure(ctx.file || input.file, () => ctx.blob)
          : await mediaEnsure(ctx.file || input.file, () => fileBlob(ctx.file || input.file));
        const name = mediaFileName('music', input, entry.blob); // F-22: единое правило имени
        const link = document.createElement('a');
        link.href = entry.url;
        link.download = name;
        document.body.append(link); link.click(); link.remove();
        BRIIX_TOASTS.toast('Скачано: ' + name + ' (' + fmtBytes(entry.blob.size) + ')', { kind: 'done', key: 'download' }); // F-38
      } catch (error) { errorCard(error); }
    };
    // #35 W1-4: варианты экспорта. WAV/MP3 собирает сервер; пока бэфф не отдаёт
    // .wav — честная ошибка, без фейков (SPEC §3: клиент обязан деградировать).
    const downloadExport = async (path, ext, label) => {
      try {
        const blob = await fileBlob(path, 1);
        const name = mediaFileName('music', input, blob, ext);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = name;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        BRIIX_TOASTS.toast('Скачано: ' + name + ' (' + fmtBytes(blob.size) + ')', { kind: 'done', key: 'download' });
      } catch (error) {
        const why = error.code === 'not_found' || error.status === 404
          ? 'сервер пока не отдаёт этот формат (нет файла) — доступно M4A'
          : (error.message || 'ошибка загрузки');
        BRIIX_TOASTS.toast(label + ': ' + why, { kind: 'error' });
      }
    };
    const downloadWav = () => downloadExport('/files/' + encodeURIComponent(ctx.job) + '.wav', 'wav', 'WAV-мастер');
    const downloadCover = () => {
      const coverPath = libEntry(ctx.job)?.cover || '/files/' + encodeURIComponent(ctx.job) + '-cover.png';
      return downloadExport(coverPath, 'png', 'Обложка');
    };
    const favorite = () => {
      const entry = libEntry(ctx.job);
      return {
        label: entry?.fav ? 'Убрать из избранного' : 'В избранное',
        onPick: async () => {
          const next = !(entry?.fav);
          const list = libLoad();
          const item = list.find(x => x.job === ctx.job);
          if (item) {
            if (item.server) { // серверная запись — флаг на шине (infra#77)
              try {
                await request('/jobs/' + encodeURIComponent(ctx.job) + '/favorite', {
                  method: 'POST', headers: headers(), body: JSON.stringify({ favorite: next })
                });
              } catch (error) { errorCard(error); return; }
            }
            item.fav = next; libSave(list);
            libApplyFav(ctx.job, next); // T-36: точечная мутация карточки Библиотеки
          } else if (next) {
            libAdd({ job: ctx.job, sessionId: activeSession?.id, kind: 'music', prompt: input.prompt || '',
              lyrics: input.lyrics || '', title: input.title || '', file: ctx.file || '', cover: '', created: Date.now(), fav: true });
          }
          jobsInFlight.clear(); // серверный favorite изменился — при следующем рендере перечитать
        }
      };
    };
    const remove = {
      label: 'Удалить', danger: true,
      onPick: async () => {
        // F-23: подтверждение объясняет, что реально происходит с записью и файлом.
        const serverEntry = libEntry(ctx.job)?.server;
        const ok = await BRIIX_TOASTS.confirmDialog({
          title: 'Удалить трек из библиотеки?',
          body: serverEntry
            ? 'Серверная запись будет удалена и на сервере — скачивание этого файла перестанет работать. Отменить будет нельзя; если файл нужен — сначала скачайте его.'
            : 'Запись исчезнет из библиотеки этого браузера. Файл на сервере не трогаем — карточка останется в ленте, пока жива сессия.',
          confirmLabel: 'Удалить', danger: true
        });
        if (!ok) return;
        const item = libEntry(ctx.job);
        if (item?.server) {
          try { await request('/jobs/' + encodeURIComponent(ctx.job), { method: 'DELETE', headers: headers() }); }
          catch (error) { errorCard(error); return; }
        }
        libSave(libLoad().filter(x => x.job !== ctx.job));
        if (ctx.file) mediaCacheDrop(mediaKey(ctx.file)); // T-30: кэш файла тоже чистим
        jobsInFlight.clear();
        libControls.get(ctx.job)?.removeSelf(); // T-36: без пересборки Библиотеки
        cardEl.remove();
      }
    };
    return [
      { label: 'Копировать промпт', onPick: () => copyText(input.promptSent || input.prompt || '', 'промпт') },
      { label: 'Копировать лирику', onPick: () => copyText(input.lyrics || '', 'лирика') },
      { label: 'Скачать аудио (M4A)', onPick: download },
      { label: 'Скачать WAV — мастер без тегов', onPick: downloadWav },
      { label: 'Скачать обложку', onPick: downloadCover },
      { label: 'Повторить с правками', onPick: () => repeatMusic({ job: ctx.job }, input) },
      { label: 'Создать обложку', onPick: () => createCoverDraft({ title: input.title || input.prompt || '', prompt: input.prompt || '' }) },
      favorite(),
      remove
    ];
  }

  function addTrackMenu(cardEl, ctx, itemsBuilder) {
    const row = cardEl.querySelector(':scope > .actions') || (() => {
      const created = document.createElement('div'); created.className = 'actions'; cardEl.append(created); return created;
    })();
    const anchor = document.createElement('div'); anchor.className = 'menu-anchor track-menu-anchor';
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'action menu-btn';
    button.textContent = '⋯';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Ещё действия');
    const menu = document.createElement('div');
    menu.className = 'menu track-menu'; menu.hidden = true;
    menu.setAttribute('role', 'menu');
    anchor.append(button, menu);
    row.append(anchor);
    attachTrackMenu(button, menu, itemsBuilder || (() => trackMenuItems(cardEl, ctx)));
  }

  // «Сделать из этого трек»: чат → музыка с подставленным брифом.
  function addMakeTrackAction(container, brief) {    const row = document.createElement('div');
    row.className = 'actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action make-track';
    button.textContent = '🎵 Сделать из этого трек';
    button.addEventListener('click', () => {
      setMode('music');
      advanced = false;
      els.prompt.value = brief.trim().slice(0, 2000);
      renderChrome();
    });
    row.append(button);
    container.append(row);
  }

  // Transparency-блок: что уехало в модель (#109) + происхождение лирики и имя/исполнитель.
  function addMusicDetails(container, input) {
    const details = document.createElement('details'); details.className = 'track-details';
    const summary = document.createElement('summary'); summary.textContent = 'Что уехало в модель';
    const text = document.createElement('div');
    let trackInfo = 'Промпт в модель: ' + (input.promptSent || input.prompt || '—');
    if (input.promptSent && input.prompt) trackInfo += '\n\nИсходная идея: ' + input.prompt;
    if (input.title) trackInfo += '\n\nНазвание: ' + input.title;
    if (input.artist) trackInfo += '\nИсполнитель: ' + input.artist;
    trackInfo += '\n\nТекст песни: ' + (input.lyrics || (input.instrumental ? 'Инструментал' : '—'));
    trackInfo += '\n\nИсточник лирики: ' + (input.lyricsSource || (input.instrumental ? 'инструментал' : 'не записан (старая карточка)'));
    text.textContent = trackInfo;
    details.append(summary, text); container.append(details);
  }

  // Кнопка «Скачать» под готовым фото (blob уже в памяти или догрузится).
  // T-30/T-31: URL живёт в общем LRU-кэше; при вытеснении клик перезагружает
  // файл заново — кнопка не ломается и не течёт (одноразовых URL больше нет).
  function extOf(blob) {
    const t = blob.type || '';
    if (t.includes('png')) return 'png';
    if (t.includes('jpeg')) return 'jpg';
    if (t.includes('wav')) return 'wav';
    if (t.includes('mpeg')) return 'mp3';
    return 'm4a'; // audio/mp4 и дефолт
  }
  function addDownloadAction(container, ensure, fileNameFor, label) {
    const row = document.createElement('div');
    row.className = 'actions';
    const link = document.createElement('a');
    link.className = 'action';
    link.href = '#';
    link.title = 'Файл сохранится с понятным именем'; // F-21: видно, что именно будет сохранено
    link.textContent = label || '⬇ Скачать';
    const applyName = blob => {
      const name = fileNameFor(blob);
      link.download = name;
      link.title = name; // F-21
    };
    link.addEventListener('click', async event => {
      event.preventDefault();
      if (link.dataset.busy === '1') return;
      link.dataset.busy = '1';
      try {
        const entry = await ensure(); // { blob, url } — из кэша или повторной загрузкой
        applyName(entry.blob);
        const act = document.createElement('a');
        act.href = entry.url;
        act.download = link.download;
        act.title = link.download;
        document.body.append(act); act.click(); act.remove();
        BRIIX_TOASTS.toast('Скачано: ' + link.download + ' (' + fmtBytes(entry.blob.size) + ')', { kind: 'done', key: 'download' });
      } catch (error) {
        link.textContent = 'Файл недоступен. ' + (error.message || '');
      } finally { link.dataset.busy = ''; }
    });
    row.append(link);
    container.append(row);
    return { link, applyName };
  }

  // Единая фото-карточка (R2/T-18): fresh в ленте, restore после перезагрузки,
  // Библиотека и восстановление готовой джобы — один код: слот, ленивая загрузка
  // по observer, повтор при ошибке, «Скачать» с датой в имени. Прежде тут было
  // четыре почти одинаковых рендера с разным поведением.
  function photoCard({ eagerBlob = null, loadBlob = null, file = '', alt = '' }) {
    const owner = currentUser();
    const photoAltText = alt;
    const wrap = document.createElement('div');
    wrap.className = 'photo-card';
    const slot = document.createElement('div');
    wrap.append(slot);
    // T-30/T-31: блоб фото — в общем LRU-кэше по пути файла: повторные показы
    // и скачивания используют один objectURL (A12), вытеснение ревочит.
    const ensure = () => mediaEnsure(file, () => eagerBlob ? Promise.resolve(eagerBlob) : loadBlob());
    const load = async () => {
      slot.textContent = 'Загружаем файл…';
      try {
        const entry = await ensure();
        if (!slot.isConnected || currentUser() !== owner) return;
        slot.textContent = '';
        const img = new Image();
        img.alt = 'Фото: ' + (photoAltText || 'результат генерации'); // F-51: не безликое «Результат»
        img.className = 'media-in';
        img.decoding = 'async'; // T-40: декодирование не блокирует главный поток
        img.src = entry.url;
        requestAnimationFrame(() => img.classList.add('loaded'));
        slot.append(img);
        // Имя известно сразу после загрузки — пользователь видит его до клика (F-21).
        addDownloadAction(wrap, ensure, blob => mediaFileName('photo', {}, blob)).applyName(entry.blob);
      } catch (error) {
        if (!slot.isConnected || currentUser() !== owner) return;
        slot.textContent = 'Файл недоступен. ' + (error.message || '') + ' ';
        const retry = document.createElement('button');
        retry.type = 'button'; retry.className = 'action';
        retry.textContent = 'Повторить';
        retry.addEventListener('click', load); slot.append(retry);
      }
    };
    // Оба пути через observer: он срабатывает только когда карточка уже в DOM
    // (eager-вызов до подключения молча умирал на isConnected-гарде).
    if (!eagerBlob) slot.textContent = 'Изображение готово';
    const observer = new IntersectionObserver((records, obs) => {
      if (!slot.isConnected) { obs.disconnect(); return; }
      if (records.some(r => r.isIntersecting)) { obs.disconnect(); load(); }
    }, { rootMargin: '150px' });
    observer.observe(slot);
    return { body: wrap };
  }

  // ---- режим/состояния ---------------------------------------------------------
  const drafts = { photo: '', music: '' };
  function setMode(next) {
    if (next === mode) return;
    drafts[mode] = els.prompt.value;
    mode = ['music', 'photo'].includes(next) ? next : 'music';
    els.prompt.value = drafts[mode];
    renderChrome();
  }

  // P2-2 аудита #35: качество — свойство сессии; переключение чипа пишет draft активной сессии.
  function setQuality(q) {
    if (!MUSIC_MODELS[q]) return;
    quality = q;
    if (activeSession) { if (!activeSession.draft) activeSession.draft = {}; activeSession.draft.quality = q; saveDraftSoon(); }
    renderChrome();
  }

  function paintStyleFamilyBadge() {
    const family = activeSession?.draft?.styleFamily;
    if (family) { els.styleFamilyBadge.textContent = 'стиль: ' + family; els.styleFamilyBadge.hidden = false; }
    else els.styleFamilyBadge.hidden = true;
  }

  function renderChrome() {
    els.modes.querySelectorAll('.mode').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    const isMusic = mode === 'music';
    els.studio.classList.toggle('is-advanced', isMusic && advanced);
    document.querySelectorAll('.music-only').forEach(el => { el.hidden = !isMusic; });
    document.querySelectorAll('.chat-only').forEach(el => { el.hidden = true; });
    document.querySelectorAll('.photo-only').forEach(el => { el.hidden = mode !== 'photo'; });
    renderKeyChip();
    els.advanced.hidden = !(isMusic && advanced);
    els.prompt.hidden = isMusic && advanced;
    els.prompt.placeholder = PLACEHOLDERS[mode];
    els.assistantName.textContent = currentAssistant().name.replace(/\s*\(.*\)\s*$/, '');
    els.modelName.textContent = MODEL_LABELS[quality];
    els.vocalSeg.querySelectorAll('.seg-btn').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.vocal) === (instrumental ? 1 : 0))));
    els.tuneToggle.setAttribute('aria-pressed', String(advanced));
    paintStyleFamilyBadge();
    // F-37: подпись зависит от режима (песня/инструментал); на узких экранах
    // виден короткий лейбл, полный — всегда в aria-label и title.
    els.prepareMusic.setAttribute('aria-label', instrumental ? 'Подготовить трек' : 'Подготовить песню');
    const prepareFull = els.prepareMusic.querySelector('.lbl-full');
    if (prepareFull) prepareFull.textContent = instrumental ? '✦ Подготовить трек' : '✦ Подготовить песню';
    else els.prepareMusic.textContent = instrumental ? '✦ Подготовить трек' : '✦ Подготовить песню';
    meta();
    updateEnabled();
  }

  function activePromptEl() {
    return (mode === 'music' && advanced) ? els.musicPrompt : els.prompt;
  }

  function promptValue() {
    return activePromptEl().value.trim();
  }

  function updateEnabled() {
    // Один ход диалога за раз: генерации медиа не блокируют.
    // T-20/F-06: занятость привязана к сессии — стрим в другой сессии не блокирует ввод здесь.
    const hasInput = Boolean(promptValue() || (mode === 'music' && advanced && els.lyrics.value.trim()));
    const busyKind = sessionBusy.get(activeSession?.id)?.kind;
    // Диалог один на фокус «Создание музыки»; фото и явные генерации живут параллельно.
    const dialogBusy = mode === 'music' && busyKind === 'chat';
    els.send.disabled = storageBlocked || !hasInput || dialogBusy;
    $('chatPending').hidden = !dialogBusy;
    els.genTrack.disabled = storageBlocked || mode !== 'music' || !hasInput;
    els.improveLyrics.disabled = improvingHas(activeSession?.id, 'lyrics') || !els.lyrics.value.trim();
    els.improvePrompt.disabled = improvingHas(activeSession?.id, 'prompt') || !els.musicPrompt.value.trim();
    els.improvePhoto.disabled = improvingHas(activeSession?.id, 'photo') || mode !== 'photo' || !els.prompt.value.trim();
    // #35 W1-2: продюсер — роль одного диалога; его занятость в том же sessionBusy.
    els.prepareMusic.disabled = storageBlocked || mode !== 'music' || !hasInput || Boolean(busyKind);
  }

  // Аудит #35: статус «Работаем…» горит только от операций АКТИВНОЙ сессии;
  // чужие показывает бейдж в шапке, статус остаётся «готов».
  const busyBySession = new Map();
  function paintBusy() {
    const busy = (busyBySession.get(activeSession?.id) || 0) > 0;
    els.improveLyrics.classList.toggle('busy', busy);
    els.improvePrompt.classList.toggle('busy', busy);
    setStatus(busy ? (paintBusy.text || 'Работаем…') : '', busy);
    updateEnabled();
  }
  paintBusy.text = '';
  function setBusy(delta, statusText) { // delta=true — операция началась, false — закончилась
    const id = activeSession?.id;
    const next = Math.max(0, (busyBySession.get(id) || 0) + (delta ? 1 : -1));
    if (next === 0) busyBySession.delete(id); else busyBySession.set(id, next);
    if (statusText) paintBusy.text = statusText;
    paintBusy();
  }

  // F-42: одинаковые предупреждения не стакаются — по ключу обновляется живая
  // карточка (A2: две неудачные попытки без ключа = одна карточка, не две).
  function noticeOnce(key, who, text, session = activeSession) {
    const root = session && rootFor(session);
    const existing = root && [...root.querySelectorAll('.card.notice')].find(c => c.dataset.noticeKey === key);
    if (existing?.isConnected) {
      const body = existing.querySelector('.body');
      if (body) body.textContent = text;
      return;
    }
    const body = card('notice', who, text, session);
    const holder = body.closest('.card');
    if (holder) holder.dataset.noticeKey = key;
  }

  function needKey() {
    if (token()) return true;
    els.keyCard.hidden = false;
    els.keyInput.focus();
    noticeOnce('need-key', 'Ключ', 'Вставьте ключ приватного доступа — тот же, что в Настройках демо.');
    return false;
  }

  // Профиль-меню: актуальность подписей (ник и состояние ключа).
  function renderKeyChip() {
    const has = Boolean(token());
    els.profileNick.textContent = currentUser() || '';
    els.profileBtn.title = has ? 'Профиль — ключ доступа сохранён' : 'Профиль — ключ доступа не задан';
    // статус ключа виден всегда: в пункте меню и внутри карточки ключа
    els.profileKeyBtn.textContent = has ? 'Ключ доступа ✓' : 'Ключ доступа…';
    if (els.keyStatus) els.keyStatus.textContent = has
      ? (tokenRemembered()
        ? 'Ключ сохранён ✓ — запомнен в этом браузере.'
        : 'Ключ сохранён ✓ — до закрытия вкладки.')
      : 'Ключ ещё не задан.';
  }

  // ---- потоки -------------------------------------------------------------------
  async function create() {
    if (storageBlocked || !activeSession || !needKey()) return;
    const text = promptValue();
    if (!text && !(mode === 'music' && advanced && els.lyrics.value.trim())) return;
    if (mode === 'photo') return createPhoto(text);
    if (sessionBusy.get(activeSession?.id)?.kind === 'chat') return;
    // #35 W1-2: один диалог. Simple-режим = разговор с наставником (смена владельца
    // 15.11), генерация — явные кнопки. «Тонко настроить» (Custom) = createMusic.
    if (advanced) return createMusic(text);
    return createChat(text);
  }

  // ---- единый диалог (#35 W1-2): один поток, роли переключаются внутри ----------
  // Вместо «трёх чатов»: createChat и разговорный муз-режим (бывший createMusicChat)
  // слились в один поток на session.history (срез −80). Ответ роли с draft-блоком
  // рендерится карточкой music_draft; ответы без черновика — обычная карточка диалога.
  async function createChat(text) {
    const session = activeSession;
    const turn = { role: 'user', content: text };
    const assistant = currentAssistant();
    const snapshot = { instrumental, quality };
    card('user', 'Вы', text, session);
    feedPush({ t: 'user', who: 'Вы', text }, session);
    els.prompt.value = '';
    updateEnabled();
    const who = assistant.name;
    const body = card('assistant', who, '', session);
    const handle = trackedHandle('chat', session, who); // ✕ в карточке гасит только этот стрим
    sessionBusy.set(session.id, { kind: 'chat', stop: () => handle.stop() });
    const textSpan = document.createElement('span'); // текст отдельно от ✕, чтобы не перемешивались
    const wait = waitLine('chat'); // мгновенный отклик: видно, что запрос ушёл
    const stopRow = document.createElement('div');
    stopRow.className = 'wait-row';
    stopRow.append(wait);
    appendStop(stopRow, handle);
    body.append(textSpan, stopRow);
    body.classList.add('streaming');
    body.closest('.card')?.setAttribute('aria-busy', 'true'); // F-49: лента молчит, карточка занята
    setBusy(true, who + ' печатает…');
    let sink = null; // T-39: создаётся в try, досрочно синхронизируется в catch
    try {
      const messages = [
        { role: 'system', content: assistant.system + musicDraftInstruction + '\n\n' + musicSessionContext(snapshot) },
        // Единый поток v2: один срез −80 вместо старых −80 (чат) и −40 (муз-диалог).
        ...session.history.filter(m => m && ['user', 'assistant', 'system'].includes(m.role) && typeof m.content === 'string').slice(-80),
        turn
      ];
      // T-39: чанки копятся и применяются одним кадром (без layout thrash).
      sink = streamSink(textSpan, wait);
      // P1-1 (#35): у чата тот же клиентский потолок, что у продюсера/автолирики
      // (150 с, лимит каталога chat 180): молчащий Z.ai больше не висит вечно.
      const full = await chatStream({
        messages,
        signal: AbortSignal.any([handle.controller.signal, AbortSignal.timeout(150000)]),
        onChunk: piece => sink.push(piece)
      });
      sink.dispose();
      stopRow.remove();
      body.classList.remove('streaming');
      const parsed = parseMusicDraft(full, snapshot.instrumental, text);
      body.textContent = parsed.text || '';
      session.history.push(turn, { role: 'assistant', content: full });
      session.updatedAt = Date.now();
      if (parsed.draft) {
        const entry = { t: 'music_draft', who, text: parsed.text, draft: parsed.draft, warnings: parsed.warnings,
          assistant: who, instrumental: snapshot.instrumental, applied: false, createdAt: Date.now() };
        renderMusicDraftContent(body, entry, session);
        feedPush(entry, session);
      } else {
        feedPush({ t: 'assistant', who, text: full, track: true }, session); // T-33: флаг вместо копии текста
        addMakeTrackAction(body.closest('.card'), full);
      }
    } catch (error) {
      stopRow.remove();
      sink?.sync(); // T-39: недоставленный в кадр текст не пропадает
      // P1-1 (#35): таймаут — не «остановлено вручную»: честная карточка ошибки.
      if (error.name === 'TimeoutError') error = new BusError('timeout', 'Наставник не ответил за 150 секунд — соединение прервано. Можно отправить идею ещё раз.');
      if (error.name === 'AbortError') {
        if (body.textContent.trim()) { // частичный ответ остаётся в ленте
          const note = document.createElement('div');
          note.className = 'stopped-note';
          note.textContent = '⏹ остановлено';
          body.append(note);
        } else body.closest('.card').remove();
      } else {
        // Частичный ответ уже виден в ленте — в поле не возвращаем (не дублируем).
        const partial = Boolean(body.textContent.trim());
        if (!partial) body.closest('.card').remove(); // пустая карточка без ответа не висит
        if (!partial && session === activeSession && mode === 'music' && !els.prompt.value.trim()) els.prompt.value = text;
        else if (!partial && session === activeSession && mode !== 'music' && !drafts.music.trim()) drafts.music = text;
        errorCard(error, session);
      }
    } finally {
      sessionBusy.delete(session.id);
      handle.unregister?.();
      body.classList.remove('streaming');
      body.closest('.card')?.removeAttribute('aria-busy');
      setBusy(false); updateEnabled();
    }
  }

  // ---- разговорный музыкальный режим (вариант B «Студия-агент») -----------------
  // send в Simple-режиме = диалог с выбранным наставником (Продюсер/Лирик/Автор
  // песни — их system-промпты реально используются). Каждый ответ содержит
  // draft-блок (промпт/лирика) с явным принятием и отдельной кнопкой генерации;
  // self-refine цикл работает, потому что контекст диалога сохраняется.
  const MUSIC_DRAFT_OPEN = '[briix-draft]';
  const MUSIC_DRAFT_CLOSE = '[/briix-draft]';
  const musicDraftInstruction = '\n\nКаждый твой ответ заканчивается блоком черновика строго в таком формате:\n'
    + MUSIC_DRAFT_OPEN + '\n{"title":"название песни","prompt":"описание звучания","lyrics":"текст песни","style":"семейство стиля или пустая строка"}\n' + MUSIC_DRAFT_CLOSE + '\n'
    + 'Поле prompt пиши ТОЛЬКО по-английски одной строкой (жанр, темп, вокал, инструменты, продакшн; не выдумывай темп, если он не задан). '
    + 'Поле lyrics — текст песни с латинскими тегами частей [Verse], [Chorus], [Bridge] (для инструментала — пустая строка). '
    + 'Язык лирики — строго: ПО УМОЛЧАНИЮ (язык в идее не указан) лирика всегда НА АНГЛИЙСКОМ. Русская лирика — ТОЛЬКО если пользователь явно попросил «на русском». Сама идея на русском НЕ означает русскую лирику. '
    + 'Имена исполнителей в title, prompt и lyrics не пиши: если пользователь ссылается на артиста («в стиле X», «как Y»), выдели стиль и укажи его семейство в поле style (pop, rock, edm, house, rap, hip-hop, funk, soul, jazz, ballad, techno, trap, ambient, cinematic, folk и близкие); стиль не определяется — пустая строка. '
    + 'Внутри JSON-строк экранируй переносы строк как \\n. Не используй markdown и не дублируй содержимое черновика в тексте ответа.';

  function musicSessionContext(snapshot) {
    const s = snapshot || { instrumental, quality };
    return 'Текущее состояние студии (опирайся на него, если релевантно):\n'
      + 'Промпт: ' + (els.musicPrompt.value.trim() || '—') + '\n'
      + 'Лирика: ' + (els.lyrics.value.trim() || '—') + '\n'
      + 'Режим: ' + (s.instrumental ? 'инструментал' : 'песня') + ', качество: ' + (MODEL_LABELS[s.quality] || 'Flash') + '.';
  }

  // >>> chat-draft-guard (#39): постобработка чат-черновиков через producer-brain.
  // Решение владельца: лирика и промт только через мозг — имя артиста не попадает
  // в prompt/title, языковое правило #109 едино для всех путей. Блок чистый
  // (только BriixProducer + строки) и тестируется в vm без браузера
  // (tools/check-chat-draft.cjs читает его между маркерами).

  // Ссылки на исполнителя в идее: «в стиле X», «в духе X», «как у X», «наподобие X»,
  // «like X», «style of X». Эвристика: имя — до знака препинания/союза-хвоста.
  function extractArtistRefs(idea) {
    const s = String(idea || '');
    const names = [];
    const push = name => {
      const n = String(name || '').replace(/[«»"'’]+/g, '').replace(/\s+/g, ' ').trim();
      if (n && n.length > 1 && !names.some(x => x.toLowerCase() === n.toLowerCase())) names.push(n);
    };
    for (const m of s.matchAll(/(?:в\s+стиле|в\s+духе|как\s+у|наподобие|подобно|style\s+of|in\s+the\s+style\s+of|like)\s+([A-Za-zА-Яа-яЁё0-9][^,.;:!?«»\n]*)/gi)) {
      push(m[1].replace(/\s+(?:и|с|про|на|для|which|and|with)\s+.*$/i, ''));
    }
    return names;
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Защитная постобработка черновика: style — через normalizeStyle (неизвестное
  // семейство отбрасывается), prompt — styleLeaks/имена → предупреждение в карточке,
  // title — не равен имени артиста (совпало → пересборка из семейства/темы).
  function guardMusicDraft(draft, idea) {
    const warnings = [];
    if (!draft || typeof draft !== 'object') return { draft, warnings };
    draft.style = BriixProducer.normalizeStyle(draft.style);
    const names = extractArtistRefs(idea);
    const hits = text => names.filter(n => new RegExp(escapeRegExp(n), 'i').test(String(text || '')));
    if (BriixProducer.styleLeaks(draft.prompt) > 0) {
      warnings.push('В описании звучания есть отсылка «в духе исполнителя» — замените её на семейство стиля.');
    }
    const promptNames = hits(draft.prompt);
    if (promptNames.length) {
      warnings.push('Имя исполнителя (' + promptNames.join(', ') + ') попало в описание звучания — замените его семейством стиля.');
    }
    if (hits(draft.title).length || BriixProducer.styleLeaks(draft.title) > 0) {
      warnings.push('Название совпало с именем исполнителя — заменено автоматически.');
      let t = String(draft.title || '');
      for (const n of names) t = t.replace(new RegExp(escapeRegExp(n), 'gi'), ' ');
      t = t.replace(/[\s!.,;:«»"'()+\-–—]+/g, ' ').trim();
      if (!t && draft.style) t = draft.style.replace(/\b\w/g, c => c.toUpperCase()); // из семейства
      if (!t) { // из темы идеи без ссылки на артиста
        t = String(idea || '')
          .replace(/(?:в\s+стиле|в\s+духе|как\s+у|наподобие|подобно|style\s+of|in\s+the\s+style\s+of|like)\s+[^,.;:!?\n]*/gi, ' ')
          .replace(/\s+/g, ' ').trim().slice(0, 60)
          .replace(/^(?:песня|песню|песне|трек|сделай|напиши|сочини|создай)\s+/i, '').trim();
        if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
      }
      if (!t) t = 'Без названия';
      draft.title = t.slice(0, BriixProducer.MAX_TITLE);
    }
    return { draft, warnings };
  }
  // <<< chat-draft-guard

  function parseMusicDraft(full, isInstrumental, idea) {
    let text = full, draft = null;
    const open = full.indexOf(MUSIC_DRAFT_OPEN), close = full.lastIndexOf(MUSIC_DRAFT_CLOSE);
    if (open >= 0 && close > open) {
      text = (full.slice(0, open) + ' ' + full.slice(close + MUSIC_DRAFT_CLOSE.length)).replace(/\s+/g, ' ').trim();
      try {
        const value = JSON.parse(full.slice(open + MUSIC_DRAFT_OPEN.length, close).trim());
        if (value && !Array.isArray(value) && typeof value.prompt === 'string') {
          draft = { title: String(value.title || ''), style: BriixProducer.normalizeStyle(value.style), prompt: BriixProducer.sanitize(value.prompt),
            lyrics: BriixProducer.latinizeTags(BriixProducer.sanitize(value.lyrics || '')) };
        }
      } catch { draft = null; }
    }
    if (!draft) {
      // Фолбэк: слабая модель вернула «почти JSON» целиком — пробуем парсер продюсера.
      try {
        const result = BriixProducer.parse(full, { instrumental: isInstrumental, existingLyrics: '' });
        draft = { title: result.title, prompt: result.prompt, lyrics: result.lyrics, style: result.style };
        text = '';
      } catch { draft = null; }
    }
    if (draft && !draft.prompt && !draft.lyrics) draft = null;
    let warnings = [];
    if (draft) ({ draft, warnings } = guardMusicDraft(draft, idea)); // #39: постобработка через мозг
    return { text, draft, warnings };
  }

  // createMusicChat удалён (#35 W1-2): разговорный муз-режим влит в createChat —
  // единый поток session.history, смена роли не обнуляет историю.

  // F-12: после «Принять в поля» — автопереход в advanced и подсветка полей,
  // куда попал черновик (вместо подсказки «показать: Тонко настроить»).
  function flashDraftFields() {
    for (const el of [els.musicPrompt, els.lyrics]) {
      el.classList.remove('field-flash');
      void el.offsetWidth; // перезапуск анимации
      el.classList.add('field-flash');
      setTimeout(() => el.classList.remove('field-flash'), 3400);
    }
    els.musicPrompt.scrollIntoView({ block: 'center', behavior: 'smooth' });
    els.musicPrompt.focus({ preventScroll: true });
  }

  // Draft-блок наставника: компактные поля + «Принять в поля» (с бэкапом/откатом,
  // паттерн renderProducerDraft) + «Сгенерировать трек» (явная генерация).
  // F-11: формулировки и набор действий совпадают с продюсерским черновиком.
  function renderMusicDraftContent(body, entry, session) {
    // Репродукция на проде (#23): битый feed не должен уметь ронять рендер.
    if (!entry.draft || typeof entry.draft !== 'object' || Array.isArray(entry.draft)) entry.draft = {};
    body.classList.add('producer-draft', 'music-draft');
    const note = document.createElement('p'); note.className = 'producer-note';
    note.textContent = 'Черновик наставника. Проверьте смысл, язык и ограничения — помощник может ошибаться.';
    body.append(note);
    for (const w of (Array.isArray(entry.warnings) ? entry.warnings : [])) { // #39: styleLeaks-эвристика в карточке
      const warn = document.createElement('p'); warn.className = 'producer-note draft-warning';
      warn.textContent = '⚠ ' + w;
      body.append(warn);
    }
    const makeField = (label, name, limit, multiline) => {
      const wrapper = document.createElement('label'); wrapper.className = 'producer-field';
      const text = document.createElement('span'); text.textContent = label;
      const input = document.createElement(multiline ? 'textarea' : 'input');
      if (!multiline) input.type = 'text';
      input.value = entry.draft[name] || ''; input.maxLength = limit;
      input.dataset.draftField = name;
      input.addEventListener('input', () => {
        entry.draft[name] = input.value; session.updatedAt = Date.now();
        if (producerSaveTimer) clearTimeout(producerSaveTimer);
        producerSaveTimer = setTimeout(() => { producerSaveTimer = null; persistSessions(); }, 400);
      });
      wrapper.append(text, input); body.append(wrapper); return input;
    };
    const titleField = makeField('Название (для заметок и имени трека)', 'title', BriixProducer.MAX_TITLE, false);
    const promptField = makeField('Описание звучания', 'prompt', BriixProducer.MAX_PROMPT, true);
    const lyricsField = entry.instrumental ? null : makeField('Лирика', 'lyrics', BriixProducer.MAX_LYRICS, true);
    const state = document.createElement('p'); state.className = 'producer-note'; state.setAttribute('role', 'status');
    state.textContent = entry.applied ? 'Поля заполнены из черновика.' : 'Пока ничего не изменено в полях генерации.';
    body.append(state);
    const actions = document.createElement('div'); actions.className = 'producer-actions';
    const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'action'; apply.textContent = 'Принять в поля';
    const revert = document.createElement('button'); revert.type = 'button'; revert.className = 'action'; revert.textContent = 'Вернуть как было';
    revert.hidden = !entry.beforeApply;
    const generate = document.createElement('button'); generate.type = 'button'; generate.className = 'action'; generate.textContent = 'Сгенерировать трек';
    let running = false;
    const runOnce = action => async () => {
      if (running) return;
      running = true; apply.disabled = true; revert.disabled = true; generate.disabled = true;
      try { await action(); } finally { running = false; apply.disabled = false; revert.disabled = false; generate.disabled = false; }
    };
    const backupFields = () => {
      entry.beforeApply = { style: els.musicPrompt.value, lyrics: els.lyrics.value, advanced };
      (entry.backups ||= []).push(entry.beforeApply);
      return entry.beforeApply;
    };
    const writeFields = () => {
      els.musicPrompt.value = promptField.value;
      // P1 аудита #35: семейство стиля — состояние СЕССИИ (session.draft.styleFamily),
      // а не dataset на DOM-поле: не переживает чужие сессии молча.
      if (!session.draft || typeof session.draft !== 'object') session.draft = {};
      if (entry.draft.style) session.draft.styleFamily = entry.draft.style;
      else delete session.draft.styleFamily;
      if (lyricsField) els.lyrics.value = lyricsField.value;
      saveDraft(session);
    };
    apply.addEventListener('click', runOnce(async () => {
      if (storageBlocked || activeSession !== session || mode !== 'music') { state.textContent = 'Откройте эту сессию и режим «Музыка», чтобы принять черновик.'; return; }
      if (instrumental !== entry.instrumental) { state.textContent = 'Режим трека изменился. Верните исходный режим, чтобы принять черновик.'; return; }
      if (!promptField.value.trim() && !(lyricsField && lyricsField.value.trim())) { state.textContent = 'Черновик пуст.'; return; }
      if ((els.musicPrompt.value.trim() && els.musicPrompt.value !== promptField.value) ||
          (els.lyrics.value.trim() && lyricsField && els.lyrics.value !== lyricsField.value)) {
        if (!(await BRIIX_TOASTS.confirmDialog({ title: 'Заменить поля черновиком наставника?', body: 'Текущие стиль и лирика будут заменены. Прежние значения сохранятся для возврата кнопкой «Вернуть как было».', confirmLabel: 'Заменить' }))) return;
      }
      backupFields();
      // Persist backup before touching the form.
      if (!(await persistSessions())) { state.textContent = 'Не удалось сохранить резервную копию; поля не изменены.'; return; }
      entry.applied = true;
      writeFields();
      // P2-4 аудита #35: pendingDraftTitle на сессии удалён — название уходит
      // в генерацию только явным действием ИЗ ЭТОЙ карточки (кнопка «Сгенерировать трек»).
      saveDraft(session);
      await persistSessions();
      revert.hidden = false;
      state.textContent = 'Поля заполнены.';
      // F-12: автопереход в advanced ломал бы диалог с наставником (второй ход
      // «поправь припев» превратился бы в генерацию) — вместо него карточка
      // с явной кнопкой «Показать поля».
      const showNote = card('notice', 'Черновик принят', 'Поля заполнены. Следующий ход диалога можно продолжать здесь, а генерация — кнопкой «Сгенерировать трек».', session);
      const showBtn = document.createElement('button');
      showBtn.type = 'button'; showBtn.className = 'action'; showBtn.textContent = 'Показать поля';
      showBtn.addEventListener('click', () => { advanced = true; renderChrome(); flashDraftFields(); showBtn.closest('.card')?.remove(); });
      showNote.append(showBtn);
    }));
    revert.addEventListener('click', runOnce(async () => {
      if (storageBlocked || activeSession !== session || mode !== 'music' || !entry.beforeApply) { state.textContent = 'Откройте эту сессию и режим «Музыка».'; return; }
      if (!(await BRIIX_TOASTS.confirmDialog({ title: 'Вернуть поля до принятия?', body: 'Текущие изменения полей будут заменены сохранёнными значениями. То, что вы правили после принятия, сохранится в списке резервных копий карточки.', confirmLabel: 'Вернуть' }))) return;
      entry.beforeRevert = { style: els.musicPrompt.value, lyrics: els.lyrics.value, advanced };
      (entry.backups ||= []).push(entry.beforeRevert);
      if (!(await persistSessions())) { state.textContent = 'Не удалось сохранить текущие поля.'; return; }
      els.musicPrompt.value = entry.beforeApply.style; els.lyrics.value = entry.beforeApply.lyrics;
      advanced = entry.beforeApply.advanced; entry.applied = false; renderChrome(); saveDraft(session); await persistSessions();
      state.textContent = 'Поля восстановлены. Черновик остался в этой карточке.';
    }));
    generate.addEventListener('click', runOnce(async () => {
      if (storageBlocked || activeSession !== session || mode !== 'music' || !needKey()) return;
      if (instrumental !== entry.instrumental) { state.textContent = 'Режим трека изменился. Верните исходный режим, чтобы сгенерировать черновик.'; return; }
      if (!promptField.value.trim() && !(lyricsField && lyricsField.value.trim())) { state.textContent = 'Черновик пуст.'; return; }
      if (!entry.applied) { backupFields(); if (!(await persistSessions())) { state.textContent = 'Не удалось сохранить резервную копию; генерация не запущена.'; return; } }
      entry.applied = true;
      writeFields();
      advanced = true; renderChrome();
      await persistSessions();
      revert.hidden = false;
      // T-21: контекст идёт аргументом — параллельная генерация B не подхватит
      // название/источник лирики черновика A.
      await createMusic(els.musicPrompt.value, { title: titleField.value.trim() || null, lyricsSource: 'наставник: ' + entry.who }); // promptReady-путь: английский промпт черновика уходит как есть
    }));
    actions.append(apply, revert, generate); body.append(actions);
  }

  function renderMusicDraftCard(entry, session) {
    const body = card('assistant', entry.who + ' · черновик', '', session);
    body.textContent = entry.text || '';
    renderMusicDraftContent(body, entry, session);
  }

  async function createPhoto(text) {
    const session = activeSession;
    card('user', 'Вы', text, session);
    feedPush({ t: 'user', who: 'Вы', text }, session);
    els.prompt.value = '';
    updateEnabled();
    setBusy(true, 'Отправляем задачу…');
    const stageBody = card('stage', 'Фото', '', session); // мгновенно, до ответа шины
    const skel = document.createElement('div');
    skel.className = 'skeleton-img';
    stageBody.append(skel);
    const eta = etaNote('flux-2-klein-4b', 'фото');
    const wait = waitRow('image', 'generating', { onTick: eta.update });
    const handle = trackedHandle('photo', session); // ✕ гасит только эту джобу
    appendStop(wait.row, handle);
    stageBody.append(wait.row, eta.el);
    try {
      // P1-2 (#35): активная джоба с тем же запросом — предлагаем наблюдать, не дублируем GPU.
      if (!(await guardDuplicateJob(session, 'photo', { prompt: text }))) {
        wait.stop();
        stageBody.closest('.card').remove();
        card('notice', 'Уже выполняется', 'Наблюдение за существующей задачей показано в ленте.', session);
        return;
      }
      const id = await submitJob({ type: 'image', prompt: text, params: { artist: currentUser() } }); // T-41: фото-джоба атрибутируема в общем списке /jobs
      handle.jobId = id; // ✕ после отправки отменяет джобу и на сервере (T-05)
      recordSessionJob(session, id, 'photo', { prompt: text });
      const result = await pollJob(id, { shouldStop: () => handle.cancelled, onStatus: d => {
        if (d.stage) stageBody.querySelector('[data-wait]')?.setAttribute('data-wait-stage', d.stage);
      }, onRetry: retryStatus });
      settleSessionJob(session, id);
      wait.stop();
      stageBody.closest('.card').remove();
      // T-27: загрузка файла отменяема вместе с операцией (✕ / смена сессии).
      const blob = await fileBlob(result.result_url, 1, handle.controller.signal);
      // R2/T-18: единая фото-карточка (fresh = restore = Библиотека).
      const wrap = card('assistant', 'Фото готово', '', session);
      wrap.textContent = '';
      wrap.append(photoCard({ eagerBlob: blob, file: result.result_url, alt: text }).body);
      feedPush({ t: 'media', who: 'Фото готово', kind: 'photo', file: result.result_url, job: id, prompt: text }, session); // prompt → alt при restore (F-51)
      libAdd({ job: id, sessionId: session.id, kind: 'photo', prompt: text, file: result.result_url, created: Date.now(), fav: false });
    } catch (error) {
      wait.stop();
      stageBody.closest('.card').remove();
      if (error.name === 'AbortError' || error.code === 'cancelled') {
        let stoppedNote;
        if (!handle.jobId) {
          stoppedNote = card('notice', 'Ожидание остановлено', 'Генерация остановлена до отправки задачи на сервер.', session);
        } else {
          stoppedNote = card('notice', 'Ожидание остановлено', 'Отменяем задачу на сервере…', session);
          const applyCancelNote = ok => {
            if (ok) settleSessionJob(session, handle.jobId);
            if (stoppedNote?.isConnected) stoppedNote.textContent = ok
              ? 'Задача отменена на сервере — очередь и GPU освобождены.'
              : 'Отменить задачу на сервере не удалось (она могла уже завершиться). Проверьте результат в библиотеке.';
          };
          if (handle.serverCancelled === null) handle.onServerCancel = applyCancelNote; else applyCancelNote(handle.serverCancelled);
        }
      } else {
        if (session === activeSession && mode === 'photo' && !els.prompt.value.trim()) els.prompt.value = text;
        else if (session === activeSession && mode !== 'photo' && !drafts.photo.trim()) drafts.photo = text;
        errorCard(error, session);
      }
    } finally { handle.unregister?.(); setBusy(false); updateEnabled(); }
  }

  // Brain-теги приоритетнее: добавляем к переводу только те, которых ещё нет.
  function mergePromptTags(base, tags) {
    if (!base) return tags || '';
    if (!tags) return base;
    const low = base.toLowerCase();
    const add = tags.split(',').map(t => t.trim()).filter(t => t && !low.includes(t.toLowerCase()));
    return add.length ? base + ', ' + add.join(', ') : base;
  }

  // Перевод не-ASCII идеи в английский связный промпт через producer-чат.
  // Не обязателен, если brain-теги уже закрыли смысл (правило #109), — поэтому
  // неудача перевода не роняет генерацию: brain-теги остаются гарантированным
  // минимумом. Болтовня/JSON/markdown и не-ASCII отбраковываются в валидаторе.
  async function translatePrompt(text, outerSignal) {
    const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(60000)]);
    const raw = await chatNonStream({ messages: BriixProducer.translateMessages(text), maxTokens: 300, signal });
    return BriixProducer.validTranslation(raw);
  }

  async function autoLyrics(topic, outerSignal) {
    // vocal-модели требуют текст: если лирика пустая — автор песен пишет её сам.
    // Языковое правило владельца (#109): дефолт — английский; русский/иной —
    // только при явном указании. Теги частей — всегда латиницей, каркас адаптивный.
    const language = BriixProducer.detectExplicitLanguage(topic);
    const langLine = language === 'ru' ? ' Пиши текст песни на русском.'
      : language === 'fr' ? ' Écris les paroles en français.'
      : ' Язык явно не указан — пиши текст песни по-английски.';
    const messages = [
      { role: 'system', content: 'Ты — автор песен. Напиши текст песни по теме пользователя.' + langLine +
        ' Обязательный каркас частей: интро, куплеты, пред-припев, припев, бридж, аутро — адаптивно по смыслу (8–24 строки).' +
        ' Метки секций — всегда латиницей: [Intro], [Verse], [Pre-Chorus], [Chorus], [Bridge], [Outro] (номера — [Verse 1], [Verse 2]).' +
        ' Без пояснений и вступлений — только текст песни с тегами.' },
      { role: 'user', content: 'Тема песни: ' + topic }
    ];
    let full = '';
    // ✕ своей карточки + потолок 150 с (лимит каталога chat 180)
    const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(150000)]);
    try {
      full = await chatStream({ messages, onChunk: () => {}, signal });
    } catch (error) {
      if (error.name === 'TimeoutError') throw new BusError('timeout', 'Автор песни не ответил за 150 секунд.');
      throw error;
    }
    // Чистка снимает только markdown/служебные обёртки; теги — латиницей.
    return BriixProducer.latinizeTags(BriixProducer.sanitize(full)).slice(0, 8000);
  }

  async function createMusic(description, ctx = {}) {
    const session = activeSession;
    // T-21/P2-4: контекст генерации (название, источник лирики, родительская джоба) —
    // аргумент источника запуска. repeatOf после «Повторить с правками» живёт в
    // pendingRepeats по id сессии и потребляется следующим запуском этой сессии.
    const pendingRepeat = pendingRepeats.get(session.id);
    const parentJobId = ctx.parentJobId || pendingRepeat?.jobId || null;
    if (parentJobId && !ctx.parentJobId) pendingRepeats.delete(session.id);
    // Зафиксировать настройки до автолирики: пользователь может менять их во время ожидания.
    const snapshot = { advanced, quality, instrumental, parentJobId };
    const draftSource = ctx.lyricsSource || null;
    // Название приходит только явным действием карточки-источника (P2-4 аудита #35):
    // «Сгенерировать трек» из черновика передаёт ctx.title, композер — null.
    const draftTitle = ctx.title ?? null;
    // Сборка (#109): исходная идея пользователя сохраняется неизменной (в карточку
    // и журнал идёт она), а в модель уходит чистая сборка без markdown и болтовни.
    const rawIdea = snapshot.advanced ? els.musicPrompt.value.trim() : description;
    const style = BriixProducer.sanitize(rawIdea); // снимает только markdown-обрамление и служебные обёртки
    let lyrics = snapshot.advanced ? BriixProducer.latinizeTags(BriixProducer.sanitize(els.lyrics.value)) : '';
    const vocal = !snapshot.instrumental;
    if (!style && !lyrics) { noticeOnce('music-empty', 'Музыка', 'Опишите трек — стиль или лирику.'); return; }
    if (vocal && !lyrics && !style) { noticeOnce('music-empty', 'Музыка', 'Опишите трек — о чём песня?'); return; }
    if (!snapshot.advanced) els.prompt.value = '';
    else els.musicPrompt.value = '';
    updateEnabled();
    const requestText = rawIdea || lyrics; // в карточку — исходная идея без изменений (#109)
    const restoreMusicDraft = () => {
      if (session !== activeSession) return;
      if (snapshot.advanced) {
        if (!els.musicPrompt.value.trim()) els.musicPrompt.value = rawIdea;
      } else if (mode === 'music') {
        if (!els.prompt.value.trim()) els.prompt.value = description;
      } else if (!drafts.music.trim()) drafts.music = description;
    };
    card('user', 'Вы', requestText, session);
    feedPush({ t: 'user', who: 'Вы', text: requestText }, session);
    const stageBody = card('stage', 'Музыка', '', session); // мгновенно, включая фазу автолирики
    const eta = etaNote(MUSIC_MODELS[snapshot.quality], MODEL_LABELS[snapshot.quality]);
    // P3 (#35): вокал всегда стартует с честной стадии «лирика» — сервер
    // перетирает угаданный «синтез» на «лирику», и прогресс визуально шёл назад.
    const wait = waitRow('music', !vocal ? 'model-warmup' : 'writing-lyrics', { onTick: eta.update });
    const handle = trackedHandle('music', session); // ✕ гасит автолирику и поллинг этой джобы
    appendStop(wait.row, handle);
    stageBody.append(wait.row);
    // Индикатор стадий показывает серверный этап, а не выдуманный процент.
    // Словари по контракту bff: vocal — writing-lyrics → synthesizing → album-cover,
    // instrumental — model-warmup → generating → album-cover (T-02).
    const stages = vocal ? ['writing-lyrics', 'synthesizing', 'album-cover'] : ['model-warmup', 'generating', 'album-cover'];
    const stageNames = { 'writing-lyrics': 'лирика', 'synthesizing': 'синтез', 'model-warmup': 'разогрев модели', 'generating': 'генерация', 'album-cover': 'обложка' };
    let curStage = stageBody.querySelector('[data-wait]')?.getAttribute('data-wait-stage') || stages[0];
    const bar = document.createElement('div');
    bar.className = 'stage-progress';
    // F-15: полоса — настоящий progressbar; объявляется этап и время, а не проценты.
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Генерация трека');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(stages.length));
    const segs = stages.map(s => {
      const seg = document.createElement('div');
      seg.className = 'sp-seg';
      seg.title = stageNames[s];
      const fill = document.createElement('div');
      fill.className = 'sp-fill';
      seg.append(fill);
      bar.append(seg);
      return { el: seg, fill };
    });
    const barLabel = document.createElement('div');
    barLabel.className = 'stage-progress-label';
    barLabel.setAttribute('role', 'status'); // F-15: озвучивается только смена этапа
    const paint = () => {
      const idx = stages.indexOf(curStage);
      segs.forEach((s, i) => {
        s.el.classList.toggle('done', i < idx);
        s.el.classList.toggle('active', i === idx);
        s.fill.style.width = i <= idx ? '100%' : '0%';
      });
      const label = stageNames[curStage] ? 'Этап: ' + stageNames[curStage] : 'Задача выполняется';
      barLabel.textContent = label;
      bar.setAttribute('aria-valuenow', String(Math.max(0, idx)));
      bar.setAttribute('aria-valuetext', label);
    };
    // P3 (#35): статус этапа монотонный — назад не откатывается. Первая серверная
    // стадия принимается всегда (может легитимно перекрыть клиентскую догадку),
    // дальше — только вперёд по stages; неизвестные стадии пропускаем.
    let stageIdx = Math.max(0, stages.indexOf(curStage));
    const advanceStage = s => {
      const i = stages.indexOf(s);
      if (i >= 0 && i < stageIdx) return;
      if (i >= 0) stageIdx = i;
      // Атрибут ведёт фразу ожидания (wait-phrases пере-пулится по стадии);
      // сработает и watchStage — он увидит ту же стадию и не зациклится.
      stageBody.querySelector('[data-wait]')?.setAttribute('data-wait-stage', s);
      curStage = s;
      paint();
    };
    paint();
    stageBody.append(bar, barLabel, eta.el);
    const watchStage = new MutationObserver(() => {
      const now = stageBody.querySelector('[data-wait]')?.getAttribute('data-wait-stage');
      if (now && now !== curStage) advanceStage(now);
    });
    watchStage.observe(stageBody, { subtree: true, attributes: true, attributeFilter: ['data-wait-stage'] });
    setBusy(true, vocal && !lyrics ? 'Пишем текст песни…' : 'Отправляем задачу…');
    try {
      if (vocal && !lyrics) {
        try {
          lyrics = await autoLyrics(style || lyrics || 'песня', handle.controller.signal);
          if (session === activeSession && snapshot.advanced && mode === 'music' && !els.lyrics.value.trim()) els.lyrics.value = lyrics;
        } catch (error) {
          wait.stop(); watchStage.disconnect();
          stageBody.closest('.card').remove();
          restoreMusicDraft();
          const why = error.name === 'AbortError' ? 'Остановлено вручную.'
            : error.code === 'timeout' ? error.message
            : error.code === 'content_blocked' ? 'Модерация не пропустила тему.'
            : 'Причина: ' + (error.message || 'неизвестная ошибка') + '.';
          card('notice', 'Музыка', 'Не удалось автоматически написать лирику. ' + why
            + ' Можно заполнить поле «Лирика» вручную (кнопка ✨ тоже поможет) и попробовать снова.', session);
          return;
        }
      }
      // ---- Brain-ступень сборки промпта (#109) --------------------------------
      // Детерминированный мозг DJ1: ПОЛНЫЙ продюсерский caption ACE-Step (≤ 640).
      // 16.11 владелец снял ограничение 240: на компактном бюджете вылетает
      // глубина и стилевая атмосфера, а именно их не хватало на прослушивании.
      // Исходная идея в карточке/сессии по-прежнему не переписывается (правило #109).
      const CAPTION_BUDGET = BRIIX_MUSIC_BRAIN.rules.MAX_CAPTION;
      // P1 аудита #35: семейство стиля читается из состояния сессии — генерация в
      // сессии B больше не наследует стиль сессии A молча.
      const styleFamily = session.draft?.styleFamily || undefined;
      const brainFor = budget => BRIIX_MUSIC_BRAIN.buildCaption(style || lyrics || '', {
        kind: snapshot.instrumental ? 'instrumental' : 'song',
        language: BriixProducer.detectExplicitLanguage(rawIdea) || (snapshot.instrumental ? null : 'en'),
        bpm: BRIIX_MUSIC_BRAIN.detectBpm(style || lyrics || ''),
        style: styleFamily,
        maxTags: budget
      });
      // Бюджет режется на длину того, что уже есть в промте (перевод/идея),
      // чтобы итоговая строка не разъезжалась за 640.
      const brainBudget = extra => Math.max(240, CAPTION_BUDGET - (extra ? extra.length + 2 : 0));
      let brain = brainFor(CAPTION_BUDGET);
      let finalPrompt;
      if (snapshot.advanced && style && BriixProducer.isAsciiOnly(style)) {
        // Пользователь/продюсер уже собрал английский промпт: не переписываем его.
        finalPrompt = style;
      } else if (style && !BriixProducer.isAsciiOnly(style)) {
        // Не-ASCII идея (например русская) → связный английский перевод через
        // producer-чат; brain-теги приоритетнее сырого перевода и остаются,
        // если перевод не состоялся. Болтовня/JSON/markdown отбраковываются.
        let fluent = null;
        try { fluent = await translatePrompt(style, handle.controller.signal); }
        catch (error) { if (error.name === 'AbortError' || error.code === 'cancelled') throw error; }
        if (fluent) brain = brainFor(brainBudget(fluent));
        finalPrompt = fluent ? mergePromptTags(fluent, brain.tags) : (brain.tags || style);
      } else if (style) {
        // Быстрый путь с уже английской идеей: brain-теги обязательны —
        // добавляем те, которых в идее ещё нет.
        brain = brainFor(brainBudget(style));
        finalPrompt = mergePromptTags(style, brain.tags);
      } else {
        // Только лирика: Brain отдельно собирает описание звучания; исходные
        // строки остаются только в params.lyrics и не дублируются в prompt.
        finalPrompt = brain.tags || '';
      }
      if (snapshot.advanced && !snapshot.instrumental && lyrics) {
        const structure = BriixProducer.structureWarnings(lyrics); // ручная лирика: предупредить, не навязывать
        if (structure.length) card('notice', 'Структура лирики', structure.join(' '), session);
      }
      // Песня — продукт: у неё есть имя и исполнитель. Название — из черновика
      // наставника или первой осмысленной строки лирики, fallback по дате.
      // Сервер (параллельная INFRA-задача) пишет params.title/artist в теги M4A
      // и Content-Disposition — контрактное ожидание, см. server-contract/README.md.
      // Структурный тег ([Intro]/[Verse 1]/…) — не название песни: в пути автолирики
      // первая строка лирики — это [Intro], и имя файла не должно становиться
      // «[Intro] - ник.m4a» (T-53).
      const isSectionTag = s => /^\[[^\]\n]{1,32}\]$/.test(s);
      const titleSource = (lyrics || style || '').split('\n').map(s => s.trim()).find(s => s.length > 2 && !isSectionTag(s)) || '';
      const trackTitle = BriixProducer.sanitize(draftTitle || titleSource).slice(0, BriixProducer.MAX_TITLE) || ('BRIIX track ' + new Date().toISOString().slice(0, 10));
      const params = { model: MUSIC_MODELS[snapshot.quality], title: trackTitle, artist: currentUser() };
      if (snapshot.instrumental) params.instrumental = true;
      else {
        // T-03: bff ждёт params.language (ru|en) — без поля русский вокал уходит в
        // модель английским. Явная просьба («на русском») или кириллическая лирика
        // (осознанный выбор автора) = ru; французский bff не валидирует — не шлём.
        const explicit = BriixProducer.detectExplicitLanguage(rawIdea) || BriixProducer.detectExplicitLanguage(lyrics || '');
        if (explicit === 'ru' || explicit === 'en') params.language = explicit;
        else if (!explicit && lyrics && /[\u0400-\u04FF]/.test(lyrics)) params.language = 'ru';
        else if (!explicit) params.language = 'en';
      }
      if (lyrics) params.lyrics = lyrics;
      // В карточку/сессию — исходная идея без изменений (правило #109),
      // promptSent — ровно то, что ушло в модель; повтор подставляет исходную идею.
      const requestBase = rawIdea || lyrics;
      const input = { prompt: requestBase, promptSent: finalPrompt !== requestBase ? finalPrompt : undefined, lyrics, model: MUSIC_MODELS[snapshot.quality], instrumental: snapshot.instrumental, parentJobId: snapshot.parentJobId,
        title: trackTitle, artist: currentUser(),
        lyricsSource: draftSource || (snapshot.advanced ? 'написал пользователь' : (vocal && !lyrics ? 'автолирика (автор песен)' : 'написал пользователь')) };
      // P1-2 (#35): активная джоба с теми же данными — предлагаем наблюдать, не дублируем GPU.
      if (!(await guardDuplicateJob(session, 'music', input))) {
        wait.stop();
        watchStage.disconnect();
        stageBody.closest('.card').remove();
        card('notice', 'Уже выполняется', 'Наблюдение за существующей задачей показано в ленте.', session);
        return;
      }
      const id = await submitJob({ type: 'music', prompt: finalPrompt, params });
      handle.jobId = id; // ✕ после отправки отменяет джобу и на сервере (T-05)
      recordSessionJob(session, id, 'music', input);
      const result = await pollJob(id, { shouldStop: () => handle.cancelled, onStatus: d => {
        if (d.stage) advanceStage(d.stage);
      }, onRetry: retryStatus });
      settleSessionJob(session, id);
      wait.stop();
      watchStage.disconnect();
      stageBody.closest('.card').remove();
      // T-27: загрузка файла отменяема вместе с операцией (✕ / смена сессии).
      const blob = await fileBlob(result.result_url, 1, handle.controller.signal);
      // Единый рендер-путь с restore-карточкой: обложка = PLAY, волна, меню «⋯».
      const trackCard = renderTrackCard(session, {
        who: 'Трек готов (' + MODEL_LABELS[snapshot.quality] + ')',
        job: id, cover: result.cover_url, input, file: result.result_url,
        loadBlob: () => Promise.resolve(blob)
      });
      trackCard.ensureLoaded().then(audio => tryPlay(audio, trackCard.body)).catch(() => {});
      feedPush({ t: 'media', who: 'Трек готов (' + MODEL_LABELS[snapshot.quality] + ')', kind: 'music', file: result.result_url, job: id, cover: result.cover_url || '', input }, session);
      libAdd({
        job: id, sessionId: session.id, kind: 'music', prompt: requestBase || '',
        lyrics: lyrics || '', instrumental: snapshot.instrumental, inputComplete: true, parentJobId: snapshot.parentJobId,
        title: trackTitle,
        model: MUSIC_MODELS[snapshot.quality], file: result.result_url, cover: result.cover_url || '', created: Date.now(), fav: false
      });
    } catch (error) {
      wait.stop(); watchStage.disconnect();
      stageBody.closest('.card').remove();
      if (error.name === 'AbortError' || error.code === 'cancelled') {
        let stoppedNote;
        if (!handle.jobId) {
          stoppedNote = card('notice', 'Ожидание остановлено', 'Генерация остановлена до отправки задачи на сервер.', session);
        } else {
          stoppedNote = card('notice', 'Ожидание остановлено', 'Отменяем задачу на сервере…', session);
          const applyCancelNote = ok => {
            if (ok) settleSessionJob(session, handle.jobId);
            if (stoppedNote?.isConnected) stoppedNote.textContent = ok
              ? 'Задача отменена на сервере — очередь и GPU освобождены.'
              : 'Отменить задачу на сервере не удалось (она могла уже завершиться). Проверьте результат в библиотеке.';
          };
          if (handle.serverCancelled === null) handle.onServerCancel = applyCancelNote; else applyCancelNote(handle.serverCancelled);
        }
      } else {
        // текст остаётся в полях для правки (в т.ч. после 422)
        restoreMusicDraft();
        errorCard(error, session);
      }
    } finally { handle.unregister?.(); setBusy(false); updateEnabled(); }
  }

  // All authenticated file transfers share two slots. Interactive requests can pass
  // queued thumbnails; duplicate requests share a transfer only within the same identity.
  const fileQueue = [], fileInFlight = new Map();
  let activeFiles = 0;
  function pumpFiles() {
    while (activeFiles < 2 && fileQueue.length) {
      fileQueue.sort((a, b) => a.priority - b.priority);
      const item = fileQueue.shift(); activeFiles++;
      Promise.resolve().then(item.run).then(item.resolve, item.reject).finally(() => { activeFiles--; pumpFiles(); });
    }
  }
  function scheduledFile(run, priority) {
    return new Promise((resolve, reject) => { fileQueue.push({ run, priority, resolve, reject }); pumpFiles(); });
  }
  function retryDelay(response, attempt) {
    const value = response.headers.get('Retry-After');
    const seconds = value && /^\d+$/.test(value.trim()) ? Number(value) * 1000 : NaN;
    const date = value && !Number.isFinite(seconds) ? Date.parse(value) - Date.now() : NaN;
    const delay = Number.isFinite(seconds) ? seconds : Number.isFinite(date) ? Math.max(0, date) : 1000 * (2 ** attempt);
    return delay + Math.random() * 150;
  }
  // T-27: таймаут на загрузку файла. Зависший сервер больше не держит слот
  // общей очереди (их всего 2) до бесконечности: 60 с — и соединение рвётся
  // с честным текстом. Прокидываем и signal операции (✕ / смена сессии).
  const FILE_TIMEOUT_MS = 60000;
  function fetchWithTimeout(url, options, signal, ms) {
    const controller = new AbortController();
    const state = { timedOut: false };
    const timer = setTimeout(() => { state.timedOut = true; controller.abort(); }, ms);
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    return fetch(url, { ...options, signal: controller.signal }).finally(() => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }).catch(error => {
      if (state.timedOut) {
        const e = new BusError('timeout', 'Сервер не отдал файл за ' + Math.round(ms / 1000) + ' с — соединение прервано, попробуйте ещё раз.');
        e.timedOut = true;
        throw e;
      }
      throw error;
    });
  }
  // T-27: смена профиля/выход — очередь не дорабатывает загрузки прежнего
  // пользователя: ожидающие задачи снимаются сразу, слоты освобождаются.
  function resetFileQueue() {
    for (const item of fileQueue.splice(0)) {
      try { item.reject(new BusError('cancelled', 'Сессия завершена — загрузки отменены.')); } catch { /* потребитель уже ушёл */ }
    }
    fileInFlight.clear();
  }
  function fileBlob(pathOrUrl, priority = 0, signal) {
    let url, trusted;
    try {
      trusted = new URL(server());
      url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : server() + pathOrUrl);
    } catch { return Promise.reject(new BusError('unsafe_url', 'Некорректный адрес файла.')); }
    const basePath = trusted.pathname.replace(/\/+$/, '');
    const filePrefix = basePath + '/files/';
    const fileName = url.pathname.startsWith(filePrefix) ? url.pathname.slice(filePrefix.length) : '';
    // P3-2 аудита #35: allow-list query — ?refetch=1 на /files/{id}.m4a разрешён
    // (принудительная пересборка M4A из WAV по контракту), остальные query/hash — как раньше.
    const refetchAllowed = url.search === '?refetch=1' && url.pathname.startsWith(filePrefix) && url.pathname.endsWith('.m4a');
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== trusted.origin || url.username || url.password ||
        (url.search && !refetchAllowed) || url.hash || !/^[a-zA-Z0-9._-]+$/.test(fileName) || fileName === '.' || fileName === '..') {
      return Promise.reject(new BusError('unsafe_url', 'Недоверенный адрес файла.'));
    }
    // T-26: известный офлайн — сразу честная ошибка, слот очереди не занимается.
    if (!netOnline) return Promise.reject(new BusError('offline', 'Нет соединения с сервером. Проверьте сеть и повторите.'));
    const owner = currentUser(), credential = token(), origin = server();
    const key = JSON.stringify([owner, credential, url.href]);
    if (fileInFlight.has(key)) return fileInFlight.get(key);
    const work = (async () => {
      for (let attempt = 0; ; attempt++) {
        const response = await scheduledFile(async () => {
          if (currentUser() !== owner || token() !== credential || server() !== origin) throw new BusError('cancelled', 'Профиль или ключ изменился.');
          try {
            // Never follow redirects with the bearer: the destination may be another origin.
            const result = await fetchWithTimeout(url.href, { headers: { Authorization: 'Bearer ' + credential }, redirect: 'error' }, signal, FILE_TIMEOUT_MS);
            return { response: result, blob: result.ok ? await result.blob() : null };
          } catch (error) {
            if (error.timedOut) throw error; // T-27: текст про 60 с уже внутри
            if (signal?.aborted) throw new BusError('cancelled', 'Загрузка файла отменена.');
            throw new BusError('network', 'Файл недоступен: проверьте подключение или адрес.');
          }
        }, priority);
        if (response.blob) return response.blob;
        const status = response.response.status;
        if ((status !== 429 && status !== 503) || attempt >= 3) {
          if (status === 429) throw new BusError('rate_limited', 'Сервер временно перегружен (429). Попробуйте ещё раз через минуту.', 429);
          if (status === 401) throw new BusError('unauthorized', 'Ключ не принят (401). Проверьте ключ в профиле.', 401);
          if (status === 404) throw new BusError('not_found', 'Файл не найден (404); срок хранения мог истечь.', 404);
          throw new BusError('http', 'Файл не получен (' + status + ').', status);
        }
        const delay = retryDelay(response.response, attempt);
        if (delay > 30000) throw new BusError('rate_limited', 'Сервер просит повторить позднее. Попробуйте позже.', status);
        await new Promise(r => setTimeout(r, delay));
      }
    })();
    fileInFlight.set(key, work);
    work.then(() => fileInFlight.delete(key), () => fileInFlight.delete(key));
    return work;
  }

  // The review lives in its originating session; it never submits a music job.
  // #35 W1-2: «Подготовить песню» — действие роли «Продюсер» в едином диалоге;
  // занятость в общем sessionBusy (отдельного канала producerRequests больше нет).
  async function prepareMusic() {
    if (storageBlocked || !activeSession || mode !== 'music' || sessionBusy.has(activeSession.id) || !needKey()) return;
    const session = activeSession;
    const snapshot = { idea: (advanced ? els.musicPrompt.value : els.prompt.value), lyrics: els.lyrics.value,
      quick: els.prompt.value, style: els.musicPrompt.value, advanced, instrumental };
    if (!snapshot.idea.trim() && !snapshot.lyrics.trim()) return;
    if (snapshot.idea.length > BriixProducer.MAX_IDEA || snapshot.lyrics.length > BriixProducer.MAX_LYRICS) {
      card('notice', 'Продюсер', 'Идея или текст слишком длинные для подготовки. Сократите их самостоятельно.'); return;
    }
    const handle = trackedHandle('producer', session, 'подготовка черновика');
    sessionBusy.set(session.id, { kind: 'producer', stop: () => handle.stop() });
    const stage = card('stage', 'Музыкальный продюсер', '', session);
    const wait = waitRow('music', 'writing-lyrics');
    appendStop(wait.row, handle);
    handle.stopBtn.setAttribute('aria-label', 'Отменить подготовку песни');
    stage.append(wait.row);
    setBusy(true, 'Подготавливаем черновик…');
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; handle.controller.abort(); }, 150000);
    let raw = '';
    try {
      // Save the source before making the request, including when the user switches sessions.
      saveDraft(session);
      if (!(await persistSessions())) throw new Error('Не удалось сохранить исходный черновик. Подготовка не запущена.');
      if (handle.cancelled) { card('notice', 'Подготовка отменена', 'Исходные поля не изменены.', session); return; }
      raw = await chatNonStream({ messages: BriixProducer.messages({ idea: snapshot.idea, instrumental: snapshot.instrumental,
        existingLyrics: snapshot.advanced && !snapshot.instrumental && snapshot.lyrics.trim() ? snapshot.lyrics : '' }), maxTokens: 1800, signal: handle.controller.signal });
      if (handle.cancelled || timedOut || !sessionProfile?.sessions.includes(session)) return;
      const result = BriixProducer.parse(raw, { instrumental: snapshot.instrumental, existingLyrics: snapshot.advanced && !snapshot.instrumental && snapshot.lyrics.trim() ? snapshot.lyrics : '' });
      const entry = { t: 'producer_draft', version: BriixProducer.VERSION, snapshot, title: result.title,
        style: result.style || '', prompt: BriixProducer.sanitize(result.prompt), lyrics: BriixProducer.latinizeTags(BriixProducer.sanitize(result.lyrics)), applied: false, createdAt: Date.now() };
      renderProducerDraft(entry, session);
      await feedPush(entry, session);
    } catch (error) {
      if (handle.cancelled) card('notice', 'Подготовка отменена', 'Исходные поля не изменены.', session);
      else if (timedOut) card('error', 'Продюсер', 'Сервер не ответил вовремя. Исходные поля не изменены.', session);
      else {
        errorCard(error, session);
        if (raw) {
          const body = card('notice', 'Ответ для ручного восстановления', '', session);
          const pre = document.createElement('pre'); pre.className = 'producer-raw'; pre.textContent = raw; body.append(pre);
          await feedPush({ t: 'notice', who: 'Ответ для ручного восстановления', text: raw }, session);
        }
      }
    } finally {
      clearTimeout(timer); wait.stop(); stage.closest('.card')?.remove();
      sessionBusy.delete(session.id); handle.unregister?.(); setBusy(false); updateEnabled();
    }
  }

  function renderProducerDraft(entry, session) {
    // Репродукция на проде (#23): snapshot без объекта — пустые поля с fallback '—'.
    if (!entry.snapshot || typeof entry.snapshot !== 'object' || Array.isArray(entry.snapshot)) entry.snapshot = {};
    const body = card('assistant', 'Музыкальный продюсер · черновик', '', session);
    body.classList.add('producer-draft');
    const note = document.createElement('p'); note.className = 'producer-note';
    note.textContent = 'Проверьте смысл, язык и ограничения. Помощник может ошибаться. Название сохраняется в этом черновике и не передаётся как метаданные трека.';
    const details = document.createElement('details'); details.className = 'producer-idea';
    const summary = document.createElement('summary'); summary.textContent = 'Исходная идея и поля';
    const original = document.createElement('pre');
    original.textContent = 'Идея: ' + (entry.snapshot.idea || '—') + '\n\nБыстрый черновик: ' + (entry.snapshot.quick || '—') +
      '\n\nСтиль до подготовки: ' + (entry.snapshot.style || '—') + '\n\nЛирика до подготовки: ' + (entry.snapshot.lyrics || '—');
    details.append(summary, original);
    const backups = document.createElement('pre');
    // Защита в глубину (хвост #23): мусорные элементы backups ([null]) могли остаться
    // в уже открытой вкладке, чей профиль санирован мимо store — рендер не падает.
    const refreshBackups = () => { backups.textContent = (entry.backups || []).filter(b => b && typeof b === 'object').map((b, i) =>
      'Резервная копия ' + (i + 1) + ':\nБыстрый черновик: ' + (b.quick || '—') + '\nСтиль: ' + (b.style || '—') + '\nЛирика: ' + (b.lyrics || '—')).join('\n\n'); };
    refreshBackups(); details.append(backups);
    body.append(note, details);
    const makeField = (label, name, limit, multiline) => {
      const wrapper = document.createElement('label'); wrapper.className = 'producer-field';
      const text = document.createElement('span'); text.textContent = label;
      const input = document.createElement(multiline ? 'textarea' : 'input');
      if (!multiline) input.type = 'text';
      input.value = entry[name] || ''; input.maxLength = limit;
      input.dataset.producerField = name;
      if (name === 'lyrics') input.classList.add('producer-lyrics');
      input.addEventListener('input', () => {
        entry[name] = input.value; session.updatedAt = Date.now();
        if (producerSaveTimer) clearTimeout(producerSaveTimer);
        producerSaveTimer = setTimeout(() => { producerSaveTimer = null; persistSessions(); }, 400);
      });
      wrapper.append(text, input); body.append(wrapper); return input;
    };
    const title = makeField('Название (для заметок)', 'title', BriixProducer.MAX_TITLE, false);
    const style = makeField('Описание звучания', 'prompt', BriixProducer.MAX_PROMPT, true);
    const lyrics = entry.snapshot.instrumental ? null : makeField('Лирика', 'lyrics', BriixProducer.MAX_LYRICS, true);
    if (entry.snapshot.instrumental && entry.snapshot.lyrics.trim()) {
      const hint = document.createElement('p'); hint.className = 'producer-note';
      hint.textContent = 'Режим инструментала: ваша лирика не отправляется в генерацию и остаётся в поле студии.'; body.append(hint);
    }
    const warning = document.createElement('p'); warning.className = 'producer-warning'; warning.setAttribute('role', 'status');
    const refreshWarning = () => {
      const list = BriixProducer.warnings(entry.snapshot.idea, style.value, entry.snapshot.instrumental);
      warning.textContent = list.join(' ');
    };
    style.addEventListener('input', refreshWarning); refreshWarning(); body.append(warning);
    // Brain-ступень (#109): полный продюсерский caption ACE-Step (≤ 640) из
    // исходной идеи — провенанс для прозрачности. В модель уходит английский
    // промпт этого черновика; caption добавляется, только если он не английский.
    if (globalThis.BRIIX_MUSIC_BRAIN) {
      const brain = BRIIX_MUSIC_BRAIN.buildCaption(entry.snapshot.idea, {
        kind: entry.snapshot.instrumental ? 'instrumental' : 'song',
        language: BriixProducer.detectExplicitLanguage(entry.snapshot.idea) || (entry.snapshot.instrumental ? null : 'en'),
        bpm: BRIIX_MUSIC_BRAIN.detectBpm(entry.snapshot.idea)
      });
      const brainNote = document.createElement('p'); brainNote.className = 'producer-note';
      brainNote.textContent = 'Caption ACE-Step (brain): ' + (brain.tags || '—') + '.';
      body.append(brainNote);
    }
    const state = document.createElement('p'); state.className = 'producer-note'; state.setAttribute('role', 'status');
    state.textContent = entry.applied ? 'Поля заполнены из черновика.' : 'Пока ничего не изменено в полях генерации.';
    body.append(state);
    const actions = document.createElement('div'); actions.className = 'producer-actions';
    // F-11: тот же набор действий и формулировки, что у черновика наставника —
    // включая кнопку генерации (раньше её не было и путь лежал через композер).
    const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'action'; apply.textContent = 'Принять в поля';
    const revert = document.createElement('button'); revert.type = 'button'; revert.className = 'action'; revert.textContent = 'Вернуть как было';
    const generate = document.createElement('button'); generate.type = 'button'; generate.className = 'action'; generate.textContent = 'Сгенерировать трек';
    revert.hidden = !entry.beforeApply;
    let applying = false;
    const runOnce = action => async () => {
      if (applying) return;
      applying = true; apply.disabled = true; revert.disabled = true; generate.disabled = true;
      try { await action(); } finally { applying = false; apply.disabled = false; revert.disabled = false; generate.disabled = false; }
    };
    apply.addEventListener('click', runOnce(async () => {
      if (storageBlocked || activeSession !== session || mode !== 'music') { state.textContent = 'Откройте эту сессию и режим «Музыка», чтобы принять черновик.'; return; }
      if (!title.value.trim() || !style.value.trim() || (lyrics && !lyrics.value.trim())) { state.textContent = 'Заполните название, звучание и текст песни.'; return; }
      if (instrumental !== entry.snapshot.instrumental) { state.textContent = 'Режим песни изменился. Верните исходный режим, чтобы принять черновик.'; return; }
      const changed = els.prompt.value !== entry.snapshot.quick || els.musicPrompt.value !== entry.snapshot.style || els.lyrics.value !== entry.snapshot.lyrics || (!entry.snapshot.advanced && (!!els.musicPrompt.value.trim() || (!entry.snapshot.instrumental && !!els.lyrics.value.trim())));
      if (changed && !(await BRIIX_TOASTS.confirmDialog({ title: 'Заменить поля подготовленным черновиком?', body: 'В студии есть изменённые или скрытые поля. Текущие значения сохранятся для возврата кнопкой «Вернуть как было».', confirmLabel: 'Заменить' }))) return;
      entry.beforeApply = { quick: els.prompt.value, style: els.musicPrompt.value, lyrics: els.lyrics.value, advanced };
      (entry.backups ||= []).push(entry.beforeApply); refreshBackups();
      // Persist backup before touching the form. If saving fails the form remains unchanged.
      if (!(await persistSessions())) { state.textContent = 'Не удалось сохранить резервную копию; поля не изменены.'; return; }
      if (activeSession !== session || mode !== 'music' || instrumental !== entry.snapshot.instrumental ||
          els.prompt.value !== entry.beforeApply.quick || els.musicPrompt.value !== entry.beforeApply.style || els.lyrics.value !== entry.beforeApply.lyrics) {
        state.textContent = 'Поля изменились во время сохранения. Проверьте их и попробуйте снова.'; return;
      }
      entry.applied = true;
      els.musicPrompt.value = style.value;
      // P1 аудита #35: семейство стиля — на сессии (см. writeFields черновика наставника).
      if (!session.draft || typeof session.draft !== 'object') session.draft = {};
      if (entry.style) session.draft.styleFamily = entry.style;
      else delete session.draft.styleFamily;
      if (lyrics) els.lyrics.value = lyrics.value;
      advanced = true; renderChrome(); saveDraft(session); await persistSessions();
      revert.hidden = false; state.textContent = 'Поля заполнены — проверьте их в композере.';
      flashDraftFields(); // F-12
    }));
    revert.addEventListener('click', runOnce(async () => {
      if (storageBlocked || activeSession !== session || mode !== 'music' || !entry.beforeApply) { state.textContent = 'Откройте эту сессию и режим «Музыка».'; return; }
      if (!(await BRIIX_TOASTS.confirmDialog({ title: 'Вернуть поля до принятия?', body: 'Текущие изменения полей будут заменены сохранёнными значениями. То, что вы правили после принятия, сохранится в списке резервных копий карточки.', confirmLabel: 'Вернуть' }))) return;
      // Preserve what is being replaced as another recoverable snapshot.
      entry.beforeRevert = { quick: els.prompt.value, style: els.musicPrompt.value, lyrics: els.lyrics.value, advanced };
      (entry.backups ||= []).push(entry.beforeRevert); refreshBackups();
      if (!(await persistSessions())) { state.textContent = 'Не удалось сохранить текущие поля.'; return; }
      if (activeSession !== session || mode !== 'music' || els.prompt.value !== entry.beforeRevert.quick || els.musicPrompt.value !== entry.beforeRevert.style || els.lyrics.value !== entry.beforeRevert.lyrics) {
        state.textContent = 'Поля изменились во время сохранения. Попробуйте снова.'; return;
      }
      els.prompt.value = entry.beforeApply.quick; els.musicPrompt.value = entry.beforeApply.style; els.lyrics.value = entry.beforeApply.lyrics;
      advanced = entry.beforeApply.advanced; entry.applied = false; renderChrome(); saveDraft(session); await persistSessions();
      state.textContent = 'Поля восстановлены. Подготовленный черновик остался в этой карточке.';
    }));
    // F-11: генерация прямо из продюсерского черновика — тот же контракт ctx (T-21),
    // что и у черновика наставника.
    generate.addEventListener('click', runOnce(async () => {
      if (storageBlocked || activeSession !== session || mode !== 'music' || !needKey()) return;
      if (instrumental !== entry.snapshot.instrumental) { state.textContent = 'Режим трека изменился. Верните исходный режим, чтобы сгенерировать черновик.'; return; }
      if (!style.value.trim() && !(lyrics && lyrics.value.trim())) { state.textContent = 'Черновик пуст.'; return; }
      if (!entry.applied) {
        entry.beforeApply = { quick: els.prompt.value, style: els.musicPrompt.value, lyrics: els.lyrics.value, advanced };
        (entry.backups ||= []).push(entry.beforeApply); refreshBackups();
        if (!(await persistSessions())) { state.textContent = 'Не удалось сохранить резервную копию; генерация не запущена.'; return; }
      }
      entry.applied = true;
      els.musicPrompt.value = style.value;
      if (!session.draft || typeof session.draft !== 'object') session.draft = {};
      if (entry.style) session.draft.styleFamily = entry.style; else delete session.draft.styleFamily;
      if (lyrics) els.lyrics.value = lyrics.value;
      advanced = true; renderChrome(); saveDraft(session);
      await persistSessions();
      revert.hidden = false;
      await createMusic(els.musicPrompt.value, { title: title.value.trim() || null, lyricsSource: 'продюсер' });
    }));
    actions.append(apply, revert, generate); body.append(actions);
  }

  async function improve(field) {
    if (storageBlocked || improvingHas(activeSession?.id, field)) return;
    if (!needKey()) return;
    const session = activeSession;
    improvingAdd(session.id, field); // ✨-блокировки — на сессию (аудит #35)
    const el = field === 'lyrics' ? els.lyrics : els.musicPrompt;
    const original = el.value;
    const button = field === 'lyrics' ? els.improveLyrics : els.improvePrompt;
    setBusy(true, 'Улучшаем через базу владельца…');
    button.classList.add('busy');
    try {
      const improved = await improveText(original, field);
      if (session !== activeSession || el.value !== original) {
        card('notice', 'Предложение помощника', improved.trim(), session);
        feedPush({ t: 'notice', who: 'Предложение помощника', text: improved.trim() }, session);
        return;
      }
      sessionUndo(session, field, original);
      el.value = improved.trim();
      (field === 'lyrics' ? els.undoLyrics : els.undoPrompt).hidden = false;
    } catch (error) { errorCard(error, session); } finally { improvingDelete(session.id, field); button.classList.remove('busy'); setBusy(false); }
  }

  function undo(field) {
    const backup = sessionUndo(activeSession, field);
    if (backup == null) return;
    (field === 'lyrics' ? els.lyrics : els.musicPrompt).value = backup;
    delete activeSession.undo[field];
    (field === 'lyrics' ? els.undoLyrics : els.undoPrompt).hidden = true;
    updateEnabled();
  }

  // ✨ в режиме «Фото»: арт-директор улучшает промпт перед отправкой.
  async function improvePhoto() {
    if (storageBlocked || improvingHas(activeSession?.id, 'photo')) return;
    const session = activeSession;
    const original = els.prompt.value.trim();
    if (!original || !needKey()) return;
    improvingAdd(session.id, 'photo');
    setBusy(true, 'Улучшаем промпт…');
    els.improvePhoto.classList.add('busy');
    try {
      const improved = await chatNonStream({
        messages: [
          { role: 'system', content: currentAssistant().system },
          { role: 'user', content: 'Улучши промпт:\n\n' + original }
        ],
        maxTokens: 600
      });
      if (session !== activeSession || mode !== 'photo' || els.prompt.value.trim() !== original) {
        card('notice', 'Предложение арт-директора', improved.trim(), session);
        feedPush({ t: 'notice', who: 'Предложение арт-директора', text: improved.trim() }, session);
        return;
      }
      sessionUndo(session, 'prompt', original);
      els.prompt.value = improved.trim();
      els.undoPhoto.hidden = false;
    } catch (error) { errorCard(error, session); }
    finally { improvingDelete(session.id, 'photo'); els.improvePhoto.classList.remove('busy'); setBusy(false); updateEnabled(); }
  }

  function undoPhoto() {
    const backup = sessionUndo(activeSession, 'prompt');
    if (backup == null) return;
    els.prompt.value = backup;
    delete activeSession.undo.prompt;
    els.undoPhoto.hidden = true;
    updateEnabled();
  }

  function newSessionRecord() {
    // Дефолты v2-сессии: роль — наставник, настройки из localStorage только как
    // дефолт (P2-2/P2-3 аудита #35: дальше выбор живёт в draft сессии).
    return { id: crypto.randomUUID(), assistantId: 'mentor', title: 'Новый чат', titleSet: false, createdAt: Date.now(), updatedAt: Date.now(), feed: [], history: [], draft: { quality: 'flash', instrumental } };
  }
  function saveDraft(session) {
    if (!session) return;
    drafts[mode] = els.prompt.value;
    // P2-2/P2-3: quality/instrumental пишутся в draft сессии; styleFamily
    // уже на session.draft — не затирается,spread сохраняет его.
    session.draft = { ...session.draft, prompts: { ...drafts }, lyrics: els.lyrics.value, musicPrompt: els.musicPrompt.value, mode, advanced, quality, instrumental };
  }
  function loadDraft(session) {
    const draft = session.draft || {};
    for (const key of Object.keys(drafts)) drafts[key] = draft.prompts?.[key] || '';
    mode = ['music', 'photo'].includes(draft.mode) ? draft.mode : 'music';
    advanced = !!draft.advanced;
    // P2-1: роль активной сессии; у сессий без роли (новых) — наставник.
    if (typeof session.assistantId !== 'string' || !CHAT_ROLES.some(a => a.id === session.assistantId)) session.assistantId = 'mentor';
    // P2-2/P2-3: качество и режим трека — из draft сессии.
    quality = draft.quality === 'pro' ? 'pro' : 'flash';
    instrumental = typeof draft.instrumental === 'boolean' ? draft.instrumental : instrumental;
    els.prompt.value = drafts[mode]; els.lyrics.value = draft.lyrics || ''; els.musicPrompt.value = draft.musicPrompt || '';
    // T-22: кнопки возврата отражают бэкапы именно этой сессии.
    els.undoLyrics.hidden = session.undo?.lyrics == null;
    els.undoPrompt.hidden = session.undo?.musicPrompt == null;
    els.undoPhoto.hidden = session.undo?.prompt == null;
    renderChrome();
  }
  function ensureRoot(session) {
    if (rootFor(session)) return;
    const root = document.createElement('div'); root.className = 'session-feed'; root.hidden = true;
    sessionRoots.set(session.id, root); els.feed.append(root);
    feedRestore(session);
    if (!session.history.length && session.feed.some(item => item.t === 'assistant' && item.track)) {
      card('notice', 'Контекст чата', 'Ранее сохранённая переписка показана выше, но её контекст не был сохранён.', session);
    }
  }
  let sessionTransition = false;
  async function activateSession(session) {
    saveDraft(activeSession);
    if (activeSession && !(await persistSessions())) return;
    if (activeSession) rootFor(activeSession).hidden = true;
    activeSession = session;
    sessionProfile.activeSessionId = session.id;
    ensureRoot(session);
    rootFor(session).hidden = false;
    loadDraft(session);
    setView('chat');
    closeSessions();
    renderOpsBadge(); // T-20: чужая занятость меняется при смене сессии
    persistSessions();
    resumeSessionJobs(session); // T-52: незакрытые генерации сессии продолжают ждать
    restoreMiniPlayer(); // P3 #35: мини-плеер возвращается после перезагрузки
  }
  async function selectSession(session) {
    if (!session || storageBlocked || sessionTransition) return;
    sessionTransition = true;
    try { await activateSession(session); } finally { sessionTransition = false; }
  }
  async function newChat() {
    if (storageBlocked || !activeSession || sessionTransition) return;
    sessionTransition = true;
    try {
      saveDraft(activeSession);
      if (!(await persistSessions())) {
        // T-29/A14: ошибка записи больше не запирает «Новый чат»: сессия
        // создаётся в памяти этой вкладки, плашка с экспортом уже видна.
        card('notice', 'Новый чат', 'Сессия создаётся в этой вкладке — сохранение в хранилище сейчас не работает (см. предупреждение сверху). Несохранённое можно скачать кнопкой в плашке.');
      }
      if (!activeSession.feed.length && !activeSession.history.length) { closeSessions(); return; }
      const session = newSessionRecord();
      sessionProfile.sessions.push(session);
      await activateSession(session);
    } finally { sessionTransition = false; }
  }
  function renderSessions() {
    els.sessionsList.textContent = '';
    const sessions = [...sessionProfile.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!sessions.length) { els.sessionsList.textContent = 'Здесь появятся ваши диалоги.'; return; }
    for (const session of sessions) {
      if (!session) continue; // хотфикс #23: мусорная запись не роняет рендер
      const button = document.createElement('button'); button.type = 'button'; button.className = 'session-item';
      button.setAttribute('aria-current', String(session === activeSession));
      const title = document.createElement('span'); title.textContent = session?.title || 'Новый чат';
      const date = document.createElement('time'); date.textContent = new Date(session?.updatedAt || session?.createdAt || Date.now()).toLocaleString('ru-RU');
      button.append(title, date); button.addEventListener('click', () => selectSession(session)); els.sessionsList.append(button);
    }
  }
  function openSessions() {
    if (!sessionProfile) return;
    closeMenus(); renderSessions(); els.sessionsOverlay.hidden = false; els.sessionsClose.focus();
  }
  function closeSessions() {
    if (els.sessionsOverlay.hidden) return;
    els.sessionsOverlay.hidden = true; els.sessionsOpen.focus();
  }

  function insertTag(tag) {
    const el = els.lyrics;
    const at = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, at);
    const after = el.value.slice(el.selectionEnd ?? at);
    const pad = before && !before.endsWith('\n') ? '\n' : '';
    el.value = before + pad + tag + (after && !after.startsWith('\n') ? '\n' : '') + after;
    el.focus();
    const pos = (before + pad + tag).length;
    el.setSelectionRange(pos, pos);
    updateEnabled();
  }

  // ---- auth: ник + PIN-пад (клиентский; переезд на серверную auth — INFRA #78) ----
  const PROFILES_KEY = 'briix-studio-profiles';
  const USER_KEY = 'briix-studio-user';
  const libKey = nick => 'briix-studio-library-' + nick;
  const PIN_MIN = 4, PIN_MAX = 6, PIN_MAX_FAILS = 5, PIN_LOCK_MS = 30000;

  function pinHash(nick, pin) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(nick + '::' + pin))
      .then(digest => [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join(''));
  }
  function profiles() { try { return JSON.parse(localStorage.getItem(PROFILES_KEY)) || {}; } catch { return {}; } }
  function saveProfiles(p) { try { localStorage.setItem(PROFILES_KEY, JSON.stringify(p)); } catch { /* приватный режим */ } }
  function currentUser() { return localStorage.getItem(USER_KEY) || ''; }

  let pinBuf = '';
  let pinFails = 0;
  let pinLockedUntil = 0;

  function renderDots() {
    els.pinDots.textContent = '';
    for (let i = 0; i < Math.max(pinBuf.length, PIN_MIN); i++) {
      const dot = document.createElement('span');
      dot.className = 'pd' + (i < pinBuf.length ? ' on' : '');
      els.pinDots.append(dot);
    }
    // F-02: состояние PIN озвучивается — role=status читает эту строку.
    const announce = document.createElement('span');
    announce.className = 'sr-only';
    announce.textContent = pinBuf.length ? 'Введено ' + pinBuf.length + ' ' + pinDigitsWord(pinBuf.length) : 'PIN не начат';
    els.pinDots.append(announce);
  }
  function pinDigitsWord(n) { return n % 10 === 1 && n % 100 !== 11 ? 'цифра' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'цифры' : 'цифр'); }
  function gateHint(text) { els.gateHint.textContent = text; }

  async function enterGate() {
    const nick = els.nickInput.value.trim();
    if (!nick) { gateHint('Сначала ник.'); els.nickInput.focus(); return; }
    if (pinBuf.length < PIN_MIN) { gateHint('PIN — от ' + PIN_MIN + ' цифр.'); return; }
    if (Date.now() < pinLockedUntil) { gateHint('Слишком много попыток — подождите полминуты.'); return; }
    const hash = await pinHash(nick, pinBuf);
    const profs = profiles();
    if (profs[nick]) {
      if (profs[nick].pinHash !== hash) {
        pinFails++;
        pinBuf = '';
        renderDots();
        if (pinFails >= PIN_MAX_FAILS) {
          pinLockedUntil = Date.now() + PIN_LOCK_MS;
          pinFails = 0;
          gateHint('Неверный PIN. Пауза 30 секунд.');
        } else {
          gateHint('Неверный PIN. Осталось попыток: ' + (PIN_MAX_FAILS - pinFails) + '.');
        }
        return;
      }
    } else {
      profs[nick] = { pinHash: hash, created: Date.now() };
      saveProfiles(profs);
      gateHint('Новый профиль создан.');
    }
    pinFails = 0;
    pinBuf = '';
    localStorage.setItem(USER_KEY, nick);
    startSession(nick);
  }

  async function startSession(nick) {
    storageBlocked = true; updateEnabled();
    els.gate.hidden = true; els.studio.hidden = false; els.profileNick.textContent = nick;
    els.feed.innerHTML = ''; sessionRoots.clear(); sessionProfile = null; activeSession = null;
    els.prompt.value = ''; els.lyrics.value = ''; els.musicPrompt.value = '';
    Object.keys(drafts).forEach(k => { drafts[k] = ''; });
    schemaRejected = false; if (schemaBanner) { schemaBanner.remove(); schemaBanner = null; }
    document.documentElement.removeAttribute('data-storage-ready'); // хук сюит: готов после open()
    mode = 'music'; advanced = false; quality = 'flash'; renderChrome(); setView('chat');
    try {
      const opened = await BriixSessionStore.open(nick);
      sessionProfile = opened.profile; sessionBackend = opened.backend;
      if (!sessionProfile.sessions.length) sessionProfile.sessions.push(newSessionRecord());
      activeSession = sessionProfile.sessions.find(x => x && x.id === sessionProfile.activeSessionId) || sessionProfile.sessions[0];
      // Хотфикс #23: битая запись не должна ронять вход — вместо краша создаём пустую сессию.
      if (!activeSession || typeof activeSession !== 'object' || !activeSession.id || !Array.isArray(activeSession.feed)) {
        activeSession = newSessionRecord();
        sessionProfile.sessions.push(activeSession);
      }
      sessionProfile.activeSessionId = activeSession.id;
      ensureRoot(activeSession); rootFor(activeSession).hidden = false; loadDraft(activeSession);
      storageBlocked = false;
      document.documentElement.setAttribute('data-storage-ready', '1'); // хук сюит (#35)
      await persistSessions();
      await restorePendingV1(); // П1 SPEC #35: несохранённое из прошлой v1-вкладки
      restoreMiniPlayer(); // P3 #35: мини-плеер возвращается после перезагрузки
      if (sessionBackend === 'local' && !storageDirty) {
        els.storageWarning.hidden = false;
        els.storageWarning.textContent = 'IndexedDB недоступна: сессии хранятся в localStorage этого браузера, объём ограничен.';
      }
    } catch (error) {
      warnStorage(error);
      els.storageWarning.textContent = 'Не удалось открыть сессии: ' + (error.message || 'ошибка хранилища') + ' Старые данные не удалены. Обновите страницу или освободите место.';
    }
    updateEnabled(); renderKeyChip();
    resumeSessionJobs(activeSession); // T-52: судьба джоб прошлой сессии — в ленту
  }

  // T-20/F-06: индикатор в шапке — «в другой сессии идёт работа»; клик переносит
  // туда, где живёт ✕ (остановить стрим из чужой сессии иначе невозможно).
  function renderOpsBadge() {
    const summary = BRIIX_OPS.running();
    const foreign = summary.ops.filter(op => op.sessionId && op.sessionId !== activeSession?.id);
    if (!foreign.length) { els.opsBadge.hidden = true; return; }
    const session = sessionProfile?.sessions.find(s => s.id === foreign[0].sessionId);
    els.opsBadge.textContent = (OP_KIND_LABELS[foreign[0].kind] || 'работа')
      + (foreign.length > 1 ? ' (+' + (foreign.length - 1) + ')' : '')
      + (session ? ' · ' + (session?.title || 'Новый чат') : '');
    els.opsBadge.hidden = false;
  }
  BRIIX_OPS.subscribe(renderOpsBadge);
  els.opsBadge.addEventListener('click', () => {
    const summary = BRIIX_OPS.running();
    const target = summary.ops.find(op => op.sessionId && op.sessionId !== activeSession?.id);
    const session = target && sessionProfile?.sessions.find(s => s.id === target.sessionId);
    if (session) selectSession(session);
  });

  // T-24: выход при живых операциях — явный выбор «остановить и выйти / остаться»,
  // а не тихий отказ (A20: refusal-карточка была невидима на вкладке «Библиотека»).
  const OP_KIND_LABELS = {
    chat: 'ответ наставника',
    music: 'генерация музыки', photo: 'генерация фото',
    producer: 'подготовка черновика', resume: 'ожидание генерации'
  };
  function opsSummaryLine(summary) {
    return Object.entries(summary.byKind).map(([kind, n]) => (OP_KIND_LABELS[kind] || kind) + (n > 1 ? ' ×' + n : '')).join(', ');
  }
  async function logout() {
    if (sessionTransition) return;
    const running = BRIIX_OPS.running();
    if (running.count) {
      els.opsText.textContent = 'Прямо сейчас выполняются: ' + opsSummaryLine(running)
        + '. «Остановить и выйти» отменит их на сервере — очереди и GPU освободятся; несохранённые тексты полей будут потеряны.';
      els.opsOverlay.hidden = false;
      els.opsStopLogout.focus();
      return;
    }
    await doLogout();
  }
  els.opsStay.addEventListener('click', () => { els.opsOverlay.hidden = true; els.profileBtn.focus(); });
  els.opsCancel.addEventListener('click', () => { els.opsOverlay.hidden = true; els.profileBtn.focus(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !els.opsOverlay.hidden) { els.opsOverlay.hidden = true; els.profileBtn.focus(); }
  });
  els.opsStopLogout.addEventListener('click', async () => {
    els.opsStopLogout.disabled = true;
    try {
      BRIIX_OPS.stopAll(); // abort локально + cancel каждой джобы на сервере (T-05)
      await new Promise(r => setTimeout(r, 150)); // дать отменам уйти
      await doLogout();
    } finally { els.opsStopLogout.disabled = false; }
  });
  async function doLogout() {
    els.opsOverlay.hidden = true;
    if (sessionTransition) return;
    if (sessionProfile) { saveDraft(activeSession); if (!(await persistSessions())) return; }
    libSeq++;
    if (producerSaveTimer) { clearTimeout(producerSaveTimer); producerSaveTimer = null; }
    resetFileQueue(); // T-27: очередь не дорабатывает загрузки ушедшего профиля
    sessionProfile = null; activeSession = null; storageBlocked = true; sessionRoots.clear();
    els.feed.innerHTML = ''; els.lib.innerHTML = '';
    els.prompt.value = ''; els.lyrics.value = ''; els.musicPrompt.value = '';
    Object.keys(drafts).forEach(k => { drafts[k] = ''; });
    document.documentElement.removeAttribute('data-storage-ready');
    mediaCacheClear(); // T-30/T-31: LRU-кэш медиа — все objectURL ревочатся
    coverUrlCache.forEach(url => URL.revokeObjectURL(url)); coverUrlCache.clear();
    feedObjectUrls.forEach(url => URL.revokeObjectURL(url)); feedObjectUrls.clear();
    newBelowCards.clear(); // F-39
    if (newBelowPill) newBelowPill.hidden = true;
    els.netBanner.hidden = true; // T-26
    localStorage.removeItem(USER_KEY);
    els.studio.hidden = true; els.gate.hidden = false; els.nickInput.value = '';
    pinBuf = ''; renderDots(); gateHint('PIN — 4–6 цифр. Новый ник регистрируется при первом входе.'); els.nickInput.focus();
  }

  // ---- библиотека (клиентская; переезд на GET /jobs — INFRA #77) ----------------
  const coverUrlCache = new Map(); // путь обложки → objectURL (T-36, LRU 60)
  let libFilter = 'all';

  function libLoad() {
    const nick = currentUser();
    if (!nick) return [];
    try { return JSON.parse(localStorage.getItem(libKey(nick))) || []; } catch { return []; }
  }
  function libSave(list) {
    const nick = currentUser();
    if (nick) {
      try { localStorage.setItem(libKey(nick), JSON.stringify(list)); } catch { /* переполнение */ }
      broadcast('lib'); // T-26: соседняя вкладка перерисует библиотеку без storage-событий
    }
  }
  function libAdd(entry) {
    const list = libLoad();
    list.unshift(entry);
    libSave(list);
    if (!els.lib.hidden) renderLibrary();
  }

  const KIND_LABELS = { photo: 'Фото', music: 'Музыка' };
  const FILTERS = [['all', 'Все'], ['photo', 'Фото'], ['music', 'Музыка'], ['fav', '★ Избранное']];

  // Серверная библиотека (infra#77): GET /jobs как первоисточник, клиентские записи — дополнение.
  let libSeq = 0;
  const jobsInFlight = new Map();
  function serverJobs() {
    const origin = server(), credential = token(), owner = currentUser();
    const key = JSON.stringify([origin, credential, owner]);
    if (jobsInFlight.has(key)) return jobsInFlight.get(key);
    const work = (async () => {
      const response = await fetch(origin + '/jobs?limit=100', { headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' } });
      if (!response.ok) {
        if (response.status === 401) throw new BusError('unauthorized', 'Ключ не принят (401).', 401);
        throw new BusError('http', 'Библиотека недоступна (' + response.status + ').', response.status);
      }
      const payload = await response.json();
      return Array.isArray(payload?.items) ? payload.items : [];
    })();
    jobsInFlight.set(key, work);
    const clear = () => { if (jobsInFlight.get(key) === work) jobsInFlight.delete(key); };
    work.then(clear, clear);
    return work;
  }

  // T-36: скелет и карточки Библиотеки живут между вызовами — renderLibrary
  // больше не начинается с innerHTML='' (замер A11: 100 пересозданных обсерверов
  // и 75 повторных загрузок обложек на один клик ♥). Полная пересборка — только
  // при входе/выходе/смене профиля;.favorite/delete — точечные мутации.
  const libState = { built: false, owner: '', filterRow: null, privacy: null, note: null, results: null, cards: new Map() };
  const libControls = new Map(); // job → { applyFav, removeSelf } — точечные мутации карточек
  // Сигнатура нормализует optional-поля (undefined ≡ ''): серверная сверка не
  // должна пересобирать живую карточку из-за приведения типов (T-36).
  const libSignature = entry => JSON.stringify([entry.kind, entry.prompt || '', entry.model || '', entry.created || 0, entry.lyrics || '',
    entry.fav ? 1 : 0, entry.file || '', entry.cover || '', entry.sessionId || '', entry.title || '']);

  function libSkeleton() {
    if (libState.built && libState.results?.isConnected && libState.owner === currentUser()) return;
    libState.built = false;
    libState.cards.clear();
    libControls.clear();
    els.lib.textContent = '';
    const filterRow = document.createElement('div');
    filterRow.className = 'lib-filters';
    for (const [value, label] of FILTERS) {
      const chip = document.createElement('button');
      chip.className = 'tag';
      chip.textContent = label;
      chip.dataset.filter = value;
      chip.addEventListener('click', () => { libFilter = value; renderLibrary(); });
      filterRow.append(chip);
    }
    // T-41: плашка приватности — серверный список /jobs общий до серверного скоупинга
    // (INFRA, §2.8 аудита); клиент прячет только атрибутируемых чужих.
    const privacy = document.createElement('div');
    privacy.className = 'lib-privacy';
    privacy.setAttribute('role', 'status');
    privacy.hidden = true;
    const results = document.createElement('div');
    results.className = 'lib-results';
    const note = document.createElement('div');
    note.className = 'card notice';
    note.textContent = 'Загружаем библиотеку…';
    els.lib.append(filterRow, privacy, note, results);
    Object.assign(libState, { built: true, owner: currentUser(), filterRow, privacy, note, results });
  }

  // Точечная мутация избранного: класс карточки, подпись кнопки, сигнатура
  // диффинга — без пересборки списка и без повторных загрузок (T-36).
  function libApplyFav(job, next) {
    const item = libState.cards.get(job);
    if (item) { item.entry.fav = next; item.signature = libSignature(item.entry); }
    libControls.get(job)?.applyFav(next);
  }

  function renderLibrary() {
    libSkeleton();
    for (const chip of libState.filterRow.querySelectorAll('.tag')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.filter === libFilter));
    }
    const { cards, note, results, privacy } = libState;
    const render = (list) => {
      if (list.length) note.hidden = true;
      if (!list.length) {
        for (const item of cards.values()) { item.node.remove(); libControls.delete(item.entry.job); }
        cards.clear();
        note.hidden = false;
        note.textContent = libFilter === 'all'
          ? 'Пока пусто — создайте фото или трек в чате, они появятся здесь.'
          : 'В этом фильтре пусто.';
        return;
      }
      const wanted = new Set();
      list.forEach((entry, index) => {
        const signature = libSignature(entry);
        let item = cards.get(entry.job);
        if (!item || item.signature !== signature) {
          const node = libCard(entry);
          if (item) item.node.replaceWith(node);
          item = { node, signature, entry }; cards.set(entry.job, item);
        } else {
          // Карточка жива: обновляем данные (серверная мутабельность), узел не трогаем.
          Object.assign(item.entry, entry);
        }
        wanted.add(entry.job);
        if (results.children[index] !== item.node) results.insertBefore(item.node, results.children[index] || null);
      });
      for (const [job, item] of cards) if (!wanted.has(job)) { item.node.remove(); cards.delete(job); libControls.delete(job); }
    };
    // мгновенно — клиентские записи, чтобы вкладка не мигала пустотой
    const local = libLoad().filter(e => libFilter === 'all' ? true : libFilter === 'fav' ? e.fav : e.kind === libFilter);
    render(local);
    // затем серверный список поверх (объединение по job id)
    const seq = ++libSeq;
    serverJobs().then(items => {
      if (seq !== libSeq) return; // устаревший прогон рендера
      const byId = new Map();
      const owner = currentUser();
      for (const e of libLoad()) byId.set(e.job, e);
      const merged = [];
      let foreignHidden = 0;
      for (const j of items) {
        const kind = j.type === 'image' ? 'photo' : j.type === 'music' ? 'music' : j.type;
        const localEntry = byId.get(j.id);
        if (localEntry) {
          localEntry.fav = !!j.favorite;
          localEntry.server = true;
          localEntry.file = j.result_url || localEntry.file;
          localEntry.cover = j.cover_url || localEntry.cover || '';
          localEntry.created = localEntry.created || (j.created_at || 0) * 1000;
          merged.push(localEntry);
          byId.delete(j.id);
        } else if (j.result_url) {
          // T-41: общий ключ = общий список. Чужая запись (params.artist ≠ ник)
          // не показывается и не может быть удалена/лайкнута из этого профиля.
          // Записи без artist (старые стенды, фото до 15.11) неатрибутируемы —
          // показываем, как раньше: серверного признака владельца нет.
          const artist = typeof j.params?.artist === 'string' ? j.params.artist : '';
          if (artist && artist !== owner) { foreignHidden++; continue; }
          merged.push({
            job: j.id, kind, prompt: j.prompt || '',
            file: j.result_url, cover: j.cover_url || '',
            created: (j.created_at || 0) * 1000, fav: !!j.favorite, server: true,
            lyrics: j.params?.lyrics || '', model: j.params?.model || '',
            title: typeof j.params?.title === 'string' ? j.params.title : ''
          });
        }
      }
      for (const e of byId.values()) merged.push(e);
      merged.sort((a, b) => (b.created || 0) - (a.created || 0));
      // Серверное изменение favorite (с другого устройства) меняет сигнатуру —
      // render пересоберёт только эту карточку; свои клики ♥ идут мимо рендера.
      render(merged.filter(e => libFilter === 'all' ? true : libFilter === 'fav' ? e.fav : e.kind === libFilter));
      privacy.hidden = !foreignHidden;
      privacy.textContent = foreignHidden
        ? 'Показаны только ваши треки: скрыто чужих — ' + foreignHidden + '. Серверный список общий до серверного разграничения.'
        : '';
    }).catch((error) => {
      if (seq !== libSeq) return;
      note.hidden = false;
      note.textContent = error instanceof BusError && error.status === 401
        ? 'Серверная библиотека недоступна: проверьте ключ (профиль → «Ключ доступа…»).'
        : 'Серверная библиотека недоступна — показаны локальные записи.';
    });
  }

  function showLibError(container, message) {
    let note = container.querySelector('.lib-error');
    if (!note) { note = document.createElement('div'); note.className = 'lib-error'; note.setAttribute('role', 'status'); container.append(note); }
    note.textContent = message;
  }

  // Обложки и медиа используют общую ограниченную очередь; ошибку 429 повторяет fileBlob.
  function addTrackCover(container, job, cover, miniature = false, coverTitle = '') {
    const frame = document.createElement('div');
    const owner = currentUser();
    frame.className = miniature ? 'lib-cover' : 'track-cover';
    frame.textContent = '♫';
    frame.setAttribute('aria-label', 'Обложка недоступна');
    container.append(frame);
    // В библиотеке cover_url приходит вместе с серверным списком; не делаем GET /jobs для каждой карточки.
    if ((!job && !cover) || (miniature && !cover)) return;
    const enqueue = () => {
      libQueue.push(async () => {
        if (!frame.isConnected || currentUser() !== owner) return;
        try {
          const path = cover || (await serverJobs()).find(item => item.id === job)?.cover_url;
          if (!path || !frame.isConnected || currentUser() !== owner) return;
          // T-36: кэш проверяется ДО загрузки — повторная карточка (Библиотека
          // после ленты) не качает обложку заново и не занимает слот очереди.
          let url = coverUrlCache.get(path);
          if (!url) {
            const blob = await fileBlob(path, 2);
            if (!frame.isConnected || currentUser() !== owner) return;
            url = URL.createObjectURL(blob);
            coverUrlCache.set(path, url);
            if (coverUrlCache.size > 60) { const oldest = coverUrlCache.keys().next().value; URL.revokeObjectURL(coverUrlCache.get(oldest)); coverUrlCache.delete(oldest); }
          }
          const image = new Image(); image.alt = coverTitle ? 'Обложка трека «' + coverTitle + '»' : 'Обложка трека'; // F-51
          image.decoding = 'async'; // T-40
          image.onerror = () => {
            coverUrlCache.delete(path);
            if (frame.contains(image)) { frame.textContent = '♫'; frame.setAttribute('aria-label', 'Обложка недоступна'); }
          };
          image.src = url; frame.textContent = ''; frame.removeAttribute('aria-label'); frame.append(image);
        } catch (error) {
          if (!frame.isConnected || currentUser() !== owner) return;
          const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'cover-retry';
          retry.textContent = '↻'; retry.setAttribute('aria-label', (error.message || 'Обложка недоступна') + ' Повторить загрузку.');
          retry.title = (error.message || 'Обложка недоступна') + ' Повторить';
          retry.addEventListener('click', () => { frame.textContent = '…'; enqueue(); });
          frame.textContent = ''; frame.append(retry);
        }
      });
      libPump();
    };
    const observer = new IntersectionObserver((records, obs) => {
      if (!frame.isConnected) { obs.disconnect(); return; }
      if (records.some(record => record.isIntersecting)) { obs.disconnect(); enqueue(); }
    }, { rootMargin: '150px' });
    observer.observe(frame);
  }

  // #35 W1-4: экспортные варианты (WAV/обложка) из Библиотеки — тот же честный
  // путь, что в ленте: нет файла на сервере — честная ошибка, без фейков.
  async function exportFromLib(entry, input, fileOrPath, ext, label) {
    const path = /^https?:|^\//.test(fileOrPath) ? fileOrPath : '/files/' + fileOrPath;
    try {
      const blob = await fileBlob(path, 1);
      const name = mediaFileName('music', input, blob, ext);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = name;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      BRIIX_TOASTS.toast('Скачано: ' + name + ' (' + fmtBytes(blob.size) + ')', { kind: 'done', key: 'download' });
    } catch (error) {
      const why = error.code === 'not_found' || error.status === 404
        ? 'сервер пока не отдаёт этот формат (нет файла) — доступно M4A'
        : (error.message || 'ошибка загрузки');
      showLibError(els.lib, label + ': ' + why);
    }
  }

  function libCard(entry) {
    const div = document.createElement('div');
    const owner = currentUser();
    div.className = 'card lib-item' + (entry.fav ? ' fav' : '');
    // строка-карточка (эталон владельца): обложка-миниатюра слева, контент справа
    const main = document.createElement('div');
    main.className = 'lib-main';
    const who = document.createElement('div');
    who.className = 'who';
    let whoText = KIND_LABELS[entry.kind] || entry.kind;
    // F-19: человекое имя модели (Flash/Pro), а не сырой id из контракта.
    if (entry.kind === 'music' && entry.model) {
      const modelKey = Object.keys(MUSIC_MODELS).find(key => MUSIC_MODELS[key] === entry.model);
      whoText += ' · ' + (MODEL_LABELS[modelKey] || entry.model);
    }
    whoText += ' · ' + new Date(entry.created).toLocaleString('ru-RU');
    who.textContent = whoText;
    const row = document.createElement('div');
    row.className = 'actions';
    const download = document.createElement('a');
    download.className = 'action';
    download.textContent = entry.kind === 'music' ? '⬇ Скачать аудио' : '⬇ Скачать';
    download.href = '#';
    download.addEventListener('click', async e => {
      e.preventDefault();
      if (download.classList.contains('busy')) return;
      try {
        // T-30/T-31: кэш по пути файла (LRU ≤8/32 МБ) — повторное скачивание
        // не качает файл заново и не плодит objectURL (A12).
        let entry2 = mediaCacheGet(mediaKey(entry.file));
        if (!entry2) {
          // F-21: честное «Загружаем…» вместо молчаливого ожидания очереди файлов.
          download.classList.add('busy');
          const idleLabel = download.textContent;
          download.textContent = '⬇ Загружаем…';
          try {
            const blob = await fileBlob(entry.file);
            if (currentUser() !== owner) return;
            entry2 = mediaCachePut(mediaKey(entry.file), blob);
          } finally { download.classList.remove('busy'); download.textContent = idleLabel; }
        }
        const link = document.createElement('a');
        link.href = entry2.url;
        // F-22: единое правило имени — как из ленты: «Название - Исполнитель.ext».
        link.download = mediaFileName(entry.kind, entry, { type: entry2.blob.type || '' });
        link.title = link.download;
        document.body.append(link); link.click(); link.remove();
        BRIIX_TOASTS.toast('Скачано: ' + link.download + ' (' + fmtBytes(entry2.blob.size) + ')', { kind: 'done', key: 'download' });
      } catch (error) { showLibError(div, 'Не удалось скачать файл. ' + (error.message || 'Проверьте подключение и попробуйте снова.')); }
    });
    const fav = document.createElement('button');
    fav.type = 'button';
    fav.className = 'action';
    fav.textContent = entry.fav ? '★ В избранном' : '☆ В избранное';
    fav.addEventListener('click', async () => {
      const next = !entry.fav;
      fav.disabled = true;
      if (entry.server) { // серверная запись — флаг на шине (infra#77)
        try {
          await request('/jobs/' + encodeURIComponent(entry.job) + '/favorite', {
            method: 'POST', headers: headers(), body: JSON.stringify({ favorite: next })
          });
        } catch { fav.disabled = false; showLibError(div, 'Не удалось обновить избранное.'); return; }
      }
      if (currentUser() !== owner) return;
      const list = libLoad();
      const item = list.find(x => x.job === entry.job);
      if (item) { item.fav = next; libSave(list); }
      libApplyFav(entry.job, next); // T-36: точечная мутация вместо полного ре-рендера
      fav.disabled = false;
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'action';
    del.textContent = '🗑 Удалить';
    del.addEventListener('click', async () => {
      // F-23: честное объяснение последствий для серверной и локальной записи.
      const ok = await BRIIX_TOASTS.confirmDialog({
        title: 'Удалить из библиотеки?',
        body: entry.server
          ? 'Серверная запись будет удалена и на сервере — скачивание этого файла перестанет работать. Если файл нужен — сначала скачайте его.'
          : 'Запись исчезнет из библиотеки этого браузера. Файл на сервере не трогаем.',
        confirmLabel: 'Удалить', danger: true
      });
      if (!ok) return;
      if (entry.server) {
        try { await request('/jobs/' + encodeURIComponent(entry.job), { method: 'DELETE', headers: headers() }); }
        catch { showLibError(div, 'Не удалось удалить запись.'); return; }
      }
      if (currentUser() !== owner) return;
      libSave(libLoad().filter(x => x.job !== entry.job));
      mediaCacheDrop(mediaKey(entry.file)); // T-30: objectURL файла ревочится
      jobsInFlight.clear(); // серверный список изменился — при следующем рендере перечитать
      libControls.get(entry.job)?.removeSelf(); // T-36: точечное удаление без пересборки
    });
    const sourceSession = sessionProfile?.sessions.find(s => s.id === entry.sessionId || s.feed.some(item => item && item.job === entry.job) || s.jobs?.some(item => item.job === entry.job));
    // T-36: регистрируем точечные мутации этой карточки (♥/удаление без пересборки).
    libControls.set(entry.job, {
      applyFav: next => {
        entry.fav = next;
        div.classList.toggle('fav', next);
        fav.textContent = next ? '★ В избранном' : '☆ В избранное';
        if (libFilter === 'fav' && !next) { div.remove(); libState.cards.delete(entry.job); libControls.delete(entry.job); }
      },
      removeSelf: () => { div.remove(); libState.cards.delete(entry.job); libControls.delete(entry.job); }
    });
    if (entry.kind !== 'music') {
      const promptEl = document.createElement('div');
      promptEl.className = 'body lib-prompt';
      promptEl.textContent = entry.prompt || '';
      const media = document.createElement('div');
      media.className = 'lib-media';
      // R2/T-18: фото Библиотеки — та же единая фото-карточка, что в ленте;
      // скачанный однажды файл не качается повторно — общий LRU-кэш (T-31).
      media.append(photoCard({
        file: entry.file,
        loadBlob: () => fileBlob(entry.file, 1)
      }).body);
      row.append(download, fav, del);
      main.append(who, promptEl, media, row);
      div.append(main);
      return div;
    }
    // Музыкальная карточка библиотеки = тот же единый компонент, что и в ленте
    // (.track-card): обложка-мини = PLAY, волна из пиков, lazy-загрузка по клику.
    addTrackCover(div, entry.job, entry.cover, true, entry.title || entry.prompt || '');
    const sourceInput = sourceSession?.feed.find(item => item && item.job === entry.job)?.input || sourceSession?.jobs?.find(item => item.job === entry.job)?.input || {};
    const input = {
      ...sourceInput,
      prompt: sourceInput.prompt || entry.prompt || '',
      promptSent: sourceInput.promptSent,
      lyrics: entry.lyrics || sourceInput.lyrics || '',
      title: sourceInput.title || entry.title || '',
      artist: sourceInput.artist || currentUser()
    };
    const track = buildTrackCard({
      job: entry.job, cover: entry.cover, input, file: entry.file,
      coverFrame: div.querySelector('.lib-cover'),
      loadBlob: () => fileBlob(entry.file, 0),
      menuItems: () => [
        { label: 'Скачать аудио (M4A)', onPick: () => download.click() },
        { label: 'Скачать WAV — мастер без тегов', onPick: () => exportFromLib(entry, input, entry.job + '.wav', 'wav', 'WAV-мастер') },
        { label: 'Скачать обложку', onPick: () => exportFromLib(entry, input, entry.cover || entry.job + '-cover.png', 'png', 'Обложка') },
        { label: 'Копировать промпт', onPick: () => copyText(input.promptSent || entry.prompt || '', 'промпт') },
        { label: 'Копировать лирику', onPick: () => copyText(entry.lyrics || input.lyrics || '', 'лирика') },
        ...(lyricsWrap ? [{ label: 'Показать лирику', onPick: () => {
          const open = lyricsWrap.classList.toggle('open');
          lyricsWrap.querySelector('.lib-lyrics-text').hidden = !open;
        } }] : []),
        { label: 'Повторить с правками', onPick: () => repeatMusic(entry, sourceInput) },
        { label: 'Создать обложку', onPick: () => createCoverDraft(entry) },
        { label: entry.fav ? 'Убрать из избранного' : 'В избранное', onPick: () => fav.click() },
        { label: 'Удалить', danger: true, onPick: () => del.click() },
        ...(sourceSession ? [{ label: 'Открыть сессию: ' + (sourceSession?.title || 'Новый чат'), onPick: () => selectSession(sourceSession) }] : [])
      ]
    });
    main.append(who);
    // «Сессия: …» — только когда сессия известна локально; «Сессия неизвестна» не показываем.
    if (sourceSession) {
      const origin = document.createElement('div'); origin.className = 'hint';
      origin.textContent = 'Сессия: ' + (sourceSession?.title || 'Новый чат');
      main.append(origin);
    }
    // Текст песни — раскрывающим блоком из меню «⋯», отдельной строки в карточке нет.
    let lyricsWrap = null;
    if (entry.lyrics) {
      lyricsWrap = document.createElement('div');
      lyricsWrap.className = 'lib-lyrics';
      const lyricsBody = document.createElement('div');
      lyricsBody.className = 'lib-lyrics-text';
      lyricsBody.hidden = true;
      lyricsBody.textContent = entry.lyrics;
      lyricsWrap.append(lyricsBody);
      main.append(lyricsWrap);
    }
    const wrap = document.createElement('div'); wrap.className = 'lib-body';
    wrap.append(track.body);
    main.append(wrap);
    div.append(main);
    return div;
  }

  // Cover lookup work is bounded separately; actual file transfers share fileQueue.
  const libQueue = [];
  let libActive = 0;
  const LIB_PARALLEL = 2;
  function libPump() {
    while (libActive < LIB_PARALLEL && libQueue.length) {
      const task = libQueue.shift();
      libActive++;
      task().finally(() => { libActive--; libPump(); });
    }
  }

  function tryPlay(audio, container) {
    if (!audio.isConnected || audio.closest('[hidden]')) return;
    const playing = audio.play();
    if (playing && typeof playing.catch === 'function') playing.catch(() => {
      if (!audio.isConnected) return;
      const hint = document.createElement('p'); hint.className = 'media-play-hint';
      hint.textContent = 'Аудио загружено. Нажмите воспроизведение в плеере.';
      container.append(hint);
    });
  }

  // ---- вкладки: Чат / Библиотека -------------------------------------------------
  function setView(next) {
    els.tabs.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === next)));
    els.feed.hidden = next !== 'chat';
    els.lib.hidden = next !== 'library';
    els.composer.hidden = next !== 'chat';
    if (next === 'library') renderLibrary();
    if (next === 'chat') paintPill(); // F-39: после возврата из Библиотеки счёт жив
  }

  // ---- T-26: сеть, видимость вкладки, синхронизация вкладок ---------------------
  // Поллинг не долбит стенд из фоновой вкладки; возврат в вкладку/сеть —
  // немедленный опрос и перечитывание библиотеки; вторая вкладка видит
  // изменения первой без перезагрузки (BroadcastChannel).
  let netOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  let pageHidden = typeof document !== 'undefined' && document.hidden;
  let hiddenSince = 0, hiddenTotalMs = 0;
  const visibleWaiters = new Set();
  const onlineWaiters = new Set();
  function hiddenMs() { return hiddenTotalMs + (hiddenSince ? Date.now() - hiddenSince : 0); }
  function waitPageVisible() {
    if (!pageHidden) return Promise.resolve();
    return new Promise(resolve => visibleWaiters.add(resolve));
  }
  function waitNetOnline() {
    if (netOnline) return Promise.resolve();
    return new Promise(resolve => onlineWaiters.add(resolve));
  }
  function refreshAfterReturn() {
    // Библиотека/статус могли измениться, пока вкладка спала: серверный список
    // перечитывается, открытая Библиотека перерисовывается.
    if (!currentUser() || storageBlocked) return;
    jobsInFlight.clear();
    if (!els.lib.hidden) renderLibrary();
  }
  document.addEventListener('visibilitychange', () => {
    const nowHidden = document.hidden;
    if (nowHidden && !hiddenSince) hiddenSince = Date.now();
    if (!nowHidden && hiddenSince) { hiddenTotalMs += Date.now() - hiddenSince; hiddenSince = 0; }
    const was = pageHidden;
    pageHidden = nowHidden;
    if (was && !nowHidden) {
      for (const resolve of visibleWaiters) resolve();
      visibleWaiters.clear();
      refreshAfterReturn();
    }
  });
  // Баннер «Нет соединения» — единственное место, где пользователь видит
  // состояние сети; запросы при этом падают сразу и с понятным текстом (T-26).
  function paintNetBanner() {
    els.netBanner.hidden = netOnline;
    els.netBanner.textContent = 'Нет соединения с сервером. Отправка и генерации приостановлены — они продолжатся, когда сеть вернётся.';
  }
  window.addEventListener('offline', () => {
    netOnline = false;
    paintNetBanner();
    if (!els.status.classList.contains('busy')) setStatus(null, false); // P3 #35: не «готов», когда сети нет
  });
  window.addEventListener('online', () => {
    netOnline = true;
    paintNetBanner();
    if (!els.status.classList.contains('busy')) setStatus(null, false);
    for (const resolve of onlineWaiters) resolve();
    onlineWaiters.clear();
    refreshAfterReturn();
  });
  // BroadcastChannel('briix-studio'): сессии/библиотека синхронизируются между
  // вкладками одного браузера (сейчас вторая вкладка видит чужие изменения
  // только после перезагрузки).
  let studioChannel = null;
  function broadcast(type) {
    try { studioChannel?.postMessage({ type, user: currentUser() }); } catch { /* канал закрыт */ }
  }
  try {
    if ('BroadcastChannel' in window) {
      studioChannel = new BroadcastChannel('briix-studio');
      studioChannel.addEventListener('message', event => {
        const data = event.data;
        if (!data || data.user !== currentUser()) return;
        if (data.type === 'lib') {
          jobsInFlight.clear();
          if (!els.lib.hidden) renderLibrary();
        }
      });
    }
  } catch { /* нет канала — вкладки просто не синхронизируются */ }
  // ---- wiring -------------------------------------------------------------------
  els.modes.addEventListener('click', e => {
    const button = e.target.closest('.mode');
    if (!button) return;
    setMode(button.dataset.mode);
  });

  els.tuneToggle.addEventListener('click', () => { advanced = !advanced; renderChrome(); });
  els.vocalSeg.addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    instrumental = btn.dataset.vocal === '1';
    // P2-3 аудита #35: режим трека — состояние сессии (localStorage остаётся
    // только дефолтом НОВОЙ сессии и здесь не перезаписывается).
    if (activeSession) { if (!activeSession.draft || typeof activeSession.draft !== 'object') activeSession.draft = {}; activeSession.draft.instrumental = instrumental; saveDraftSoon(); }
    renderChrome();
  });

  els.send.addEventListener('click', create);
  // Явная генерация текущих полей без диалога (решение владельца 15.11):
  // отдельная кнопка «Сгенерировать трек» рядом с send в музыкальном режиме.
  els.genTrack.addEventListener('click', async () => {
    if (storageBlocked || !activeSession || mode !== 'music' || !needKey()) return;
    if (!promptValue() && !(advanced && els.lyrics.value.trim())) return;
    await createMusic(promptValue());
  });
  els.prepareMusic.addEventListener('click', prepareMusic);
  // F-33: черновик композера пишется на вводе (дебаунс 400 мс) — раньше
  // набранный текст терялся при закрытии вкладки без смены сессии.
  for (const el of [els.prompt, els.lyrics, els.musicPrompt]) el.addEventListener('input', saveDraftSoon);
  els.improveLyrics.addEventListener('click', () => improve('lyrics'));
  // Ключ 'musicPrompt' (а не 'prompt'): undo('musicPrompt') читает тот же ключ —
  // раньше кнопка возврата стиля была видима, но не работала (запись шла в 'prompt').
  els.improvePrompt.addEventListener('click', () => improve('musicPrompt'));
  els.undoLyrics.addEventListener('click', () => undo('lyrics'));
  els.undoPrompt.addEventListener('click', () => undo('musicPrompt'));
  els.improvePhoto.addEventListener('click', improvePhoto);
  els.undoPhoto.addEventListener('click', undoPhoto);
  els.newChat.addEventListener('click', newChat);
  els.sessionsOpen.addEventListener('click', openSessions);
  els.sessionsClose.addEventListener('click', closeSessions);
  els.sessionsNew.addEventListener('click', newChat);
  els.sessionsOverlay.addEventListener('click', e => { if (e.target === els.sessionsOverlay) closeSessions(); });
  els.sessionsDialog.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); closeSessions(); return; }
    if (e.key !== 'Tab') return;
    const buttons = [...els.sessionsDialog.querySelectorAll('button:not(:disabled)')];
    if (!buttons.length) { e.preventDefault(); return; }
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  els.tags.addEventListener('click', e => {
    const tag = e.target.closest('.tag');
    if (tag) insertTag(tag.dataset.tag);
  });

  els.addBtn.addEventListener('click', e => {
    e.stopPropagation();
    card('notice', 'Вложения', 'Прикрепление файлов скоро — пока опишите всё текстом.');
  });

  els.prompt.addEventListener('input', updateEnabled);
  els.lyrics.addEventListener('input', updateEnabled);
  els.musicPrompt.addEventListener('input', () => {
    // P1 аудита #35: ручная правка описания отменяет подсказку резолвера —
    // семейство стиля живёт на сессии и чистится там же.
    if (activeSession?.draft?.styleFamily) { delete activeSession.draft.styleFamily; paintStyleFamilyBadge(); }
    updateEnabled();
  });

  els.keySave.addEventListener('click', async () => {
    const value = els.keyInput.value.trim();
    if (!value) {
      // F-43: пустое поле — это удаление ключа, а не «сохранение пустоты».
      if (!token()) { els.keyCard.hidden = true; return; }
      const ok = await BRIIX_TOASTS.confirmDialog({
        title: 'Удалить сохранённый ключ?',
        body: 'Запросы к серверу перестанут проходить, пока не введёте новый ключ. Сессии и библиотека останутся.',
        confirmLabel: 'Удалить', danger: true
      });
      if (!ok) return;
      setToken('');
      BRIIX_TOASTS.toast('Ключ удалён.', { kind: 'info' });
    } else {
      setToken(value, { remember: els.keyRemember.checked });
      loadCatalog(); // P3 #35: ключ появился — теперь можно запросить каталог моделей
      BRIIX_TOASTS.toast(els.keyRemember.checked
        ? 'Ключ сохранён — запомнен в этом браузере.'
        : 'Ключ сохранён — до закрытия этой вкладки.', { kind: 'done' });
    }
    els.keyInput.value = '';
    els.keyCard.hidden = true;
    renderKeyChip();
  });

  // Профиль-меню в панели вкладок: пункты статичные, меню руками (не attachMenu).
  els.profileBtn.addEventListener('click', e => {
    e.stopPropagation();
    const willOpen = els.profileMenu.hidden;
    closeMenus();
    if (!willOpen) return;
    renderKeyChip();
    els.profileMenu.hidden = false;
    els.profileBtn.setAttribute('aria-expanded', 'true');
    els.profileMenu.querySelector('button')?.focus();
  });
  els.profileKeyBtn.addEventListener('click', () => {
    closeMenus();
    els.keyCard.hidden = false;
    els.keyInput.focus();
  });
  els.profileLogoutBtn.addEventListener('click', async () => {
    closeMenus();
    if (await BRIIX_TOASTS.confirmDialog({
      title: 'Выйти из профиля?',
      body: 'Профиль «' + currentUser() + '» останется в этом браузере вместе с сессиями и библиотекой; ключ доступа не удаляется. Идущие генерации можно остановить на следующем шаге.',
      confirmLabel: 'Выйти', danger: true
    })) logout();
  });
  // T-43: «Выйти и очистить это устройство» — для общих устройств: удаляет
  // ключ, профили, сессии (IndexedDB), библиотеки и настройки. Файлы на
  // сервере не трогаем (их всё равно удаляет retention).
  els.profileWipeBtn.addEventListener('click', async () => {
    closeMenus();
    const ok = await BRIIX_TOASTS.confirmDialog({
      title: 'Выйти и очистить это устройство?',
      body: 'Будут удалены: ключ доступа, все профили и PIN, сессии и история диалогов, библиотеки и настройки. Отменить будет нельзя — скачайте нужное заранее. Файлы на сервере не трогаем.',
      confirmLabel: 'Очистить и выйти', danger: true
    });
    if (!ok) return;
    BRIIX_OPS.stopAll();
    els.opsOverlay.hidden = true;
    try { await BriixSessionStore.wipe(); } catch { /* даже если база занята — локальное чистим */ }
    for (const key of Object.keys(localStorage)) {
      if (/^briix-/.test(key)) localStorage.removeItem(key);
    }
    sessionStorage.removeItem(TOKEN_SESSION_KEY);
    sessionProfile = null; activeSession = null; storageBlocked = true; sessionRoots.clear();
    els.feed.textContent = ''; els.lib.textContent = '';
    els.prompt.value = ''; els.lyrics.value = ''; els.musicPrompt.value = '';
    Object.keys(drafts).forEach(k => { drafts[k] = ''; });
    sessionBusy.clear();
    mediaCacheClear(); // T-30/T-31
    coverUrlCache.forEach(url => URL.revokeObjectURL(url)); coverUrlCache.clear();
    feedObjectUrls.forEach(url => URL.revokeObjectURL(url)); feedObjectUrls.clear();
    renderOpsBadge();
    els.studio.hidden = true; els.gate.hidden = false;
    els.nickInput.value = '';
    pinBuf = ''; renderDots(); gateHint('PIN — 4–6 цифр. Общее устройство? После работы используйте «Выйти и очистить это устройство».');
    els.nickInput.focus();
  });

  // пин-пад: цифры и backspace
  els.pinpad.addEventListener('click', e => {
    const button = e.target.closest('.pk');
    if (!button) return;
    if (button.dataset.digit && pinBuf.length < PIN_MAX) {
      pinBuf += button.dataset.digit;
      renderDots();
      gateHint('');
    } else if (button.dataset.action === 'back') {
      pinBuf = pinBuf.slice(0, -1);
      renderDots();
    }
  });
  els.enterBtn.addEventListener('click', enterGate);
  els.nickInput.addEventListener('keydown', e => { if (e.key === 'Enter') els.pinpad.querySelector('[data-digit="1"]').focus(); });
  els.tabs.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab) setView(tab.dataset.tab);
  });

  // Enter отправляет в чате, Shift+Enter — перенос строки (как в обычном мессенджере).
  // F-50: единое поведение во всех режимах (раньше в фото/музыке Enter молча делал перенос).
  els.prompt.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      create();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && document.activeElement === activePromptEl()) create();
  });

  // ---- старт: сессия или гейт входа ------------------------------------------------
  renderDots();
  renderChrome();
  const savedUser = currentUser();
  if (savedUser && profiles()[savedUser]) startSession(savedUser);
  else { els.gate.hidden = false; els.nickInput.focus(); }
  // Кеш-самолечение (хвост T-35): инлайн-сторож в index.html по этому маркеру
  // (и видимым гейту/студии) понимает, что бут прошёл, и чистит счётчик
  // перезагрузок + служебный ?_b= в адресе. Без маркера живая страница
  // через 9 с считала бы себя сломанной и перезагрузилась бы.
  document.documentElement.setAttribute('data-booted', '1');
})();
