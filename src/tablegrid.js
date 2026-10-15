// The shared table as a grid. Tiles sit in cells; tiles touching left-to-right
// in one row form a set, so a set is defined by where it lies. The visible
// grid starts small and grows as tiles get near its edges. Pure functions.
(function (root) {
  'use strict';

  const MIN_COLS = 10, MIN_ROWS = 3;     // the board you start with
  const MAX_COLS = 30, MAX_ROWS = 20;    // the most it ever grows to
  const SPARE_COLS = 2, SPARE_ROWS = 1;  // free space kept past the last tile

  /** @typedef {(number|null)[][]} Grid  MAX_ROWS rows × MAX_COLS cells */

  function empty() { return Array.from({ length: MAX_ROWS }, () => new Array(MAX_COLS).fill(null)); }
  function clone(g) { return g.map(r => r.slice()); }

  /** Build a grid from sets + anchors ([row, col] of each set's first tile). */
  function fromSets(table, layout) {
    const grid = empty();
    if (!Array.isArray(table) || !Array.isArray(layout) || table.length !== layout.length) return { ok: false, reason: 'malformed', grid };
    for (let i = 0; i < table.length; i++) {
      const s = table[i], a = layout[i];
      if (!Array.isArray(s) || !Array.isArray(a)) return { ok: false, reason: 'malformed', grid };
      const [r, c] = a;
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= MAX_ROWS || c < 0 || c + s.length > MAX_COLS) return { ok: false, reason: 'bounds', grid };
      for (let k = 0; k < s.length; k++) {
        if (grid[r][c + k] !== null) return { ok: false, reason: 'overlap', grid };
        grid[r][c + k] = s[k];
      }
    }
    return { ok: true, grid };
  }

  /** Read sets back off a grid: every left-to-right run of touching tiles. */
  function toSets(grid) {
    const table = [], layout = [];
    grid.forEach((row, r) => {
      let c = 0;
      while (c < row.length) {
        if (row[c] === null) { c++; continue; }
        const start = c, set = [];
        while (c < row.length && row[c] !== null) set.push(row[c++]);
        table.push(set); layout.push([r, start]);
      }
    });
    return { table, layout };
  }

  function extent(grid) {
    let maxR = -1, maxC = -1;
    grid.forEach((row, r) => row.forEach((id, c) => { if (id !== null) { if (r > maxR) maxR = r; if (c > maxC) maxC = c; } }));
    return { maxR, maxC };
  }

  /** Visible size: small to begin with, always a little free space past the last tile. */
  function dims(grid) {
    const e = extent(grid);
    return {
      cols: Math.min(MAX_COLS, Math.max(MIN_COLS, e.maxC + 1 + SPARE_COLS)),
      rows: Math.min(MAX_ROWS, Math.max(MIN_ROWS, e.maxR + 1 + SPARE_ROWS))
    };
  }

  function find(grid, id) {
    for (let r = 0; r < grid.length; r++) { const c = grid[r].indexOf(id); if (c >= 0) return [r, c]; }
    return null;
  }

  function remove(grid, id) {
    const g = clone(grid);
    const at = find(g, id);
    if (at) g[at[0]][at[1]] = null;
    return g;
  }

  /**
   * Put a tile at (r, c). An empty cell just takes it (it joins whatever it
   * touches). An occupied cell makes room: tiles from c rightwards shift one
   * cell, up to the first gap of two, so the space between sets survives.
   */
  function place(grid, id, r, c) {
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= MAX_ROWS || c < 0 || c >= MAX_COLS) return { ok: false, reason: 'bounds', grid };
    const g = remove(grid, id);
    const row = g[r];
    if (row[c] === null) { row[c] = id; return { ok: true, grid: g }; }
    let k = c + 1;
    while (k < MAX_COLS && !(row[k] === null && (k + 1 >= MAX_COLS || row[k + 1] === null))) k++;
    if (k >= MAX_COLS) return { ok: false, reason: 'row_full', grid };
    for (let j = k; j > c; j--) row[j] = row[j - 1];
    row[c] = id;
    return { ok: true, grid: g };
  }

  function fits(grid, r, c, len) {
    if (r < 0 || r >= MAX_ROWS || c < 0 || c + len > MAX_COLS) return false;
    for (let j = c - 1; j <= c + len; j++) {
      if (j < 0 || j >= MAX_COLS) continue;
      if (grid[r][j] !== null) return false;
    }
    return true;
  }

  function put(grid, set, r, c) { set.forEach((id, k) => { grid[r][c + k] = id; }); }

  function firstFree(grid, len, width) {
    const W = Math.min(MAX_COLS, Math.max(width, len));
    for (let r = 0; r < MAX_ROWS; r++) {
      for (let c = 0; c + len <= W; c++) if (fits(grid, r, c, len)) return [r, c];
    }
    for (let r = 0; r < MAX_ROWS; r++) for (let c = 0; c + len <= MAX_COLS; c++) if (fits(grid, r, c, len)) return [r, c];
    return null;
  }

  /**
   * Where to put sets that a bot (or anything without positions) produced.
   * Unchanged sets stay put; a set that grew or shrank stays anchored on the
   * tiles it still shares; brand-new sets take the first free spot.
   */
  function autoPlace(prevTable, prevLayout, nextTable) {
    const grid = empty();
    const layout = new Array(nextTable.length).fill(null);
    let width = MIN_COLS;
    (prevLayout || []).forEach((a, i) => { width = Math.max(width, a[1] + prevTable[i].length); });
    const usedPrev = new Set();
    // 1) identical sets keep their spot
    nextTable.forEach((s, i) => {
      const key = s.join(',');
      const j = (prevTable || []).findIndex((p, pj) => !usedPrev.has(pj) && p.join(',') === key);
      if (j >= 0 && fits(grid, prevLayout[j][0], prevLayout[j][1], s.length)) {
        put(grid, s, prevLayout[j][0], prevLayout[j][1]); layout[i] = prevLayout[j].slice(); usedPrev.add(j);
      }
    });
    // 2) changed sets stay anchored on shared tiles
    nextTable.forEach((s, i) => {
      if (layout[i]) return;
      let best = -1, overlap = 0;
      (prevTable || []).forEach((p, pj) => {
        if (usedPrev.has(pj)) return;
        const n = p.filter(id => s.includes(id)).length;
        if (n > overlap) { overlap = n; best = pj; }
      });
      if (best < 0) return;
      const p = prevTable[best], [pr, pc] = prevLayout[best];
      const t = p.find(id => s.includes(id));
      const c = pc - (s.indexOf(t) - p.indexOf(t));
      for (const cc of [c, pc]) {
        if (fits(grid, pr, cc, s.length)) { put(grid, s, pr, cc); layout[i] = [pr, cc]; usedPrev.add(best); return; }
      }
    });
    // 3) everything else: first free spot, reading order
    nextTable.forEach((s, i) => {
      if (layout[i]) return;
      const spot = firstFree(grid, s.length, width);
      if (spot) { put(grid, s, spot[0], spot[1]); layout[i] = spot; }
    });
    return layout;
  }

  /** Pack all sets in reading order, one gap apart, wrapping at `width` columns. */
  function tidy(table, layout, width) {
    const order = table.map((s, i) => i);
    if (layout) order.sort((a, b) => layout[a][0] - layout[b][0] || layout[a][1] - layout[b][1]);
    const longest = table.reduce((m, s) => Math.max(m, s.length), 0);
    const W = Math.min(MAX_COLS, Math.max(MIN_COLS, width || 0, longest));
    const out = new Array(table.length);
    let r = 0, c = 0;
    order.forEach(i => {
      const len = table[i].length;
      if (c > 0 && c + len > W) { r++; c = 0; }
      out[i] = [r, c];
      c += len + 1;
    });
    return out;
  }

  // ---- wire: each set is row, col (one base-36 char each) then 2-char tile ids
  const enc36 = n => n.toString(36);
  function encodeBoard(table, layout) {
    return table.map((s, i) => enc36(layout[i][0]) + enc36(layout[i][1]) + s.map(id => id.toString(36).padStart(2, '0')).join('')).join('.');
  }
  function decodeBoard(str) {
    const table = [], layout = [];
    if (typeof str !== 'string' || !str) return { table, layout };
    str.split('.').forEach(part => {
      if (part.length < 4) return;
      const r = parseInt(part[0], 36), c = parseInt(part[1], 36);
      const ids = [];
      for (let i = 2; i + 1 < part.length; i += 2) {
        const v = parseInt(part.slice(i, i + 2), 36);
        if (Number.isInteger(v) && v >= 0 && v < 106) ids.push(v);
      }
      if (ids.length && Number.isInteger(r) && Number.isInteger(c)) { table.push(ids); layout.push([r, c]); }
    });
    return { table, layout };
  }

  const api = { MIN_COLS, MIN_ROWS, MAX_COLS, MAX_ROWS, SPARE_COLS, SPARE_ROWS, empty, clone, fromSets, toSets, extent, dims, find, remove, place, fits, autoPlace, tidy, encodeBoard, decodeBoard };
  root.RK = root.RK || {};
  root.RK.TableGrid = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
