// Countdowns and anniversaries: days until (or since) the dates that matter.
import { h, today, ymd, parseD, diffDays, modal, toast, confirmBox, menu, fmtDay, plural } from '../util.js';
import { all, put, patch, remove } from '../store.js';
import { emptyState } from '../widgets.js';

const EMO = ['🎂', '✈️', '🎓', '💍', '🎄', '🎉', '📝', '🏖️', '❤️', '🎮', '🎬', '🌸'];
export function nextDate(c) {
  if (!c.yearly) return c.date;
  const T = today(); const [, m, d] = c.date.split('-');
  let y = Number(T.slice(0, 4)); let n = `${y}-${m}-${d}`;
  if (n < T) n = `${y + 1}-${m}-${d}`;
  return n;
}
export function render(main) {
  const cs = all('countdown').sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || nextDate(a).localeCompare(nextDate(b)));
  main.replaceChildren(
    h('div.view-head', h('h1', '⏳ Countdown'), h('div.head-actions', h('button.btn.sm', { onclick: () => editor(null) }, '+ New'))),
    h('div.view-body.scroll',
      !cs.length ? emptyState('c_turtle', 'Nothing to count down to yet', 'Add birthdays, trips, exams or anniversaries.') : null,
      h('div.cd-grid', cs.map((c) => {
        const nd = nextDate(c), n = diffDays(nd, today());
        const since = !c.yearly && n < 0;
        const yrs = c.yearly ? Number(nd.slice(0, 4)) - Number(c.date.slice(0, 4)) : 0;
        const span = c.createdAt ? Math.max(1, diffDays(nd, ymd(new Date(c.createdAt)))) : 30;
        return h('div.cd-card', { style: { '--cc': c.color || '#f2c6a0' }, onclick: (e) => { if (!e.target.closest('button')) editor(c); } },
          h('div.cd-top', h('span.cd-emo', c.emoji || '⏳'), c.pinned ? h('span', '📌') : null, h('button.icon-btn.sm', { onclick: (e) => menu(e.currentTarget, [
            { label: c.pinned ? 'Unpin' : 'Pin to top', run: () => patch(c.id, { pinned: !c.pinned }) }, { label: 'Edit', run: () => editor(c) },
            { label: 'Delete', danger: true, run: async () => { if (await confirmBox('Delete countdown?', c.name, 'Delete', true)) remove(c.id); } }], { align: 'right' }) }, '⋯')),
          h('b.cd-name', c.name),
          h('div.cd-num', n === 0 ? 'Today!' : Math.abs(n)), n ? h('small', since ? (Math.abs(n) === 1 ? 'day since' : 'days since') : n === 1 ? 'day to go' : 'days to go') : null,
          h('div.muted.sm', fmtDay(nd, { long: true }), c.yearly && yrs > 0 ? ` · ${c.type === 'birthday' ? 'turns ' + yrs : plural(yrs, 'year')}` : ''),
          !since && n > 0 ? h('div.progress', h('div', { style: { width: Math.max(3, 100 - (n / span) * 100) + '%' } })) : null,
          c.note ? h('p.sm', c.note) : null);
      }))));
}
function editor(c) {
  const isNew = !c;
  const d = c ? { ...c } : { kind: 'countdown', name: '', date: today(), emoji: '🎉', yearly: false, color: '#f2c6a0', note: '', kindOf: 'countdown' };
  const body = h('div.form');
  const draw = () => body.replaceChildren(
    h('input.input', { placeholder: 'What are you counting to?', value: d.name, oninput: (e) => { d.name = e.target.value; } }),
    h('div.emoji-grid', EMO.map((e) => h('button.emoji' + (d.emoji === e ? '.on' : ''), { onclick: () => { d.emoji = e; draw(); } }, e))),
    h('div.form-row', h('span', 'Date'), h('input.input.sm', { type: 'date', value: d.date, onchange: (e) => { d.date = e.target.value; } })),
    h('div.form-row', h('span', 'Type'), h('select.input.sm', { onchange: (e) => { d.kind = 'countdown'; d.type = e.target.value; d.yearly = e.target.value !== 'once'; draw(); } },
      [['once', 'One time'], ['anniversary', 'Every year (anniversary)'], ['birthday', 'Birthday']].map(([v, n]) => h('option', { value: v, selected: (d.type || (d.yearly ? 'anniversary' : 'once')) === v }, n)))),
    h('div.color-row', ['#f2c6a0', '#f4b6c2', '#bcd9a8', '#a9cbe8', '#d6c1ec', '#f6dd8b'].map((col) => h('button.swatch' + (d.color === col ? '.on' : ''), { style: { background: col }, onclick: () => { d.color = col; draw(); } }))),
    h('textarea.input', { placeholder: 'Note (optional)', value: d.note || '', oninput: (e) => { d.note = e.target.value; } }));
  draw();
  const m = modal(isNew ? 'New countdown' : 'Edit countdown', body, { actions: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), h('button.btn', { onclick: () => { if (!d.name.trim() || !d.date) return toast('Add a name and date'); d.kind = 'countdown'; if (d.type === 'birthday') d.kindOf = 'birthday'; isNew ? put(d) : patch(c.id, d); m.close(); } }, 'Save')] });
}
