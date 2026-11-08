// Boot, login screen, layout, router, shortcuts, search palette and reminders.
import { h, $, $$, toast, modal, menu, closeFloating, today, ymd, fmtDate, debounce, setClock24 } from './util.js';
import * as store from './store.js';
import { get, all, settings, saveSettings, subscribe, emit } from './store.js';
import * as T from './tasks.js';
import * as G from './game.js';
import { ui, go, openTask, closeTask } from './ui.js';
import { renderSidebar } from './views/sidebar.js';
import * as TasksView from './views/tasks.js';
import * as Detail from './views/detail.js';
import * as Calendar from './views/calendar.js';
import * as Matrix from './views/matrix.js';
import * as Focus from './views/focus.js';
import * as Habits from './views/habits.js';
import * as Countdown from './views/countdown.js';
import * as Stats from './views/stats.js';
import * as Island from './views/island.js';
import * as Settings from './views/settings.js';

const NAV = [
  ['tasks', '✔', 'Tasks', '#/tasks/today'],
  ['calendar', '📅', 'Calendar', '#/calendar'],
  ['matrix', '▦', 'Matrix', '#/matrix'],
  ['focus', '⏱', 'Focus', '#/focus'],
  ['habits', '🌱', 'Habits', '#/habits'],
  ['countdown', '⏳', 'Countdown', '#/countdown'],
  ['island', '🏝', 'Island', '#/island'],
  ['stats', '📈', 'Stats', '#/stats'],
];

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const view = parts[0] || 'tasks';
  if (view === 'task' && parts[1]) { const t = get(parts[1]); ui.taskId = t ? t.id : null; document.body.classList.toggle('detail-open', !!t); const key = t ? (t.listId && t.listId !== 'inbox' ? 'list:' + t.listId : 'inbox') : 'today'; history.replaceState(null, '', '#/tasks/' + encodeURIComponent(key)); return { view: 'tasks', key }; }
  if (view === 'gift') {
    const n = Math.min(Math.max(parseInt(parts[1], 10) || 1000, 1), 100000);
    const v = store.village();
    v.inv ||= {};
    for (const r of Object.keys(G.RES)) v.inv[r] = (v.inv[r] || 0) + n;
    store.saveVillage();
    history.replaceState(null, '', '#/island');
    setTimeout(() => toast(`🎁 +${n} of every material`), 300);
    return { view: 'island', key: '' };
  }
  if (view === 'summary') return { view: 'stats', key: 'summary' };
  return { view, key: parts.slice(1).join('/') || (view === 'tasks' ? 'today' : '') };
}

// ---------- rendering that keeps focus, typed text and scroll positions ----------
function snapshot() {
  const a = document.activeElement;
  const keep = {};
  $$('[data-keep]').forEach((el) => { keep[el.dataset.keep] = el.value; });
  const scroll = {};
  $$('[data-scroll]').forEach((el) => { scroll[el.dataset.scroll] = el.scrollTop; });
  return { focus: a?.dataset?.keep, sel: a && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null, keep, scroll };
}
function restore(s) {
  $$('[data-scroll]').forEach((el) => { if (s.scroll[el.dataset.scroll] != null) el.scrollTop = s.scroll[el.dataset.scroll]; });
  if (s.focus) {
    const el = $(`[data-keep="${CSS.escape(s.focus)}"]`);
    if (el && document.activeElement !== el) { el.focus({ preventScroll: true }); try { if (s.sel) el.setSelectionRange(...s.sel); } catch {} }
  }
}

let shell = null;
function buildShell() {
  shell = {
    rail: h('nav.rail'), sidebar: h('aside.sidebar'), main: h('main.main'), detail: h('section.detail#detail'),
    scrim: h('div.scrim', { onclick: () => { ui.sidebarOpen = false; render(); } }),
  };
  $('#root').replaceChildren(h('div.app', shell.rail, shell.sidebar, shell.scrim, shell.main, shell.detail), h('nav.tabbar'));
}

export function render() {
  if (!shell) return;
  const s = snapshot();
  const r = (ui.route = parseRoute());
  applyTheme();
  document.body.dataset.view = r.view;
  document.body.classList.toggle('sidebar-open', ui.sidebarOpen);
  document.body.classList.toggle('has-sidebar', r.view === 'tasks');
  document.body.classList.toggle('detail-open', !!(ui.taskId && get(ui.taskId)));
  renderRail();
  if (r.view === 'tasks') renderSidebar(shell.sidebar, r.key); else shell.sidebar.replaceChildren();
  try {
    const V = { tasks: TasksView, calendar: Calendar, matrix: Matrix, focus: Focus, habits: Habits, countdown: Countdown, island: Island, stats: Stats, settings: Settings, search: null }[r.view];
    if (r.view === 'search') renderSearch(shell.main, r.key);
    else if (V) V.render(shell.main, r.key);
    else go('#/tasks/today');
  } catch (e) { console.error(e); shell.main.replaceChildren(h('div.empty', h('h3', 'Something went wrong drawing this page'), h('pre.muted', String(e.stack || e)))); }
  if (ui.taskId && !get(ui.taskId)) ui.taskId = null;
  Detail.render(shell.detail);
  restore(s);
}
ui.render = render;

function renderRail() {
  const r = ui.route;
  const u = store.store.user;
  const syncDot = !u ? 'guest' : !store.store.online ? 'offline' : store.store.syncError ? 'error' : store.store.syncing || store.store.dirty.size ? 'syncing' : 'ok';
  const syncText = { guest: 'Saved on this device only', offline: 'Offline. Changes save and sync later.', error: 'Sync problem: ' + store.store.syncError, syncing: 'Syncing…', ok: 'All synced' }[syncDot];
  shell.rail.replaceChildren(
    h('a.rail-logo', { href: '#/island', title: 'Your island' }, h('img', { src: 'assets/b_cottage.webp', alt: 'Pocket Isle' })),
    NAV.map(([v, icon, name, href]) => h('a.rail-item' + (r.view === v ? '.on' : ''), { href, title: name }, h('span.ri', icon), h('span.rl', name))),
    h('span.spacer'),
    h('button.rail-item', { title: 'Search (Ctrl K)', onclick: openPalette }, h('span.ri', '🔍'), h('span.rl', 'Search')),
    h('a.rail-item' + (r.view === 'settings' ? '.on' : ''), { href: '#/settings', title: 'Settings' }, h('span.ri', '⚙'), h('span.rl', 'Settings')),
    h('button.rail-me', { title: syncText, onclick: (e) => accountMenu(e.currentTarget) }, h('span.avatar-sm', (u?.name || 'G')[0].toUpperCase()), h('span.sync-dot.' + syncDot)));
  $('.tabbar').replaceChildren(
    [NAV[0], NAV[1], NAV[6], NAV[3]].map(([v, icon, name, href]) => h('a.tab' + (r.view === v ? '.on' : ''), { href }, h('span', icon), h('small', name))),
    h('button.tab' + (['matrix', 'habits', 'countdown', 'stats', 'settings'].includes(r.view) ? '.on' : ''), { onclick: (e) => menu(e.currentTarget, [
      ...[NAV[2], NAV[4], NAV[5], NAV[7]].map(([, icon, name, href]) => ({ icon, label: name, run: () => go(href) })),
      { icon: '🔍', label: 'Search', run: openPalette }, { icon: '⚙', label: 'Settings', run: () => go('#/settings') }], { align: 'right' }) }, h('span', '⋯'), h('small', 'More')));
}

function accountMenu(anchor) {
  const u = store.store.user;
  menu(anchor, [
    { header: u ? `${u.name} · ${u.email}` : 'Guest (saved on this device)' },
    u ? { icon: '🔄', label: 'Sync now', run: () => store.push().then(store.pull).then(() => toast('Synced')) } : { icon: '🔑', label: 'Log in or sign up to sync', run: () => { store.setGuestMode(false); showAuth(); } },
    { icon: '⚙', label: 'Settings', run: () => go('#/settings') },
    { icon: '⌨', label: 'Keyboard shortcuts', run: shortcutsHelp },
    u ? { icon: '🚪', label: 'Log out', run: async () => { await store.logout(); shell = null; showAuth(); } } : null,
  ], { align: 'left' });
}

function applyTheme() {
  const s = settings();
  const dark = s.autoDark && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'night' : s.theme;
  document.documentElement.dataset.font = s.fontSize;
  setClock24(s.clock24);
  $('meta[name=theme-color]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#f6efe2');
}

// ---------- search palette ----------
function openPalette() {
  const input = h('input.input.palette-input', { placeholder: 'Search tasks, lists, tags, habits… or type a command', autofocus: true });
  const results = h('div.palette-results');
  let items = [], idx = 0;
  const cmds = [
    ['New list', () => import('./views/sidebar.js').then((m) => m.listEditor(null))], ['New filter', () => import('./views/sidebar.js').then((m) => m.filterEditor(null))],
    ['Start focus', () => go('#/focus')], ['Visit island', () => go('#/island')], ['Settings', () => go('#/settings')], ['Calendar', () => go('#/calendar')],
    ['Habits', () => go('#/habits')], ['Summary', () => go('#/summary')], ['Toggle dark mode', () => saveSettings({ theme: settings().theme === 'night' ? 'cream' : 'night' })],
  ];
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    items = [];
    if (q) {
      for (const t of T.live().filter((t) => T.matchText(t, q)).slice(0, 12)) items.push({ icon: T.isOpen(t) ? '○' : '✓', label: t.title, hint: T.listById(t.listId).name + (t.due ? ' · ' + fmtDate(t.due) : ''), run: () => openTask(t.id) });
      for (const l of [T.INBOX, ...T.lists(), ...T.lists({ archived: true })].filter((l) => l.name.toLowerCase().includes(q))) items.push({ icon: l.emoji || '📂', label: l.name, hint: 'List', run: () => go('#/tasks/' + (l.id === 'inbox' ? 'inbox' : 'list:' + l.id)) });
      for (const g of T.tags().filter((g) => g.name.toLowerCase().includes(q.replace(/^#/, '')))) items.push({ icon: '#', label: g.name, hint: 'Tag', run: () => go('#/tasks/tag:' + g.name) });
      for (const hb of all('habit', (x) => x.name.toLowerCase().includes(q))) items.push({ icon: hb.emoji || '🌱', label: hb.name, hint: 'Habit', run: () => go('#/habits/' + hb.id) });
      for (const [n, run] of cmds.filter(([n]) => n.toLowerCase().includes(q))) items.push({ icon: '›', label: n, hint: 'Command', run });
      items.push({ icon: '🔍', label: `See all results for "${input.value.trim()}"`, run: () => go('#/search/' + encodeURIComponent(input.value.trim())) });
    } else for (const [n, run] of cmds) items.push({ icon: '›', label: n, hint: 'Command', run });
    idx = Math.min(idx, items.length - 1);
    results.replaceChildren(...items.map((it, i) => h('button.pal-item' + (i === idx ? '.on' : ''), { onclick: () => { m.close(); it.run(); } }, h('span.mi', it.icon), h('span.ml', it.label), it.hint ? h('span.mh', it.hint) : null)));
  };
  input.addEventListener('input', () => { idx = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && items[idx]) { m.close(); items[idx].run(); }
  });
  const m = modal(null, h('div.palette', input, results), { className: 'palette-modal' });
  draw(); setTimeout(() => input.focus(), 30);
}

function renderSearch(main, q) {
  const tasks = T.live().filter((t) => T.matchText(t, q));
  const all2 = all('task', (t) => !!t.trashedAt && T.matchText(t, q));
  main.replaceChildren(
    h('div.view-head', h('button.icon-btn.mobile-only', { onclick: () => history.back() }, '‹'), h('h1', '🔍 ', q ? `"${q}"` : 'Search'), h('span.count', tasks.length)),
    h('div.view-body.scroll', h('input.input.search-box', { value: q, placeholder: 'Search titles, notes, checklists, tags and comments', 'data-keep': 'searchpage', onkeydown: (e) => { if (e.key === 'Enter') go('#/search/' + encodeURIComponent(e.target.value.trim())); } }),
      h('div.groups', [['Unfinished', tasks.filter(T.isOpen)], ['Finished', tasks.filter((t) => !T.isOpen(t))], ['In trash', all2]].filter(([, l]) => l.length).map(([n, l]) =>
        h('div.group', h('div.group-head', h('b', n), h('span.muted', l.length)), h('div.rows', l.map((t) => rowFor(t)))))),
      !tasks.length && q ? h('div.empty', h('img', { src: 'assets/c_owl.webp', alt: '' }), h('p', 'Nothing found. Professor Hoot looked everywhere.')) : null));
}
let rowFor = (t) => h('div');
import('./widgets.js').then((w) => { rowFor = (t) => w.taskRow(t, { showList: true, draggable: false }); });

// ---------- keyboard ----------
function shortcutsHelp() {
  const rows = [['N or +', 'Add a task'], ['Ctrl/⌘ K or /', 'Search and commands'], ['Esc', 'Close panel / menu'], ['G then T', 'Today'], ['G then C', 'Calendar'], ['G then I', 'Island'], ['G then F', 'Focus'], ['G then H', 'Habits'], ['G then M', 'Matrix'], ['G then S', 'Settings'],
    ['Ctrl/⌘ Enter', 'Complete open task'], ['Delete', 'Trash selected tasks'], ['Shift/Ctrl click', 'Select many tasks'], ['1 2 3 0', 'Set priority on open task'], ['?', 'This list']];
  modal('Keyboard shortcuts', h('table.shortcuts', rows.map(([k, v]) => h('tr', h('td', h('kbd', k)), h('td', v)))));
}
let gPressed = 0;
function onKey(e) {
  const typing = e.target.closest('input,textarea,select,[contenteditable]');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && ui.taskId) { const t = get(ui.taskId); if (t) T.isOpen(t) ? T.complete(t) : T.uncomplete(t); return; }
  if (e.key === 'Escape') { if ($('.popover, .modal-wrap')) return; if (ui.selected.size) { ui.selected.clear(); render(); } else if (ui.taskId) closeTask(); else if (ui.sidebarOpen) { ui.sidebarOpen = false; render(); } return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || $('.modal-wrap')) return;
  if (Date.now() - gPressed < 900) {
    const to = { t: '#/tasks/today', c: '#/calendar', i: '#/island', f: '#/focus', h: '#/habits', m: '#/matrix', s: '#/settings', x: '#/stats', d: '#/countdown', b: '#/tasks/inbox' }[e.key.toLowerCase()];
    gPressed = 0; if (to) { e.preventDefault(); go(to); } return;
  }
  if (e.key === 'g') { gPressed = Date.now(); return; }
  if (e.key === 'n' || e.key === '+') { const q = $('.qa-input'); if (q) { e.preventDefault(); q.focus(); } else { e.preventDefault(); go('#/tasks/' + (ui.route.view === 'tasks' ? ui.route.key : 'today')); setTimeout(() => $('.qa-input')?.focus(), 60); } return; }
  if (e.key === '/') { e.preventDefault(); openPalette(); return; }
  if (e.key === '?') { shortcutsHelp(); return; }
  if (ui.taskId && ['0', '1', '2', '3'].includes(e.key)) { store.patch(ui.taskId, { priority: [0, 1, 3, 5][Number(e.key)] }); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selected.size) { const s = [...ui.selected].map(get).filter(Boolean); s.forEach((t) => T.trash(t)); ui.selected.clear(); toast(`${s.length} moved to Trash`, { label: 'Undo', run: () => s.forEach((t) => T.restore(t)) }); }
}

// ---------- reminders ----------
const firedKey = () => 'cloverhaven.fired.' + store.me();
function checkReminders() {
  const fired = new Set(JSON.parse(localStorage.getItem(firedKey()) || '[]'));
  const now = Date.now();
  let changed = false;
  const fire = (key, title, body, hash) => {
    if (fired.has(key)) return;
    fired.add(key); changed = true;
    const s = settings();
    toast(`⏰ ${title}${body ? ' · ' + body : ''}`, { label: 'Open', run: () => go(hash), ms: 12000 });
    if (s.sound) chime();
    if (s.notifications && 'Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker?.ready.then((reg) => reg.showNotification(title, { body, icon: 'assets/icon-192.png', data: { hash }, tag: key })).catch(() => new Notification(title, { body, icon: 'assets/icon-192.png' }));
    }
  };
  for (const t of T.live().filter(T.isOpen)) {
    for (const r of t.reminders || []) {
      const at = T.reminderTime(t.due, r)?.getTime();
      if (at && at <= now && now - at < 6 * 3600e3) fire(`${t.id}|${t.due}|${r}`, t.title, t.due ? fmtDate(t.due) : '', '#/task/' + t.id);
    }
  }
  for (const hb of all('habit', (x) => !x.archived && x.reminders?.length)) {
    for (const at of hb.reminders) {
      const [H, M] = at.split(':').map(Number); const d = new Date(); d.setHours(H, M, 0, 0);
      if (d.getTime() <= now && now - d.getTime() < 3 * 3600e3 && Habits.dueToday?.(hb) && !Habits.doneToday?.(hb)) fire(`h|${hb.id}|${today()}|${at}`, `${hb.emoji || '🌱'} ${hb.name}`, 'Time to tend this habit', '#/habits');
    }
  }
  const s = settings();
  for (const [kind, at, title] of [['plan', s.planReminder, 'Plan your day'], ['review', s.reviewReminder, 'Review your day']]) {
    if (!at) continue;
    const [H, M] = at.split(':').map(Number); const d = new Date(); d.setHours(H, M, 0, 0);
    if (d.getTime() <= now && now - d.getTime() < 3 * 3600e3) fire(`${kind}|${today()}`, title, kind === 'plan' ? `${T.queryFor('today').filter(T.isOpen).length} tasks today` : `${T.queryFor('completed').filter((t) => ymd(new Date(t.completedAt)) === today()).length} done today`, kind === 'plan' ? '#/tasks/today' : '#/summary');
  }
  if (changed) localStorage.setItem(firedKey(), JSON.stringify([...fired].slice(-800)));
}
let actx;
export function chime(kind = 'ding') {
  try {
    actx ||= new AudioContext();
    const notes = kind === 'done' ? [784, 1046] : kind === 'end' ? [659, 784, 988] : [880, 1318];
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t0 = actx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + 1);
    });
  } catch {}
}

// ---------- login / signup ----------
function showAuth(mode = 'login') {
  shell = null;
  document.documentElement.dataset.theme = 'cream';
  const err = h('p.auth-err');
  const name = h('input.input', { placeholder: 'Your name', autocomplete: 'name' });
  const email = h('input.input', { type: 'email', placeholder: 'Email', autocomplete: 'email', required: true });
  const pw = h('input.input', { type: 'password', placeholder: mode === 'signup' ? 'Password (8+ characters)' : 'Password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', required: true });
  const btn = h('button.btn.big', { type: 'submit' }, mode === 'signup' ? 'Create my island' : 'Log in');
  const form = h('form.auth-form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try {
      await store.login(email.value.trim(), pw.value, mode === 'signup', name.value.trim());
      store.setGuestMode(false);
      startApp();
    } catch (x) { err.textContent = x.message || 'Could not reach the island. Check your internet.'; btn.disabled = false; }
  } }, mode === 'signup' ? name : null, email, pw, err, btn);
  $('#root').replaceChildren(h('div.auth',
    h('div.auth-art', h('img', { src: 'assets/island.webp', alt: '' }),
      h('img.auth-b1', { src: 'assets/b_cottage.webp', alt: '' }), h('img.auth-b2', { src: 'assets/b_windmill.webp', alt: '' }), h('img.auth-b3', { src: 'assets/b_lighthouse.webp', alt: '' }),
      h('img.auth-c1', { src: 'assets/c_fox.webp', alt: '' }), h('img.auth-c2', { src: 'assets/c_duck.webp', alt: '' })),
    h('div.auth-card',
      h('h1.brand', 'Pocket Isle'),
      h('p.tagline', 'A planner where every task you finish builds your own little island village.'),
      h('div.seg.auth-tabs', h('button' + (mode === 'login' ? '.on' : ''), { onclick: () => showAuth('login') }, 'Log in'), h('button' + (mode === 'signup' ? '.on' : ''), { onclick: () => showAuth('signup') }, 'Sign up')),
      form,
      h('div.or', h('span', 'or')),
      h('button.btn.ghost.big', { onclick: () => { store.setGuestMode(true); startApp(); } }, 'Try it without an account'),
      h('p.muted.sm', 'Without an account, everything saves on this device only. Sign up later and it all comes with you.'))));
  setTimeout(() => (mode === 'signup' ? name : email).focus(), 50);
}

let started = false;
function startApp() {
  buildShell();
  if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/tasks/today');
  if (!started) {
    started = true;
    subscribe(debounce(render, 16));
    addEventListener('hashchange', () => { closeFloating(); ui.sidebarOpen = false; ui.selected.clear(); if (!location.hash.startsWith('#/task/')) {} render(); });
    addEventListener('keydown', onKey);
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', render);
    store.startSyncLoop();
    setInterval(checkReminders, 20000);
    setInterval(() => { if (ui.route.view === 'island' || ui.route.view === 'focus') return; G.weeds(); }, 60000);
    let lastDay = today();
    setInterval(() => { if (today() !== lastDay) { lastDay = today(); render(); } }, 60000);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  G.noteInbox();
  render();
  setTimeout(checkReminders, 1500);
  const s = settings();
  if (!s.welcomed) { saveSettings({ welcomed: true }); setTimeout(welcome, 400); }
}

function welcome() {
  const m = modal('Welcome to Pocket Isle 🏝', h('div.welcome',
    h('img.welcome-art', { src: 'assets/c_fox.webp', alt: '' }),
    h('p', "Hi! I'm Fern the Fox. This is a full planner, plus a little island that grows from what you do. No points, no levels:"),
    h('ul',
      h('li', h('b', 'Finish tasks'), ' to gather materials. Each list grows a different one (wood, stone, petals, fish, clay, wool).'),
      h('li', h('b', 'Build'), ' cottages, a bakery, a lighthouse and more on your island. Each building does something.'),
      h('li', h('b', 'Habits'), ' are crops in your garden. They grow as you keep them, and never die.'),
      h('li', h('b', 'Focus sessions'), ' bring rain and wash up sea glass.'),
      h('li', h('b', 'Overdue tasks'), ' become weeds. Finish them to clear the weeds. No punishment.'),
      h('li', h('b', 'Neighbours'), ' move in secretly when you do certain things. Can you find all 14?')),
    h('p.muted', 'Try typing "Read chapter 3 tomorrow 7pm #study !high" in the add box.')),
  { actions: [h('button.btn', { onclick: () => m.close() }, "Let's go")] });
}

(async function main() {
  await store.boot();
  if (store.store.user || store.guestMode()) startApp();
  else showAuth(location.hash === '#signup' ? 'signup' : 'login');
})();
