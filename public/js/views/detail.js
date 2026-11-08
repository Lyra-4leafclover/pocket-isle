// Task detail panel (right side on desktop, full screen sheet on phones).
import { h, $, menu, toast, md, fmtDate, fmtDay, fmtDuration, readDataUrl, pickFile, ymd, debounce, confirmBox, uid } from '../util.js';
import { get, all, put, patch, emit, settings, store, me } from '../store.js';
import * as T from '../tasks.js';
import { ui, openTask, closeTask } from '../ui.js';
import { checkbox, datePicker, priorityMenu, tagPicker, taskMenu, moveTask, taskRow, avatar, dateBadge } from '../widgets.js';

let editing = { id: null, preview: true };
const quietSave = debounce(() => emit(), 600);
const save = (id, f) => { patch(id, f, { quiet: true }); quietSave(); };

export function render(panel) {
  watch(panel);
  const t = ui.taskId && get(ui.taskId);
  if (!t) { panel.replaceChildren(h('div.detail-empty', h('img', { src: 'assets/c_owl.webp', alt: '' }), h('p.muted', 'Click a task to see its details here.'))); return; }
  // don't rebuild while typing in this task, so the cursor stays put
  if (panel.dataset.task === t.id && panel.contains(document.activeElement) && document.activeElement.matches('textarea,input[type=text],input:not([type])')) return;
  if (editing.id !== t.id) editing = { id: t.id, preview: !!t.content };
  panel.dataset.task = t.id;
  const list = T.listById(t.listId);
  const note = T.isNoteList(list);
  const kids = T.children(t.id);
  const parent = t.parentId && get(t.parentId);
  const members = store.members[t.listId] || [];
  const focus = all('focus', (f) => f.taskId === t.id);
  const focusSec = focus.reduce((a, f) => a + (f.sec || 0), 0);

  const title = h('textarea.d-title', { rows: 1, placeholder: note ? 'Note title' : 'What needs doing?', value: t.title, 'data-keep': 'dtitle:' + t.id,
    oninput: (e) => { autosize(e.target); save(t.id, { title: e.target.value }); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } } });
  setTimeout(() => autosize(title));

  const content = editing.preview && t.content
    ? h('div.d-content.md', { html: md(t.content), onclick: (e) => { if (e.target.closest('a')) return; editing.preview = false; render(panel); setTimeout(() => panel.querySelector('.d-content-edit')?.focus(), 20); } })
    : h('textarea.d-content-edit', { placeholder: note ? 'Write anything… (markdown works: **bold**, - lists, # headings)' : 'Description (markdown works)', value: t.content || '', 'data-keep': 'dcontent:' + t.id,
      oninput: (e) => { autosize(e.target); save(t.id, { content: e.target.value }); }, onblur: () => { if (t.content) { editing.preview = true; setTimeout(() => render(panel), 150); } } });
  if (content.tagName === 'TEXTAREA') setTimeout(() => autosize(content));

  const items = t.items || [];
  const checklist = h('div.d-checklist',
    items.length ? h('div.progress', h('div', { style: { width: Math.round(100 * items.filter((i) => i.done).length / items.length) + '%' } })) : null,
    items.map((it, idx) => h('div.ck-item' + (it.done ? '.done' : ''),
      h('button.ck-box', { onclick: () => { const n = items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)); patch(t.id, { items: n }); if (n.every((x) => x.done) && n.length > 1 && T.isOpen(t)) toast('All items ticked. Finish the task?', { label: 'Complete', run: () => T.complete(get(t.id)) }); } }, it.done ? '✓' : ''),
      h('input.ck-text', { value: it.title, 'data-keep': 'ck:' + it.id, oninput: (e) => save(t.id, { items: get(t.id).items.map((x) => (x.id === it.id ? { ...x, title: e.target.value } : x)) }),
        onkeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); const n = [...get(t.id).items]; n.splice(idx + 1, 0, { id: uid(), title: '', done: false }); patch(t.id, { items: n }); setTimeout(() => panel.querySelectorAll('.ck-text')[idx + 1]?.focus(), 40); }
          if (e.key === 'Backspace' && !e.target.value) { e.preventDefault(); patch(t.id, { items: get(t.id).items.filter((x) => x.id !== it.id) }); setTimeout(() => panel.querySelectorAll('.ck-text')[Math.max(0, idx - 1)]?.focus(), 40); }
        } }),
      h('button.icon-btn.sm', { title: 'Turn into a subtask', onclick: () => { T.newTask({ title: it.title, parentId: t.id, listId: t.listId, due: null, status: it.done ? 2 : 0 }); patch(t.id, { items: items.filter((x) => x.id !== it.id) }); } }, '↳'),
      h('button.icon-btn.sm', { title: 'Remove', onclick: () => patch(t.id, { items: items.filter((x) => x.id !== it.id) }) }, '✕'))),
    h('input.ck-add', { placeholder: '+ Checklist item', 'data-keep': 'ckadd:' + t.id, onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { patch(t.id, { items: [...items, { id: uid(), title: e.target.value.trim(), done: false }] }); e.target.value = ''; setTimeout(() => panel.querySelector('.ck-add')?.focus(), 40); } } }));

  const subtasks = h('div.d-subtasks',
    h('div.d-label', 'Subtasks', kids.length ? h('span.muted', ` ${kids.filter((k) => !T.isOpen(k)).length}/${kids.length}`) : null),
    kids.map((k) => taskRow(k, { draggable: false, details: false })),
    h('input.ck-add', { placeholder: '+ Add subtask', 'data-keep': 'subadd:' + t.id, onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { const p = T.parseQuick(e.target.value); T.newTask({ title: p.title || e.target.value.trim(), parentId: t.id, listId: t.listId, due: p.due || null, priority: p.priority ?? 0, tags: p.tags.map(T.ensureTag) }); e.target.value = ''; setTimeout(() => panel.querySelector('.d-subtasks .ck-add')?.focus(), 40); } } }));

  const attachments = (t.attachments || []).length ? h('div.d-attach', t.attachments.map((a, i) => h('div.att',
    a.type?.startsWith('image/') ? h('img', { src: a.data, alt: a.name, onclick: () => window.open().document.write(`<img src="${a.data}" style="max-width:100%">`) }) : h('span.att-icon', '📄'),
    h('a', { href: a.data, download: a.name }, a.name),
    h('button.icon-btn.sm', { onclick: () => patch(t.id, { attachments: t.attachments.filter((_, j) => j !== i) }) }, '✕')))) : null;

  const comments = T.commentsFor(t.id);
  const commentBox = h('div.d-comments',
    h('div.d-label', 'Comments'),
    comments.map((c) => h('div.comment', avatar(c.owner, 22), h('div', h('small.muted', (c.authorName || 'Someone') + ' · ' + fmtDate(ymd(new Date(c.createdAt)))), h('div', { html: md(c.text) })),
      c.owner === me() ? h('button.icon-btn.sm', { onclick: () => { c._deleted = true; put(c); } }, '✕') : null)),
    h('input.ck-add', { placeholder: members.length ? 'Write a comment (everyone in the list can see it)' : 'Write a comment', 'data-keep': 'cm:' + t.id, onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { put({ kind: 'comment', taskId: t.id, listId: t.listId, text: e.target.value.trim(), authorName: store.user?.name || 'Me' }); e.target.value = ''; } } }));

  panel.replaceChildren(
    h('div.d-top',
      h('button.icon-btn.mobile-only', { onclick: closeTask, 'aria-label': 'Back' }, '‹'),
      note ? null : checkbox(t),
      note ? null : h('button.d-date' + (T.isOverdue(t) ? '.over' : ''), { onclick: (e) => datePicker(e.currentTarget, t, (f) => { if (f.due && t.due && f.due.slice(0, 10) > t.due.slice(0, 10)) f.postponed = (t.postponed || 0) + 1; patch(t.id, f); }) },
        t.due ? (t.start ? `${fmtDate(t.start)} → ${fmtDate(t.due)}` : fmtDate(t.due)) : '📅 Add date', t.repeat ? ' 🔁' : '', t.reminders?.length && t.due ? ' ⏰' : ''),
      h('span.spacer'),
      note ? null : h('button.icon-btn.flag', { title: 'Priority', style: { color: T.PRIORITIES.find((p) => p.v === (t.priority || 0)).color }, onclick: (e) => priorityMenu(e.currentTarget, t) }, '⚑'),
      h('button.icon-btn', { title: 'More', onclick: (e) => taskMenu(t, e.currentTarget) }, '⋯'),
      h('button.icon-btn.desktop-only', { onclick: closeTask, 'aria-label': 'Close' }, '✕')),
    h('div.d-body.scroll', { 'data-scroll': 'detail:' + t.id },
      parent ? h('button.d-parent', { onclick: () => openTask(parent.id) }, '↑ ', parent.title) : null,
      t.repeat ? h('div.d-note', '🔁 ', T.repeatText(t.repeat, t.due)) : null,
      T.isWontDo(t) ? h('div.d-note', "🚫 Marked won't do. ", h('button.link', { onclick: () => T.uncomplete(t) }, 'Reopen')) : null,
      t.trashedAt ? h('div.d-note', '🗑 In the trash. ', h('button.link', { onclick: () => T.restore(t) }, 'Restore')) : null,
      title,
      h('div.d-chips',
        h('button.chip', { onclick: (e) => menu(e.currentTarget, [T.INBOX, ...T.lists()].map((l) => ({ icon: l.emoji || '•', label: l.name, active: l.id === (t.listId || 'inbox'), run: () => moveTask(t, l.id) }))) }, `${list.emoji || '📂'} ${list.name}`),
        !list.virtual && (list.sections || []).length ? h('button.chip', { onclick: (e) => menu(e.currentTarget, [{ label: 'No section', run: () => patch(t.id, { sectionId: null }) }, ...list.sections.map((s) => ({ label: s.name, active: s.id === t.sectionId, run: () => patch(t.id, { sectionId: s.id }) }))]) }, '▥ ', (list.sections.find((s) => s.id === t.sectionId) || { name: 'No section' }).name) : null,
        (t.tags || []).map((g) => h('span.chip.tag', { style: { '--tc': T.tagByName(g)?.color || '#ccc' } }, '#' + g, h('button', { onclick: () => patch(t.id, { tags: t.tags.filter((x) => x !== g) }), 'aria-label': 'Remove tag' }, '×'))),
        h('button.chip.add', { onclick: (e) => tagPicker(e.currentTarget, [t]) }, '+ tag'),
        members.length ? h('button.chip', { onclick: (e) => menu(e.currentTarget, [{ label: 'Nobody', run: () => patch(t.id, { assignee: null }) }, ...members.map((m) => ({ icon: avatar(m.id, 18), label: m.name || m.email, active: t.assignee === m.id, run: () => patch(t.id, { assignee: m.id }) }))]) }, t.assignee ? avatar(t.assignee, 18) : '🙋', ' ', t.assignee ? (members.find((m) => m.id === t.assignee)?.name || 'Assigned') : 'Assign') : null),
      content,
      note ? null : checklist,
      note ? null : subtasks,
      attachments,
      h('div.d-tools',
        h('button.btn.ghost.sm', { onclick: async () => { const f = await pickFile('*/*'); if (!f) return; if (f.size > 2_500_000) return toast('Files up to 2.5 MB can be attached.'); patch(t.id, { attachments: [...(t.attachments || []), { name: f.name, type: f.type, data: await readDataUrl(f) }] }); } }, '📎 Attach'),
        note ? null : h('button.btn.ghost.sm', { onclick: () => { ui.focusTaskId = t.id; location.hash = '#/focus'; } }, '⏱ Focus'),
        note ? null : h('label.est', '🍅 ', h('input.input.sm', { type: 'number', min: 0, max: 50, value: t.estPomos || '', placeholder: 'est.', style: { width: '58px' }, onchange: (e) => patch(t.id, { estPomos: Number(e.target.value) || 0 }) }),
          focusSec ? h('span.muted', ` ${fmtDuration(focusSec)} focused`) : null)),
      commentBox,
      h('details.d-history', h('summary', 'Activity'), (t.history || []).slice().reverse().map((x) => h('div.muted.sm', `${new Date(x.at).toLocaleString()} · ${x.what}`)),
        h('div.muted.sm', `Created ${new Date(t.createdAt).toLocaleString()} · Updated ${new Date(t.updatedAt).toLocaleString()}`)),
    ));
}
let ro;
function watch(panel) { if (ro || !window.ResizeObserver) return; let w = 0; ro = new ResizeObserver(() => { if (panel.clientWidth !== w) { w = panel.clientWidth; panel.querySelectorAll('textarea.d-title, textarea.d-content-edit').forEach(autosize); } }); ro.observe(panel); }
function autosize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
