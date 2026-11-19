/* Experimental English lyrics diagnostics. Not a singability verdict.
 * Research and limitations: audits/lyrics/RESEARCH_PACK.md. */
(() => {
  'use strict';
  function estimateWord(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    let n = (w.match(/[aeiouy]+/g) || []).length;
    if (n > 1 && /[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w)) n--;
    if (n > 1 && /(?:ed|es)$/.test(w) && !/(?:[td]ed|[szx]es|ches|shes)$/.test(w)) n--;
    return Math.max(1, n);
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
  globalThis.BRIIX_LYRICS_BRAIN = Object.freeze({ analyze, estimateWord });
})();
