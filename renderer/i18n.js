// (fork) Translations, applied to what's on screen. Boxshelf's text lives in its scripts as plain English, so instead of
// changing every string in the code (and every merge with the upstream project after), the page is translated as it is
// drawn: a MutationObserver puts each piece of text through the dictionary (i18n-<lang>.js, loaded before this), and so do
// the canvas text calls (box spines and the 3D cases' labels). Code that compares strings never sees a translation.
//
// The dictionary: { "English": "Français", "Found {0} game{1}": "{0} jeu{1|x} trouvé{1}" }. {n} stands for a part that
// changes (a number, a name); in the translation {n|text} gives "text" only when that part isn't empty (French plurals
// that aren't just an "s"), {n#text} only when it's a number of 2 or more. Lookups: the exact text; then the patterns; then, for longer text glued together from pieces,
// the longest known whole sentences inside it. ALL-CAPS text is looked up as written and gets its translation in capitals.
// The language: Settings → System → Language (localStorage "bsLang": "auto", "en", "fr"); auto follows the system.
(function () {
  'use strict';
  if (window.BS_I18N) return;
  const DICTS = { fr: window.BS_I18N_FR };
  let want = 'auto'; try { want = localStorage.getItem('bsLang') || 'auto'; } catch {}
  const sys = String((navigator.languages && navigator.languages[0]) || navigator.language || 'en').slice(0, 2).toLowerCase();
  const lang = want === 'auto' ? (DICTS[sys] ? sys : 'en') : (DICTS[want] ? want : 'en');
  const setLang = v => { try { localStorage.setItem('bsLang', v); } catch {} api.want = v; };
  const api = { lang, want, setLang, langs: [['auto', 'Automatic'], ['en', 'English'], ['fr', 'Français']], t: s => s };
  window.BS_I18N = api;
  try { document.documentElement.lang = lang; } catch {}
  const D = lang !== 'en' && DICTS[lang]; if (!D) return;

  // ---------- the dictionary ----------
  const exact = new Map(), upper = new Map(), pats = [];
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [en, tr] of Object.entries(D)) {
    if (!en || typeof tr !== 'string' || !tr) continue;
    if (/\{\d+\}/.test(en)) {
      const parts = en.split(/(\{\d+\})/), order = [], lits = [];
      let re = '^'; for (const p of parts) { const m = /^\{(\d+)\}$/.exec(p); if (m) { order.push(+m[1]); re += '([\\s\\S]*?)'; } else if (p) { re += esc(p); lits.push(p); } }
      const anchor = lits.sort((a, b) => b.length - a.length)[0] || '';
      if (anchor.replace(/\W/g, '').length < 2) continue; // all placeholders: would match anything
      pats.push({ re: new RegExp(re + '$'), order, tr, anchor, len: lits.join('').length });
    } else { exact.set(en, tr); if (/[a-z]/.test(en)) upper.set(en.toUpperCase(), tr.toUpperCase()); }
  }
  pats.sort((a, b) => b.len - a.len);
  // phrases for text glued together from pieces: two words or more, longest first
  // (whole sentences only: swapping short phrases inside English text gives a mix of both languages)
  const phrases = [...exact.keys()].filter(k => k.length >= 16 && k.split(/\s+/).length >= 3 && /[.!?:…)]$/.test(k)).sort((a, b) => b.length - a.length);

  // {n} the part; {n|text} text when the part isn't empty; {n#text} text when the part is a number of 2 or more (a plural)
  const fill = (tr, vals) => tr.replace(/\{(\d+)(?:([|#])([^}]*))?\}/g, (m, i, op, alt) => { const v = vals[+i] == null ? '' : vals[+i];
    if (!op) return v; if (op === '|') return v ? alt : ''; const n = parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(',', '.')); return n >= 2 ? alt : ''; });
  const memo = new Map();
  function lookup(s, deep) {
    if (exact.has(s)) return exact.get(s);
    if (upper.has(s)) return upper.get(s);
    for (const p of pats) {
      if (p.anchor && !s.includes(p.anchor)) continue;
      if (p.len < s.length * .4 && p.len < 24) continue; // a few fixed letters in a long text: "{0} game{1}" mustn't swallow a sentence ending in "game"
      const m = p.re.exec(s); if (!m) continue;
      const vals = []; p.order.forEach((n, k) => { const v = m[k + 1]; vals[n] = deep ? v : (lookup(v, true) || v); });
      return fill(p.tr, vals);
    }
    return null;
  }
  function glued(s) {
    if (s.length < 12) return null;
    let out = s, hit = false;
    for (const k of phrases) { if (out.length < k.length) continue; const i = out.indexOf(k); if (i < 0) continue;
      const before = out[i - 1], after = out[i + k.length];
      if ((before && /\w/.test(before)) || (after && /\w/.test(after))) continue; // whole words only
      out = out.split(k).join(exact.get(k)); hit = true; }
    return hit ? out : null;
  }
  // "Library › Streaming", "Shuffle · Lands on a random game": each piece on its own
  function parts(s) {
    const sep = / (›|·|—|\|) /; if (!sep.test(s)) return null;
    const bits = s.split(/( (?:›|·|—|\|) )/); let hit = false;
    const out = bits.map((b, i) => { if (i % 2) return b; const t = lookup(b.trim(), false); if (t != null) { hit = true; return b.replace(b.trim(), t); } return b; });
    return hit ? out.join('') : null;
  }
  // a piece of text in, its translation out (spaces around it kept); the original when nothing fits
  function tr(raw) {
    if (!raw || raw.length > 4000) return raw;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw), s = m[2];
    if (!s || !/[A-Za-z]/.test(s)) return raw;
    let r = memo.get(s);
    if (r === undefined) { const key = s.replace(/\s+/g, ' '); r = lookup(key, false); if (r == null) r = parts(key); if (r == null) r = glued(key); if (memo.size > 8000) memo.clear(); memo.set(s, r); }
    return r == null ? raw : m[1] + r + m[3];
  }
  api.t = tr;

  // ---------- the page ----------
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'data-tip'];
  const done = new WeakMap(); // text node → the text we wrote (so our own write isn't translated again)
  function skipEl(el) { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { if (SKIP.has(e.tagName) || e.isContentEditable || (e.hasAttribute && e.hasAttribute('data-noi18n'))) return true; } return false; }
  function text(n) {
    const v = n.data; if (done.get(n) === v) return;
    if (!n.parentElement || skipEl(n.parentElement)) return;
    const t = tr(v); if (t !== v) { done.set(n, t); n.data = t; } else done.set(n, v);
  }
  function attrs(el) { for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (!v) continue; const t = tr(v); if (t !== v) el.setAttribute(a, t); } }
  function tree(root) {
    if (root.nodeType === 3) return text(root);
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (SKIP.has(root.tagName)) return; attrs(root); }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) text(n); else if (SKIP.has(n.tagName)) { /* its text is skipped in text() */ } else attrs(n); }
  }
  const mo = new MutationObserver(list => {
    for (const r of list) {
      if (r.type === 'characterData') text(r.target);
      else if (r.type === 'attributes') { const v = r.target.getAttribute(r.attributeName); if (v) { const t = tr(v); if (t !== v) r.target.setAttribute(r.attributeName, t); } }
      else for (const n of r.addedNodes) tree(n);
    }
  });
  const start = () => { tree(document.documentElement); mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  try { if (document.title) document.title = tr(document.title); } catch {}

  // ---------- dates and numbers ----------
  // the code formats dates with the system's language (undefined); in French they follow the chosen language, and the
  // 12-hour clock the code asks for by default becomes the 24-hour one French uses
  try {
    const loc = lang === 'fr' ? 'fr-FR' : lang, fix = (l, o) => [l == null || (Array.isArray(l) && !l.length) ? loc : l, o && o.hour12 === true && lang === 'fr' ? Object.assign({}, o, { hour12: false, hourCycle: 'h23' }) : o];
    for (const fn of ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']) { const orig = Date.prototype[fn]; Date.prototype[fn] = function (l, o) { return orig.apply(this, fix(l, o)); }; }
    const num = Number.prototype.toLocaleString; Number.prototype.toLocaleString = function (l, o) { return num.apply(this, fix(l, o)); };
  } catch {}

  // ---------- canvas text (box spines, the cases' labels, the museum's signs) ----------
  try {
    const C = CanvasRenderingContext2D.prototype;
    for (const fn of ['fillText', 'strokeText', 'measureText']) { const orig = C[fn]; if (typeof orig !== 'function') continue;
      C[fn] = function (s, ...rest) { return orig.call(this, typeof s === 'string' ? tr(s) : s, ...rest); }; }
    if (window.OffscreenCanvasRenderingContext2D) { const O = OffscreenCanvasRenderingContext2D.prototype;
      for (const fn of ['fillText', 'strokeText', 'measureText']) { const orig = O[fn]; if (typeof orig !== 'function') continue; O[fn] = function (s, ...rest) { return orig.call(this, typeof s === 'string' ? tr(s) : s, ...rest); }; } }
  } catch {}
})();
