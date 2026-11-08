// Reusable pieces: task rows, checkbox, date/repeat/reminder pickers, task context menu.
import { h, $, $$, menu, popover, closeFloating, toast, modal, ymd, today, parseD, dayOf, hasTime, timeOf, addDays, fmtDate, fmtDay, fmtTime, diffDays, DOW, MONTHS_LONG, daysInMonth, startOfWeek, promptBox, confirmBox, plural } from './util.js';
import { get, put, patch, all, settings, store, me } from './store.js';
import * as T from './tasks.js';
import { ui, openTask } from './ui.js';
import { resImg } from './game.js';

// ---------- sound ----------
let actx;
export function pop() {
  if (!settings().sound) return;
  try {
    actx ||= new AudioContext();
    const t0 = actx.currentTime;
    for (const [f, d] of [[880, 0], [1320, 0.06]]) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.12, t0 + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.25);
      o.connect(g).connect(actx.destination); o.start(t0 + d); o.stop(t0 + d + 0.3);
    }
  } catch {}
}

// ---------- completing with undo ----------
export function checkTask(t, el) {
  if (T.isOpen(t)) {
    const before = structuredClone(t);
    const res = T.complete(t);
    pop();
    if (el) el.closest('.task-row')?.classList.add('just-done');
    toast(res.next ? `Done! Next one is ${fmtDay(res.next)}.` : 'Done!', {
      label: 'Undo', run: () => {
        if (res.copy) { T.uncomplete(res.copy); res.copy._deleted = true; put(res.copy); put(Object.assign(get(t.id), { due: before.due, start: before.start, items: before.items, repeat: before.repeat })); }
        else T.uncomplete(get(t.id));
      },
    });
  } else T.uncomplete(t);
}

let pressTimer, pressed = false;
export function checkbox(t) {
  const cls = 'chk p' + (t.priority || 0) + (T.isDone(t) ? ' done' : '') + (T.isWontDo(t) ? ' wont' : '') + (T.isNoteList(T.listById(t.listId)) ? ' note' : '');
  return h('button', { class: cls, 'aria-label': T.isOpen(t) ? 'Complete task' : 'Reopen task', onclick: (e) => { e.stopPropagation(); if (T.isWontDo(t)) return T.uncomplete(t); checkTask(t, e.currentTarget); } },
    T.isDone(t) ? '✓' : T.isWontDo(t) ? '✕' : '');
}

export function dateBadge(t) {
  if (!t.due) return null;
  const over = T.isOverdue(t);
  let txt = t.start && dayOf(t.start) !== dayOf(t.due) ? `${fmtDay(t.start)} – ${fmtDate(t.due)}` : t.start && hasTime(t.start) ? `${fmtDay(t.due)} ${fmtTime(timeOf(t.start))}–${fmtTime(timeOf(t.due))}` : fmtDate(t.due);
  return h('span.badge.date' + (over ? '.over' : dayOf(t.due) === today() ? '.today' : ''), txt);
}

export function avatar(userId, size = 20) {
  const m = Object.values(store.members).flat().find((x) => x.id === userId) || (userId === me() && store.user ? store.user : null);
  const name = m ? m.name || m.email : '?';
  const hue = [...String(userId)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return h('span.avatar', { title: name, style: { width: size + 'px', height: size + 'px', background: `hsl(${hue} 45% 80%)`, fontSize: size * 0.5 + 'px' } }, name[0].toUpperCase());
}

// ---------- task row ----------
export function taskRow(t, opts = {}) {
  const kids = T.children(t.id);
  const doneKids = kids.filter((k) => !T.isOpen(k)).length;
  const items = t.items || [];
  const list = T.listById(t.listId);
  const expanded = !ui.collapsedTasks?.has(t.id);
  const row = h('div.task-row', {
    'data-id': t.id,
    class: (ui.taskId === t.id ? 'active ' : '') + (ui.selected.has(t.id) ? 'selected ' : '') + (T.isOpen(t) ? '' : 'closed ') + (opts.depth ? 'sub' : ''),
    style: opts.depth ? { paddingLeft: 10 + opts.depth * 24 + 'px' } : null,
    draggable: opts.draggable === false ? null : 'true',
    onclick: (e) => {
      if (e.shiftKey || e.metaKey || e.ctrlKey || ui.selected.size) {
        ui.selected.has(t.id) ? ui.selected.delete(t.id) : ui.selected.add(t.id);
        ui.taskId = null; document.body.classList.remove('detail-open'); ui.render(); return;
      }
      openTask(t.id);
    },
    oncontextmenu: (e) => { e.preventDefault(); taskMenu(t, { x: e.clientX, y: e.clientY }); },
    ontouchstart: (e) => { const p = e.touches[0]; clearTimeout(pressTimer); pressed = false; pressTimer = setTimeout(() => { pressed = true; navigator.vibrate?.(10); taskMenu(t, { x: p.clientX, y: p.clientY }); }, 550); },
    ontouchmove: () => clearTimeout(pressTimer), ontouchend: (e) => { clearTimeout(pressTimer); if (pressed) { e.preventDefault(); pressed = false; } },
    ondragstart: (e) => { e.dataTransfer.setData('text/task', t.id); e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); },
    ondragend: () => row.classList.remove('dragging'),
  },
    kids.length ? h('button.twisty' + (expanded ? '.open' : ''), { onclick: (e) => { e.stopPropagation(); ui.collapsedTasks ||= new Set(); expanded ? ui.collapsedTasks.add(t.id) : ui.collapsedTasks.delete(t.id); ui.render(); } }, '▸') : h('span.twisty-space'),
    checkbox(t),
    h('div.t-main',
      h('div.t-title', t.pinned ? h('span.pin', '📌') : null, t.title || h('span.muted', 'No title')),
      (settings().showDetails && t.content && opts.details !== false) ? h('div.t-desc', t.content.replace(/[#*_>`-]/g, '').slice(0, 120)) : null),
    h('div.t-meta',
      items.length ? h('span.badge.sub', `☑ ${items.filter((i) => i.done).length}/${items.length}`) : null,
      kids.length ? h('span.badge.sub', `↳ ${doneKids}/${kids.length}`) : null,
      t.attachments?.length ? h('span.badge.icon', { title: 'Attachments' }, '📎') : null,
      T.commentsFor(t.id).length ? h('span.badge.icon', { title: 'Comments' }, '💬') : null,
      t.reminders?.length && t.due ? h('span.badge.icon', { title: 'Reminder' }, '⏰') : null,
      t.repeat ? h('span.badge.icon', { title: T.repeatText(t.repeat, t.due) }, '🔁') : null,
      t.loot && !T.isOpen(t) ? h('span.loot', Object.entries(t.loot).map(([r, n]) => h('span.loot-i', h('img', { src: resImg(r), alt: r }), '×' + n))) : null,
      (t.tags || []).slice(0, 3).map((g) => h('span.badge.tag', { style: { '--tc': T.tagByName(g)?.color || '#ccc' } }, g)),
      opts.showList && t.listId ? h('span.badge.list', `${list.emoji || ''} ${list.name}`.trim()) : null,
      dateBadge(t),
      t.assignee ? avatar(t.assignee) : null,
    ),
    h('button.t-more', { 'aria-label': 'More', onclick: (e) => { e.stopPropagation(); taskMenu(t, e.currentTarget); } }, '⋯'),
  );
  return row;
}

export function taskTree(tasks, opts = {}) {
  // renders tasks with their open subtasks nested underneath
  const ids = new Set(tasks.map((t) => t.id));
  const out = [];
  const add = (t, depth) => {
    out.push(taskRow(t, { ...opts, depth }));
    if (ui.collapsedTasks?.has(t.id)) return;
    for (const c of T.sortTasks(T.children(t.id).filter((c) => opts.showClosedKids || T.isOpen(c) || ids.has(c.id)), 'custom')) if (depth < 5) add(c, depth + 1);
  };
  for (const t of tasks) if (!t.parentId || !ids.has(t.parentId) && !(get(t.parentId) && opts.nest !== false && tasks.some((x) => x.id === t.parentId))) {
    if (t.parentId && opts.nest !== false && get(t.parentId) && !get(t.parentId).trashedAt && T.isOpen(get(t.parentId)) && opts.hideOrphans) continue;
    add(t, 0);
  }
  return out;
}

// ---------- drop handling (reorder / nest) ----------
export function enableReorder(container, { onDropTask } = {}) {
  container.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/task')) return;
    e.preventDefault();
    const row = e.target.closest('.task-row');
    $$('.drop-before,.drop-after,.drop-into', container).forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
    if (!row) return;
    const r = row.getBoundingClientRect();
    const into = e.clientX > r.left + 120 && e.clientY > r.top + r.height * 0.3 && e.clientY < r.bottom - r.height * 0.3;
    row.classList.add(into ? 'drop-into' : e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  container.addEventListener('dragleave', (e) => { if (!container.contains(e.relatedTarget)) $$('.drop-before,.drop-after,.drop-into', container).forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into')); });
  container.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData('text/task');
    if (!id) return;
    e.preventDefault();
    const row = e.target.closest('.task-row');
    const mode = row?.classList.contains('drop-into') ? 'into' : row?.classList.contains('drop-before') ? 'before' : 'after';
    $$('.drop-before,.drop-after,.drop-into', container).forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
    const t = get(id);
    if (!t) return;
    if (onDropTask && onDropTask(t, e, row)) return;
    if (!row || row.dataset.id === id) return;
    const target = get(row.dataset.id);
    if (!target) return;
    if (mode === 'into') {
      let p = target; while (p) { if (p.id === t.id) return; p = p.parentId && get(p.parentId); }
      patch(t.id, { parentId: target.id, listId: target.listId, order: Date.now() });
      return;
    }
    const sibs = [...container.querySelectorAll('.task-row')].map((r) => get(r.dataset.id)).filter((x) => x && x.id !== t.id && (x.parentId || null) === (target.parentId || null));
    const i = sibs.findIndex((x) => x.id === target.id);
    const neighbour = mode === 'before' ? sibs[i - 1] : sibs[i + 1];
    const a = target.order ?? 0, b = neighbour ? neighbour.order ?? 0 : a + (mode === 'before' ? -1000 : 1000);
    patch(t.id, { order: (a + b) / 2, parentId: target.parentId || null, listId: target.listId, sectionId: target.sectionId || null });
  });
}

// ---------- context menu ----------
export function taskMenu(t, anchor) {
  const sel = ui.selected.size > 1 && ui.selected.has(t.id) ? [...ui.selected].map(get).filter(Boolean) : [t];
  const each = (fn) => sel.forEach((x) => fn(get(x.id) || x));
  const T0 = today();
  menu(anchor, [
    { custom: h('div.menu-row', [
      ['☀️', 'Today', T0], ['🌤️', 'Tomorrow', ymd(addDays(T0, 1))], ['📅', 'Next week', ymd(addDays(ymd(startOfWeek(T0, 1)), 7))],
    ].map(([i, l, d]) => h('button.menu-icon', { title: l, onclick: () => { closeFloating(); each((x) => T.setDue(x, d)); } }, i)),
      h('button.menu-icon', { title: 'Pick a date', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); closeFloating(); datePicker({ x: r.left, y: r.bottom }, t, (f) => each((x) => patch(x.id, f))); } }, '🗓️'),
      h('button.menu-icon', { title: 'Clear date', onclick: () => { closeFloating(); each((x) => T.setDue(x, null)); } }, '⌫')) },
    { custom: h('div.menu-row', T.PRIORITIES.map((p) => h('button.menu-icon.flag', { title: p.name + ' priority', style: { color: p.color }, onclick: () => { closeFloating(); each((x) => patch(x.id, { priority: p.v })); } }, '⚑'))) },
    '-',
    { icon: '📂', label: 'Move to', sub: [T.INBOX, ...T.lists()].map((l) => ({ icon: l.emoji || '•', label: l.name, active: t.listId === l.id, run: () => each((x) => moveTask(x, l.id)) })) },
    { icon: '#', label: 'Tags', run: () => tagPicker(anchor, sel) },
    sel.length === 1 ? { icon: '📌', label: t.pinned ? 'Unpin' : 'Pin to top', run: () => patch(t.id, { pinned: !t.pinned }) } : null,
    sel.length === 1 && T.isOpen(t) ? { icon: '↳', label: 'Add subtask', run: () => { const c = T.newTask({ parentId: t.id, listId: t.listId, due: null }); openTask(c.id); setTimeout(() => $('#detail .d-title')?.focus(), 60); } } : null,
    sel.length === 1 ? { icon: '⏱️', label: 'Start focus', run: () => { ui.focusTaskId = t.id; location.hash = '#/focus'; } } : null,
    sel.length === 1 ? { icon: '⧉', label: 'Duplicate', run: () => T.duplicate(t) } : null,
    sel.length === 1 ? { icon: '★', label: 'Save as template', run: () => saveTemplate(t) } : null,
    sel.length === 1 ? { icon: '🔗', label: 'Copy link', run: () => { navigator.clipboard?.writeText(location.origin + location.pathname + '#/task/' + t.id); toast('Link copied'); } } : null,
    T.isOpen(t) ? { icon: '🚫', label: "Won't do", run: () => each((x) => T.wontDo(x)) } : { icon: '↺', label: 'Reopen', run: () => each((x) => T.uncomplete(x)) },
    '-',
    t.trashedAt ? { icon: '↺', label: 'Restore', run: () => each((x) => T.restore(x)) } : null,
    t.trashedAt ? { icon: '✕', label: 'Delete forever', danger: true, run: () => each((x) => T.purge(x)) }
      : { icon: '🗑️', label: sel.length > 1 ? `Delete ${sel.length} tasks` : 'Delete', danger: true, run: () => { each((x) => T.trash(x)); if (sel.some((x) => x.id === ui.taskId)) { ui.taskId = null; } ui.selected.clear(); toast(sel.length > 1 ? `${sel.length} tasks moved to Trash` : 'Moved to Trash', { label: 'Undo', run: () => each((x) => T.restore(x)) }); } },
  ]);
}

export function moveTask(t, listId) {
  const list = T.listById(listId);
  for (const x of [t, ...T.descendants(t.id)]) patch(x.id, { listId, sectionId: null, assignee: x.assignee && (store.members[listId] || []).some((m) => m.id === x.assignee) ? x.assignee : null });
  if (t.parentId && get(t.parentId)?.listId !== listId) patch(t.id, { parentId: null });
  toast(`Moved to ${list.name}`);
}

export async function saveTemplate(t) {
  const name = await promptBox('Save as template', t.title);
  if (!name) return;
  const kids = T.descendants(t.id).map((c) => ({ title: c.title, depth: T.depth(c) - T.depth(t), content: c.content || '' }));
  put({ kind: 'template', name, task: { title: t.title, content: t.content, items: (t.items || []).map((i) => ({ ...i, done: false })), tags: t.tags, priority: t.priority }, kids });
  toast('Template saved');
}
export function useTemplate(tpl, fields = {}) {
  const t = T.newTask({ ...structuredClone(tpl.task), ...fields });
  const stack = [t];
  for (const k of tpl.kids || []) {
    const parent = stack[Math.min(k.depth - 1, stack.length - 1)] || t;
    const c = T.newTask({ title: k.title, content: k.content, parentId: parent.id, listId: t.listId, due: null });
    stack[k.depth] = c; stack.length = k.depth + 1;
  }
  return t;
}

// ---------- tag picker ----------
export function tagPicker(anchor, tasks) {
  const input = h('input.input.sm', { placeholder: 'Type a tag, Enter to add' });
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const ts = T.tags().filter((g) => !q || g.name.toLowerCase().includes(q));
    body.replaceChildren(...ts.map((g) => {
      const on = tasks.every((t) => (get(t.id).tags || []).includes(g.name));
      return h('label.menu-item', h('input', { type: 'checkbox', checked: on, onchange: () => {
        for (const t of tasks) { const x = get(t.id); const set = new Set(x.tags || []); on ? set.delete(g.name) : set.add(g.name); patch(x.id, { tags: [...set] }); }
        render();
      } }), h('span.dot', { style: { background: g.color } }), h('span.ml', g.name));
    }), q && !T.tagByName(q) ? h('button.menu-item', { onclick: add }, `+ Create "${input.value.trim()}"`) : null);
  };
  const add = () => { const n = T.ensureTag(input.value.trim()); if (!n) return; for (const t of tasks) { const x = get(t.id); patch(x.id, { tags: [...new Set([...(x.tags || []), n])] }); } input.value = ''; render(); };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  const body = h('div.tag-list');
  popover(anchor, h('div.menu.tag-picker', input, body));
  render();
  setTimeout(() => input.focus(), 20);
}

// ---------- date picker ----------
// onChange gets {due, start, reminders, repeat}
export function datePicker(anchor, t, onChange, { allowRepeat = true } = {}) {
  let due = t.due || null, start = t.start || null, reminders = [...(t.reminders || [])], repeat = t.repeat ? { ...t.repeat } : null;
  let mode = start ? 'range' : 'date';
  let view = parseD(dayOf(due) || today()); view.setDate(1);
  const wrap = h('div.datepicker');
  const commit = () => { onChange({ due, start: mode === 'range' ? start : null, reminders: due ? reminders : [], repeat: due ? repeat : null }); };
  const setDay = (d) => {
    if (mode === 'range' && start && !due) { due = d < dayOf(start) ? d : d; }
    const keep = (s, d2) => (s && hasTime(s) ? `${d2}T${timeOf(s)}` : d2);
    if (mode === 'range') {
      if (!start || (start && due && dayOf(start) !== dayOf(due)) || d < dayOf(start)) { start = keep(start, d); due = keep(due || start, d); }
      else due = keep(due, d);
    } else due = keep(due, d);
    render();
  };
  const render = () => {
    const y = view.getFullYear(), m = view.getMonth();
    const ws = settings().weekStart;
    const first = startOfWeek(ymd(view), ws);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = ymd(addDays(ymd(first), i));
      const inRange = mode === 'range' && start && due && d >= dayOf(start) && d <= dayOf(due);
      cells.push(h('button.dp-day', { class: (parseD(d).getMonth() !== m ? 'out ' : '') + (d === today() ? 'today ' : '') + (d === dayOf(due) || (mode === 'range' && d === dayOf(start)) ? 'sel ' : '') + (inRange ? 'range' : ''), onclick: () => setDay(d) }, parseD(d).getDate()));
    }
    const timeInput = (val, set) => h('input.input.sm', { type: 'time', value: val && hasTime(val) ? timeOf(val) : '', onchange: (e) => set(e.target.value) });
    wrap.replaceChildren(
      h('div.dp-tabs', h('button' + (mode === 'date' ? '.on' : ''), { onclick: () => { mode = 'date'; start = null; render(); } }, 'Date'), h('button' + (mode === 'range' ? '.on' : ''), { onclick: () => { mode = 'range'; start = start || due || today(); due = due || start; render(); } }, 'Duration')),
      h('div.dp-quick', [['☀️', 'Today', today()], ['🌤️', 'Tomorrow', ymd(addDays(today(), 1))], ['📅', 'Next Monday', ymd(addDays(ymd(startOfWeek(today(), 1)), 7))], ['🌙', 'Next month', ymd(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1))]].map(([i, l, d]) => h('button', { title: l, onclick: () => { mode = 'date'; start = null; setDay(d); } }, i))),
      h('div.dp-head', h('button.icon-btn', { onclick: () => { view = new Date(y, m - 1, 1); render(); } }, '‹'), h('b', `${MONTHS_LONG[m]} ${y}`), h('button.icon-btn', { onclick: () => { view = new Date(y, m + 1, 1); render(); } }, '›')),
      h('div.dp-grid', [...Array(7)].map((_, i) => h('span.dp-dow', DOW[(i + ws) % 7][0])), cells),
      mode === 'date'
        ? h('div.dp-row', h('span', '🕒 Time'), timeInput(due, (v) => { due = (dayOf(due) || today()) + (v ? 'T' + v : ''); if (v && reminders.every((r) => r.includes('@'))) reminders = reminders.length ? ['m0'] : reminders; if (!v) reminders = reminders.filter((r) => r.includes('@')); render(); }))
        : h('div', h('div.dp-row', h('span', 'Starts'), h('span.muted', fmtDay(start)), timeInput(start, (v) => { start = dayOf(start) + (v ? 'T' + v : ''); if (v && !hasTime(due)) { const end = new Date(parseD(start).getTime() + 3600e3); due = `${dayOf(due)}T${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`; } render(); })),
          h('div.dp-row', h('span', 'Ends'), h('span.muted', fmtDay(due)), timeInput(due, (v) => { due = dayOf(due) + (v ? 'T' + v : ''); render(); }))),
      h('div.dp-row', h('span', '⏰ Reminder'), h('button.chip', { onclick: (e) => reminderPicker(e.currentTarget, due, reminders, (r) => { reminders = r; render(); }) }, reminders.length ? reminders.map((r) => T.reminderLabel(r)).join(', ') : 'None')),
      allowRepeat ? h('div.dp-row', h('span', '🔁 Repeat'), h('button.chip', { onclick: (e) => repeatPicker(e.currentTarget, due || today(), repeat, (r) => { repeat = r; if (!due) due = today(); render(); }) }, repeat ? T.repeatText(repeat, due) : 'None')) : null,
      h('div.dp-actions', h('button.btn.ghost.sm', { onclick: () => { due = null; start = null; repeat = null; reminders = []; commit(); closeFloating(); } }, 'Clear'), h('button.btn.sm', { onclick: () => { commit(); closeFloating(); } }, 'OK')),
    );
  };
  render();
  return popover(anchor, wrap, { className: 'dp-pop' });
}

function reminderPicker(anchor, due, current, onChange) {
  const timed = hasTime(due);
  const opts = timed ? T.REMINDERS_TIMED : T.REMINDERS_ALLDAY;
  let sel = new Set(current);
  const pop = h('div.menu');
  const render = () => pop.replaceChildren(
    ...opts.map((r) => h('label.menu-item', h('input', { type: 'checkbox', checked: sel.has(r), onchange: () => { sel.has(r) ? sel.delete(r) : sel.add(r); render(); } }), h('span.ml', T.reminderLabel(r)))),
    [...sel].filter((r) => !opts.includes(r)).map((r) => h('label.menu-item', h('input', { type: 'checkbox', checked: true, onchange: () => { sel.delete(r); render(); } }), h('span.ml', T.reminderLabel(r)))),
    h('div.menu-sep'),
    h('div.menu-row.custom-rem',
      h('input.input.sm', { type: 'number', min: 0, value: 10, style: { width: '56px' }, id: 'remN' }),
      h('select.input.sm', { id: 'remU' }, timed ? [['m', 'minutes'], ['h', 'hours'], ['d', 'days'], ['w', 'weeks']].map(([v, l]) => h('option', { value: v }, l)) : [['d', 'days early'], ['w', 'weeks early']].map(([v, l]) => h('option', { value: v }, l))),
      !timed ? h('input.input.sm', { type: 'time', value: '09:00', id: 'remT' }) : null,
      h('button.btn.sm', { onclick: () => { const n = $('#remN').value || 0, u = $('#remU').value; sel.add(timed ? `${u}${n}` : `${u}${n}@${$('#remT').value || '09:00'}`); render(); } }, 'Add')),
    h('div.dp-actions', h('button.btn.sm', { onclick: () => { onChange([...sel]); pop.closest('.popover').remove(); } }, 'Done')),
  );
  render();
  const p = popover(anchor, pop);
  p.classList.add('stacked');
}

export function repeatPicker(anchor, due, current, onChange) {
  const d = parseD(dayOf(due));
  const presets = [
    ['None', null], ['Daily', { freq: 'day', interval: 1 }], ['Every weekday (Mon–Fri)', { freq: 'week', interval: 1, byDay: [1, 2, 3, 4, 5] }],
    [`Weekly on ${DOW[d.getDay()]}`, { freq: 'week', interval: 1, byDay: [d.getDay()] }], [`Monthly on day ${d.getDate()}`, { freq: 'month', interval: 1 }],
    [`Yearly on ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`, { freq: 'year', interval: 1 }],
  ];
  const p = menu(anchor, [...presets.map(([l, r]) => ({ label: l, active: JSON.stringify(current) === JSON.stringify(r), run: () => onChange(r) })), '-', { label: 'Custom…', run: () => customRepeat(due, current, onChange) }]);
  p.classList.add('stacked');
}

export function customRepeat(due, current, onChange) {
  const r = { freq: 'week', interval: 1, byDay: [parseD(dayOf(due)).getDay()], ...(current || {}) };
  const body = h('div.form');
  const render = () => body.replaceChildren(
    h('div.form-row', h('span', 'Every'), h('input.input.sm', { type: 'number', min: 1, value: r.interval || 1, style: { width: '64px' }, oninput: (e) => { r.interval = Math.max(1, Number(e.target.value) || 1); } }),
      h('select.input.sm', { onchange: (e) => { r.freq = e.target.value; render(); } }, [['day', 'day(s)'], ['week', 'week(s)'], ['month', 'month(s)'], ['year', 'year(s)']].map(([v, l]) => h('option', { value: v, selected: r.freq === v }, l)))),
    r.freq === 'day' ? h('label.form-row', h('input', { type: 'checkbox', checked: !!r.workdays, onchange: (e) => { r.workdays = e.target.checked; } }), 'Skip weekends') : null,
    r.freq === 'week' ? h('div.form-row.dow-pick', [1, 2, 3, 4, 5, 6, 0].map((i) => h('button.chip' + ((r.byDay || []).includes(i) ? '.on' : ''), { onclick: () => { const s = new Set(r.byDay || []); s.has(i) ? s.delete(i) : s.add(i); r.byDay = [...s]; render(); } }, DOW[i]))) : null,
    r.freq === 'month' ? h('div.form-row', h('select.input.sm', { onchange: (e) => { r.monthMode = e.target.value; } }, [['date', `On day ${parseD(dayOf(due)).getDate()}`], ['nth', `On the ${['1st', '2nd', '3rd', '4th', '5th'][Math.ceil(parseD(dayOf(due)).getDate() / 7) - 1]} ${DOW[parseD(dayOf(due)).getDay()]}`], ['last', `On the last ${DOW[parseD(dayOf(due)).getDay()]}`]].map(([v, l]) => h('option', { value: v, selected: (r.monthMode || 'date') === v }, l)))) : null,
    h('label.form-row', h('input', { type: 'checkbox', checked: !!r.fromCompletion, onchange: (e) => { r.fromCompletion = e.target.checked; } }), 'Count from when I finish it (not from the due date)'),
    h('div.form-row', h('span', 'Ends'),
      h('select.input.sm', { onchange: (e) => { const v = e.target.value; r.until = v === 'date' ? ymd(addDays(today(), 30)) : null; r.count = v === 'count' ? 10 : null; render(); } }, [['never', 'Never'], ['date', 'On a date'], ['count', 'After a number of times']].map(([v, l]) => h('option', { value: v, selected: (r.until ? 'date' : r.count ? 'count' : 'never') === v }, l))),
      r.until ? h('input.input.sm', { type: 'date', value: r.until, onchange: (e) => { r.until = e.target.value; } }) : null,
      r.count ? h('input.input.sm', { type: 'number', min: 1, value: r.count, style: { width: '64px' }, oninput: (e) => { r.count = Number(e.target.value) || 1; } }) : null),
  );
  render();
  const m = modal('Custom repeat', body, { actions: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), h('button.btn', { onclick: () => { if (r.freq !== 'week') delete r.byDay; onChange({ ...r, done: current?.done || 0 }); m.close(); } }, 'Save')] });
}

export function priorityMenu(anchor, t) {
  menu(anchor, T.PRIORITIES.map((p) => ({ icon: h('span', { style: { color: p.color } }, '⚑'), label: p.name, active: (t.priority || 0) === p.v, run: () => patch(t.id, { priority: p.v }) })));
}

export function emptyState(art, title, text) {
  return h('div.empty', h('img', { src: `assets/${art}.webp`, alt: '' }), h('h3', title), text ? h('p.muted', text) : null);
}
export { plural };
