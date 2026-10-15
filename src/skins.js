// Tile styles. Each style is CSS (style.css, `.tile.sk-<name>`) plus its own joker art here.
// Every joker carries all four tile colours somewhere in the drawing.
(function (root) {
  'use strict';

  function star(cx, cy, n, ro, ri) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? ri : ro, a = -Math.PI / 2 + i * Math.PI / n;
      pts.push((cx + Math.cos(a) * r).toFixed(2) + ',' + (cy + Math.sin(a) * r).toFixed(2));
    }
    return pts.join(' ');
  }

  const JOKER = {
    // Ivory: a jester — three-point hat in red, blue and yellow on a black band, bells, a grin.
    ivory: '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<g stroke="#2b1d12" stroke-width="1.3" stroke-linejoin="round">' +
      '<path d="M13.5 23.5Q9.5 15 4.5 10.5Q13 9.2 20.8 18.3Z" fill="#d3122f"/>' +
      '<path d="M27.2 18.3Q35 9.2 43.5 10.5Q38.5 15 34.5 23.5Z" fill="#f5a400"/>' +
      '<path d="M18.8 21Q20 10.5 24 4.3Q28 10.5 29.2 21Z" fill="#1559c7"/>' +
      '<rect x="12" y="20.4" width="24" height="5.2" rx="2.6" fill="#1d1e24"/>' +
      '<circle cx="4.5" cy="10.5" r="2.7" fill="#ffd34d"/><circle cx="24" cy="4.3" r="2.7" fill="#ffd34d"/><circle cx="43.5" cy="10.5" r="2.7" fill="#ffd34d"/>' +
      '<circle cx="24" cy="34.6" r="9.6" fill="#fff6e2"/></g>' +
      '<g fill="none" stroke="#2b1d12" stroke-width="1.6" stroke-linecap="round">' +
      '<path d="M19.4 32.8q1.7-1.9 3.4 0"/><path d="M25.2 32.8q1.7-1.9 3.4 0"/><path d="M19.6 37.2q4.4 4.2 8.8 0"/></g>' +
      '<circle cx="18.4" cy="36.2" r="1.5" fill="#ff7d8c"/><circle cx="29.6" cy="36.2" r="1.5" fill="#ff7d8c"/>' +
      '<g fill="#ffd34d"><circle cx="16" cy="23" r=".9"/><circle cx="20" cy="23" r=".9"/><circle cx="24" cy="23" r=".9"/><circle cx="28" cy="23" r=".9"/><circle cx="32" cy="23" r=".9"/></g>' +
      '</svg>',

    // Arcane: an all-seeing sigil — rune ring, eight-point star, a sapphire eye, four gem points.
    arcane: '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<circle cx="24" cy="24" r="21.2" fill="none" stroke="#b892ff" stroke-width="1" stroke-dasharray="1.4 2.4"/>' +
      '<circle cx="24" cy="24" r="17.6" fill="rgba(124,72,230,.2)" stroke="#ffd21f" stroke-width="1.1"/>' +
      '<polygon points="' + star(24, 24, 8, 17, 7.4) + '" fill="rgba(255,210,31,.14)" stroke="#ffd21f" stroke-width=".85" stroke-linejoin="round"/>' +
      '<path d="M11.2 24Q24 13.2 36.8 24Q24 34.8 11.2 24Z" fill="#120a24" stroke="#eceaf7" stroke-width="1.3"/>' +
      '<circle cx="24" cy="24" r="5.2" fill="#49a8ff"/><circle cx="24" cy="24" r="2.2" fill="#07040f"/><circle cx="25.7" cy="22.3" r="1.05" fill="#fff"/>' +
      '<circle cx="24" cy="3.2" r="1.9" fill="#ff4766"/><circle cx="44.8" cy="24" r="1.9" fill="#49a8ff"/><circle cx="24" cy="44.8" r="1.9" fill="#ffd21f"/><circle cx="3.2" cy="24" r="1.9" fill="#eceaf7"/>' +
      '</svg>',

    // Crystal: a cut prism, each facet one of the tile colours, with a glint.
    crystal: '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<g stroke="#ffffff" stroke-width=".9" stroke-linejoin="round">' +
      '<polygon points="9.5,18 16.8,8.6 21.4,18" fill="#ff2e55"/>' +
      '<polygon points="16.8,8.6 31.2,8.6 26.6,18 21.4,18" fill="#ffc400"/>' +
      '<polygon points="31.2,8.6 38.5,18 26.6,18" fill="#2f86ff"/>' +
      '<polygon points="9.5,18 21.4,18 24,42.5" fill="#1d4fc0"/>' +
      '<polygon points="21.4,18 26.6,18 24,42.5" fill="#eef5ff"/>' +
      '<polygon points="26.6,18 38.5,18 24,42.5" fill="#26283a"/></g>' +
      '<polygon points="9.5,18 16.8,8.6 31.2,8.6 38.5,18 24,42.5" fill="none" stroke="#2c3954" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<path d="M38.5 3.5l1.1 2.8 2.8 1.1-2.8 1.1-1.1 2.8-1.1-2.8-2.8-1.1 2.8-1.1z" fill="#fff" stroke="#8fa8cf" stroke-width=".5"/>' +
      '<path d="M8.5 33l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z" fill="#fff" stroke="#8fa8cf" stroke-width=".4"/>' +
      '</svg>',

    // Gilded: a royal crown with pearls, a ruby, and red / blue / onyx stones on the band.
    gilded: '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<path d="M8 33L5.5 14 16 23 24 8.6 32 23 42.5 14 40 33Z" fill="#e7b53c" stroke="#7d5410" stroke-width="1.3" stroke-linejoin="round"/>' +
      '<path d="M10.2 31L8.8 19.4 16.6 26.2 24 13.8 31.4 26.2 39.2 19.4 37.8 31Z" fill="#f8dc84" opacity=".6"/>' +
      '<rect x="7.4" y="32" width="33.2" height="7.2" rx="1.6" fill="#c8921f" stroke="#7d5410" stroke-width="1.3"/>' +
      '<circle cx="5.5" cy="14" r="2.5" fill="#fff8e6" stroke="#7d5410"/><circle cx="24" cy="8.6" r="2.7" fill="#fff8e6" stroke="#7d5410"/><circle cx="42.5" cy="14" r="2.5" fill="#fff8e6" stroke="#7d5410"/>' +
      '<circle cx="15" cy="35.6" r="2.1" fill="#d3122f"/><circle cx="24" cy="35.6" r="2.1" fill="#1559c7"/><circle cx="33" cy="35.6" r="2.1" fill="#1d1e24"/>' +
      '<path d="M24 19.2l3.7 4.6-3.7 4.6-3.7-4.6z" fill="#d3122f" stroke="#7d5410" stroke-width=".9"/>' +
      '<path d="M22.8 21.2l1.2-1.4 1.2 1.4z" fill="#ffd0d6"/>' +
      '</svg>'
  };

  const LIST = Object.freeze(['ivory', 'arcane', 'crystal', 'gilded']);

  // Particle kinds and glow colours per tile colour, per style (used by the effects).
  const GLOW = {
    ivory: ['#e9e4ff', '#ff4d6a', '#4c9dff', '#ffc21a'],
    arcane: ['#eceaf7', '#ff4766', '#49a8ff', '#ffd21f'],
    crystal: ['#dfe9ff', '#ff2e55', '#2f86ff', '#ffc400'],
    gilded: ['#fff1c4', '#ff5470', '#5aa4ff', '#ffcc33']
  };

  function joker(skin) { return JOKER[skin] || JOKER.ivory; }

  const api = { LIST, GLOW, joker };
  root.RK = root.RK || {};
  root.RK.Skins = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
