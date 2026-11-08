// The main task views: list, kanban, timeline, notes grid; quick add; batch actions.
import { h, $, $$, menu, toast, today, ymd, addDays, parseD, dayOf, diffDays, fmtDay, fmtDate, MONTHS, DOW, startOfWeek, plural, promptBox } from '../util.js';
import { get, all, put, patch, settings, saveSettings, store, me } from '../store.js';
import * as T from '../tasks.js';
import { ui, openTask, go } from '../ui.js';
import { taskRow, taskTree, enableReorder, taskMenu, datePicker, tagPicker, moveTask, emptyState, useTemplate, checkTask, avatar } from '../widgets.js';
import { listEditor, shareDialog, filterEditor } from './sidebar.js';

const prefsOf = (key) => {
  const s = settings(); s.viewPrefs ||= {};
  const isList = key.startsWith('list:');
  return { sort: isList ? 'custom' : 'date', group: key === 'all' || key === 'week' || key.startsWith('tag:') || key.startsWith('filter:') ? 'date' : key === 'today' || key === 'tomorrow' ? 'list' : 'none', showDone: true, view: 'list', ...(s.viewPrefs[key] || {}) };
};
const setPref = (key, f) => { const s = settings(); s.viewPrefs ||= {}; s.viewPrefs[key] = { ...prefsOf(key), ...f }; saveSettings({ viewPrefs: s.viewPrefs }); };

function contextDefaults(key) {
  const [type, arg] = key.includes(':') ? [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)] : [key, null];
  const f = {};
  if (type === 'list') f.listId = arg;
  if (type === 'today') f.due = today();
  if (type === 'tomorrow') f.due = ymd(addDays(today(), 1));
  if (type === 'week') f.due = today();
  if (type === 'tag') f.tags = [arg];
  if (type === 'assigned') f.assignee = me();
  if (type === 'inbox') f.listId = 'inbox';
  return f;
}

let quickText = '';
export function quickAdd(key, { placeholder, extra = {} } = {}) {
  const preview = h('div.qa-preview');
  const input = h('input.qa-input', { 'data-keep': 'quickadd:' + key, placeholder: placeholder || 'Add a task… try "Essay tomorrow 3pm #school !high"', value: quickText,
    oninput: (e) => { quickText = e.target.value; showPreview(); },
    onkeydown: (e) => { if (e.key === 'Enter' && input.value.trim()) { create(); } if (e.key === 'Escape') { input.value = ''; quickText = ''; showPreview(); input.blur(); } } });
  const showPreview = () => {
    const p = T.parseQuick(input.value);
    preview.replaceChildren(
      p.due ? h('span.chip.on', '📅 ' + fmtDate(p.start || p.due) + (p.start ? ' → ' + fmtDate(p.due) : '')) : null,
      p.repeat ? h('span.chip.on', '🔁 ' + T.repeatText(p.repeat, p.due)) : null,
      p.priority != null ? h('span.chip.on', '⚑ ' + T.prioName(p.priority)) : null,
      p.listId ? h('span.chip.on', '📂 ' + T.listById(p.listId).name) : null,
      p.tags.map((g) => h('span.chip.on', '#' + g)));
  };
  const create = () => {
    const p = T.parseQuick(input.value);
    const f = { ...contextDefaults(key), ...extra, title: p.title || input.value.trim() };
    if (p.due) f.due = p.due; if (p.start) f.start = p.start;
    if (p.repeat) { f.repeat = p.repeat; if (!f.due) f.due = today(); }
    if (p.priority != null) f.priority = p.priority;
    if (p.listId) f.listId = p.listId;
    f.tags = [...new Set([...(f.tags || []), ...p.tags.map(T.ensureTag)])];
    T.newTask(f);
    input.value = ''; quickText = ''; showPreview();
  };
  const tplBtn = T.templates().length ? h('button.icon-btn', { title: 'New from template', onclick: (e) => menu(e.currentTarget, T.templates().map((tp) => ({ icon: '★', label: tp.name, run: () => openTask(useTemplate(tp, contextDefaults(key)).id) })), { align: 'right' }) }, '★') : null;
  setTimeout(showPreview);
  return h('div.quickadd', h('span.qa-plus', '+'), input, tplBtn, preview);
}

export function render(main, key) {
  const prefs = prefsOf(key);
  const isList = key.startsWith('list:');
  const list = isList ? T.listById(key.slice(5)) : key === 'inbox' ? T.INBOX : null;
  const noteList = T.isNoteList(list);
  const closedView = ['completed', 'wontdo', 'trash'].includes(key);
  let tasks = T.queryFor(key);
  if (key.startsWith('list:') && !get(key.slice(5))) return main.replaceChildren(emptyState('c_owl', 'This list is gone', 'It may have been deleted or unshared.'));
  const open = closedView ? tasks : tasks.filter(T.isOpen);
  const done = closedView ? [] : tasks.filter((t) => !T.isOpen(t));
  const view = closedView ? 'list' : noteList ? 'notes' : prefs.view;

  const head = h('div.view-head',
    h('button.icon-btn.mobile-only', { onclick: () => { ui.sidebarOpen = true; ui.render(); }, 'aria-label': 'Lists' }, '☰', h('span.lbl', 'Lists')),
    h('h1', list?.emoji ? list.emoji + ' ' : '', T.titleFor(key)),
    list && store.members[list.id]?.length ? h('span.members', store.members[list.id].slice(0, 4).map((m) => avatar(m.id, 24))) : null,
    h('span.count', open.length || ''),
    h('div.head-actions',
      !closedView && !noteList ? h('div.seg', [['list', '☰', 'List'], ['kanban', '▥', 'Kanban'], ['timeline', '▤', 'Timeline']].map(([v, i, l]) => h('button' + (view === v ? '.on' : ''), { title: l, onclick: () => setPref(key, { view: v }) }, i))) : null,
      key === 'trash' && tasks.length ? h('button.btn.ghost.sm', { onclick: () => { tasks.forEach((t) => T.purge(t)); toast('Trash emptied'); } }, 'Empty trash') : null,
      h('button.icon-btn', { title: 'Sort, group and more', onclick: (e) => viewMenu(e.currentTarget, key, prefs, list, tasks) }, '⋯')));

  const body = h('div.view-body.scroll', { 'data-scroll': 'tasks:' + key });
  if (!closedView) body.append(quickAdd(key, noteList ? { placeholder: 'Add a note…' } : {}));
  if (key === 'today' && open.some(T.isOverdue)) body.append(planBanner(open.filter(T.isOverdue)));

  if (view === 'kanban') body.append(kanban(key, list, open, prefs));
  else if (view === 'timeline') body.append(timeline(open));
  else if (view === 'notes') body.append(notesGrid(tasks));
  else {
    const sorted = T.sortTasks(open, prefs.sort);
    const groups = closedView ? groupClosed(tasks, key) : T.groupTasks(sorted, prefs.group, key);
    const wrap = h('div.groups');
    for (const g of groups) {
      const collapsed = settings().sidebarCollapsed?.['g:' + key + ':' + g.key];
      wrap.append(h('div.group',
        g.name ? h('div.group-head', { onclick: () => toggleCollapse('g:' + key + ':' + g.key) }, h('span.twisty' + (collapsed ? '' : '.open'), '▸'), h('b', g.name), h('span.muted', g.tasks.length),
          g.key === 'overdue' ? h('button.link', { onclick: (e) => { e.stopPropagation(); g.tasks.forEach((t) => T.setDue(t, today())); toast(`Moved ${plural(g.tasks.length, 'task')} to today`); } }, 'Postpone to today') : null) : null,
        collapsed ? null : h('div.rows', taskTree(g.tasks, { showList: !isList, hideOrphans: !closedView && !!prefs.sort, showClosedKids: closedView }))));
    }
    if (!open.length && !closedView) wrap.append(emptyFor(key));
    if (closedView && !tasks.length) wrap.append(emptyFor(key));
    if (done.length && prefs.showDone) {
      const collapsed = settings().sidebarCollapsed?.['done:' + key] ?? true;
      wrap.append(h('div.group.done-group', h('div.group-head', { onclick: () => toggleCollapse('done:' + key, true) }, h('span.twisty' + (collapsed ? '' : '.open'), '▸'), h('b', 'Completed'), h('span.muted', done.length)),
        collapsed ? null : h('div.rows', done.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 200).map((t) => taskRow(t, { showList: !isList })))));
    }
    enableReorder(wrap);
    body.append(wrap);
  }
  main.replaceChildren(head, body, batchBar());
}

function toggleCollapse(k, defaultCollapsed = false) {
  const s = settings(); s.sidebarCollapsed ||= {};
  s.sidebarCollapsed[k] = !(s.sidebarCollapsed[k] ?? defaultCollapsed);
  saveSettings({ sidebarCollapsed: s.sidebarCollapsed });
}

function groupClosed(tasks, key) {
  const map = new Map();
  const at = (t) => (key === 'trash' ? t.trashedAt : t.completedAt) || t.updatedAt;
  for (const t of tasks.sort((a, b) => at(b) - at(a))) {
    const d = ymd(new Date(at(t)));
    if (!map.has(d)) map.set(d, { key: d, name: fmtDay(d, { long: true }) + (diffDays(d, today()) < -6 ? '' : ''), tasks: [] });
    map.get(d).tasks.push(t);
  }
  return [...map.values()];
}

function emptyFor(key) {
  if (key === 'today') return emptyState('c_cat', 'Nothing left for today', 'Your island is peaceful. Add something above, or enjoy the quiet.');
  if (key === 'completed') return emptyState('c_hedgehog', 'No finished tasks yet', 'Everything you tick off shows up here.');
  if (key === 'trash') return emptyState('c_raccoon', 'Trash is empty', 'Deleted tasks wait here until you empty it.');
  if (key === 'wontdo') return emptyState('c_snail', "Nothing marked won't do", "Tasks you decide to skip end up here.");
  if (key === 'inbox') return emptyState('c_duck', 'Inbox zero', 'Captain Puddle approves.');
  return emptyState('c_frog', 'No tasks here', 'Type in the box above to add one.');
}

function planBanner(overdue) {
  return h('div.plan-banner', h('img', { src: 'assets/p_weeds.webp', alt: '' }),
    h('div', h('b', `${plural(overdue.length, 'overdue task')} turned into weeds on your island`), h('div.muted', 'Finish them to clear the weeds, or move them to today.')),
    h('button.btn.sm', { onclick: () => { overdue.forEach((t) => T.setDue(t, today())); toast('Moved to today'); } }, 'Postpone all to today'));
}

function viewMenu(anchor, key, prefs, list, tasks) {
  const realList = list && !list.virtual;
  menu(anchor, [
    { header: 'Sort by' }, ...T.SORTS.map(([v, l]) => ({ label: l, active: prefs.sort === v, run: () => setPref(key, { sort: v }) })),
    '-', { header: 'Group by' }, ...T.GROUPS.map(([v, l]) => ({ label: l, active: prefs.group === v, run: () => setPref(key, { group: v }) })),
    '-',
    { icon: prefs.showDone ? '☑' : '☐', label: 'Show completed', run: () => setPref(key, { showDone: !prefs.showDone }) },
    { icon: settings().showDetails ? '☑' : '☐', label: 'Show details', run: () => saveSettings({ showDetails: !settings().showDetails }) },
    { icon: '☑', label: 'Select tasks', run: () => { tasks.filter(T.isOpen).slice(0, 1).forEach((t) => ui.selected.add(t.id)); ui.render(); toast('Click tasks to select them. Shift/Ctrl-click works too.'); } },
    { icon: '🖨️', label: 'Print', run: () => window.print() },
    realList ? '-' : null,
    realList ? { icon: '✎', label: 'Edit list', run: () => listEditor(list) } : null,
    realList && list.owner === me() ? { icon: '👥', label: 'Share list', run: () => shareDialog(list) } : null,
    realList ? { icon: '＋', label: 'Add section', run: async () => { const n = await promptBox('New section'); if (n) patch(list.id, { sections: [...(list.sections || []), { id: Date.now().toString(36), name: n }] }); } } : null,
    key.startsWith('filter:') ? { icon: '✎', label: 'Edit filter', run: () => filterEditor(get(key.slice(7))) } : null,
  ], { align: 'right' });
}

// ---------- kanban ----------
function kanban(key, list, open, prefs) {
  let cols;
  if (list && !list.virtual) {
    const secs = list.sections || [];
    cols = [{ id: null, name: 'Not sectioned' }, ...secs].map((s) => ({ ...s, tasks: open.filter((t) => (t.sectionId || null) === s.id || (s.id === null && !secs.some((x) => x.id === t.sectionId))) }));
  } else {
    cols = T.groupTasks(T.sortTasks(open, prefs.sort), prefs.group === 'none' ? 'date' : prefs.group, key).map((g) => ({ id: g.key, name: g.name, tasks: g.tasks, virtual: true }));
  }
  const board = h('div.kanban');
  for (const c of cols) {
    if (c.id === null && !c.tasks.length && (list.sections || []).length) continue;
    const col = h('div.k-col', {
      ondragover: (e) => { if (e.dataTransfer.types.includes('text/task')) { e.preventDefault(); col.classList.add('over'); } },
      ondragleave: () => col.classList.remove('over'),
      ondrop: (e) => { col.classList.remove('over'); const t = get(e.dataTransfer.getData('text/task')); if (!t) return; e.preventDefault(); e.stopPropagation(); if (!c.virtual) patch(t.id, { sectionId: c.id, parentId: null }); else if (prefs.group === 'priority') patch(t.id, { priority: Number(c.id.slice(1)) }); },
    },
      h('div.k-head', h('b', c.name), h('span.muted', c.tasks.length),
        !c.virtual && c.id ? h('button.icon-btn.sm', { onclick: (e) => menu(e.currentTarget, [
          { label: 'Rename', run: async () => { const n = await promptBox('Rename section', c.name); if (n) patch(list.id, { sections: list.sections.map((s) => (s.id === c.id ? { ...s, name: n } : s)) }); } },
          { label: 'Move left', run: () => { const s = [...list.sections]; const i = s.findIndex((x) => x.id === c.id); if (i > 0) { [s[i - 1], s[i]] = [s[i], s[i - 1]]; patch(list.id, { sections: s }); } } },
          { label: 'Delete section', danger: true, run: () => { patch(list.id, { sections: list.sections.filter((s) => s.id !== c.id) }); c.tasks.forEach((t) => patch(t.id, { sectionId: null })); } },
        ]) }, '⋯') : null),
      h('div.k-cards', c.tasks.filter((t) => !t.parentId || !c.tasks.some((x) => x.id === t.parentId)).map((t) => taskRow(t, { showList: !list || list.virtual }))),
      !c.virtual ? quickAdd(key, { placeholder: 'Add task', extra: { sectionId: c.id } }) : null);
    board.append(col);
  }
  if (list && !list.virtual) board.append(h('button.k-add', { onclick: async () => { const n = await promptBox('New section'); if (n) patch(list.id, { sections: [...(list.sections || []), { id: Date.now().toString(36), name: n }] }); } }, '+ Add section'));
  return board;
}

// ---------- timeline ----------
function timeline(open) {
  const start = addDays(today(), -3), days = 28;
  const dayW = 44;
  const withDates = T.sortTasks(open.filter((t) => t.due), 'date');
  const noDate = open.filter((t) => !t.due);
  const headDays = [...Array(days)].map((_, i) => { const d = addDays(ymd(start), i); return h('div.tl-day' + (ymd(d) === today() ? '.today' : '') + ([0, 6].includes(d.getDay()) ? '.wkend' : ''), h('small', DOW[d.getDay()][0]), d.getDate()); });
  const rows = withDates.map((t) => {
    const s = Math.max(0, diffDays(t.start || t.due, ymd(start))), e = Math.min(days - 1, diffDays(t.due, ymd(start)));
    const bar = e >= 0 && s < days ? h('div.tl-bar.p' + (t.priority || 0), { style: { left: s * dayW + 'px', width: Math.max(1, e - s + 1) * dayW - 6 + 'px' }, onclick: () => openTask(t.id), draggable: 'true', ondragstart: (ev) => { ev.dataTransfer.setData('text/task', t.id); ev.dataTransfer.setData('text/offset', String(Math.floor(ev.offsetX / dayW))); } }, t.title) : null;
    return h('div.tl-row', h('div.tl-name', { onclick: () => openTask(t.id) }, t.title), h('div.tl-track', { style: { width: days * dayW + 'px' } }, bar));
  });
  const grid = h('div.tl-grid', {
    ondragover: (e) => e.preventDefault(),
    ondrop: (e) => {
      const t = get(e.dataTransfer.getData('text/task')); if (!t) return;
      const track = e.target.closest('.tl-track'); if (!track) return;
      const off = Number(e.dataTransfer.getData('text/offset') || 0);
      const idx = Math.floor((e.clientX - track.getBoundingClientRect().left) / dayW) - off;
      const nd = ymd(addDays(ymd(start), idx));
      const shift = diffDays(nd, t.start || t.due);
      patch(t.id, { start: t.start ? ymd(addDays(t.start, shift)) + (t.start.includes('T') ? t.start.slice(10) : '') : null, due: ymd(addDays(t.due, shift)) + (t.due.includes('T') ? t.due.slice(10) : '') });
    },
  }, h('div.tl-row.tl-header', h('div.tl-name', 'Task'), h('div.tl-track.head', { style: { width: days * dayW + 'px' } }, headDays)), rows);
  return h('div.timeline', h('div.tl-scroll', grid), noDate.length ? h('div.group', h('div.group-head', h('b', 'No date'), h('span.muted', noDate.length)), h('div.rows', noDate.map((t) => taskRow(t)))) : null);
}

// ---------- notes ----------
function notesGrid(tasks) {
  const notes = tasks.filter((t) => !t.parentId).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
  if (!notes.length) return emptyState('c_owl', 'No notes yet', 'Notes are for ideas, journals and anything that is not a to-do.');
  return h('div.notes-grid', notes.map((t) => h('div.note-card' + (ui.taskId === t.id ? '.active' : ''), { onclick: () => openTask(t.id), oncontextmenu: (e) => { e.preventDefault(); taskMenu(t, { x: e.clientX, y: e.clientY }); } },
    h('b', t.pinned ? '📌 ' : '', t.title || 'Untitled'), h('p', (t.content || '').slice(0, 220)), h('small.muted', fmtDay(ymd(new Date(t.updatedAt)))))));
}

// ---------- batch bar ----------
export function batchBar() {
  if (ui.selected.size < 1) return h('div');
  const sel = () => [...ui.selected].map(get).filter(Boolean);
  const T0 = today();
  return h('div.batch-bar',
    h('b', `${ui.selected.size} selected`),
    h('button.btn.ghost.sm', { onclick: () => { sel().forEach((t) => T.isOpen(t) && T.complete(t)); ui.selected.clear(); ui.render(); } }, '✓ Complete'),
    h('button.btn.ghost.sm', { onclick: (e) => datePicker(e.currentTarget, sel()[0] || {}, (f) => sel().forEach((t) => patch(t.id, f))) }, '📅 Date'),
    h('button.btn.ghost.sm', { onclick: (e) => menu(e.currentTarget, T.PRIORITIES.map((p) => ({ icon: h('span', { style: { color: p.color } }, '⚑'), label: p.name, run: () => sel().forEach((t) => patch(t.id, { priority: p.v })) }))) }, '⚑ Priority'),
    h('button.btn.ghost.sm', { onclick: (e) => menu(e.currentTarget, [T.INBOX, ...T.lists()].map((l) => ({ icon: l.emoji || '•', label: l.name, run: () => sel().forEach((t) => moveTask(t, l.id)) }))) }, '📂 Move'),
    h('button.btn.ghost.sm', { onclick: (e) => tagPicker(e.currentTarget, sel()) }, '# Tags'),
    h('button.btn.ghost.sm.danger', { onclick: () => { const s = sel(); s.forEach((t) => T.trash(t)); ui.selected.clear(); toast(`${s.length} moved to Trash`, { label: 'Undo', run: () => s.forEach((t) => T.restore(t)) }); } }, '🗑 Delete'),
    h('button.icon-btn', { onclick: () => { ui.selected.clear(); ui.render(); }, 'aria-label': 'Clear selection' }, '✕'));
}
