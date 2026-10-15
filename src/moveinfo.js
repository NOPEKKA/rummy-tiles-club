// What kind of move was that? Drives the effects: how many tiles were laid,
// which sets were extended, which tiles were stolen from another set, and the
// showy shapes (long runs, 13 → 1 wraps, four-colour groups). Pure.
(function (root) {
  'use strict';
  const Rules = (root.RK && root.RK.Rules) || require('./rules.js');

  /**
   * @param {number[][]} prevTable  sets before the move
   * @param {number[][]} nextTable  sets after the move
   * @param {number[]} added        tiles that came from the hand
   */
  function analyze(prevTable, nextTable, added, rules) {
    const fromHand = new Set(added);
    const oldSetOf = new Map();
    prevTable.forEach((s, i) => s.forEach(id => oldSetOf.set(id, i)));

    // count[i] = how many tiles of each old set ended up in new set i
    const count = nextTable.map(s => {
      const m = new Map();
      s.forEach(id => { if (oldSetOf.has(id)) { const o = oldSetOf.get(id); m.set(o, (m.get(o) || 0) + 1); } });
      return m;
    });
    // Each old set lives on in the new set that kept most of its tiles (its heir).
    const heir = prevTable.map((_, o) => {
      let best = -1, n = 0;
      count.forEach((m, i) => { const c = m.get(o) || 0; if (c > n) { n = c; best = i; } });
      return best;
    });
    // One or two tiles pulled out of a set into some other set were stolen.
    // Three or more moving together is a split, not a theft.
    const stolen = [];
    nextTable.forEach((s, i) => {
      count[i].forEach((c, o) => {
        if (heir[o] !== i && c < 3) s.forEach(id => { if (oldSetOf.get(id) === o) stolen.push(id); });
      });
    });
    const stolenSet = new Set(stolen);

    // Sets that got hand tiles: built on what was on the table, or brand new.
    const extended = [], fresh = [];
    nextTable.forEach((s, i) => {
      if (!s.some(id => fromHand.has(id))) return;
      if (count[i].size) extended.push(i); else fresh.push(i);
    });

    let longest = 0, wrap = false, group4 = false;
    nextTable.forEach((s, i) => {
      const touched = s.some(id => fromHand.has(id) || stolenSet.has(id));
      if (!touched) return;
      const a = Rules.analyzeSet(s, rules);
      if (!a.ok) return;
      if (a.kind === 'run') {
        longest = Math.max(longest, s.length);
        for (let k = 0; k + 1 < a.values.length; k++) if (a.values[k] === 13 && a.values[k + 1] === 1) wrap = true;
      } else if (s.length === 4) group4 = true;
    });

    return {
      n: added.length,
      extended,                 // indexes into nextTable
      fresh,                    // brand-new sets made only from the hand (indexes)
      stolen,                   // tile ids moved out of one set into another
      jokerStolen: stolen.some(Rules.isJoker),
      longest,
      wrap,
      group4
    };
  }

  const api = { analyze };
  root.RK = root.RK || {};
  root.RK.MoveInfo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
