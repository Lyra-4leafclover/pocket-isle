// Focus: pomodoro + stopwatch with real ambient sounds. Sessions bring rain to the island and wash up sea glass.
import { h, toast, menu, modal, fmtDuration, fmtClock, today, ymd, plural, promptBox } from '../util.js';
import { get, all, put, patch, remove, settings, saveSettings, emit } from '../store.js';
import * as T from '../tasks.js';
import * as G from '../game.js';
import { ui, openTask } from '../ui.js';
import { chime } from '../app.js';

export const SOUNDS = [['none', 'Silence'], ['rain', 'Rain'], ['thunder', 'Thunderstorm'], ['ocean', 'Ocean waves'], ['forest', 'Forest'], ['crackle', 'Fireplace'], ['cafe', 'Café'], ['library', 'Library'], ['lofi', 'Lo-fi']];
const LS = 'cloverhaven.timer';
// timer: {mode:'pomo'|'watch', phase:'focus'|'short'|'long', running, endsAt, left, startedAt, elapsed, taskId, count}
let tm = load();
function load() { try { return JSON.parse(localStorage.getItem(LS)) || fresh(); } catch { return fresh(); } }
function fresh() { return { mode: 'pomo', phase: 'focus', running: false, left: settings().pomo.focus * 60, endsAt: 0, startedAt: 0, elapsed: 0, segStart: 0, taskId: null, count: 0 }; }
const saveTm = () => localStorage.setItem(LS, JSON.stringify(tm));
const phaseLen = (p) => settings().pomo[p === 'focus' ? 'focus' : p] * 60;
export const timer = () => tm;

let audio = null;
function playSound() {
  const s = settings().pomo;
  if (s.sound === 'none' || !tm.running || (tm.mode === 'pomo' && tm.phase !== 'focus' && !s.soundOnBreak)) { audio?.pause(); return; }
  if (!audio || !audio.src.endsWith(s.sound + '.mp3')) { audio?.pause(); audio = new Audio(`audio/${s.sound}.mp3`); audio.loop = true; }
  audio.volume = s.volume ?? 0.6;
  audio.play().catch(() => {});
}

export function remaining() { return tm.running ? Math.max(0, Math.round((tm.endsAt - Date.now()) / 1000)) : tm.left; }
export function watchElapsed() { return tm.elapsed + (tm.running ? (Date.now() - tm.segStart) / 1000 : 0); }
function start() {
  if (ui.focusTaskId) { tm.taskId = ui.focusTaskId; ui.focusTaskId = null; }
  if (!tm.startedAt) tm.startedAt = Date.now();
  tm.running = true; tm.segStart = Date.now();
  if (tm.mode === 'pomo') tm.endsAt = Date.now() + tm.left * 1000;
  saveTm(); playSound(); emit();
}
function pause() {
  if (tm.mode === 'pomo') tm.left = remaining(); else tm.elapsed = watchElapsed();
  tm.running = false; saveTm(); playSound(); emit();
}
function record(sec, type) {
  if (sec < 60) return null;
  const f = put({ kind: 'focus', start: tm.startedAt || Date.now() - sec * 1000, end: Date.now(), sec: Math.round(sec), taskId: tm.taskId, type, note: '' });
  G.onFocus(sec, { kind: 'focus' });
  return f;
}
function finishPhase(auto = true) {
  const s = settings().pomo;
  if (tm.phase === 'focus') {
    const sec = phaseLen('focus') - (auto ? 0 : remaining());
    const f = record(sec, 'pomo');
    tm.count++;
    if (auto) { chime('end'); notify('Focus done! 🌧', 'Rain fell on your island. Time for a break.'); }
    if (f) toast(`🌧 ${fmtDuration(sec)} focused. Sea glass washed up on the shore.`, { label: 'Add note', run: async () => { const n = await promptBox('Focus note', '', 'What did you get done?'); if (n) patch(f.id, { note: n }); } });
    tm.phase = tm.count % s.longEvery === 0 ? 'long' : 'short';
    tm.left = phaseLen(tm.phase); tm.startedAt = 0; tm.running = false;
    if (s.autoBreak) start();
  } else {
    const sec = phaseLen(tm.phase) - (auto ? 0 : remaining());
    if (auto && sec >= 60) G.onFocus(sec, { kind: 'break' });
    if (auto) { chime('ding'); notify('Break over', 'Ready for another round?'); }
    tm.phase = 'focus'; tm.left = phaseLen('focus'); tm.startedAt = 0; tm.running = false;
    if (s.autoFocus) start();
  }
  saveTm(); playSound(); emit();
}
function stopWatch() {
  const sec = watchElapsed();
  const f = record(sec, 'watch');
  if (f) toast(`🌧 ${fmtDuration(sec)} focused. Sea glass washed up on the shore.`);
  else if (sec > 0) toast('Sessions under a minute are not saved.');
  Object.assign(tm, { running: false, elapsed: 0, startedAt: 0 }); saveTm(); playSound(); emit();
}
function reset() { Object.assign(tm, fresh(), { mode: tm.mode, taskId: tm.taskId, count: tm.count }); saveTm(); playSound(); emit(); }
function notify(title, body) {
  if (settings().notifications && 'Notification' in window && Notification.permission === 'granted') navigator.serviceWorker?.ready.then((r) => r.showNotification(title, { body, icon: 'assets/icon-192.png', data: { hash: '#/focus' } })).catch(() => {});
}

setInterval(() => {
  if (!tm.running) { if (document.title !== 'Pocket Isle' && !document.title.startsWith('Pocket Isle')) document.title = 'Pocket Isle'; return; }
  if (tm.mode === 'pomo' && remaining() <= 0) finishPhase(true);
  const txt = tm.mode === 'pomo' ? fmtClock(remaining()) : fmtClock(watchElapsed());
  document.title = `${txt} · ${tm.phase === 'focus' || tm.mode === 'watch' ? 'Focus' : 'Break'}`;
  const el = document.getElementById('focus-clock'); if (el) el.textContent = txt;
  const ring = document.getElementById('focus-ring'); if (ring && tm.mode === 'pomo') ring.style.setProperty('--p', 1 - remaining() / phaseLen(tm.phase));
  const mini = document.getElementById('mini-timer'); if (mini) mini.textContent = txt;
}, 500);
addEventListener('click', () => { if (tm.running && audio?.paused && settings().pomo.sound !== 'none') playSound(); }, { once: true });

export function render(main) {
  const s = settings().pomo;
  if (!tm.running && !tm.startedAt && tm.mode === 'pomo' && tm.left !== phaseLen(tm.phase) && tm.left === (tm._len || tm.left)) tm.left = phaseLen(tm.phase);
  if (ui.focusTaskId && !tm.running) { tm.taskId = ui.focusTaskId; ui.focusTaskId = null; saveTm(); }
  const task = tm.taskId && get(tm.taskId);
  const sessions = all('focus');
  const todays = sessions.filter((f) => ymd(new Date(f.start)) === today());
  const todaySec = todays.reduce((a, f) => a + f.sec, 0);
  const totalSec = sessions.reduce((a, f) => a + f.sec, 0);
  const isBreak = tm.mode === 'pomo' && tm.phase !== 'focus';
  const txt = tm.mode === 'pomo' ? fmtClock(remaining()) : fmtClock(watchElapsed());
  const raining = tm.running && !isBreak;
  main.replaceChildren(
    h('div.view-head', h('h1', '⏱ Focus'), h('div.head-actions',
      h('div.seg', [['pomo', 'Pomodoro'], ['watch', 'Stopwatch']].map(([v, n]) => h('button' + (tm.mode === v ? '.on' : ''), { disabled: tm.running || tm.startedAt, onclick: () => { tm.mode = v; reset(); } }, n))),
      h('button.icon-btn', { title: 'Focus settings', onclick: settingsDialog }, '⚙'))),
    h('div.view-body.scroll.focus-page' + (raining ? '.raining' : '') + (isBreak ? '.break' : ''),
      h('div.rain', [...Array(40)].map((_, i) => h('i', { style: { left: (i * 37) % 100 + '%', animationDelay: ((i * 0.13) % 1.6) + 's', animationDuration: 0.7 + ((i * 7) % 5) / 10 + 's' } }))),
      h('div.focus-card',
        h('div.phase', tm.mode === 'watch' ? 'Stopwatch' : isBreak ? (tm.phase === 'long' ? 'Long break' : 'Short break') : 'Focus', tm.mode === 'pomo' ? h('span.muted', ` · round ${tm.count % s.longEvery + (isBreak ? 0 : 1)} of ${s.longEvery}`) : null),
        h('div.ring#focus-ring', { style: { '--p': tm.mode === 'pomo' ? 1 - remaining() / phaseLen(tm.phase) : 0 } }, h('div.clock#focus-clock', txt)),
        h('button.focus-task', { onclick: (e) => pickTask(e.currentTarget) }, task ? h('span', T.isOpen(task) ? '○ ' : '✓ ', task.title) : h('span.muted', '+ Pick a task to focus on (optional)')),
        h('div.focus-btns',
          !tm.running ? h('button.btn.big', { onclick: start }, tm.startedAt || (tm.mode === 'pomo' && tm.left < phaseLen(tm.phase)) || tm.elapsed ? 'Resume' : isBreak ? 'Start break' : 'Start focus')
            : s.strict && !isBreak ? h('button.btn.big.ghost', { disabled: true, title: 'Strict mode is on' }, 'Stay focused…') : h('button.btn.big.ghost', { onclick: pause }, 'Pause'),
          tm.mode === 'pomo' && (tm.running || tm.startedAt || tm.left < phaseLen(tm.phase)) ? h('button.btn.ghost', { onclick: () => finishPhase(false) }, isBreak ? 'Skip break' : 'End & save') : null,
          tm.mode === 'pomo' && !tm.running && isBreak ? h('button.btn.ghost', { onclick: () => { tm.phase = 'focus'; tm.left = phaseLen('focus'); saveTm(); emit(); } }, 'Skip break') : null,
          tm.mode === 'watch' && (tm.running || tm.elapsed) ? h('button.btn.ghost', { onclick: stopWatch }, 'Stop & save') : null,
          (tm.running || tm.startedAt || tm.elapsed) && !(s.strict && tm.running) ? h('button.btn.ghost', { onclick: async () => { reset(); } }, 'Reset') : null,
          task && T.isOpen(task) ? h('button.btn.ghost', { onclick: () => T.complete(task) }, '✓ Task done') : null),
        h('div.sound-row', h('span', '🎧'), h('select.input.sm', { onchange: (e) => { saveSettings({ pomo: { ...s, sound: e.target.value } }); setTimeout(playSound); } }, SOUNDS.map(([v, n]) => h('option', { value: v, selected: s.sound === v }, n))),
          h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.volume, oninput: (e) => { if (audio) audio.volume = Number(e.target.value); }, onchange: (e) => saveSettings({ pomo: { ...s, volume: Number(e.target.value) } }), 'aria-label': 'Volume' }))),
      h('div.stat-row', [['Today', `${todays.filter((f) => f.type === 'pomo').length} 🍅 · ${fmtDuration(todaySec)}`], ['Daily goal', `${Math.min(todays.filter((f) => f.type === 'pomo').length, s.dailyGoal)}/${s.dailyGoal}`], ['All time', fmtDuration(totalSec)], ['Sessions', sessions.length]].map(([a, b]) => h('div.stat', h('small', a), h('b', b)))),
      h('div.group', h('div.group-head', h('b', 'Focus record')),
        sessions.length ? h('div.focus-log', sessions.sort((a, b) => b.start - a.start).slice(0, 60).map((f) => h('div.fl-row',
          h('span.fl-time', new Date(f.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), ' ', new Date(f.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })),
          h('span.fl-dur', fmtDuration(f.sec)), h('span.fl-task', f.taskId && get(f.taskId) ? h('button.link', { onclick: () => openTask(f.taskId) }, get(f.taskId).title) : h('span.muted', f.type === 'watch' ? 'Stopwatch' : 'Pomodoro')),
          f.note ? h('span.fl-note', f.note) : null,
          h('button.icon-btn.sm', { onclick: (e) => menu(e.currentTarget, [{ label: 'Edit note', run: async () => { const n = await promptBox('Focus note', f.note || ''); if (n != null) patch(f.id, { note: n }); } }, { label: 'Delete record', danger: true, run: () => remove(f.id) }], { align: 'right' }) }, '⋯')))) : h('p.muted.sm', 'Your focus sessions will show here. Each one brings rain to your island.'),
        h('button.btn.ghost.sm', { onclick: addManual }, '+ Add a session manually'))));
}
function pickTask(anchor) {
  const open = T.sortTasks(T.queryFor('today').filter(T.isOpen), 'date').concat(T.live().filter((t) => T.isOpen(t) && !T.queryFor('today').includes(t))).slice(0, 40);
  menu(anchor, [{ label: 'No task', run: () => { tm.taskId = null; saveTm(); emit(); } }, '-', ...open.map((t) => ({ icon: '○', label: t.title, hint: t.estPomos ? `🍅 ${t.estPomos}` : '', run: () => { tm.taskId = t.id; saveTm(); emit(); } }))]);
}
function addManual() {
  const d = { date: today(), time: '09:00', mins: 25, taskId: '' };
  const m = modal('Add focus session', h('div.form',
    h('div.form-row', h('span', 'When'), h('input.input.sm', { type: 'date', value: d.date, onchange: (e) => { d.date = e.target.value; } }), h('input.input.sm', { type: 'time', value: d.time, onchange: (e) => { d.time = e.target.value; } })),
    h('div.form-row', h('span', 'Minutes'), h('input.input.sm', { type: 'number', min: 1, max: 600, value: d.mins, onchange: (e) => { d.mins = Number(e.target.value) || 25; } }))),
  { actions: [h('button.btn', { onclick: () => { const st = new Date(`${d.date}T${d.time}`).getTime(); put({ kind: 'focus', start: st, end: st + d.mins * 60e3, sec: d.mins * 60, type: 'manual', taskId: null, note: '' }); m.close(); } }, 'Add')] });
}
function settingsDialog() {
  const p = { ...settings().pomo };
  const num = (k, label, min, max) => h('div.form-row', h('span', label), h('input.input.sm', { type: 'number', min, max, value: p[k], style: { width: '80px' }, onchange: (e) => { p[k] = Math.max(min, Math.min(max, Number(e.target.value) || min)); } }));
  const chk = (k, label) => h('label.form-row', h('input', { type: 'checkbox', checked: !!p[k], onchange: (e) => { p[k] = e.target.checked; } }), ' ', label);
  const m = modal('Focus settings', h('div.form', num('focus', 'Focus minutes', 1, 180), num('short', 'Short break', 1, 60), num('long', 'Long break', 1, 90), num('longEvery', 'Long break every … rounds', 1, 12), num('dailyGoal', 'Daily goal (pomodoros)', 1, 30),
    chk('autoBreak', 'Start breaks automatically'), chk('autoFocus', 'Start next focus automatically'), chk('strict', 'Strict mode (no pausing during focus)'), chk('soundOnBreak', 'Keep ambient sound during breaks')),
  { actions: [h('button.btn', { onclick: () => { saveSettings({ pomo: p }); if (!tm.running && !tm.startedAt) { tm.left = phaseLen(tm.phase); saveTm(); } m.close(); emit(); } }, 'Save')] });
}
