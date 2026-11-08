// Shared UI state + navigation.
export const ui = {
  route: { view: 'tasks', key: 'today' },
  taskId: null,          // open in detail panel
  selected: new Set(),   // multi-select
  sidebarOpen: false,
  focusTaskId: null,
  calendar: { mode: 'month', date: null },
  render: () => {},
};
export function go(hash) { if (location.hash !== hash) location.hash = hash; else ui.render(); }
export function openTask(id) { ui.taskId = id; ui.selected.clear(); document.body.classList.toggle('detail-open', !!id); ui.render(); }
export function closeTask() { ui.taskId = null; document.body.classList.remove('detail-open'); ui.render(); }
