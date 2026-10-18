const test = require('node:test');
const assert = require('node:assert/strict');
const MI = require('../src/moveinfo.js');
const Prefs = require('../src/prefs.js');
const H = require('../src/host.js');

const t = (c, n, copy = 0) => copy * 52 + c * 13 + (n - 1);
const J1 = 104;
const [K, RD, BL, YE] = [0, 1, 2, 3];
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

test('a plain new set: combo count, no extend, no steal', () => {
  const m = MI.analyze([], [[t(RD, 3), t(RD, 4), t(RD, 5)]], [t(RD, 3), t(RD, 4), t(RD, 5)]);
  assert.equal(m.n, 3);
  assert.deepEqual(m.extended, []);
  assert.deepEqual(m.fresh, [0]);
  assert.deepEqual(m.stolen, []);
  assert.equal(m.longest, 3);
});

test('extending a table set (เอาไพ่มาต่อ)', () => {
  const prev = [[t(BL, 5), t(BL, 6), t(BL, 7)]];
  const next = [[t(BL, 4), t(BL, 5), t(BL, 6), t(BL, 7), t(BL, 8)]];
  const m = MI.analyze(prev, next, [t(BL, 4), t(BL, 8)]);
  assert.deepEqual(m.extended, [0]);
  assert.deepEqual(m.stolen, []);
  assert.equal(m.longest, 5);
});

test('taking a tile from one set to build another (ขโมยไพ่มาต่อ)', () => {
  const prev = [[t(BL, 5), t(BL, 6), t(BL, 7), t(BL, 8)], [t(K, 2), t(RD, 2), t(YE, 2)]];
  const next = [[t(BL, 5), t(BL, 6), t(BL, 7)], [t(K, 2), t(RD, 2), t(YE, 2)], [t(BL, 8), t(K, 8), t(RD, 8)]];
  const m = MI.analyze(prev, next, [t(K, 8), t(RD, 8)]);
  assert.deepEqual(m.stolen, [t(BL, 8)]);
  assert.equal(m.jokerStolen, false);
  assert.deepEqual(m.fresh, []);
  assert.deepEqual(m.extended, [2], 'the new set grew from a stolen tile, so it counts as built on the table');
});

test('splitting a set to slot a tile in is not stealing', () => {
  const prev = [[t(RD, 1), t(RD, 2), t(RD, 3), t(RD, 4), t(RD, 5), t(RD, 6)]];
  const next = [[t(RD, 1), t(RD, 2), t(RD, 3)], [t(RD, 4), t(RD, 5), t(RD, 6)]];
  // nothing from hand here, just checking the split heuristic
  assert.deepEqual(MI.analyze(prev, next, []).stolen, []);
});

test('grabbing the joker is flagged', () => {
  const prev = [[t(RD, 4), J1, t(RD, 6)]];
  const next = [[t(RD, 4), t(RD, 5), t(RD, 6)], [t(K, 9), t(BL, 9), J1]];
  const m = MI.analyze(prev, next, [t(RD, 5), t(K, 9), t(BL, 9)]);
  assert.deepEqual(m.stolen, [J1]);
  assert.equal(m.jokerStolen, true);
});

test('showy shapes: wrap-around run, four-colour group, long run', () => {
  const wrap = [12, 13, 1, 2].map(n => t(YE, n));
  assert.equal(MI.analyze([], [wrap], wrap).wrap, true);
  const g4 = [t(K, 9), t(RD, 9), t(BL, 9), t(YE, 9)];
  assert.equal(MI.analyze([], [g4], g4).group4, true);
  const run9 = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => t(BL, n));
  assert.equal(MI.analyze([], [run9], run9).longest, 9);
  // untouched sets don't count
  const m = MI.analyze([run9], [run9, [t(K, 1), t(RD, 1), t(YE, 1)]], [t(K, 1), t(RD, 1), t(YE, 1)]);
  assert.equal(m.longest, 0);
});

test('host records lastMove for plays, draws and passes, and it travels in the public view', () => {
  const G = H.createGame({ code: 'x', hostId: 'h', hostName: 'H' });
  H.addPlayer(G, 'u2', 'B');
  H.start(G, rng(5));
  assert.equal(H.readView(H.publicView(G)).lastMove.k, 'deal');
  const p = G.players[G.turn], pi = G.turn;
  const want = [t(RD, 10), t(RD, 11), t(RD, 12), t(RD, 13)];
  const set = new Set(want);
  G.pool = G.pool.filter(id => !set.has(id)); G.players.forEach(q => { q.hand = q.hand.filter(id => !set.has(id)); });
  p.hand.push(...want);
  const tn = G.tn;
  assert.equal(H.apply(G, p.id, { t: 'play', table: [want], layout: [[0, 0]], v: G.tn }).ok, true);
  const mv = H.readView(H.publicView(G)).lastMove;
  assert.equal(mv.k, 'play'); assert.equal(mv.p, pi); assert.equal(mv.tn, tn);
  assert.equal(mv.n, 4); assert.equal(mv.m, 46); assert.equal(mv.lg, 4); assert.deepEqual(mv.st, []);
  const q = G.players[G.turn];
  H.apply(G, q.id, { t: 'draw' });
  assert.equal(H.readView(H.publicView(G)).lastMove.k, 'draw');
});

test('prefs: defaults, junk, clamping, and the old wrap switch carries over', () => {
  assert.deepEqual(Prefs.sanitize({}), { skin: 'ivory', fx: 'full', sound: true, volume: 0.7, wrap: true, fps: 120, showFps: false, mathTimer: 0, mathBot: 'normal' });
  assert.deepEqual(Prefs.sanitize({ skin: 'neon', fx: 'max', volume: 9, sound: 0, fps: 75 }), { skin: 'ivory', fx: 'full', sound: false, volume: 1, wrap: true, fps: 120, showFps: false, mathTimer: 0, mathBot: 'normal' });
  assert.equal(Prefs.sanitize({ fps: '60' }).fps, 60, 'fps 30/60/90/120 only');
  assert.equal(Prefs.sanitize({ fps: 240 }).fps, 120, 'never above 120');
  const mem = new Map();
  const st = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  mem.set('rk.wrap', '0');
  assert.equal(Prefs.load(st).wrap, false);
  Prefs.save(st, { skin: 'arcane', fx: 'lite', sound: true, volume: 0.25, wrap: true, fps: 30, showFps: true });
  assert.deepEqual(Prefs.load(st), { skin: 'arcane', fx: 'lite', sound: true, volume: 0.25, wrap: true, fps: 30, showFps: true, mathTimer: 0, mathBot: 'normal' });
  assert.equal(Prefs.sanitize({ mathTimer: 90, mathBot: 'easy' }).mathTimer, 90);
  assert.equal(Prefs.sanitize({ mathTimer: 45, mathBot: 'evil' }).mathBot, 'normal');
  mem.set(Prefs.KEY, '{bad');
  assert.equal(Prefs.load(st).skin, 'ivory');
});
