// Local-first data store. Every thing (task, list, habit...) is an object {id, kind, ...fields}.
// Saved in localStorage; when logged in, changes sync with the server.
import { uid } from './util.js';

const listeners = new Set();
const S = {
  user: null,          // {id, email, name} or null for guest
  objs: new Map(),
  rev: 0,
  dirty: new Set(),
  members: {},         // list_id -> [{id,email,name,role}]
  shared: [],          // list ids shared with me
  online: navigator.onLine,
  syncing: false,
  lastSync: 0,
  syncError: '',
};
export const store = S;
const cacheKey = () => 'cloverhaven.v1.' + (S.user ? S.user.id : 'guest');
export const me = () => (S.user ? S.user.id : 'guest');

let emitQueued = false;
export function emit() {
  if (emitQueued) return;
  emitQueued = true;
  requestAnimationFrame(() => { emitQueued = false; listeners.forEach((fn) => fn()); });
}
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export const get = (id) => { const o = S.objs.get(id); return o && !o._deleted ? o : null; };
export function all(kind, filter) {
  const out = [];
  for (const o of S.objs.values()) if (o.kind === kind && !o._deleted && (!filter || filter(o))) out.push(o);
  return out;
}

const listIdOf = (o) => (o.kind === 'task' ? o.listId : o.kind === 'comment' ? o.listId : null);

export function put(obj, { quiet = false } = {}) {
  if (!obj.id) obj.id = uid(obj.kind[0] + '_');
  if (!obj.owner) obj.owner = me();
  obj.createdAt ??= Date.now();
  obj.updatedAt = Date.now();
  S.objs.set(obj.id, obj);
  S.dirty.add(obj.id);
  saveLocal();
  if (!quiet) emit();
  schedulePush();
  return obj;
}
export function patch(id, fields, opts) {
  const o = S.objs.get(id);
  if (!o) return null;
  return put(Object.assign(o, fields), opts);
}
export function remove(id) {
  const o = S.objs.get(id);
  if (!o) return;
  o._deleted = true;
  put(o);
}

// ---------- settings + village singletons ----------
export const DEFAULT_SETTINGS = {
  theme: 'cream', autoDark: false, fontSize: 'm', weekStart: 1, clock24: false,
  defaultList: 'inbox', defaultDue: 'none', defaultPriority: 0, defaultReminder: 'm0', defaultAllDayReminder: 'd0@09:00',
  smart: { today: true, tomorrow: true, week: true, all: true, assigned: true, inbox: true, completed: true, wontdo: true, trash: true, summary: true, tags: true, filters: true },
  completedAtBottom: true, showDetails: true, sound: true, notifications: false,
  pomo: { focus: 25, short: 5, long: 15, longEvery: 4, autoBreak: false, autoFocus: false, strict: false, sound: 'none', volume: 0.6, dailyGoal: 4 },
  planReminder: '', reviewReminder: '', showWeeds: true, critterWander: true, lunar: false, showWeekNumbers: false,
  calendarShowCompleted: true, calendarShowHabits: false, calendarShowFocus: false,
  matrix: [
    { name: 'Urgent & important', rule: { priority: [5], due: 'week' } },
    { name: 'Not urgent but important', rule: { priority: [5, 3], due: 'later' } },
    { name: 'Urgent, not important', rule: { priority: [1, 0], due: 'week' } },
    { name: 'Neither', rule: { priority: [1, 0], due: 'later' } },
  ],
  sidebarCollapsed: {},
};
export function settings() {
  const id = 'settings:' + me();
  let s = S.objs.get(id);
  if (!s) { s = { id, kind: 'settings', owner: me(), ...structuredClone(DEFAULT_SETTINGS) }; S.objs.set(id, s); }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (s[k] === undefined) s[k] = structuredClone(v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) if (s[k][k2] === undefined) s[k][k2] = v2;
  }
  return s;
}
export const saveSettings = (fields) => put(Object.assign(settings(), fields));

export function village() {
  const id = 'village:' + me();
  let v = S.objs.get(id);
  if (!v) {
    v = { id, kind: 'village', owner: me(), inv: { wood: 2, stone: 1, petals: 1 }, buildings: [], critters: {}, log: [], counters: {}, days: [] };
    S.objs.set(id, v);
  }
  v.inv ??= {}; v.buildings ??= []; v.critters ??= {}; v.log ??= []; v.counters ??= {}; v.days ??= [];
  return v;
}
export const saveVillage = (opts) => put(village(), opts);

// ---------- persistence ----------
let saveTimer;
function saveLocal() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(cacheKey(), JSON.stringify({ objs: [...S.objs.values()], rev: S.rev, dirty: [...S.dirty], members: S.members, shared: S.shared }));
    } catch (e) {
      console.warn('local save failed', e);
    }
  }, 150);
}
export function flushLocal() { clearTimeout(saveTimer); try { localStorage.setItem(cacheKey(), JSON.stringify({ objs: [...S.objs.values()], rev: S.rev, dirty: [...S.dirty], members: S.members, shared: S.shared })); } catch {} }

function loadLocal() {
  S.objs = new Map(); S.rev = 0; S.dirty = new Set(); S.members = {}; S.shared = [];
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey()) || 'null');
    if (raw) {
      for (const o of raw.objs || []) S.objs.set(o.id, o);
      S.rev = raw.rev || 0; S.dirty = new Set(raw.dirty || []); S.members = raw.members || {}; S.shared = raw.shared || [];
    }
  } catch {}
}

// ---------- server api ----------
export async function api(path, body, method) {
  const res = await fetch(path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) { const err = new Error(data.error || `Something went wrong (${res.status})`); err.status = res.status; throw err; }
  return data;
}

export async function boot() {
  try {
    const { user } = await api('/api/auth/me');
    S.user = user;
  } catch {
    // offline or no server: use the last account we knew about
    const last = localStorage.getItem('cloverhaven.lastUser');
    S.user = last ? JSON.parse(last) : null;
  }
  loadLocal();
  if (S.user) { localStorage.setItem('cloverhaven.lastUser', JSON.stringify(S.user)); await pull(); }
  return S.user;
}

export function isGuest() { return !S.user; }
export function guestMode() { return localStorage.getItem('cloverhaven.guest') === '1'; }
export function setGuestMode(v) { if (v) localStorage.setItem('cloverhaven.guest', '1'); else localStorage.removeItem('cloverhaven.guest'); }

export async function login(email, password, signup = false, name = '') {
  const guestObjs = isGuest() ? [...S.objs.values()] : [];
  const { user } = await api(signup ? '/api/auth/signup' : '/api/auth/login', { email, password, name });
  S.user = user;
  localStorage.setItem('cloverhaven.lastUser', JSON.stringify(user));
  loadLocal();
  // bring guest work into a brand-new account
  if (signup && guestObjs.length) {
    for (const o of guestObjs) {
      const copy = { ...o, owner: user.id };
      if (o.kind === 'settings') copy.id = 'settings:' + user.id;
      if (o.kind === 'village') copy.id = 'village:' + user.id;
      S.objs.set(copy.id, copy); S.dirty.add(copy.id);
    }
    localStorage.removeItem('cloverhaven.v1.guest');
  }
  setGuestMode(false);
  await pull();
  await push();
  emit();
  return user;
}
export async function logout() {
  await push().catch(() => {});
  flushLocal();
  try { await api('/api/auth/logout', {}); } catch {}
  localStorage.removeItem('cloverhaven.lastUser');
  S.user = null;
  location.hash = '';
  location.reload();
}

export async function pull() {
  if (!S.user) return;
  try {
    S.syncing = true;
    const data = await api('/api/sync?since=' + (S.rev || 0));
    for (const r of data.objects) {
      if (S.dirty.has(r.id)) continue; // local edit not pushed yet wins
      const o = { ...r.data, id: r.id, kind: r.kind, owner: r.owner };
      if (r.deleted) o._deleted = true;
      S.objs.set(r.id, o);
    }
    // lists that were un-shared from me disappear
    const newShared = data.shared || [];
    for (const lid of S.shared) if (!newShared.includes(lid)) {
      for (const o of [...S.objs.values()]) if ((o.id === lid || o.listId === lid) && o.owner !== S.user.id) S.objs.delete(o.id);
    }
    S.shared = newShared;
    S.members = data.members || {};
    S.rev = data.rev;
    if (data.user) S.user = data.user;
    S.lastSync = Date.now(); S.syncError = ''; S.online = true;
    saveLocal();
    emit();
  } catch (e) {
    S.syncError = e.status === 401 ? 'login' : 'offline';
    if (e.status === 401) { S.user = null; localStorage.removeItem('cloverhaven.lastUser'); emit(); }
  } finally { S.syncing = false; }
}

let pushTimer, pushing = null;
function schedulePush() { if (!S.user) return; clearTimeout(pushTimer); pushTimer = setTimeout(push, 800); }
export async function push() {
  if (!S.user || !S.dirty.size) return;
  if (pushing) return pushing;
  const ids = [...S.dirty];
  const stamp = new Map(ids.map((id) => [id, S.objs.get(id)?.updatedAt]));
  const objects = ids.map((id) => S.objs.get(id)).filter(Boolean).map((o) => {
    const { id, kind, owner, _deleted, ...data } = o;
    return { id, kind, list_id: listIdOf(o) && listIdOf(o) !== 'inbox' ? listIdOf(o) : null, deleted: !!_deleted, data };
  });
  pushing = (async () => {
    try {
      for (let i = 0; i < objects.length; i += 300) {
        const res = await api('/api/sync', { objects: objects.slice(i, i + 300) });
        for (const id of [...res.saved, ...res.rejected]) {
          const o = S.objs.get(id);
          if (!o || o.updatedAt === stamp.get(id)) S.dirty.delete(id);
        }
      }
      S.syncError = ''; S.online = true;
      saveLocal();
    } catch (e) {
      S.syncError = 'offline';
    } finally { pushing = null; }
    emit();
  })();
  return pushing;
}

export function startSyncLoop() {
  setInterval(() => { if (S.user && !document.hidden) { push().then(pull); } }, 20000);
  addEventListener('focus', () => { if (S.user) push().then(pull); });
  addEventListener('online', () => { S.online = true; push().then(pull); });
  addEventListener('offline', () => { S.online = false; emit(); });
  addEventListener('beforeunload', flushLocal);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { flushLocal(); push(); } });
}

// ---------- backup ----------
export function exportAll() {
  return JSON.stringify({ app: 'cloverhaven', version: 1, exportedAt: new Date().toISOString(), objects: [...S.objs.values()].filter((o) => !o._deleted) }, null, 1);
}
export function importAll(json, { replace = false } = {}) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || data.app !== 'cloverhaven' || !Array.isArray(data.objects)) throw new Error("That isn't a Pocket Isle backup file.");
  if (replace) for (const o of S.objs.values()) if (o.owner === me() && o.kind !== 'settings' && o.kind !== 'village') { o._deleted = true; S.dirty.add(o.id); }
  for (const o of data.objects) {
    const copy = { ...o, owner: me() };
    if (o.kind === 'settings') copy.id = 'settings:' + me();
    if (o.kind === 'village') copy.id = 'village:' + me();
    S.objs.set(copy.id, copy); S.dirty.add(copy.id);
  }
  saveLocal(); schedulePush(); emit();
  return data.objects.length;
}
