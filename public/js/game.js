// The island: finished tasks give materials, materials build the village, habits are crops,
// overdue tasks are weeds, focus brings rain + sea glass, and hidden neighbours move in.
import { all, get, village, saveVillage, settings } from './store.js';
import { today, ymd, dayOf, parseD, diffDays, addDays } from './util.js';
import * as T from './tasks.js';

export const RES = {
  wood: { name: 'Wood', img: 'r_wood', note: 'from lists that use wood' },
  stone: { name: 'Stone', img: 'r_stone', note: 'from lists that use stone' },
  petals: { name: 'Petals', img: 'r_petals', note: 'from lists that use petals' },
  fish: { name: 'Fish', img: 'r_fish', note: 'from lists that use fish' },
  clay: { name: 'Clay', img: 'r_clay', note: 'from lists that use clay' },
  wool: { name: 'Wool', img: 'r_wool', note: 'from lists that use wool' },
  seaglass: { name: 'Sea glass', img: 'r_seaglass', note: 'from focus sessions' },
  harvest: { name: 'Harvest', img: 'r_harvest', note: 'from habit crops' },
};
export const LIST_RES = ['wood', 'stone', 'petals', 'fish', 'clay', 'wool'];
export const resImg = (r) => `assets/${RES[r]?.img || 'r_wood'}.webp`;

export const BUILDINGS = {
  cottage: { name: 'Cottage', cost: { wood: 4, stone: 2 }, max: 4, homes: 3, effect: 'A home for 3 neighbours.' },
  well: { name: 'Stone Well', cost: { stone: 4 }, effect: 'Crops forgive one missed day before drooping.' },
  market: { name: 'Market Stall', cost: { wood: 4, petals: 3 }, effect: 'Trade 3 of one material for 1 of another.' },
  bakery: { name: 'Bakery', cost: { wood: 5, stone: 3, harvest: 2 }, effect: 'Your first finished task each day gives double.' },
  windmill: { name: 'Windmill', cost: { wood: 6, wool: 2, harvest: 3 }, effect: 'Habits give a harvest every 2 check-ins instead of 3.' },
  library: { name: 'Library', cost: { stone: 6, wood: 4, wool: 2 }, effect: 'Writes a weekly recap into your island journal.' },
  greenhouse: { name: 'Greenhouse', cost: { stone: 4, clay: 3, petals: 4 }, effect: 'Room for 4 more habit crops.' },
  teahouse: { name: 'Tea House', cost: { clay: 4, petals: 3, wood: 3 }, effect: 'Finished focus breaks give a petal.' },
  pottery: { name: 'Pottery', cost: { clay: 6, stone: 3 }, effect: 'Ticking off a whole checklist gives +1 clay.' },
  fishhut: { name: 'Fishing Hut', cost: { wood: 4, fish: 4 }, shore: true, effect: 'Tasks finished on or before their date give +1 fish.' },
  dock: { name: 'Dock', cost: { wood: 8, fish: 3 }, shore: true, effect: 'Every 10th finished task, a boat drops off 3 random materials.' },
  lighthouse: { name: 'Lighthouse', cost: { stone: 10, seaglass: 4 }, shore: true, effect: 'Focus sessions after dark give +1 sea glass.' },
  gazebo: { name: 'Rose Gazebo', cost: { petals: 8, wood: 3 }, effect: 'Neighbours leave you a small gift each day you visit.' },
  clocktower: { name: 'Clock Tower', cost: { stone: 8, wood: 4, seaglass: 2 }, effect: 'Timed tasks finished before their time give +1.' },
  observatory: { name: 'Observatory', cost: { stone: 8, seaglass: 6, wool: 3 }, effect: 'Reveals the hint for every hidden neighbour.' },
  treehouse: { name: 'Treehouse', cost: { wood: 10, wool: 4 }, max: 3, homes: 2, effect: 'A cosy home for 2 neighbours.' },
};

export const CRITTERS = {
  fox: { name: 'Fern the Fox', hint: 'Rises before the sun.', how: 'You finished a task before 8am.', say: 'Early mornings smell like dew!' },
  owl: { name: 'Professor Hoot', hint: 'Keeps company with night workers.', how: 'You finished a task after 11pm.', say: "Who's up late? Hoo, hoo." },
  hedgehog: { name: 'Bramble', hint: 'Loves a busy, busy day.', how: 'You finished 5 tasks in one day.', say: 'Five apples in one day!' },
  frog: { name: 'Lily', hint: 'Comes out when it has rained three times in a day.', how: 'You did 3 focus sessions in one day.', say: 'Ribbit! Such lovely rain.' },
  rabbit: { name: 'Clover', hint: 'Visits a garden where every crop was watered today.', how: 'You checked in every habit in one day.', say: 'Every sprout watered!' },
  cat: { name: 'Mochi', hint: 'Respects a proper nap.', how: 'You took a full focus break.', say: 'Mrrp. Rest is work too.' },
  duck: { name: 'Captain Puddle', hint: 'Lands only on an empty inbox.', how: 'You emptied your Inbox.', say: 'Clear waters ahead, captain!' },
  deer: { name: 'Willow', hint: 'Trusts a crop tended seven days running.', how: 'You kept a habit going 7 days in a row.', say: 'Seven days of care. I feel safe here.' },
  raccoon: { name: 'Rummage', hint: 'Digs up things long forgotten.', how: 'You finished a task that was a week overdue.', say: 'Found it under all those weeds!' },
  otter: { name: 'Pebble', hint: 'Needs somewhere to tie a boat.', how: 'You built the dock.', say: 'Nice dock. Mind if I float?' },
  redpanda: { name: 'Ember', hint: 'Drawn to five long hours of quiet focus.', how: 'You reached 5 hours of focus in total.', say: 'Tea and quiet. Perfect.' },
  mole: { name: 'Digby', hint: 'Follows the gardener who pulled five weeds.', how: 'You cleared 5 weeds (overdue tasks).', say: 'The soil is breathing again!' },
  snail: { name: 'Shelly', hint: 'Slow and steady wins. Patience three times over.', how: 'You finished a task you had pushed back 3 times.', say: 'Slow is still forward.' },
  turtle: { name: 'Old Moss', hint: 'Arrives on the tide after fourteen visits.', how: 'You visited your island on 14 different days.', say: 'Fourteen tides. I like it here.' },
};

// positions on the island art (percent of width/height, anchored bottom-centre)
export const PLOTS = [
  { x: 23, y: 33 }, { x: 36, y: 25 }, { x: 50, y: 20 }, { x: 14, y: 47 }, { x: 28, y: 46 }, { x: 43, y: 38 },
  { x: 57, y: 31 }, { x: 22, y: 60 }, { x: 84, y: 36 }, { x: 74, y: 47 }, { x: 88, y: 55 }, { x: 60, y: 14 },
  { x: 47, y: 56 }, { x: 38, y: 13 }, { x: 70, y: 29 }, { x: 12, y: 60 },
];
export const SHORE = [{ x: 8, y: 78 }, { x: 60, y: 92 }, { x: 94, y: 22 }, { x: 4, y: 38 }];
export const FARM = [
  { x: 58, y: 64 }, { x: 66, y: 66 }, { x: 74, y: 65 }, { x: 82, y: 64 }, { x: 62, y: 74 }, { x: 70, y: 76 },
  { x: 78, y: 75 }, { x: 86, y: 72 }, { x: 54, y: 72 }, { x: 90, y: 64 },
];
export const CROPS = ['sunflower', 'tulip', 'pumpkin', 'strawberry', 'wheat', 'lavender', 'cabbage', 'carrot'];

const v = () => village();
const has = (b) => v().buildings.some((x) => x.type === b);
const count = (b) => v().buildings.filter((x) => x.type === b).length;
export const hasBuilding = has;

function log(text, icon) {
  v().log.unshift({ at: Date.now(), text, icon });
  v().log = v().log.slice(0, 300);
}
function give(loot, reason) {
  const inv = v().inv;
  for (const [r, n] of Object.entries(loot)) inv[r] = (inv[r] || 0) + n;
  dispatchEvent(new CustomEvent('loot', { detail: { loot, reason } }));
}
function addLoot(loot, r, n) { if (n > 0) loot[r] = (loot[r] || 0) + n; }
const dayCount = (key) => { const c = v().counters; const k = key + ':' + today(); return (c[k] = (c[k] || 0) + 1); };
function cleanCounters() {
  const c = v().counters, keep = ymd(addDays(today(), -2));
  for (const k of Object.keys(c)) { const d = k.split(':')[1]; if (d && /^\d{4}-/.test(d) && d < keep) delete c[k]; }
}

export function listResource(listId) {
  const l = T.listById(listId);
  return LIST_RES.includes(l.resource) ? l.resource : 'wood';
}

// ---------- events from the planner ----------
export function onComplete(t) {
  if (t.loot) return;
  const now = new Date();
  const r = listResource(t.listId);
  const loot = {};
  let n = 1 + (t.priority === 5 ? 2 : t.priority === 3 ? 1 : 0) + Math.floor((t.items || []).length / 3);
  if (dayCount('firstDone') === 1 && has('bakery')) n *= 2;
  addLoot(loot, r, n);
  const onTime = !t.due || dayOf(t.due) >= today();
  if (has('fishhut') && t.due && dayOf(t.due) >= today()) addLoot(loot, 'fish', 1);
  if (has('clocktower') && t.due && t.due.includes('T') && parseD(t.due) > now) addLoot(loot, r, 1);
  if (has('pottery') && (t.items || []).length >= 2 && t.items.every((i) => i.done)) addLoot(loot, 'clay', 1);
  const c = v().counters;
  c.tasksDone = (c.tasksDone || 0) + 1;
  if (has('dock') && c.tasksDone % 10 === 0) {
    for (let i = 0; i < 3; i++) addLoot(loot, LIST_RES[Math.floor(Math.random() * LIST_RES.length)], 1);
    log('A little boat docked and left you a crate of materials.', 'b_dock');
  }
  const overdueDays = t.due && !onTime ? diffDays(today(), t.due) : 0;
  if (overdueDays > 0) {
    c.weedsCleared = (c.weedsCleared || 0) + 1;
    log(`Cleared the weeds around "${short(t.title)}".`, 'p_weeds');
  }
  t.loot = loot;
  give(loot, 'task');
  const done = dayCount('done');
  const h = now.getHours();
  if (h < 8 && h >= 3) arrive('fox');
  if (h >= 23 || h < 3) arrive('owl');
  if (done >= 5) arrive('hedgehog');
  if (overdueDays >= 7) arrive('raccoon');
  if ((c.weedsCleared || 0) >= 5) arrive('mole');
  if ((t.postponed || 0) >= 3) arrive('snail');
  setTimeout(checkInbox, 50);
  cleanCounters();
  saveVillage();
}
export function onUncomplete(t) {
  if (!t.loot) return;
  const inv = v().inv;
  for (const [r, n] of Object.entries(t.loot)) inv[r] = Math.max(0, (inv[r] || 0) - n);
  const c = v().counters; c.tasksDone = Math.max(0, (c.tasksDone || 0) - 1);
  t.loot = null;
  saveVillage();
}
let hadInbox = false;
function checkInbox() {
  const open = T.queryFor('inbox').filter(T.isOpen).length;
  if (hadInbox && open === 0) arrive('duck');
  hadInbox = open > 0;
}
export function noteInbox() { hadInbox = T.queryFor('inbox').filter(T.isOpen).length > 0; }

export function onFocus(sec, { kind = 'focus', at = new Date() } = {}) {
  const c = v().counters;
  if (kind === 'break') {
    if (sec >= 240) { arrive('cat'); if (has('teahouse')) give({ petals: 1 }, 'break'); }
    saveVillage(); return;
  }
  if (sec < 300) return;
  const loot = {};
  addLoot(loot, 'seaglass', Math.max(1, Math.round(sec / 1500)));
  const hr = at.getHours();
  if (has('lighthouse') && (hr >= 19 || hr < 5)) addLoot(loot, 'seaglass', 1);
  give(loot, 'focus');
  v().rainUntil = Date.now() + 45 * 60e3;
  c.focusSec = (c.focusSec || 0) + sec;
  if (dayCount('focus') >= 3) arrive('frog');
  if (c.focusSec >= 5 * 3600) arrive('redpanda');
  saveVillage();
}

export function onHabitCheck(habit, allDoneToday, streak) {
  const per = has('windmill') ? 2 : 3;
  const total = Object.values(habit.records || {}).filter((x) => x > 0).length;
  const earned = Math.floor(total / per);
  habit.harvested = habit.harvested || 0;
  if (earned > habit.harvested) { give({ harvest: earned - habit.harvested }, 'habit'); }
  habit.harvested = Math.max(habit.harvested, earned);
  if (allDoneToday) arrive('rabbit');
  if (streak >= 7) arrive('deer');
  saveVillage();
}

export function onVisitIsland() {
  const d = today(), V = v();
  if (!V.days.includes(d)) {
    V.days.push(d); V.days = V.days.slice(-400);
    if (has('gazebo')) {
      const n = homed().length;
      if (n) { const r = LIST_RES[Math.floor(Math.random() * LIST_RES.length)]; give({ [r]: Math.min(3, n) }, 'gift'); log(`Your neighbours left you ${Math.min(3, n)} ${RES[r].name.toLowerCase()} at the gazebo.`, 'b_gazebo'); }
    }
    if (has('library')) weeklyRecap();
    dividends();
  }
  if (V.days.length >= 14) arrive('turtle');
  settleCritters();
  saveVillage();
}

function weeklyRecap() {
  const V = v();
  const wk = ymd(addDays(today(), -((new Date().getDay() + 6) % 7)));
  if (V.lastRecap === wk) return;
  V.lastRecap = wk;
  const since = parseD(ymd(addDays(wk, -7))).getTime(), until = parseD(wk).getTime();
  const done = all('task', (t) => t.completedAt >= since && t.completedAt < until).length;
  const focus = all('focus', (f) => f.start >= since && f.start < until).reduce((a, f) => a + (f.sec || 0), 0);
  log(`The library's weekly recap: ${done} tasks finished and ${Math.round(focus / 60)} minutes of focus last week.`, 'b_library');
}

// ---------- neighbours ----------
export function capacity() { return v().buildings.reduce((a, b) => a + (BUILDINGS[b.type]?.homes ? BUILDINGS[b.type].homes + lvl(b) - 1 : 0), 0); }
export const homed = () => Object.entries(v().critters).filter(([, c]) => c.home).map(([k]) => k);
export const waiting = () => Object.entries(v().critters).filter(([, c]) => !c.home).map(([k]) => k);
export function arrive(key) {
  const V = v();
  if (V.critters[key]) return;
  V.critters[key] = { at: Date.now(), home: false };
  log(`${CRITTERS[key].name} came to visit! ${CRITTERS[key].how}`, 'c_' + key);
  settleCritters();
  dispatchEvent(new CustomEvent('critter', { detail: { key } }));
}
function settleCritters() {
  const V = v();
  let free = capacity() - homed().length;
  for (const k of waiting()) if (free > 0) { V.critters[k].home = true; free--; log(`${CRITTERS[k].name} moved into your village.`, 'c_' + k); }
}

// ---------- building ----------
export function canAfford(cost) { const inv = v().inv; return Object.entries(cost).every(([r, n]) => (inv[r] || 0) >= n); }
export function canBuild(type) {
  const b = BUILDINGS[type];
  return canAfford(b.cost) && v().buildings.filter((x) => x.type === type && onIsle(x)).length < (b.max || 1) && freeSpots(b.shore).length > 0;
}
export function freeSpots(shore) {
  const spots = shore ? SHORE : PLOTS;
  const used = new Set(v().buildings.filter((b) => onIsle(b) && !!BUILDINGS[b.type]?.shore === !!shore).map((b) => b.plot));
  return spots.map((p, i) => ({ ...p, i })).filter((p) => !used.has(p.i));
}
export function build(type, plot) {
  const b = BUILDINGS[type], V = v();
  if (!canAfford(b.cost)) return false;
  for (const [r, n] of Object.entries(b.cost)) V.inv[r] -= n;
  V.buildings.push({ id: Date.now().toString(36), type, plot, isle: curIsle(), at: Date.now() });
  log(`You built the ${b.name}.`, 'b_' + type);
  if (type === 'dock') arrive('otter');
  settleCritters();
  saveVillage();
  return true;
}
export function moveBuilding(id, plot) {
  const b = v().buildings.find((x) => x.id === id);
  if (b) { b.plot = plot; saveVillage(); }
}
export function trade(from, to) {
  const inv = v().inv;
  if ((inv[from] || 0) < 3 || from === to) return false;
  inv[from] -= 3; inv[to] = (inv[to] || 0) + 1;
  log(`Traded 3 ${RES[from].name.toLowerCase()} for 1 ${RES[to].name.toLowerCase()} at the market.`, 'b_market');
  saveVillage();
  return true;
}

// ---------- crops (habits) + weeds (overdue tasks) ----------
export function cropStage(habit, recordsFn) {
  // looks at the last 7 days the habit was due: how many were checked in
  const { due, done, missedRun } = recordsFn(habit);
  const forgiving = has('well') ? 1 : 0;
  const droop = missedRun > 1 + forgiving;
  const rate = due ? done / due : 0;
  const stage = done === 0 ? 0 : rate >= 0.7 && done >= 3 ? 2 : 1;
  return { stage, droop };
}
export function cropImg(habit, stage) {
  if (stage === 0) return 'assets/p_seed.webp';
  if (stage === 1) return 'assets/p_grow.webp';
  return `assets/p_${CROPS.includes(habit.crop) ? habit.crop : 'sunflower'}.webp`;
}
export function weeds() {
  if (!settings().showWeeds) return [];
  return T.live().filter((t) => T.isOverdue(t) && !t.parentId).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 24);
}
const short = (s) => (s.length > 40 ? s.slice(0, 38) + '…' : s);
export function hash(s) { let x = 2166136261; for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; }

export function timeOfDay(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}
export function season(d = new Date()) { const m = d.getMonth(); return m <= 1 || m === 11 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn'; }

// ---------- forever: more islands, decorations, monthly items, requests, upgrades ----------
export const ISLES = [
  { key: 'meadow', name: 'Clover Meadow', img: 'island' },
  { key: 'forest', name: 'Mistwood', img: 'island_forest' },
  { key: 'blossom', name: 'Petal Bay', img: 'island_blossom' },
  { key: 'snow', name: 'Frostfern', img: 'island_snow' },
];
const ROMAN = ['', '', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];
export const curIsle = () => v().isle || 0;
export const isleCount = () => v().isles || 1;
export const isleImg = (n = curIsle()) => `assets/${ISLES[n % ISLES.length].img}.webp`;
export function isleName(n = curIsle()) { const r = Math.floor(n / ISLES.length) + 1; return ISLES[n % ISLES.length].name + (ROMAN[r] ?? ' ' + r); }
export const onIsle = (b, n = curIsle()) => (b.isle || 0) === n;
export const SAIL_NEED = 8;
export const sailCost = (n = isleCount()) => ({ wood: 12 + 8 * n, stone: 8 + 6 * n, fish: 4 + 4 * n, seaglass: 2 + 2 * n });
export const sailProgress = () => v().buildings.filter((b) => onIsle(b, isleCount() - 1)).length;
export const canSail = () => sailProgress() >= SAIL_NEED && canAfford(sailCost());
function spend(cost) { const inv = v().inv; for (const [r, n] of Object.entries(cost)) inv[r] = (inv[r] || 0) - n; }
export function sail() {
  if (!canSail()) return false;
  const V = v();
  spend(sailCost());
  V.isles = isleCount() + 1; V.isle = V.isles - 1;
  log(`You sailed to a brand new island: ${isleName(V.isle)}!`, 'x_boat');
  saveVillage();
  return true;
}
export function goIsle(n) { v().isle = Math.max(0, Math.min(isleCount() - 1, n)); saveVillage(); }

export const DECOR = {
  lamp: { name: 'Lamp Post', cost: { stone: 2, seaglass: 1 }, size: 4 },
  bench: { name: 'Bench', cost: { wood: 3 }, size: 6 },
  fence: { name: 'Picket Fence', cost: { wood: 2 }, size: 6 },
  flowerbed: { name: 'Flower Bed', cost: { wood: 1, petals: 3 }, size: 6 },
  mailbox: { name: 'Mailbox', cost: { wood: 1, clay: 1 }, size: 3.5 },
  birdbath: { name: 'Bird Bath', cost: { stone: 3 }, size: 4.5 },
  signpost: { name: 'Signpost', cost: { wood: 2 }, size: 4 },
  scarecrow: { name: 'Scarecrow', cost: { wool: 2, harvest: 1 }, size: 5 },
  fountain: { name: 'Fountain', cost: { stone: 6, seaglass: 2 }, size: 7 },
  campfire: { name: 'Campfire', cost: { wood: 3, stone: 2 }, size: 5 },
  haybale: { name: 'Hay Bale', cost: { harvest: 2 }, size: 4.5 },
  barrels: { name: 'Barrels', cost: { wood: 3, fish: 1 }, size: 5 },
  picnic: { name: 'Picnic Blanket', cost: { wool: 2, harvest: 1 }, size: 6 },
  swing: { name: 'Tree Swing', cost: { wood: 5, wool: 1 }, size: 7 },
  beehive: { name: 'Beehive', cost: { wood: 2, petals: 2 }, size: 4.5 },
  lilypond: { name: 'Lily Pond', cost: { stone: 3, fish: 2 }, size: 7 },
  rosearch: { name: 'Rose Arch', cost: { wood: 3, petals: 4 }, size: 6 },
  bunnystatue: { name: 'Bunny Statue', cost: { stone: 4, clay: 2 }, size: 4.5 },
};
export const SEASONAL = {
  snowman: { name: 'Snowman', month: 0, cost: { wool: 3, stone: 2 }, size: 5 },
  heartlanterns: { name: 'Heart Lanterns', month: 1, cost: { petals: 4, wood: 2 }, size: 6 },
  kite: { name: 'Kite', month: 2, cost: { wool: 2, wood: 2 }, size: 5 },
  sakura: { name: 'Cherry Tree', month: 3, cost: { petals: 6, wood: 3 }, size: 8 },
  maypole: { name: 'Maypole', month: 4, cost: { wool: 3, wood: 3 }, size: 6 },
  umbrella: { name: 'Beach Umbrella', month: 5, cost: { wool: 3, fish: 2 }, size: 7 },
  sandcastle: { name: 'Sandcastle', month: 6, cost: { stone: 3, seaglass: 1 }, size: 6 },
  lanterns: { name: 'Paper Lanterns', month: 7, cost: { petals: 3, wood: 3 }, size: 8 },
  applecart: { name: 'Apple Cart', month: 8, cost: { harvest: 4, wood: 3 }, size: 6 },
  pumpkins: { name: 'Pumpkin Pile', month: 9, cost: { harvest: 5 }, size: 6 },
  leafpile: { name: 'Leaf Pile', month: 10, cost: { wood: 3, petals: 2 }, size: 6 },
  xmastree: { name: 'Festive Pine', month: 11, cost: { wood: 5, seaglass: 2 }, size: 7 },
};
export const RARE = {
  grandfountain: { name: 'Grand Fountain', size: 10 }, balloon: { name: 'Hot Air Balloon', size: 8 }, mushroomhouse: { name: 'Mushroom House', size: 9 },
  rainbow: { name: 'Rainbow Arch', size: 9 }, geode: { name: 'Crystal Geode', size: 7 }, totem: { name: 'Critter Totem', size: 5 },
  icecream: { name: 'Ice Cream Cart', size: 7 }, carousel: { name: 'Carousel', size: 10 }, koipond: { name: 'Koi Pond', size: 10 },
};
export const decorInfo = (k) => DECOR[k] || SEASONAL[k] || RARE[k] || { name: k, size: 5 };
export const seasonalNow = (d = new Date()) => Object.keys(SEASONAL).filter((k) => SEASONAL[k].month === d.getMonth());
export const stash = () => (v().stash ||= {});
export const decorHere = () => (v().decor || []).filter((d) => onIsle(d));
export function buyDecor(k) {
  const info = DECOR[k] || SEASONAL[k];
  if (!info || (SEASONAL[k] && SEASONAL[k].month !== new Date().getMonth()) || !canAfford(info.cost)) return false;
  spend(info.cost);
  stash()[k] = (stash()[k] || 0) + 1;
  saveVillage();
  return true;
}
export function placeDecor(k, x, y) {
  const s = stash();
  if (!s[k]) return false;
  if (!--s[k]) delete s[k];
  (v().decor ||= []).push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type: k, isle: curIsle(), x, y });
  saveVillage();
  return true;
}
export function moveDecor(id, x, y) { const d = (v().decor || []).find((o) => o.id === id); if (d) { d.x = x; d.y = y; saveVillage(); } }
export function storeDecor(id) {
  const V = v(), d = (V.decor || []).find((o) => o.id === id);
  if (!d) return;
  V.decor = V.decor.filter((o) => o !== d);
  stash()[d.type] = (stash()[d.type] || 0) + 1;
  saveVillage();
}

function rng(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function requests() {
  const V = v(), d = today();
  if (!V.requests || V.requests.day !== d) V.requests = { day: d, list: makeRequests(d) };
  return V.requests.list;
}
function makeRequests(d) {
  const V = v(), r = rng(hash(d + (V.owner || '')));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const found = Object.keys(V.critters);
  const pool = found.length ? found : ['fox', 'rabbit', 'duck'];
  const scale = 3 + Math.min(20, Math.floor(V.buildings.length / 2) + isleCount() - 1);
  const res = Object.keys(RES), rares = Object.keys(RARE), got = V.rareGot || {};
  const missing = rares.filter((k) => !got[k]);
  return [0, 1, 2].map((i) => {
    const a = pick(res);
    let b = pick(res);
    if (b === a) b = res[(res.indexOf(a) + 1) % res.length];
    const rare = i === 0 && r() < 0.6;
    const mul = rare ? 2 : 1;
    const ask = { [a]: (scale + Math.floor(r() * 4)) * mul, [b]: (Math.ceil(scale / 2) + Math.floor(r() * 3)) * mul };
    let reward;
    if (rare) reward = { rare: missing.length ? pick(missing) : pick(rares) };
    else if (i < 2) reward = { decor: pick(Object.keys(DECOR)) };
    else reward = { loot: { [pick(res.filter((x) => !(x in ask)))]: scale * 2, seaglass: 1 } };
    return { who: pick(pool), ask, reward, done: false };
  });
}
export function fulfil(i) {
  const q = requests()[i];
  if (!q || q.done || !canAfford(q.ask)) return false;
  spend(q.ask);
  q.done = true;
  const s = stash(), nm = CRITTERS[q.who]?.name || 'A traveller';
  if (q.reward.rare) { s[q.reward.rare] = (s[q.reward.rare] || 0) + 1; (v().rareGot ||= {})[q.reward.rare] = true; log(`${nm} gave you a rare ${RARE[q.reward.rare].name}!`, 'd_' + q.reward.rare); }
  else if (q.reward.decor) { s[q.reward.decor] = (s[q.reward.decor] || 0) + 1; log(`${nm} gave you a ${DECOR[q.reward.decor].name}.`, 'd_' + q.reward.decor); }
  else { give(q.reward.loot, 'request'); log(`${nm} thanked you with a bundle of materials.`, 'c_' + q.who); }
  if (requests().every((x) => x.done)) { give({ seaglass: 2 }, 'request'); log('You helped every neighbour today. They left 2 sea glass on your doorstep.', 'r_seaglass'); }
  saveVillage();
  return true;
}

export const MAX_LVL = 3;
export const lvl = (b) => b.lvl || 1;
export const upgradeCost = (b) => Object.fromEntries(Object.entries(BUILDINGS[b.type].cost).map(([r, n]) => [r, n * (lvl(b) + 1)]));
export function upgrade(id) {
  const b = v().buildings.find((x) => x.id === id);
  if (!b || lvl(b) >= MAX_LVL || !canAfford(upgradeCost(b))) return false;
  spend(upgradeCost(b));
  b.lvl = lvl(b) + 1;
  log(`You upgraded the ${BUILDINGS[b.type].name} (${'★'.repeat(b.lvl - 1)}).`, 'b_' + b.type);
  settleCritters();
  saveVillage();
  return true;
}
function dividends() {
  const loot = {};
  for (const b of v().buildings) if (lvl(b) > 1) addLoot(loot, Object.keys(BUILDINGS[b.type].cost)[0], lvl(b) - 1);
  if (Object.keys(loot).length) { give(loot, 'upgrades'); log('Your upgraded buildings made you some materials overnight.', 'r_harvest'); }
}
