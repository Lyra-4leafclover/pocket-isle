// Statistics and the Summary page (a write-up of what you got done).
import { h, today, ymd, parseD, addDays, diffDays, fmtDuration, fmtDay, fmtDate, DOW, startOfWeek, download, toast, plural } from '../util.js';
import { all, settings } from '../store.js';
import * as T from '../tasks.js';
import * as G from '../game.js';
import { village } from '../store.js';
import { habits, isDone, dueOn } from './habits.js';
import { openTask, go, ui } from '../ui.js';

const done = () => all('task', (t) => T.isDone(t) && !t.trashedAt && t.completedAt);
const bars = (vals, labels, fmt = (v) => v) => {
  const max = Math.max(1, ...vals);
  return h('div.bars', vals.map((v, i) => h('div.bar', { title: `${labels[i]}: ${fmt(v)}` }, h('i', { style: { height: (v / max) * 100 + '%' } }), h('small', labels[i]))));
};

export function render(main, key) {
  if (key === 'summary') return summary(main);
  const D = done();
  const T0 = today();
  const days = [...Array(14)].map((_, i) => ymd(addDays(T0, i - 13)));
  const byDay = days.map((d) => D.filter((t) => ymd(new Date(t.completedAt)) === d).length);
  const focus = all('focus');
  const fByDay = days.map((d) => focus.filter((f) => ymd(new Date(f.start)) === d).reduce((a, f) => a + f.sec, 0) / 60);
  const withDue = D.filter((t) => t.due);
  const onTime = withDue.filter((t) => ymd(new Date(t.completedAt)) <= T.dueOf(t).slice(0, 10)).length;
  const open = T.live().filter(T.isOpen);
  const created7 = all('task', (t) => t.createdAt >= Date.now() - 7 * 864e5).length;
  const done7 = D.filter((t) => t.completedAt >= Date.now() - 7 * 864e5).length;
  const hours = [...Array(24)].map((_, hr) => D.filter((t) => new Date(t.completedAt).getHours() === hr).length);
  const byList = new Map();
  for (const t of D.filter((t) => t.completedAt >= Date.now() - 30 * 864e5)) { const l = T.listById(t.listId); byList.set(l.id, { l, n: (byList.get(l.id)?.n || 0) + 1 }); }
  const lists = [...byList.values()].sort((a, b) => b.n - a.n);
  const totalList = lists.reduce((a, x) => a + x.n, 0) || 1;
  const hb = habits();
  const hbRate = (() => { let due = 0, ok = 0; for (const x of hb) for (const d of days.slice(-7)) if (dueOn(x, d) && d <= T0) { due++; if (isDone(x, d)) ok++; } return due ? Math.round((ok / due) * 100) : 0; })();
  const V = village();
  let streak = 0; for (let d = T0, i = 0; i < 999; i++, d = ymd(addDays(d, -1))) { if (D.some((t) => ymd(new Date(t.completedAt)) === d)) streak++; else if (d !== T0) break; }

  main.replaceChildren(
    h('div.view-head', h('h1', '📈 Statistics'), h('div.head-actions', h('button.btn.ghost.sm', { onclick: () => go('#/summary') }, '📜 Summary'))),
    h('div.view-body.scroll', { 'data-scroll': 'stats' },
      h('div.stat-row', [
        ['Done today', D.filter((t) => ymd(new Date(t.completedAt)) === T0).length], ['Done this week', done7], ['All finished', D.length], ['Still open', open.length],
        ['On time', withDue.length ? Math.round((onTime / withDue.length) * 100) + '%' : '–'], ['Days in a row', streak], ['Focus today', fmtDuration(fByDay[13] * 60)], ['Habit rate (7d)', hb.length ? hbRate + '%' : '–'],
      ].map(([a, b]) => h('div.stat', h('small', a), h('b', b)))),
      h('div.chart-grid',
        h('div.chart-card', h('b', 'Tasks finished, last 14 days'), bars(byDay, days.map((d) => DOW[parseD(d).getDay()][0]))),
        h('div.chart-card', h('b', 'Focus minutes, last 14 days'), bars(fByDay.map(Math.round), days.map((d) => DOW[parseD(d).getDay()][0]), (v) => v + ' min')),
        h('div.chart-card', h('b', 'When you finish things'), bars(hours, hours.map((_, i) => (i % 6 === 0 ? String(i) : '')), (v) => plural(v, 'task')), h('p.muted.sm', 'By hour of the day (all time).')),
        h('div.chart-card', h('b', 'Where your time went (30 days)'), lists.length ? h('div.split', lists.map(({ l, n }) => h('div.split-row', h('span', l.emoji || '•', ' ', l.name), h('div.split-bar', h('i', { style: { width: (n / totalList) * 100 + '%', background: l.color || 'var(--accent)' } })), h('small', n)))) : h('p.muted.sm', 'Finish some tasks to see this.')),
        h('div.chart-card', h('b', 'Added vs finished (7 days)'), h('div.vs', h('div', h('b', created7), h('small', 'added')), h('div', h('b', done7), h('small', 'finished')))),
        h('div.chart-card', h('b', 'Your island'), h('div.vs', h('div', h('b', V.buildings.length), h('small', 'buildings')), h('div', h('b', Object.keys(V.critters).length), h('small', 'neighbours')), h('div', h('b', hb.length), h('small', 'crops'))),
          h('div.inv-bar.static', Object.keys(G.RES).map((r) => h('span.inv', h('img', { src: G.resImg(r), alt: G.RES[r].name, title: G.RES[r].name }), V.inv[r] || 0)))))));
}

let range = 'week', listFilter = 'all', showOpen = false, custom = { from: null, to: null };
function rangeDates() {
  const T0 = today(), ws = ymd(startOfWeek(T0, settings().weekStart));
  if (range === 'today') return [T0, T0];
  if (range === 'yesterday') { const y = ymd(addDays(T0, -1)); return [y, y]; }
  if (range === 'week') return [ws, ymd(addDays(ws, 6))];
  if (range === 'lastweek') return [ymd(addDays(ws, -7)), ymd(addDays(ws, -1))];
  if (range === 'month') return [T0.slice(0, 8) + '01', T0];
  return [custom.from || ymd(addDays(T0, -30)), custom.to || T0];
}
function summary(main) {
  const [from, to] = rangeDates();
  const inList = (t) => listFilter === 'all' || (t.listId || 'inbox') === listFilter;
  const D = done().filter((t) => { const d = ymd(new Date(t.completedAt)); return d >= from && d <= to && inList(t); }).sort((a, b) => a.completedAt - b.completedAt);
  const O = showOpen ? T.live().filter((t) => T.isOpen(t) && t.due && T.dueOf(t).slice(0, 10) >= from && T.dueOf(t).slice(0, 10) <= to && inList(t)) : [];
  const groups = new Map();
  for (const t of D) { const d = ymd(new Date(t.completedAt)); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(t); }
  const asText = () => {
    let s = `# What I got done: ${fmtDay(from, { long: true })}${from !== to ? ' to ' + fmtDay(to, { long: true }) : ''}\n\n`;
    for (const [d, ts] of groups) { s += `## ${fmtDay(d, { long: true })}\n`; for (const t of ts) s += `- [x] ${t.title}${listFilter === 'all' ? ` (${T.listById(t.listId).name})` : ''}\n`; s += '\n'; }
    if (O.length) { s += '## Not done yet\n'; for (const t of O) s += `- [ ] ${t.title} (due ${fmtDate(t.due)})\n`; }
    return s;
  };
  main.replaceChildren(
    h('div.view-head', h('button.icon-btn.mobile-only', { onclick: () => { ui.sidebarOpen = true; go('#/tasks/today'); } }, '‹'), h('h1', '📜 Summary'), h('div.head-actions',
      h('button.btn.ghost.sm', { onclick: () => navigator.clipboard.writeText(asText()).then(() => toast('Copied!')) }, 'Copy'),
      h('button.btn.ghost.sm', { onclick: () => download(`summary-${from}.md`, asText(), 'text/markdown') }, 'Download'),
      h('button.btn.ghost.sm', { onclick: () => window.print() }, 'Print'))),
    h('div.view-body.scroll',
      h('div.chips.summary-filters',
        [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['custom', 'Custom']].map(([v, n]) => h('button.chip' + (range === v ? '.on' : ''), { onclick: () => { range = v; ui.render(); } }, n)),
        range === 'custom' ? [h('input.input.sm', { type: 'date', value: from, onchange: (e) => { custom.from = e.target.value; ui.render(); } }), h('input.input.sm', { type: 'date', value: to, onchange: (e) => { custom.to = e.target.value; ui.render(); } })] : null,
        h('select.input.sm', { onchange: (e) => { listFilter = e.target.value; ui.render(); } }, h('option', { value: 'all' }, 'All lists'), [T.INBOX, ...T.lists()].map((l) => h('option', { value: l.id, selected: listFilter === l.id }, l.name))),
        h('label.chip', h('input', { type: 'checkbox', checked: showOpen, onchange: (e) => { showOpen = e.target.checked; ui.render(); } }), ' include unfinished')),
      h('div.summary-paper',
        h('h2', `${plural(D.length, 'task')} finished`), h('p.muted', fmtDay(from, { long: true }), from !== to ? ' → ' + fmtDay(to, { long: true }) : ''),
        !D.length ? h('p.muted', 'Nothing finished in this range yet.') : null,
        [...groups].map(([d, ts]) => h('div.sum-day', h('h3', fmtDay(d, { long: true })), ts.map((t) => h('div.sum-row', { onclick: () => openTask(t.id) }, h('span.chk.on', '✓'), h('span', t.title), h('small.muted', T.listById(t.listId).name, ' · ', new Date(t.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })))))),
        O.length ? h('div.sum-day', h('h3', 'Not done yet'), O.map((t) => h('div.sum-row', { onclick: () => openTask(t.id) }, h('span.chk', ''), h('span', t.title), h('small.muted', 'due ' + fmtDate(t.due))))) : null)));
}
