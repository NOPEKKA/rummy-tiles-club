// Bot for the word crossword. It finds moves the classic way: for every
// "anchor" (an empty square next to a tile) it walks the word list from each
// start square to the left of it, laying rack tiles as it goes and only
// letters the crossing words allow. The walk keeps its own stack, so it can
// stop after a few milliseconds and pick up where it was: the page keeps
// drawing while a bot thinks.
(function (root) {
  'use strict';
  const M = (root.RK && root.RK.WordRules) || require('./wordrules.js');
  const { SIZE, CELLS, RACK, BINGO, LETTERS, LETTER_PTS } = M;
  const ALL = (1 << 26) - 1;
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const ENTER = 0, ITER = 1, DONE = 2;

  // the cells of every row (d = 0) and column (d = 1), left to right / top to bottom
  const LINES = [0, 1].map(d => Array.from({ length: SIZE }, (_, n) => Int16Array.from({ length: SIZE }, (_, k) => (d === 0 ? M.at(n, k) : M.at(k, n)))));
  const LM = new Uint8Array(CELLS), WM = new Uint8Array(CELLS);
  for (let c = 0; c < CELLS; c++) { const [l, w] = M.mults(c); LM[c] = l; WM[c] = w; }
  // how the levels search: blanks always (with a budget) or only when nothing else works
  const LEVELS = {
    easy: { blanks: 'fallback', blankBudget: 400000 },
    normal: { blanks: 'always', blankBudget: 1500000 },
    hard: { blanks: 'always', blankBudget: 6000000 }
  };

  /**
   * Start a search. board: the host's board, rack: tile ids.
   * opts: level (easy | normal | hard), rng, budget / blankBudget (edges to try, keeps it bounded).
   * Returns { step(ms) → done, pick(level), best: {placements, score, main} | null }.
   */
  function create(board, rack, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const lv = LEVELS[opts.level] || LEVELS.normal;
    const budget = opts.budget || 8000000;
    const blankBudget = opts.blankBudget !== undefined ? opts.blankBudget : lv.blankBudget;
    const D = M.dict();
    const CAP = 2000;

    // the board as letters (−1 = empty) and tile points
    const L = new Int8Array(CELLS).fill(-1), P = new Uint8Array(CELLS);
    board.forEach((x, c) => { if (x) { L[c] = x[1].charCodeAt(0) - 65; P[c] = M.tile(x[0]).pts; } });
    const empty = board.every(x => !x);

    // the rack: letter counts, blanks, and which ids to hand back
    const count = new Int8Array(26), idsOf = LETTERS.map(() => []), blankIds = [];
    rack.forEach(id => {
      const f = M.tile(id).face;
      if (f === '?') blankIds.push(id);
      else { const l = f.charCodeAt(0) - 65; count[l]++; idsOf[l].push(id); }
    });
    const blanks0 = blankIds.length, rackN = rack.length;
    let bl = 0;                     // blanks free to use right now (0 until the blank pass)

    // ---- the word list ----
    function find(i, l) {           // edge with letter l in the edge list at i, or −1
      for (;;) {
        const e = D[i];
        if ((e & 31) === l) return i;
        if (e & 64) return -1;
        i++;
      }
    }

    // ---- crossing words ----
    // For a move along d, a square may only take letters that make its crossing word real.
    // mask: those letters (ALL when nothing crosses); xs: points already in the crossing word.
    const mask = [new Int32Array(CELLS), new Int32Array(CELLS)];
    const xs = [new Int16Array(CELLS), new Int16Array(CELLS)];
    const hx = [new Uint8Array(CELLS), new Uint8Array(CELLS)];
    const anchor = new Uint8Array(CELLS);
    function crossChecks() {
      for (let c = 0; c < CELLS; c++) {
        if (L[c] >= 0) continue;
        anchor[c] = empty ? (c === M.CENTER ? 1 : 0) : M.neighbours(c).some(q => L[q] >= 0) ? 1 : 0;
      }
      for (let d = 0; d < 2; d++) {
        const step = d === 0 ? SIZE : 1;          // the crossing word runs the other way
        for (let c = 0; c < CELLS; c++) {
          if (L[c] >= 0) continue;
          const [r, col] = M.rc(c), k = d === 0 ? r : col;
          const before = [], after = [];
          for (let j = k - 1, x = c - step; j >= 0 && L[x] >= 0; j--, x -= step) before.unshift(x);
          for (let j = k + 1, x = c + step; j < SIZE && L[x] >= 0; j++, x += step) after.push(x);
          if (!before.length && !after.length) { mask[d][c] = ALL; continue; }
          hx[d][c] = 1;
          let sum = 0;
          before.forEach(x => { sum += P[x]; }); after.forEach(x => { sum += P[x]; });
          xs[d][c] = sum;
          let i = D[0], okPrefix = true;
          for (const x of before) {
            const e = i ? find(i, L[x]) : -1;
            if (e < 0) { okPrefix = false; break; }
            i = D[e] >>> 7;
          }
          let m = 0;
          if (okPrefix && i) {
            for (let e = i; ; e++) {
              const ev = D[e];
              let ok;
              if (!after.length) ok = (ev & 32) !== 0;
              else {
                let j = ev >>> 7;
                ok = false;
                for (let t = 0; t < after.length; t++) {
                  const f = j ? find(j, L[after[t]]) : -1;
                  if (f < 0) break;
                  if (t === after.length - 1) ok = (D[f] & 32) !== 0;
                  else j = D[f] >>> 7;
                }
              }
              if (ok) m |= 1 << (ev & 31);
              if (ev & 64) break;
            }
          }
          mask[d][c] = m;
        }
      }
    }

    // ---- where to start ----
    // A unit = (direction, line, start square s, anchor a). Squares between s and a are empty
    // and cross nothing, so each move is made by exactly one unit.
    function makeUnits() {
      const out = [];
      for (let d = 0; d < 2; d++) for (let n = 0; n < SIZE; n++) {
        if (empty && (d !== 0 || n !== 7)) continue;     // the empty board is symmetric: across the middle row is enough
        const lc = LINES[d][n];
        for (let a = 0; a < SIZE; a++) {
          if (!anchor[lc[a]]) continue;
          if (a > 0 && L[lc[a - 1]] >= 0) {
            let s = a - 1;
            while (s > 0 && L[lc[s - 1]] >= 0) s--;
            out.push({ d, n, s, a });
            continue;
          }
          let lim = 0;
          while (a - lim - 1 >= 0 && L[lc[a - lim - 1]] < 0 && !anchor[lc[a - lim - 1]]) lim++;
          lim = Math.min(lim, rackN - 1);
          for (let j = 0; j <= lim; j++) out.push({ d, n, s: a - j, a });
        }
      }
      return out;
    }

    // ---- the walk, with its own stack (depth k = square s + k) ----
    const node = new Int32Array(SIZE + 2), term = new Uint8Array(SIZE + 2), st = new Uint8Array(SIZE + 2);
    const eIdx = new Int32Array(SIZE + 2), vr = new Uint8Array(SIZE + 2), used = new Int8Array(SIZE + 2), lt = new Int8Array(SIZE + 2);
    const msum = new Int32Array(SIZE + 2), wmul = new Int32Array(SIZE + 2), xtot = new Int32Array(SIZE + 2), placed = new Int8Array(SIZE + 2);
    let unit = null, lc = null, mk = null, xsd = null, hxd = null, depth = -1;
    let nodes = 0, found = 0, best = null, blankPass = false;
    const cands = [];

    function begin(u) {
      unit = u; lc = LINES[u.d][u.n]; mk = mask[u.d]; xsd = xs[u.d]; hxd = hx[u.d];
      depth = 0; node[0] = D[0]; term[0] = 0; st[0] = ENTER; msum[0] = 0; wmul[0] = 1; xtot[0] = 0; placed[0] = 0; used[0] = -1;
    }
    function down(k, ev, ms, wm, xt, pl) {
      const j = k + 1;
      node[j] = ev >>> 7; term[j] = (ev >> 5) & 1; msum[j] = ms; wmul[j] = wm; xtot[j] = xt; placed[j] = pl; st[j] = ENTER; used[j] = -1;
      depth = j;
    }
    function lay(k, ev, v, cell) {
      const lm = LM[cell], wm = WM[cell];
      down(k, ev, msum[k] + v * lm, wmul[k] * wm, xtot[k] + (hxd[cell] ? (xsd[cell] + v * lm) * wm : 0), placed[k] + 1);
    }
    function record(k) {
      if (blankPass && bl === blanks0) return;          // no blank used: the first pass has it
      found++;
      const score = msum[k] * wmul[k] + xtot[k] + (placed[k] === RACK ? BINGO : 0);
      const top = !best || score > best.score;
      let slot = -1;
      if (cands.length < CAP) slot = cands.length;
      else { const j = Math.floor(rng() * found); if (j < CAP) slot = j; }
      if (!top && slot < 0) return;
      const placements = [], seen = new Int8Array(26);
      let word = '', nb = 0;
      for (let i = 0; i < k; i++) {
        const cell = lc[unit.s + i];
        if (used[i] < 0) { word += LETTERS[L[cell]]; continue; }
        const l = lt[i];
        word += LETTERS[l];
        placements.push({ c: cell, id: used[i] === 1 ? blankIds[nb++] : idsOf[l][seen[l]++], s: LETTERS[l] });
      }
      const mv = { placements, score, main: word };
      if (top) best = mv;
      if (slot >= 0) cands[slot] = mv;
    }

    /** Walk the current unit until it is done (true) or `limit` edges were tried (false). */
    function walk(limit) {
      const s = unit.s, a = unit.a;
      while (depth >= 0) {
        if (nodes >= limit) return false;
        const k = depth, p = s + k;
        if (st[k] === ENTER) {
          nodes++;
          if (p > a && placed[k] && term[k] && (p === SIZE || L[lc[p]] < 0)) record(k);
          if (p === SIZE) { depth--; continue; }
          const cell = lc[p];
          if (L[cell] >= 0) {                              // a tile already there: follow it
            st[k] = DONE;
            const e = node[k] ? find(node[k], L[cell]) : -1;
            if (e < 0) { depth--; continue; }
            down(k, D[e], msum[k] + P[cell], wmul[k], xtot[k], placed[k]);
            continue;
          }
          if (!node[k] || placed[k] >= rackN || !mk[cell]) { depth--; continue; }
          st[k] = ITER; eIdx[k] = node[k]; vr[k] = 0; used[k] = -1;
        }
        if (st[k] === ITER) {
          if (used[k] >= 0) { if (used[k] === 0) count[lt[k]]++; else bl++; used[k] = -1; }
          const cell = lc[p], m = mk[cell];
          let went = false;
          while (eIdx[k] >= 0) {
            const ev = D[eIdx[k]], l = ev & 31;
            if ((m >> l) & 1) {
              if (vr[k] === 0) {
                vr[k] = 1;
                if (count[l] > 0) { count[l]--; used[k] = 0; lt[k] = l; lay(k, ev, LETTER_PTS[l], cell); went = true; break; }
              }
              if (vr[k] === 1) {
                vr[k] = 2;
                if (bl > 0) { bl--; used[k] = 1; lt[k] = l; lay(k, ev, 0, cell); went = true; break; }
              }
            }
            nodes++;
            eIdx[k] = ev & 64 ? -1 : eIdx[k] + 1; vr[k] = 0;
          }
          if (!went) depth--;
          continue;
        }
        depth--;                                           // DONE
      }
      return true;
    }

    let units = null, ui = 0, passEnd = budget;
    function step(ms) {
      if (!D) return true;
      const end = clock() + (ms === undefined ? Infinity : ms);
      if (!units) { crossChecks(); units = makeUnits(); ui = 0; if (!units.length) return true; begin(units[0]); }
      for (;;) {
        if (ui >= units.length) {
          // the blank pass: every move again, now letting blanks stand for any letter
          const wantBlanks = blanks0 > 0 && !blankPass && (lv.blanks === 'always' || !best) && blankBudget > 0;
          if (!wantBlanks) return true;
          blankPass = true; bl = blanks0;
          units = M.shuffle(units.slice(), rng); ui = 0; passEnd = nodes + blankBudget;
          begin(units[0]);
        }
        if (nodes >= passEnd) return true;
        const done = walk(Math.min(passEnd, nodes + 4096));
        if (done) { ui++; if (ui < units.length) begin(units[ui]); }
        if (clock() >= end) return false;
      }
    }

    /**
     * The move for a level: hard = the best found, normal = from the top fifth,
     * easy = somewhere in the middle (still a real word, just not the cleverest).
     * Every pick is checked against the rules before it goes out.
     */
    function pick(level) {
      const good = mv => { if (!mv) return null; const r = M.evaluatePlay(board, mv.placements); return r.ok ? Object.assign({}, mv, { score: r.score, main: r.main }) : null; };
      if (!best) return null;
      if (level === 'hard' || !level) { const b = good(best); if (b) return b; }
      const all = cands.slice().sort((a, b) => b.score - a.score);
      const f = level === 'easy' ? 0.35 + 0.35 * rng() : level === 'normal' ? 0.2 * rng() : 0;
      for (let i = Math.min(all.length - 1, Math.floor(all.length * f)); i < all.length; i++) { const m = good(all[i]); if (m) return m; }
      return null;
    }
    return { step, pick, moves: () => cands.slice(), get best() { return best; }, get nodes() { return nodes; }, get found() { return found; }, get units() { return units ? units.length : 0; } };
  }

  /** Run a whole search at once (tests, or when time doesn't matter). */
  function bestMove(board, rack, opts) {
    const job = create(board, rack, opts);
    while (!job.step()) { /* keep going */ }
    return job.pick(opts && opts.level);
  }

  /** No move worth making: which tiles to trade back. Keep blanks, one S, two different vowels, two good consonants. */
  function swapPick(rack) {
    const keep = new Set();
    const face = id => M.tile(id).face;
    const take = (faces, max) => {
      let n = 0;
      for (const f of faces) {
        if (n >= max) break;
        const id = rack.find(x => !keep.has(x) && face(x) === f);
        if (id !== undefined) { keep.add(id); n++; }
      }
    };
    rack.filter(id => face(id) === '?').forEach(id => keep.add(id));
    take(['S'], 1);
    take(['E', 'A', 'I', 'O'], 2);
    take(['R', 'T', 'L', 'N', 'D', 'C', 'M', 'H', 'P'], 2);
    const out = rack.filter(id => !keep.has(id));
    return out.length ? out : rack.slice();
  }

  const api = { create, bestMove, swapPick, LEVELS };
  root.RK = root.RK || {};
  root.RK.WordBot = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
