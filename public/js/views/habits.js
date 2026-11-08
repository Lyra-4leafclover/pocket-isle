// Habits: each habit is a crop in your island garden. Check-ins make it grow; it never dies.
import { h, today, ymd, parseD, addDays, diffDays, DOW, MONTHS_LONG, daysInMonth, menu, modal, toast, confirmBox, promptBox, plural, startOfWeek, fmtDay } from '../util.js';
import { get, all, put, patch, remove, settings } from '../store.js';
import * as G from '../game.js';
import { go, ui } from '../ui.js';
import { emptyState } from '../widgets.js';

const EMOJI = ['🌱', '💧', '📖', '🏃', '🧘', '🍎', '😴', '✍️', '🎸', '🧹', '💊', '🚶', '🥗', '🌞', '📵', '🦷', '🧠', '💪'];
const SECTIONS = [['any', 'Any time'], ['morning', 'Morning'], ['afternoon', 'Afternoon'], ['night', 'Night']];
let viewDay = null;

export const habits = (archived = false) => all('habit', (x) => !!x.archived === archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt);
const goal = (hb) => hb.goal || 1;
export const amount = (hb, d) => hb.records?.[d] || 0;
export const isDone = (hb, d) => amount(hb, d) >= goal(hb);
export function dueOn(hb, d) {
  if (hb.start && d < hb.start) return false;
  if (hb.end && d > hb.end) return false;
  const f = hb.freq || { type: 'daily' };
  if (f.type === 'weekdays') return (f.days || []).includes(parseD(d).getDay());
  if (f.type === 'interval') return diffDays(d, hb.start || ymd(new Date(hb.createdAt))) % (f.every || 2) === 0;
  if (f.type === 'weekly') { // X times a week: due until the week's target is met
    const ws = ymd(startOfWeek(d, settings().weekStart));
    let n = 0; for (let x = ws; x < d; x = ymd(addDays(x, 1))) if (isDone(hb, x)) n++;
    return n < (f.times || 3) || isDone(hb, d);
  }
  return true;
}
export const dueToday = (hb) => dueOn(hb, today());
export const doneToday = (hb) => isDone(hb, today());
export function streak(hb, upTo = today()) {
  let n = 0, d = upTo;
  if (!isDone(hb, d)) d = ymd(addDays(d, -1));
  for (let i = 0; i < 2000; i++, d = ymd(addDays(d, -1))) {
    if (isDone(hb, d)) n++;
    else if (dueOn(hb, d) && (hb.freq?.type !== 'weekly')) break;
    if (hb.start && d < hb.start) break;
  }
  return n;
}
export function bestStreak(hb) {
  const days = Object.keys(hb.records || {}).filter((d) => isDone(hb, d)).sort();
  let best = 0, cur = 0, prev = null;
  for (const d of days) {
    let gap = false;
    if (prev) for (let x = ymd(addDays(prev, 1)); x < d; x = ymd(addDays(x, 1))) if (dueOn(hb, x) && hb.freq?.type !== 'weekly') { gap = true; break; }
    cur = prev && !gap ? cur + 1 : 1; best = Math.max(best, cur); prev = d;
  }
  return best;
}
export function last7(hb) {
  let due = 0, done = 0, missedRun = 0, run = true;
  for (let i = 0, d = today(); i < 30 && due < 7; i++, d = ymd(addDays(d, -1))) {
    if (!dueOn(hb, d)) continue;
    if (d === today() && !isDone(hb, d)) continue;
    due++;
    if (isDone(hb, d)) { done++; run = false; } else if (run) missedRun++;
  }
  return { due, done, missedRun };
}
export const stage = (hb) => G.cropStage(hb, last7);

export function check(hb, d = today(), delta) {
  const rec = { ...(hb.records || {}) };
  const before = rec[d] || 0;
  const g = goal(hb);
  let after = delta != null ? Math.max(0, before + delta) : before >= g ? 0 : g;
  if (after) rec[d] = after; else delete rec[d];
  hb.records = rec;
  if (after >= g && before < g && d === today()) {
    const allDone = habits().filter(dueToday).every((x) => x.id === hb.id || doneToday(x));
    G.onHabitCheck(hb, allDone, streak(hb));
  }
  put(hb);
}

export function render(main, id) {
  if (id && get(id)) return detail(main, get(id));
  const day = viewDay || today();
  const list = habits();
  const due = list.filter((hb) => dueOn(hb, day));
  const other = list.filter((hb) => !dueOn(hb, day));
  const ws = startOfWeek(day, settings().weekStart);
  const strip = h('div.week-strip', [...Array(7)].map((_, i) => {
    const d = ymd(addDays(ws, i));
    const dueN = list.filter((x) => dueOn(x, d)).length, doneN = list.filter((x) => dueOn(x, d) && isDone(x, d)).length;
    return h('button.ws-day' + (d === day ? '.on' : '') + (d === today() ? '.today' : ''), { onclick: () => { viewDay = d; ui.render(); }, disabled: d > today() },
      h('small', DOW[parseD(d).getDay()]), h('b', parseD(d).getDate()),
      h('span.ring', { style: { '--p': dueN ? doneN / dueN : 0 } }));
  }));
  const cap = G.FARM.length + (G.hasBuilding('greenhouse') ? 4 : 0);
  const bySection = SECTIONS.map(([k, n]) => [n, due.filter((x) => (x.section || 'any') === k)]).filter(([, l]) => l.length);
  main.replaceChildren(
    h('div.view-head', h('h1', '🌱 Habits'), h('div.head-actions',
      h('button.btn.sm', { onclick: () => editor(null) }, '+ New habit'),
      h('button.icon-btn', { onclick: (e) => menu(e.currentTarget, [{ label: 'Archived habits', run: archivedDialog }, { label: 'Visit the garden', run: () => go('#/island') }], { align: 'right' }) }, '⋯'))),
    h('div.view-body.scroll', { 'data-scroll': 'habits' },
      strip,
      list.length > cap ? h('p.muted.sm', `Your garden has room for ${cap} crops. Extra habits still count, they just don't show on the island. A greenhouse adds 4 more plots.`) : null,
      !list.length ? emptyState('c_rabbit', 'Plant your first habit', 'Each habit becomes a crop in your island garden. Keep it up and it grows. Miss a day and it droops a little, but it never dies.') : null,
      bySection.map(([name, l]) => h('div.group', bySection.length > 1 || name !== 'Any time' ? h('div.group-head', h('b', name)) : null, h('div.habit-list', l.map((hb) => habitRow(hb, day))))),
      other.length ? h('div.group', h('div.group-head', h('b', 'Not due ' + (day === today() ? 'today' : 'this day'))), h('div.habit-list.dim', other.map((hb) => habitRow(hb, day)))) : null));
}
function habitRow(hb, day) {
  const cs = stage(hb), st = cs.stage, done = isDone(hb, day), amt = amount(hb, day), g = goal(hb);
  return h('div.habit-row' + (done ? '.done' : '') + (cs.droop ? '.droop' : ''), { onclick: (e) => { if (!e.target.closest('button')) go('#/habits/' + hb.id); } },
    h('img.crop', { src: G.cropImg(hb, st), alt: '' }),
    h('div.hb-main', h('b', hb.emoji || '', ' ', hb.name), h('div.muted.sm', `🔥 ${plural(streak(hb, day), 'day')}`, g > 1 ? ` · ${amt}/${g} ${hb.unit || ''}` : '', hb.freq?.type === 'weekly' ? ` · ${hb.freq.times}× a week` : ''),
      g > 1 ? h('div.progress', h('div', { style: { width: Math.min(100, (amt / g) * 100) + '%' } })) : null),
    g > 1 ? h('button.icon-btn', { onclick: () => check(hb, day, -1), 'aria-label': 'Less' }, '−') : null,
    h('button.hb-check' + (done ? '.on' : ''), { onclick: (e) => { check(hb, day, g > 1 && !done ? 1 : undefined); if (!done && isDone(hb, day)) { e.currentTarget.classList.add('pop'); if (hb.askNote) logNote(hb, day); } }, 'aria-label': done ? 'Undo' : 'Check in' }, done ? '✓' : g > 1 ? '+' : ''),
  );
}
async function logNote(hb, d) {
  const n = await promptBox(`How did "${hb.name}" go?`, hb.notes?.[d] || '', 'Optional note');
  if (n != null) patch(hb.id, { notes: { ...(hb.notes || {}), [d]: n } });
}

let monthOf = null;
function detail(main, hb) {
  monthOf ||= today().slice(0, 7);
  const [y, m] = monthOf.split('-').map(Number);
  const first = new Date(y, m - 1, 1), ws = startOfWeek(first, settings().weekStart);
  const cells = [...Array(42)].map((_, i) => { const d = ymd(addDays(ws, i)); const inM = parseD(d).getMonth() === m - 1;
    return h('button.hm-cell' + (isDone(hb, d) ? '.on' : amount(hb, d) ? '.part' : '') + (inM ? '' : '.other') + (d === today() ? '.today' : '') + (dueOn(hb, d) ? '' : '.off'), { disabled: d > today(), title: d, onclick: () => check(hb, d), oncontextmenu: (e) => { e.preventDefault(); logNote(hb, d); } }, parseD(d).getDate(), hb.notes?.[d] ? h('i.hm-note') : null); });
  const total = Object.keys(hb.records || {}).filter((d) => isDone(hb, d)).length;
  const monthDue = [...Array(daysInMonth(y, m - 1))].map((_, i) => ymd(new Date(y, m - 1, i + 1))).filter((d) => d <= today() && dueOn(hb, d));
  const rate = monthDue.length ? Math.round((monthDue.filter((d) => isDone(hb, d)).length / monthDue.length) * 100) : 0;
  const cs = stage(hb), st = cs.stage;
  main.replaceChildren(
    h('div.view-head', h('button.icon-btn', { onclick: () => go('#/habits'), 'aria-label': 'Back' }, '‹'), h('h1', hb.emoji || '🌱', ' ', hb.name),
      h('div.head-actions', h('button.btn.ghost.sm', { onclick: () => editor(hb) }, 'Edit'), h('button.icon-btn', { onclick: (e) => menu(e.currentTarget, [
        { label: hb.archived ? 'Unarchive' : 'Archive', run: () => { patch(hb.id, { archived: !hb.archived }); go('#/habits'); } },
        { label: 'Delete', danger: true, run: async () => { if (await confirmBox('Delete habit?', 'Its crop and history will be removed.', 'Delete', true)) { remove(hb.id); go('#/habits'); } } }], { align: 'right' }) }, '⋯'))),
    h('div.view-body.scroll',
      h('div.hb-hero' + (cs.droop ? '.droop' : ''), h('img', { src: G.cropImg(hb, st), alt: '' }), h('div', h('b', cs.droop ? 'A little thirsty' : ['Just a seed', 'Sprouting', 'In full bloom'][st]), h('p.muted.sm', cs.droop ? 'It missed a few days. One check-in perks it right back up.' : st < 2 ? 'Check in on most of its days this week to help it bloom.' : 'Beautiful. Keep it watered.'), hb.motto ? h('p.motto', '“', hb.motto, '”') : null)),
      h('div.stat-row', [['Streak', plural(streak(hb), 'day')], ['Best streak', plural(bestStreak(hb), 'day')], ['Total check-ins', total], ['This month', rate + '%']].map(([a, b]) => h('div.stat', h('small', a), h('b', b)))),
      h('div.hm-head', h('button.icon-btn', { onclick: () => { monthOf = ymd(new Date(y, m - 2, 1)).slice(0, 7); ui.render(); } }, '‹'), h('b', MONTHS_LONG[m - 1] + ' ' + y), h('button.icon-btn', { onclick: () => { monthOf = ymd(new Date(y, m, 1)).slice(0, 7); ui.render(); } }, '›')),
      h('div.hm-grid', [...Array(7)].map((_, i) => h('small.hm-dow', DOW[(i + settings().weekStart) % 7])), cells),
      h('p.muted.sm', 'Tap a day to check in or undo. Right-click (or long-press) a day to write a note.'),
      Object.keys(hb.notes || {}).length ? h('div.group', h('div.group-head', h('b', 'Journal')), Object.entries(hb.notes).filter(([, v]) => v).sort((a, b) => b[0].localeCompare(a[0])).map(([d, n]) => h('div.hb-log', h('small.muted', fmtDay(d, { long: true })), h('p', n)))) : null));
}

export function editor(hb) {
  const isNew = !hb;
  const d = hb ? structuredClone(hb) : { kind: 'habit', name: '', emoji: '🌱', crop: G.CROPS[habits().length % G.CROPS.length], freq: { type: 'daily', days: [1, 2, 3, 4, 5], times: 3, every: 2 }, goal: 1, unit: '', section: 'any', reminders: [], start: today(), records: {}, askNote: false, motto: '' };
  d.freq = { days: [1, 2, 3, 4, 5], times: 3, every: 2, ...d.freq };
  const body = h('div.form');
  const draw = () => body.replaceChildren(
    h('input.input', { placeholder: 'Habit name, e.g. Drink water', value: d.name, 'data-keep': 'habitname', oninput: (e) => { d.name = e.target.value; } }),
    h('div.emoji-grid', EMOJI.map((e) => h('button.emoji' + (d.emoji === e ? '.on' : ''), { onclick: () => { d.emoji = e; draw(); } }, e))),
    h('div.d-label', 'Crop it grows'),
    h('div.res-pick', G.CROPS.map((c) => h('button.res-opt' + (d.crop === c ? '.on' : ''), { onclick: () => { d.crop = c; draw(); } }, h('img', { src: `assets/p_${c}.webp`, alt: '' }), c[0].toUpperCase() + c.slice(1)))),
    h('div.form-row', h('span', 'How often'), h('select.input.sm', { onchange: (e) => { d.freq.type = e.target.value; draw(); } }, [['daily', 'Every day'], ['weekdays', 'Certain days'], ['weekly', 'Times per week'], ['interval', 'Every few days']].map(([v, n]) => h('option', { value: v, selected: d.freq.type === v }, n)))),
    d.freq.type === 'weekdays' ? h('div.chips', DOW.map((n, i) => h('button.chip' + (d.freq.days.includes(i) ? '.on' : ''), { onclick: () => { d.freq.days = d.freq.days.includes(i) ? d.freq.days.filter((x) => x !== i) : [...d.freq.days, i]; draw(); } }, n))) : null,
    d.freq.type === 'weekly' ? h('div.form-row', h('span', 'Times a week'), h('input.input.sm', { type: 'number', min: 1, max: 7, value: d.freq.times, onchange: (e) => { d.freq.times = Number(e.target.value) || 1; } })) : null,
    d.freq.type === 'interval' ? h('div.form-row', h('span', 'Every … days'), h('input.input.sm', { type: 'number', min: 2, max: 30, value: d.freq.every, onchange: (e) => { d.freq.every = Number(e.target.value) || 2; } })) : null,
    h('div.form-row', h('span', 'Daily goal'), h('input.input.sm', { type: 'number', min: 1, max: 999, value: d.goal, style: { width: '70px' }, onchange: (e) => { d.goal = Math.max(1, Number(e.target.value) || 1); } }), h('input.input.sm', { placeholder: 'unit (glasses, pages…)', value: d.unit || '', oninput: (e) => { d.unit = e.target.value; } })),
    h('div.form-row', h('span', 'Time of day'), h('select.input.sm', { onchange: (e) => { d.section = e.target.value; } }, SECTIONS.map(([v, n]) => h('option', { value: v, selected: d.section === v }, n)))),
    h('div.form-row', h('span', 'Reminders'), h('div.chips', d.reminders.map((r) => h('span.chip.on', r, h('button', { onclick: () => { d.reminders = d.reminders.filter((x) => x !== r); draw(); } }, '×'))),
      h('input.input.sm', { type: 'time', onchange: (e) => { if (e.target.value && !d.reminders.includes(e.target.value)) { d.reminders.push(e.target.value); draw(); } } }))),
    h('div.form-row', h('span', 'Start'), h('input.input.sm', { type: 'date', value: d.start || '', onchange: (e) => { d.start = e.target.value; } }), h('span', 'End'), h('input.input.sm', { type: 'date', value: d.end || '', onchange: (e) => { d.end = e.target.value || null; } })),
    h('input.input', { placeholder: 'A motto to keep you going (optional)', value: d.motto || '', oninput: (e) => { d.motto = e.target.value; } }),
    h('label.form-row', h('input', { type: 'checkbox', checked: !!d.askNote, onchange: (e) => { d.askNote = e.target.checked; } }), ' Ask for a short note after each check-in'));
  draw();
  const m = modal(isNew ? 'New habit' : 'Edit habit', body, { wide: true, actions: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), h('button.btn', { onclick: () => { if (!d.name.trim()) return toast('Name your habit'); if (isNew) { d.order = habits().length; put(d); } else patch(hb.id, d); m.close(); } }, isNew ? 'Plant it' : 'Save')] });
}
function archivedDialog() {
  const l = habits(true);
  const m = modal('Archived habits', l.length ? h('div', l.map((hb) => h('div.member', h('span', hb.emoji), h('b', hb.name), h('button.btn.ghost.sm', { onclick: () => { patch(hb.id, { archived: false }); m.close(); } }, 'Restore')))) : h('p.muted', 'No archived habits.'));
}
