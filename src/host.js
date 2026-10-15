// Host engine: the single source of truth for one table.
// The player who opens the table runs this; everyone else sends intents and
// receives the state it decides. Pure apart from the injected rng.
(function (root) {
  'use strict';
  const Rules = (root.RK && root.RK.Rules) || require('./rules.js');
  const TG = (root.RK && root.RK.TableGrid) || require('./tablegrid.js');
  const MoveInfo = (root.RK && root.RK.MoveInfo) || require('./moveinfo.js');

  const NAME_MAX = 16;

  function cleanName(s) {
    return String(s || '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, NAME_MAX) || 'Player';
  }

  function createGame(opts) {
    return {
      code: opts.code,
      hostId: opts.hostId,
      status: 'lobby',
      players: [{ id: opts.hostId, name: cleanName(opts.hostName), bot: false, hand: [], melded: false, score: 0 }],
      pool: [],
      table: [],
      layout: [],            // [row, col] of each table set on the grid
      turn: 0,
      tn: 0,
      v: 1,
      round: 0,
      passStreak: 0,
      winner: -1,
      log: [],
      rules: Object.assign({}, Rules.DEFAULT_RULES, opts.rules || {}),
      lastPlay: [],
      lastMove: null         // what the last turn did, for effects on every screen
    };
  }

  function idx(G, id) { return G.players.findIndex(p => p.id === id); }

  function bump(G, entry) {
    G.v++;
    if (entry) {
      G.log.push(entry);
      if (G.log.length > 8) G.log.splice(0, G.log.length - 8);
    }
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
    // Joining between rounds is fine; the new seat starts on 0 points.
    G.players.push({ id, name: cleanName(name), bot: !!bot, hand: [], melded: false, score: 0 });
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

  function start(G, rng) {
    if (G.status === 'playing') return { ok: false, reason: 'in_progress' };
    if (G.players.length < G.rules.minPlayers) return { ok: false, reason: 'need_players' };
    const deck = Rules.shuffle(Rules.fullDeck(), rng);
    G.players.forEach(p => { p.hand = deck.splice(0, G.rules.handSize); p.melded = false; });
    G.pool = deck;
    G.table = [];
    G.layout = [];
    G.round++;
    G.turn = Math.floor(rng() * G.players.length);
    G.tn = (G.tn || 0) + 1;
    G.passStreak = 0;
    G.winner = -1;
    G.status = 'playing';
    G.lastPlay = [];
    G.lastMove = { tn: G.tn, k: 'deal', p: G.turn };
    G.log = [];
    bump(G, { k: 'start', p: G.turn });
    return { ok: true };
  }

  function nextTurn(G) {
    G.turn = (G.turn + 1) % G.players.length;
    G.tn++;
  }

  function endRound(G, winner) {
    G.status = 'ended';
    G.winner = winner;
    const penalties = G.players.map((p, i) => i === winner ? 0 : Rules.handValue(p.hand));
    const gain = penalties.reduce((a, b) => a + b, 0);
    G.players.forEach((p, i) => { p.score += i === winner ? gain : -penalties[i]; });
    G.result = G.players.map((p, i) => ({ left: Rules.handValue(p.hand), delta: i === winner ? gain : -penalties[i] }));
    bump(G, { k: 'win', p: winner });
  }

  /**
   * Apply one intent from `playerId`. Everything is checked here; a client's
   * own validation is only a hint.
   * actions: {t:'play', table:number[][], layout?:[r,c][], v} | {t:'draw'} | {t:'skip'} (host only)
   * With a layout the sets are re-read from the grid itself, so what touches
   * on the board is what counts as a set.
   */
  function apply(G, playerId, action) {
    if (!action || typeof action !== 'object') return { ok: false, reason: 'malformed' };
    if (G.status !== 'playing') return { ok: false, reason: 'not_playing' };
    const pi = idx(G, playerId);
    if (action.t === 'skip') {
      if (playerId !== G.hostId) return { ok: false, reason: 'host_only' };
      return draw(G, G.turn, 'skip');
    }
    if (pi < 0) return { ok: false, reason: 'no_player' };
    if (pi !== G.turn) return { ok: false, reason: 'not_your_turn' };
    if (action.t === 'draw') return draw(G, pi, 'draw');
    if (action.t === 'play') {
      // v is the turn number the client built its move on
      if (action.v !== undefined && action.v !== G.tn) return { ok: false, reason: 'stale' };
      const p = G.players[pi];
      let table = action.table, layout = null;
      if (action.layout !== undefined) {
        const g = TG.fromSets(table, action.layout);
        if (!g.ok) return { ok: false, reason: 'malformed' };
        const d = TG.toSets(g.grid);
        table = d.table; layout = d.layout;
      }
      const check = Rules.validateTurn(G.table, table, p.hand, p.melded, G.rules);
      if (!check.ok) return check;
      const gone = new Set(check.added);
      p.hand = p.hand.filter(id => !gone.has(id));
      const info = MoveInfo.analyze(G.table, check.table, check.added, G.rules);
      G.lastMove = {
        tn: G.tn, k: 'play', p: pi, n: info.n, ext: info.extended.length, st: info.stolen,
        jk: info.jokerStolen ? 1 : 0, lg: info.longest, wr: info.wrap ? 1 : 0, g4: info.group4 ? 1 : 0,
        m: p.melded ? 0 : check.meldValue, win: p.hand.length ? 0 : 1
      };
      const prevLayout = layoutOf(G);
      G.layout = layout && layout.length === check.table.length ? layout : TG.autoPlace(G.table, prevLayout, check.table);
      G.table = check.table;
      G.lastPlay = check.added;
      const firstMeld = !p.melded;
      p.melded = true;
      G.passStreak = 0;
      if (!p.hand.length) {
        bump(G, { k: 'play', p: pi, n: check.added.length, m: firstMeld ? check.meldValue : 0 });
        endRound(G, pi);
        return { ok: true, ended: true };
      }
      nextTurn(G);
      bump(G, { k: 'play', p: pi, n: check.added.length, m: firstMeld ? check.meldValue : 0 });
      return { ok: true };
    }
    return { ok: false, reason: 'malformed' };
  }

  function draw(G, pi, kind) {
    const p = G.players[pi];
    G.lastPlay = [];
    G.lastMove = { tn: G.tn, k: G.pool.length ? kind : 'pass', p: pi };
    if (G.pool.length) {
      p.hand.push(G.pool.pop());
      G.passStreak = 0;
      nextTurn(G);
      bump(G, { k: kind, p: pi });
      return { ok: true, drew: p.hand[p.hand.length - 1] };
    }
    // Pool is empty: drawing is a pass. A full lap of passes ends the round.
    G.passStreak++;
    if (G.passStreak >= G.players.length) {
      let best = 0;
      G.players.forEach((q, i) => { if (Rules.handValue(q.hand) < Rules.handValue(G.players[best].hand)) best = i; });
      bump(G, { k: 'pass', p: pi });
      endRound(G, best);
      return { ok: true, ended: true };
    }
    nextTurn(G);
    bump(G, { k: 'pass', p: pi });
    return { ok: true };
  }

  /** Saved games from before the grid have no layout: place their sets. */
  function layoutOf(G) {
    if (Array.isArray(G.layout) && G.layout.length === G.table.length) return G.layout;
    G.layout = TG.autoPlace([], [], G.table);
    return G.layout;
  }

  /** Host-only lobby switch for the 13 → 1 wrap-around rule. */
  function setWrap(G, on) {
    if (G.status === 'playing') return { ok: false, reason: 'in_progress' };
    G.rules.wrap = !!on;
    bump(G);
    return { ok: true };
  }

  function botAction(G) {
    const p = G.players[G.turn];
    if (!p || !p.bot || G.status !== 'playing') return null;
    return Rules.botMove(G.table, p.hand, p.melded, G.rules);
  }

  /** What every seat may see. Hands are never in here. */
  function publicView(G, online) {
    return {
      c: G.code,
      h: G.hostId,
      s: G.status,
      v: G.v,
      r: G.round,
      t: G.turn,
      tn: G.tn,
      w: G.winner,
      pool: G.pool.length,
      tb: TG.encodeBoard(G.table, layoutOf(G)),
      lp: Rules.encodeIds(G.lastPlay || []),
      mm: G.rules.meldMin,
      wr: G.rules.wrap === false ? 0 : 1,
      mv: G.lastMove ? Object.assign({}, G.lastMove, { st: Rules.encodeIds(G.lastMove.st || []) }) : null,
      ps: G.players.map(p => ({
        id: p.id, nm: p.name, b: p.bot ? 1 : 0, n: p.hand.length, m: p.melded ? 1 : 0, sc: p.score,
        on: p.bot || !online || online.has(p.id) ? 1 : 0
      })),
      lg: G.log.slice(-6),
      res: G.status === 'ended' ? G.result : null
    };
  }

  /** Decode a publicView back into a friendly shape (used by every client). */
  function readView(pv) {
    const board = TG.decodeBoard(pv.tb);
    return {
      code: pv.c, hostId: pv.h, status: pv.s, v: pv.v, round: pv.r, turn: pv.t, tn: pv.tn, winner: pv.w,
      pool: pv.pool, table: board.table, layout: board.layout, lastPlay: Rules.decodeIds(pv.lp), meldMin: pv.mm,
      rules: { meldMin: pv.mm, wrap: pv.wr !== 0 },
      players: (pv.ps || []).map(p => ({ id: p.id, name: cleanName(p.nm), bot: !!p.b, count: p.n, melded: !!p.m, score: p.sc, online: !!p.on })),
      log: pv.lg || [], result: pv.res,
      lastMove: pv.mv && typeof pv.mv === 'object' ? Object.assign({}, pv.mv, { st: Rules.decodeIds(pv.mv.st || '') }) : null
    };
  }

  function handOf(G, id) {
    const p = G.players.find(q => q.id === id);
    return p ? p.hand.slice() : [];
  }

  /** Sanity check used by tests and by the host before saving. */
  function invariant(G) {
    const all = [].concat.apply([], G.table).concat(G.pool);
    G.players.forEach(p => all.push.apply(all, p.hand));
    if (G.status === 'lobby') return true;
    return all.length === Rules.TILE_COUNT && new Set(all).size === Rules.TILE_COUNT;
  }

  const api = { createGame, addPlayer, addBot, removePlayer, start, apply, botAction, setWrap, layoutOf, publicView, readView, handOf, invariant, cleanName };
  root.RK = root.RK || {};
  root.RK.Host = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
