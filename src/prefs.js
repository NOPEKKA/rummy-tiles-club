// Personal preferences that are not about the board's shape: tile style,
// effects, sound, and the rule you like for new tables. Per viewer, local only.
(function (root) {
  'use strict';

  const SKINS = Object.freeze(['ivory', 'arcane', 'crystal', 'gilded']);
  const FX_LEVELS = Object.freeze(['full', 'lite', 'off']);
  const DEFAULTS = Object.freeze({ skin: 'ivory', fx: 'full', sound: true, volume: 0.7, wrap: true });
  const KEY = 'rk.prefs.v1';

  function sanitize(input) {
    const src = input && typeof input === 'object' ? input : {};
    const vol = Number(src.volume);
    return {
      skin: SKINS.includes(src.skin) ? src.skin : DEFAULTS.skin,
      fx: FX_LEVELS.includes(src.fx) ? src.fx : DEFAULTS.fx,
      sound: src.sound === undefined ? DEFAULTS.sound : !!src.sound,
      volume: Number.isFinite(vol) ? Math.max(0, Math.min(1, Math.round(vol * 100) / 100)) : DEFAULTS.volume,
      wrap: src.wrap === undefined ? DEFAULTS.wrap : !!src.wrap
    };
  }

  function load(storage) {
    try {
      const raw = storage && storage.getItem(KEY);
      if (raw) return sanitize(JSON.parse(raw));
      // carry over the older single wrap switch
      const w = storage && storage.getItem('rk.wrap');
      return sanitize(w === null || w === undefined ? {} : { wrap: w !== '0' });
    } catch (e) { return sanitize({}); }
  }

  function save(storage, prefs) {
    try { storage && storage.setItem(KEY, JSON.stringify(sanitize(prefs))); return true; }
    catch (e) { return false; }
  }

  const api = { SKINS, FX_LEVELS, DEFAULTS, KEY, sanitize, load, save };
  root.RK = root.RK || {};
  root.RK.Prefs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
