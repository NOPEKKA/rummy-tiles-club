// Word crossword engine: letter tiles, the 15 × 15 board, the word list and scoring.
// Pure (no DOM). The host uses it to rule on moves, every screen uses it for
// hints, and the bot uses its word list to search.
(function (root) {
  'use strict';

  const SIZE = 15, CELLS = SIZE * SIZE, CENTER = 7 * SIZE + 7, RACK = 7, BINGO = 40;

  // face, points, how many in the bag (100 tiles; ? is a blank)
  const KINDS = [
    ['A', 1, 9], ['B', 3, 2], ['C', 3, 3], ['D', 2, 4], ['E', 1, 12], ['F', 4, 2], ['G', 2, 2], ['H', 3, 3], ['I', 1, 8],
    ['J', 9, 1], ['K', 5, 1], ['L', 1, 4], ['M', 3, 2], ['N', 1, 6], ['O', 1, 8], ['P', 3, 2], ['Q', 10, 1], ['R', 1, 6],
    ['S', 1, 5], ['T', 1, 7], ['U', 2, 3], ['V', 5, 1], ['W', 4, 2], ['X', 8, 1], ['Y', 3, 2], ['Z', 9, 1], ['?', 0, 2]
  ];
  const TILES = [];
  KINDS.forEach(([face, pts, n]) => { for (let i = 0; i < n; i++) TILES.push({ id: TILES.length, face, pts }); });
  const TILE_COUNT = TILES.length;

  // A symbol is the letter a tile shows on the board (a blank takes one too).
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const SYM_SET = new Set(LETTERS);
  const LETTER_PTS = LETTERS.map(l => KINDS.find(k => k[0] === l)[1]);

  const tile = id => TILES[id];
  /** What a tile may stand for: a letter is itself, a blank any letter. */
  const options = face => (face === '?' ? LETTERS : [face]);
  const canBe = (face, sym) => (face === '?' ? SYM_SET.has(sym) : face === sym);
  const needsChoice = face => face === '?';

  // ---- the board ----
  // Bonus squares, one quarter (rows/cols 0–7) mirrored to the other three.
  // W = word ×3, w = word ×2, L = letter ×3, l = letter ×2, * = the centre (word ×2).
  const QUARTER = [
    'W...l..W',
    '.w....L.',
    '..w..l..',
    '...L...l',
    'l....w..',
    '..l.w...',
    '.L....l.',
    'W..l...*'
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
  const PREMIUM = Array.from({ length: CELLS }, (_, c) => premium(c));
  /** [letter multiplier, word multiplier] of a square, when a new tile covers it */
  function mults(cell) {
    const p = PREMIUM[cell];
    return p === 'L' ? [3, 1] : p === 'l' ? [2, 1] : p === 'W' ? [1, 3] : p === 'w' || p === '*' ? [1, 2] : [1, 1];
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

  // ---- the word list ----
  // A packed DAWG (see tools/dawg.cjs): word 0 is the root's first edge; each edge holds
  // letter (bits 0–4), word-ends-here (bit 5), last-edge-of-node (bit 6), child (bits 7–31).
  let DICT = null;
  function setDict(d) { DICT = d && d.length > 1 ? d : null; }
  const hasDict = () => !!DICT;
  const dict = () => DICT;
  /** The build ships the DAWG as four byte planes (low bytes first), which packs smaller. */
  function unpack(bytes) {
    const n = bytes.length >> 2, out = new Uint32Array(n);
    for (let i = 0; i < n; i++) out[i] = (bytes[i] | bytes[n + i] << 8 | bytes[2 * n + i] << 16 | bytes[3 * n + i] << 24) >>> 0;
    return out;
  }
  /** Is this a word? Letters in either case (A and a both map to 0). */
  function isWord(word) {
    const d = DICT;
    if (!d || word.length < 2) return false;
    let i = d[0];
    for (let k = 0; k < word.length; k++) {
      if (!i) return false;
      const l = (word.charCodeAt(k) & 31) - 1;
      if (l < 0 || l > 25) return false;
      for (;;) {
        const e = d[i];
        if ((e & 31) === l) {
          if (k === word.length - 1) return (e & 32) !== 0;
          i = e >>> 7;
          break;
        }
        if (e & 64) return false;
        i++;
      }
    }
    return false;
  }

  const bad = (reason, extra) => Object.assign({ ok: false, reason }, extra || {});
  /** Is this run of letters a word? → {ok, reason?} */
  function checkLine(syms) {
    if (!DICT) return bad('no_dict');
    if (syms.length < 2) return bad('word_short');
    return isWord(syms.join('')) ? { ok: true } : bad('not_word');
  }
  const lineText = syms => syms.join('');

  // ---- a move ----
  /**
   * Check a move and score it.
   * board: CELLS entries of [tileId, letter] or null. placements: [{c: cell, id, s: letter}].
   * Every line of two or more tiles that the move touches must be a word.
   * Score per word: letter points (letter bonuses on new tiles) × word bonuses on new tiles;
   * all seven tiles in one move adds BINGO.
   */
  function evaluatePlay(board, placements) {
    if (!Array.isArray(placements) || !placements.length) return bad('no_tiles');
    if (placements.length > RACK) return bad('malformed');
    const cells = new Set(), ids = new Set();
    for (const p of placements) {
      if (!p || !Number.isInteger(p.c) || p.c < 0 || p.c >= CELLS || cells.has(p.c)) return bad('malformed');
      if (!Number.isInteger(p.id) || !TILES[p.id] || ids.has(p.id)) return bad('malformed');
      if (board[p.c]) return bad('cell_taken');
      if (!SYM_SET.has(p.s)) return bad('need_choice', { bad: [p.c] });
      if (!canBe(TILES[p.id].face, p.s)) return bad('malformed');
      cells.add(p.c); ids.add(p.id);
    }
    if (!DICT) return bad('no_dict');
    const n = placements.length;
    const rows = new Set(placements.map(p => rc(p.c)[0])), cols = new Set(placements.map(p => rc(p.c)[1]));
    let dir = -1;
    if (n > 1) {
      if (rows.size === 1) dir = 0;
      else if (cols.size === 1) dir = 1;
      else return bad('not_line', { bad: [...cells] });
    }
    const next = board.slice();
    placements.forEach(p => { next[p.c] = [p.id, p.s]; });
    if (dir >= 0) {
      const ks = placements.map(p => rc(p.c)[dir === 0 ? 1 : 0]);
      const fixed = rc(placements[0].c)[dir === 0 ? 0 : 1];
      for (let k = Math.min.apply(null, ks); k <= Math.max.apply(null, ks); k++) {
        if (!next[dir === 0 ? at(fixed, k) : at(k, fixed)]) return bad('gap', { bad: [...cells] });
      }
    }
    if (isEmpty(board)) { if (!cells.has(CENTER)) return bad('center', { bad: [...cells] }); }
    else if (!placements.some(p => neighbours(p.c).some(q => board[q]))) return bad('not_connected', { bad: [...cells] });

    const lines = [], seen = new Set();
    placements.forEach(p => [0, 1].forEach(d => {
      const L = lineThrough(next, p.c, d);
      if (L.length < 2 || seen.has(d + ':' + L[0])) return;
      seen.add(d + ':' + L[0]);
      lines.push({ d, cells: L, syms: L.map(c => next[c][1]) });
    }));
    if (!lines.length) return bad('word_short', { bad: [...cells] });
    for (const L of lines) {
      const chk = checkLine(L.syms);
      if (!chk.ok) return bad(chk.reason, { bad: L.cells, text: lineText(L.syms) });
    }
    let score = 0;
    for (const L of lines) {
      let pts = 0, mult = 1;
      for (const c of L.cells) {
        let v = TILES[next[c][0]].pts;
        if (cells.has(c)) { const [lm, wm] = mults(c); v *= lm; mult *= wm; }
        pts += v;
      }
      L.mult = mult;
      L.score = pts * mult;
      L.text = lineText(L.syms);
      score += L.score;
    }
    const bingo = n === RACK;
    if (bingo) score += BINGO;
    // the main word is the one along the move (or the longest, for a single tile)
    const main = lines.slice().sort((a, b) => (b.d === dir) - (a.d === dir) || b.cells.length - a.cells.length)[0];
    return { ok: true, score, lines, bingo, dir, main: main.text };
  }

  // ---- compact text for the network ----
  const b36 = (n, w) => n.toString(36).padStart(w, '0');
  const SYM_CH = 'abcdefghijklmnopqrstuvwxyz';
  /** [[cell, id, letter], …] as 5 characters each */
  function encodePlaced(list) {
    return list.map(p => b36(p.c, 2) + b36(p.id, 2) + SYM_CH[LETTERS.indexOf(p.s)]).join('');
  }
  function decodePlaced(str) {
    const out = [];
    if (typeof str !== 'string' || str.length % 5 || str.length > 5 * CELLS) return null;
    for (let i = 0; i < str.length; i += 5) {
      const c = parseInt(str.slice(i, i + 2), 36), id = parseInt(str.slice(i + 2, i + 4), 36), k = SYM_CH.indexOf(str[i + 4]);
      if (!(c >= 0 && c < CELLS) || !(id >= 0 && id < TILE_COUNT) || k < 0) return null;
      out.push({ c, id, s: LETTERS[k] });
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
  /** Rack order: A to Z, blanks last. */
  const FACE_ORDER = new Map(KINDS.map((k, i) => [k[0], i]));
  const byFace = (a, b) => FACE_ORDER.get(TILES[a].face) - FACE_ORDER.get(TILES[b].face) || a - b;

  const api = {
    SIZE, CELLS, CENTER, RACK, BINGO, KINDS, TILE_COUNT, LETTERS, SYMS: LETTERS, LETTER_PTS,
    tile, options, canBe, needsChoice, premium, mults, neighbours, rc, at, emptyBoard, isEmpty, lineThrough,
    setDict, hasDict, dict, unpack, isWord, checkLine, lineText, evaluatePlay,
    encodePlaced, decodePlaced, encodeBoard, decodeBoard, encodeIds, decodeIds,
    fullBag, shuffle, rackValue, byFace
  };
  root.RK = root.RK || {};
  root.RK.WordRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
