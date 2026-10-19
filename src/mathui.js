// Math crossword screen: crossui.js with number and sign tiles.
(function (root) {
  'use strict';
  root.RK = root.RK || {};
  root.RK.MathUI = function (A) {
    const M = root.RK.MathRules, t = A.t;
    const SHOW = s => (s === '*' ? '×' : s === '/' ? '÷' : s === '-' ? '−' : s);
    const FACE = f => (f === '+-' ? '+/−' : f === '*/' ? '×/÷' : f === '?' ? '' : SHOW(f));
    const symKind = s => (s === '=' ? 'eq' : M.NUMS.indexOf(s) >= 0 ? 'num' : 'op');
    return root.RK.CrossUI(A, {
      id: 'math', M, MH: root.RK.MathHost, pre: 'm', store: 'rk.mrack', mark: 'Math <em>Cross</em>', crossMin: 2, typing: false,
      // bonus code → [square class, multiplier, multiplies the whole equation]
      PREM: { E: ['pe3', 3, true], e: ['pe2', 2, true], T: ['pt3', 3, false], t: ['pt2', 2, false], '*': ['pstar', 0, false] },
      tile(id, sym) {
        const tl = M.tile(id), f = tl.face;
        const kind = f === '?' ? 'blank' : f === '+-' || f === '*/' ? 'dual' : f === '=' ? 'eq' : M.isNumFace(f) ? 'num' : 'op';
        return {
          cls: 'k-' + kind + ' s-' + (sym ? symKind(sym) : kind),
          text: sym ? SHOW(sym) : FACE(f),
          label: f === '?' && !sym ? t('mBlankLabel') : t('mTileLabel', { s: sym ? SHOW(sym) : FACE(f), p: tl.pts })
        };
      },
      show: SHOW,
      optCls: s => (M.NUMS.indexOf(s) < 0 ? ' op' : ''),
      fan: ['12', '/', '4', '=', '3']
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
