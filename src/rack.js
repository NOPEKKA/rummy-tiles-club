// Rack layout: where each tile in your hand sits on your personal board.
// Pure functions over plain data. A tile that has no cell lives in `overflow`
// (the holding tray) — no operation here ever drops a tile.
(function (root) {
  'use strict';

  /** @typedef {{rows: (number|null)[][], overflow: number[]}} Rack */

  function create(layout) {
    return { rows: layout.map(n => new Array(n).fill(null)), overflow: [] };
  }

  function clone(rack) {
    return { rows: rack.rows.map(r => r.slice()), overflow: rack.overflow.slice() };
  }

  function layoutOf(rack) {
    return rack.rows.map(r => r.length);
  }

  function capacity(rack) {
    return rack.rows.reduce((a, r) => a + r.length, 0);
  }

  /** Every tile id on the rack, cells first then overflow. */
  function allTiles(rack) {
    const out = [];
    rack.rows.forEach(r => r.forEach(id => { if (id !== null) out.push(id); }));
    return out.concat(rack.overflow);
  }

  function placedCount(rack) {
    return rack.rows.reduce((a, r) => a + r.filter(x => x !== null).length, 0);
  }

  function find(rack, id) {
    for (let r = 0; r < rack.rows.length; r++) {
      const c = rack.rows[r].indexOf(id);
      if (c >= 0) return { r, c };
    }
    const o = rack.overflow.indexOf(id);
    return o >= 0 ? { overflow: true, i: o } : null;
  }

  function firstEmpty(rack) {
    for (let r = 0; r < rack.rows.length; r++) {
      const c = rack.rows[r].indexOf(null);
      if (c >= 0) return { r, c };
    }
    return null;
  }

  function validCell(rack, pos) {
    return pos && Number.isInteger(pos.r) && Number.isInteger(pos.c) &&
      pos.r >= 0 && pos.r < rack.rows.length && pos.c >= 0 && pos.c < rack.rows[pos.r].length;
  }

  function removeId(rack, id) {
    const at = find(rack, id);
    if (!at) return false;
    if (at.overflow) rack.overflow.splice(at.i, 1);
    else rack.rows[at.r][at.c] = null;
    return true;
  }

  /**
   * Put a tile (already on the rack, or new to it) into a cell.
   * - target empty: move there
   * - target holds another tile and the source is a rack cell: swap
   * - target holds another tile and the source is the tray or the table: refuse
   * @returns {{rack: Rack, ok: boolean, reason?: string}}
   */
  function moveTo(rack, id, pos) {
    const next = clone(rack);
    if (!validCell(next, pos)) return { rack, ok: false, reason: 'bad_cell' };
    const from = find(next, id);
    const occupant = next.rows[pos.r][pos.c];
    if (occupant === id) return { rack, ok: true };
    if (occupant !== null) {
      if (from && !from.overflow) {
        next.rows[from.r][from.c] = occupant;
        next.rows[pos.r][pos.c] = id;
        return { rack: next, ok: true, swapped: occupant };
      }
      return { rack, ok: false, reason: 'occupied' };
    }
    if (from) removeId(next, id);
    next.rows[pos.r][pos.c] = id;
    return { rack: next, ok: true };
  }

  /** Add a tile to the first free cell, or to the tray if the board is full. */
  function add(rack, id) {
    const next = clone(rack);
    if (find(next, id)) return { rack: next, ok: true, where: 'existing' };
    const spot = firstEmpty(next);
    if (spot) { next.rows[spot.r][spot.c] = id; return { rack: next, ok: true, where: 'cell' }; }
    next.overflow.push(id);
    return { rack: next, ok: true, where: 'overflow' };
  }

  function toOverflow(rack, id) {
    const next = clone(rack);
    removeId(next, id);
    next.overflow.push(id);
    return next;
  }

  function remove(rack, id) {
    const next = clone(rack);
    removeId(next, id);
    return next;
  }

  /**
   * Re-shape the rack. Tiles keep their (row, col) when that cell still
   * exists; the rest move to the first free cells; whatever still has no
   * cell goes to the tray. Returns how many tiles moved and how many went
   * to the tray so the UI can warn before applying.
   */
  function resize(rack, layout) {
    const next = create(layout);
    const homeless = [];
    rack.rows.forEach((row, r) => row.forEach((id, c) => {
      if (id === null) return;
      if (r < next.rows.length && c < next.rows[r].length) next.rows[r][c] = id;
      else homeless.push(id);
    }));
    let relocated = 0;
    const toTray = [];
    homeless.forEach(id => {
      const spot = firstEmpty(next);
      if (spot) { next.rows[spot.r][spot.c] = id; relocated++; }
      else toTray.push(id);
    });
    // Tiles already in the tray get a cell back if the new board has room.
    const stillTray = [];
    rack.overflow.forEach(id => {
      const spot = firstEmpty(next);
      if (spot) next.rows[spot.r][spot.c] = id;
      else stillTray.push(id);
    });
    next.overflow = stillTray.concat(toTray);
    return { rack: next, relocated, toTray: toTray.length };
  }

  /** Preview a resize without applying it. */
  function resizeImpact(rack, layout) {
    const r = resize(rack, layout);
    const total = allTiles(rack).length;
    const cap = layout.reduce((a, b) => a + b, 0);
    return { relocated: r.relocated, toTray: r.toTray, overCapacity: Math.max(0, total - cap), total, capacity: cap };
  }

  /**
   * Make the rack hold exactly `hand`: tiles that left the hand are removed,
   * new tiles fill free cells then the tray. Positions of kept tiles stay.
   */
  function sync(rack, hand) {
    const keep = new Set(hand);
    let next = clone(rack);
    allTiles(next).forEach(id => { if (!keep.has(id)) removeId(next, id); });
    const added = [];
    hand.forEach(id => {
      if (!find(next, id)) {
        const r = add(next, id);
        next = r.rack;
        added.push({ id, where: r.where });
      }
    });
    return { rack: next, added };
  }

  /**
   * Lay all tiles out again in reading order using `compare`. Rows are
   * filled left to right; leftovers go to the tray.
   */
  function arrange(rack, compare) {
    const ids = allTiles(rack).sort(compare);
    let next = create(layoutOf(rack));
    ids.forEach(id => { next = add(next, id).rack; });
    return next;
  }

  /**
   * Group-aware layout: each group starts on a fresh run of cells with a gap
   * between groups when there is room; falls back to dense packing.
   */
  function arrangeGroups(rack, groups) {
    const layout = layoutOf(rack);
    const cap = layout.reduce((a, b) => a + b, 0);
    const total = groups.reduce((a, g) => a + g.length, 0);
    const gaps = Math.max(0, groups.length - 1);
    if (total + gaps > cap) return denseFrom(rack, groups);
    const next = create(layout);
    let r = 0, c = 0;
    const advance = () => { c++; if (c >= layout[r]) { r++; c = 0; } };
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      // keep a group on one row when it fits
      if (c > 0 && c + g.length > layout[r] && r + 1 < layout.length && g.length <= layout[r + 1]) { r++; c = 0; }
      for (const id of g) {
        if (r >= layout.length) { next.overflow.push(id); continue; }
        next.rows[r][c] = id; advance();
      }
      if (gi < groups.length - 1 && c !== 0 && r < layout.length) advance();
    }
    return next;
  }

  function denseFrom(rack, groups) {
    let next = create(layoutOf(rack));
    groups.forEach(g => g.forEach(id => { next = add(next, id).rack; }));
    return next;
  }

  /** Compact JSON for storage. */
  function serialize(rack) {
    return JSON.stringify(rack);
  }

  /** Read a stored rack back, dropping anything malformed. */
  function deserialize(text) {
    try {
      const o = JSON.parse(text);
      if (!o || !Array.isArray(o.rows) || !Array.isArray(o.overflow)) return null;
      const seen = new Set();
      const ok = v => Number.isInteger(v) && !seen.has(v) && (seen.add(v), true);
      return {
        rows: o.rows.filter(Array.isArray).map(r => r.map(v => (v !== null && ok(v)) ? v : null)),
        overflow: o.overflow.filter(ok)
      };
    } catch (e) { return null; }
  }

  const api = { create, clone, layoutOf, capacity, allTiles, placedCount, find, firstEmpty, moveTo, add, remove, toOverflow, resize, resizeImpact, sync, arrange, arrangeGroups, serialize, deserialize };
  root.RK = root.RK || {};
  root.RK.Rack = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
