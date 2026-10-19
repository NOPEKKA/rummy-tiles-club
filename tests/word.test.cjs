const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const M = require('../src/wordrules.js');
const Bot = require('../src/wordbot.js');
const WH = require('../src/wordhost.js');
const Dawg = require('../tools/dawg.cjs');

// the word list exactly as the site ships it (docs/words.js: gzip in base64)
const shipped = fs.readFileSync(path.join(__dirname, '..', 'docs', 'words.js'), 'utf8');
const b64 = /WORDS_B64 = '([A-Za-z0-9+/=]+)'/.exec(shipped)[1];
M.setDict(M.unpack(zlib.gunzipSync(Buffer.from(b64, 'base64'))));
const WORDS = Dawg.clean(fs.readFileSync(path.join(__dirname, '..', 'data', 'enable1.txt'), 'utf8'), 15);

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
/** the k-th tile with this face */
function idOf(face, k = 0) {
  const ids = [];
  for (let i = 0; i < M.TILE_COUNT; i++) if (M.tile(i).face === face) ids.push(i);
  if (ids[k] === undefined) throw new Error('no tile ' + face + '#' + k);
  return ids[k];
}
/** placements along a line from (r, c): 'C A ?:T' style, ?:X is a blank showing X */
function lay(r, c, d, word, used = new Map()) {
  return word.split(' ').map((f, k) => {
    const [face, sym] = f.split(':');
    const n = used.get(face) || 0; used.set(face, n + 1);
    return { c: d ? M.at(r + k, c) : M.at(r, c + k), id: idOf(face, n), s: sym || face };
  });
}
const across = (r, c, w, used) => lay(r, c, 0, w, used);
const down = (r, c, w, used) => lay(r, c, 1, w, used);
function put(board, ps) { ps.forEach(p => { board[p.c] = [p.id, p.s]; }); return board; }

test('100 tiles: 98 letters and 2 blanks, my own counts and points', () => {
  assert.equal(M.TILE_COUNT, 100);
  const count = f => Array.from({ length: 100 }, (_, i) => M.tile(i)).filter(t => t.face === f).length;
  assert.deepEqual(['E', 'A', 'O', 'I', 'T', 'S', 'Q', 'Z', '?'].map(count), [12, 9, 8, 8, 7, 5, 1, 1, 2]);
  assert.deepEqual(['E', 'D', 'H', 'F', 'K', 'X', 'J', 'Q', '?'].map(f => M.tile(idOf(f)).pts), [1, 2, 3, 4, 5, 8, 9, 10, 0]);
  assert.equal(M.options('?').length, 26);
  assert.deepEqual(M.options('Q'), ['Q']);
  assert.ok(M.needsChoice('?') && !M.needsChoice('A'));
});

test('bonus squares: symmetric both ways, 8 / 17 / 12 / 24, the star in the middle', () => {
  const n = { W: 0, w: 0, L: 0, l: 0, '*': 0 };
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
    const p = M.premium(M.at(r, c));
    if (p) n[p]++;
    assert.equal(p, M.premium(M.at(14 - r, c)));
    assert.equal(p, M.premium(M.at(r, 14 - c)));
    assert.equal(p, M.premium(M.at(c, r)), 'mirrored across the diagonal too');
  }
  assert.deepEqual(n, { W: 8, w: 16, L: 12, l: 24, '*': 1 });
  assert.equal(M.premium(M.CENTER), '*');
  assert.deepEqual(M.mults(M.CENTER), [1, 2]);
});

test('the shipped word list holds every ENABLE word of 2–15 letters and nothing else', () => {
  assert.equal(WORDS.length, 168551);
  for (const w of WORDS) if (!M.isWord(w)) assert.fail('missing ' + w);
  const set = new Set(WORDS), r = rng(3), abc = 'abcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < 50000; i++) {
    let w = '';
    for (let k = 0, n = 2 + Math.floor(r() * 6); k < n; k++) w += abc[Math.floor(r() * 26)];
    assert.equal(M.isWord(w), set.has(w), w);
  }
  assert.ok(M.isWord('XU') && M.isWord('jo') && M.isWord('ZYZZYVA') && M.isWord('Cat'));
  assert.ok(!M.isWord('QI') && !M.isWord('A') && !M.isWord('') && !M.isWord('CATZ'));
});

test('first move: across the star, one line, no gaps, two letters or more, a real word', () => {
  const b = M.emptyBoard();
  assert.equal(M.evaluatePlay(b, across(7, 6, 'C A T')).score, 10, 'CAT on the star: (3+1+1) × 2');
  assert.equal(M.evaluatePlay(b, across(6, 6, 'C A T')).reason, 'center');
  assert.equal(M.evaluatePlay(b, [{ c: M.CENTER, id: idOf('A'), s: 'A' }]).reason, 'word_short');
  const gap = across(7, 6, 'C A T'); gap[2].c = M.at(7, 9);
  assert.equal(M.evaluatePlay(b, gap).reason, 'gap');
  const bent = across(7, 6, 'C A T'); bent[2].c = M.at(8, 7);
  assert.equal(M.evaluatePlay(b, bent).reason, 'not_line');
  const r = M.evaluatePlay(b, across(7, 6, 'C X T'));
  assert.equal(r.reason, 'not_word');
  assert.equal(r.text, 'CXT');
  assert.equal(M.evaluatePlay(b, across(7, 6, '? A T')).reason, 'need_choice', 'a blank needs its letter');
  assert.equal(M.evaluatePlay(b, across(7, 6, 'C A T').map(p => Object.assign(p, { s: p.s === 'A' ? 'E' : p.s }))).reason, 'malformed', 'a letter tile is only itself');
});

test('later moves join the board and every crossing word must be real', () => {
  const b = put(M.emptyBoard(), across(7, 6, 'C A T'));
  assert.equal(M.evaluatePlay(b, across(3, 3, 'D O G')).reason, 'not_connected');
  // PAT down onto the T: P (5,8), A (6,8, letter ×2), T already there
  const pat = M.evaluatePlay(b, down(5, 8, 'P A', new Map([['A', 1]])));
  assert.ok(pat.ok, JSON.stringify(pat));
  assert.equal(pat.main, 'PAT');
  assert.equal(pat.score, 3 + 2 + 1);
  // S under the C makes "CS" downwards: not a word, and the move says which
  const cs = M.evaluatePlay(b, [{ c: M.at(8, 6), id: idOf('S'), s: 'S' }]);
  assert.equal(cs.reason, 'not_word');
  assert.equal(cs.text, 'CS');
  // S after CAT: CATS, one word
  const cats = M.evaluatePlay(b, [{ c: M.at(7, 9), id: idOf('S'), s: 'S' }]);
  assert.ok(cats.ok && cats.main === 'CATS' && cats.score === 6 && cats.lines.length === 1);
});

test('scoring: word ×3 on new tiles, spent bonuses, blanks score 0, two words at once, bingo +40', () => {
  const b = put(M.emptyBoard(), [{ c: M.at(0, 1), id: idOf('A'), s: 'A' }]);
  assert.equal(M.evaluatePlay(b, [{ c: M.at(0, 0), id: idOf('B'), s: 'B' }]).score, (3 + 1) * 3, 'BA on a word ×3');
  assert.equal(M.evaluatePlay(b, [{ c: M.at(0, 0), id: idOf('?'), s: 'B' }]).score, 3, 'a blank B is worth 0');
  put(b, [{ c: M.at(0, 0), id: idOf('B'), s: 'B' }]);
  assert.equal(M.evaluatePlay(b, [{ c: M.at(0, 2), id: idOf('T'), s: 'T' }]).score, 5, 'BAT: the ×3 under B is spent');
  // two words at once: O under the A of "BA" makes "AO"? no — use "AT" + "TA"
  const two = put(M.emptyBoard(), across(7, 7, 'A T'));
  const r = M.evaluatePlay(two, [{ c: M.at(8, 7), id: idOf('T', 1), s: 'T' }, { c: M.at(8, 8), id: idOf('A', 1), s: 'A' }]);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.lines.map(L => L.text).sort(), ['AT', 'TA', 'TA']);
  const bingo = M.evaluatePlay(M.emptyBoard(), across(7, 4, 'R E T A I N S'));
  assert.ok(bingo.ok && bingo.bingo);
  assert.equal(bingo.score, 7 * 2 + 40, 'RETAINS on the star, all seven tiles');
});

test('board and move text round-trips', () => {
  const ps = across(7, 6, 'C ?:A T');
  const enc = M.encodePlaced(ps);
  assert.equal(enc.length, 15);
  assert.deepEqual(M.decodePlaced(enc), ps);
  const b = put(M.emptyBoard(), ps);
  assert.deepEqual(M.decodeBoard(M.encodeBoard(b)), b);
  assert.equal(M.decodePlaced('zz'), null);
  assert.deepEqual(M.decodeIds(M.encodeIds([0, 55, 99])), [0, 55, 99]);
});

/** Every legal move for a rack, the slow way: fill each stretch of each line with every ordering of rack tiles. */
function bruteMoves(board, rack) {
  const keys = new Map();
  const letters = rack.map(id => M.tile(id).face);
  for (let d = 0; d < 2; d++) for (let n = 0; n < 15; n++) {
    const line = Array.from({ length: 15 }, (_, k) => (d ? M.at(k, n) : M.at(n, k)));
    for (let a = 0; a < 15; a++) for (let z = a; z < 15; z++) {
      const empties = line.slice(a, z + 1).filter(c => !board[c]);
      if (!empties.length || empties.length > rack.length) continue;
      const pick = (k, usedIdx, acc) => {
        if (k === empties.length) {
          const ps = acc.map((i, j) => ({ c: empties[j], id: rack[i], s: letters[i] }));
          const r = M.evaluatePlay(board, ps);
          if (r.ok) keys.set(ps.map(p => p.c + p.s).sort().join(','), r.score);
          return;
        }
        for (let i = 0; i < rack.length; i++) if (!usedIdx.has(i)) { usedIdx.add(i); acc.push(i); pick(k + 1, usedIdx, acc); acc.pop(); usedIdx.delete(i); }
      };
      pick(0, new Set(), []);
    }
  }
  return keys;
}

test('bot: finds exactly the legal moves (checked against a brute-force search) and scores them right', () => {
  const r = rng(11);
  for (let round = 0; round < 6; round++) {
    // a board from a few real moves, then a small rack
    const G = WH.createGame({ code: 't', hostId: 'b0', hostName: 'x' });
    WH.addBot(G); G.players.shift(); G.hostId = 'bot1'; WH.addBot(G);
    WH.start(G, r, 1);
    for (let i = 0; i <= round; i++) WH.apply(G, G.players[G.turn].id, WH.botAction(G, { rng: r, level: 'hard' }), 1, r);
    const rack = G.players[G.turn].hand.filter(id => M.tile(id).face !== '?').slice(0, 4);
    const job = Bot.create(G.board, rack, { rng: r });
    while (!job.step()) { /* all of it */ }
    const got = new Map();
    for (const mv of job.moves()) {
      const res = M.evaluatePlay(G.board, mv.placements);
      assert.ok(res.ok, 'bot move is legal: ' + mv.main);
      assert.equal(mv.score, res.score, 'bot score for ' + mv.main);
      got.set(mv.placements.map(p => p.c + p.s).sort().join(','), mv.score);
    }
    assert.ok(job.found < 2000, 'all moves were kept');
    const want = bruteMoves(G.board, rack);
    assert.deepEqual([...got.keys()].sort(), [...want.keys()].sort(), 'round ' + round + ' rack ' + rack.map(id => M.tile(id).face).join(''));
  }
});

test('bot: a blank stands in when the letters alone make nothing, and it says which letter', () => {
  const b = M.emptyBoard();
  const rack = ['B', 'C', 'D', 'F', 'G', 'H', '?'].map(f => idOf(f));
  const mv = Bot.bestMove(b, rack, { rng: rng(2), level: 'hard' });
  assert.ok(mv, 'a move with the blank');
  const blank = mv.placements.find(p => p.id === idOf('?'));
  assert.ok(blank && /^[A-Z]$/.test(blank.s));
  assert.ok(M.evaluatePlay(b, mv.placements).ok);
  // easy only reaches for a blank when nothing else works
  const plain = ['C', 'A', 'T', 'S', 'E', 'R', '?'].map(f => idOf(f));
  const easy = Bot.bestMove(b, plain, { rng: rng(2), level: 'easy' });
  assert.ok(easy && !easy.placements.some(p => p.id === idOf('?')));
});

test('bot: thinks in slices that stop on time', () => {
  const G = WH.createGame({ code: 't', hostId: 'h', hostName: 'x' });
  WH.addBot(G); WH.addBot(G); G.players.shift(); G.hostId = 'bot1';
  const r = rng(5);
  WH.start(G, r, 1);
  for (let i = 0; i < 6; i++) WH.apply(G, G.players[G.turn].id, WH.botAction(G, { rng: r }), 1, r);
  // the slowest kind of rack: two blanks
  const rack = G.players[G.turn].hand.slice(0, 5).concat([idOf('?'), idOf('?', 1)]).filter((x, i, a) => a.indexOf(x) === i).slice(0, 7);
  const job = Bot.create(G.board, rack, { rng: r, level: 'hard' });
  let slices = 0, worst = 0;
  for (;;) {
    const t0 = performance.now();
    const done = job.step(3);
    worst = Math.max(worst, performance.now() - t0);
    slices++;
    if (done) break;
  }
  assert.ok(job.best, 'found something');
  assert.ok(worst < 30, 'no slice ran long: ' + worst.toFixed(1) + ' ms');
});

test('host: deal 7, play, swap, pass, timer, game over; tiles never vanish', () => {
  const r = rng(9);
  const G = WH.createGame({ code: 'abcd', hostId: 'h', hostName: 'Host', rules: { turnSec: 60 } });
  assert.equal(G.game, 'word');
  WH.addPlayer(G, 'g', 'Guest');
  assert.ok(WH.start(G, r, 1000).ok);
  assert.ok(G.players.every(p => p.hand.length === 7) && G.bag.length === 86 && WH.invariant(G));
  const pv = WH.publicView(G, null, 1000);
  assert.equal(pv.g, 'word');
  assert.ok(pv.c && pv.h && pv.s && pv.v, 'the public view keeps c/h/s/v (the Firebase rules check those)');
  assert.ok(!JSON.stringify(pv).includes('"hand"'));
  const who = G.players[G.turn];
  // a forged move: tiles that aren't yours
  assert.equal(WH.apply(G, who.id, { t: 'play', ps: [{ c: M.CENTER, id: G.bag[0], s: M.tile(G.bag[0]).face }], v: G.tn }, 1000, r).reason, 'not_your_tile');
  assert.equal(WH.apply(G, who.id, { t: 'swap', ids: who.hand.slice(0, 2), v: G.tn }, 1000, r).ok, true);
  assert.equal(G.lastMove.k, 'swap');
  assert.ok(WH.invariant(G));
  assert.equal(WH.timeout(G, 1000 + 59000), null);
  assert.equal(WH.timeout(G, 1000 + 61000).ok, true);
  assert.equal(G.lastMove.k, 'timeout');
  // the network shapes round-trip
  const act = { t: 'play', ps: across(7, 6, 'C ?:A T'), v: 4 };
  assert.deepEqual(WH.decodeAct(WH.encodeAct(act)), act);
  assert.equal(WH.decodeAct({ t: 'play', ps: 'x'.repeat(40) }), null);
  // six scoreless turns in a row end a two-player game
  let res;
  for (let i = 0; i < 6 && G.status === 'playing'; i++) res = WH.apply(G, G.players[G.turn].id, { t: 'pass' }, 2000, r);
  assert.ok(res.ended && G.status === 'ended' && WH.invariant(G));
  assert.ok(G.result.every((x, i) => x.left === M.rackValue(G.players[i].hand)));
});

test('bots play whole games at every level: every move legal, every tile accounted for', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    const r = rng(level.length * 7);
    const G = WH.createGame({ code: 't', hostId: 'h', hostName: 'x', rules: { botLevel: level } });
    WH.addBot(G); WH.addBot(G); WH.addBot(G); G.players.shift(); G.hostId = 'bot1';
    WH.start(G, r, 1);
    let turns = 0;
    while (G.status === 'playing' && turns < 300) {
      const res = WH.apply(G, G.players[G.turn].id, WH.botAction(G, { rng: r }), 1, r);
      assert.ok(res.ok, level + ' bot move refused: ' + res.reason);
      assert.ok(WH.invariant(G));
      turns++;
    }
    assert.equal(G.status, 'ended', level + ' game finished');
    assert.ok(G.players.some(p => p.score > 100), level + ' scores ' + G.players.map(p => p.score));
  }
});

test('bot levels: easy plays weaker moves than hard on the same racks', () => {
  const r = rng(21);
  let easy = 0, hard = 0;
  for (let i = 0; i < 12; i++) {
    const bag = M.shuffle(M.fullBag(), r);
    const board = put(M.emptyBoard(), across(7, 6, 'C A T'));
    const rack = bag.filter(id => !board.some(x => x && x[0] === id)).slice(0, 7);
    const e = Bot.bestMove(board, rack, { rng: r, level: 'easy' }), hd = Bot.bestMove(board, rack, { rng: r, level: 'hard' });
    assert.ok(e && hd && M.evaluatePlay(board, e.placements).ok && M.evaluatePlay(board, hd.placements).ok);
    assert.ok(hd.score >= e.score);
    easy += e.score; hard += hd.score;
  }
  assert.ok(hard > easy * 1.3, 'hard ' + hard + ' vs easy ' + easy);
});

test('swap pick keeps blanks, an S and a balanced few', () => {
  const rack = [idOf('Q'), idOf('V'), idOf('W'), idOf('S'), idOf('E'), idOf('E', 1), idOf('?')];
  const out = Bot.swapPick(rack).map(id => M.tile(id).face).sort().join('');
  assert.equal(out, 'EQVW');
});
