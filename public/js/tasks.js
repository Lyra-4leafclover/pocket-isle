// Task model: queries, smart lists, filters, repeats, quick-add parsing, reminders.
import { all, get, put, patch, store, settings, me } from './store.js';
import { today, ymd, parseD, dayOf, hasTime, timeOf, addDays, addDaysStr, addMonths, diffDays, startOfWeek, DOW, MONTHS, MONTHS_LONG, DOW_LONG, daysInMonth, uid, fmtTime } from './util.js';
import * as game from './game.js';

export const PRIORITIES = [
  { v: 5, name: 'High', color: 'var(--p-high)' },
  { v: 3, name: 'Medium', color: 'var(--p-med)' },
  { v: 1, name: 'Low', color: 'var(--p-low)' },
  { v: 0, name: 'None', color: 'var(--p-none)' },
];
export const prioName = (v) => PRIORITIES.find((p) => p.v === v)?.name || 'None';
export const LIST_COLORS = ['#e9a6a6', '#f2c38f', '#ecd98b', '#a9cf9f', '#8fc6c2', '#9db8e3', '#b9a7e0', '#e2a8cf', '#c8b29a', '#a3a3a3'];

export const INBOX = { id: 'inbox', kind: 'list', name: 'Inbox', emoji: '📥', color: '#9db8e3', resource: 'wood', virtual: true };
export function lists({ archived = false } = {}) {
  return all('list', (l) => !!l.archived === archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt);
}
export const listById = (id) => (!id || id === 'inbox' ? INBOX : get(id) || INBOX);
export const folders = () => all('folder').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const tags = () => all('tag').sort((a, b) => a.name.localeCompare(b.name));
export const tagByName = (n) => all('tag').find((t) => t.name.toLowerCase() === String(n).toLowerCase());
export function ensureTag(name) {
  name = name.replace(/^#/, '').trim();
  if (!name) return null;
  const t = tagByName(name);
  if (t) return t.name;
  const parent = name.includes('/') ? name.split('/').slice(0, -1).join('/') : null;
  if (parent) ensureTag(parent);
  put({ kind: 'tag', name, color: LIST_COLORS[all('tag').length % LIST_COLORS.length], parent });
  return name;
}
export const isNoteList = (l) => l && l.type === 'note';

// ---------- task basics ----------
export const isOpen = (t) => !t.status;
export const isDone = (t) => t.status === 2;
export const isWontDo = (t) => t.status === -1;
export const inTrash = (t) => !!t.trashedAt;
export const live = () => all('task', (t) => !t.trashedAt);
export const dueOf = (t) => t.due || null;
export const children = (id) => all('task', (t) => t.parentId === id && !t.trashedAt).sort(byOrder);
export function descendants(id) { const out = []; for (const c of children(id)) out.push(c, ...descendants(c.id)); return out; }
export const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt;
export function isOverdue(t) {
  if (!isOpen(t) || !t.due) return false;
  if (hasTime(t.due)) return parseD(t.due) < new Date();
  return dayOf(t.due) < today();
}
export const daysOverdue = (t) => (isOverdue(t) ? Math.max(0, diffDays(today(), t.due)) : 0);
export function depth(t) { let d = 0, p = t; while (p && p.parentId && d < 8) { p = get(p.parentId); d++; } return d; }

export function newTask(fields = {}) {
  const s = settings();
  const t = {
    kind: 'task', title: '', content: '', listId: s.defaultList && (s.defaultList === 'inbox' || get(s.defaultList)) ? s.defaultList : 'inbox',
    priority: s.defaultPriority || 0, tags: [], items: [], status: 0, order: -Date.now(), reminders: [], attachments: [],
    ...fields,
  };
  if (t.due === undefined) {
    if (s.defaultDue === 'today') t.due = today();
    else if (s.defaultDue === 'tomorrow') t.due = ymd(addDays(today(), 1));
  }
  if (t.due && !t.reminders.length && !fields.reminders) {
    const r = hasTime(t.due) ? s.defaultReminder : s.defaultAllDayReminder;
    if (r && r !== 'none') t.reminders = [r];
  }
  t.history = [{ at: Date.now(), what: 'created', by: me() }];
  return put(t);
}

export function logHistory(t, what) {
  t.history = (t.history || []).slice(-40);
  t.history.push({ at: Date.now(), what, by: me() });
}

// ---------- completing ----------
export function toggleDone(t) { return isDone(t) ? uncomplete(t) : complete(t); }

export function complete(t, { when = Date.now() } = {}) {
  if (isDone(t)) return {};
  const next = t.repeat && t.due ? nextOccurrence(t) : null;
  if (next) {
    // keep a finished copy of this occurrence, move the task itself to its next date
    const copy = put({ ...structuredClone(t), id: undefined, createdAt: undefined, repeat: null, repeatOf: t.id, status: 2, completedAt: when, history: [...(t.history || []), { at: when, what: 'completed', by: me() }] });
    game.onComplete(copy);
    const shift = diffDays(next, t.due);
    const fields = { due: shiftKeepTime(t.due, next), items: (t.items || []).map((i) => ({ ...i, done: false })), repeat: { ...t.repeat, done: (t.repeat.done || 0) + 1 }, postponed: 0 };
    if (t.start) fields.start = addDaysStr(t.start, shift);
    for (const c of children(t.id)) patch(c.id, { status: 0, completedAt: null });
    patch(t.id, fields);
    return { copy, next };
  }
  logHistory(t, 'completed');
  patch(t.id, { status: 2, completedAt: when });
  for (const c of children(t.id)) if (isOpen(c)) { c.completedAt = when; c.status = 2; put(c, { quiet: true }); }
  game.onComplete(t);
  return {};
}
export function uncomplete(t) {
  logHistory(t, 'reopened');
  game.onUncomplete(t);
  patch(t.id, { status: 0, completedAt: null });
}
export function wontDo(t) {
  logHistory(t, "marked won't do");
  patch(t.id, { status: -1, completedAt: Date.now() });
}
export function trash(t) {
  const when = Date.now();
  for (const x of [t, ...descendants(t.id)]) patch(x.id, { trashedAt: when });
}
export function restore(t) {
  for (const x of [t, ...all('task', (c) => c.parentId === t.id)]) patch(x.id, { trashedAt: null });
  if (t.parentId && !get(t.parentId)) patch(t.id, { parentId: null });
}
export function purge(t) { for (const x of [t, ...all('task', (c) => c.parentId === t.id)]) { x._deleted = true; put(x, { quiet: true }); } put(t); }

export function setDue(t, due, { keepTime = true } = {}) {
  const f = {};
  if (!due) { f.due = null; f.start = null; f.reminders = []; }
  else {
    f.due = keepTime && t.due && hasTime(t.due) && !hasTime(due) ? `${due}T${timeOf(t.due)}` : due;
    if (t.start) f.start = addDaysStr(t.start, diffDays(f.due, t.due || f.due));
    if (t.due && dayOf(t.due) < dayOf(f.due) && isOpen(t)) f.postponed = (t.postponed || 0) + 1;
    if (!t.due && !(t.reminders || []).length) { const s = settings(); const r = hasTime(f.due) ? s.defaultReminder : s.defaultAllDayReminder; f.reminders = r && r !== 'none' ? [r] : []; }
  }
  return patch(t.id, f);
}
const shiftKeepTime = (old, newDay) => (hasTime(old) ? `${newDay}T${timeOf(old)}` : newDay);

export function duplicate(t, { parentId = t.parentId } = {}) {
  const c = put({ ...structuredClone(t), id: undefined, createdAt: undefined, title: t.title, status: 0, completedAt: null, order: (t.order ?? 0) + 0.5, parentId, loot: null, history: [{ at: Date.now(), what: 'created', by: me() }] });
  for (const ch of children(t.id)) duplicate(ch, { parentId: c.id });
  return c;
}

// ---------- repeats ----------
// repeat = {freq:'day'|'week'|'month'|'year', interval, byDay:[0..6], monthMode:'date'|'nth'|'last', workdays, fromCompletion, until, count, done}
export function nextOccurrence(t, from) {
  const r = t.repeat; if (!r) return null;
  const base = r.fromCompletion ? today() : dayOf(from || t.due);
  let d = nextAfter(r, base, dayOf(t.due));
  if (r.fromCompletion && r.freq !== 'week') d = nextAfter(r, today(), today());
  if (r.until && d > r.until) return null;
  if (r.count && (r.done || 0) + 1 >= r.count) return null;
  return d;
}
function nextAfter(r, base, anchor) {
  const n = Math.max(1, r.interval || 1);
  const a = parseD(anchor);
  if (r.freq === 'day') {
    let d = addDays(base, n);
    if (r.workdays) while (d.getDay() === 0 || d.getDay() === 6) d = addDays(ymd(d), 1);
    return ymd(d);
  }
  if (r.freq === 'week') {
    const days = (r.byDay && r.byDay.length ? r.byDay : [a.getDay()]).slice().sort();
    let d = addDays(base, 1);
    const ws = startOfWeek(anchor, 0);
    for (let i = 0; i < 7 * n * 2 + 7; i++) {
      const weeks = Math.floor(diffDays(ymd(startOfWeek(ymd(d), 0)), ymd(ws)) / 7);
      if (weeks % n === 0 && days.includes(d.getDay())) return ymd(d);
      d = addDays(ymd(d), 1);
    }
    return ymd(addDays(base, 7 * n));
  }
  if (r.freq === 'month') {
    if (r.monthMode === 'nth' || r.monthMode === 'last') {
      const wd = a.getDay(); const nth = Math.ceil(a.getDate() / 7);
      let m = parseD(base); m.setDate(1);
      for (let i = 0; i < 40; i++) {
        m = addMonths(ymd(m), i === 0 ? 0 : n); m.setDate(1);
        const cand = r.monthMode === 'last' ? lastWeekday(m.getFullYear(), m.getMonth(), wd) : nthWeekday(m.getFullYear(), m.getMonth(), wd, nth);
        if (cand && ymd(cand) > base) return ymd(cand);
      }
    }
    const want = r.monthDay || a.getDate();
    let m = parseD(base); m.setDate(1);
    for (let i = 0; i < 30; i++) {
      const y = m.getFullYear(), mo = m.getMonth();
      const cand = new Date(y, mo, Math.min(want, daysInMonth(y, mo)));
      if (ymd(cand) > base && (i === 0 || true)) return ymd(cand);
      m = new Date(y, mo + n, 1);
    }
  }
  if (r.freq === 'year') {
    let y = parseD(base).getFullYear();
    for (let i = 0; i < 10; i++) {
      const cand = new Date(y, a.getMonth(), Math.min(a.getDate(), daysInMonth(y, a.getMonth())));
      if (ymd(cand) > base) return ymd(cand);
      y += n;
    }
  }
  return ymd(addDays(base, 1));
}
function nthWeekday(y, m, wd, nth) {
  const first = new Date(y, m, 1); const off = (wd - first.getDay() + 7) % 7;
  const d = 1 + off + (nth - 1) * 7;
  return d <= daysInMonth(y, m) ? new Date(y, m, d) : null;
}
function lastWeekday(y, m, wd) { const last = new Date(y, m, daysInMonth(y, m)); last.setDate(last.getDate() - ((last.getDay() - wd + 7) % 7)); return last; }

// All occurrence days of a repeating task between two days (for calendar display)
export function occurrences(t, from, to, max = 60) {
  if (!t.due) return [];
  const out = [];
  let d = dayOf(t.due);
  if (d >= from && d <= to) out.push(d);
  if (!t.repeat || !isOpen(t)) return out;
  let count = (t.repeat.done || 0);
  for (let i = 0; i < 400 && out.length < max; i++) {
    d = nextAfter(t.repeat, d, dayOf(t.due));
    count++;
    if (d > to) break;
    if (t.repeat.until && d > t.repeat.until) break;
    if (t.repeat.count && count >= t.repeat.count) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export function repeatText(r, due) {
  if (!r) return '';
  const n = r.interval || 1;
  let s = '';
  if (r.freq === 'day') s = r.workdays ? 'Every weekday' : n === 1 ? 'Daily' : `Every ${n} days`;
  if (r.freq === 'week') {
    const days = (r.byDay || []).slice().sort();
    const names = days.length ? days.map((d) => DOW[d]).join(', ') : '';
    s = (n === 1 ? 'Weekly' : `Every ${n} weeks`) + (names ? ` on ${names}` : '');
    if (days.length === 5 && !days.includes(0) && !days.includes(6) && n === 1) s = 'Every weekday';
  }
  if (r.freq === 'month') {
    const a = due ? parseD(due) : new Date();
    const on = r.monthMode === 'nth' ? `the ${['1st', '2nd', '3rd', '4th', '5th'][Math.ceil(a.getDate() / 7) - 1]} ${DOW_LONG[a.getDay()]}` : r.monthMode === 'last' ? `the last ${DOW_LONG[a.getDay()]}` : `day ${r.monthDay || a.getDate()}`;
    s = (n === 1 ? 'Monthly' : `Every ${n} months`) + ` on ${on}`;
  }
  if (r.freq === 'year') s = n === 1 ? 'Yearly' : `Every ${n} years`;
  if (r.fromCompletion) s += ' (after done)';
  if (r.until) s += ` until ${r.until}`;
  if (r.count) s += `, ${r.count} times`;
  return s;
}

// ---------- smart lists + filters ----------
export const SMART = [
  { key: 'today', name: 'Today', icon: '☀️' },
  { key: 'tomorrow', name: 'Tomorrow', icon: '🌤️' },
  { key: 'week', name: 'Next 7 Days', icon: '🗓️' },
  { key: 'all', name: 'All', icon: '🗂️' },
  { key: 'assigned', name: 'Assigned to Me', icon: '🙋' },
  { key: 'inbox', name: 'Inbox', icon: '📥' },
];
export const SMART_BOTTOM = [
  { key: 'completed', name: 'Completed', icon: '✅' },
  { key: 'wontdo', name: "Won't Do", icon: '🚫' },
  { key: 'trash', name: 'Trash', icon: '🗑️' },
];

export function inDayRange(t, a, b) {
  if (!t.due) return false;
  const s = dayOf(t.start || t.due), e = dayOf(t.due);
  return e >= a && s <= b;
}

export function queryFor(key) {
  const [type, arg] = key.includes(':') ? [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)] : [key, null];
  const T = today();
  const top = (t) => !t.trashedAt && !isNoteList(listById(t.listId));
  const openTop = (t) => top(t) && (isOpen(t) || isDoneOrClosed(t));
  switch (type) {
    case 'today': return live().filter((t) => top(t) && ((isOpen(t) && t.due && dayOf(t.due) <= T) || (!isOpen(t) && t.completedAt && ymd(new Date(t.completedAt)) === T && t.due && dayOf(t.due) <= T)));
    case 'tomorrow': { const d = ymd(addDays(T, 1)); return live().filter((t) => top(t) && inDayRange(t, d, d) && (isOpen(t) || (t.completedAt && ymd(new Date(t.completedAt)) >= T))); }
    case 'week': { const e = ymd(addDays(T, 6)); return live().filter((t) => top(t) && ((isOpen(t) && t.due && dayOf(t.due) <= e) || (!isOpen(t) && t.completedAt && ymd(new Date(t.completedAt)) >= T && t.due && dayOf(t.due) <= e))); }
    case 'all': return live().filter((t) => top(t));
    case 'assigned': return live().filter((t) => t.assignee === me());
    case 'inbox': return live().filter((t) => (t.listId || 'inbox') === 'inbox' || !get(t.listId));
    case 'completed': return live().filter((t) => isDone(t));
    case 'wontdo': return live().filter((t) => isWontDo(t));
    case 'trash': return all('task', (t) => !!t.trashedAt);
    case 'list': return live().filter((t) => t.listId === arg);
    case 'folder': { const ids = lists().filter((l) => l.folderId === arg).map((l) => l.id); return live().filter((t) => ids.includes(t.listId)); }
    case 'tag': return live().filter((t) => top(t) && (t.tags || []).some((g) => g.toLowerCase() === arg.toLowerCase() || g.toLowerCase().startsWith(arg.toLowerCase() + '/')));
    case 'filter': { const f = get(arg); return f ? live().filter((t) => top(t) && matchFilter(t, f.rules)) : []; }
    case 'search': return live().filter((t) => matchText(t, arg));
  }
  return [];
}
const isDoneOrClosed = (t) => !isOpen(t);

export function titleFor(key) {
  const [type, arg] = key.includes(':') ? [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)] : [key, null];
  const s = [...SMART, ...SMART_BOTTOM].find((x) => x.key === type);
  if (s) return s.name;
  if (type === 'list') return listById(arg).name;
  if (type === 'folder') return get(arg)?.name || 'Folder';
  if (type === 'tag') return '#' + arg;
  if (type === 'filter') return get(arg)?.name || 'Filter';
  if (type === 'search') return `Search: ${arg}`;
  return 'Tasks';
}

export function matchText(t, q) {
  q = String(q || '').toLowerCase().trim();
  if (!q) return false;
  const hay = [t.title, t.content, ...(t.items || []).map((i) => i.title), ...(t.tags || []), ...all('comment', (c) => c.taskId === t.id).map((c) => c.text)].join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

// rules = {match:'all'|'any', lists:[], tags:[], priority:[], date:'', keyword:'', type:'all'|'task'|'note', assignee:''}
export function matchFilter(t, r = {}) {
  const checks = [];
  if (r.lists?.length) checks.push(r.lists.includes(t.listId || 'inbox'));
  if (r.tags?.length) checks.push(r.tags.some((g) => (g === '__none' ? !(t.tags || []).length : (t.tags || []).some((x) => x.toLowerCase() === g.toLowerCase() || x.toLowerCase().startsWith(g.toLowerCase() + '/')))));
  if (r.priority?.length) checks.push(r.priority.includes(t.priority || 0));
  if (r.date?.length) checks.push([].concat(r.date).some((d) => matchDate(t, d)));
  if (r.keyword) checks.push(matchText(t, r.keyword));
  if (r.assignee) checks.push(r.assignee === 'me' ? t.assignee === me() : r.assignee === 'none' ? !t.assignee : !!t.assignee);
  if (r.type && r.type !== 'all') checks.push(r.type === 'note' ? isNoteList(listById(t.listId)) : !isNoteList(listById(t.listId)));
  const status = r.status || 'open';
  const statusOk = status === 'any' ? true : status === 'done' ? !isOpen(t) : isOpen(t);
  if (!checks.length) return statusOk;
  return statusOk && (r.match === 'any' ? checks.some(Boolean) : checks.every(Boolean));
}
export const DATE_RULES = [
  ['overdue', 'Overdue'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week'], ['next7', 'Next 7 days'], ['month', 'This month'], ['nodate', 'No date'], ['repeat', 'Repeating'],
];
function matchDate(t, d) {
  const T = today();
  if (d === 'nodate') return !t.due;
  if (d === 'repeat') return !!t.repeat;
  if (!t.due) return false;
  const day = dayOf(t.due);
  if (d === 'overdue') return isOverdue(t);
  if (d === 'today') return day === T;
  if (d === 'tomorrow') return day === ymd(addDays(T, 1));
  if (d === 'next7') return day >= T && day <= ymd(addDays(T, 6));
  if (d === 'week') { const s = startOfWeek(T, settings().weekStart); return day >= ymd(s) && day <= ymd(addDays(ymd(s), 6)); }
  if (d === 'month') return day.slice(0, 7) === T.slice(0, 7);
  return false;
}

// ---------- sorting + grouping ----------
export const SORTS = [['custom', 'Custom order'], ['date', 'Date'], ['priority', 'Priority'], ['title', 'Title'], ['created', 'Created'], ['tag', 'Tag']];
export const GROUPS = [['none', 'None'], ['list', 'List'], ['date', 'Date'], ['priority', 'Priority'], ['tag', 'Tag']];
export function sortTasks(arr, sort = 'custom') {
  const pin = (t) => (t.pinned ? 0 : 1);
  const cmp = {
    custom: byOrder,
    date: (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (b.priority || 0) - (a.priority || 0),
    priority: (a, b) => (b.priority || 0) - (a.priority || 0) || (a.due || '9999').localeCompare(b.due || '9999'),
    title: (a, b) => a.title.localeCompare(b.title),
    created: (a, b) => b.createdAt - a.createdAt,
    tag: (a, b) => ((a.tags || [])[0] || '~').localeCompare((b.tags || [])[0] || '~'),
  }[sort] || byOrder;
  return arr.sort((a, b) => pin(a) - pin(b) || cmp(a, b));
}
export function groupTasks(arr, group, key) {
  const T = today();
  if (group === 'none' || !group) return [{ key: 'all', name: '', tasks: arr }];
  const map = new Map();
  const add = (k, name, t, order) => { if (!map.has(k)) map.set(k, { key: k, name, tasks: [], order }); map.get(k).tasks.push(t); };
  for (const t of arr) {
    if (group === 'list') { const l = listById(t.listId); add(l.id, `${l.emoji || ''} ${l.name}`.trim(), t, l.id === 'inbox' ? -1 : (l.order ?? 0)); }
    else if (group === 'priority') add('p' + (t.priority || 0), prioName(t.priority || 0) + ' priority', t, -(t.priority || 0));
    else if (group === 'tag') { const g = (t.tags || [])[0]; add(g || '~', g ? '#' + g : 'No tag', t, g ? 0 : 1); }
    else if (group === 'date') {
      if (!t.due) add('nodate', 'No date', t, 1e9);
      else if (isOverdue(t)) add('overdue', 'Overdue', t, -1e9);
      else { const d = dayOf(t.due); const n = diffDays(d, T); add(n > 14 ? 'later' : d, n > 14 ? 'Later' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 0 ? 'Earlier' : `${DOW_LONG[parseD(d).getDay()]}, ${MONTHS[parseD(d).getMonth()]} ${parseD(d).getDate()}`, t, n > 14 ? 1e8 : n); }
    }
  }
  return [...map.values()].sort((a, b) => a.order - b.order);
}

// ---------- quick add parsing ----------
const DOWS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MONTH_IDX = Object.fromEntries([...MONTHS.map((m, i) => [m.toLowerCase(), i]), ...MONTHS_LONG.map((m, i) => [m.toLowerCase(), i]), ['sept', 8]]);
const TIME_RE = '(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a|p)?';

function parseTimeStr(h, m, ap) {
  let H = Number(h), M = Number(m || 0);
  if (ap) { ap = ap[0]; if (ap === 'p' && H < 12) H += 12; if (ap === 'a' && H === 12) H = 0; }
  if (H > 23 || M > 59) return null;
  return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`;
}

export function parseQuick(text) {
  let s = ' ' + text + ' ';
  const found = [];
  const out = { tags: [], priority: null, listId: null, due: null, start: null, repeat: null, found };
  const take = (re, fn) => { s = s.replace(re, (...m) => { const r = fn(...m); if (r === false) return m[0]; found.push(m[0].trim()); return ' '; }); };
  const T = today();

  take(/\s#([\p{L}\p{N}_\-/]+)/gu, (_, g) => { out.tags.push(g); });
  take(/\s!(high|medium|med|low|none|[0-3])(?=\s)/gi, (_, p) => { p = p.toLowerCase(); out.priority = { high: 5, '3': 5, medium: 3, med: 3, '2': 3, low: 1, '1': 1, none: 0, '0': 0 }[p]; });
  take(/\s!!!(?=\s)/g, () => { out.priority = 5; });
  take(/\s[\^~]([\p{L}\p{N}_\-]+)/gu, (_, n) => {
    const q = n.toLowerCase().replace(/_/g, ' ');
    const l = [INBOX, ...lists()].find((x) => x.name.toLowerCase() === q) || [INBOX, ...lists()].find((x) => x.name.toLowerCase().startsWith(q));
    if (!l) return false;
    out.listId = l.id;
  });

  // repeats
  take(/\s(every\s+weekday|weekdays|every\s+workday)(?=\s)/i, () => { out.repeat = { freq: 'week', interval: 1, byDay: [1, 2, 3, 4, 5] }; });
  take(/\s(daily|every\s*day)(?=\s)/i, () => { out.repeat = { freq: 'day', interval: 1 }; });
  take(/\s(weekly|every\s*week)(?=\s)/i, () => { out.repeat = { freq: 'week', interval: 1 }; });
  take(/\s(monthly|every\s*month)(?=\s)/i, () => { out.repeat = { freq: 'month', interval: 1 }; });
  take(/\s(yearly|annually|every\s*year)(?=\s)/i, () => { out.repeat = { freq: 'year', interval: 1 }; });
  take(/\severy\s+(\d+)\s+(day|week|month|year)s?(?=\s)/i, (_, n, u) => { out.repeat = { freq: u.toLowerCase(), interval: Number(n) }; });
  take(/\severy\s+((?:(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|urday|sday)?(?:\s*,\s*|\s+and\s+|\s+)?)+)(?=\s)/i, (_, days) => {
    const list = days.toLowerCase().split(/[\s,]+|and/).map((d) => DOWS[d]).filter((d) => d !== undefined);
    if (!list.length) return false;
    out.repeat = { freq: 'week', interval: 1, byDay: [...new Set(list)] };
    out.due = out.due || nextDow(list[0], true);
  });

  let day = null, time = null, endTime = null;
  take(new RegExp(`\\s(?:from\\s+)?${TIME_RE}\\s*(?:-|–|to)\\s*${TIME_RE}(?=\\s)`, 'i'), (_, h1, m1, a1, h2, m2, a2) => {
    if (!a1 && !a2 && !m1 && !m2) return false;
    time = parseTimeStr(h1, m1, a1 || a2); endTime = parseTimeStr(h2, m2, a2);
    if (!time || !endTime) return false;
  });
  take(/\s(today|tod)(?=\s)/i, () => { day = T; });
  take(/\stonight(?=\s)/i, () => { day = T; time = time || '20:00'; });
  take(/\s(tomorrow|tmr|tmrw|tom)(?=\s)/i, () => { day = ymd(addDays(T, 1)); });
  take(/\s(day after tomorrow)(?=\s)/i, () => { day = ymd(addDays(T, 2)); });
  take(/\snext\s+week(?=\s)/i, () => { day = ymd(addDays(ymd(startOfWeek(T, 1)), 7)); });
  take(/\snext\s+month(?=\s)/i, () => { const d = parseD(T); day = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 1)); });
  take(/\sthis\s+weekend(?=\s)|\sweekend(?=\s)/i, () => { day = nextDow(6, true); });
  take(/\sin\s+(\d+|a|an|one|two|three)\s+(day|week|month|year|hour|minute|min)s?(?=\s)/i, (_, n, u) => {
    n = { a: 1, an: 1, one: 1, two: 2, three: 3 }[String(n).toLowerCase()] || Number(n); u = u.toLowerCase();
    if (u === 'day') day = ymd(addDays(T, n));
    else if (u === 'week') day = ymd(addDays(T, 7 * n));
    else if (u === 'month') day = ymd(addMonths(T, n));
    else if (u === 'year') day = ymd(addMonths(T, 12 * n));
    else { const d = new Date(Date.now() + n * (u === 'hour' ? 3600e3 : 60e3)); day = ymd(d); time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
  });
  take(/\s(?:on\s+)?(next\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|nesday|urday|sday)?(?=\s)/i, (_, next, d, rest) => {
    const key = (d + (rest || '')).toLowerCase(); const n = DOWS[key] ?? DOWS[d.toLowerCase()];
    if (n === undefined) return false;
    let res = nextDow(n, false);
    if (next && res < ymd(addDays(ymd(startOfWeek(T, 1)), 7))) res = ymd(addDays(res, 7));
    day = res;
  });
  take(/\s(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?(?=\s)/i, (_, d, m, y) => { day = mkDate(y, MONTH_IDX[m.toLowerCase().slice(0, 3)] ?? MONTH_IDX[m.toLowerCase()], Number(d)); if (!day) return false; });
  take(/\s(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?=\s)/i, (_, m, d, y) => { day = mkDate(y, MONTH_IDX[m.toLowerCase().slice(0, 3)], Number(d)); if (!day) return false; });
  take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/, (_, y, m, d) => { day = `${y}-${m}-${d}`; });
  take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/, (_, a, b, y) => { day = mkDate(y && y.length === 2 ? '20' + y : y, Number(a) - 1, Number(b)); if (!day) return false; });
  take(new RegExp(`\\s(?:at|@)\\s*${TIME_RE}(?=\\s)`, 'i'), (_, h, m, ap) => { const t = parseTimeStr(h, m, ap); if (!t) return false; time = t; });
  take(new RegExp(`\\s(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)(?=\\s)`, 'i'), (_, h, m, ap) => { const t = parseTimeStr(h, m, ap); if (!t) return false; time = t; });
  take(/\s(\d{1,2}):(\d{2})(?=\s)/, (_, h, m) => { const t = parseTimeStr(h, m); if (!t) return false; time = t; });
  take(/\s(noon|midday)(?=\s)/i, () => { time = '12:00'; });
  take(/\s(morning)(?=\s)/i, () => { time = '09:00'; });
  take(/\s(evening)(?=\s)/i, () => { time = '18:00'; });

  if (time && !day && !out.due) { day = T; if (parseD(`${T}T${time}`) < new Date()) day = ymd(addDays(T, 1)); }
  if (day || out.due) {
    const d = day || out.due;
    if (endTime) { out.start = `${d}T${time}`; out.due = `${d}T${endTime}`; }
    else out.due = time ? `${d}T${time}` : d;
  }
  out.title = s.replace(/\s+/g, ' ').trim();
  return out;
}
function nextDow(n, includeToday) { const d = parseD(today()); let add = (n - d.getDay() + 7) % 7; if (add === 0 && !includeToday) add = 7; return ymd(addDays(today(), add)); }
function mkDate(y, m, d) {
  if (m === undefined || m < 0 || m > 11 || d < 1 || d > 31) return null;
  const now = new Date(); let Y = y ? Number(y) : now.getFullYear();
  let date = new Date(Y, m, d);
  if (!y && ymd(date) < today()) date = new Date(Y + 1, m, d);
  return ymd(date);
}

// ---------- reminders ----------
// 'm0' at the time, 'm5' 5 min before, 'h1' 1 hour before, 'd1' 1 day before (same time),
// all-day: 'd0@09:00' on the day at 9, 'd1@09:00' the day before at 9, 'w1@09:00' a week before
export function reminderTime(due, r) {
  if (!due || !r) return null;
  const [code, at] = r.split('@');
  const unit = code[0], n = Number(code.slice(1));
  if (at || !hasTime(due)) {
    const days = unit === 'w' ? n * 7 : unit === 'd' ? n : 0;
    const d = parseD(dayOf(due)); d.setDate(d.getDate() - days);
    const [H, M] = (at || '09:00').split(':').map(Number); d.setHours(H, M, 0, 0); return d;
  }
  const ms = { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[unit] * n;
  return new Date(parseD(due).getTime() - ms);
}
export function reminderLabel(r, timed = true) {
  const [code, at] = r.split('@'); const unit = code[0], n = Number(code.slice(1));
  if (at) return `${n === 0 ? 'On the day' : unit === 'w' ? `${n} week${n > 1 ? 's' : ''} early` : `${n} day${n > 1 ? 's' : ''} early`} (${fmtTime(at)})`;
  if (n === 0) return 'On time';
  return `${n} ${({ m: 'min', h: 'hour', d: 'day', w: 'week' })[unit]}${n > 1 && unit !== 'm' ? 's' : ''} early`;
}
export const REMINDERS_TIMED = ['m0', 'm5', 'm30', 'h1', 'd1'];
export const REMINDERS_ALLDAY = ['d0@09:00', 'd1@09:00', 'd2@09:00', 'w1@09:00'];

export function filtersList() { return all('filter').sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }
export function templates() { return all('template').sort((a, b) => b.createdAt - a.createdAt); }
export function commentsFor(taskId) { return all('comment', (c) => c.taskId === taskId).sort((a, b) => a.createdAt - b.createdAt); }
export function membersOf(listId) { return store.members[listId] || []; }
export { uid };
