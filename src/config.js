// Board configuration: the player's personal rack layout and look.
// Kept apart from game rules (rules.js) — nothing here changes what a legal move is.
(function (root) {
  'use strict';

  /** Hard limits. Change these to change what the settings panel allows. */
  const LIMITS = Object.freeze({
    maxColumns: 15,
    maxRows: 4,
    maxCells: 60,
    minColumns: 3,
    minRows: 1,
    tileSize: [36, 80],     // px, at 100 % zoom
    spacing: [0, 20],       // px between cells
    padding: [0, 48],       // px inside the board frame
    width: [320, 1920],     // px, 0 = fit content
    height: [120, 600],     // px, 0 = fit content
    minReadableTile: 32     // px, zoom never shrinks a tile below this
  });

  const POSITIONS = Object.freeze([
    'top-left', 'top-center', 'top-right',
    'bottom-left', 'bottom-center', 'bottom-right'
  ]);

  const BACKGROUNDS = Object.freeze(['walnut', 'felt', 'slate', 'cherry', 'sand', 'custom']);

  const DEFAULTS = Object.freeze({
    width: 0,
    height: 0,
    columns: 15,
    rows: 2,
    advanced: false,
    rowCols: Object.freeze([15, 15, 15, 15]),
    tileSize: 52,
    spacing: 6,
    padding: 14,
    position: 'bottom-center',
    background: 'walnut',
    customColor: '#2f4a3f',
    grid: true
  });

  function clampInt(v, lo, hi, fallback) {
    let n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
    if (!Number.isFinite(n)) return { value: fallback, changed: true };
    n = Math.round(n);
    if (n < lo) return { value: lo, changed: true };
    if (n > hi) return { value: hi, changed: true };
    return { value: n, changed: false };
  }

  /** Size fields where 0 means "fit content". */
  function clampSize(v, range, fallback) {
    const n = Number(v);
    if (n === 0) return { value: 0, changed: false };
    return clampInt(v, range[0], range[1], fallback);
  }

  /**
   * Validate and repair any input. Never throws; every out-of-range value is
   * clamped and reported in `errors` (field + code) so the UI can explain it.
   * @returns {{config: object, errors: {field: string, code: string}[]}}
   */
  function sanitize(input, limits) {
    const L = Object.assign({}, LIMITS, limits || {});
    const src = input && typeof input === 'object' ? input : {};
    const errors = [];
    const out = {};
    const num = (field, lo, hi) => {
      const r = clampInt(src[field] === undefined ? DEFAULTS[field] : src[field], lo, hi, DEFAULTS[field]);
      if (r.changed && src[field] !== undefined) errors.push({ field, code: 'range' });
      out[field] = r.value;
    };
    const size = (field, range) => {
      const r = clampSize(src[field] === undefined ? DEFAULTS[field] : src[field], range, DEFAULTS[field]);
      if (r.changed && src[field] !== undefined) errors.push({ field, code: 'range' });
      out[field] = r.value;
    };

    size('width', L.width);
    size('height', L.height);
    num('rows', L.minRows, L.maxRows);
    num('columns', L.minColumns, L.maxColumns);
    num('tileSize', L.tileSize[0], L.tileSize[1]);
    num('spacing', L.spacing[0], L.spacing[1]);
    num('padding', L.padding[0], L.padding[1]);
    out.advanced = !!src.advanced;
    out.grid = src.grid === undefined ? DEFAULTS.grid : !!src.grid;

    const rc = Array.isArray(src.rowCols) ? src.rowCols : DEFAULTS.rowCols;
    out.rowCols = [];
    for (let i = 0; i < L.maxRows; i++) {
      const r = clampInt(rc[i] === undefined ? out.columns : rc[i], L.minColumns, L.maxColumns, out.columns);
      if (r.changed && rc[i] !== undefined) errors.push({ field: 'rowCols.' + i, code: 'range' });
      out.rowCols.push(r.value);
    }

    // Total capacity cap. With the defaults 15 × 4 = 60 already fits; this
    // guards custom limits and hand-edited saves.
    if (!out.advanced) {
      while (out.columns * out.rows > L.maxCells && out.columns > L.minColumns) {
        out.columns--;
        if (!errors.some(e => e.field === 'columns' && e.code === 'capacity')) errors.push({ field: 'columns', code: 'capacity' });
      }
      while (out.columns * out.rows > L.maxCells && out.rows > L.minRows) {
        out.rows--;
        errors.push({ field: 'rows', code: 'capacity' });
      }
    } else {
      let total = () => out.rowCols.slice(0, out.rows).reduce((a, b) => a + b, 0);
      let guard = 0;
      while (total() > L.maxCells && guard++ < 200) {
        // trim the widest active row first
        let wi = 0;
        for (let i = 1; i < out.rows; i++) if (out.rowCols[i] >= out.rowCols[wi]) wi = i;
        if (out.rowCols[wi] <= L.minColumns) { out.rows = Math.max(L.minRows, out.rows - 1); continue; }
        out.rowCols[wi]--;
        if (!errors.some(e => e.code === 'capacity')) errors.push({ field: 'rowCols', code: 'capacity' });
      }
    }

    out.position = POSITIONS.includes(src.position) ? src.position : DEFAULTS.position;
    if (src.position !== undefined && out.position !== src.position) errors.push({ field: 'position', code: 'enum' });
    out.background = BACKGROUNDS.includes(src.background) ? src.background : DEFAULTS.background;
    if (src.background !== undefined && out.background !== src.background) errors.push({ field: 'background', code: 'enum' });
    out.customColor = /^#[0-9a-fA-F]{6}$/.test(src.customColor || '') ? src.customColor.toLowerCase() : DEFAULTS.customColor;
    if (src.customColor !== undefined && out.customColor !== String(src.customColor).toLowerCase()) errors.push({ field: 'customColor', code: 'format' });

    return { config: out, errors };
  }

  /** Columns in each row, top to bottom. */
  function rowLayout(config) {
    return config.advanced
      ? config.rowCols.slice(0, config.rows)
      : Array.from({ length: config.rows }, () => config.columns);
  }

  function capacity(config) {
    return rowLayout(config).reduce((a, b) => a + b, 0);
  }

  /** "15 × 4 = 60" or "15 + 12 + 9 = 36" */
  function capacityLabel(config) {
    const rows = rowLayout(config);
    const total = rows.reduce((a, b) => a + b, 0);
    const same = rows.every(c => c === rows[0]);
    return (same ? rows[0] + ' × ' + rows.length : rows.join(' + ')) + ' = ' + total;
  }

  /** Natural content size of the board at a given zoom. */
  function contentSize(config, zoom) {
    const z = zoom || 1;
    const t = config.tileSize * z, g = config.spacing * z, p = config.padding;
    const rows = rowLayout(config);
    const maxCols = Math.max.apply(null, rows);
    return {
      width: Math.round(p * 2 + maxCols * t + (maxCols - 1) * g),
      height: Math.round(p * 2 + rows.length * t * 1.3 + (rows.length - 1) * g)
    };
  }

  /**
   * Zoom that fits the board into `available` px of width without making a
   * tile smaller than the readable minimum. Anything still wider pans.
   */
  function fitZoom(config, available, limits) {
    const L = Object.assign({}, LIMITS, limits || {});
    const natural = contentSize(config, 1).width;
    if (natural <= available) return 1;
    const z = (available - config.padding * 2) / (natural - config.padding * 2);
    const floor = L.minReadableTile / config.tileSize;
    return Math.max(Math.min(1, floor), Math.min(1, z));
  }

  function equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  const STORAGE_KEY = 'rk.board.v1';

  function load(storage) {
    try {
      const raw = storage && storage.getItem(STORAGE_KEY);
      if (!raw) return sanitize({}).config;
      return sanitize(JSON.parse(raw)).config;
    } catch (e) {
      return sanitize({}).config;
    }
  }

  function save(storage, config) {
    const clean = sanitize(config).config;
    try { storage && storage.setItem(STORAGE_KEY, JSON.stringify(clean)); return true; }
    catch (e) { return false; }
  }

  const api = { LIMITS, DEFAULTS, POSITIONS, BACKGROUNDS, STORAGE_KEY, sanitize, rowLayout, capacity, capacityLabel, contentSize, fitZoom, equal, load, save };
  root.RK = root.RK || {};
  root.RK.BoardConfig = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
