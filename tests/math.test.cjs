const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/mathrules.js');
const Bot = require('../src/mathbot.js');
const MH = require('../src/mathhost.js');

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
/** the k-th tile with this face */
function idOf(face, k = 0) {
  const ids = [];
  for (let i = 0; i < M.TILE_COUNT; i++) if (M.tile(i).face === face) ids.push(i);
  if (ids[k] === undefined) throw new Error('no tile ' + face + '#' + k);
  return ids[k];
}
const L = str => str.split(' ');           // '12 + 3 = 15' → symbols
const ok = str => M.checkLine(L(str));
/** placements across from (r, c): faces with optional :sym for choice tiles */
function across(r, c, faces, used = new Map()) {
  return faces.map((f, k) => {
    const [face, sym] = f.split(':');
    const n = used.get(face) || 0; used.set(face, n + 1);
    return { c: M.at(r, c + k), id: idOf(face, n), s: sym || face };
  });
}
function down(r, c, faces, used = new Map()) {
  return faces.map((f, k) => {
    const [face, sym] = f.split(':');
    const n = used.get(face) || 0; used.set(face, n + 1);
    return { c: M.at(r + k, c), id: idOf(face, n), s: sym || face };
  });
}
function put(board, ps) { ps.forEach(p => { board[p.c] = [p.id, p.s]; }); return board; }

test('100 tiles: 0–20, + − × ÷, two choice tiles, = and blanks', () => {
  assert.equal(M.TILE_COUNT, 100);
  const count = f => Array.from({ length: 100 }, (_, i) => M.tile(i)).filter(t => t.face === f).length;
  assert.equal(count('='), 11);
  assert.equal(count('?'), 4);
  assert.equal(count('20'), 1);
  assert.deepEqual(M.options('+-'), ['+', '-']);
  assert.equal(M.options('?').length, 26);
});

test('the bonus squares are symmetric and the centre is the star', () => {
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
    assert.equal(M.premium(M.at(r, c)), M.premium(M.at(c, r)));
    assert.equal(M.premium(M.at(r, c)), M.premium(M.at(14 - r, c)));
  }
  assert.equal(M.premium(M.CENTER), '*');
  assert.equal(M.premium(0), 'E');
  const n = t => Array.from({ length: 225 }, (_, i) => M.premium(i)).filter(x => x === t).length;
  assert.equal(n('E'), 8);
});

test('true equations', () => {
  for (const s of ['1 + 2 = 3', '12 = 12', '2 * 3 + 4 = 10', '10 - 4 = 6', '- 3 + 5 = 2', '2 - 5 = - 3', '1 / 2 = 2 / 4',
    '1 + 1 = 2 = 4 / 2', '1 0 0 + 20 = 1 2 0', '20 / 4 = 5', '0 = 0', '3 * 0 = 0', '2 + 3 * 4 = 14', '1 / 10 + 2 / 10 = 3 / 10',
    '9 9 9 = 9 9 9', '18 / 3 - 2 = 4']) {
    assert.ok(ok(s).ok, s + ' → ' + JSON.stringify(ok(s)));
  }
});

test('false or badly formed equations say why', () => {
  const why = s => ok(s).reason;
  assert.equal(why('1 + 2 = 4'), 'eq_false');
  assert.equal(why('2 + 3 * 4 = 20'), 'eq_false');
  assert.equal(why('1 2'), 'eq_none');
  assert.equal(why('1 + = 2'), 'eq_ops');
  assert.equal(why('+ 1 = 1'), 'eq_ops');
  assert.equal(why('= 1 = 1'), 'eq_ops');
  assert.equal(why('1 = 1 ='), 'eq_ops');
  assert.equal(why('2 * - 3 = - 6'), 'eq_ops');
  assert.equal(why('3 - - 1 = 4'), 'eq_ops');
  assert.equal(why('0 5 = 5'), 'eq_lead0');
  assert.equal(why('1 0 0 0 = 1 0 0 0'), 'eq_digits');
  assert.equal(why('1 12 = 1 1 2'), 'eq_big');
  assert.equal(why('12 1 = 1 2 1'), 'eq_big');
  assert.equal(why('- 0 = 0'), 'eq_neg0');
  assert.equal(why('1 / 0 = 1'), 'eq_div0');
  assert.deepEqual(ok('6 = 2 + 3').values, ['6', '5']);
});

test('first move: across the star, in one line, no gaps', () => {
  const b = M.emptyBoard();
  const r = M.evaluatePlay(b, across(7, 5, ['1', '+', '2', '=', '3']));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.score, 1 + 2 + 1 + 1 + 1);
  assert.equal(r.main, '1+2=3');
  assert.equal(M.evaluatePlay(b, across(6, 5, ['1', '+', '2', '=', '3'])).reason, 'center');
  const bent = across(7, 6, ['1', '=', '1']); bent[2].c = M.at(8, 8);
  assert.equal(M.evaluatePlay(b, bent).reason, 'not_line');
  const gap = across(7, 6, ['1', '=', '1']); gap[2].c = M.at(7, 9);
  assert.equal(M.evaluatePlay(b, gap).reason, 'gap');
  assert.equal(M.evaluatePlay(b, [{ c: M.CENTER, id: idOf('5'), s: '5' }]).reason, 'eq_short');
  assert.equal(M.evaluatePlay(b, across(7, 6, ['?', '=', '1'])).reason, 'need_choice');
  assert.equal(M.evaluatePlay(b, across(7, 6, ['?:1', '=', '1'])).ok, true);
  assert.equal(M.evaluatePlay(b, across(7, 6, ['+-:*', '=', '1'])).reason, 'malformed');
});

test('later moves must touch the board, and every crossing line must be true', () => {
  const b = put(M.emptyBoard(), across(7, 5, ['1', '+', '2', '=', '3']));
  const used = new Map([['1', 1], ['2', 1], ['3', 1], ['=', 1], ['+', 1]]);
  // far away
  assert.equal(M.evaluatePlay(b, across(0, 0, ['2', '=', '2'], new Map(used))).reason, 'not_connected');
  // down through the "3" at (7,9): 6 / 2 = 3 → cells (4..7, 9)?  6 at (3,9), / (4,9), 2 (5,9), = (6,9), 3 is (7,9)
  const ps = down(3, 9, ['6', '/', '2', '='], new Map(used));
  const r = M.evaluatePlay(b, ps);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.main, '6÷2=3');
  // a tile that makes a false crossing line is refused and the line is reported
  const wrong = down(3, 9, ['8', '/', '2', '='], new Map(used));
  const w = M.evaluatePlay(b, wrong);
  assert.equal(w.reason, 'eq_false');
  assert.equal(w.text, '8÷2=3');
  assert.equal(w.bad.length, 5);
  // putting a tile next to a line so it reads "1+2=34" is refused
  const tail = [{ c: M.at(7, 10), id: idOf('4'), s: '4' }];
  assert.equal(M.evaluatePlay(b, tail).reason, 'eq_false');
  assert.equal(M.evaluatePlay(b, [{ c: M.at(7, 5), id: idOf('4'), s: '4' }]).reason, 'cell_taken');
});

test('scoring: tile bonuses on new tiles, equation bonuses multiply, old bonuses are spent, bingo +40', () => {
  // (7,3) is a ×2 tile square on the centre row
  const b = M.emptyBoard();
  const r = M.evaluatePlay(b, across(7, 3, ['4', '+', '4', '=', '8']));   // 4 lands on ×2 tile
  assert.ok(r.ok);
  assert.equal(r.score, 2 * 2 + 2 + 2 + 1 + 2);
  put(b, across(7, 3, ['4', '+', '4', '=', '8']));
  // extend down from the 8 at (7,7)? the star; use the first 4 at (7,3): 4 = 4 down from (7,3) uses (8,3),(9,3)
  const used = new Map([['4', 2], ['+', 1], ['=', 1], ['8', 1]]);
  const r2 = M.evaluatePlay(b, down(8, 3, ['=', '4'], used));
  assert.ok(r2.ok, JSON.stringify(r2));
  assert.equal(r2.score, 2 + 1 + 2);            // the ×2 under the old 4 is spent; (8,3),(9,3) plain
  // eight tiles at once: bingo
  const big = across(7, 4, ['1', '0', '+', '2', '*', '3', '=', '16']);
  const r3 = M.evaluatePlay(M.emptyBoard(), big);
  assert.ok(r3.ok, JSON.stringify(r3));
  assert.equal(r3.bingo, true);
  assert.equal(r3.score, 1 + 1 + 2 + 1 + 2 + 1 + 1 + 4 * 2 + 40);   // 16 lands on the ×2 at (7,11)
});

test('board and move text round-trips', () => {
  const ps = across(7, 5, ['1', '+-:+', '2', '=', '?:3']);
  const s = M.encodePlaced(ps);
  assert.equal(s.length, 25);
  assert.deepEqual(M.decodePlaced(s), ps);
  const b = put(M.emptyBoard(), ps);
  assert.deepEqual(M.decodeBoard(M.encodeBoard(b)), b);
  assert.equal(M.decodePlaced('zz'), null);
  assert.deepEqual(MH.decodeAct(MH.encodeAct({ t: 'play', ps, v: 3 })), { t: 'play', ps, v: 3 });
  assert.deepEqual(MH.decodeAct(MH.encodeAct({ t: 'swap', ids: [1, 99], v: 2 })), { t: 'swap', ids: [1, 99], v: 2 });
  assert.equal(MH.decodeAct({ t: 'play', ps: 'x' }), null);
});

test('bot: finds a true first move with a plain rack', () => {
  const rack = [idOf('1'), idOf('2'), idOf('3'), idOf('+'), idOf('='), idOf('7'), idOf('9'), idOf('*')];
  const best = Bot.bestMove(M.emptyBoard(), rack, { rng: rng(1) });
  assert.ok(best, 'found a move');
  const r = M.evaluatePlay(M.emptyBoard(), best.placements);
  assert.ok(r.ok);
  assert.equal(r.score, best.score);
});

test('bot: uses a blank only when it must', () => {
  const rack = [idOf('7'), idOf('9'), idOf('13'), idOf('19'), idOf('='), idOf('?'), idOf('17'), idOf('11')];
  const best = Bot.bestMove(M.emptyBoard(), rack, { rng: rng(2) });
  assert.ok(best, 'found a move');
  assert.ok(best.placements.some(p => M.tile(p.id).face === '?'));
  assert.ok(M.evaluatePlay(M.emptyBoard(), best.placements).ok);
});

test('host: deal, play, swap, pass, timer, game over; tiles never vanish', () => {
  const G = MH.createGame({ code: 'abcd', hostId: 'h', hostName: 'Mew', rules: { turnSec: 60 } });
  assert.equal(MH.addPlayer(G, 'f', 'Fah').ok, true);
  assert.equal(MH.start(G, rng(5), 1000).ok, true);
  assert.equal(G.players[0].hand.length, 8);
  assert.equal(G.bag.length, 84);
  assert.ok(MH.invariant(G));
  const pid = G.players[G.turn].id, other = G.players[1 - G.turn].id;
  assert.equal(MH.apply(G, other, { t: 'pass' }).reason, 'not_your_turn');
  assert.equal(MH.apply(G, pid, { t: 'pass', v: G.tn + 1 }).reason, 'stale');
  // swap two tiles
  const me = G.players[G.turn];
  const give = me.hand.slice(0, 2);
  assert.equal(MH.apply(G, pid, { t: 'swap', ids: give }, 2000, rng(9)).ok, true);
  assert.equal(me.hand.length, 8);
  assert.ok(MH.invariant(G));
  assert.equal(G.lastMove.k, 'swap');
  // the timer passes a turn that runs out
  assert.equal(MH.timeout(G, 2000 + 59000), null);
  const t0 = G.tn;
  assert.ok(MH.timeout(G, 2000 + 60000).ok);
  assert.equal(G.tn, t0 + 1);
  assert.equal(G.lastMove.k, 'timeout');
  // a long run of turns without points ends the game; everyone loses what they hold
  while (G.status === 'playing') MH.apply(G, G.players[G.turn].id, { t: 'pass' }, 5000);
  assert.equal(G.scoreless, 6);
  assert.equal(G.status, 'ended');
  assert.ok(G.result.every(r => r.delta === -r.left));
});

test('host: a real move scores and refills; a wrong one is refused', () => {
  const G = MH.createGame({ code: 'abcd', hostId: 'h', hostName: 'A' });
  MH.addPlayer(G, 'f', 'B');
  MH.start(G, rng(3), 1);
  const p = G.players[G.turn];
  // hand-craft the rack so the test knows a move
  const rack = across(7, 5, ['1', '+', '2', '=', '3']).map(x => x.id);
  const give = p.hand.filter(id => rack.indexOf(id) < 0).slice(0, rack.length);
  // swap tiles between the rack and wherever these tiles are now
  rack.forEach((id, k) => {
    if (p.hand.indexOf(id) >= 0) return;
    const holder = G.players.find(q => q.hand.indexOf(id) >= 0);
    const out = give.shift();
    p.hand[p.hand.indexOf(out)] = id;
    if (holder) holder.hand[holder.hand.indexOf(id)] = out; else G.bag[G.bag.indexOf(id)] = out;
  });
  assert.ok(MH.invariant(G));
  const bad = across(7, 5, ['1', '+', '2', '=', '3']); bad[4].s = '4';
  assert.equal(MH.apply(G, p.id, { t: 'play', ps: bad }).reason, 'malformed');
  const res = MH.apply(G, p.id, { t: 'play', ps: across(7, 5, ['1', '+', '2', '=', '3']), v: G.tn });
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(p.score, 6);
  assert.equal(p.hand.length, 8);
  assert.equal(G.lastMove.eq, '1+2=3');
  assert.ok(MH.invariant(G));
  const view = MH.readView(JSON.parse(JSON.stringify(MH.publicView(G, null, 5))));
  assert.equal(view.game, 'math');
  assert.deepEqual(view.lastMove.cs, across(7, 5, ['1', '+', '2', '=', '3']).map(x => x.c));
  assert.equal(view.board[M.CENTER][1], '2');
  assert.equal(view.players[G.players.indexOf(p)].score, 6);
  assert.ok(!JSON.stringify(MH.publicView(G)).includes('hand'));
});

test('bots play a whole game: every move legal, every tile accounted for', () => {
  const G = MH.createGame({ code: 'solo', hostId: 'me', hostName: 'A' });
  G.players[0].bot = true;
  MH.addBot(G);
  MH.start(G, rng(11), 1);
  let plays = 0, turns = 0;
  const t0 = Date.now();
  while (G.status === 'playing' && turns < 200) {
    const a = MH.botAction(G, { rng: rng(turns + 1), budget: 300000 });
    const res = MH.apply(G, G.players[G.turn].id, a, turns, rng(turns));
    assert.ok(res.ok, JSON.stringify(a) + ' ' + JSON.stringify(res));
    if (a.t === 'play') plays++;
    assert.ok(MH.invariant(G));
    turns++;
  }
  assert.equal(G.status, 'ended');
  assert.ok(plays >= 8, 'bots made real moves: ' + plays);
  assert.ok(Date.now() - t0 < 60000);
});

test('bot levels: easy plays weaker moves than hard on the same rack, both legal', () => {
  const rack = [idOf('1'), idOf('2'), idOf('3'), idOf('+'), idOf('='), idOf('7'), idOf('9'), idOf('*')];
  const hard = Bot.bestMove(M.emptyBoard(), rack, { rng: rng(4), level: 'hard' });
  let easyTotal = 0;
  for (let i = 0; i < 6; i++) {
    const e = Bot.bestMove(M.emptyBoard(), rack, { rng: rng(10 + i), level: 'easy' });
    assert.ok(M.evaluatePlay(M.emptyBoard(), e.placements).ok);
    easyTotal += e.score;
  }
  assert.ok(easyTotal / 6 < hard.score, easyTotal / 6 + ' < ' + hard.score);
  const G = MH.createGame({ code: 'x', hostId: 'h', hostName: 'A', rules: { botLevel: 'easy' } });
  assert.equal(G.rules.botLevel, 'easy');
  assert.equal(MH.createGame({ code: 'x', hostId: 'h', hostName: 'A', rules: { botLevel: 'evil' } }).rules.botLevel, 'normal');
  assert.equal(MH.readView(MH.publicView(G)).rules.botLevel, 'easy');
});
