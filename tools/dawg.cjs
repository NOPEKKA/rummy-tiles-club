// Build-time: turn a sorted word list into a packed DAWG (a trie with shared
// endings), the form the word crossword reads at run time.
//
// Packed form: a Uint32Array. Word 0 = index of the root's first edge.
// Every other word is one edge:
//   bits 0–4  letter (a = 0 … z = 25)
//   bit 5     a word ends here
//   bit 6     last edge of this node
//   bits 7–31 index of the child's first edge (0 = no children)
// A node's edges sit next to each other, sorted by letter.
'use strict';

const LETTER = /^[a-z]+$/;

/** Minimal acyclic automaton from sorted words (Daciuk et al., incremental). */
function build(words) {
  let nextId = 0;
  const node = () => ({ id: nextId++, final: false, edges: new Map() });
  const root = node();
  const register = new Map();
  const unchecked = [];          // [parent, letter, child], the path of the last word
  let prev = '';
  const sig = n => (n.final ? '1' : '0') + [...n.edges].map(([l, c]) => l + c.id).join(',');
  function minimize(downTo) {
    for (let i = unchecked.length - 1; i >= downTo; i--) {
      const [parent, letter, child] = unchecked[i];
      const s = sig(child);
      const same = register.get(s);
      if (same) parent.edges.set(letter, same);
      else register.set(s, child);
      unchecked.pop();
    }
  }
  for (const w of words) {
    if (w <= prev) throw new Error('words must be sorted and unique: ' + prev + ' then ' + w);
    let k = 0;
    while (k < w.length && k < prev.length && w[k] === prev[k]) k++;
    minimize(k);
    let n = unchecked.length ? unchecked[unchecked.length - 1][2] : root;
    for (let i = k; i < w.length; i++) {
      const c = node();
      n.edges.set(w[i], c);
      unchecked.push([n, w[i], c]);
      n = c;
    }
    n.final = true;
    prev = w;
  }
  minimize(0);
  return root;
}

/** Lay the automaton out as edges (see the top of this file). */
function pack(root) {
  const start = new Map();       // node id → index of its first edge
  const order = [];
  let next = 1;
  const queue = [root];
  start.set(root.id, next); next += root.edges.size; order.push(root);
  for (let qi = 0; qi < queue.length; qi++) {
    for (const c of queue[qi].edges.values()) {
      if (!c.edges.size || start.has(c.id)) continue;
      start.set(c.id, next); next += c.edges.size; order.push(c); queue.push(c);
    }
  }
  if (next >= 1 << 25) throw new Error('word list too big for 25-bit edges');
  const out = new Uint32Array(next);
  out[0] = start.get(root.id);
  for (const n of order) {
    let i = start.get(n.id);
    const es = [...n.edges].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    es.forEach(([l, c], k) => {
      const child = c.edges.size ? start.get(c.id) : 0;
      out[i++] = (l.charCodeAt(0) - 97) | (c.final ? 32 : 0) | (k === es.length - 1 ? 64 : 0) | (child << 7);
    });
  }
  return out;
}

/** The words the game uses: a–z only, 2 to `max` letters, sorted, no repeats. */
function clean(text, max) {
  const set = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const w = raw.trim().toLowerCase();
    if (w.length >= 2 && w.length <= max && LETTER.test(w)) set.add(w);
  }
  return [...set].sort();
}

function has(d, word) {
  let i = d[0];
  for (let k = 0; k < word.length; k++) {
    if (!i) return false;
    const l = word.charCodeAt(k) - 97;
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

module.exports = { build, pack, clean, has };
