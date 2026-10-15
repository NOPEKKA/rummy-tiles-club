const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/rules.js');
const H = require('../src/host.js');

// t(color, n, copy) -> id
const t = (c, n, copy = 0) => copy * 52 + c * 13 + (n - 1);
const J1 = 104, J2 = 105;
const [K, RD, BL, OR] = [0, 1, 2, 3];

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

test('deck has 106 unique tiles: 4 colors × 13 × 2 + 2 jokers', () => {
  const d = R.fullDeck();
  assert.equal(d.length, 106);
  const counts = {};
  d.forEach(id => { const x = R.tile(id); const k = x.joker ? 'J' : x.color + ':' + x.n; counts[k] = (counts[k] || 0) + 1; });
  assert.equal(counts.J, 2);
  assert.equal(Object.keys(counts).length, 53);
  assert.ok(Object.entries(counts).every(([k, v]) => k === 'J' || v === 2));
});

test('groups', () => {
  assert.equal(R.analyzeSet([t(K, 7), t(RD, 7), t(BL, 7)]).kind, 'group');
  assert.equal(R.analyzeSet([t(K, 7), t(RD, 7), t(BL, 7), t(OR, 7)]).value, 28);
  assert.equal(R.analyzeSet([t(K, 7), t(K, 7, 1), t(BL, 7)]).ok, false, 'same colour twice');
  assert.equal(R.analyzeSet([t(K, 7), t(RD, 7), t(BL, 7), t(OR, 7), J1]).ok, false, 'five in a group');
  assert.equal(R.analyzeSet([t(K, 7), J1, t(BL, 7)]).value, 21);
});

test('runs, including jokers and order', () => {
  assert.equal(R.analyzeSet([t(RD, 3), t(RD, 4), t(RD, 5)]).value, 12);
  assert.equal(R.analyzeSet([t(RD, 5), t(RD, 3), t(RD, 4)]).ok, true, 'any order is accepted');
  assert.deepEqual(R.analyzeSet([t(RD, 5), t(RD, 3), t(RD, 4)]).ordered, [t(RD, 3), t(RD, 4), t(RD, 5)]);
  assert.equal(R.analyzeSet([t(RD, 3), t(BL, 4), t(RD, 5)]).ok, false, 'mixed colours');
  assert.equal(R.analyzeSet([t(RD, 3), J1, t(RD, 5)]).value, 12);
  assert.equal(R.analyzeSet([J1, t(RD, 5), t(RD, 6)]).value, 15, 'joker kept where placed (4)');
  assert.equal(R.analyzeSet([t(RD, 12), t(RD, 13), J1], { wrap: false }).value, 36, 'without wrap the joker slides below 12');
  assert.equal(R.analyzeSet([t(RD, 12), t(RD, 13), J1]).value, 26, 'with wrap a joker placed after 13 is a 1');
  assert.equal(R.analyzeSet([J1, t(RD, 12), t(RD, 13)]).value, 36, 'placed before 12 it is an 11');
  assert.equal(R.analyzeSet([t(RD, 13), t(RD, 1), t(RD, 2)], { wrap: false }).ok, false, 'no wrap-around when switched off');
  const full = Array.from({ length: 13 }, (_, i) => t(BL, i + 1));
  assert.equal(R.analyzeSet(full).value, 91);
  assert.equal(R.analyzeSet([t(K, 1), t(K, 2)]).ok, false, 'too short');
});

test('initial meld must reach 30 from hand tiles only', () => {
  const hand = [t(RD, 10), t(RD, 11), t(RD, 12), t(K, 1), t(BL, 1), t(OR, 1)];
  assert.equal(R.validateTurn([], [[t(K, 1), t(BL, 1), t(OR, 1)]], hand, false).reason, 'meld_too_low');
  const ok = R.validateTurn([], [[t(RD, 10), t(RD, 11), t(RD, 12)]], hand, false);
  assert.equal(ok.ok, true);
  assert.equal(ok.meldValue, 33);
  const table = [[t(BL, 5), t(BL, 6), t(BL, 7)]];
  const touched = [[t(BL, 5), t(BL, 6), t(BL, 7), t(BL, 8)], [t(RD, 10), t(RD, 11), t(RD, 12)]];
  assert.equal(R.validateTurn(table, touched, hand.concat([t(BL, 8)]), false).reason, 'meld_touches_table');
});

test('after melding: rearranging the table is fine, taking a table tile is not', () => {
  const table = [[t(BL, 5), t(BL, 6), t(BL, 7), t(BL, 8)]];
  const hand = [t(K, 8), t(RD, 8), t(OR, 2)];
  // take blue 8 off the run and make a group of 8s
  const next = [[t(BL, 5), t(BL, 6), t(BL, 7)], [t(BL, 8), t(K, 8), t(RD, 8)]];
  assert.equal(R.validateTurn(table, next, hand, true).ok, true);
  // drop a table tile (keep it) -> refused
  assert.equal(R.validateTurn(table, [[t(BL, 5), t(BL, 6), t(BL, 7)], [t(K, 8), t(RD, 8), J1]], hand.concat([J1]), true).reason, 'table_tile_taken');
  // playing someone else's tile -> refused
  assert.equal(R.validateTurn(table, table.concat([[t(K, 1), t(RD, 1), t(BL, 1)]]), hand, true).reason, 'not_your_tile');
  // no new tile -> refused
  assert.equal(R.validateTurn(table, [[t(BL, 5), t(BL, 6)], [t(BL, 7), t(BL, 8)]], hand, true).reason, 'no_tiles');
});

test('joker retrieval works when the joker is reused on the table', () => {
  const table = [[t(RD, 4), J1, t(RD, 6)]];
  const hand = [t(RD, 5), t(K, 9), t(BL, 9)];
  const next = [[t(RD, 4), t(RD, 5), t(RD, 6)], [t(K, 9), t(BL, 9), J1]];
  assert.equal(R.validateTurn(table, next, hand, true).ok, true);
});

test('wire encoding round-trips', () => {
  const table = [[0, 1, 2], [104, 105, 51], [77, 78, 79, 80]];
  assert.deepEqual(R.decodeTable(R.encodeTable(table)), table);
  assert.deepEqual(R.decodeIds(R.encodeIds([0, 35, 36, 105])), [0, 35, 36, 105]);
  assert.deepEqual(R.decodeTable('zz.!!'), []);
});

test('bot finds a 30+ opening meld from its hand', () => {
  const hand = [t(K, 10), t(RD, 10), t(BL, 10), t(OR, 3), t(OR, 9)];
  const m = R.botMove([], hand, false);
  assert.equal(m.t, 'play');
  assert.equal(R.validateTurn([], m.table, hand, false).ok, true);
  assert.equal(R.botMove([], [t(K, 1), t(RD, 1), t(BL, 1)], false).t, 'draw');
});

test('bot lays tiles onto table runs after melding', () => {
  const table = [[t(BL, 5), t(BL, 6), t(BL, 7)]];
  const m = R.botMove(table, [t(BL, 8), t(K, 2)], true);
  assert.equal(m.t, 'play');
  assert.deepEqual(m.table[0], [t(BL, 5), t(BL, 6), t(BL, 7), t(BL, 8)]);
});

// ---- host engine ------------------------------------------------------

function game(players = 3, seed = 7) {
  const G = H.createGame({ code: 'abcd', hostId: 'u1', hostName: 'Host' });
  for (let i = 2; i <= players; i++) H.addPlayer(G, 'u' + i, 'P' + i);
  H.start(G, rng(seed));
  return G;
}

test('start deals 14 each and keeps all 106 tiles accounted for', () => {
  const G = game(4);
  assert.equal(G.status, 'playing');
  G.players.forEach(p => assert.equal(p.hand.length, 14));
  assert.equal(G.pool.length, 106 - 56);
  assert.ok(H.invariant(G));
});

test('only the player whose turn it is may act; stale versions are refused', () => {
  const G = game(2);
  const other = G.players[(G.turn + 1) % 2].id;
  assert.equal(H.apply(G, other, { t: 'draw' }).reason, 'not_your_turn');
  const me = G.players[G.turn].id;
  assert.equal(H.apply(G, me, { t: 'play', table: [], v: G.tn - 1 }).reason, 'stale');
  assert.equal(H.apply(G, 'stranger', { t: 'draw' }).reason, 'no_player');
  assert.equal(H.apply(G, me, { t: 'draw' }).ok, true);
  assert.ok(H.invariant(G));
});

test('a cheating play is refused and changes nothing', () => {
  const G = game(2);
  const p = G.players[G.turn];
  const v = G.v;
  const foreign = G.pool.slice(0, 3);
  const res = H.apply(G, p.id, { t: 'play', table: [foreign], v: G.tn });
  assert.equal(res.ok, false);
  assert.equal(G.v, v);
  assert.ok(H.invariant(G));
});

test('host skip makes the current player draw', () => {
  const G = game(2);
  const cur = G.turn;
  const before = G.players[cur].hand.length;
  assert.equal(H.apply(G, 'u2', { t: 'skip' }).reason, 'host_only');
  assert.equal(H.apply(G, 'u1', { t: 'skip' }).ok, true);
  assert.equal(G.players[cur].hand.length, before + 1);
});

test('lobby: max 4 seats, no joining mid-game, bots', () => {
  const G = H.createGame({ code: 'x', hostId: 'h', hostName: 'H' });
  H.addBot(G); H.addBot(G); H.addBot(G);
  assert.equal(H.addPlayer(G, 'late', 'L').reason, 'full');
  assert.equal(H.removePlayer(G, 'bot2').ok, true);
  assert.equal(H.addPlayer(G, 'u2', '<b>x</b>‮').ok, true);
  assert.equal(G.players.at(-1).name, '<b>x</b>');
  H.start(G, rng(1));
  assert.equal(H.addPlayer(G, 'late2', 'L').reason, 'in_progress');
  assert.equal(H.addPlayer(G, 'u2', 'Again').rejoined, true);
});

test('bots can play whole games to the end without breaking invariants', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const G = H.createGame({ code: 'x', hostId: 'h', hostName: 'H' });
    H.addBot(G); H.addBot(G); H.addBot(G);
    G.players[0].bot = true;
    H.start(G, rng(seed));
    let guard = 0;
    while (G.status === 'playing' && guard++ < 2000) {
      const a = H.botAction(G);
      const res = H.apply(G, G.players[G.turn].id, a);
      assert.equal(res.ok, true, `seed ${seed}: ${res.reason}`);
      assert.ok(H.invariant(G), `seed ${seed} invariant`);
      G.table.forEach(s => assert.ok(R.analyzeSet(s).ok));
    }
    assert.equal(G.status, 'ended', `seed ${seed} finished`);
    assert.ok(G.winner >= 0);
    const total = G.players.reduce((a, p) => a + p.score, 0);
    assert.equal(total, 0, 'scores are zero-sum');
  }
});

test('public view hides hands and round-trips through readView', () => {
  const G = game(3);
  const pv = H.publicView(G, new Set(['u1', 'u2']));
  const json = JSON.stringify(pv);
  assert.ok(!json.includes('"hand"'));
  assert.ok(json.length < 3000, 'fits a 4 KiB room message: ' + json.length);
  const v = H.readView(pv);
  assert.equal(v.players.length, 3);
  assert.equal(v.players[2].online, false);
  assert.deepEqual(v.table, G.table);
});
