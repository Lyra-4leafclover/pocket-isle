// Sidebar with smart lists, folders, lists, tags and filters, plus their editors.
import { h, menu, modal, toast, promptBox, confirmBox, plural, today as todayStr } from '../util.js';
import { get, all, put, patch, remove, settings, saveSettings, store, api, me, pull, push } from '../store.js';
import * as T from '../tasks.js';
import { ui, go } from '../ui.js';
import { LIST_RES, RES, resImg } from '../game.js';
import { moveTask, avatar } from '../widgets.js';

const EMOJIS = ['📚', '💼', '🏠', '💪', '🎨', '🛒', '✈️', '💰', '🎵', '🌱', '🍳', '🧘', '💻', '📝', '🎓', '❤️', '⭐', '🐾', '🎮', '🌙'];

export function renderSidebar(el, key) {
  const s = settings();
  const collapsed = s.sidebarCollapsed || {};
  const toggle = (k) => { collapsed[k] = !collapsed[k]; saveSettings({ sidebarCollapsed: collapsed }); };
  const count = (k) => T.queryFor(k).filter(T.isOpen).length;
  const dropTo = (listId) => ({
    ondragover: (e) => { if (e.dataTransfer.types.includes('text/task')) { e.preventDefault(); e.currentTarget.classList.add('over'); } },
    ondragleave: (e) => e.currentTarget.classList.remove('over'),
    ondrop: (e) => { e.currentTarget.classList.remove('over'); const t = get(e.dataTransfer.getData('text/task')); if (t) { e.preventDefault(); e.stopPropagation(); listId(t); } },
  });
  const item = (k, icon, name, n, extra = {}, menuFn) => h('a.side-item' + (key === k ? '.on' : ''), { href: '#/tasks/' + encodeURIComponent(k), onclick: () => { ui.sidebarOpen = false; }, oncontextmenu: menuFn ? (e) => { e.preventDefault(); menuFn(e); } : null, ...extra },
    h('span.si-icon', icon), h('span.si-name', name), n ? h('span.si-count', n) : null,
    menuFn ? h('button.si-more', { onclick: (e) => { e.preventDefault(); e.stopPropagation(); menuFn(e.currentTarget); } }, '⋯') : null);

  const smart = T.SMART.filter((x) => s.smart[x.key] !== false).map((x) => item(x.key, x.icon, x.name, x.key === 'all' ? null : count(x.key),
    x.key === 'today' ? dropTo((t) => T.setDue(t, todayStr())) : x.key === 'inbox' ? dropTo((t) => moveTask(t, 'inbox')) : {}));

  const listItem = (l) => item('list:' + l.id, l.emoji || h('span.dot', { style: { background: l.color || '#ccc' } }), l.name, count('list:' + l.id),
    dropTo((t) => moveTask(t, l.id)), (a) => listMenu(a, l));
  const fs = T.folders();
  const loose = T.lists().filter((l) => !l.folderId || !get(l.folderId));
  const listsBlock = [
    ...fs.map((f) => h('div.folder',
      h('div.side-item.folder-head', { onclick: () => toggle('f:' + f.id), oncontextmenu: (e) => { e.preventDefault(); folderMenu(e, f); } }, h('span.twisty' + (collapsed['f:' + f.id] ? '' : '.open'), '▸'), h('span.si-name', '📁 ' + f.name), h('button.si-more', { onclick: (e) => { e.stopPropagation(); folderMenu(e.currentTarget, f); } }, '⋯')),
      collapsed['f:' + f.id] ? null : h('div.folder-body', T.lists().filter((l) => l.folderId === f.id).map(listItem)))),
    ...loose.map(listItem),
  ];
  const tagTree = (parent) => T.tags().filter((g) => (g.parent || null) === parent).map((g) => h('div',
    item('tag:' + g.name, h('span.dot', { style: { background: g.color } }), parent ? g.name.slice(parent.length + 1) : g.name, count('tag:' + g.name), dropTo((t) => patch(t.id, { tags: [...new Set([...(t.tags || []), g.name])] })), (a) => tagMenu(a, g)),
    h('div.tag-kids', tagTree(g.name))));

  el.replaceChildren(
    h('div.side-scroll.scroll', { 'data-scroll': 'sidebar' },
      h('div.side-section', smart),
      h('div.side-title', { onclick: () => toggle('lists') }, h('span.twisty' + (collapsed.lists ? '' : '.open'), '▸'), 'Lists',
        h('button.si-add', { title: 'Add list', onclick: (e) => { e.stopPropagation(); menu(e.currentTarget, [{ icon: '📋', label: 'New list', run: () => listEditor(null) }, { icon: '📝', label: 'New note list', run: () => listEditor(null, 'note') }, { icon: '📁', label: 'New folder', run: newFolder }]); } }, '+')),
      collapsed.lists ? null : h('div.side-section', listsBlock, !T.lists().length ? h('button.side-hint', { onclick: () => listEditor(null) }, '+ Make your first list (each list grows a different material on your island)') : null),
      s.smart.filters !== false ? [h('div.side-title', { onclick: () => toggle('filters') }, h('span.twisty' + (collapsed.filters ? '' : '.open'), '▸'), 'Filters', h('button.si-add', { title: 'Add filter', onclick: (e) => { e.stopPropagation(); filterEditor(null); } }, '+')),
        collapsed.filters ? null : h('div.side-section', T.filtersList().map((f) => item('filter:' + f.id, '⚗️', f.name, count('filter:' + f.id), {}, (a) => menu(a, [{ label: 'Edit', run: () => filterEditor(f) }, { label: 'Delete', danger: true, run: () => remove(f.id) }]))), !T.filtersList().length ? h('div.side-hint.muted', 'Filters show tasks by rules, like "high priority + #school".') : null)] : null,
      s.smart.tags !== false ? [h('div.side-title', { onclick: () => toggle('tags') }, h('span.twisty' + (collapsed.tags ? '' : '.open'), '▸'), 'Tags', h('button.si-add', { title: 'Add tag', onclick: async (e) => { e.stopPropagation(); const n = await promptBox('New tag (use a/b for nested tags)'); if (n) T.ensureTag(n); } }, '+')),
        collapsed.tags ? null : h('div.side-section', tagTree(null))] : null,
      h('div.side-section.bottom', T.SMART_BOTTOM.filter((x) => s.smart[x.key] !== false).map((x) => item(x.key, x.icon, x.name, null)),
        s.smart.summary !== false ? h('a.side-item' + (location.hash === '#/summary' ? '.on' : ''), { href: '#/summary' }, h('span.si-icon', '📜'), h('span.si-name', 'Summary')) : null,
        T.lists({ archived: true }).length ? h('div', h('div.side-title', { onclick: () => toggle('archived') }, h('span.twisty' + (collapsed.archived === false ? '.open' : ''), '▸'), 'Archived lists'),
          collapsed.archived === false ? T.lists({ archived: true }).map(listItem) : null) : null)));
}

function listMenu(anchor, l) {
  const mine = l.owner === me();
  menu(anchor, [
    { icon: '✎', label: 'Edit', run: () => listEditor(l) },
    mine ? { icon: '👥', label: 'Share', run: () => shareDialog(l) } : null,
    { icon: '⧉', label: 'Duplicate', run: () => { const c = put({ ...structuredClone(l), id: undefined, createdAt: undefined, owner: undefined, name: l.name + ' copy' }); T.queryFor('list:' + l.id).filter((t) => !t.parentId).forEach((t) => moveDup(t, c.id)); } },
    { icon: '📁', label: 'Move to folder', sub: [{ label: 'No folder', run: () => patch(l.id, { folderId: null }) }, ...T.folders().map((f) => ({ label: f.name, active: l.folderId === f.id, run: () => patch(l.id, { folderId: f.id }) }))] },
    { icon: '↑', label: 'Move up', run: () => reorder(l, -1) }, { icon: '↓', label: 'Move down', run: () => reorder(l, 1) },
    { icon: '🗄', label: l.archived ? 'Unarchive' : 'Archive', run: () => patch(l.id, { archived: !l.archived }) },
    mine ? { icon: '🗑', label: 'Delete list', danger: true, run: () => deleteList(l) } : { icon: '🚪', label: 'Leave list', danger: true, run: async () => { await api('/api/unshare', { list: l.id }); await pull(); go('#/tasks/today'); } },
  ]);
}
function moveDup(t, listId) { const c = T.duplicate(t); patch(c.id, { listId }); T.descendants(c.id).forEach((d) => patch(d.id, { listId })); }
function reorder(l, dir) {
  const ls = T.lists().filter((x) => (x.folderId || null) === (l.folderId || null));
  ls.forEach((x, i) => { x.order = i; });
  const i = ls.findIndex((x) => x.id === l.id), j = i + dir;
  if (j < 0 || j >= ls.length) return;
  [ls[i].order, ls[j].order] = [j, i];
  ls.forEach((x) => put(x, { quiet: true })); put(l);
}
async function deleteList(l) {
  const n = T.queryFor('list:' + l.id).length;
  if (!(await confirmBox('Delete list?', `"${l.name}" and its ${plural(n, 'task')} will go to the Trash.`, 'Delete', true))) return;
  T.queryFor('list:' + l.id).forEach((t) => { patch(t.id, { listId: 'inbox' }); T.trash(t); });
  remove(l.id);
  go('#/tasks/inbox');
}
async function newFolder() { const n = await promptBox('New folder'); if (n) put({ kind: 'folder', name: n, order: T.folders().length }); }
function folderMenu(anchor, f) {
  menu(anchor, [
    { label: 'Rename', run: async () => { const n = await promptBox('Rename folder', f.name); if (n) patch(f.id, { name: n }); } },
    { label: 'Show all tasks in folder', run: () => go('#/tasks/folder:' + f.id) },
    { label: 'Ungroup (keep lists)', danger: true, run: () => { T.lists().filter((l) => l.folderId === f.id).forEach((l) => patch(l.id, { folderId: null })); remove(f.id); } },
  ]);
}
function tagMenu(anchor, g) {
  menu(anchor, [
    { label: 'Rename', run: async () => {
      const n = await promptBox('Rename tag', g.name); if (!n || n === g.name) return;
      const old = g.name;
      all('tag', (x) => x.name === old || x.name.startsWith(old + '/')).forEach((x) => patch(x.id, { name: n + x.name.slice(old.length), parent: x.parent ? (x.parent === old ? n : n + x.parent.slice(old.length)) : x.id === g.id ? (n.includes('/') ? n.split('/').slice(0, -1).join('/') : null) : x.parent }));
      all('task', (t) => (t.tags || []).some((x) => x === old || x.startsWith(old + '/'))).forEach((t) => patch(t.id, { tags: t.tags.map((x) => (x === old || x.startsWith(old + '/') ? n + x.slice(old.length) : x)) }));
      go('#/tasks/tag:' + n);
    } },
    { label: 'Colour', sub: T.LIST_COLORS.map((c) => ({ icon: h('span.dot', { style: { background: c } }), label: c, run: () => patch(g.id, { color: c }) })) },
    { label: 'Merge into…', sub: T.tags().filter((x) => x.id !== g.id).map((x) => ({ label: x.name, run: () => { all('task', (t) => (t.tags || []).includes(g.name)).forEach((t) => patch(t.id, { tags: [...new Set(t.tags.map((y) => (y === g.name ? x.name : y)))] })); remove(g.id); } })) },
    { label: 'Delete tag', danger: true, run: () => { all('task', (t) => (t.tags || []).includes(g.name)).forEach((t) => patch(t.id, { tags: t.tags.filter((y) => y !== g.name) })); all('tag', (x) => x.parent === g.name).forEach((x) => patch(x.id, { parent: null })); remove(g.id); } },
  ]);
}

export function listEditor(l, type = 'task') {
  const isNew = !l;
  const d = l ? { ...l } : { kind: 'list', name: '', emoji: '', color: T.LIST_COLORS[T.lists().length % T.LIST_COLORS.length], type, resource: LIST_RES[T.lists().length % LIST_RES.length], folderId: null, sections: [] };
  const body = h('div.form');
  const render = () => body.replaceChildren(
    h('input.input', { placeholder: 'List name', value: d.name, 'data-keep': 'listname', oninput: (e) => { d.name = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') saveIt(); } }),
    h('div.d-label', 'Icon'),
    h('div.emoji-grid', h('button.chip' + (!d.emoji ? '.on' : ''), { onclick: () => { d.emoji = ''; render(); } }, 'none'), EMOJIS.map((e) => h('button.emoji' + (d.emoji === e ? '.on' : ''), { onclick: () => { d.emoji = e; render(); } }, e))),
    h('div.d-label', 'Colour'),
    h('div.color-row', T.LIST_COLORS.map((c) => h('button.swatch' + (d.color === c ? '.on' : ''), { style: { background: c }, onclick: () => { d.color = c; render(); }, 'aria-label': c }))),
    h('div.d-label', 'What it grows on your island'),
    h('div.res-pick', LIST_RES.map((r) => h('button.res-opt' + (d.resource === r ? '.on' : ''), { onclick: () => { d.resource = r; render(); } }, h('img', { src: resImg(r), alt: '' }), RES[r].name))),
    h('div.form-row', h('span', 'Type'), h('select.input.sm', { onchange: (e) => { d.type = e.target.value; } }, [['task', 'Task list'], ['note', 'Note list']].map(([v, n]) => h('option', { value: v, selected: (d.type || 'task') === v }, n)))),
    T.folders().length ? h('div.form-row', h('span', 'Folder'), h('select.input.sm', { onchange: (e) => { d.folderId = e.target.value || null; } }, h('option', { value: '' }, 'None'), T.folders().map((f) => h('option', { value: f.id, selected: d.folderId === f.id }, f.name)))) : null,
  );
  const saveIt = () => {
    if (!d.name.trim()) return toast('Give your list a name');
    d.name = d.name.trim();
    const saved = isNew ? put({ ...d, order: T.lists().length }) : patch(l.id, d);
    m.close();
    if (isNew) go('#/tasks/list:' + saved.id);
  };
  render();
  const m = modal(isNew ? (type === 'note' ? 'New note list' : 'New list') : 'Edit list', body, { actions: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), h('button.btn', { onclick: saveIt }, isNew ? 'Create' : 'Save')] });
}

export function shareDialog(l) {
  if (!store.user) return toast('Log in to share lists with friends.');
  const body = h('div.form');
  const render = (members) => body.replaceChildren(
    h('p.muted', 'People you add can see, add and finish tasks in this list. They need a Pocket Isle account.'),
    h('div.form-row', h('input.input', { placeholder: "Friend's email", type: 'email', id: 'shareEmail' }), h('button.btn', { onclick: async () => {
      const email = body.querySelector('#shareEmail').value.trim(); if (!email) return;
      try { await push(); const r = await api('/api/share', { list: l.id, email }); render(r.members); toast('Shared!'); pull(); } catch (e) { toast(e.message); }
    } }, 'Invite')),
    h('div.member-list', (members || []).map((m) => h('div.member', avatar(m.id, 28), h('div', h('b', m.name), h('div.muted.sm', m.email)), h('span.muted.sm', m.role),
      m.role !== 'owner' ? h('button.btn.ghost.sm', { onclick: async () => { const r = await api('/api/unshare', { list: l.id, user: m.id }); render(r.members); pull(); } }, 'Remove') : null))));
  render(store.members[l.id] || []);
  api('/api/members?list=' + encodeURIComponent(l.id)).then((r) => render(r.members)).catch(() => {});
  const m = modal(`Share "${l.name}"`, body, { actions: [h('button.btn', { onclick: () => m.close() }, 'Done')] });
}

export function filterEditor(f) {
  const isNew = !f;
  const d = f ? structuredClone(f) : { kind: 'filter', name: '', rules: { match: 'all', lists: [], tags: [], priority: [], date: [], keyword: '', status: 'open', type: 'all' } };
  const r = d.rules;
  const multi = (arr, val) => { const i = arr.indexOf(val); i >= 0 ? arr.splice(i, 1) : arr.push(val); };
  const body = h('div.form');
  const chipSet = (label, options, arr) => h('div', h('div.d-label', label), h('div.chips', options.map(([v, n]) => h('button.chip' + (arr.includes(v) ? '.on' : ''), { onclick: () => { multi(arr, v); render(); } }, n))));
  const render = () => body.replaceChildren(
    h('input.input', { placeholder: 'Filter name', value: d.name, 'data-keep': 'filtername', oninput: (e) => { d.name = e.target.value; } }),
    chipSet('Lists', [T.INBOX, ...T.lists()].map((l) => [l.id, `${l.emoji || ''} ${l.name}`]), r.lists),
    chipSet('Tags', [...T.tags().map((g) => [g.name, '#' + g.name]), ['__none', 'No tag']], r.tags),
    chipSet('Date', T.DATE_RULES, r.date = [].concat(r.date || [])),
    chipSet('Priority', T.PRIORITIES.map((p) => [p.v, p.name]), r.priority),
    h('div.form-row', h('span', 'Contains words'), h('input.input.sm', { value: r.keyword || '', oninput: (e) => { r.keyword = e.target.value; } })),
    h('div.form-row', h('span', 'Show'), h('select.input.sm', { onchange: (e) => { r.status = e.target.value; } }, [['open', 'Unfinished tasks'], ['done', 'Finished tasks'], ['any', 'Everything']].map(([v, n]) => h('option', { value: v, selected: r.status === v }, n))),
      h('select.input.sm', { onchange: (e) => { r.assignee = e.target.value; } }, [['', 'Anyone'], ['me', 'Assigned to me'], ['none', 'Not assigned']].map(([v, n]) => h('option', { value: v, selected: (r.assignee || '') === v }, n)))),
    h('div.form-row', h('span', 'Match'), h('select.input.sm', { onchange: (e) => { r.match = e.target.value; } }, [['all', 'All the rules'], ['any', 'Any rule']].map(([v, n]) => h('option', { value: v, selected: r.match === v }, n)))),
    h('p.muted.sm', `${T.live().filter((t) => T.matchFilter(t, r)).length} tasks match right now.`),
  );
  render();
  const m = modal(isNew ? 'New filter' : 'Edit filter', body, { wide: true, actions: [
    !isNew ? h('button.btn.ghost.danger', { onclick: () => { remove(f.id); m.close(); go('#/tasks/today'); } }, 'Delete') : null,
    h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'),
    h('button.btn', { onclick: () => { if (!d.name.trim()) return toast('Name your filter'); const saved = isNew ? put(d) : patch(f.id, d); m.close(); go('#/tasks/filter:' + saved.id); } }, 'Save')] });
}
