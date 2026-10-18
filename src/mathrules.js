// Math crossword engine: tiles, the 15 × 15 board, equations and scoring.
// Pure (no DOM). The host uses it to rule on moves, every screen uses it for
// hints, and the bot uses it to check what it finds.
(function (root) {
  'use strict';

  const SIZE = 15, CELLS = SIZE * SIZE, CENTER = 7 * SIZE + 7, RACK = 8, BINGO = 40;

  // face, points, how many in the bag (100 tiles)
  const KINDS = [
    ['0', 1, 5], ['1', 1, 6], ['2', 1, 6], ['3', 1, 5], ['4', 2, 5], ['5', 2, 4], ['6', 2, 4], ['7', 2, 4], ['8', 2, 4], ['9', 2, 4],
    ['10', 3, 2], ['11', 4, 1], ['12', 3, 2], ['13', 6, 1], ['14', 4, 1], ['15', 4, 1], ['16', 4, 1], ['17', 6, 1], ['18', 4, 1], ['19', 7, 1], ['20', 5, 1],
    ['+', 2, 4], ['-', 2, 4], ['*', 2, 4], ['/', 2, 4], ['+-', 1, 5], ['*/', 1, 4], ['=', 1, 11], ['?', 0, 4]
  ];
  const TILES = [];
  KINDS.forEach(([face, pts, n]) => { for (let i = 0; i < n; i++) TILES.push({ id: TILES.length, face, pts }); });
  const TILE_COUNT = TILES.length;

  // A symbol is what a tile stands for on the board: 0–20, + − × ÷ or =.
  const NUMS = Array.from({ length: 21 }, (_, i) => String(i));
  const OPS = ['+', '-', '*', '/'];
  const SYMS = NUMS.concat(OPS, ['=']);
  const SYM_SET = new Set(SYMS);
  const DIGIT = new Set(NUMS.slice(0, 10));
  const BIG = new Set(NUMS.slice(10));
  const OPSET = new Set(OPS);
  const SYM_CH = '0123456789abcdefghijk+-*/=';

  const tile = id => TILES[id];
  /** What a tile may stand for: a choice tile picks one, a blank anything. */
  function options(face) {
    if (face === '?') return SYMS;
    if (face === '+-') return ['+', '-'];
    if (face === '*/') return ['*', '/'];
    return [face];
  }
  const canBe = (face, sym) => options(face).indexOf(sym) >= 0;
  const needsChoice = face => face === '?' || face === '+-' || face === '*/';
  const isNumFace = face => DIGIT.has(face) || BIG.has(face);

  // ---- the board ----
  // Bonus squares, one quarter (rows/cols 0–7) mirrored to the other three.
  // E = equation ×3, e = equation ×2, T = tile ×3, t = tile ×2, * = the centre star.
  const QUARTER = [
    'E..t...E',
    '.e...T..',
    '..e...t.',
    't..e...t',
    '....T...',
    '.T...t..',
    '..t...e.',
    'E..t...*'
  ];
  const rc = cell => [Math.floor(cell / SIZE), cell % SIZE];
  const at = (r, c) => r * SIZE + c;
  function premium(cell) {
    let [r, c] = rc(cell);
    if (r > 7) r = 14 - r;
    if (c > 7) c = 14 - c;
    const ch = QUARTER[r][c];
    return ch === '.' ? '' : ch;
  }
  function neighbours(cell) {
    const [r, c] = rc(cell), out = [];
    if (r > 0) out.push(cell - SIZE);
    if (r < SIZE - 1) out.push(cell + SIZE);
    if (c > 0) out.push(cell - 1);
    if (c < SIZE - 1) out.push(cell + 1);
    return out;
  }
  const emptyBoard = () => new Array(CELLS).fill(null);
  const isEmpty = board => board.every(x => !x);

  /** The run of filled cells through `cell` along `dir` (0 = across, 1 = down). */
  function lineThrough(board, cell, dir) {
    const [r, c] = rc(cell);
    const get = k => board[dir ? at(k, c) : at(r, k)];
    let k0 = dir ? r : c, k1 = k0;
    while (k0 > 0 && get(k0 - 1)) k0--;
    while (k1 < SIZE - 1 && get(k1 + 1)) k1++;
    const out = [];
    for (let k = k0; k <= k1; k++) out.push(dir ? at(k, c) : at(r, k));
    return out;
  }

  // ---- equations ----
  // A number is a run of 0–9 tiles (1 to 3 digits, no leading zero) or one 10–20 tile on its own.
  // Each side may start with a minus. × and ÷ go before + and −. Every side has the same value.
  const bad = reason => ({ ok: false, reason });
  function parse(syms) {
    const sides = [[]];
    let i = 0, eqs = 0, expectNum = true;
    while (i < syms.length) {
      const side = sides[sides.length - 1];
      if (expectNum) {
        let neg = false;
        if (syms[i] === '-' && !side.length) { neg = true; i++; if (i >= syms.length) return bad('eq_ops'); }
        const x = syms[i];
        if (BIG.has(x)) {
          i++;
          if (i < syms.length && (DIGIT.has(syms[i]) || BIG.has(syms[i]))) return bad('eq_big');
          side.push({ v: +x, neg });
        } else if (DIGIT.has(x)) {
          let d = '';
          while (i < syms.length && DIGIT.has(syms[i])) d += syms[i++];
          if (i < syms.length && BIG.has(syms[i])) return bad('eq_big');
          if (d.length > 3) return bad('eq_digits');
          if (d.length > 1 && d[0] === '0') return bad('eq_lead0');
          if (neg && +d === 0) return bad('eq_neg0');
          side.push({ v: +d, neg });
        } else return bad('eq_ops');
        expectNum = false;
      } else {
        const s = syms[i++];
        if (s === '=') { eqs++; sides.push([]); }
        else if (OPSET.has(s)) side.push(s);
        else return bad('eq_ops');
        expectNum = true;
      }
    }
    if (expectNum) return bad(syms.length ? 'eq_ops' : 'eq_none');
    if (!eqs) return bad('eq_none');
    return { ok: true, sides };
  }

  // exact fractions on BigInt, so 999 × 999 × 999 … never rounds
  const babs = a => (a < 0n ? -a : a);
  function gcd(a, b) { a = babs(a); b = babs(b); while (b) { const t = a % b; a = b; b = t; } return a || 1n; }
  function frac(n, d) { if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return [n / g, d / g]; }
  function sideValue(side) {
    let sum = [0n, 1n], term = null, sign = 1n, mul = null;
    const flush = () => { sum = frac(sum[0] * term[1] + sign * term[0] * sum[1], sum[1] * term[1]); };
    for (const tk of side) {
      if (typeof tk === 'string') {
        if (tk === '+' || tk === '-') { flush(); sign = tk === '-' ? -1n : 1n; term = null; mul = null; }
        else mul = tk;
        continue;
      }
      const v = BigInt(tk.neg ? -tk.v : tk.v);
      if (!term) term = [v, 1n];
      else if (mul === '*') term = frac(term[0] * v, term[1]);
      else { if (v === 0n) return null; term = frac(term[0], term[1] * v); }
    }
    flush();
    return sum;
  }
  function fracText(f) { return f[1] === 1n ? String(f[0]) : f[0] + '/' + f[1]; }

  /** Is this run of symbols a true equation? → {ok, reason?, values?} */
  function checkLine(syms) {
    const p = parse(syms);
    if (!p.ok) return p;
    const vals = [];
    for (const side of p.sides) {
      const v = sideValue(side);
      if (!v) return bad('eq_div0');
      vals.push(v);
    }
    const values = vals.map(fracText);
    for (let i = 1; i < vals.length; i++) {
      if (vals[i][0] !== vals[0][0] || vals[i][1] !== vals[0][1]) return { ok: false, reason: 'eq_false', values };
    }
    return { ok: true, values };
  }

  /** Symbols as people write them: 12×3=36 */
  function lineText(syms) {
    return syms.map(s => (s === '*' ? '×' : s === '/' ? '÷' : s === '-' ? '−' : s)).join('');
  }

  // ---- a move ----
  const fail = (reason, extra) => Object.assign({ ok: false, reason }, extra || {});
  /**
   * Check a move and score it.
   * board: CELLS entries of [tileId, sym] or null. placements: [{c: cell, id, s: sym}].
   * Every line of two or more tiles that the move touches must be a true equation.
   * Score per line: tile points (tile bonuses on new tiles) × equation bonuses on new tiles;
   * all eight tiles in one move adds BINGO.
   */
  function evaluatePlay(board, placements) {
    if (!Array.isArray(placements) || !placements.length) return fail('no_tiles');
    if (placements.length > RACK) return fail('malformed');
    const cells = new Set(), ids = new Set();
    for (const p of placements) {
      if (!p || !Number.isInteger(p.c) || p.c < 0 || p.c >= CELLS || cells.has(p.c)) return fail('malformed');
      if (!Number.isInteger(p.id) || !TILES[p.id] || ids.has(p.id)) return fail('malformed');
      if (board[p.c]) return fail('cell_taken');
      if (!SYM_SET.has(p.s)) return fail('need_choice', { bad: [p.c] });
      if (!canBe(TILES[p.id].face, p.s)) return fail('malformed');
      cells.add(p.c); ids.add(p.id);
    }
    const n = placements.length;
    const rows = new Set(placements.map(p => rc(p.c)[0])), cols = new Set(placements.map(p => rc(p.c)[1]));
    let dir = -1;
    if (n > 1) {
      if (rows.size === 1) dir = 0;
      else if (cols.size === 1) dir = 1;
      else return fail('not_line', { bad: [...cells] });
    }
    const next = board.slice();
    placements.forEach(p => { next[p.c] = [p.id, p.s]; });
    if (dir >= 0) {
      const ks = placements.map(p => rc(p.c)[dir === 0 ? 1 : 0]);
      const fixed = rc(placements[0].c)[dir === 0 ? 0 : 1];
      for (let k = Math.min.apply(null, ks); k <= Math.max.apply(null, ks); k++) {
        if (!next[dir === 0 ? at(fixed, k) : at(k, fixed)]) return fail('gap', { bad: [...cells] });
      }
    }
    if (isEmpty(board)) { if (!cells.has(CENTER)) return fail('center', { bad: [...cells] }); }
    else if (!placements.some(p => neighbours(p.c).some(q => board[q]))) return fail('not_connected', { bad: [...cells] });

    const lines = [], seen = new Set();
    placements.forEach(p => [0, 1].forEach(d => {
      const L = lineThrough(next, p.c, d);
      if (L.length < 2 || seen.has(d + ':' + L[0])) return;
      seen.add(d + ':' + L[0]);
      lines.push({ d, cells: L, syms: L.map(c => next[c][1]) });
    }));
    if (!lines.length) return fail('eq_short', { bad: [...cells] });
    for (const L of lines) {
      const chk = checkLine(L.syms);
      if (!chk.ok) return fail(chk.reason, { bad: L.cells, text: lineText(L.syms), values: chk.values });
    }
    let score = 0;
    for (const L of lines) {
      let pts = 0, mult = 1;
      for (const c of L.cells) {
        let v = TILES[next[c][0]].pts;
        if (cells.has(c)) {
          const pr = premium(c);
          if (pr === 't') v *= 2; else if (pr === 'T') v *= 3;
          else if (pr === 'e') mult *= 2; else if (pr === 'E') mult *= 3;
        }
        pts += v;
      }
      L.mult = mult;
      L.score = pts * mult;
      L.text = lineText(L.syms);
      score += L.score;
    }
    const bingo = n === RACK;
    if (bingo) score += BINGO;
    // the main line is the one along the move (or the longest, for a single tile)
    const main = lines.slice().sort((a, b) => (b.d === dir) - (a.d === dir) || b.cells.length - a.cells.length)[0];
    return { ok: true, score, lines, bingo, dir, main: main.text };
  }

  // ---- compact text for the network ----
  const b36 = (n, w) => n.toString(36).padStart(w, '0');
  /** [[cell, id, sym], …] as 5 characters each */
  function encodePlaced(list) {
    return list.map(p => b36(p.c, 2) + b36(p.id, 2) + SYM_CH[SYMS.indexOf(p.s)]).join('');
  }
  function decodePlaced(str) {
    const out = [];
    if (typeof str !== 'string' || str.length % 5 || str.length > 5 * CELLS) return null;
    for (let i = 0; i < str.length; i += 5) {
      const c = parseInt(str.slice(i, i + 2), 36), id = parseInt(str.slice(i + 2, i + 4), 36), k = SYM_CH.indexOf(str[i + 4]);
      if (!(c >= 0 && c < CELLS) || !(id >= 0 && id < TILE_COUNT) || k < 0) return null;
      out.push({ c, id, s: SYMS[k] });
    }
    return out;
  }
  function encodeBoard(board) {
    const list = [];
    board.forEach((x, c) => { if (x) list.push({ c, id: x[0], s: x[1] }); });
    return encodePlaced(list);
  }
  function decodeBoard(str) {
    const b = emptyBoard();
    (decodePlaced(str || '') || []).forEach(p => { b[p.c] = [p.id, p.s]; });
    return b;
  }
  const encodeIds = ids => ids.map(id => b36(id, 2)).join('');
  function decodeIds(str) {
    const out = [];
    if (typeof str !== 'string') return out;
    for (let i = 0; i + 1 < str.length; i += 2) { const id = parseInt(str.slice(i, i + 2), 36); if (id >= 0 && id < TILE_COUNT) out.push(id); }
    return out;
  }

  // ---- bag ----
  const fullBag = () => TILES.map(t => t.id);
  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  const rackValue = ids => ids.reduce((s, id) => s + TILES[id].pts, 0);
  /** Rack order: numbers small to big, then operators, =, choice tiles, blanks. */
  const FACE_ORDER = new Map(KINDS.map((k, i) => [k[0], i]));
  const byFace = (a, b) => FACE_ORDER.get(TILES[a].face) - FACE_ORDER.get(TILES[b].face) || a - b;

  const api = {
    SIZE, CELLS, CENTER, RACK, BINGO, KINDS, TILE_COUNT, SYMS, NUMS, OPS,
    tile, options, canBe, needsChoice, isNumFace, premium, neighbours, rc, at, emptyBoard, isEmpty, lineThrough,
    parse, checkLine, lineText, evaluatePlay,
    encodePlaced, decodePlaced, encodeBoard, decodeBoard, encodeIds, decodeIds,
    fullBag, shuffle, rackValue, byFace
  };
  root.RK = root.RK || {};
  root.RK.MathRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
