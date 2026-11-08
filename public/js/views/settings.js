// Settings: account, look, defaults, notifications, island, calendars, data, templates.
import { h, toast, modal, confirmBox, promptBox, download, pickFile, readText, uid, today } from '../util.js';
import * as store from '../store.js';
import { all, put, patch, remove, settings, saveSettings, api } from '../store.js';
import * as T from '../tasks.js';
import { go } from '../ui.js';
import { refresh, exportICS } from '../ics.js';

const SECTIONS = [['account', 'Account'], ['look', 'Appearance'], ['general', 'Defaults'], ['smart', 'Smart lists'], ['notify', 'Reminders'], ['island', 'Island'], ['calendars', 'Calendars'], ['templates', 'Templates'], ['data', 'Import & export'], ['about', 'About']];
const THEMES = [['cream', 'Cream', '#f6efe2', '#6f9a6a'], ['sage', 'Sage', '#eef2e6', '#5f8c5a'], ['sky', 'Sky', '#e9f1f6', '#5b8fc0'], ['rose', 'Rose', '#f8ece9', '#c97b84'], ['lavender', 'Lavender', '#f0ecf6', '#8a76b8'], ['night', 'Night', '#1f2230', '#8fbf8a'], ['ocean', 'Ocean', '#18303a', '#7fd0c0']];

const sw = (val, on) => h('input.switch', { type: 'checkbox', checked: !!val, onchange: (e) => on(e.target.checked) });
const row = (label, ctrl, hint) => h('div.set-row', h('div', h('div', label), hint ? h('small.muted', hint) : null), ctrl);
const sel = (val, opts, on) => h('select.input.sm', { onchange: (e) => on(e.target.value) }, opts.map(([v, n]) => h('option', { value: v, selected: String(val) === String(v) }, n)));

export function render(main, key) {
  const sec = SECTIONS.some(([k]) => k === key) ? key : 'account';
  const s = settings();
  const body = ({ account, look, general, smart, notify, island, calendars, templates, data, about }[sec])(s);
  main.replaceChildren(
    h('div.view-head', h('h1', '⚙ Settings')),
    h('div.view-body.scroll', { 'data-scroll': 'settings' }, h('div.settings', h('nav.set-nav', SECTIONS.map(([k, n]) => h('a' + (k === sec ? '.on' : ''), { href: '#/settings/' + k }, n))), h('div', body))));
}

function account() {
  const u = store.store.user;
  if (!u) return h('div.set-card', h('h3', 'You are using Pocket Isle as a guest'), h('p.muted', 'Everything is saved on this device only. Make a free account to sync across your devices and share lists. Your current tasks and island come with you.'),
    h('button.btn', { onclick: () => { store.setGuestMode(false); location.hash = '#signup'; location.reload(); } }, 'Sign up or log in'));
  return [
    h('div.set-card', h('h3', 'Profile'),
      row('Name', h('input.input.sm', { value: u.name, onchange: async (e) => { try { const r = await api('/api/auth/update', { name: e.target.value }); store.store.user = r.user; toast('Saved'); } catch (x) { toast(x.message); } } })),
      row('Email', h('span.muted', u.email)),
      row('Sync', h('button.btn.ghost.sm', { onclick: () => store.push().then(store.pull).then(() => toast('Synced')) }, 'Sync now'), store.store.lastSync ? 'Last synced ' + new Date(store.store.lastSync).toLocaleTimeString() : '')),
    h('div.set-card', h('h3', 'Password'), (() => {
      const cur = h('input.input', { type: 'password', placeholder: 'Current password', autocomplete: 'current-password' });
      const nw = h('input.input', { type: 'password', placeholder: 'New password (8+ characters)', autocomplete: 'new-password' });
      return h('div.form', cur, nw, h('button.btn.sm', { onclick: async () => { try { await api('/api/auth/update', { password: cur.value, newPassword: nw.value }); cur.value = nw.value = ''; toast('Password changed'); } catch (x) { toast(x.message); } } }, 'Change password'));
    })()),
    h('div.set-card', h('h3', 'Leave'), row('Log out on this device', h('button.btn.ghost.sm', { onclick: async () => { await store.logout(); location.reload(); } }, 'Log out')),
      row('Delete account', h('button.btn.ghost.sm.danger', { onclick: async () => {
        const pw = await promptBox('Type your password to delete your account forever', '', 'Password');
        if (!pw || !(await confirmBox('Delete everything?', 'Your tasks, habits and island will be gone for good. Download a backup first if you want one.', 'Delete forever', true))) return;
        try { await api('/api/auth/delete', { password: pw }); localStorage.clear(); location.reload(); } catch (x) { toast(x.message); }
      } }, 'Delete account'), 'Removes all your data from the server.')),
  ];
}
function look(s) {
  return h('div.set-card', h('h3', 'Appearance'),
    h('div.theme-grid', THEMES.map(([k, n, bg, ac]) => h('button.theme-opt' + (s.theme === k ? '.on' : ''), { onclick: () => saveSettings({ theme: k }) }, h('i', { style: { background: `linear-gradient(135deg, ${bg} 60%, ${ac} 60%)` } }), n))),
    row('Follow device dark mode', sw(s.autoDark, (v) => saveSettings({ autoDark: v })), 'Uses Night when your device is in dark mode.'),
    row('Text size', sel(s.fontSize, [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']], (v) => saveSettings({ fontSize: v }))),
    row('24-hour clock', sw(s.clock24, (v) => saveSettings({ clock24: v }))),
    row('Week starts on', sel(s.weekStart, [[1, 'Monday'], [0, 'Sunday'], [6, 'Saturday']], (v) => saveSettings({ weekStart: Number(v) }))),
    row('Show task details in lists', sw(s.showDetails, (v) => saveSettings({ showDetails: v })), 'Notes, checklist progress and tags under each task.'));
}
function general(s) {
  return h('div.set-card', h('h3', 'New task defaults'),
    row('Default list', sel(s.defaultList, [T.INBOX, ...T.lists()].map((l) => [l.id, l.name]), (v) => saveSettings({ defaultList: v }))),
    row('Default date', sel(s.defaultDue, [['none', 'No date'], ['today', 'Today'], ['tomorrow', 'Tomorrow']], (v) => saveSettings({ defaultDue: v }))),
    row('Default priority', sel(s.defaultPriority, T.PRIORITIES.map((p) => [p.v, p.name]), (v) => saveSettings({ defaultPriority: Number(v) }))),
    row('Default reminder (timed tasks)', sel(s.defaultReminder, [['', 'None'], ...T.REMINDERS_TIMED.map((r) => [r, T.reminderLabel(r)])], (v) => saveSettings({ defaultReminder: v }))),
    row('Default reminder (all-day tasks)', sel(s.defaultAllDayReminder, [['', 'None'], ...T.REMINDERS_ALLDAY.map((r) => [r, T.reminderLabel(r, false)])], (v) => saveSettings({ defaultAllDayReminder: v }))),
    row('Completed tasks go to the bottom', sw(s.completedAtBottom, (v) => saveSettings({ completedAtBottom: v }))),
    row('Sound when finishing tasks', sw(s.sound, (v) => saveSettings({ sound: v }))));
}
function smart(s) {
  const all2 = [...T.SMART, ...T.SMART_BOTTOM, { key: 'summary', name: 'Summary' }, { key: 'tags', name: 'Tags section' }, { key: 'filters', name: 'Filters section' }];
  return h('div.set-card', h('h3', 'Show in sidebar'), all2.map((x) => row(x.name, sw(s.smart[x.key] !== false, (v) => saveSettings({ smart: { ...s.smart, [x.key]: v } })))));
}
function notify(s) {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  return h('div.set-card', h('h3', 'Reminders & notifications'),
    row('Desktop / phone notifications', sw(s.notifications && perm === 'granted', async (v) => { if (v && perm !== 'granted') { const p = await Notification.requestPermission(); if (p !== 'granted') return toast('Notifications were blocked in your browser settings.'); } saveSettings({ notifications: v }); }),
      perm === 'unsupported' ? "This browser can't show notifications. In-app reminders still work." : 'Reminders pop up while Pocket Isle is open in a tab.'),
    row('Reminder sound', sw(s.sound, (v) => saveSettings({ sound: v }))),
    row('Daily planning reminder', h('input.input.sm', { type: 'time', value: s.planReminder || '', onchange: (e) => saveSettings({ planReminder: e.target.value }) }), 'Nudges you to look at Today.'),
    row('Daily review reminder', h('input.input.sm', { type: 'time', value: s.reviewReminder || '', onchange: (e) => saveSettings({ reviewReminder: e.target.value }) }), 'Shows what you finished today.'),
    row('Test it', h('button.btn.ghost.sm', { onclick: () => { toast('⏰ This is what a reminder looks like'); if (s.notifications && perm === 'granted') navigator.serviceWorker?.ready.then((r) => r.showNotification('Pocket Isle', { body: 'Reminders are working!', icon: 'assets/icon-192.png' })); } }, 'Send test')));
}
function island(s) {
  return h('div.set-card', h('h3', 'Island'),
    row('Overdue tasks grow weeds', sw(s.showWeeds, (v) => saveSettings({ showWeeds: v })), 'Turn off if you would rather not see them.'),
    row('Neighbours wander around', sw(s.critterWander, (v) => saveSettings({ critterWander: v }))),
    row('Start the island over', h('button.btn.ghost.sm.danger', { onclick: async () => { if (await confirmBox('Reset island?', 'Buildings, materials and neighbours will be cleared. Your tasks and habits stay.', 'Reset', true)) { const v = store.village(); Object.assign(v, { inv: { wood: 2, stone: 1, petals: 1 }, buildings: [], critters: {}, log: [], counters: {} }); store.saveVillage(); toast('A fresh island!'); } } }, 'Reset island')));
}
function calendars() {
  const cals = all('calendar');
  const url = h('input.input', { placeholder: 'Paste a calendar link (.ics or webcal://)' });
  return [h('div.set-card', h('h3', 'Subscribed calendars'), h('p.muted.sm', 'Show Google, Apple or Outlook calendars inside Pocket Isle. In Google Calendar: Settings → your calendar → "Secret address in iCal format".'),
    h('div.form-row', url, h('button.btn.sm', { onclick: async () => {
      const u = url.value.trim(); if (!u) return;
      if (!store.store.user) return toast('Log in to subscribe to calendar links (or import a .ics file below).');
      const c = put({ kind: 'calendar', name: 'Calendar', url: u, color: T.LIST_COLORS[cals.length % T.LIST_COLORS.length] });
      try { const n = await refresh(c, true); toast(`Added: ${n} events`); url.value = ''; const nm = await promptBox('Name this calendar', 'Calendar'); if (nm) patch(c.id, { name: nm }); } catch (x) { remove(c.id); toast(x.message); }
    } }, 'Subscribe')),
    h('button.btn.ghost.sm', { onclick: async () => { const f = await pickFile('.ics,text/calendar'); if (!f) return; const text = await readText(f); if (!text.includes('BEGIN:VCALENDAR')) return toast("That isn't a calendar file."); const c = put({ kind: 'calendar', name: f.name.replace(/\.ics$/i, ''), text, color: '#c9a0dc' }); refresh(c); toast('Calendar imported'); } }, 'Import .ics file'),
    cals.map((c) => row(h('span', h('span.dot', { style: { background: c.color } }), ' ', c.name), h('span.row', sw(!c.hidden, (v) => patch(c.id, { hidden: !v })), h('button.btn.ghost.sm', { onclick: async () => { const n = await promptBox('Rename', c.name); if (n) patch(c.id, { name: n }); } }, 'Rename'), h('button.btn.ghost.sm', { onclick: () => refresh(c, true).then(() => toast('Refreshed')).catch((x) => toast(x.message)) }, 'Refresh'), h('button.btn.ghost.sm.danger', { onclick: () => remove(c.id) }, 'Remove')), c.url ? c.url.slice(0, 60) + '…' : 'Imported file'))),
  h('div.set-card', h('h3', 'Export to other calendars'), h('p.muted.sm', 'Download your dated tasks as a .ics file you can import into Google, Apple or Outlook Calendar.'),
    h('button.btn.ghost.sm', { onclick: () => download('pocket-isle-tasks.ics', exportICS(T.live().filter(T.isOpen)), 'text/calendar') }, 'Download .ics'))];
}
function templates() {
  const ts = T.templates();
  return h('div.set-card', h('h3', 'Task templates'), h('p.muted.sm', 'Save any task as a template from its ⋯ menu. Use templates from the ★ button next to the add box.'),
    !ts.length ? h('p.muted', 'No templates yet.') : ts.map((t) => row(t.name, h('span.row', h('button.btn.ghost.sm', { onclick: async () => { const n = await promptBox('Rename template', t.name); if (n) patch(t.id, { name: n }); } }, 'Rename'), h('button.btn.ghost.sm.danger', { onclick: () => remove(t.id) }, 'Delete')), `${(t.task?.items || []).length} checklist items · ${(t.kids || []).length} subtasks`)));
}

function parseCSV(text) {
  const rows = []; let cur = [''], q = false, row2 = cur;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { row2[row2.length - 1] += '"'; i++; } else q = false; } else row2[row2.length - 1] += c; }
    else if (c === '"') q = true; else if (c === ',') row2.push(''); else if (c === '\n') { rows.push(row2); row2 = ['']; } else if (c !== '\r') row2[row2.length - 1] += c;
  }
  if (row2.length > 1 || row2[0]) rows.push(row2);
  return rows;
}
const ttDate = (s, allDay) => { if (!s) return null; const d = new Date(s.replace(/(\+\d{2})(\d{2})$/, '$1:$2')); if (isNaN(d)) return null; const p = (n) => String(n).padStart(2, '0'); const ymd = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; return allDay ? ymd : `${ymd}T${p(d.getHours())}:${p(d.getMinutes())}`; };
export function importTickTick(text) {
  const rows = parseCSV(text);
  const hi = rows.findIndex((r) => r.includes('Title') && r.includes('List Name'));
  if (hi < 0) throw new Error("That doesn't look like a TickTick backup (.csv).");
  const H = rows[hi], col = (r, n) => r[H.indexOf(n)] || '';
  const listIds = new Map(), folderIds = new Map(), idMap = new Map(), parents = [];
  let n = 0;
  for (const r of rows.slice(hi + 1)) {
    if (r.length < 4 || !col(r, 'Title')) continue;
    const ln = col(r, 'List Name') || 'Inbox';
    let listId = 'inbox';
    if (ln.toLowerCase() !== 'inbox') {
      if (!listIds.has(ln)) {
        const fn = col(r, 'Folder Name'); let folderId = null;
        if (fn) { if (!folderIds.has(fn)) folderIds.set(fn, (T.folders().find((f) => f.name === fn) || put({ kind: 'folder', name: fn })).id); folderId = folderIds.get(fn); }
        listIds.set(ln, (T.lists().find((l) => l.name === ln) || put({ kind: 'list', name: ln, color: T.LIST_COLORS[listIds.size % T.LIST_COLORS.length], resource: ['wood', 'stone', 'petals', 'fish', 'clay', 'wool'][listIds.size % 6], folderId, type: col(r, 'Kind') === 'NOTE' ? 'note' : 'task', sections: [] })).id);
      }
      listId = listIds.get(ln);
    }
    const allDay = col(r, 'Is All Day') !== 'false';
    const status = Number(col(r, 'Status') || 0);
    const content = col(r, 'Content');
    const isCheck = col(r, 'Is Check list') === 'Y';
    const t = put({ kind: 'task', title: col(r, 'Title'), listId, content: isCheck ? '' : content, items: isCheck ? content.split('\n').filter(Boolean).map((x) => ({ id: uid(), title: x.replace(/^[▪◦\-\s]*/, '').replace(/^\[.\]\s*/, ''), done: /^\s*▪|\[x\]/i.test(x) })) : [],
      tags: col(r, 'Tags').split(',').map((x) => x.trim()).filter(Boolean).map(T.ensureTag), priority: Number(col(r, 'Priority') || 0),
      due: ttDate(col(r, 'Due Date'), allDay), start: col(r, 'Start Date') && col(r, 'Start Date') !== col(r, 'Due Date') ? ttDate(col(r, 'Start Date'), allDay) : null,
      status: status === -1 ? -1 : status > 0 ? 2 : 0, completedAt: status ? new Date(col(r, 'Completed Time') || Date.now()).getTime() || Date.now() : null,
      reminders: [], tags2: undefined, order: Number(col(r, 'Order')) || 0, importedRepeat: col(r, 'Repeat') || undefined }, { quiet: true });
    idMap.set(col(r, 'taskId'), t.id); if (col(r, 'parentId')) parents.push([t.id, col(r, 'parentId')]);
    n++;
  }
  for (const [id, p] of parents) if (idMap.has(p)) patch(id, { parentId: idMap.get(p) }, { quiet: true });
  store.emit();
  return n;
}
function data() {
  return [h('div.set-card', h('h3', 'Backup'),
    row('Download a backup', h('button.btn.ghost.sm', { onclick: () => download(`pocket-isle-backup-${today()}.json`, store.exportAll()) }, 'Download'), 'Everything: tasks, lists, habits, focus, island.'),
    row('Restore a backup', h('button.btn.ghost.sm', { onclick: async () => { const f = await pickFile('.json,application/json'); if (!f) return; try { const replace = await confirmBox('Restore backup', 'Replace everything with the backup? Choose Cancel to merge it with what you have now.', 'Replace'); toast(`Restored ${store.importAll(await readText(f), { replace })} items`); } catch (x) { toast(x.message); } } }, 'Choose file'))),
  h('div.set-card', h('h3', 'Bring your tasks from TickTick'), h('p.muted.sm', 'In TickTick: Settings → Account → Generate Backup. Then choose that .csv file here. Lists, folders, tags, dates, priorities, checklists, subtasks and finished tasks come across.'),
    h('button.btn.sm', { onclick: async () => { const f = await pickFile('.csv,text/csv'); if (!f) return; try { toast(`Imported ${importTickTick(await readText(f))} tasks from TickTick`); } catch (x) { toast(x.message); } } }, 'Import TickTick .csv')),
  h('div.set-card', h('h3', 'Export'),
    row('Tasks as spreadsheet (.csv)', h('button.btn.ghost.sm', { onclick: () => {
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['List', 'Title', 'Content', 'Tags', 'Priority', 'Start', 'Due', 'Status', 'Completed', 'Created'].map(q).join(',')];
      for (const t of all('task', (t) => !t.trashedAt)) lines.push([T.listById(t.listId).name, t.title, t.content, (t.tags || []).join(', '), T.prioName(t.priority || 0), t.start, t.due, T.isOpen(t) ? 'Open' : T.isWontDo(t) ? "Won't do" : 'Done', t.completedAt ? new Date(t.completedAt).toISOString() : '', new Date(t.createdAt).toISOString()].map(q).join(','));
      download(`pocket-isle-tasks-${today()}.csv`, lines.join('\n'), 'text/csv');
    } }, 'Download')),
    row('Tasks as plain text', h('button.btn.ghost.sm', { onclick: () => download(`pocket-isle-tasks-${today()}.txt`, [T.INBOX, ...T.lists()].map((l) => `${l.name}\n` + T.queryFor(l.id === 'inbox' ? 'inbox' : 'list:' + l.id).filter(T.isOpen).map((t) => `  [ ] ${t.title}${t.due ? ' (' + t.due + ')' : ''}`).join('\n')).join('\n\n'), 'text/plain') }, 'Download')))];
}
function about() {
  return h('div.set-card', h('h3', 'About Pocket Isle'), h('p', 'A planner where finished tasks build a little island village. No points or levels, just a world that grows with you.'),
    h('p.muted.sm', 'Ambient sounds are real recordings from Wikimedia Commons (see audio/CREDITS.txt). Art is hand-painted in a watercolor storybook style.'),
    h('button.btn.ghost.sm', { onclick: () => { saveSettings({ welcomed: false }); location.reload(); } }, 'Show the welcome again'));
}
