// Host engine for the math crossword: one table's single source of truth.
// Same shape as host.js (Rummy), so the app's online code drives both.
// Pure apart from the injected rng and clock.
(function (root) {
  'use strict';
  const M = (root.RK && root.RK.MathRules) || require('./mathrules.js');
  const Bot = (root.RK && root.RK.MathBot) || require('./mathbot.js');
  const Host = (root.RK && root.RK.Host) || require('./host.js');
  const cleanName = Host.cleanName;

  const DEFAULT_RULES = { rack: M.RACK, minPlayers: 2, maxPlayers: 4, turnSec: 0, swapMin: 5, botLevel: 'normal' };
  const TURN_SECS = [0, 60, 90, 120, 180];
  const BOT_LEVELS = ['easy', 'normal', 'hard'];

  function createGame(opts) {
    const rules = Object.assign({}, DEFAULT_RULES, opts.rules || {});
    if (TURN_SECS.indexOf(rules.turnSec) < 0) rules.turnSec = 0;
    if (BOT_LEVELS.indexOf(rules.botLevel) < 0) rules.botLevel = 'normal';
    return {
      game: 'math',
      code: opts.code,
      hostId: opts.hostId,
      status: 'lobby',
      players: [{ id: opts.hostId, name: cleanName(opts.hostName), bot: false, hand: [], score: 0, wins: 0 }],
      bag: [],
      board: M.emptyBoard(),
      turn: 0, tn: 0, v: 1, round: 0,
      scoreless: 0,          // turns in a row without points; a long enough streak ends the game
      winner: -1,
      log: [],
      rules,
      lastMove: null,
      turnAt: 0              // host clock when this turn began (for the turn timer)
    };
  }

  const idx = (G, id) => G.players.findIndex(p => p.id === id);
  function bump(G, entry) {
    G.v++;
    if (entry) { G.log.push(entry); if (G.log.length > 8) G.log.splice(0, G.log.length - 8); }
  }

  function addPlayer(G, id, name, bot) {
    const i = idx(G, id);
    if (i >= 0) {
      if (!G.players[i].bot && name) G.players[i].name = cleanName(name);
      bump(G);
      return { ok: true, rejoined: true };
    }
    if (G.status === 'playing') return { ok: false, reason: 'in_progress' };
    if (G.players.length >= G.rules.maxPlayers) return { ok: false, reason: 'full' };
    G.players.push({ id, name: cleanName(name), bot: !!bot, hand: [], score: 0, wins: 0 });
    bump(G, { k: 'join', p: G.players.length - 1 });
    return { ok: true };
  }
  function addBot(G) {
    let n = 1;
    while (G.players.some(p => p.id === 'bot' + n)) n++;
    return addPlayer(G, 'bot' + n, 'Bot ' + n, true);
  }
  function removePlayer(G, id) {
    const i = idx(G, id);
    if (i < 0 || id === G.hostId) return { ok: false, reason: 'no_player' };
    if (G.status === 'playing') return { ok: false, reason: 'in_progress' };
    G.players.splice(i, 1);
    bump(G);
    return { ok: true };
  }

  function refill(G, p) {
    while (p.hand.length < G.rules.rack && G.bag.length) p.hand.push(G.bag.pop());
  }

  function start(G, rng, now) {
    if (G.status === 'playing') return { ok: false, reason: 'in_progress' };
    if (G.players.length < G.rules.minPlayers) return { ok: false, reason: 'need_players' };
    G.bag = M.shuffle(M.fullBag(), rng);
    G.board = M.emptyBoard();
    G.players.forEach(p => { p.hand = []; p.score = 0; refill(G, p); });
    G.round++;
    G.turn = Math.floor(rng() * G.players.length);
    G.tn = (G.tn || 0) + 1;
    G.scoreless = 0;
    G.winner = -1;
    G.status = 'playing';
    G.result = null;
    G.lastMove = { tn: G.tn, k: 'deal', p: G.turn };
    G.turnAt = now || 0;
    G.log = [];
    bump(G, { k: 'start', p: G.turn });
    return { ok: true };
  }

  function nextTurn(G, now) {
    G.turn = (G.turn + 1) % G.players.length;
    G.tn++;
    G.turnAt = now || 0;
  }

  /** Game over. `out` is the seat that used its last tile (or -1). */
  function finish(G, out) {
    G.status = 'ended';
    const left = G.players.map(p => M.rackValue(p.hand));
    const delta = G.players.map((p, i) => (i === out ? left.reduce((a, b) => a + b, 0) : -left[i]));
    G.players.forEach((p, i) => { p.score += delta[i]; });
    const top = Math.max.apply(null, G.players.map(p => p.score));
    const leaders = G.players.map((p, i) => (p.score === top ? i : -1)).filter(i => i >= 0);
    G.winner = leaders.length === 1 ? leaders[0] : -1;      // -1 = a draw
    if (G.winner >= 0) G.players[G.winner].wins++;
    G.result = G.players.map((p, i) => ({ left: left[i], delta: delta[i], score: p.score }));
    bump(G, { k: G.winner >= 0 ? 'win' : 'draw', p: G.winner });
  }

  /** A turn without points (swap, pass, timeout, skip). Enough of them in a row ends the game. */
  function scoreless(G, pi, kind, now, extra) {
    G.lastMove = Object.assign({ tn: G.tn, k: kind, p: pi }, extra || {});
    G.scoreless++;
    if (G.scoreless >= G.players.length * 3) {
      bump(G, Object.assign({ k: kind, p: pi }, extra || {}));
      finish(G, -1);
      return { ok: true, ended: true };
    }
    nextTurn(G, now);
    bump(G, Object.assign({ k: kind, p: pi }, extra || {}));
    return { ok: true };
  }

  /**
   * Apply one intent from `playerId`. Everything is checked here.
   * actions: {t:'play', ps:[{c,id,s}], v} | {t:'swap', ids:[…]} | {t:'pass'} | {t:'skip'} (host only)
   * now: host clock (turn timer), rng: for reshuffling swapped tiles
   */
  function apply(G, playerId, action, now, rng) {
    if (!action || typeof action !== 'object') return { ok: false, reason: 'malformed' };
    if (G.status !== 'playing') return { ok: false, reason: 'not_playing' };
    if (action.t === 'skip') {
      if (playerId !== G.hostId) return { ok: false, reason: 'host_only' };
      return scoreless(G, G.turn, 'skip', now);
    }
    const pi = idx(G, playerId);
    if (pi < 0) return { ok: false, reason: 'no_player' };
    if (pi !== G.turn) return { ok: false, reason: 'not_your_turn' };
    if (action.v !== undefined && action.v !== G.tn) return { ok: false, reason: 'stale' };
    const p = G.players[pi];
    if (action.t === 'pass') return scoreless(G, pi, 'pass', now);
    if (action.t === 'swap') {
      const ids = Array.isArray(action.ids) ? action.ids : [];
      if (!ids.length || new Set(ids).size !== ids.length || !ids.every(id => p.hand.indexOf(id) >= 0)) return { ok: false, reason: 'not_your_tile' };
      if (G.bag.length < G.rules.swapMin) return { ok: false, reason: 'swap_low' };
      const gone = new Set(ids);
      p.hand = p.hand.filter(id => !gone.has(id));
      refill(G, p);
      G.bag = M.shuffle(G.bag.concat(ids), rng || Math.random);
      return scoreless(G, pi, 'swap', now, { n: ids.length });
    }
    if (action.t === 'play') {
      const ps = action.ps;
      if (!Array.isArray(ps) || !ps.length) return { ok: false, reason: 'no_tiles' };
      if (!ps.every(x => x && p.hand.indexOf(x.id) >= 0)) return { ok: false, reason: 'not_your_tile' };
      const res = M.evaluatePlay(G.board, ps);
      if (!res.ok) return { ok: false, reason: res.reason };
      ps.forEach(x => { G.board[x.c] = [x.id, x.s]; });
      const gone = new Set(ps.map(x => x.id));
      p.hand = p.hand.filter(id => !gone.has(id));
      p.score += res.score;
      refill(G, p);
      G.scoreless = 0;
      G.lastMove = { tn: G.tn, k: 'play', p: pi, sc: res.score, bg: res.bingo ? 1 : 0, cs: ps.map(x => x.c), eq: res.main, ln: res.lines.length };
      const entry = { k: 'play', p: pi, sc: res.score, eq: res.main, bg: res.bingo ? 1 : 0 };
      if (!p.hand.length) { bump(G, entry); finish(G, pi); return { ok: true, ended: true, score: res.score }; }
      nextTurn(G, now);
      bump(G, entry);
      return { ok: true, score: res.score };
    }
    return { ok: false, reason: 'malformed' };
  }

  /** Turn timer: the host calls this; a turn that ran out counts as a pass. */
  function timeout(G, now) {
    if (G.status !== 'playing' || !G.rules.turnSec || !G.turnAt) return null;
    if (now - G.turnAt < G.rules.turnSec * 1000) return null;
    return scoreless(G, G.turn, 'timeout', now);
  }
  function setBotLevel(G, level) {
    if (G.status === 'playing') return { ok: false, reason: 'in_progress' };
    G.rules.botLevel = BOT_LEVELS.indexOf(level) >= 0 ? level : 'normal';
    bump(G);
    return { ok: true };
  }
  function setTurnSec(G, sec) {
    if (G.status === 'playing') return { ok: false, reason: 'in_progress' };
    G.rules.turnSec = TURN_SECS.indexOf(sec) >= 0 ? sec : 0;
    bump(G);
    return { ok: true };
  }

  /** A slice-able search for the bot whose turn it is: {step(ms) → done, action()}. */
  function botSearch(G, opts) {
    const p = G.players[G.turn];
    if (!p || !p.bot || G.status !== 'playing') return null;
    const job = Bot.create(G.board, p.hand, opts);
    const level = (opts && opts.level) || G.rules.botLevel;
    return {
      step: ms => job.step(ms),
      action: () => {
        const b = job.pick(level);
        if (b) return { t: 'play', ps: b.placements, v: G.tn };
        if (G.bag.length >= G.rules.swapMin) return { t: 'swap', ids: Bot.swapPick(p.hand), v: G.tn };
        return { t: 'pass', v: G.tn };
      }
    };
  }
  function botAction(G, opts) {
    const s = botSearch(G, opts);
    if (!s) return null;
    while (!s.step()) { /* run it all */ }
    return s.action();
  }

  /** What every seat may see. Racks are never in here. */
  function publicView(G, online, now) {
    const mv = G.lastMove ? Object.assign({}, G.lastMove) : null;
    if (mv && mv.cs) mv.cs = M.encodeIds(mv.cs.map(c => c));   // cells fit in 2 base-36 chars too
    return {
      g: 'math',
      c: G.code, h: G.hostId, s: G.status, v: G.v, r: G.round, t: G.turn, tn: G.tn, w: G.winner,
      bag: G.bag.length,
      bd: M.encodeBoard(G.board),
      ts: G.rules.turnSec || 0,
      bl: G.rules.botLevel || 'normal',
      tl: G.status === 'playing' && G.rules.turnSec && G.turnAt && now ? Math.max(0, G.rules.turnSec * 1000 - (now - G.turnAt)) : -1,
      mv,
      ps: G.players.map(p => ({ id: p.id, nm: p.name, b: p.bot ? 1 : 0, n: p.hand.length, sc: p.score, wn: p.wins || 0, on: p.bot || !online || online.has(p.id) ? 1 : 0 })),
      lg: G.log.slice(-6),
      res: G.status === 'ended' ? G.result : null
    };
  }

  function decodeCells(s) {
    const out = [];
    if (typeof s !== 'string') return out;
    for (let i = 0; i + 1 < s.length; i += 2) { const c = parseInt(s.slice(i, i + 2), 36); if (c >= 0 && c < M.CELLS) out.push(c); }
    return out;
  }
  function readView(pv) {
    const mv = pv.mv && typeof pv.mv === 'object' ? Object.assign({}, pv.mv, { cs: decodeCells(pv.mv.cs) }) : null;
    return {
      game: 'math',
      code: pv.c, hostId: pv.h, status: pv.s, v: pv.v, round: pv.r, turn: pv.t, tn: pv.tn, winner: pv.w,
      bag: pv.bag, pool: pv.bag, board: M.decodeBoard(pv.bd), timeLeft: typeof pv.tl === 'number' ? pv.tl : -1,
      rules: { turnSec: pv.ts || 0, botLevel: BOT_LEVELS.indexOf(pv.bl) >= 0 ? pv.bl : 'normal' },
      players: (pv.ps || []).map(p => ({ id: p.id, name: cleanName(p.nm), bot: !!p.b, count: p.n, score: p.sc, wins: p.wn || 0, online: !!p.on })),
      log: pv.lg || [], result: pv.res, lastMove: mv
    };
  }

  function handOf(G, id) {
    const p = G.players.find(q => q.id === id);
    return p ? p.hand.slice() : [];
  }

  /** Every tile is somewhere, exactly once. */
  function invariant(G) {
    if (G.status === 'lobby') return true;
    const all = G.bag.slice();
    G.board.forEach(x => { if (x) all.push(x[0]); });
    G.players.forEach(p => all.push.apply(all, p.hand));
    return all.length === M.TILE_COUNT && new Set(all).size === M.TILE_COUNT;
  }

  // network shapes for a move
  function encodeAct(a) {
    if (a.t === 'play') return { t: 'play', ps: M.encodePlaced(a.ps), v: a.v };
    if (a.t === 'swap') return { t: 'swap', ids: M.encodeIds(a.ids), v: a.v };
    return { t: a.t, v: a.v };
  }
  function decodeAct(d) {
    if (!d || typeof d !== 'object') return null;
    const v = typeof d.v === 'number' ? d.v : undefined;
    if (d.t === 'play' && typeof d.ps === 'string') { const ps = M.decodePlaced(d.ps); return ps && ps.length <= M.RACK ? { t: 'play', ps, v } : null; }
    if (d.t === 'swap' && typeof d.ids === 'string' && d.ids.length <= 2 * M.RACK) return { t: 'swap', ids: M.decodeIds(d.ids), v };
    if (d.t === 'pass') return { t: 'pass', v };
    return null;
  }

  const api = {
    DEFAULT_RULES, TURN_SECS, BOT_LEVELS,
    createGame, addPlayer, addBot, removePlayer, start, apply, timeout, setTurnSec, setBotLevel,
    botSearch, botAction, publicView, readView, handOf, invariant, encodeAct, decodeAct, cleanName,
    encodeHand: M.encodeIds, decodeHand: M.decodeIds
  };
  root.RK = root.RK || {};
  root.RK.MathHost = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
