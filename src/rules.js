// Game rules: tiles, set validation, turn validation, scoring, bot moves.
// Pure. The host runs these to decide what is legal; clients run the same
// code only to give early feedback.
(function (root) {
  'use strict';

  const COLORS = ['black', 'red', 'blue', 'yellow'];
  const JOKERS = [104, 105];
  const TILE_COUNT = 106;
  const JOKER_PENALTY = 30;
  // wrap: a run may continue past 13 back to 1 (… 12 13 1 2)
  const DEFAULT_RULES = Object.freeze({ meldMin: 30, handSize: 14, minPlayers: 2, maxPlayers: 4, wrap: true });
  const cyc = n => ((n - 1) % 13 + 13) % 13 + 1;   // any integer onto 1..13

  /** id = copy * 52 + color * 13 + (number - 1); 104 and 105 are jokers. */
  function tile(id) {
    if (id >= 104) return { id, joker: true, color: -1, n: 0 };
    const k = id % 52;
    return { id, joker: false, color: Math.floor(k / 13), n: (k % 13) + 1 };
  }

  function isJoker(id) { return id >= 104; }

  function fullDeck() {
    return Array.from({ length: TILE_COUNT }, (_, i) => i);
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function tileValue(id) { return isJoker(id) ? JOKER_PENALTY : tile(id).n; }
  function handValue(hand) { return hand.reduce((a, id) => a + tileValue(id), 0); }

  // ---- sets -------------------------------------------------------------

  function asGroup(ids) {
    if (ids.length < 3 || ids.length > 4) return null;
    const real = ids.filter(id => !isJoker(id)).map(tile);
    if (!real.length) return null;
    const n = real[0].n;
    if (real.some(t => t.n !== n)) return null;
    const colors = new Set(real.map(t => t.color));
    if (colors.size !== real.length) return null;
    return { kind: 'group', value: n * ids.length, ordered: ids.slice(), values: ids.map(() => n) };
  }

  function asRunOrdered(ids, wrap) {
    if (ids.length < 3 || ids.length > 13) return null;
    const ts = ids.map(tile);
    const real = ts.filter(t => !t.joker);
    if (!real.length) return null;
    if (real.some(t => t.color !== real[0].color)) return null;
    const i0 = ts.findIndex(t => !t.joker);
    let start = ts[i0].n - i0;
    if (wrap) start = cyc(start);
    else if (start < 1 || start + ids.length - 1 > 13) return null;
    const at = k => wrap ? cyc(start + k) : start + k;
    for (let k = 0; k < ts.length; k++) if (!ts[k].joker && ts[k].n !== at(k)) return null;
    const values = ids.map((_, k) => at(k));
    return { kind: 'run', value: values.reduce((a, b) => a + b, 0), ordered: ids.slice(), values };
  }

  /** Same tiles in any order: sort numbers, fill gaps with jokers, extra jokers at the high end (or low end near 13). */
  function asRunAnyOrder(ids, wrap) {
    if (ids.length < 3 || ids.length > 13) return null;
    const real = ids.filter(id => !isJoker(id)).map(tile).sort((a, b) => a.n - b.n);
    const jokers = ids.filter(isJoker);
    if (!real.length) return null;
    if (real.some(t => t.color !== real[0].color)) return null;
    for (let i = 1; i < real.length; i++) if (real[i].n === real[i - 1].n) return null;
    const lo = real[0].n, hi = real[real.length - 1].n, len = ids.length;
    const start = Math.min(lo, 14 - len);
    if (hi - lo + 1 <= len && start >= 1 && start + len - 1 >= hi) return layRun(real, jokers, start, len, false);
    if (!wrap || real.length < 2) return null;
    // Wrapping run: it starts right after the widest cyclic gap between numbers.
    let gi = 0, gap = -1;
    for (let i = 0; i < real.length; i++) {
      const g = (real[(i + 1) % real.length].n - real[i].n + 13) % 13;
      if (g > gap) { gap = g; gi = i; }
    }
    if (13 - gap + 1 > len) return null;
    return layRun(real, jokers, real[(gi + 1) % real.length].n, len, true);
  }

  function layRun(real, jokers, start, len, wrap) {
    const byN = new Map(real.map(t => [t.n, t.id]));
    const ordered = [], values = [];
    let ji = 0;
    for (let k = 0; k < len; k++) {
      const v = wrap ? cyc(start + k) : start + k;
      values.push(v);
      ordered.push(byN.has(v) ? byN.get(v) : jokers[ji++]);
    }
    if (ordered.some(x => x === undefined)) return null;
    return { kind: 'run', value: values.reduce((a, b) => a + b, 0), ordered, values };
  }

  /**
   * Is this a legal set? Returns the reading with the highest value.
   * @returns {{ok: boolean, kind?: string, value?: number, ordered?: number[], values?: number[], reason?: string}}
   */
  function analyzeSet(ids, rules) {
    if (!Array.isArray(ids) || ids.length < 3) return { ok: false, reason: 'short' };
    if (new Set(ids).size !== ids.length) return { ok: false, reason: 'duplicate' };
    const wrap = rules && rules.wrap !== undefined ? !!rules.wrap : DEFAULT_RULES.wrap;
    const options = [asGroup(ids), asRunOrdered(ids, wrap) || asRunAnyOrder(ids, wrap)].filter(Boolean);
    if (!options.length) {
      if (ids.length > 13) return { ok: false, reason: 'long' };
      return { ok: false, reason: 'mixed' };
    }
    options.sort((a, b) => b.value - a.value);
    return Object.assign({ ok: true }, options[0]);
  }

  // ---- turns ------------------------------------------------------------

  function setKey(s) { return s.slice().sort((a, b) => a - b).join(','); }

  /**
   * Check a whole proposed table for the player whose turn it is.
   * - every tile that was on the table is still on the table
   * - at least one tile came from the hand, and only from the hand
   * - every set is legal
   * - before the first meld: old sets untouched, new sets worth >= meldMin
   */
  function validateTurn(prevTable, nextTable, hand, melded, rules) {
    const R = Object.assign({}, DEFAULT_RULES, rules || {});
    if (!Array.isArray(nextTable) || nextTable.some(s => !Array.isArray(s))) return { ok: false, reason: 'malformed' };
    const flat = [].concat.apply([], nextTable);
    if (flat.some(id => !Number.isInteger(id) || id < 0 || id >= TILE_COUNT)) return { ok: false, reason: 'malformed' };
    if (new Set(flat).size !== flat.length) return { ok: false, reason: 'duplicate' };
    const prevFlat = [].concat.apply([], prevTable);
    const now = new Set(flat);
    if (prevFlat.some(id => !now.has(id))) return { ok: false, reason: 'table_tile_taken' };
    const before = new Set(prevFlat);
    const added = flat.filter(id => !before.has(id));
    if (!added.length) return { ok: false, reason: 'no_tiles' };
    const inHand = new Set(hand);
    if (added.some(id => !inHand.has(id))) return { ok: false, reason: 'not_your_tile' };
    const sets = nextTable.filter(s => s.length);
    const bad = [];
    const analyses = sets.map((s, i) => { const a = analyzeSet(s, R); if (!a.ok) bad.push(i); return a; });
    if (bad.length) return { ok: false, reason: 'invalid_set', badSets: bad };
    let meldValue = 0;
    if (!melded) {
      const oldKeys = new Map();
      prevTable.forEach(s => { const k = setKey(s); oldKeys.set(k, (oldKeys.get(k) || 0) + 1); });
      sets.forEach((s, i) => {
        const k = setKey(s);
        if (oldKeys.get(k)) oldKeys.set(k, oldKeys.get(k) - 1);
        else meldValue += analyses[i].value;
      });
      const untouched = [...oldKeys.values()].every(v => v === 0);
      if (!untouched) return { ok: false, reason: 'meld_touches_table' };
      if (meldValue < R.meldMin) return { ok: false, reason: 'meld_too_low', meldValue, meldMin: R.meldMin };
    }
    const normalized = sets.map((s, i) => analyses[i].ordered);
    return { ok: true, added, meldValue, table: normalized, emptied: added.length === hand.length };
  }

  /** Live feedback for a draft table: which sets are bad, current meld value. */
  function draftStatus(prevTable, draftTable, melded, rules) {
    const oldKeys = new Map();
    prevTable.forEach(s => { const k = setKey(s); oldKeys.set(k, (oldKeys.get(k) || 0) + 1); });
    let meldValue = 0;
    const sets = draftTable.map(s => {
      const a = analyzeSet(s, rules);
      const k = setKey(s);
      let isOld = false;
      if (oldKeys.get(k)) { oldKeys.set(k, oldKeys.get(k) - 1); isOld = true; }
      else if (a.ok) meldValue += a.value;
      return { ok: a.ok, reason: a.reason, value: a.ok ? a.value : 0, kind: a.kind, isOld };
    });
    return { sets, meldValue, oldIntact: [...oldKeys.values()].every(v => v === 0), allOk: sets.every(s => s.ok) };
  }

  // ---- sorting ----------------------------------------------------------

  function byColor(a, b) {
    const A = tile(a), B = tile(b);
    if (A.joker !== B.joker) return A.joker ? 1 : -1;
    return A.color - B.color || A.n - B.n || a - b;
  }

  function byNumber(a, b) {
    const A = tile(a), B = tile(b);
    if (A.joker !== B.joker) return A.joker ? 1 : -1;
    return A.n - B.n || A.color - B.color || a - b;
  }

  // ---- wire encoding ----------------------------------------------------

  function encodeIds(ids) { return ids.map(id => id.toString(36).padStart(2, '0')).join(''); }
  function decodeIds(str) {
    const out = [];
    if (typeof str !== 'string') return out;
    for (let i = 0; i + 1 < str.length; i += 2) {
      const v = parseInt(str.slice(i, i + 2), 36);
      if (Number.isInteger(v) && v >= 0 && v < TILE_COUNT) out.push(v);
    }
    return out;
  }
  function encodeTable(table) { return table.map(encodeIds).join('.'); }
  function decodeTable(str) {
    if (typeof str !== 'string' || !str) return [];
    return str.split('.').map(decodeIds).filter(s => s.length);
  }

  // ---- bot --------------------------------------------------------------

  /** Best non-overlapping sets from a hand (greedy by value). */
  function setsFromHand(hand, rules) {
    const R = Object.assign({}, DEFAULT_RULES, rules || {});
    let pool = hand.filter(id => !isJoker(id));
    let jokers = hand.filter(isJoker);
    const chosen = [];
    for (;;) {
      const cands = [];
      // groups
      for (let n = 1; n <= 13; n++) {
        const byC = new Map();
        pool.forEach(id => { const t = tile(id); if (t.n === n && !byC.has(t.color)) byC.set(t.color, id); });
        if (byC.size >= 3) cands.push([...byC.values()]);
      }
      // runs
      for (let c = 0; c < 4; c++) {
        const byN = new Map();
        pool.forEach(id => { const t = tile(id); if (t.color === c && !byN.has(t.n)) byN.set(t.n, id); });
        if (R.wrap && byN.size === 13) { cands.push(Array.from({ length: 13 }, (_, k) => byN.get(k + 1))); continue; }
        // linear scan, or a cyclic one starting just after a missing number
        let missing = 14;
        if (R.wrap) for (let n = 1; n <= 13; n++) if (!byN.has(n)) { missing = n; break; }
        let run = [];
        for (let k = 1; k <= 14; k++) {
          const n = R.wrap ? cyc(missing + k) : k;
          if (k <= 13 && byN.has(n)) run.push(byN.get(n));
          else { if (run.length >= 3) cands.push(run); run = []; }
        }
      }
      if (!cands.length) break;
      cands.sort((a, b) => analyzeSet(b, R).value - analyzeSet(a, R).value);
      const best = cands[0];
      chosen.push(best);
      const used = new Set(best);
      pool = pool.filter(id => !used.has(id));
    }
    // Spend jokers on the best pair they can complete.
    while (jokers.length) {
      const j = jokers[0];
      let best = null;
      for (let i = 0; i < pool.length; i++) for (let k = i + 1; k < pool.length; k++) {
        const s = [pool[i], pool[k], j];
        const a = analyzeSet(s, R);
        if (a.ok && (!best || a.value > best.value)) best = { set: a.ordered, value: a.value, used: [pool[i], pool[k]] };
      }
      if (!best) {
        // extend an already chosen set instead
        let ext = null;
        chosen.forEach((s, idx) => {
          const a = analyzeSet(s.concat([j]), R);
          if (a.ok && (!ext || a.value > ext.value)) ext = { idx, ordered: a.ordered, value: a.value };
        });
        if (!ext) break;
        chosen[ext.idx] = ext.ordered;
      } else {
        chosen.push(best.set);
        pool = pool.filter(id => !best.used.includes(id));
      }
      jokers = jokers.slice(1);
    }
    return chosen.map(s => analyzeSet(s, R).ordered);
  }

  /** Try to lay single tiles onto the ends of table sets. */
  function extendTable(table, tiles, rules) {
    const next = table.map(s => s.slice());
    let left = tiles.slice();
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of left.slice()) {
        if (isJoker(id)) continue;
        for (let i = 0; i < next.length; i++) {
          for (const cand of [next[i].concat([id]), [id].concat(next[i])]) {
            const a = analyzeSet(cand, rules);
            if (a.ok) { next[i] = a.ordered; left = left.filter(x => x !== id); changed = true; break; }
          }
          if (changed) break;
        }
        if (changed) break;
      }
    }
    return { table: next, left };
  }

  /** Decide a bot's move. Returns {t:'play', table} or {t:'draw'}. */
  function botMove(table, hand, melded, rules) {
    const R = Object.assign({}, DEFAULT_RULES, rules || {});
    const sets = setsFromHand(hand, R);
    const used = new Set([].concat.apply([], sets));
    if (!melded) {
      const v = sets.reduce((a, s) => a + analyzeSet(s, R).value, 0);
      if (v < R.meldMin || !sets.length) return { t: 'draw' };
      const proposal = table.concat(sets);
      return validateTurn(table, proposal, hand, false, R).ok ? { t: 'play', table: proposal } : { t: 'draw' };
    }
    const rest = hand.filter(id => !used.has(id));
    const ext = extendTable(table, rest, R);
    const proposal = ext.table.concat(sets);
    const check = validateTurn(table, proposal, hand, true, R);
    if (check.ok) return { t: 'play', table: proposal };
    return { t: 'draw' };
  }

  const api = { COLORS, JOKERS, TILE_COUNT, DEFAULT_RULES, tile, isJoker, fullDeck, shuffle, tileValue, handValue, analyzeSet, validateTurn, draftStatus, byColor, byNumber, encodeIds, decodeIds, encodeTable, decodeTable, setsFromHand, extendTable, botMove };
  root.RK = root.RK || {};
  root.RK.Rules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
