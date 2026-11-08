// The island village: buildings, garden crops from habits, weeds from overdue tasks, neighbours and weather.
import { h, toast, menu, modal, popover, today, fmtDate, plural, closeFloating } from '../util.js';
import { get, village, saveVillage, settings, saveSettings } from '../store.js';
import * as T from '../tasks.js';
import * as G from '../game.js';
import { openTask, go, ui } from '../ui.js';
import { habits, stage } from './habits.js';
import { timer } from './focus.js';

let placing = null;   // {type} | {move:id} | {decor:type} | {moveDecor:id}
let tab = 'build';
let visited = false;

const posOf = (b) => (G.BUILDINGS[b.type]?.shore ? G.SHORE : G.PLOTS)[b.plot] || G.PLOTS[0];
const SIZE = { cottage: 13, treehouse: 13, well: 8, market: 11, bakery: 13, windmill: 14, library: 14, greenhouse: 13, teahouse: 12, pottery: 11, fishhut: 11, dock: 14, lighthouse: 11, gazebo: 11, clocktower: 11, observatory: 13 };
const WEED_SPOTS = [[30, 56], [18, 40], [41, 48], [53, 44], [64, 40], [33, 36], [46, 30], [26, 70], [38, 66], [70, 56], [80, 46], [16, 54], [57, 22], [44, 62], [66, 33], [24, 28], [76, 38], [35, 74], [50, 50], [61, 52], [20, 66], [72, 24], [86, 48], [10, 52]];

export function render(main) {
  if (!visited) { visited = true; G.onVisitIsland(); }
  const V = village();
  const tod = G.timeOfDay(), sea = G.season();
  const raining = timer().running && (timer().mode === 'watch' || timer().phase === 'focus');
  const hbs = habits().slice(0, G.FARM.length + (G.hasBuilding('greenhouse') ? 4 : 0));
  const farm = G.hasBuilding('greenhouse') ? [...G.FARM, { x: 50, y: 80 }, { x: 58, y: 82 }, { x: 66, y: 84 }, { x: 42, y: 78 }] : G.FARM;
  const weeds = G.weeds();
  const used = new Set();
  const homes = G.homed();

  const scene = h('div.island-scene.' + tod + '.' + sea + (raining ? '.raining' : '') + (placing ? '.placing' : ''));
  scene.append(h('img.island-bg', { src: G.isleImg(), alt: 'Your island', draggable: false }));
  // buildings
  for (const b of V.buildings.filter((x) => G.onIsle(x))) {
    const p = posOf(b);
    scene.append(h('button.sprite.building' + (placing?.move === b.id ? '.moving' : ''), {
      style: { left: p.x + '%', top: p.y + '%', width: (SIZE[b.type] || 12) + '%', zIndex: Math.round(p.y) },
      title: G.BUILDINGS[b.type].name,
      onclick: (e) => { e.stopPropagation(); buildingPop(e.currentTarget, b); },
    }, h('img', { src: `assets/b_${b.type}.webp`, alt: G.BUILDINGS[b.type].name, draggable: false }), G.lvl(b) > 1 ? h('span.lvl', '★'.repeat(G.lvl(b) - 1)) : null));
  }
  // crops
  (G.curIsle() === 0 ? hbs : []).forEach((hb, i) => {
    const p = farm[i]; if (!p) return;
    const cs = stage(hb);
    scene.append(h('button.sprite.crop' + (cs.droop ? '.droop' : '') + '.s' + cs.stage, { style: { left: p.x + '%', top: p.y + '%', zIndex: Math.round(p.y) }, title: hb.name, onclick: (e) => { e.stopPropagation(); popover(e.currentTarget, h('div.isl-pop', h('b', hb.emoji || '🌱', ' ', hb.name), h('p.sm', cs.droop ? 'A little thirsty. One check-in perks it up.' : ['Just a seed. Keep checking in!', 'Sprouting nicely.', 'In full bloom!'][cs.stage]), h('button.btn.sm', { onclick: () => go('#/habits/' + hb.id) }, 'Open habit'))); } },
      h('img', { src: G.cropImg(hb, cs.stage), alt: hb.name, draggable: false })));
  });
  // weeds
  weeds.forEach((t, i) => {
    const s = WEED_SPOTS[(G.hash(t.id) + i) % WEED_SPOTS.length]; const key = s.join();
    const spot = used.has(key) ? WEED_SPOTS[i % WEED_SPOTS.length] : s; used.add(spot.join());
    scene.append(h('button.sprite.weed', { style: { left: spot[0] + '%', top: spot[1] + '%', zIndex: Math.round(spot[1]) }, title: 'Overdue: ' + t.title, onclick: (e) => { e.stopPropagation(); popover(e.currentTarget, h('div.isl-pop', h('b', '🌿 ', t.title), h('p.sm.muted', `Overdue since ${fmtDate(t.due)}. Finish it to pull this weed.`),
      h('div.row', h('button.btn.sm', { onclick: () => { closeFloating(); T.complete(t); } }, '✓ Done'), h('button.btn.ghost.sm', { onclick: () => { closeFloating(); T.setDue(t, today()); } }, 'Move to today'), h('button.btn.ghost.sm', { onclick: () => { closeFloating(); openTask(t.id); } }, 'Open')))); } },
      h('img', { src: 'assets/p_weeds.webp', alt: '', draggable: false })));
  });
  // neighbours wander near their homes (or the path if no home yet)
  const anchors = V.buildings.filter((b) => G.BUILDINGS[b.type].homes && G.onIsle(b)).map(posOf);
  [...homes, ...G.waiting()].forEach((k, i) => {
    const home = homes.includes(k);
    const a = home && anchors.length ? anchors[i % anchors.length] : { x: 46 + (i % 4) * 4, y: 86 };
    const dx = ((G.hash(k) % 9) - 4) * 1.4, dy = 4 + (G.hash(k + 'y') % 4);
    const c = G.CRITTERS[k];
    scene.append(h('button.sprite.critter' + (settings().critterWander ? '.wander' : '') + (home ? '' : '.visiting'), { style: { left: a.x + dx + '%', top: a.y + dy + '%', zIndex: Math.round(a.y + dy) + 1, animationDelay: -(G.hash(k) % 9) + 's' }, title: c.name,
      onclick: (e) => { e.stopPropagation(); popover(e.currentTarget, h('div.isl-pop.critter-pop', h('img', { src: `assets/c_${k}.webp`, alt: '' }), h('div', h('b', c.name), h('p', '“' + c.say + '”'), !home ? h('p.sm.muted', 'Visiting. Build a cottage or treehouse so they can move in.') : null))); } },
      h('img', { src: `assets/c_${k}.webp`, alt: c.name, draggable: false })));
  });
  // decorations
  for (const d of G.decorHere()) {
    const info = G.decorInfo(d.type);
    scene.append(h('button.sprite.decor' + (placing?.moveDecor === d.id ? '.moving' : ''), { style: { left: d.x + '%', top: d.y + '%', width: info.size + '%', zIndex: Math.round(d.y) }, title: info.name,
      onclick: (e) => { e.stopPropagation(); popover(e.currentTarget, h('div.isl-pop', h('b', info.name), G.RARE[d.type] ? h('p.sm.muted', '✨ Rare treasure') : null,
        h('div.row', h('button.btn.ghost.sm', { onclick: () => { closeFloating(); placing = { moveDecor: d.id }; ui.render(); } }, 'Move'), h('button.btn.ghost.sm', { onclick: () => { closeFloating(); G.storeDecor(d.id); ui.render(); } }, 'Put in bag')))); } },
      h('img', { src: `assets/d_${d.type}.webp`, alt: info.name, draggable: false })));
  }
  if (placing?.decor || placing?.moveDecor) {
    scene.classList.add('free-place');
    scene.addEventListener('click', (e) => {
      const r = scene.getBoundingClientRect();
      const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10 + 3;
      if (placing.decor) { if (G.placeDecor(placing.decor, x, y)) toast(`${G.decorInfo(placing.decor).name} placed`); }
      else G.moveDecor(placing.moveDecor, x, y);
      placing = null; ui.render();
    });
  }
  // placement markers
  if (placing?.type || placing?.move) {
    const shore = placing.type ? G.BUILDINGS[placing.type].shore : G.BUILDINGS[V.buildings.find((b) => b.id === placing.move).type].shore;
    for (const p of G.freeSpots(shore)) scene.append(h('button.plot-marker', { style: { left: p.x + '%', top: p.y + '%' }, onclick: (e) => {
      e.stopPropagation();
      if (placing.type) { if (G.build(placing.type, p.i)) toast(`🎉 ${G.BUILDINGS[placing.type].name} built! ${G.BUILDINGS[placing.type].effect}`); }
      else G.moveBuilding(placing.move, p.i);
      placing = null; ui.render();
    } }, '+'));
  }
  scene.append(h('div.weather'), h('div.rain', [...Array(50)].map((_, i) => h('i', { style: { left: (i * 29) % 100 + '%', animationDelay: ((i * 0.11) % 1.4) + 's' } }))), sea === 'winter' ? h('div.snow', [...Array(40)].map((_, i) => h('i', { style: { left: (i * 31) % 100 + '%', animationDelay: (i % 10) * 0.7 + 's' } }))) : null,
    sea === 'spring' ? h('div.petalfall', [...Array(14)].map((_, i) => h('i', { style: { left: (i * 43) % 100 + '%', animationDelay: (i % 7) * 1.3 + 's' } }))) : null);

  const banner = placing ? h('div.place-banner', h('span', placing.type ? `Tap a spot to build the ${G.BUILDINGS[placing.type].name}` : placing.decor ? `Tap anywhere to place the ${G.decorInfo(placing.decor).name}` : placing.moveDecor ? 'Tap a new spot for this decoration' : 'Tap a new spot for this building'), h('button.btn.ghost.sm', { onclick: () => { placing = null; ui.render(); } }, 'Cancel')) : null;

  main.replaceChildren(
    h('div.view-head', h('h1', '🏝 ', G.isleName()), h('span.muted.sm.desktop-only', { title: 'Time and season follow your clock' }, { dawn: '🌅 Dawn', day: '☀️ Day', dusk: '🌇 Dusk', night: '🌙 Night' }[tod], ' · ', sea[0].toUpperCase() + sea.slice(1), raining ? ' · 🌧 Raining (focus)' : ''),
      h('div.head-actions', G.isleCount() > 1 ? h('select.input.sm', { 'aria-label': 'Island', onchange: (e) => { G.goIsle(+e.target.value); ui.render(); } }, [...Array(G.isleCount())].map((_, i) => h('option', { value: i, selected: i === G.curIsle() }, '⛵ ' + G.isleName(i)))) : null, h('button.btn.ghost.sm', { onclick: () => go('#/focus') }, '🌧 Make it rain'))),
    h('div.island-layout',
      h('div.island-wrap', banner, h('div.inv-bar', G.LIST_RES.concat(['seaglass', 'harvest']).map((r) => h('span.inv', { title: `${G.RES[r].name}: ${G.RES[r].note}` }, h('img', { src: G.resImg(r), alt: G.RES[r].name }), V.inv[r] || 0))), scene,
        h('p.muted.sm.isl-hint', weeds.length ? `🌿 ${plural(weeds.length, 'weed')} from overdue tasks. Tap one to deal with it.` : G.curIsle() > 0 && !V.buildings.some((b) => G.onIsle(b)) ? 'A fresh island! Build and decorate it from the panel. Your crops stay on your first island.' : V.buildings.length ? 'Tap buildings, crops and neighbours to say hello.' : 'Finish tasks to gather materials, then build your first cottage from the panel.')),
      h('aside.island-side.scroll', { 'data-scroll': 'island-side' },
        h('div.seg.full.tabs', [['build', 'Build'], ['decor', 'Decor'], ['requests', 'Requests'], ['guide', 'Neighbours'], ['journal', 'Journal']].concat(G.hasBuilding('market') ? [['market', 'Market']] : []).map(([v, n]) => h('button' + (tab === v ? '.on' : ''), { onclick: () => { tab = v; ui.render(); } }, n))),
        tab === 'build' ? buildPanel(V) : tab === 'decor' ? decorPanel(V) : tab === 'requests' ? requestsPanel(V) : tab === 'guide' ? guidePanel(V) : tab === 'market' ? marketPanel(V) : journalPanel(V))));
}

function costRow(cost) {
  const inv = village().inv;
  return h('div.cost', Object.entries(cost).map(([r, n]) => h('span.inv' + ((inv[r] || 0) >= n ? '' : '.short'), h('img', { src: G.resImg(r), alt: G.RES[r].name, title: G.RES[r].name }), `${inv[r] || 0}/${n}`)));
}
function buildPanel(V) {
  const counts = (t) => V.buildings.filter((b) => b.type === t && G.onIsle(b)).length;
  return h('div.build-list', h('p.muted.sm', 'Each list grows a material when you finish its tasks. Spend them here. Every building does something, and each one can be upgraded twice (tap it on the island).'), sailCard(),
    Object.entries(G.BUILDINGS).map(([k, b]) => {
      const n = counts(k), max = b.max || 1, full = n >= max;
      return h('div.build-card' + (full ? '.built' : '') + (G.canBuild(k) ? '.ready' : ''),
        h('img', { src: `assets/b_${k}.webp`, alt: '' }),
        h('div', h('b', b.name, max > 1 ? h('span.muted', ` ${n}/${max}`) : full ? h('span.muted', ' ✓ built') : null), h('p.sm', b.effect), !full ? costRow(b.cost) : null),
        !full ? h('button.btn.sm', { disabled: !G.canBuild(k), onclick: () => { placing = { type: k }; ui.render(); } }, b.shore ? 'Build on shore' : 'Build') : null);
    }));
}
function guidePanel(V) {
  const seer = G.hasBuilding('observatory');
  const found = Object.keys(V.critters).length;
  return h('div.guide', h('p.muted.sm', `${found} of ${Object.keys(G.CRITTERS).length} neighbours found. They arrive when you do certain things. ${seer ? 'The observatory shows every hint.' : 'Some hints are hidden until you build the observatory.'}`),
    G.waiting().length ? h('p.note-box', `🏡 ${plural(G.waiting().length, 'neighbour')} visiting with nowhere to live. Build a cottage or treehouse!`) : null,
    h('div.guide-grid', Object.entries(G.CRITTERS).map(([k, c], i) => {
      const got = V.critters[k];
      return h('div.guide-card' + (got ? '.found' : ''), h('img', { src: `assets/c_${k}.webp`, alt: got ? c.name : 'Unknown neighbour' }),
        h('b', got ? c.name : '???'), h('p.sm', got ? c.how : seer || i % 2 === 0 ? c.hint : 'A mystery…'));
    })));
}
function journalPanel(V) {
  if (!V.log.length) return h('p.muted.sm', 'Your island journal is empty. Things that happen on your island will be written here.');
  return h('div.journal', V.log.slice(0, 120).map((e) => h('div.j-row', e.icon ? h('img', { src: `assets/${e.icon}.webp`, alt: '' }) : h('span', '•'), h('div', h('small.muted', new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })), h('p.sm', e.text)))));
}
let tradeFrom = 'wood', tradeTo = 'stone';
function marketPanel(V) {
  const all = Object.keys(G.RES);
  const sel = (val, set) => h('select.input.sm', { onchange: (e) => set(e.target.value) }, all.map((r) => h('option', { value: r, selected: r === val }, `${G.RES[r].name} (${V.inv[r] || 0})`)));
  return h('div.form', h('p.muted.sm', 'Trade 3 of one material for 1 of another.'),
    h('div.form-row', h('span', 'Give 3'), sel(tradeFrom, (v) => { tradeFrom = v; })), h('div.form-row', h('span', 'Get 1'), sel(tradeTo, (v) => { tradeTo = v; })),
    h('button.btn', { onclick: () => { if (G.trade(tradeFrom, tradeTo)) toast(`Traded 3 ${G.RES[tradeFrom].name.toLowerCase()} for 1 ${G.RES[tradeTo].name.toLowerCase()}`); else toast('Not enough to trade'); } }, 'Trade'));
}
function buildingPop(anchor, b) {
  const B = G.BUILDINGS[b.type], L = G.lvl(b), mat = G.RES[Object.keys(B.cost)[0]].name.toLowerCase();
  popover(anchor, h('div.isl-pop', h('b', B.name, L > 1 ? h('span.stars', ' ' + '★'.repeat(L - 1)) : null), h('p.sm', B.effect), B.homes ? h('p.sm.muted', `Home to ${plural(Math.min(B.homes + L - 1, G.homed().length), 'neighbour')}`) : null,
    h('p.sm.muted', L > 1 ? `Upgraded: makes ${L - 1} ${mat} each day you visit${B.homes ? `, with room for ${L - 1} more neighbour${L > 2 ? 's' : ''}` : ''}.` : `Upgrade it to make ${mat} every day${B.homes ? ' and fit another neighbour' : ''}.`),
    L < G.MAX_LVL ? costRow(G.upgradeCost(b)) : h('p.sm.muted', 'Fully upgraded!'),
    h('small.muted', 'Built ' + new Date(b.at).toLocaleDateString()),
    h('div.row', h('button.btn.ghost.sm', { onclick: () => { closeFloating(); placing = { move: b.id }; ui.render(); } }, 'Move'),
      L < G.MAX_LVL ? h('button.btn.sm', { disabled: !G.canAfford(G.upgradeCost(b)), onclick: () => { closeFloating(); if (G.upgrade(b.id)) toast(`✨ ${B.name} upgraded!`); ui.render(); } }, 'Upgrade ★') : null)));
}
function sailCard() {
  const n = G.sailProgress(), need = G.SAIL_NEED, last = G.isleCount() - 1, ready = n >= need;
  return h('div.build-card.sail' + (G.canSail() ? '.ready' : ''), h('img', { src: 'assets/x_boat.webp', alt: '' }),
    h('div', h('b', 'Sail to a new island'), h('p.sm', ready ? `${G.isleName(last)} is full of life. A boat can take you to ${G.isleName(last + 1)}.` : `Build ${need - n} more on ${G.isleName(last)} to unlock the next island (${n}/${need}).`), ready ? costRow(G.sailCost()) : null),
    ready ? h('button.btn.sm', { disabled: !G.canSail(), onclick: () => { if (G.sail()) { toast(`⛵ Welcome to ${G.isleName()}!`); ui.render(); } } }, 'Set sail') : null);
}
function decorPanel(V) {
  const bag = Object.entries(G.stash()).filter(([, n]) => n > 0), got = V.rareGot || {};
  const now = G.seasonalNow(), month = new Date().toLocaleString(undefined, { month: 'long' });
  const nextKey = Object.keys(G.SEASONAL).find((k) => G.SEASONAL[k].month === (new Date().getMonth() + 1) % 12);
  const card = (k, info, extra) => h('div.build-card' + (G.canAfford(info.cost) ? '.ready' : ''), h('img', { src: `assets/d_${k}.webp`, alt: '' }), h('div', h('b', info.name), extra, costRow(info.cost)),
    h('button.btn.sm', { disabled: !G.canAfford(info.cost), onclick: () => { if (G.buyDecor(k)) { placing = { decor: k }; ui.render(); } } }, 'Buy'));
  return h('div.build-list',
    bag.length ? [h('h4.side-h', '🎒 Your bag'), h('div.bag', bag.map(([k, n]) => h('button.bag-item', { title: G.decorInfo(k).name, onclick: () => { placing = { decor: k }; ui.render(); } }, h('img', { src: `assets/d_${k}.webp`, alt: '' }), h('span', G.decorInfo(k).name), n > 1 ? h('b', '×' + n) : null))), h('p.muted.sm', 'Tap something in your bag, then tap the island to place it.')] : null,
    h('h4.side-h', `🗓 Only in ${month}`), now.map((k) => card(k, G.SEASONAL[k], h('p.sm.muted', 'Leaves the shop when the month ends.'))),
    nextKey ? h('p.muted.sm', `Coming next month: ${G.SEASONAL[nextKey].name}.`) : null,
    h('h4.side-h', '🪑 Decorations'), Object.entries(G.DECOR).map(([k, d]) => card(k, d)),
    h('h4.side-h', '✨ Rare treasures'), h('p.muted.sm', `${Object.keys(got).length} of ${Object.keys(G.RARE).length} found. Neighbours sometimes give these when you help with their requests.`),
    h('div.bag', Object.entries(G.RARE).map(([k, r]) => h('div.bag-item' + (got[k] ? '' : '.locked'), { title: got[k] ? r.name : '???' }, h('img', { src: `assets/d_${k}.webp`, alt: '' }), h('span', got[k] ? r.name : '???')))));
}
function requestsPanel() {
  return h('div.build-list', h('p.muted.sm', 'Your neighbours ask for help every day, and new requests arrive each morning. Help all three for a bonus.'),
    G.requests().map((q, i) => {
      const c = G.CRITTERS[q.who], who = c?.name || 'A traveller';
      const rw = q.reward.rare ? h('span.rw.rare', h('img', { src: `assets/d_${q.reward.rare}.webp`, alt: '' }), '✨ ', G.RARE[q.reward.rare].name)
        : q.reward.decor ? h('span.rw', h('img', { src: `assets/d_${q.reward.decor}.webp`, alt: '' }), G.DECOR[q.reward.decor].name)
        : h('span.rw', Object.entries(q.reward.loot).map(([r, n]) => [h('img', { src: G.resImg(r), alt: G.RES[r].name }), '+' + n + ' ']));
      return h('div.build-card.req' + (q.done ? '.built' : G.canAfford(q.ask) ? '.ready' : ''), h('img', { src: `assets/c_${q.who}.webp`, alt: '' }),
        h('div', h('b', who), h('p.sm', q.done ? 'Thank you so much!' : 'Could you spare these?'), !q.done ? costRow(q.ask) : null, h('div.sm', 'Gives: ', rw)),
        !q.done ? h('button.btn.sm', { disabled: !G.canAfford(q.ask), onclick: () => { if (G.fulfil(i)) { toast(`💝 You helped ${who}!`); ui.render(); } } }, 'Give') : h('span.muted', '✓'));
    }));
}
addEventListener('loot', (e) => {
  const { loot } = e.detail;
  const parts = Object.entries(loot).filter(([, n]) => n > 0);
  if (!parts.length) return;
  const el = h('div.loot-pop', parts.map(([r, n]) => h('span', h('img', { src: G.resImg(r), alt: '' }), '+' + n)));
  document.body.append(el); setTimeout(() => el.remove(), 1600);
});
addEventListener('critter', (e) => {
  const c = G.CRITTERS[e.detail.key];
  setTimeout(() => modal(null, h('div.arrival', h('img', { src: `assets/c_${e.detail.key}.webp`, alt: '' }), h('h2', `${c.name} came to visit!`), h('p', c.how), h('p.motto', '“' + c.say + '”'),
    h('button.btn', { onclick: (ev) => { ev.target.closest('.modal-wrap').remove(); go('#/island'); } }, 'Visit the island')), { className: 'arrival-modal' }), 500);
});
