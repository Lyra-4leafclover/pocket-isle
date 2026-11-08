// Small DOM + date helpers shared everywhere.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs, ...kids) {
  let id = null;
  const hash = tag.indexOf('#');
  if (hash >= 0) { id = tag.slice(hash + 1).split('.')[0]; tag = tag.slice(0, hash) + tag.slice(hash + 1 + id.length); }
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false || k === true) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const plural = (n, w, pl = w + 's') => `${n} ${n === 1 ? w : pl}`;

// ---------- dates (all local time; tasks store 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm') ----------
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const today = () => ymd(new Date());
export function parseD(s) {
  if (!s) return null;
  if (s instanceof Date) return new Date(s);
  const [d, t] = String(s).split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t ? t.split(':').map(Number) : [0, 0];
  return new Date(y, m - 1, day, hh, mm);
}
export const dayOf = (s) => (s ? String(s).slice(0, 10) : null);
export const hasTime = (s) => !!s && String(s).includes('T');
export const timeOf = (s) => (hasTime(s) ? String(s).slice(11, 16) : null);
export const addDays = (d, n) => { const x = parseD(d); x.setDate(x.getDate() + n); return x; };
export const addDaysStr = (s, n) => { const d = addDays(s, n); return hasTime(s) ? `${ymd(d)}T${timeOf(s)}` : ymd(d); };
export function addMonths(d, n) {
  const x = parseD(d); const day = x.getDate();
  x.setDate(1); x.setMonth(x.getMonth() + n);
  x.setDate(Math.min(day, daysInMonth(x.getFullYear(), x.getMonth())));
  return x;
}
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
export const diffDays = (a, b) => Math.round((parseD(dayOf(a)) - parseD(dayOf(b))) / 86400000);
export function startOfWeek(d, weekStart = 1) {
  const x = parseD(d); x.setHours(0, 0, 0, 0);
  const diff = (x.getDay() - weekStart + 7) % 7;
  x.setDate(x.getDate() - diff); return x;
}
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let clock24 = false;
export const setClock24 = (v) => { clock24 = !!v; };
export function fmtTime(t) {
  if (!t) return '';
  const [H, M] = t.split(':').map(Number);
  if (clock24) return `${pad(H)}:${pad(M)}`;
  const ap = H < 12 ? 'am' : 'pm'; const h12 = H % 12 || 12;
  return M ? `${h12}:${pad(M)}${ap}` : `${h12}${ap}`;
}
export function fmtDay(s, { long = false } = {}) {
  if (!s) return '';
  const d = parseD(s); const n = diffDays(ymd(d), today());
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return long ? DOW_LONG[d.getDay()] : DOW[d.getDay()];
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? '' : ', ' + d.getFullYear()}`;
}
export const fmtDate = (s) => (s ? fmtDay(s) + (hasTime(s) ? ' ' + fmtTime(timeOf(s)) : '') : '');
export function fmtDuration(sec) {
  sec = Math.round(sec);
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60);
  if (hh) return `${hh}h ${mm}m`;
  if (mm) return `${mm}m`;
  return `${sec}s`;
}
export const fmtClock = (sec) => { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return `${pad(m)}:${pad(s)}`; };

// ---------- floating UI ----------
let toastTimer;
export function toast(msg, action) {
  let el = $('#toast');
  if (!el) { el = h('div#toast'); el.id = 'toast'; document.body.append(el); }
  el.replaceChildren(h('span', msg), action ? h('button.toast-act', { onclick: () => { action.run(); el.classList.remove('show'); } }, action.label) : null);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action?.ms || (action ? 6000 : 2800));
}

export function closeFloating() { $$('.popover').forEach((p) => p.remove()); }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('.popover') && !e.target.closest('[data-popover-anchor]')) closeFloating(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFloating(); });

// Shows content in a little floating card next to an element (or at a mouse point).
export function popover(anchor, content, { align = 'left', className = '' } = {}) {
  closeFloating();
  const pop = h('div.popover' + (className ? '.' + className : ''), content);
  document.body.append(pop);
  let r;
  if (anchor && anchor.getBoundingClientRect) r = anchor.getBoundingClientRect();
  else r = { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0 };
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = align === 'right' ? r.right - pw : r.left;
  let y = r.bottom + 6;
  if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 6);
  x = clamp(x, 8, innerWidth - pw - 8);
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  return pop;
}

// A context menu: items are {label, icon, run, danger, sub:[...]} or '-' separators.
export function menu(anchor, items, opts) {
  const build = (list) => h('div.menu', list.filter(Boolean).map((it) => {
    if (it === '-') return h('div.menu-sep');
    if (it.header) return h('div.menu-head', it.header);
    if (it.custom) return it.custom;
    return h('button.menu-item' + (it.danger ? '.danger' : '') + (it.active ? '.active' : ''), {
      onclick: (e) => { e.stopPropagation(); if (it.sub) { popover(e.currentTarget, build(it.sub), opts); return; } closeFloating(); it.run?.(); },
    }, it.icon ? h('span.mi', it.icon) : null, h('span.ml', it.label), it.hint ? h('span.mh', it.hint) : null, it.sub ? h('span.mh', '›') : null);
  }));
  return popover(anchor, build(items), opts);
}

export function modal(title, body, { wide = false, onClose, actions, className = '' } = {}) {
  const close = () => { wrap.remove(); onClose?.(); };
  const wrap = h('div.modal-wrap', { onmousedown: (e) => { if (e.target === wrap) close(); } },
    h('div.modal' + (wide ? '.wide' : '') + (className ? '.' + className : ''),
      title != null ? h('div.modal-head', h('h2', title), h('button.icon-btn', { onclick: close, 'aria-label': 'Close' }, '✕')) : null,
      h('div.modal-body', body),
      actions ? h('div.modal-actions', actions) : null));
  const onKey = (e) => { if (e.key === 'Escape' && document.body.contains(wrap)) { e.stopPropagation(); close(); document.removeEventListener('keydown', onKey, true); } };
  document.addEventListener('keydown', onKey, true);
  document.body.append(wrap);
  setTimeout(() => wrap.querySelector('input:not([type=checkbox]),textarea')?.focus(), 30);
  return { close, el: wrap };
}

export function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return new Promise((res) => {
    let done = false;
    const m = modal(title, h('p.muted', text), {
      onClose: () => { if (!done) res(false); },
      actions: [
        h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'),
        h('button.btn' + (danger ? '.danger' : ''), { onclick: () => { done = true; m.close(); res(true); } }, okLabel),
      ],
    });
  });
}

export function promptBox(title, value = '', placeholder = '') {
  return new Promise((res) => {
    let done = false;
    const input = h('input.input', { value, placeholder, onkeydown: (e) => { if (e.key === 'Enter') ok(); } });
    const ok = () => { done = true; m.close(); res(input.value.trim()); };
    const m = modal(title, input, { onClose: () => { if (!done) res(null); }, actions: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), h('button.btn', { onclick: ok }, 'Save')] });
    setTimeout(() => { input.focus(); input.select(); }, 40);
  });
}

// tiny markdown: headings, bold, italic, code, links, lists, checkboxes, quotes
export function md(src) {
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const out = []; let inList = null;
  for (const line of String(src || '').split('\n')) {
    let m;
    const closeList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { closeList(); out.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`); }
    else if ((m = line.match(/^\s*[-*]\s+\[( |x)\]\s+(.*)/i))) { if (inList !== 'ul') { closeList(); out.push('<ul class="md-check">'); inList = 'ul'; } out.push(`<li>${m[1].trim() ? '☑' : '☐'} ${inline(m[2])}</li>`); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^>\s?(.*)/))) { closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
    else if (line.trim() === '---') { closeList(); out.push('<hr>'); }
    else if (!line.trim()) { closeList(); out.push('<br>'); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  if (inList) out.push(`</${inList}>`);
  return out.join('');
}

export function download(name, text, type = 'application/json') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}
export function pickFile(accept) {
  return new Promise((res) => {
    const i = h('input', { type: 'file', accept, onchange: () => res(i.files[0] || null) });
    i.click();
  });
}
export const readText = (f) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsText(f); });
export const readDataUrl = (f) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });

// Let replaceChildren/append accept nested arrays and skip null/false, like h().
for (const m of ['replaceChildren', 'append', 'prepend']) {
  const native = Element.prototype[m];
  Element.prototype[m] = function (...kids) {
    const flat = [];
    (function walk(a) { for (const k of a) { if (k == null || k === false || k === true) continue; if (Array.isArray(k)) walk(k); else flat.push(k); } })(kids);
    return native.apply(this, flat);
  };
}
