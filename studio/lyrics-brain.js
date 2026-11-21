/* Experimental English lyrics diagnostics + singability mechanics (#48).
 * Research and limitations: audits/lyrics/RESEARCH_PACK.md (слоги помогают
 * сравнивать ПАРНЫЕ фразы при повторе мелодии — но это не вердикт о певучести;
 * никаких автоисправлений и критериев отказа). Механики мелодичности:
 * audits/task-48-lyrics-melodics.md, находка «Тысячи окон»
 * (audits/prompt-mechanics-findings.md: RU + fast = предсказуемый десинк —
 * мозг обязан предупредить, а не выдавать результат молча).
 * Запрет находки №11 соблюдён: никаких гендер/регистр-инструкций —
 * модуль анализирует текст, ничего не дописывая в лирику. */
(() => {
  'use strict';
  const VERSION = '2026-11-23-lyrics-1';

  function estimateWord(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    let n = (w.match(/[aeiouy]+/g) || []).length;
    if (n > 1 && /[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w)) n--;
    if (n > 1 && /(?:ed|es)$/.test(w) && !/(?:[td]ed|[szx]es|ches|shes)$/.test(w)) n--;
    return Math.max(1, n);
  }

  /* Русский слог = гласная (а е ё и о у ы э ю я) — лингвистически точное
   * правило для кириллицы. Латинские слова внутри русской строки идут через
   * английский оценщик; цифры слогов не дают ни в одном режиме. */
  function countRuSyllables(line) {
    const s = String(line || '').toLowerCase();
    const ru = (s.match(/[аеёиоуыэюя]/g) || []).length;
    let en = 0;
    for (const w of (s.match(/[a-z]+(?:'[a-z]+)*/g) || [])) en += estimateWord(w);
    const total = ru + en;
    return total || (s.trim() ? 1 : 0);
  }

  function countEnSyllables(line) {
    const words = String(line || '').match(/[a-z]+(?:'[a-z]+)*/gi) || [];
    if (!words.length) return 0;
    return words.reduce((n, w) => n + estimateWord(w), 0);
  }

  /* Тег-строка секции: '[Base]', '[Base 2]', '[Final Chorus]', '[Base: fx]'.
   * Незнакомая скобка ('[voice raw and visceral]' — ремарка вокала) — не
   * секция и не строка: пропускается молча. */
  const TAG_LINE_RE = /^\[([^\]\n]{1,80})\]$/;
  const CANON = {
    intro: 'Intro', verse: 'Verse', 'pre-chorus': 'Pre-Chorus', prechorus: 'Pre-Chorus',
    'pre chorus': 'Pre-Chorus', chorus: 'Chorus', hook: 'Hook', bridge: 'Bridge',
    outro: 'Outro', interlude: 'Interlude', instrumental: 'Instrumental',
    drop: 'Drop', breakdown: 'Breakdown', solo: 'Solo'
  };
  function parseTag(line) {
    const m = String(line || '').trim().match(TAG_LINE_RE);
    if (!m) return null;
    let base = m[1].split(':')[0].trim();
    let final = false;
    const fm = base.match(/^(?:final|last)\s+(.+)$/i);
    if (fm) { final = true; base = fm[1]; }
    const nm = base.match(/^(.+?)\s+\d{1,2}$/);
    if (nm) base = nm[1];
    const canon = CANON[base.toLowerCase()];
    return canon ? { canon, final } : null;
  }

  /* Профиль лирики: секции → строки → слоги (счётчик ru|en). Текст до первого
   * тега живёт в безымянной секции (в сравнениях парных секций не участвует,
   * но в десинк-гарду попадает). */
  function syllableProfile(lyrics) {
    const sections = [];
    let cur = null;
    for (const raw of String(lyrics || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (TAG_LINE_RE.test(line)) {
        const tag = parseTag(line);
        if (tag) { cur = { tag: tag.canon, final: tag.final, lines: [] }; sections.push(cur); }
        continue; // незнакомая скобка — ремарка вокала, не текст
      }
      const hasRu = /[\u0400-\u04FF]/.test(line);
      if (!cur) { cur = { tag: '', final: false, lines: [] }; sections.push(cur); }
      cur.lines.push({
        text: line,
        syllables: hasRu ? countRuSyllables(line) : countEnSyllables(line),
        counter: hasRu ? 'ru' : 'en'
      });
    }
    return sections;
  }

  /* Пороги (консервативные — RESEARCH_PACK: без мелодии нельзя утверждать
   * певучесть, ловим только грубые расхождения парных фраз). */
  const DESYNC_BPM = 150;          // «Тысячи окон»: RU + fast (≥~150 BPM) = десинк
  const VERSE_SYLLABLE_DELTA = 4;  // дельта слогов парных строк куплета = «грубо»

  /* Мягкие проверки мелодичности/консистентности. Возвращает ПРЕДУПРЕЖДЕНИЯ
   * для честной карточки — лирика не меняется, генерация не блокируется. */
  function singability(lyrics, options = {}) {
    const sections = syllableProfile(lyrics);
    const warnings = [];
    const sung = sections.filter(s => s.lines.length);
    const anyRu = sung.some(s => s.lines.some(l => l.counter === 'ru'));
    const bpm = Number(options.bpm) || 0;
    // (1) Десинк-гарда (продуктовое следствие находки «Тысячи окон»):
    // русский текст + быстрый темп — предупреждаем ДО генерации, не молчим.
    if (anyRu && bpm >= DESYNC_BPM) {
      warnings.push('Русская лирика на ' + bpm + ' BPM почти наверняка разъедется с сеткой такта — '
        + 'русский текст на быстрых темпах десинхронизирует вокальный кодек модели (находка «Тысячи окон»). '
        + 'Надёжнее английская лирика или темп до ~120 BPM; иначе десинк принимается осознанно.');
    }
    // (2) Повторяемость припевов: дословный повтор всех не-финальных
    // [Chorus]/[Hook] делает хук устойчивее (модель ровнее держит мелодию,
    // когда текст совпадает слово в слово). Финальный припев (lift) — исключение.
    const regular = sung.filter(s => !s.final && (s.tag === 'Chorus' || s.tag === 'Hook'));
    if (regular.length >= 2) {
      const text = s => s.lines.map(l => l.text).join('\n');
      const first = text(regular[0]);
      if (regular.some(s => text(s) !== first)) {
        warnings.push('Припевы различаются: дословный повтор всех [Chorus] делает хук устойчивее — '
          + 'модель ровнее держит мелодию припева, когда текст совпадает слово в слово '
          + '(различие только финального припева с усилением — нормальный приём).');
      }
    }
    // (3)(4) Парность куплетов: первая пара [Verse] по порядку. Число строк
    // и слоговая длина парных строк — мелодия куплета повторяется, фразы
    // должны совпадать по форме (мягко: только грубые расхождения).
    const verses = sung.filter(s => s.tag === 'Verse');
    if (verses.length >= 2) {
      const v1 = verses[0], v2 = verses[1];
      if (v1.lines.length !== v2.lines.length) {
        warnings.push('Куплет 2 — ' + v2.lines.length + ' ' + ruPlural(v2.lines.length)
          + ' против ' + v1.lines.length + ' у куплета 1: парные куплеты на одной мелодии '
          + 'звучат ровнее при одинаковом числе строк.');
      }
      const pairs = Math.min(v1.lines.length, v2.lines.length);
      for (let i = 0; i < pairs; i++) {
        const a = v1.lines[i].syllables, b = v2.lines[i].syllables;
        if (Math.abs(a - b) >= VERSE_SYLLABLE_DELTA) {
          warnings.push('Куплет 2, строка ' + (i + 1) + ': ' + b + ' ' + ruSyllablePlural(b) + ' против ' + a
            + ' у парной строки куплета 1 — на повторяющейся мелодии длинная строка спешит, '
            + 'короткая тянет паузу.');
          break;
        }
      }
    }
    return {
      warnings, sections, bpm: bpm || null,
      message: 'RU — точный счёт слогов по гласным, EN — оценка по написанию (не вердикт '
        + 'о певучести); проверяются только парные секции и темп.'
    };
  }

  function ruPlural(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'строка';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'строки';
    return 'строк';
  }

  function ruSyllablePlural(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'слог';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'слога';
    return 'слогов';
  }

  function analyze(lyrics) {
    const text = String(lyrics || '');
    // Do not apply an English spelling heuristic to other scripts, digits,
    // or mixed-language lyrics. Explicitly report that they were not analyzed.
    if (/[^\x00-\x7f]/.test(text) || /\d/.test(text)) {
      return { status: 'unsupported', sections: [], message: 'Only plain English text without numbers is supported by this experimental estimate.' };
    }
    const sections = [];
    let current = { tag: '', lines: [] };
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (/^\[[^\]]+\]$/.test(line)) {
        if (current.tag || current.lines.length) sections.push(current);
        current = { tag: line.slice(1, -1), lines: [] };
      } else {
        const words = line.match(/[a-z]+(?:'[a-z]+)*/gi) || [];
        if (words.length) current.lines.push({ text: line, estimatedSyllables: words.reduce((n, w) => n + estimateWord(w), 0) });
      }
    }
    if (current.tag || current.lines.length) sections.push(current);
    return { status: 'estimated', sections, message: 'Spelling-based estimates only; pronunciation and melody may differ.' };
  }

  globalThis.BRIIX_LYRICS_BRAIN = Object.freeze({
    VERSION, analyze, estimateWord,
    countRuSyllables, countEnSyllables, syllableProfile, singability,
    rules: { DESYNC_BPM, VERSE_SYLLABLE_DELTA, CANON }
  });
})();
