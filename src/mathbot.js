// Bot for the math crossword. It tries every free stretch of a row or column
// next to the tiles already down, filling the gaps from its rack left to right
// while checking the grammar and the arithmetic as it goes. The search runs in
// small slices (step), so the page keeps drawing while a bot thinks.
(function (root) {
  'use strict';
  const M = (root.RK && root.RK.MathRules) || require('./mathrules.js');
  const { SIZE, CELLS, CENTER } = M;

  // grammar states
  const START = 0, NEG = 1, OP = 2, DIG = 3, BIG = 4;
  const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /**
   * Feed one symbol to a running equation. Returns the new state, or null when
   * the symbol can't go there (bad grammar, ÷0, or a side that doesn't match).
   * A state: st, nd (digits so far), lz (number started with 0), num, neg,
   * acc (finished terms), term, sign, mul (0, 1 = ×, 2 = ÷), target (first side), eqs.
   */
  function closeNumber(s) {
    const v = s.neg ? -s.num : s.num;
    if (s.mul === 0) return v;
    if (s.mul === 1) return s.term * v;
    return v === 0 ? NaN : s.term / v;
  }
  function feed(s, x) {
    const c = x.charCodeAt(0);
    if (x.length === 1 && c >= 48 && c <= 57) {           // 0–9
      const d = c - 48;
      if (s.st === START || s.st === OP) return { st: DIG, nd: 1, lz: d === 0, num: d, neg: false, acc: s.acc, term: s.term, sign: s.sign, mul: s.mul, target: s.target, eqs: s.eqs };
      if (s.st === NEG) return d === 0 ? null : { st: DIG, nd: 1, lz: false, num: d, neg: true, acc: s.acc, term: s.term, sign: s.sign, mul: s.mul, target: s.target, eqs: s.eqs };
      if (s.st === DIG) return s.lz || s.nd >= 3 ? null : { st: DIG, nd: s.nd + 1, lz: false, num: s.num * 10 + d, neg: s.neg, acc: s.acc, term: s.term, sign: s.sign, mul: s.mul, target: s.target, eqs: s.eqs };
      return null;
    }
    if (x.length === 2 && c >= 48 && c <= 57) {           // 10–20
      if (s.st === START || s.st === OP || s.st === NEG) return { st: BIG, nd: 0, lz: false, num: +x, neg: s.st === NEG, acc: s.acc, term: s.term, sign: s.sign, mul: s.mul, target: s.target, eqs: s.eqs };
      return null;
    }
    if (x === '=') {
      if (s.st !== DIG && s.st !== BIG) return null;
      const term = closeNumber(s);
      if (term !== term) return null;
      const side = s.acc + s.sign * term;
      if (s.eqs && !near(side, s.target)) return null;
      return { st: START, nd: 0, lz: false, num: 0, neg: false, acc: 0, term: 0, sign: 1, mul: 0, target: s.eqs ? s.target : side, eqs: s.eqs + 1 };
    }
    // + - * /
    if (s.st === START && x === '-') return { st: NEG, nd: 0, lz: false, num: 0, neg: false, acc: s.acc, term: s.term, sign: s.sign, mul: s.mul, target: s.target, eqs: s.eqs };
    if (s.st !== DIG && s.st !== BIG) return null;
    const term = closeNumber(s);
    if (term !== term) return null;
    if (x === '+' || x === '-') return { st: OP, nd: 0, lz: false, num: 0, neg: false, acc: s.acc + s.sign * term, term: 0, sign: x === '-' ? -1 : 1, mul: 0, target: s.target, eqs: s.eqs };
    return { st: OP, nd: 0, lz: false, num: 0, neg: false, acc: s.acc, term, sign: s.sign, mul: x === '*' ? 1 : 2, target: s.target, eqs: s.eqs };
  }
  function finished(s) {
    if ((s.st !== DIG && s.st !== BIG) || !s.eqs) return false;
    const term = closeNumber(s);
    return term === term && near(s.acc + s.sign * term, s.target);
  }
  const FRESH = { st: START, nd: 0, lz: false, num: 0, neg: false, acc: 0, term: 0, sign: 1, mul: 0, target: 0, eqs: 0 };

  /**
   * Start a search. board: the host's board, rack: tile ids.
   * opts.budget: how many symbols to try in all (keeps it bounded), opts.rng.
   * Returns { step(ms) → done, best: {placements, score, main} | null }.
   */
  function create(board, rack, opts) {
    opts = opts || {};
    const budget = opts.budget || 1200000;
    const slotCap = opts.slotCap || 40000;
    const rng = opts.rng || Math.random;
    const syms = board.map(x => (x ? x[1] : null));
    const empty = syms.every(x => !x);

    // the rack as faces with counts, in a random order so bots don't all play alike
    const faceIds = new Map();
    rack.forEach(id => { const f = M.tile(id).face; if (!faceIds.has(f)) faceIds.set(f, []); faceIds.get(f).push(id); });
    const faces = M.shuffle([...faceIds.keys()], rng);
    const left = faces.map(f => faceIds.get(f).length);

    // What may go in an empty cell, given the tiles above/below it (or left/right):
    // null = nothing there, anything goes; otherwise the set of symbols that make that line true.
    const cross = [new Map(), new Map()];
    const quick = seq => { let st = FRESH; for (let i = 0; i < seq.length && st; i++) st = feed(st, seq[i]); return !!st && finished(st); };
    function crossAt(d, cell) {
      const m = cross[d];
      if (m.has(cell)) return m.get(cell);
      const pd = 1 - d, [r, c] = M.rc(cell);
      const step = pd === 0 ? 1 : SIZE, k = pd === 0 ? c : r;
      const before = [], after = [];
      for (let j = k - 1, x = cell - step; j >= 0 && syms[x]; j--, x -= step) before.unshift(syms[x]);
      for (let j = k + 1, x = cell + step; j < SIZE && syms[x]; j++, x += step) after.push(syms[x]);
      let v = null;
      // a quick float pass throws out almost everything; exact fractions confirm what's left
      if (before.length || after.length) v = new Set(M.SYMS.filter(s => { const seq = before.concat([s], after); return quick(seq) && M.checkLine(seq).ok; }));
      m.set(cell, v);
      return v;
    }

    // every stretch [a, b] of a row or column that a move could turn into one equation;
    // found one line at a time inside step(), so even this part never blocks a frame
    const small = [], large = [];
    let slots = null, li = 0;
    function scanLine(n) {
        const d = n < SIZE ? 0 : 1, L = n % SIZE;
        if (empty && (d !== 0 || L !== 7)) return;
        const line = Array.from({ length: SIZE }, (_, k) => (d === 0 ? M.at(L, k) : M.at(k, L)));
        for (let a = 0; a < SIZE; a++) {
          if (a > 0 && syms[line[a - 1]]) continue;
          let gaps = 0, touch = false, blocked = false;
          for (let b = a; b < SIZE; b++) {
            const cell = line[b];
            if (syms[cell]) touch = true;
            else {
              gaps++;
              if (gaps > rack.length) break;
              const cx = empty ? null : crossAt(d, cell);
              if (cx && !cx.size) { blocked = true; break; }
              if (cx) touch = true;
            }
            if (b - a < 2 || !gaps) continue;
            if (b < SIZE - 1 && syms[line[b + 1]]) continue;
            if (empty ? !(a <= 7 && b >= 7) : !touch) continue;
            (gaps <= 4 ? small : large).push({ d, cells: line.slice(a, b + 1), gaps });
          }
          if (blocked) continue;
        }
    }

    let si = 0, nodes = 0, best = null, blanks = false, slotNodes = 0, found = 0;
    const cands = [];
    const blankAt = faces.indexOf('?');
    const choice = [];   // per position in the slot: [faceIndex, sym] for gaps

    function leaf(slot) {
      const used = new Map();
      const placements = [];
      slot.cells.forEach((cell, i) => {
        if (syms[cell]) return;
        const [fi, s] = choice[i];
        const f = faces[fi];
        const n = used.get(f) || 0;
        used.set(f, n + 1);
        placements.push({ c: cell, id: faceIds.get(f)[n], s });
      });
      const res = M.evaluatePlay(board, placements);
      if (!res.ok) return;
      const mv = { placements, score: res.score, main: res.main };
      if (!best || mv.score > best.score) best = mv;
      // a fair sample of everything found, for the easier levels
      found++;
      if (cands.length < 2000) cands.push(mv);
      else { const j = Math.floor(rng() * found); if (j < cands.length) cands[j] = mv; }
    }

    function dfs(slot, i, st, blankUsed) {
      if (nodes >= budget || slotNodes >= slotCap) return;
      const cells = slot.cells;
      if (i === cells.length) { if (finished(st)) leaf(slot); return; }
      const cell = cells[i];
      const fixed = syms[cell];
      if (fixed) {
        nodes++; slotNodes++;
        const ns = feed(st, fixed);
        if (ns) dfs(slot, i + 1, ns, blankUsed);
        return;
      }
      const cx = empty ? null : crossAt(slot.d, cell);
      for (let fi = 0; fi < faces.length; fi++) {
        if (!left[fi]) continue;
        const isBlank = fi === blankAt;
        if (isBlank && (!blanks || blankUsed)) continue;
        const opts = M.options(faces[fi]);
        for (let k = 0; k < opts.length; k++) {
          const s = opts[k];
          if (cx && !cx.has(s)) continue;
          nodes++; slotNodes++;
          const ns = feed(st, s);
          if (!ns) continue;
          left[fi]--; choice[i] = [fi, s];
          dfs(slot, i + 1, ns, blankUsed || isBlank);
          left[fi]++;
          if (nodes >= budget || slotNodes >= slotCap) return;
        }
      }
    }

    function step(ms) {
      const end = clock() + (ms === undefined ? Infinity : ms);
      while (!slots) {
        scanLine(li++);
        if (li >= 2 * SIZE) slots = M.shuffle(small, rng).concat(M.shuffle(large, rng));
        else if (clock() >= end) return false;
      }
      while (nodes < budget) {
        if (si >= slots.length) {
          // nothing without blanks: try again letting one blank stand for anything
          if (best || blanks || blankAt < 0) return true;
          blanks = true; si = 0;
          continue;
        }
        slotNodes = 0;
        dfs(slots[si++], 0, FRESH, false);
        if (clock() >= end) return false;
      }
      return true;
    }
    /**
     * The move for a level: hard = the best found, normal = from the top fifth,
     * easy = somewhere in the middle (still a real equation, just not the cleverest).
     */
    function pick(level) {
      if (!best || level === 'hard' || !level) return best;
      const all = cands.slice().sort((a, b) => b.score - a.score);
      const f = level === 'easy' ? 0.35 + 0.35 * rng() : 0.2 * rng();
      return all[Math.min(all.length - 1, Math.floor(all.length * f))] || best;
    }
    return { step, pick, get best() { return best; }, get nodes() { return nodes; }, get found() { return found; }, get slots() { return slots ? slots.length : 0; } };
  }

  /** Run a whole search at once (tests, or when time doesn't matter). */
  function bestMove(board, rack, opts) {
    const job = create(board, rack, opts);
    while (!job.step()) { /* keep going */ }
    return job.pick(opts && opts.level);
  }

  /** No move found: which tiles to trade back. Keep one =, a few small numbers and one operator. */
  function swapPick(rack) {
    const keep = new Set();
    const by = f => rack.filter(id => !keep.has(id) && f(M.tile(id).face));
    by(f => f === '=').slice(0, 1).forEach(id => keep.add(id));
    by(f => f.length === 1 && f >= '1' && f <= '9').slice(0, 3).forEach(id => keep.add(id));
    by(f => f === '+' || f === '-' || f === '+-').slice(0, 1).forEach(id => keep.add(id));
    by(f => f === '?').forEach(id => keep.add(id));
    const out = rack.filter(id => !keep.has(id));
    return out.length ? out : rack.slice();
  }

  const api = { create, bestMove, swapPick, feed, finished, FRESH };
  root.RK = root.RK || {};
  root.RK.MathBot = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
