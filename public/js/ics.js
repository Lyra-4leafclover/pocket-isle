// Reads .ics calendar feeds (Google, Apple, Outlook links) and exports tasks as .ics.
import { ymd, parseD, addDays, dayOf, hasTime, timeOf } from './util.js';
import { all, api, emit, store } from './store.js';
import * as T from './tasks.js';

const unfold = (s) => s.replace(/\r?\n[ \t]/g, '');
function icsDate(v, params = '') {
  const allDay = /VALUE=DATE(?!-)/.test(params) || /^\d{8}$/.test(v);
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  if (allDay || !m[4]) return { allDay: true, date: `${m[1]}-${m[2]}-${m[3]}` };
  const d = m[7] ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5])) : new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  return { allDay: false, date: ymd(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, ts: d.getTime() };
}
export function parseICS(text) {
  const events = [];
  let cur = null;
  for (const line of unfold(text).split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur?.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const [name, ...ps] = line.slice(0, i).split(';');
    const params = ps.join(';'), val = line.slice(i + 1);
    const text = () => val.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
    if (name === 'SUMMARY') cur.title = text();
    else if (name === 'DESCRIPTION') cur.desc = text();
    else if (name === 'LOCATION') cur.location = text();
    else if (name === 'UID') cur.uid = val;
    else if (name === 'DTSTART') cur.start = icsDate(val, params);
    else if (name === 'DTEND') cur.end = icsDate(val, params);
    else if (name === 'RRULE') cur.rrule = Object.fromEntries(val.split(';').map((p) => p.split('=')));
    else if (name === 'EXDATE') (cur.exdates ||= []).push(...val.split(',').map((x) => icsDate(x, params)?.date));
  }
  return events;
}
const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
// all event days between from..to ('YYYY-MM-DD')
export function expand(ev, from, to) {
  const out = [];
  const push = (d) => { if (d >= from && d <= to && !(ev.exdates || []).includes(d)) out.push({ ...ev, day: d }); };
  const start = ev.start.date;
  const span = ev.end && ev.end.date > start ? Math.round((parseD(ev.end.date) - parseD(start)) / 864e5) - (ev.end.allDay ? 1 : 0) : 0;
  const pushSpan = (d) => { for (let k = 0; k <= span; k++) push(ymd(addDays(d, k))); };
  if (!ev.rrule) { pushSpan(start); return out; }
  const r = ev.rrule, iv = Number(r.INTERVAL || 1), count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? icsDate(r.UNTIL).date : '9999-12-31';
  let n = 0; let d = parseD(start);
  for (let guard = 0; guard < 3000 && n < count; guard++) {
    const s = ymd(d);
    if (s > until || s > to) break;
    if (r.FREQ === 'WEEKLY' && r.BYDAY) {
      const wk = addDays(d, -d.getDay());
      for (const code of r.BYDAY.split(',')) { const x = ymd(addDays(wk, BYDAY[code.slice(-2)])); if (x >= start && x <= until && n < count) { n++; pushSpan(x); } }
      d = addDays(d, 7 * iv); continue;
    }
    n++; pushSpan(s);
    if (r.FREQ === 'DAILY') d = addDays(d, iv);
    else if (r.FREQ === 'WEEKLY') d = addDays(d, 7 * iv);
    else if (r.FREQ === 'MONTHLY') { d = new Date(d); d.setMonth(d.getMonth() + iv); }
    else if (r.FREQ === 'YEARLY') { d = new Date(d); d.setFullYear(d.getFullYear() + iv); }
    else break;
  }
  return out;
}

const cache = new Map();
const LS = 'cloverhaven.ics.';
export function feedEvents(cal) {
  let c = cache.get(cal.id);
  if (!c) { try { c = JSON.parse(localStorage.getItem(LS + cal.id) || 'null'); } catch {} if (c) cache.set(cal.id, c); }
  if (!c || Date.now() - c.at > 30 * 60e3) refresh(cal);
  return c?.events || [];
}
const loading = new Set();
export async function refresh(cal, force) {
  if (loading.has(cal.id) || (!store.user && !cal.text)) return;
  loading.add(cal.id);
  try {
    const text = cal.text || (await api('/api/ics?url=' + encodeURIComponent(cal.url))).ics;
    const c = { at: Date.now(), events: parseICS(text) };
    cache.set(cal.id, c);
    try { localStorage.setItem(LS + cal.id, JSON.stringify(c)); } catch {}
    emit();
    return c.events.length;
  } catch (e) { if (force) throw e; } finally { loading.delete(cal.id); }
}
export function eventsBetween(from, to) {
  const out = [];
  for (const cal of all('calendar', (c) => !c.hidden)) for (const ev of feedEvents(cal)) for (const x of expand(ev, from, to)) out.push({ ...x, color: cal.color, cal: cal.name });
  return out;
}

const icsEsc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
const stamp = (d, t) => d.replace(/-/g, '') + (t ? 'T' + t.replace(':', '') + '00' : '');
export function exportICS(tasks) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pocket Isle//Planner//EN', 'CALSCALE:GREGORIAN'];
  for (const t of tasks.filter((t) => t.due)) {
    const d = dayOf(t.due), s = dayOf(t.start || t.due);
    lines.push('BEGIN:VEVENT', 'UID:' + t.id + '@cloverhaven', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', 'SUMMARY:' + icsEsc(t.title));
    if (hasTime(t.due)) { lines.push('DTSTART:' + stamp(s, timeOf(t.start || t.due)), 'DTEND:' + stamp(d, timeOf(t.due))); }
    else lines.push('DTSTART;VALUE=DATE:' + stamp(s), 'DTEND;VALUE=DATE:' + stamp(ymd(addDays(d, 1))));
    if (t.content) lines.push('DESCRIPTION:' + icsEsc(t.content));
    if (t.repeat) { const r = t.repeat; const f = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[r.freq]; if (f) lines.push(`RRULE:FREQ=${f};INTERVAL=${r.interval || 1}` + (r.byDay?.length && r.freq === 'week' ? ';BYDAY=' + r.byDay.map((x) => Object.keys(BYDAY)[x]).join(',') : '') + (r.until ? ';UNTIL=' + stamp(r.until) : '')); }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
