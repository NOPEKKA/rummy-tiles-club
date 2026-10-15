const test = require('node:test');
const assert = require('node:assert/strict');
const TG = require('../src/tablegrid.js');
const R = require('../src/rules.js');
const H = require('../src/host.js');

const t = (c, n, copy = 0) => copy * 52 + c * 13 + (n - 1);
const J1 = 104;
const [K, RD, BL, YE] = [0, 1, 2, 3];
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const flat = g => g.flat().filter(x => x !== null).sort((a, b) => a - b);

test('the board starts small and grows with what is on it', () => {
  let g = TG.empty();
  assert.deepEqual(TG.dims(g), { cols: TG.MIN_COLS, rows: TG.MIN_ROWS });
  g = TG.place(g, 5, 0, 9).grid;          // tile in the last starting column
  assert.equal(TG.dims(g).cols, 12);      // + 2 spare columns
  g = TG.place(g, 6, 4, 0).grid;          // tile on row 5
  assert.equal(TG.dims(g).rows, 6);       // + 1 spare row
  g = TG.place(g, 7, 0, TG.MAX_COLS - 1).grid;
  assert.equal(TG.dims(g).cols, TG.MAX_COLS, 'never past the maximum');
});

test('tiles touching in a row become one set; a gap splits sets', () => {
  let g = TG.empty();
  [[1, 0, 2], [2, 0, 3], [3, 0, 4], [9, 0, 6], [10, 0, 7], [11, 1, 0]].forEach(([id, r, c]) => { g = TG.place(g, id, r, c).grid; });
  const { table, layout } = TG.toSets(g);
  assert.deepEqual(table, [[1, 2, 3], [9, 10], [11]]);
  assert.deepEqual(layout, [[0, 2], [0, 6], [1, 0]]);
  g = TG.place(g, 12, 0, 5).grid;          // fill the gap -> sets merge
  assert.deepEqual(TG.toSets(g).table[0], [1, 2, 3, 12, 9, 10]);
});

test('dropping onto a tile inserts and pushes the rest right, keeping gaps', () => {
  let g = TG.empty();
  [[1, 0, 0], [2, 0, 1], [3, 0, 2], [7, 0, 5], [8, 0, 6]].forEach(([id, r, c]) => { g = TG.place(g, id, r, c).grid; });
  // row: 1 2 3 _ _ 7 8
  g = TG.place(g, 50, 0, 1).grid;
  assert.deepEqual(g[0].slice(0, 8), [1, 50, 2, 3, null, 7, 8, null]);
  // one-cell gap left: inserting again pushes the next set along too
  g = TG.place(g, 51, 0, 0).grid;
  assert.deepEqual(g[0].slice(0, 9), [51, 1, 50, 2, 3, null, 7, 8, null]);
  assert.deepEqual(TG.toSets(g).table, [[51, 1, 50, 2, 3], [7, 8]]);
});

test('moving a tile within the board never duplicates or drops it', () => {
  let g = TG.empty();
  for (let i = 0; i < 20; i++) g = TG.place(g, i, Math.floor(i / 7), i % 7).grid;
  for (let k = 0; k < 300; k++) {
    const id = (k * 7) % 20;
    const res = TG.place(g, id, (k * 3) % 5, (k * 11) % 16);
    if (res.ok) g = res.grid;
    assert.deepEqual(flat(g), Array.from({ length: 20 }, (_, i) => i));
  }
});

test('a full row refuses an insert instead of losing a tile', () => {
  let g = TG.empty();
  for (let c = 0; c < TG.MAX_COLS; c++) g = TG.place(g, c, 0, c).grid;
  const res = TG.place(g, 99, 0, 3);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'row_full');
  assert.equal(flat(res.grid).length, TG.MAX_COLS);
});

test('fromSets rejects overlap and out-of-bounds anchors', () => {
  assert.equal(TG.fromSets([[1, 2, 3], [4, 5, 6]], [[0, 0], [0, 2]]).reason, 'overlap');
  assert.equal(TG.fromSets([[1, 2, 3]], [[0, TG.MAX_COLS - 2]]).reason, 'bounds');
  assert.equal(TG.fromSets([[1, 2, 3]], [[-1, 0]]).reason, 'bounds');
  assert.equal(TG.fromSets([[1, 2, 3]], []).reason, 'malformed');
});

test('board encoding round-trips', () => {
  const table = [[0, 1, 2], [104, 105, 51], [77, 78, 79, 80]];
  const layout = [[0, 0], [0, 4], [19, 26]];
  assert.deepEqual(TG.decodeBoard(TG.encodeBoard(table, layout)), { table, layout });
});

test('autoPlace keeps unchanged sets still and anchors grown sets on shared tiles', () => {
  const prev = [[1, 2, 3], [20, 21, 22]];
  const prevL = [[0, 4], [2, 1]];
  const next = [[1, 2, 3], [19, 20, 21, 22], [40, 41, 42]];
  const L = TG.autoPlace(prev, prevL, next);
  assert.deepEqual(L[0], [0, 4]);
  assert.deepEqual(L[1], [2, 0], 'prepended tile shifts the anchor left so old tiles stay put');
  assert.ok(TG.fromSets(next, L).ok);
});

test('tidy packs sets in reading order within the width', () => {
  const table = [[1, 2, 3], [4, 5, 6, 7], [8, 9, 10]];
  const L = TG.tidy(table, [[5, 0], [0, 0], [0, 9]], 10);
  assert.deepEqual(L, [[1, 0], [0, 0], [0, 5]]);
  assert.ok(TG.fromSets(table, L).ok);
});

// ---- wrap-around runs ---------------------------------------------------

test('runs may continue past 13 back to 1 (default rule)', () => {
  const run = [9, 10, 11, 12, 13, 1, 2].map(n => t(RD, n));
  const a = R.analyzeSet(run);
  assert.equal(a.ok, true);
  assert.deepEqual(a.values, [9, 10, 11, 12, 13, 1, 2]);
  assert.equal(R.analyzeSet([t(YE, 12), t(YE, 13), t(YE, 1)]).ok, true);
  assert.equal(R.analyzeSet([t(YE, 13), t(YE, 1), J1]).ok, true);
  assert.equal(R.analyzeSet([t(YE, 1), t(YE, 12), t(YE, 13)]).ok, true, 'any order is sorted for you');
  assert.deepEqual(R.analyzeSet([t(YE, 1), t(YE, 12), t(YE, 13)]).ordered, [t(YE, 12), t(YE, 13), t(YE, 1)]);
  const all13 = Array.from({ length: 13 }, (_, i) => t(BL, ((i + 5) % 13) + 1));
  assert.equal(R.analyzeSet(all13).ok, true, 'a full 13 in any rotation');
});

test('wrap can be switched off', () => {
  const off = { wrap: false };
  assert.equal(R.analyzeSet([t(RD, 12), t(RD, 13), t(RD, 1)], off).ok, false);
  assert.equal(R.analyzeSet([t(RD, 11), t(RD, 12), t(RD, 13)], off).ok, true);
  assert.equal(R.analyzeSet([t(RD, 13), J1, t(RD, 2)], off).ok, false);
  assert.equal(R.analyzeSet([t(RD, 13), J1, t(RD, 2)]).ok, true);
});

test('wrap runs: still one colour, no repeats, at most 13', () => {
  assert.equal(R.analyzeSet([t(RD, 12), t(RD, 13), t(BL, 1)]).ok, false);
  assert.equal(R.analyzeSet([t(RD, 13), t(RD, 1), t(RD, 13, 1)]).ok, false);
  assert.equal(R.analyzeSet([t(RD, 12), t(RD, 13), t(RD, 2)]).ok, false, 'needs the 1 (or a joker)');
});

test('bot finds wrap-around runs', () => {
  const hand = [t(K, 12), t(K, 13), t(K, 1), t(K, 2), t(RD, 5)];
  const sets = R.setsFromHand(hand);
  assert.ok(sets.some(s => s.length === 4 && R.analyzeSet(s).ok));
  assert.equal(R.setsFromHand(hand, { wrap: false }).length, 0);
});

// ---- host with the grid -------------------------------------------------

test('host reads sets from the grid, not from what the client claims', () => {
  const G = H.createGame({ code: 'x', hostId: 'h', hostName: 'H' });
  H.addPlayer(G, 'u2', 'B');
  H.start(G, rng(3));
  const p = G.players[G.turn];
  // rig a hand
  const want = [t(RD, 10), t(RD, 11), t(RD, 12), t(BL, 3)];
  const set = new Set(want);
  G.pool = G.pool.filter(id => !set.has(id)); G.players.forEach(q => { q.hand = q.hand.filter(id => !set.has(id)); });
  p.hand.push(...want);
  // client claims two sets, but places them touching: the host sees one set of 4 and refuses
  const bad = H.apply(G, p.id, { t: 'play', table: [[t(RD, 10), t(RD, 11), t(RD, 12)], [t(BL, 3)]], layout: [[0, 0], [0, 3]], v: G.tn });
  assert.equal(bad.ok, false);
  // overlapping placement is malformed
  assert.equal(H.apply(G, p.id, { t: 'play', table: [[t(RD, 10), t(RD, 11), t(RD, 12)]], layout: [[0, 0], [0, 1]], v: G.tn }).reason, 'malformed');
  const ok = H.apply(G, p.id, { t: 'play', table: [[t(RD, 12), t(RD, 10), t(RD, 11)]], layout: [[1, 2]], v: G.tn });
  assert.equal(ok.ok, true);
  assert.deepEqual(G.table, [[t(RD, 10), t(RD, 11), t(RD, 12)]], 'the set is sorted in place');
  assert.deepEqual(G.layout, [[1, 2]]);
  const v = H.readView(H.publicView(G));
  assert.deepEqual(v.layout, [[1, 2]]);
  assert.equal(v.rules.wrap, true);
});

test('bot games keep a valid, non-overlapping grid layout the whole way', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const G = H.createGame({ code: 'x', hostId: 'h', hostName: 'H' });
    H.addBot(G); H.addBot(G); H.addBot(G);
    G.players[0].bot = true;
    H.start(G, rng(seed));
    let guard = 0;
    while (G.status === 'playing' && guard++ < 2000) {
      assert.equal(H.apply(G, G.players[G.turn].id, H.botAction(G)).ok, true);
      const g = TG.fromSets(G.table, G.layout);
      assert.ok(g.ok, 'layout fits: ' + g.reason);
      assert.equal(TG.toSets(g.grid).table.length, G.table.length, `seed ${seed}: sets must not touch`);
    }
    assert.equal(G.status, 'ended');
  }
});

test('lobby wrap switch', () => {
  const G = H.createGame({ code: 'x', hostId: 'h', hostName: 'H' });
  assert.equal(G.rules.wrap, true);
  H.setWrap(G, false);
  assert.equal(H.readView(H.publicView(G)).rules.wrap, false);
  H.addBot(G); H.start(G, rng(1));
  assert.equal(H.setWrap(G, true).reason, 'in_progress');
});

test('old saved games without a layout still load', () => {
  const G = H.createGame({ code: 'x', hostId: 'h', hostName: 'H' });
  H.addBot(G); H.start(G, rng(2));
  G.table = [[t(K, 1), t(RD, 1), t(BL, 1)]];
  delete G.layout;
  G.pool = G.pool.filter(id => !G.table[0].includes(id)); G.players.forEach(q => { q.hand = q.hand.filter(id => !G.table[0].includes(id)); });
  const v = H.readView(H.publicView(G));
  assert.equal(v.layout.length, 1);
});
