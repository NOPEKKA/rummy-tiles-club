// Word crossword screen: crossui.js with letter tiles, and typing on a keyboard.
(function (root) {
  'use strict';
  root.RK = root.RK || {};
  root.RK.WordUI = function (A) {
    const M = root.RK.WordRules, t = A.t;
    return root.RK.CrossUI(A, {
      id: 'word', M, MH: root.RK.WordHost, pre: 'w', store: 'rk.wrack', mark: 'Word <em>Cross</em>', crossMin: 3, typing: true,
      // bonus code → [square class, multiplier, multiplies the whole word]
      PREM: { W: ['pe3', 3, true], w: ['pe2', 2, true], L: ['pt3', 3, false], l: ['pt2', 2, false], '*': ['pstar', 0, false] },
      ready: () => M.hasDict(),
      tile(id, sym) {
        const tl = M.tile(id), blank = tl.face === '?';
        return {
          cls: blank ? 'k-blank s-let' : 'k-let s-let',
          text: sym || (blank ? '' : tl.face),
          label: blank ? (sym ? t('wBlankAs', { s: sym }) : t('wBlankLabel')) : t('wTileLabel', { s: tl.face, p: tl.pts })
        };
      },
      show: s => s,
      optCls: () => '',
      fan: ['W', 'O', 'R', 'D', 'S']
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
