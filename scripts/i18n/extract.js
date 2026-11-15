// (fork) Pulls the user-facing English out of the renderer: string literals and template literals (as patterns with {0}, {1}…),
// skipping strings used as code (comparisons, keys, selectors, event names, CSS, log lines). HTML inside strings is split
// into its text pieces. Output: strings.json [{ s, n }] with s the English (template parts as {0}).
'use strict';
const fs = require('fs'), path = require('path');
const acorn = require('acorn'), walk = require('acorn-walk');
// usage (from the repo): npm i --no-save acorn acorn-walk && node scripts/i18n/extract.js
const R = path.resolve(__dirname, '..', '..', 'renderer');
const files = process.argv.length > 2 ? process.argv.slice(2) : ['settings.js', 'app.js', 'setup.js', 'museum.js', 'home.js', 'tour.js', 'index.html', 'home.html', 'find.js', 'systems-extra.js', 'sound.js', 'inspect3d.js', 'songs.js', 'img-tools.js', 'picker.js', 'achgroup.js', 'instrument.js', 'covers.js', 'platform.js', 'perf.js', 'consolefit.js', 'wiiu-manual.js', 'img-tools.html', 'pdf-pages.html'].map(f => path.join(R, f));
const out = new Map();
const add = (s, f) => { s = s.replace(/\s+/g, ' ').trim(); if (!keep(s)) return; const e = out.get(s) || { s, n: 0, f: new Set() }; e.n++; e.f.add(path.basename(f)); out.set(s, e); };
function keep(s) {
  if (s.length < 2 || !/[A-Za-z]{2}/.test(s)) return false;
  if (/^(ui|keys|apps|cfg)\.[\w.{}]*\.?$/.test(s) || /\b(scale[XY]?|translate[XY]?|cubic-bezier|saturate|brightness|rotate|blur)\(/.test(s) || /\w\|\w|\|$|^\w+:\/\//.test(s) || /^(width|height|left|top):/.test(s)) return false;
  const bare = s.replace(/\{\d+\}/g, '').trim(); if (!/[A-Za-z]{2}/.test(bare)) return false;
  if (/^[a-z0-9_.:/-]+$/.test(s)) return false; // ids, keys, classes, paths
  if (/^[A-Z0-9_]+$/.test(s) && s.length > 4) return false; // CONSTANTS
  if (/^[\w-]+(\s+[\w-]+)*$/.test(s) && /^[a-z]/.test(s) && !/\s/.test(s)) return false;
  if (/^(#|\.|@|--)|var\(|rgba?\(|hsla?\(|px\b|\bdeg\b|%,|url\(|^https?:|^data:|^bsfile:|\.(png|jpe?g|svg|webp|js|css|json|exe|html)\b/i.test(s)) return false;
  if (/[{}=<>]|=>|;\S|\b(function|return|const|let)\b/.test(s.replace(/\{\d+\}/g, ''))) return false;
  if (/^[a-z][\w-]*( [a-z][\w-]*)+$/.test(s) && !/\b(the|a|to|of|and|or|is|for|in|on|it|you|your|this|no|not|with)\b/.test(s)) return false; // class lists / keyword lists ("rain snow storm")
  return true;
}
function htmlPieces(s) { // text between tags / entities decoded lightly
  if (!/<[a-z/!]/i.test(s)) return [s];
  return s.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').split(/<[^>]*>/).map(x => x.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&middot;|&#183;/g, '·').replace(/&rarr;/g, '→').replace(/&hellip;/g, '…')).filter(x => x.trim());
}
const CODE_CALLS = /^(querySelector(All)?|getElementById|closest|matches|addEventListener|removeEventListener|setAttribute|getAttribute|removeAttribute|hasAttribute|toggleAttribute|add|remove|toggle|contains|startsWith|endsWith|includes|indexOf|split|join|replace|test|exec|setProperty|getPropertyValue|createElement|log|warn|error|debug|info|call|send|on|once|emit|invoke|handle|get|set|has|delete|postMessage|dispatchEvent|play|sound|rumble|setItem|getItem|removeItem|key|keys|code|is|setMode|route|goSecId|attr|css|cls|open)$/;
const LOGGY = /^(log|warn|error|debug|trace|instrument|perfMark)$/;
function calleeName(c) { if (!c) return ''; if (c.type === 'Identifier') return c.name; if (c.type === 'MemberExpression' && !c.computed && c.property) return c.property.name; return ''; }
function isCodeContext(node, anc) {
  const p = anc[anc.length - 2]; if (!p) return false;
  if ((p.type === 'BinaryExpression' && /^(===|!==|==|!=|in|instanceof)$/.test(p.operator))) return true;
  if (p.type === 'SwitchCase' && p.test === node) return true;
  if (p.type === 'Property' && p.key === node && !p.computed) return true;
  if (p.type === 'Property' && p.value === node && p.key && /^(keys|id|path|ic|g|t|kind|cls|pg|status|ask|type|key|src|href|icon|theme|sys|system|lang|mode|ph_)$/.test(p.key.name || p.key.value || '')) return true;
  if (p.type === 'MemberExpression' && p.property === node) return true;
  if (p.type === 'ImportDeclaration' || p.type === 'ExportNamedDeclaration') return true;
  if (p.type === 'CallExpression' || p.type === 'NewExpression') {
    const n = calleeName(p.callee);
    if (LOGGY.test(n)) return true;
    if (p.callee.type === 'MemberExpression' && p.callee.object && /^(console|api|ipcRenderer|localStorage|sessionStorage|classList|style|dataset|document|window|JSON|Object|RegExp)$/.test(calleeName(p.callee.object) || (p.callee.object.type === 'Identifier' && p.callee.object.name) || '')) {
      if (!/^(toast|note|confirm|alert|prompt|setTitle)$/.test(n)) return true; }
    if (CODE_CALLS.test(n) && p.arguments[0] === node) return true;
    if (n === 'RegExp') return true;
  }
  if (p.type === 'ArrayExpression') { // ["id","Label",...] option pairs: the first entry is an id when lower-case-ish
    const gp = anc[anc.length - 3]; if (p.elements[0] === node && p.elements.length >= 2 && /^[a-z0-9_.:-]*$/.test(node.value || '')) return true; }
  return false;
}
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (/\.html$/.test(f)) { for (const t of htmlPieces(src.replace(/<script[\s\S]*?<\/script>/gi, ''))) add(t, f); // attributes too
    for (const m of src.matchAll(/\b(title|placeholder|aria-label|alt)="([^"]+)"/g)) add(m[2], f); continue; }
  let ast; try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true }); } catch (e) { console.error('parse', f, e.message); continue; }
  walk.ancestor(ast, {
    Literal(node, st, anc) { if (typeof node.value !== 'string' || isCodeContext(node, anc)) return; for (const t of htmlPieces(node.value)) add(t, f); },
    TemplateLiteral(node, st, anc) {
      const p = anc[anc.length - 2]; if (p && p.type === 'TaggedTemplateExpression') return;
      if (isCodeContext(node, anc)) return;
      // the whole template as a pattern: quasis joined with {i}; HTML split, each piece keeps its own placeholders
      let s = ''; node.quasis.forEach((q, i) => { s += q.value.cooked == null ? q.value.raw : q.value.cooked; if (i < node.expressions.length) s += `{${i}}`; });
      for (const t of htmlPieces(s)) add(t, f);
    }
  });
}
const list = [...out.values()].sort((a, b) => b.n - a.n || a.s.localeCompare(b.s)).map(e => ({ s: e.s, n: e.n, f: [...e.f].join(',') }));
// what the French dictionary doesn't have yet (renderer/i18n-fr.js): printed, and written to scripts/i18n/missing-fr.txt
global.window = {}; require(path.resolve(__dirname, '..', '..', 'renderer', 'i18n-fr.js'));
const have = window.BS_I18N_FR || {}, miss = list.filter(e => !(e.s in have));
fs.writeFileSync(path.join(__dirname, 'missing-fr.txt'), miss.map(e => e.s).join('\n') + '\n');
console.log(list.length, 'strings,', miss.length, 'not in i18n-fr.js (some are names or code that need none): scripts/i18n/missing-fr.txt');
