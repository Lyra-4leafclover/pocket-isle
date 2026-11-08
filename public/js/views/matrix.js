// Eisenhower matrix: four boxes sorted by priority and date. Drag between boxes to re-prioritise.
import { h, today, ymd, addDays, dayOf, menu, modal } from '../util.js';
import { get, patch, settings, saveSettings } from '../store.js';
import * as T from '../tasks.js';
import { taskRow, emptyState } from '../widgets.js';
import { quickAdd } from './tasks.js';
import { ui } from '../ui.js';

const QUAD = [
  { color: '#e46b5d', priority: 5, due: 0 },
  { color: '#e9a23b', priority: 5, due: null },
  { color: '#5b8fd9', priority: 3, due: 0 },
  { color: '#7fa86b', priority: 0, due: null },
];
export function inQuad(t, q) {
  const r = q.rule; const T0 = today(); const wk = ymd(addDays(T0, 6));
  if (!(r.priority || []).includes(t.priority || 0)) return false;
  const d = t.due ? dayOf(t.due) : null;
  if (r.due === 'week') return !!d && d <= wk;
  if (r.due === 'later') return !d || d > wk;
  return true;
}
export function render(main) {
  const s = settings();
  const open = T.live().filter((t) => T.isOpen(t) && !T.isNoteList(T.listById(t.listId)));
  const used = new Set();
  const boxes = s.matrix.map((q, i) => {
    const ts = open.filter((t) => !used.has(t.id) && inQuad(t, q));
    ts.forEach((t) => used.add(t.id));
    return { q, i, ts: T.sortTasks(ts, 'date') };
  });
  main.replaceChildren(
    h('div.view-head', h('h1', '▦ Eisenhower Matrix'), h('div.head-actions', h('button.icon-btn', { title: 'Edit boxes', onclick: editRules }, '⋯'))),
    h('div.view-body.scroll', { 'data-scroll': 'matrix' },
      h('p.muted.sm', 'Sort by what matters. Drag a task into another box to change its priority and date.'),
      h('div.matrix', boxes.map(({ q, i, ts }) => h('div.quad', {
        style: { '--qc': QUAD[i].color },
        ondragover: (e) => { if (e.dataTransfer.types.includes('text/task')) { e.preventDefault(); e.currentTarget.classList.add('over'); } },
        ondragleave: (e) => e.currentTarget.classList.remove('over'),
        ondrop: (e) => { e.currentTarget.classList.remove('over'); const t = get(e.dataTransfer.getData('text/task')); if (!t) return; e.preventDefault(); e.stopPropagation(); moveInto(t, q); },
      },
        h('div.quad-head', h('span.qn', ['I', 'II', 'III', 'IV'][i]), h('b', q.name), h('span.muted', ts.length)),
        h('div.quad-body', ts.length ? ts.map((t) => taskRow(t, { showList: true, details: false })) : h('p.muted.sm.center', 'Nothing here')),
        quickAdd('matrix' + i, { placeholder: 'Add here', extra: { priority: q.rule.priority[0], due: q.rule.due === 'week' ? today() : null } }))))));
}
function moveInto(t, q) {
  const f = {};
  if (!(q.rule.priority || []).includes(t.priority || 0)) f.priority = q.rule.priority[0];
  const wk = ymd(addDays(today(), 6));
  if (q.rule.due === 'week' && (!t.due || dayOf(t.due) > wk)) f.due = today();
  if (q.rule.due === 'later' && t.due && dayOf(t.due) <= wk) f.due = null;
  patch(t.id, f);
}
function editRules() {
  const s = settings(); const m2 = structuredClone(s.matrix);
  const body = h('div.form', m2.map((q, i) => h('div.quad-edit',
    h('input.input', { value: q.name, oninput: (e) => { q.name = e.target.value; } }),
    h('div.chips', T.PRIORITIES.map((p) => h('label.chip', h('input', { type: 'checkbox', checked: q.rule.priority.includes(p.v), onchange: (e) => { q.rule.priority = e.target.checked ? [...new Set([...q.rule.priority, p.v])] : q.rule.priority.filter((x) => x !== p.v); } }), ' ', p.name))),
    h('select.input.sm', { onchange: (e) => { q.rule.due = e.target.value; } }, [['week', 'Due within 7 days (urgent)'], ['later', 'Later or no date'], ['any', 'Any date']].map(([v, n]) => h('option', { value: v, selected: q.rule.due === v }, n))))));
  const m = modal('Matrix boxes', body, { wide: true, actions: [h('button.btn.ghost', { onclick: () => { saveSettings({ matrix: structuredClone((void 0) || defaultMatrix()) }); m.close(); } }, 'Reset'), h('button.btn', { onclick: () => { saveSettings({ matrix: m2 }); m.close(); } }, 'Save')] });
}
const defaultMatrix = () => [
  { name: 'Urgent & important', rule: { priority: [5], due: 'week' } },
  { name: 'Not urgent but important', rule: { priority: [5, 3], due: 'later' } },
  { name: 'Urgent, not important', rule: { priority: [3, 1, 0], due: 'week' } },
  { name: 'Neither', rule: { priority: [1, 0], due: 'later' } },
];
