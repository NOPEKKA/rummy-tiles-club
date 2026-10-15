const test = require('node:test');
const assert = require('node:assert/strict');
const BC = require('../src/config.js');
const Rack = require('../src/rack.js');

const ids = n => Array.from({ length: n }, (_, i) => i);
const sorted = a => a.slice().sort((x, y) => x - y);

test('defaults are valid and within limits', () => {
  const { config, errors } = BC.sanitize({});
  assert.deepEqual(errors, []);
  assert.equal(config.columns, 15);
  assert.equal(config.rows, 2);
  assert.equal(BC.capacity(config), 30);
});

test('minimum size clamps up', () => {
  const { config, errors } = BC.sanitize({ columns: 0, rows: 0, tileSize: 1, spacing: -5, padding: -1 });
  assert.equal(config.columns, BC.LIMITS.minColumns);
  assert.equal(config.rows, BC.LIMITS.minRows);
  assert.equal(config.tileSize, BC.LIMITS.tileSize[0]);
  assert.equal(config.spacing, 0);
  assert.equal(config.padding, 0);
  assert.ok(errors.some(e => e.field === 'columns'));
  assert.ok(errors.some(e => e.field === 'rows'));
});

test('maximum size is 15 × 4 = 60 and cannot be exceeded', () => {
  const max = BC.sanitize({ columns: 15, rows: 4 }).config;
  assert.equal(BC.capacity(max), 60);
  assert.equal(BC.capacityLabel(max), '15 × 4 = 60');
  const over = BC.sanitize({ columns: 99, rows: 9 });
  assert.equal(over.config.columns, 15);
  assert.equal(over.config.rows, 4);
  assert.equal(BC.capacity(over.config), 60);
  assert.ok(over.errors.length >= 2);
});

test('examples from the brief', () => {
  for (const [c, r, total] of [[5, 2, 10], [10, 3, 30], [15, 2, 30], [15, 4, 60]]) {
    const cfg = BC.sanitize({ columns: c, rows: r }).config;
    assert.equal(BC.capacity(cfg), total, `${c}×${r}`);
    assert.deepEqual(BC.rowLayout(cfg), new Array(r).fill(c));
  }
});

test('advanced layout allows different row widths, capped per row and in total', () => {
  const cfg = BC.sanitize({ advanced: true, rows: 3, rowCols: [15, 12, 8, 20] }).config;
  assert.deepEqual(BC.rowLayout(cfg), [15, 12, 8]);
  assert.equal(BC.capacityLabel(cfg), '15 + 12 + 8 = 35');
  const big = BC.sanitize({ advanced: true, rows: 4, rowCols: [40, 40, 40, 40] });
  assert.deepEqual(BC.rowLayout(big.config), [15, 15, 15, 15]);
  assert.ok(BC.capacity(big.config) <= 60);
});

test('a lower custom cell cap is enforced', () => {
  const tight = BC.sanitize({ columns: 15, rows: 4 }, { maxCells: 40 });
  assert.ok(BC.capacity(tight.config) <= 40);
  assert.ok(tight.errors.some(e => e.code === 'capacity'));
  const adv = BC.sanitize({ advanced: true, rows: 4, rowCols: [15, 15, 15, 15] }, { maxCells: 40 });
  assert.ok(BC.capacity(adv.config) <= 40);
});

test('junk input never throws and falls back to defaults', () => {
  for (const junk of [null, 'x', 42, { columns: 'abc', position: 'middle', background: 'url(x)', customColor: 'red' }]) {
    const { config } = BC.sanitize(junk);
    assert.ok(config.columns >= 3 && config.columns <= 15);
    assert.ok(BC.POSITIONS.includes(config.position));
    assert.ok(BC.BACKGROUNDS.includes(config.background));
    assert.match(config.customColor, /^#[0-9a-f]{6}$/);
  }
});

test('width/height 0 means fit content; other values clamp', () => {
  assert.equal(BC.sanitize({ width: 0 }).config.width, 0);
  assert.equal(BC.sanitize({ width: 50 }).config.width, 320);
  assert.equal(BC.sanitize({ height: 5000 }).config.height, 600);
});

test('fit zoom never shrinks a tile below the readable minimum', () => {
  const cfg = BC.sanitize({ columns: 15, rows: 4, tileSize: 64 }).config;
  const z = BC.fitZoom(cfg, 300);
  assert.ok(cfg.tileSize * z >= BC.LIMITS.minReadableTile - 1e-9);
  assert.equal(BC.fitZoom(cfg, 5000), 1);
});

test('save and load round-trip; corrupt storage loads defaults', () => {
  const mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const cfg = BC.sanitize({ columns: 10, rows: 3, tileSize: 60, background: 'felt', position: 'top-left' }).config;
  assert.ok(BC.save(storage, cfg));
  assert.deepEqual(BC.load(storage), cfg);
  mem.set(BC.STORAGE_KEY, '{not json');
  assert.deepEqual(BC.load(storage), BC.sanitize({}).config);
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(BC.load(throwing), BC.sanitize({}).config);
  assert.equal(BC.save(throwing, cfg), false);
});

// ---- rack -------------------------------------------------------------

function fill(layout, n) {
  let r = Rack.create(layout);
  ids(n).forEach(id => { r = Rack.add(r, id).rack; });
  return r;
}

test('tiles fill cells, then the tray when the board is full', () => {
  const r = fill([5, 5], 14);
  assert.equal(Rack.placedCount(r), 10);
  assert.deepEqual(r.overflow, [10, 11, 12, 13]);
  assert.deepEqual(sorted(Rack.allTiles(r)), ids(14));
});

test('move to empty cell, swap on occupied cell, refuse from tray onto occupied', () => {
  let r = fill([5, 2], 8);
  // 0..4 row 0, 5,6 row 1, 7 in tray
  let m = Rack.moveTo(r, 0, { r: 1, c: 1 });
  assert.equal(m.ok, true);
  assert.equal(m.swapped, 6);
  assert.equal(m.rack.rows[1][1], 0);
  assert.equal(m.rack.rows[0][0], 6);
  m = Rack.moveTo(r, 7, { r: 0, c: 2 });
  assert.equal(m.ok, false);
  assert.equal(m.reason, 'occupied');
  r = Rack.remove(r, 3);
  m = Rack.moveTo(r, 7, { r: 0, c: 3 });
  assert.equal(m.ok, true);
  assert.equal(m.rack.overflow.length, 0);
  m = Rack.moveTo(r, 1, { r: 9, c: 0 });
  assert.equal(m.ok, false);
});

test('moving between rows keeps every tile exactly once', () => {
  let r = fill([15, 15, 15, 15], 30);
  for (let i = 0; i < 200; i++) {
    const id = i % 30;
    const res = Rack.moveTo(r, id, { r: (i * 7) % 4, c: (i * 11) % 15 });
    r = res.rack;
    const all = Rack.allTiles(r);
    assert.equal(all.length, 30);
    assert.equal(new Set(all).size, 30);
  }
});

test('shrinking keeps positions that still exist and never loses a tile', () => {
  const r = fill([15, 15], 25);
  const impact = Rack.resizeImpact(r, [5, 2]);
  assert.equal(impact.overCapacity, 18);
  assert.equal(impact.toTray, 18);
  const { rack } = Rack.resize(r, [5, 2]);
  assert.deepEqual(rack.rows[0], [0, 1, 2, 3, 4]);
  assert.deepEqual(sorted(Rack.allTiles(rack)), ids(25));
  assert.equal(rack.overflow.length, 18);
});

test('growing again pulls tiles back out of the tray', () => {
  const small = Rack.resize(fill([15, 15], 25), [5, 2]).rack;
  const { rack } = Rack.resize(small, [15, 15, 15, 15]);
  assert.equal(rack.overflow.length, 0);
  assert.deepEqual(sorted(Rack.allTiles(rack)), ids(25));
});

test('resize to advanced uneven rows keeps every tile', () => {
  const r = fill([15, 15, 15, 15], 60);
  const { rack } = Rack.resize(r, [15, 12, 8, 3]);
  assert.deepEqual(Rack.layoutOf(rack), [15, 12, 8, 3]);
  assert.deepEqual(sorted(Rack.allTiles(rack)), ids(60));
  assert.equal(rack.overflow.length, 60 - 38);
});

test('resize with no overflow reports zero tiles to the tray', () => {
  const r = fill([15, 2], 10);
  const impact = Rack.resizeImpact(r, [10, 3]);
  assert.equal(impact.toTray, 0);
  assert.equal(impact.overCapacity, 0);
});

test('sync with a new hand removes played tiles and adds drawn ones', () => {
  let r = fill([5, 2], 8);
  r = Rack.moveTo(r, 4, { r: 1, c: 1 }).rack;
  const { rack, added } = Rack.sync(r, [0, 1, 4, 50, 51]);
  assert.deepEqual(sorted(Rack.allTiles(rack)), [0, 1, 4, 50, 51]);
  assert.equal(rack.rows[1][1], 4, 'kept tile stays put');
  assert.deepEqual(added.map(a => a.id), [50, 51]);
});

test('arrange and group arrange keep every tile', () => {
  const r = fill([5, 5], 14);
  const a = Rack.arrange(r, (x, y) => y - x);
  assert.deepEqual(sorted(Rack.allTiles(a)), ids(14));
  assert.equal(a.rows[0][0], 13);
  const g = Rack.arrangeGroups(Rack.create([15, 15]), [[1, 2, 3], [4, 5], [6]]);
  assert.deepEqual(g.rows[0].slice(0, 9), [1, 2, 3, null, 4, 5, null, 6, null]);
  const tight = Rack.arrangeGroups(Rack.create([3, 3]), [[1, 2, 3], [4, 5], [6, 7]]);
  assert.deepEqual(sorted(Rack.allTiles(tight)), [1, 2, 3, 4, 5, 6, 7]);
});

test('serialize round-trips and deserialize drops duplicates and junk', () => {
  const r = fill([5, 2], 12);
  assert.deepEqual(Rack.deserialize(Rack.serialize(r)), r);
  const bad = Rack.deserialize('{"rows":[[1,1,"x",null]],"overflow":[1,2,2]}');
  assert.deepEqual(bad, { rows: [[1, null, null, null]], overflow: [2] });
  assert.equal(Rack.deserialize('nope'), null);
});
