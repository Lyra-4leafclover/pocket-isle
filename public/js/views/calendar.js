// Calendar: month, week, 3-day, day and agenda views with drag-to-reschedule and subscribed calendars.
import { h, today, ymd, parseD, addDays, addMonths, dayOf, hasTime, timeOf, startOfWeek, diffDays, DOW, MONTHS_LONG, MONTHS, fmtTime, fmtDay, daysInMonth, menu, popover } from '../util.js';
import { get, all, patch, settings, saveSettings } from '../store.js';
import * as T from '../tasks.js';
import { ui, openTask, go } from '../ui.js';
import { checkbox, taskRow } from '../widgets.js';
import { eventsBetween } from '../ics.js';
import { quickAdd } from './tasks.js';

const MODES = [['month', 'Month'], ['week', 'Week'], ['3day', '3 days'], ['day', 'Day'], ['agenda', 'Agenda']];
const HOUR = 48;

function entries(from, to) {
  const s = settings();
  const out = [];
  for (const t of T.live().filter((t) => t.due && !T.isNoteList(T.listById(t.listId)))) {
    if (!T.isOpen(t) && !s.calendarShowCompleted) continue;
    const span = t.start ? Math.max(0, diffDays(dayOf(t.due), dayOf(t.start))) : 0;
    for (const d of T.occurrences(t, ymd(addDays(from, -span)), to)) {
      const start = span ? ymd(addDays(d, -span)) : d;
      out.push({ type: 'task', t, day: start, end: d, time: hasTime(t.start || t.due) ? timeOf(t.start || t.due) : null, endTime: hasTime(t.due) ? timeOf(t.due) : null, repeatCopy: d !== dayOf(t.due), title: t.title, color: T.listById(t.listId).color || '#8aa' });
    }
  }
  if (s.calendarShowHabits) for (const hb of all('habit', (x) => !x.archived)) {
    for (let d = from; d <= to; d = ymd(addDays(d, 1))) if (habitDue(hb, d)) out.push({ type: 'habit', hb, day: d, end: d, title: (hb.emoji || '🌱') + ' ' + hb.name, color: '#9cc58a', done: (hb.records?.[d] || 0) >= (hb.goal || 1) });
  }
  if (s.calendarShowFocus) for (const f of all('focus', (x) => x.sec >= 60)) { const d = ymd(new Date(f.start)); if (d >= from && d <= to) { const st = new Date(f.start); out.push({ type: 'focus', f, day: d, end: d, time: `${String(st.getHours()).padStart(2, '0')}:${String(st.getMinutes()).padStart(2, '0')}`, mins: Math.round(f.sec / 60), title: '⏱ ' + (get(f.taskId)?.title || 'Focus'), color: '#b7a3d9' }); } }
  for (const ev of eventsBetween(from, to)) out.push({ type: 'event', ev, day: ev.day, end: ev.day, time: ev.start.allDay ? null : ev.start.time, endTime: ev.end && !ev.end.allDay ? ev.end.time : null, title: ev.title || '(event)', color: ev.color || '#999' });
  return out;
}
function habitDue(hb, d) {
  if (hb.start && d < hb.start) return false;
  const f = hb.freq || { type: 'daily' };
  if (f.type === 'weekdays') return (f.days || []).includes(parseD(d).getDay());
  return f.type !== 'weekly';
}

function chip(e) {
  const done = e.type === 'task' ? !T.isOpen(e.t) && !e.repeatCopy : e.done;
  const el = h('div.cal-chip.' + e.type + (done ? '.done' : '') + (e.type === 'task' && T.isOverdue(e.t) && !e.repeatCopy ? '.over' : ''), {
    style: { '--cc': e.color }, title: e.title,
    draggable: e.type === 'task' ? 'true' : null,
    ondragstart: e.type === 'task' ? (ev) => { ev.dataTransfer.setData('text/task', e.t.id); ev.dataTransfer.effectAllowed = 'move'; } : null,
    onclick: (ev) => { ev.stopPropagation(); if (e.type === 'task') openTask(e.t.id); else if (e.type === 'habit') go('#/habits/' + e.hb.id); else if (e.type === 'event') popover(ev.currentTarget, h('div.ev-pop', h('b', e.ev.title), h('div.muted.sm', e.ev.cal, ' · ', fmtDay(e.day), e.time ? ' ' + fmtTime(e.time) : ''), e.ev.location ? h('div.sm', '📍 ' + e.ev.location) : null, e.ev.desc ? h('p.sm', e.ev.desc.slice(0, 400)) : null)); },
  }, e.type === 'task' ? h('span.cc-dot', { style: { background: T.PRIORITIES.find((p) => p.v === (e.t.priority || 0)).color } }) : null, e.time ? h('small', fmtTime(e.time) + ' ') : null, e.title);
  return el;
}
function dropDay(day, time) {
  return {
    ondragover: (e) => { if (e.dataTransfer.types.includes('text/task')) { e.preventDefault(); e.currentTarget.classList.add('over'); } },
    ondragleave: (e) => e.currentTarget.classList.remove('over'),
    ondrop: (e) => {
      e.currentTarget.classList.remove('over');
      const t = get(e.dataTransfer.getData('text/task')); if (!t) return; e.preventDefault(); e.stopPropagation();
      let tm = typeof time === 'function' ? time(e) : time;
      const keepTime = tm === undefined ? (hasTime(t.due) ? timeOf(t.due) : null) : tm;
      const dur = t.start && hasTime(t.start) && hasTime(t.due) ? (parseD(t.due) - parseD(t.start)) : t.start ? diffDays(dayOf(t.due), dayOf(t.start)) * 864e5 : 0;
      const due = keepTime ? `${day}T${keepTime}` : day;
      if (dur) { const startD = keepTime && t.start && hasTime(t.start) ? new Date(parseD(due)) : parseD(day); const endD = new Date(startD.getTime() + dur); patch(t.id, { start: due, due: keepTime ? `${ymd(endD)}T${String(endD.getHours()).padStart(2, '0')}:${String(endD.getMinutes()).padStart(2, '0')}` : ymd(endD) }); }
      else T.setDue(t, due);
    },
  };
}

export function render(main, arg) {
  const s = settings();
  const c = ui.calendar;
  c.mode = s.calendarMode || c.mode || 'month';
  c.date ||= today();
  const setMode = (m) => saveSettings({ calendarMode: m });
  const step = (n) => {
    c.date = c.mode === 'month' ? ymd(addMonths(c.date, n)) : ymd(addDays(c.date, n * ({ week: 7, '3day': 3, day: 1, agenda: 14 }[c.mode])));
    ui.render();
  };
  const d0 = parseD(c.date);
  const title = c.mode === 'month' ? `${MONTHS_LONG[d0.getMonth()]} ${d0.getFullYear()}` : c.mode === 'day' ? fmtDay(c.date, { long: true }) : `${MONTHS[d0.getMonth()]} ${d0.getFullYear()}`;
  const body = h('div.cal-body');
  if (c.mode === 'month') body.append(monthView(c.date, s));
  else if (c.mode === 'agenda') body.append(agendaView(c.date));
  else body.append(timeGrid(c.mode === 'week' ? ymd(startOfWeek(c.date, s.weekStart)) : c.date, c.mode === 'week' ? 7 : c.mode === '3day' ? 3 : 1));
  const unscheduled = T.live().filter((t) => T.isOpen(t) && !t.due && !t.parentId && !T.isNoteList(T.listById(t.listId))).slice(0, 60);
  main.replaceChildren(
    h('div.view-head',
      h('h1', title),
      h('div.head-actions',
        h('button.btn.ghost.sm', { onclick: () => { c.date = today(); ui.render(); } }, 'Today'),
        h('button.icon-btn', { onclick: () => step(-1), 'aria-label': 'Previous' }, '‹'), h('button.icon-btn', { onclick: () => step(1), 'aria-label': 'Next' }, '›'),
        h('select.input.sm', { onchange: (e) => setMode(e.target.value) }, MODES.map(([v, n]) => h('option', { value: v, selected: c.mode === v }, n))),
        h('button.icon-btn', { title: 'Calendar options', onclick: (e) => menu(e.currentTarget, [
          { icon: s.calendarShowCompleted ? '☑' : '☐', label: 'Show completed', run: () => saveSettings({ calendarShowCompleted: !s.calendarShowCompleted }) },
          { icon: s.calendarShowHabits ? '☑' : '☐', label: 'Show habits', run: () => saveSettings({ calendarShowHabits: !s.calendarShowHabits }) },
          { icon: s.calendarShowFocus ? '☑' : '☐', label: 'Show focus sessions', run: () => saveSettings({ calendarShowFocus: !s.calendarShowFocus }) },
          { icon: s.showWeekNumbers ? '☑' : '☐', label: 'Week numbers', run: () => saveSettings({ showWeekNumbers: !s.showWeekNumbers }) },
          { icon: s.calShowUnscheduled ? '☑' : '☐', label: 'Unscheduled tasks panel', run: () => saveSettings({ calShowUnscheduled: !s.calShowUnscheduled }) },
          '-', { icon: '🔗', label: 'Subscribed calendars…', run: () => go('#/settings/calendars') },
        ], { align: 'right' }) }, '⋯'))),
    h('div.cal-wrap' + (s.calShowUnscheduled ? '.with-side' : ''),
      h('div.cal-main.scroll', { 'data-scroll': 'cal:' + c.mode }, body),
      s.calShowUnscheduled ? h('aside.cal-side.scroll', h('div.d-label', 'Unscheduled'), h('p.muted.sm', 'Drag onto a day.'), unscheduled.map((t) => taskRow(t, { details: false, showList: true }))) : null));
  if (c.mode !== 'month' && c.mode !== 'agenda') setTimeout(() => { const el = main.querySelector('.cal-main'); if (el && !el.dataset.scrolled) { el.dataset.scrolled = 1; el.scrollTop = Math.max(0, (new Date().getHours() - 2) * HOUR); } });
}

function isoWeek(d) { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return Math.ceil(((x - y0) / 864e5 + 1) / 7); }

function monthView(date, s) {
  const d0 = parseD(date);
  const first = new Date(d0.getFullYear(), d0.getMonth(), 1);
  const gs = startOfWeek(first, s.weekStart);
  const from = ymd(gs), to = ymd(addDays(gs, 41));
  const map = new Map();
  for (const e of entries(from, to)) { for (let d = e.day; d <= e.end; d = ymd(addDays(d, 1))) { if (!map.has(d)) map.set(d, []); map.get(d).push(e); } }
  const head = h('div.month-head', s.showWeekNumbers ? h('div.wk') : null, [...Array(7)].map((_, i) => h('div', DOW[(i + s.weekStart) % 7])));
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const row = h('div.month-row', s.showWeekNumbers ? h('div.wk', isoWeek(addDays(gs, w * 7))) : null);
    for (let i = 0; i < 7; i++) {
      const d = ymd(addDays(gs, w * 7 + i));
      const es = (map.get(d) || []).sort((a, b) => (a.type === 'event' ? -1 : 0) - (b.type === 'event' ? -1 : 0) || (a.time || '99').localeCompare(b.time || '99'));
      const max = 4;
      row.append(h('div.month-cell' + (d === today() ? '.today' : '') + (parseD(d).getMonth() !== d0.getMonth() ? '.other' : ''), {
        ...dropDay(d),
        ondblclick: () => addOn(d),
        onclick: (e) => { if (e.target.classList.contains('month-cell') || e.target.classList.contains('mc-num')) dayPopover(e.currentTarget, d, es); },
      }, h('span.mc-num', parseD(d).getDate()), es.slice(0, max).map(chip), es.length > max ? h('button.mc-more', { onclick: (e) => { e.stopPropagation(); dayPopover(e.currentTarget, d, es); } }, `+${es.length - max} more`) : null));
    }
    weeks.push(row);
  }
  return h('div.month', head, weeks);
}
function dayPopover(anchor, d, es) {
  popover(anchor, h('div.day-pop', h('b', fmtDay(d, { long: true })), h('div.day-pop-list', es.map(chip)), quickAdd('cal:' + d, { placeholder: 'Add on this day', extra: { due: d } })), { className: 'wide' });
}
function addOn(d, time) {
  const t = T.newTask({ title: '', due: time ? `${d}T${time}` : d });
  openTask(t.id);
  setTimeout(() => document.querySelector('.d-title')?.focus(), 60);
}

function timeGrid(start, n) {
  const days = [...Array(n)].map((_, i) => ymd(addDays(start, i)));
  const es = entries(days[0], days[n - 1]);
  const allDay = h('div.tg-allday', h('div.tg-gutter', 'all day'), days.map((d) => h('div.tg-adcell', dropDay(d, null), es.filter((e) => !e.time && e.day <= d && e.end >= d).map(chip))));
  const head = h('div.tg-head', h('div.tg-gutter'), days.map((d) => h('div.tg-dayname' + (d === today() ? '.today' : ''), { onclick: () => { ui.calendar.date = d; saveSettings({ calendarMode: 'day' }); } }, DOW[parseD(d).getDay()], ' ', h('b', parseD(d).getDate()))));
  const grid = h('div.tg-grid', h('div.tg-gutter', [...Array(24)].map((_, i) => h('div.tg-hour', { style: { height: HOUR + 'px' } }, i ? fmtTime(`${String(i).padStart(2, '0')}:00`) : ''))),
    days.map((d) => {
      const col = h('div.tg-col' + (d === today() ? '.today' : ''), {
        style: { height: HOUR * 24 + 'px' },
        ...dropDay(d, (e) => slotTime(e, col)),
        ondblclick: (e) => { if (e.target === col) addOn(d, slotTime(e, col)); },
      });
      const timed = es.filter((e) => e.time && e.day === d).sort((a, b) => a.time.localeCompare(b.time));
      const lanes = [];
      for (const e of timed) {
        const st = mins(e.time), en = e.mins ? st + e.mins : e.endTime && e.end === d ? Math.max(st + 20, mins(e.endTime)) : st + 30;
        let lane = lanes.findIndex((l) => l <= st); if (lane < 0) { lane = lanes.length; lanes.push(0); } lanes[lane] = en;
        e._st = st; e._en = en; e._lane = lane;
      }
      for (const e of timed) {
        const c = chip(e); c.classList.add('tg-ev');
        Object.assign(c.style, { top: (e._st / 60) * HOUR + 'px', height: Math.max(18, ((e._en - e._st) / 60) * HOUR - 2) + 'px', left: `calc(${(e._lane / lanes.length) * 100}% + 2px)`, width: `calc(${100 / lanes.length}% - 4px)` });
        col.append(c);
      }
      if (d === today()) { const now = new Date(); col.append(h('div.tg-now', { style: { top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR + 'px' } })); }
      return col;
    }));
  return h('div.timegrid', { style: { '--days': n } }, head, allDay, grid);
}
const mins = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
function slotTime(e, col) {
  const y = e.clientY - col.getBoundingClientRect().top;
  const m = Math.max(0, Math.min(23 * 60 + 45, Math.round((y / HOUR) * 4) * 15));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function agendaView(date) {
  const to = ymd(addDays(date, 30));
  const es = entries(date, to);
  const days = [...new Set(es.map((e) => e.day < date ? date : e.day))].sort();
  if (!days.length) return h('div.empty', h('img', { src: 'assets/c_turtle.webp', alt: '' }), h('p', 'Nothing in the next 30 days. Old Moss approves of the slow life.'));
  return h('div.agenda', days.map((d) => h('div.ag-day', h('div.ag-date' + (d === today() ? '.today' : ''), h('b', parseD(d).getDate()), h('small', fmtDay(d))),
    h('div.ag-items', es.filter((e) => (e.day < date ? date : e.day) === d).sort((a, b) => (a.time || '').localeCompare(b.time || '')).map((e) => (e.type === 'task' && !e.repeatCopy ? taskRow(e.t, { showList: true, details: false }) : chip(e)))))));
}
