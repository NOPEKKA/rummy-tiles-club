// UI: screens, your board (rack), the shared table, drag and drop, settings.
(function () {
  'use strict';
  const { BoardConfig: BC, Rack, Rules, Host, Net, STR, TableGrid: TG, Prefs, FX, SFX, Skins } = window.RK;

  // ---------- small helpers ----------
  const $ = (sel, el) => (el || document).querySelector(sel);
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style') for (const s in v) { if (s.startsWith('--')) el.style.setProperty(s, v[s]); else el.style[s] = v[s]; }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  /** replaceChildren that skips null/false like h() does */
  function setKids(el) {
    el.replaceChildren();
    for (let i = 1; i < arguments.length; i++) append(el, arguments[i]);
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(x => append(el, x)); return; }
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
    json(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  };
  const storageAdapter = { getItem: k => store.get(k), setItem: (k, v) => { if (!store.set(k, v)) throw new Error('blocked'); } };
  const clone = o => JSON.parse(JSON.stringify(o));
  function rand() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
  const CODE_ABC = 'abcdefghjkmnpqrstuvwxyz23456789';
  const newCode = () => Array.from({ length: 4 }, () => CODE_ABC[Math.floor(rand() * CODE_ABC.length)]).join('');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function waitFor(fn, ms) { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await wait(60); } return fn(); }

  // ---------- state ----------
  const S = {
    lang: store.get('rk.lang') === 'en' ? 'en' : 'th',
    name: (store.get('rk.name') || '').slice(0, 16),
    config: BC.load(storageAdapter),
    screen: 'home', bots: 2, code: '',
    mode: null, G: null, view: null, hand: [], myId: null, hostId: null, meIdx: -1,
    rack: null, rackRound: null, draft: null, draftKey: null, undo: [], sel: null, tnSeen: null,
    zoomUser: 1, settings: null, online: new Set(), pks: new Map(), gotHand: false, hostSeen: true,
    pending: false, endClosed: null, fastBots: false,
    prefs: Prefs.load(storageAdapter),   // tile style, effects, sound, default rule
    // effects bookkeeping
    mvSeen: null, bannerKey: null, pendingMove: null, pendingDrop: null, pendingBanner: false,
    dealing: false, dealt: false, flipFrom: null, endAt: 0
  };

  function t(key, vars) {
    let s = STR[S.lang][key];
    if (s === undefined) s = STR.en[key] !== undefined ? STR.en[key] : key;
    if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (m, k) => vars[k] !== undefined ? vars[k] : m);
    return s;
  }
  function reasonText(res) { return t('r_' + (res.reason || 'malformed'), { min: res.meldMin || (S.view && S.view.meldMin) || 30 }); }

  // ---------- toasts ----------
  function toast(msg, bad) {
    let box = $('.toasts');
    if (!box) { box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
    const el = h('div', { class: 'toast' + (bad ? ' bad' : ''), text: msg });
    box.append(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.remove(), bad ? 3600 : 2400);
  }

  // ---------- tiles ----------
  function tileLabel(id) {
    const tl = Rules.tile(id);
    return tl.joker ? t('joker') : t('colors')[tl.color] + ' ' + tl.n;
  }
  function tileEl(id, cls, src, skin) {
    const tl = Rules.tile(id);
    const sk = skin || S.prefs.skin;
    const el = h('div', {
      class: 'tile sk-' + sk + ' ' + (tl.joker ? 'joker j' + (id - 103) : 'c' + tl.color) + (cls ? ' ' + cls : ''),
      'data-tile': id, role: 'img', 'aria-label': tileLabel(id)
    });
    if (src) el.dataset.src = src.kind;
    if (tl.joker) el.innerHTML = Skins.joker(sk);
    else el.append(h('span', { class: 'n', text: String(tl.n) }));
    if (S.sel && S.sel.id === id) el.classList.add('sel');
    return el;
  }

  // ---------- game queries ----------
  const me = () => (S.view && S.meIdx >= 0 ? S.view.players[S.meIdx] : null);
  function isMyTurn() {
    const v = S.view;
    return !!(v && v.status === 'playing' && S.meIdx >= 0 && v.turn === S.meIdx);
  }
  const engineMode = () => S.mode === 'local' || S.mode === 'host';
  // The table during your turn is a grid (S.draft); sets are read off it.
  function viewGrid() {
    const v = S.view;
    const g = TG.fromSets(v.table, v.layout || []);
    return g.ok ? g.grid : TG.fromSets(v.table, TG.autoPlace([], [], v.table)).grid;
  }
  const gridIds = g => g.flat().filter(id => id !== null);
  function draftFresh() {
    if (!S.draft || !S.view) return new Set();
    const before = new Set([].concat.apply([], S.view.table));
    const hand = new Set(S.hand);
    return new Set(gridIds(S.draft).filter(id => !before.has(id) && hand.has(id)));
  }
  function draftChanged() {
    if (!S.draft) return false;
    const d = TG.toSets(S.draft), g = TG.toSets(viewGrid());
    return TG.encodeBoard(d.table, d.layout) !== TG.encodeBoard(g.table, g.layout);
  }
  function draftStatusNow() {
    const p = me();
    return Rules.draftStatus(S.view.table, TG.toSets(S.draft).table, p ? p.melded : false, S.view.rules);
  }

  // ---------- rack bookkeeping ----------
  function freshRack(hand) {
    const r = Rack.sync(Rack.create(BC.rowLayout(S.config)), hand).rack;
    return Rack.arrange(r, Rules.byColor);
  }
  function saveRack() {
    if (!S.view || !S.rack) return;
    store.set('rk.rack', JSON.stringify({ code: S.view.code, round: S.view.round, rack: S.rack }));
  }
  function loadRack(code, round) {
    const o = store.json('rk.rack');
    if (!o || o.code !== code || o.round !== round) return null;
    return Rack.deserialize(JSON.stringify(o.rack));
  }
  function syncRack(announce) {
    if (S.meIdx < 0) return;
    const onTable = draftFresh();
    const rackHand = S.hand.filter(id => !onTable.has(id));
    const layout = BC.rowLayout(S.config);
    if (!S.rack) S.rack = Rack.create(layout);
    if (Rack.layoutOf(S.rack).join() !== layout.join()) S.rack = Rack.resize(S.rack, layout).rack;
    const r = Rack.sync(S.rack, rackHand);
    S.rack = r.rack;
    if (announce && r.added.length) S.lastDrawn = new Set(r.added.map(a => a.id));
    if (announce && r.added.some(a => a.where === 'overflow')) toast(t('trayNotice'));
    saveRack();
  }

  // Called whenever S.view / S.hand change, in every mode.
  function onState() {
    const v = S.view;
    if (!v) { render(); return; }
    S.meIdx = v.players.findIndex(p => p.id === S.myId);
    const prevGrid = S.curGrid;            // the table as it stood before this update
    S.curGrid = v.status === 'lobby' ? null : viewGrid();
    if (S.meIdx >= 0 && v.status !== 'lobby') {
      if (S.rackRound !== v.code + ':' + v.round || !S.rack) {
        S.rack = loadRack(v.code, v.round) || freshRack(S.hand);
        S.rackRound = v.code + ':' + v.round;
        S.undo = [];
      }
    }
    const turnKey = v.round + ':' + v.tn;
    if (S.tnSeen !== turnKey) { S.undo = []; S.tnSeen = turnKey; S.sel = null; S.pending = false; }
    const mv = v.lastMove;
    const mvKey = mv ? v.code + ':' + v.round + ':' + mv.tn + ':' + mv.k : '';
    if (mvKey !== S.mvSeen) {
      const first = S.mvSeen === null;
      S.mvSeen = mvKey;
      if (mv && mv.k === 'deal') { S.dealing = true; S.dealt = true; }
      else if (mv && !first) {
        S.pendingMove = mv;
        S.moveFromGrid = prevGrid;
        if (mv.win && v.status === 'ended') { S.endAt = Date.now() + 2400; setTimeout(render, 2450); }
      }
    }
    if (isMyTurn() && S.bannerKey !== turnKey) { S.bannerKey = turnKey; S.pendingBanner = true; }
    if (isMyTurn()) {
      if (S.draftKey !== turnKey) { S.draft = viewGrid(); S.draftKey = turnKey; }
    } else { S.draft = null; S.draftKey = null; }
    syncRack(true);
    const screen = v.status === 'lobby' ? 'lobby' : 'game';
    const key = JSON.stringify([v.code, v.v, v.status, v.players.map(p => (p.online ? 1 : 0) + p.name), S.hand, S.meIdx, screen]);
    if (key === S.lastStateKey && S.screen === screen && !S.pendingMove && !S.pendingBanner && !S.dealing) return;
    S.lastStateKey = key;
    S.screen = screen;
    render();
  }

  // ---------- engine (local + host) ----------
  let botTimer = null;
  function enterEngine(mode, G, myId) {
    S.mode = mode; S.G = G; S.myId = myId; S.hostId = G.hostId;
    S.rack = null; S.rackRound = null; S.draft = null; S.draftKey = null; S.tnSeen = null; S.endClosed = null;
    S.mvSeen = null; S.bannerKey = null; S.endAt = 0; S.lastStateKey = null;
    engineChanged();
  }
  function engineChanged() {
    if (!S.G) return;
    S.view = Host.readView(Host.publicView(S.G, S.mode === 'host' ? S.online : null));
    S.hand = Host.handOf(S.G, S.myId);
    if (S.mode === 'local') store.set('rk.local', JSON.stringify(S.G));
    if (S.mode === 'host') { store.set('rk.host.' + S.G.code, JSON.stringify(S.G)); broadcastSoon(); }
    onState();
    scheduleBot();
  }
  function scheduleBot() {
    clearTimeout(botTimer);
    const G = S.G;
    if (!G || G.status !== 'playing' || !G.players[G.turn] || !G.players[G.turn].bot) return;
    botTimer = setTimeout(() => {
      if (S.G !== G || G.status !== 'playing' || !G.players[G.turn].bot) return;
      const pid = G.players[G.turn].id;
      const res = Host.apply(G, pid, Host.botAction(G));
      if (!res.ok) Host.apply(G, pid, { t: 'draw' });
      engineChanged();
    }, S.fastBots ? 20 : 850 + rand() * 600 + FX.busyFor());
  }

  function myName() { return S.name.trim() || (S.lang === 'th' ? 'ผู้เล่น' : 'Player'); }

  function startLocal() {
    const G = Host.createGame({ code: 'solo', hostId: 'me', hostName: myName(), rules: { wrap: S.prefs.wrap } });
    for (let i = 0; i < S.bots; i++) Host.addBot(G);
    Host.start(G, rand);
    enterEngine('local', G, 'me');
  }

  async function act(action) {
    if (engineMode()) {
      const res = Host.apply(S.G, S.myId, action);
      if (!res.ok) { toast(reasonText(res), true); FX.deny([...document.querySelectorAll('.tset.bad')]); return false; }
      engineChanged();
      return true;
    }
    try {
      const data = action.t === 'play' ? { t: 'play', tb: TG.encodeBoard(action.table, action.layout), v: action.v } : { t: action.t };
      await Net.send('act', data);
      S.pending = true; render();
      return true;
    } catch (e) { netError(e); return false; }
  }
  function netError(e) {
    const code = e && e.code;
    toast(code === 'not_permitted' ? t('r_not_permitted') : code === 'taken' ? t('r_taken') : t('r_no_room'), true);
  }

  // ---------- host networking ----------
  let heartbeat = null, bcTimer = null;
  async function hostOnline(resumeG) {
    if (Net.state !== 'on') { toast(t('r_no_room'), true); return; }
    S.screen = 'connecting'; render();
    const myId = await waitFor(() => Net.selfId(), 4000);
    if (!myId) { S.screen = 'home'; render(); toast(t('r_no_room'), true); return; }
    let G = resumeG;
    if (G) {
      // we hold the saved table, so we are its host whatever id this tab has now
      if (G.hostId !== myId) { const p = G.players.find(q => q.id === G.hostId); if (p) p.id = myId; G.hostId = myId; }
    } else {
      let code = newCode();
      while (Net.lobby.some(x => x.code === code)) code = newCode();
      G = Host.createGame({ code, hostId: myId, hostName: myName(), rules: { wrap: S.prefs.wrap } });
    }
    S.online = new Set([myId]);
    S.pks = new Map();
    for (let tries = 0; ; tries++) {
      try {
        await Net.joinTable(G.code, {
          hello: onHello,
          act: onAct,
          peers: ch => {
            S.online = new Set(ch.peers.map(p => Net.senderId(p)));
            S.online.add(S.G ? S.G.hostId : myId);
            if (S.G) engineChanged();
          },
          error: () => toast(t('r_no_room'), true)
        });
        break;
      } catch (e) {
        // Firebase: someone else already owns that code; a new table just takes another one
        if (e && e.code === 'taken' && !resumeG && tries < 4) { G.code = newCode(); continue; }
        S.screen = 'home'; render(); netError(e); return;
      }
    }
    store.set('rk.last', JSON.stringify({ code: G.code, role: 'host' }));
    S.mode = 'host';
    enterEngine('host', G, myId);
    clearInterval(heartbeat);
    heartbeat = setInterval(broadcastSoon, 5000);
  }
  function onHello(msg) {
    if (!S.G || msg.sameTab) return;
    const id = Net.senderId(msg);
    const d = msg.data && typeof msg.data === 'object' ? msg.data : {};
    if (typeof d.pk === 'string' && d.pk.length < 200) S.pks.set(id, d.pk);
    const res = Host.addPlayer(S.G, id, typeof d.nm === 'string' ? d.nm : 'Player');
    if (!res.ok) Net.send('err', { to: id, r: res.reason }).catch(() => {});
    S.online.add(id);
    engineChanged();
  }
  function onAct(msg) {
    if (!S.G || msg.sameTab) return;
    const id = Net.senderId(msg);
    const d = msg.data && typeof msg.data === 'object' ? msg.data : {};
    let action = null;
    if (d.t === 'play' && typeof d.tb === 'string') { const bd = TG.decodeBoard(d.tb); action = { t: 'play', table: bd.table, layout: bd.layout, v: d.v }; }
    else if (d.t === 'draw') action = { t: 'draw' };
    else if (d.t === 'leave') { Host.removePlayer(S.G, id); engineChanged(); return; }
    if (!action) return;
    const res = Host.apply(S.G, id, action);
    if (!res.ok) Net.send('err', { to: id, r: res.reason, mm: S.G.rules.meldMin }).catch(() => {});
    else engineChanged();
  }
  function broadcastSoon() { clearTimeout(bcTimer); bcTimer = setTimeout(broadcast, 50); }
  async function broadcast() {
    if (S.mode !== 'host' || !S.G) return;
    const G = S.G;
    const pv = Host.publicView(G, S.online);
    pv.hk = Net.Crypto.pub;
    pv.hx = {};
    for (const p of G.players) {
      if (p.bot || p.id === G.hostId) continue;
      const pk = S.pks.get(p.id);
      if (!pk) continue;
      const enc = Rules.encodeIds(p.hand);
      try { pv.hx[p.id] = Net.Crypto.ok && pv.hk ? await Net.Crypto.seal(pk, enc) : { pt: enc }; } catch (e) { /* skip this seat until it says hello again */ }
    }
    try { await Net.send('state', pv); } catch (e) { netError(e); }
    Net.announceTable({ code: G.code, host: G.players[0].name, n: G.players.length, st: G.status });
  }

  // ---------- client networking ----------
  let helloTimer = null, stateChain = Promise.resolve(), joinWatch = null;
  async function joinOnline(code) {
    code = String(code || '').trim().toLowerCase();
    if (!/^[a-z0-9]{4}$/.test(code)) { toast(t('r_bad_code'), true); return; }
    if (Net.state !== 'on') { toast(t('r_no_room'), true); return; }
    S.screen = 'connecting'; render();
    const myId = await waitFor(() => Net.selfId(), 4000);
    if (!myId) { S.screen = 'home'; render(); toast(t('r_no_room'), true); return; }
    S.mode = 'client'; S.myId = myId; S.view = null; S.hostId = null; S.code = code; S.gotHand = false;
    S.rack = null; S.rackRound = null; S.tnSeen = null; S.endClosed = null;
    S.mvSeen = null; S.bannerKey = null; S.endAt = 0; S.lastStateKey = null;
    try {
      await Net.joinTable(code, {
        state: msg => { stateChain = stateChain.then(() => handleState(msg)).catch(() => {}); },
        err: msg => {
          const d = msg.data || {};
          if (Net.senderId(msg) === S.hostId && d.to === S.myId) { S.pending = false; toast(reasonText({ reason: d.r, meldMin: d.mm }), true); FX.deny([...document.querySelectorAll('.tset.bad')]); render(); }
          else if (!S.hostId && d.to === S.myId) { toast(reasonText({ reason: d.r }), true); }
        },
        peers: ch => {
          if (!S.hostId) return;
          const seen = ch.peers.some(p => Net.senderId(p) === S.hostId);
          if (seen && !S.hostSeen) sayHello();
          S.hostSeen = seen;
          render();
        }
      });
    } catch (e) { S.screen = 'home'; render(); netError(e); return; }
    sayHello();
    clearInterval(helloTimer);
    helloTimer = setInterval(() => { if (!S.view || (S.meIdx >= 0 && !S.gotHand)) sayHello(); }, 2500);
    clearTimeout(joinWatch);
    joinWatch = setTimeout(() => { if (S.mode === 'client' && !S.view) toast(t('r_no_host'), true); }, 9000);
  }
  function sayHello() {
    Net.send('hello', { nm: myName(), pk: Net.Crypto.pub }).catch(e => netError(e));
  }
  async function handleState(msg) {
    const d = msg.data;
    if (S.mode !== 'client' || !d || typeof d !== 'object') return;
    const sender = Net.senderId(msg);
    if (d.h !== sender) return;                       // only a table's host speaks for it
    if (S.hostId && S.hostId !== sender) return;
    if (S.view && d.v < S.view.v) return;
    S.hostId = sender; S.hostSeen = true;
    let hand = S.hand;
    const box = d.hx && d.hx[S.myId];
    if (box) {
      try { hand = Rules.decodeIds(box.pt !== undefined ? box.pt : await Net.Crypto.open(d.hk, box)); S.gotHand = true; }
      catch (e) { S.gotHand = false; }
    }
    S.view = Host.readView(d);
    S.hand = S.view.players.some(p => p.id === S.myId) ? hand : [];
    if (S.view.players.some(p => p.id === S.myId) && !box) { S.gotHand = false; }
    store.set('rk.last', JSON.stringify({ code: S.view.code, role: 'client', tab: Net.tab }));
    onState();
  }

  async function leaveTable() {
    clearInterval(heartbeat); clearInterval(helloTimer); clearTimeout(botTimer); clearTimeout(joinWatch);
    if (S.mode === 'client' && S.view && S.view.status !== 'playing') Net.send('act', { t: 'leave' }).catch(() => {});
    if (S.mode === 'host') Net.announceTable(null);
    if (S.mode === 'host' || S.mode === 'client') await Net.leaveTable();
    if (S.mode === 'client') store.del('rk.last');
    Object.assign(S, { mode: null, G: null, view: null, hand: [], myId: null, hostId: null, meIdx: -1, rack: null, draft: null, sel: null, screen: 'home', pending: false, lastStateKey: null });
    render();
  }

  // ---------- moves on your own board / the table ----------
  function pushUndo() {
    S.lastDrawn = null;
    S.undo.push({ rack: Rack.clone(S.rack), draft: S.draft ? clone(S.draft) : null });
    if (S.undo.length > 80) S.undo.shift();
  }
  function undo() {
    const u = S.undo.pop();
    if (!u) return;
    S.rack = u.rack;
    if (isMyTurn() && u.draft) S.draft = u.draft;
    syncRack();
    render();
  }
  function resetTurn() {
    if (!isMyTurn()) return;
    pushUndo();
    S.draft = viewGrid();
    syncRack();
    render();
  }
  function groupsBy(mode) {
    const ids = Rack.allTiles(S.rack);
    const jokers = ids.filter(Rules.isJoker);
    const real = ids.filter(id => !Rules.isJoker(id));
    const map = new Map();
    real.forEach(id => {
      const tl = Rules.tile(id);
      const k = mode === 'number' ? tl.n : tl.color;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(id);
    });
    const keys = [...map.keys()].sort((a, b) => a - b);
    const groups = keys.map(k => map.get(k).sort(mode === 'number' ? Rules.byNumber : Rules.byColor));
    if (jokers.length) groups.push(jokers);
    return groups;
  }
  function sortRack(mode) {
    pushUndo();
    S.rack = Rack.arrangeGroups(S.rack, groupsBy(mode));
    saveRack(); render();
  }
  function compactRack() {
    pushUndo();
    const order = Rack.allTiles(S.rack);
    const pos = new Map(order.map((id, i) => [id, i]));
    S.rack = Rack.arrange(S.rack, (a, b) => pos.get(a) - pos.get(b));
    saveRack(); render();
  }

  /** Move tile `id` from `src` to `tgt`. All drag and tap moves end here. */
  function performDrop(id, src, tgt) {
    if (!tgt || !src) return false;
    const fromTable = src.kind === 'table';
    const toTable = tgt.kind === 'tcell';
    if ((fromTable || toTable) && !isMyTurn()) { toast(t('notYourTurn'), true); return false; }
    const fresh = draftFresh();
    if (fromTable && !toTable && !fresh.has(id)) { toast(t('tableStays'), true); return false; }
    let rack = S.rack;
    let draft = S.draft;
    if (toTable) {
      // anywhere on the table: an empty cell takes it, a full one makes room
      const res = TG.place(draft, id, tgt.r, tgt.c);
      if (!res.ok) { toast(t('rowFull'), true); return false; }
      S.pendingDrop = { id, valid: validKeys(S.draft) };
      draft = tidySetAt(res.grid, id);
      if (!fromTable) rack = Rack.remove(rack, id);
    } else if (tgt.kind === 'cell') {
      if (fromTable && rack.rows[tgt.r] && rack.rows[tgt.r][tgt.c] !== null) { toast(t('cellTaken'), true); return false; }
      const res = Rack.moveTo(rack, id, tgt);
      if (!res.ok) { toast(res.reason === 'occupied' ? t('cellTaken') : t('r_malformed'), true); return false; }
      rack = res.rack;
      if (fromTable) draft = TG.remove(draft, id);
    } else if (tgt.kind === 'tray') {
      if (fromTable) draft = TG.remove(draft, id);
      rack = Rack.toOverflow(rack, id);
    } else if (tgt.kind === 'rack') {
      if (!fromTable) return false;
      draft = TG.remove(draft, id);
      const r = Rack.add(rack, id);
      rack = r.rack;
      if (r.where === 'overflow') toast(t('boardFull'));
    } else return false;
    pushUndo();
    S.rack = rack;
    if (draft) S.draft = draft;
    S.sel = null;
    if (!toTable) SFX.place(2);
    saveRack();
    render();
    return true;
  }

  /** Once the tiles around a drop make a legal set, put them in order where they lie. */
  function tidySetAt(grid, id) {
    const at = TG.find(grid, id);
    if (!at) return grid;
    const row = grid[at[0]];
    let a = at[1], b = at[1];
    while (a > 0 && row[a - 1] !== null) a--;
    while (b < row.length - 1 && row[b + 1] !== null) b++;
    const set = row.slice(a, b + 1);
    const res = Rules.analyzeSet(set, S.view.rules);
    if (!res.ok || res.ordered.join() === set.join()) return grid;
    const g = TG.clone(grid);
    res.ordered.forEach((x, k) => { g[at[0]][a + k] = x; });
    return g;
  }

  /** Pack every set on the table in reading order. */
  function tidyTable() {
    if (!isMyTurn()) return;
    const d = TG.toSets(S.draft);
    if (!d.table.length) return;
    pushUndo();
    const width = Math.max(TG.MIN_COLS, TG.dims(S.draft).cols - TG.SPARE_COLS);
    S.draft = TG.fromSets(d.table, TG.tidy(d.table, d.layout, width)).grid;
    render();
  }

  function submitPlay() {
    if (!isMyTurn()) return;
    const d = TG.toSets(S.draft);
    act({ t: 'play', table: d.table, layout: d.layout, v: S.view.tn });
  }
  function drawTile() {
    if (!isMyTurn()) return;
    if (draftChanged()) { S.draft = viewGrid(); syncRack(); }
    act({ t: 'draw' });
  }

  // ---------- board rendering (game + preview) ----------
  function boardMetrics(cfg, availWidth, userZoom, maxHeight) {
    const fit = BC.fitZoom(cfg, availWidth);
    const minZ = BC.LIMITS.minReadableTile / cfg.tileSize;
    const zoom = Math.max(minZ, Math.min(2.2, fit * (userZoom || 1)));
    const content = BC.contentSize(cfg, zoom);
    const frameW = Math.max(120, Math.min(cfg.width || content.width, availWidth));
    let frameH = cfg.height || content.height;
    if (maxHeight) frameH = Math.min(frameH, maxHeight);
    return {
      zoom, tile: cfg.tileSize * zoom, gap: cfg.spacing * zoom, content, frameW: Math.round(frameW), frameH: Math.round(frameH),
      pans: content.width > frameW + 1 || content.height > frameH + 1
    };
  }
  function renderBoard(cfg, rack, o) {
    const m = boardMetrics(cfg, o.availWidth, o.userZoom, o.maxHeight);
    const board = h('div', {
      class: 'board bg-' + cfg.background + (cfg.grid ? ' grid-on' : ''),
      'data-live': o.live ? '1' : null, 'aria-label': o.label || null,
      style: { width: m.frameW + 'px', height: m.frameH + 'px', '--custom': cfg.customColor }
    });
    const scroll = h('div', { class: 'board-scroll' });
    const grid = h('div', { class: 'board-grid', style: { padding: cfg.padding + 'px', gap: m.gap + 'px', '--t': m.tile + 'px', '--g': m.gap + 'px' } });
    const fresh = o.fresh || new Set();
    rack.rows.forEach((row, r) => {
      const rowEl = h('div', { class: 'board-row', style: { gap: m.gap + 'px' } });
      row.forEach((id, c) => {
        const cell = h('div', { class: 'cell', 'data-cell': r + ',' + c });
        if (id !== null) cell.append(tileEl(id, (o.live ? '' : 'static') + (fresh.has(id) ? ' fresh' : ''), o.live ? { kind: 'rack' } : null, o.skin));
        rowEl.append(cell);
      });
      grid.append(rowEl);
    });
    scroll.append(grid);
    board.append(scroll, h('div', { class: 'board-badge', text: o.badge || BC.capacityLabel(cfg) }));
    return { el: board, scroll, metrics: m };
  }

  // ---------- drag and drop ----------
  const Drag = { pending: null, active: null, ghost: null, hover: null, caret: null, dirty: false };
  function sourceOf(el) {
    const k = el.dataset.src;
    if (k === 'table') { const c = el.closest('[data-tc]'); const [r, cc] = c.dataset.tc.split(',').map(Number); return { kind: 'table', r, c: cc }; }
    if (k === 'rack') { const c = el.closest('[data-cell]'); const [r, cc] = c.dataset.cell.split(',').map(Number); return { kind: 'rack', r, c: cc }; }
    if (k === 'tray') return { kind: 'tray' };
    return null;
  }
  /** The table cell under (x, y), or the nearest one when the pointer is in the table's margin. */
  function tableCellAt(x, y, el) {
    const tc = el.closest('[data-tc]');
    if (tc) return tc;
    const g = $('.tgrid');
    if (!g) return null;
    const r = g.getBoundingClientRect(), cols = +g.dataset.cols, rows = +g.dataset.rows;
    const c = Math.max(0, Math.min(cols - 1, Math.floor((x - r.left) / r.width * cols)));
    const rr = Math.max(0, Math.min(rows - 1, Math.floor((y - r.top) / r.height * rows)));
    return g.querySelector('[data-tc="' + rr + ',' + c + '"]');
  }
  function dropTargetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || !el.closest('.game')) return null;
    const live = el.closest('.board[data-live]');
    const cell = el.closest('[data-cell]');
    if (cell && live) { const [r, c] = cell.dataset.cell.split(',').map(Number); return { kind: 'cell', r, c, el: cell }; }
    const tray = el.closest('[data-tray]');
    if (tray) return { kind: 'tray', el: tray };
    if (live) return { kind: 'rack', el: live };
    if (el.closest('[data-table]') && isMyTurn()) {
      const tc = tableCellAt(x, y, el);
      if (tc) { const [r, c] = tc.dataset.tc.split(',').map(Number); return { kind: 'tcell', r, c, el: tc }; }
    }
    return null;
  }
  function clearHover() {
    if (Drag.hover && Drag.hover.el) Drag.hover.el.classList.remove('drop', 'drop-bad', 'drop-insert');
    Drag.hover = null;
  }
  function showHover(tgt) {
    clearHover();
    if (!tgt) return;
    Drag.hover = tgt;
    const bad = tgt.kind === 'cell' && Drag.active && Drag.active.src.kind !== 'rack' && S.rack.rows[tgt.r][tgt.c] !== null;
    // a full table cell means "insert here and push right"
    const insert = tgt.kind === 'tcell' && S.draft[tgt.r][tgt.c] !== null && !(Drag.active && S.draft[tgt.r][tgt.c] === Drag.active.id);
    tgt.el.classList.add(bad ? 'drop-bad' : insert ? 'drop-insert' : 'drop');
  }
  function canPick(src, id) {
    if (!src) return false;
    if (src.kind === 'table') {
      if (!isMyTurn()) return false;
      const p = me();
      if (p && !p.melded && !draftFresh().has(id)) { toast(t('playHintTouch'), true); return false; }
    }
    return true;
  }
  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const el = e.target.closest('.tile[data-src]');
    if (!el && S.sel && !Drag.active && !e.target.closest('button, input, a, label, .settings')) {
      Drag.tap = { x: e.clientX, y: e.clientY, pid: e.pointerId };
      return;
    }
    if (!el || Drag.active) return;
    const id = +el.dataset.tile;
    const src = sourceOf(el);
    if (!canPick(src, id)) return;
    e.preventDefault();
    Drag.pending = { id, src, el, x0: e.clientX, y0: e.clientY, pid: e.pointerId };
  }
  function onPointerMove(e) {
    const p = Drag.pending;
    if (p && !Drag.active && e.pointerId === p.pid) {
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 6) return;
      const r = p.el.getBoundingClientRect();
      const g = p.el.cloneNode(true);
      g.classList.add('drag-ghost'); g.classList.remove('sel', 'fresh', 'fx-pop', 'fx-land', 'fx-steal');
      g.style.setProperty('--tw', r.width + 'px');
      g.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0) translate(-50%,-55%) rotate(-3deg) scale(1.1)';
      Drag.hoverKey = null;
      Drag.pace = FX.pacer();
      document.body.append(g);
      p.el.classList.add('lifting');
      Drag.active = p; Drag.ghost = g; Drag.pending = null; S.sel = null;
      SFX.pick();
    }
    const a = Drag.active;
    if (!a || e.pointerId !== a.pid) return;
    e.preventDefault();
    Drag.x = e.clientX; Drag.y = e.clientY;
    if (!Drag.raf) Drag.raf = requestAnimationFrame(dragFrame);
  }
  function dragFrame(now) {
    Drag.raf = 0;
    if (!Drag.active || !Drag.ghost) return;
    if (!Drag.pace(now)) { Drag.raf = requestAnimationFrame(dragFrame); return; }   // frame cap
    Drag.ghost.style.transform = 'translate3d(' + Drag.x + 'px,' + Drag.y + 'px,0) translate(-50%,-55%) rotate(-3deg) scale(1.1)';
    const tgt = dropTargetAt(Drag.x, Drag.y);
    const k = tgt ? tgt.kind + (tgt.r === undefined ? '' : tgt.r + ',' + tgt.c) : '';
    if (k !== Drag.hoverKey) { Drag.hoverKey = k; showHover(tgt); }
    autoScroll(Drag.x, Drag.y);
  }
  function autoScroll(x, y) {
    const tbl = $('.table');
    if (!tbl) return;
    const r = tbl.getBoundingClientRect();
    if (x < r.left || x > r.right) return;
    if (y > r.top && y < r.top + 40) tbl.scrollTop -= 12;
    else if (y < r.bottom && y > r.bottom - 40) tbl.scrollTop += 12;
  }
  function endDrag(e, cancel) {
    const a = Drag.active, p = Drag.pending, tap = Drag.tap;
    Drag.pending = null; Drag.tap = null;
    if (tap && !cancel && e.pointerId === tap.pid && S.sel && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 8) {
      // tap on an empty spot while a tile is selected: move it there
      const tgt = dropTargetAt(e.clientX, e.clientY);
      if (tgt) performDrop(S.sel.id, S.sel.src, tgt);
      return;
    }
    if (a) {
      const tgt = cancel ? null : dropTargetAt(e.clientX, e.clientY);
      clearHover();
      S.flipFrom = { id: a.id, rect: Drag.ghost.getBoundingClientRect() };
      Drag.ghost.remove(); Drag.ghost = null; Drag.active = null;
      a.el.classList.remove('lifting');
      if (!performDrop(a.id, a.src, tgt) && Drag.dirty) render();
      Drag.dirty = false;
      return;
    }
    if (p && !cancel && e.pointerId === p.pid) {
      // a tap: select, or move the selected tile here
      if (S.sel && S.sel.id !== p.id) {
        const sel = S.sel;
        const tgt = dropTargetAt(e.clientX, e.clientY);
        if (!performDrop(sel.id, sel.src, tgt)) { S.sel = { id: p.id, src: p.src }; render(); }
      } else {
        S.sel = S.sel && S.sel.id === p.id ? null : { id: p.id, src: p.src };
        render();
      }
    }
  }
  document.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', e => endDrag(e, false));
  window.addEventListener('pointercancel', e => endDrag(e, true));

  // ---------- pan & zoom on your board ----------
  function setZoom(z, keepCentre) {
    S.zoomUser = Math.max(0.3, Math.min(3, z));
    mountBoard(keepCentre);
  }
  function wireBoardGestures(scroll) {
    const touches = new Map();
    let pinch = null, pan = null;
    scroll.addEventListener('pointerdown', e => {
      if (e.target.closest('.tile')) return;
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          const [a, b] = [...touches.values()];
          pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: S.zoomUser };
        }
      } else if (e.pointerType === 'mouse' && e.button === 0) {
        pan = { x: e.clientX, y: e.clientY, l: scroll.scrollLeft, t: scroll.scrollTop };
      }
    });
    scroll.addEventListener('pointermove', e => {
      if (pan) { scroll.scrollLeft = pan.l - (e.clientX - pan.x); scroll.scrollTop = pan.t - (e.clientY - pan.y); }
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (Math.abs(d / pinch.d - 1) > 0.06) setZoom(pinch.z * d / pinch.d, true);
      }
    });
    const up = e => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; pan = null; };
    scroll.addEventListener('pointerup', up);
    scroll.addEventListener('pointercancel', up);
    scroll.addEventListener('pointerleave', () => { pan = null; });
    scroll.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(S.zoomUser * (e.deltaY < 0 ? 1.1 : 1 / 1.1), true);
    }, { passive: false });
  }

  let boardRO = null;
  function mountBoard(keepCentre) {
    if (Drag.active) { Drag.dirty = true; return; }
    const slot = $('#board-slot');
    if (!slot || !S.rack) return;
    const dock = slot.closest('.dock');
    const prev = slot.querySelector('.board-scroll');
    const ratio = prev ? { x: (prev.scrollLeft + prev.clientWidth / 2) / Math.max(1, prev.scrollWidth), y: (prev.scrollTop + prev.clientHeight / 2) / Math.max(1, prev.scrollHeight) } : null;
    const avail = Math.max(200, dock.clientWidth - 32);
    const dcs = getComputedStyle(dock);
    S.dockW = Math.round(dock.clientWidth - parseFloat(dcs.paddingLeft) - parseFloat(dcs.paddingRight));
    const placed = Rack.placedCount(S.rack), cap = Rack.capacity(S.rack);
    const b = renderBoard(S.config, S.rack, {
      availWidth: avail, maxHeight: Math.max(150, window.innerHeight * 0.62), userZoom: S.zoomUser, live: true,
      badge: placed + '/' + cap, label: t('boardSettings'), fresh: S.lastDrawn
    });
    slot.replaceChildren(b.el);
    wireBoardGestures(b.scroll);
    if (ratio && keepCentre !== false) {
      b.scroll.scrollLeft = ratio.x * b.scroll.scrollWidth - b.scroll.clientWidth / 2;
      b.scroll.scrollTop = ratio.y * b.scroll.scrollHeight - b.scroll.clientHeight / 2;
    }
    const out = $('#zoom-out');
    if (out) out.textContent = Math.round(b.metrics.zoom * 100) + '%';
  }

  // ---------- motion & effects glue ----------
  function applyPrefs(p) {
    FX.setLevel(p.fx);
    FX.setFps(p.fps);
    FX.meter(p.showFps);
    SFX.setEnabled(p.sound);
    SFX.setVolume(p.volume);
    document.documentElement.dataset.skin = p.skin;
  }
  const KIND = ['silver', 'rose', 'mana', 'gold'];
  const kindOf = id => (Rules.isJoker(id) ? 'rainbow' : KIND[Rules.tile(id).color]);
  function glowOf(id, skin) {
    const g = Skins.GLOW[skin || S.prefs.skin] || Skins.GLOW.ivory;
    return Rules.isJoker(id) ? '#ffe08a' : g[Rules.tile(id).color];
  }
  const tileNode = id => document.querySelector('.game .tile[data-tile="' + id + '"]');
  /** Where a tile comes to rest: its cell, not the tile (which may still be gliding). */
  function restRect(id) {
    const el = tileNode(id);
    if (!el) return null;
    const c = el.closest('.tcell, .cell');
    return (c || el).getBoundingClientRect();
  }
  function unionRect(rects) {
    rects = rects.filter(Boolean);
    if (!rects.length) return null;
    const l = Math.min.apply(null, rects.map(r => r.left)), tp = Math.min.apply(null, rects.map(r => r.top));
    const rr = Math.max.apply(null, rects.map(r => r.right)), b = Math.max.apply(null, rects.map(r => r.bottom));
    return { left: l, top: tp, right: rr, bottom: b, width: rr - l, height: b - tp };
  }
  function chipRect(p) {
    const el = document.querySelector('.pchip[data-p="' + p + '"]');
    return el ? el.getBoundingClientRect() : null;
  }
  function snapTiles() {
    const m = new Map();
    document.querySelectorAll('.game .tile[data-tile]').forEach(el => { const r = el.getBoundingClientRect(); if (r.width) m.set(+el.dataset.tile, r); });
    return m;
  }
  /** The run of touching tiles around `id` on a grid. */
  function setAround(grid, id) {
    const at = TG.find(grid, id);
    if (!at) return null;
    const row = grid[at[0]];
    let a = at[1], b = at[1];
    while (a > 0 && row[a - 1] !== null) a--;
    while (b < row.length - 1 && row[b + 1] !== null) b++;
    return row.slice(a, b + 1);
  }
  function validKeys(grid) {
    const out = new Set();
    if (!grid || !S.view) return out;
    TG.toSets(grid).table.forEach(s => { if (Rules.analyzeSet(s, S.view.rules).ok) out.add(s.join(',')); });
    return out;
  }

  // ---- effect marks: drawn inside the table grid so they stay on their tiles ----
  // A mark survives re-renders: after every render applyMarks() puts it back with a
  // negative animation-delay, so the animation simply carries on.
  const MARK_MS = { 'fx-pop': 620, 'fx-land': 520, 'fx-steal': 1100, 'fx-extend': 1700, 'fx-stolen': 1700, 'fx-new': 1300, 'fx-formed': 1300 };
  const marks = { tiles: new Map(), sets: [] };
  const setKey = ids => ids.slice().sort((a, b) => a - b).join(',');
  function markTile(id, cls, delay) {
    marks.tiles.set(id, { cls, t0: performance.now() + (delay || 0), dur: MARK_MS[cls] || 700 });
    applyMarks();
  }
  function markSet(ids, cls, label, tone, delay) {
    marks.sets.push({ key: setKey(ids), cls, label: label || '', tone: tone || 'gold', t0: performance.now() + (delay || 0), dur: MARK_MS[cls] || 1500 });
    applyMarks();
  }
  function markChip(p) {
    const el = document.querySelector('.pchip[data-p="' + p + '"]');
    if (el && FX.tier() > 0) el.animate([{ scale: '1' }, { scale: '1.08' }, { scale: '1' }], { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
  }
  function applyMarks() {
    const now = performance.now();
    marks.tiles.forEach((m, id) => {
      if (now > m.t0 + m.dur + 50) { marks.tiles.delete(id); return; }
      const el = tileNode(id);
      if (!el || el.dataset.fxm === m.cls + m.t0) return;
      el.classList.remove('fx-pop', 'fx-land', 'fx-steal');
      el.dataset.fxm = m.cls + m.t0;
      el.style.animationDelay = Math.round(m.t0 - now) + 'ms';
      el.classList.add(m.cls);
    });
    marks.sets = marks.sets.filter(m => now <= m.t0 + m.dur + 50);
    const g = $('.tgrid');
    if (!g) return;
    g.querySelectorAll('.tfx').forEach(e => e.remove());
    if (!marks.sets.length || !S.shownGrid) return;
    const sets = TG.toSets(S.shownGrid);
    const at = new Map(sets.table.map((s, i) => [setKey(s), i]));
    marks.sets.forEach(m => {
      const i = at.get(m.key);
      if (i === undefined) return;
      const [r, c] = sets.layout[i];
      g.append(h('div', {
        class: 'tfx ' + m.cls,
        style: { gridRow: String(r + 1), gridColumn: (c + 1) + ' / span ' + sets.table[i].length, animationDelay: Math.round(m.t0 - now) + 'ms', '--acc': FX.TONE[m.tone] || FX.TONE.gold }
      }, m.label ? h('span', { class: 'tfx-chip', text: m.label }) : null));
    });
  }

  /**
   * Tiles slide from where they were to where they are now (FLIP). Tiles new
   * to the screen fly in: drawn and dealt tiles from the pool, another
   * player's tiles from their name chip.
   */
  function animateTiles(before) {
    const deal = S.dealing; S.dealing = false;
    const mv = S.pendingMove;
    const chip = mv && mv.k === 'play' && mv.p !== S.meIdx ? chipRect(mv.p) : null;
    const poolEl = $('.pool');
    const pool = poolEl ? poolEl.getBoundingClientRect() : null;
    const from = S.flipFrom; S.flipFrom = null;
    let n = 0;
    document.querySelectorAll('.game .tile[data-tile]').forEach(el => {
      const id = +el.dataset.tile;
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      let b = deal ? null : before.get(id);
      if (from && from.id === id) b = from.rect;
      if (b) {
        const dx = b.left + b.width / 2 - (r.left + r.width / 2), dy = b.top + b.height / 2 - (r.top + r.height / 2), s = b.width / r.width;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.03) return;
        el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ')' }, { transform: 'none' }],
          { duration: Math.min(560, 200 + Math.hypot(dx, dy) * 0.4), easing: 'cubic-bezier(.2,.85,.25,1.08)' });
        return;
      }
      if (!before.size && !deal) return;   // first paint of this screen
      const inRack = !!el.closest('.board[data-live], [data-tray]');
      const src = inRack ? pool : chip;
      if (src) {
        const dx = src.left + src.width / 2 - (r.left + r.width / 2), dy = src.top + src.height / 2 - (r.top + r.height / 2);
        const delay = (n++) * (deal ? 45 : 70);
        el.animate([
          { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.35) rotate(-14deg)', opacity: 0 },
          { transform: 'translate(' + (dx * 0.35) + 'px,' + (dy * 0.35 - 36) + 'px) scale(1.12) rotate(4deg)', opacity: 1, offset: 0.55 },
          { transform: 'none', opacity: 1 }
        ], { duration: 520, delay, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'backwards' });
        if (deal) setTimeout(() => SFX.deal(n), delay);
        else if (inRack) {
          setTimeout(() => SFX.whoosh(), delay);
          markTile(id, 'fx-land', delay + 420);
          setTimeout(() => { const rr = restRect(id); if (rr) FX.P.sparkle(rr.left + rr.width / 2, rr.top + rr.height / 2, 6, { k: kindOf(id), v0: 30, v1: 110 }); }, delay + 420);
        }
      } else {
        el.animate([{ transform: 'scale(.5)', opacity: 0 }, { transform: 'scale(1.1)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'ease-out' });
      }
    });
  }

  // ---- table zoom ----
  // The table starts zoomed in and eases out as it grows. Within a round it never zooms back in,
  // and the size comes from the table's outer box, so scrollbars or a changing panel can't make it pump.
  function roundKey() { return S.view ? S.view.code + ':' + S.view.round : ''; }
  function zoomState() {
    if (!S.zoom || S.zoom.key !== roundKey()) S.zoom = { key: roundKey(), cols: 0, rows: 0, ts: 0, cap: Infinity };
    return S.zoom;
  }
  /** Grid size that only grows during a round. */
  function stableDims(d) {
    const z = zoomState();
    z.cols = Math.max(z.cols, d.cols);
    z.rows = Math.max(z.rows, d.rows);
    return { cols: z.cols, rows: z.rows };
  }
  function fitTable(animate) {
    const g = $('.tgrid'), tb = $('.table');
    if (!g || !tb) return;
    const z = zoomState();
    const cols = +g.dataset.cols, rows = +g.dataset.rows;
    const byW = (tb.offsetWidth - 32) / cols - 4;
    const byH = (tb.offsetHeight - 34) / rows / 1.42;
    let target = Math.max(30, Math.min(72, byW, byH));
    target = Math.round(Math.min(target, z.cap) * 2) / 2;
    z.cap = target;
    const ease = z.ts && Math.abs(z.ts - target) > 0.4 && animate !== false && FX.tier() > 0;
    g.style.setProperty('--ts', target + 'px');
    // The grid is laid out once at the new size; a scale animation from the old size makes it
    // look like a camera easing out, without re-laying out every cell on every frame.
    if (ease) g.animate([{ scale: String(z.ts / target) }, { scale: '1' }], { duration: 650, easing: 'cubic-bezier(.3,.7,.2,1)' });
    z.ts = target;
  }
  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { const z = zoomState(); z.cap = Infinity; z.ts = 0; fitTable(false); }, 120);
  });

  function fxCtx(mv, before) {
    const v = S.view;
    const added = (v.lastPlay || []).slice();
    const fresh = new Set(added);
    const shown = TG.toSets(viewGrid()).table;
    const extended = shown.filter(s => s.some(id => fresh.has(id)) && s.some(id => !fresh.has(id)));
    const stolen = new Set(mv.st || []);
    const stolenSets = shown.filter(s => s.some(id => stolen.has(id)));
    const freshSets = shown.filter(s => s.every(id => fresh.has(id)));
    const table = () => $('.table');
    return {
      isMe: mv.p === S.meIdx, added, extended, stolenSets, freshSets,
      markTile, markSet, markChip,
      tableRect: () => (table() ? table().getBoundingClientRect() : null),
      gridEl: () => $('.tgrid'),
      tileRect: restRect,
      // where a tile sat before the move: its old cell (also right for your own move, which you built in a draft)
      beforeRect: id => {
        const at = S.moveFromGrid && TG.find(S.moveFromGrid, id);
        const cell = at && document.querySelector('[data-tc="' + at[0] + ',' + at[1] + '"]');
        return cell ? cell.getBoundingClientRect() : (before && before.get(id)) || null;
      },
      setRect: ids => unionRect(ids.map(restRect)),
      kind: kindOf, glow: id => glowOf(id),
      center: () => { const tb = table(); if (!tb) return { x: innerWidth / 2, y: innerHeight / 2 }; const r = tb.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height * 0.42, 240) }; },
      width: () => (table() ? table().clientWidth : innerWidth),
      chip: chipRect,
      pool: () => ($('.pool') ? $('.pool').getBoundingClientRect() : null),
      shakeEl: () => $('.table-wrap'),
      t
    };
  }
  function turnSub() {
    const p = me();
    return p && !p.melded ? t('turnSubMeld', { min: S.view.meldMin }) : t('turnSub');
  }
  function runPendingFx(before) {
    let wait = 0;
    if (S.pendingMove) {
      const mv = S.pendingMove; S.pendingMove = null;
      FX.playMove(mv, fxCtx(mv, before));
      wait = mv.k === 'play' ? (mv.p === S.meIdx ? 650 : 1150) : 380;
    }
    if (S.dealt) { S.dealt = false; wait = Math.max(wait, 900); }
    if (S.pendingDrop) {
      const d = S.pendingDrop; S.pendingDrop = null;
      const rr = restRect(d.id);
      markTile(d.id, 'fx-land');
      if (rr) FX.P.sparkle(rr.left + rr.width / 2, rr.top + rr.height / 2, 6, { k: kindOf(d.id), v0: 30, v1: 110 });
      SFX.place();
      const set = S.draft && setAround(S.draft, d.id);
      if (set && set.length >= 3 && Rules.analyzeSet(set, S.view.rules).ok && !d.valid.has(set.join(','))) {
        FX.note('set', set.length);
        markSet(set, 'fx-formed', '', 'mint', 60);
        SFX.chime(set.length);
      } else FX.note('land');
    }
    if (S.pendingBanner) {
      S.pendingBanner = false;
      setTimeout(() => { if (isMyTurn()) FX.turnBanner(t('turnBanner'), turnSub()); }, Math.max(wait, FX.busyFor()));
    }
  }
  function updateTitle() {
    const mine = S.screen === 'game' && isMyTurn() && S.mode !== 'local';
    const title = mine ? '● ' + t('yourTurn') + ' · Rummy Tiles Club' : 'Rummy Tiles Club';
    if (document.title !== title) document.title = title;
  }

  // ---------- screens ----------
  const root = document.getElementById('app');
  let renderQueued = false;
  function render() {
    if (Drag.active) { Drag.dirty = true; return; }
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(() => { renderQueued = false; renderNow(); }, 0);
  }
  function renderNow() {
    document.documentElement.lang = S.lang;
    const tableScroll = $('.table') ? $('.table').scrollTop : 0;
    const motion = S.screen === 'game' && FX.tier() > 0;
    const before = motion && $('.game') ? snapTiles() : new Map();
    let view;
    if (S.screen === 'game' && S.view) view = renderGame();
    else if (S.screen === 'lobby' || S.screen === 'connecting') view = renderLobby();
    else view = renderHome();
    root.replaceChildren(view);
    if (S.screen === 'game') {
      mountBoard(true);
      const tb = $('.table'); if (tb) tb.scrollTop = tableScroll;
      // rebuild the rack only when the dock really changes width (a rebuild would cancel tile animations)
      if (!boardRO && window.ResizeObserver) boardRO = new ResizeObserver(en => { const w = Math.round(en[0].contentRect.width); if (w !== S.dockW) mountBoard(true); });
      if (boardRO) { boardRO.disconnect(); const d = $('.dock'); if (d) boardRO.observe(d); }
      fitTable();
      if (motion) animateTiles(before);
      applyMarks();
      runPendingFx(before);
    } else { S.pendingMove = null; S.pendingDrop = null; S.pendingBanner = false; }
    if (S.settings) renderSettingsLive();
    updateTitle();
  }

  function langSeg() {
    return h('div', { class: 'seg', role: 'group', 'aria-label': 'Language' },
      ['th', 'en'].map(l => h('button', { type: 'button', 'aria-pressed': S.lang === l ? 'true' : 'false', text: l === 'th' ? 'ไทย' : 'EN', onclick: () => { S.lang = l; store.set('rk.lang', l); render(); if (S.settings) renderSettings(); } })));
  }
  const GEAR = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L15 3.5h-4L10.6 6a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';
  function settingsBtn(small) {
    return h('button', { type: 'button', class: 'btn ' + (small ? 'small' : ''), id: small ? 'open-settings' : 'open-settings-home', onclick: openSettings, html: GEAR + '<span></span>' }, );
  }

  function renderHome() {
    const T = (c, n) => c * 13 + (n - 1);
    const fan = h('div', { class: 'menu-fan', 'aria-hidden': 'true' },
      [T(0, 11), T(2, 1), 104, T(1, 13), T(3, 7)].map((id, i) => {
        const e = tileEl(id, 'static');
        e.style.setProperty('--i', String(i - 2));
        return e;
      }));
    const nameIn = h('input', { class: 'input', id: 'name', maxlength: '16', autocomplete: 'nickname', placeholder: t('namePh'), value: S.name });
    nameIn.addEventListener('input', () => { S.name = nameIn.value.slice(0, 16); store.set('rk.name', S.name); });
    const codeIn = h('input', { class: 'input code', id: 'join-code', maxlength: '4', placeholder: t('codePh'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': t('codePh') });
    codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') joinOnline(codeIn.value); });
    const online = Net.state === 'on';
    const resume = resumeCards();
    const botsSeg = h('div', { class: 'seg', role: 'group', 'aria-label': t('botsCount') },
      [1, 2, 3].map(n => h('button', { type: 'button', 'aria-pressed': S.bots === n ? 'true' : 'false', 'aria-label': t('botsN', { n }), text: String(n), onclick: () => { S.bots = n; render(); } })));
    const settingsB = h('button', { type: 'button', class: 'mbtn ghost', id: 'open-settings-home', onclick: openSettings, html: GEAR + '<span class="mb-t"></span>' });
    settingsB.querySelector('.mb-t').textContent = t('settings');
    const panel = h('section', { class: 'menu-panel', 'aria-label': 'Menu' },
      resume.length ? h('div', { class: 'menu-resume' }, resume) : null,
      h('label', { class: 'field', for: 'name' }, h('span', { text: t('yourName') }), nameIn),
      h('div', { class: 'menu-row' },
        h('button', { type: 'button', class: 'mbtn primary', id: 'start-bots', onclick: startLocal },
          h('span', { class: 'mb-t', text: t('playBots') }), h('span', { class: 'mb-s', text: t('botsN', { n: S.bots }) })),
        botsSeg),
      h('button', { type: 'button', class: 'mbtn', id: 'create-table', disabled: !online, onclick: () => hostOnline(null) },
        h('span', { class: 'mb-t', text: t('createTable') })),
      h('div', { class: 'menu-row' }, codeIn,
        h('button', { type: 'button', class: 'mbtn join', id: 'join-btn', disabled: !online, onclick: () => joinOnline(codeIn.value) }, h('span', { class: 'mb-t', text: t('join') }))),
      settingsB,
      Net.state === 'init' ? h('p', { class: 'note center', text: t('connecting') }) : (!online ? h('p', { class: 'note center', text: t({ 'no-config': 'offNoConfig', 'fb-auth': 'offFbAuth', 'fb-error': 'offFbError' }[Net.reason] || 'onlineOffShort') }) : null));
    let tables = null;
    if (online && Net.lobby.length) {
      tables = h('section', { class: 'menu-tables' }, h('span', { class: 'label', text: t('openTables') }),
        Net.lobby.map(x => h('div', { class: 'table-item' },
          h('span', { class: 'code', text: x.code }),
          h('span', { class: 'meta', text: x.host + ' · ' + x.n + '/4' + (x.st === 'playing' ? ' · ▶' : '') }),
          h('button', { type: 'button', class: 'btn small', text: t('join'), onclick: () => joinOnline(x.code) }))));
    }
    return h('div', { class: 'menu' },
      h('div', { class: 'menu-motes', 'aria-hidden': 'true' }, Array.from({ length: 16 }, (_, i) => h('i', { style: { '--k': String(i) } }))),
      h('div', { class: 'menu-top' }, langSeg()),
      h('header', { class: 'menu-crest' }, fan, h('h1', { class: 'menu-title', html: 'Rummy Tiles<small>Club</small>' })),
      panel, tables);
  }

  function wrapToggle(id, on, set, disabled) {
    const cb = h('input', { type: 'checkbox', id, checked: on, disabled: !!disabled });
    cb.addEventListener('change', () => set(cb.checked));
    return h('label', { class: 'toggle', for: id }, cb, t('wrapRule'));
  }

  function resumeCards() {
    const out = [];
    const local = store.json('rk.local');
    if (local && local.status === 'playing' && Array.isArray(local.players)) {
      out.push(h('div', { class: 'row' },
        h('span', { class: 'grow', text: t('resumeLocal') }),
        h('button', { type: 'button', class: 'btn small primary', text: t('resume'), onclick: () => enterEngine('local', local, 'me') }),
        h('button', { type: 'button', class: 'btn small ghost', text: t('discard'), onclick: () => { store.del('rk.local'); render(); } })));
    }
    const last = store.json('rk.last');
    if (last && /^[a-z0-9]{4}$/.test(last.code || '') && Net.state === 'on') {
      const G = last.role === 'host' ? store.json('rk.host.' + last.code) : null;
      if (last.role === 'client' || (G && G.code === last.code)) {
        out.push(h('div', { class: 'row' },
          h('span', { class: 'grow', text: t(last.role === 'host' ? 'resumeHost' : 'resumeClient', { code: last.code }) }),
          h('button', { type: 'button', class: 'btn small primary', text: t('resume'), onclick: () => { if (last.role === 'host') hostOnline(G); else { Net.adoptTab(last.tab); joinOnline(last.code); } } }),
          h('button', { type: 'button', class: 'btn small ghost', text: t('discard'), onclick: () => { store.del('rk.last'); store.del('rk.host.' + last.code); render(); } })));
      }
    }
    return out;
  }

  function renderLobby() {
    const wrap = h('div', { class: 'lobby' });
    const inner = h('div', { class: 'lobby-inner' });
    const v = S.view;
    if (!v) {
      inner.append(h('div', { class: 'card' }, h('h2', { text: t('connecting') }),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', text: t('leave'), onclick: leaveTable }))));
      wrap.append(inner); return wrap;
    }
    const isHost = S.myId === v.hostId;
    const codeTiles = h('div', { class: 'code-tiles', 'aria-label': t('tableCode') + ' ' + v.code });
    v.code.split('').forEach(ch => codeTiles.append(h('div', { class: 'tile static', text: ch })));
    const copy = h('button', {
      type: 'button', class: 'btn small', text: t('copyCode'), onclick: () => {
        try { navigator.clipboard.writeText(v.code).then(() => toast(t('copied')), () => toast(v.code)); } catch (e) { toast(v.code); }
      }
    });
    const seats = h('div', { class: 'seats' });
    for (let i = 0; i < 4; i++) {
      const p = v.players[i];
      if (!p) { seats.append(h('div', { class: 'seat empty', text: t('emptySeat') })); continue; }
      seats.append(h('div', { class: 'seat' },
        h('span', { class: 'dot' + (p.online ? '' : ' off') }),
        h('span', { class: 'nm', text: p.name }),
        p.id === v.hostId ? h('span', { class: 'chip brass', text: t('host') }) : null,
        p.id === S.myId ? h('span', { class: 'chip', text: t('you') }) : null,
        p.bot ? h('span', { class: 'chip', text: t('bot') }) : null,
        isHost && p.id !== v.hostId ? h('button', { type: 'button', class: 'btn small ghost', text: t('remove'), onclick: () => { Host.removePlayer(S.G, p.id); engineChanged(); } }) : null));
    }
    inner.append(
      h('div', { class: 'brand-row' }, h('h1', { class: 'brand', style: { fontSize: 'clamp(28px,5vw,40px)' }, text: t('lobbyTitle') }), langSeg()),
      h('section', { class: 'card' },
        h('span', { class: 'label', text: t('tableCode') }),
        h('div', { class: 'row' }, codeTiles, copy),
        h('p', { class: 'note', text: t('shareHint') })),
      h('section', { class: 'card' },
        h('div', { class: 'row' }, h('h2', { class: 'grow', text: t('seats', { n: v.players.length }) }),
          isHost ? h('button', { type: 'button', class: 'btn small', id: 'add-bot', disabled: v.players.length >= 4, text: t('addBot'), onclick: () => { Host.addBot(S.G); engineChanged(); } }) : null),
        seats,
        isHost ? wrapToggle('lobby-wrap', v.rules.wrap, on => { Host.setWrap(S.G, on); S.prefs.wrap = on; Prefs.save(storageAdapter, S.prefs); engineChanged(); })
          : h('p', { class: 'note', text: t(v.rules.wrap ? 'wrapOn' : 'wrapOff') }),
        h('div', { class: 'row' },
          isHost ? h('button', { type: 'button', class: 'btn primary', id: 'start-game', disabled: v.players.length < 2, text: t('start'), onclick: () => { const r = Host.start(S.G, rand); if (!r.ok) toast(reasonText(r), true); engineChanged(); } }) : h('p', { class: 'note', text: t('waitHostStart') }),
          isHost && v.players.length < 2 ? h('span', { class: 'note', text: t('needPlayers') }) : null,
          h('span', { class: 'grow' }),
          h('button', { type: 'button', class: 'btn ghost', text: t('leave'), onclick: leaveTable }))));
    wrap.append(inner);
    return wrap;
  }

  function logText(e) {
    const v = S.view;
    const p = v.players[e.p];
    const name = p ? (p.id === S.myId ? t('you') : p.name) : '?';
    if (e.k === 'play' && e.m) return t('log_meld', { name, n: e.n, v: e.m });
    return t('log_' + e.k, { name, n: e.n });
  }

  function renderGame() {
    const v = S.view;
    const pos = S.config.position;
    const game = h('div', { class: 'game' + (pos.startsWith('top') ? ' dock-top' : '') });
    const myTurn = isMyTurn();
    const p = me();

    // top bar
    const players = h('div', { class: 'players' });
    v.players.forEach((q, i) => players.append(h('div', { class: 'pchip' + (i === v.turn && v.status === 'playing' ? ' turn' : '') + (q.id === S.myId ? ' me' : ''), 'data-p': i },
      h('span', { class: 'dot' + (q.online ? '' : ' off') }),
      h('span', { class: 'nm', text: q.name }),
      q.id === S.myId ? h('span', { class: 'chip', text: t('you') }) : null,
      h('span', { class: 'mini', 'aria-hidden': 'true' }),
      h('span', { class: 'ct', text: q.count + (q.melded ? ' ✓' : '') }),
      h('span', { class: 'ct', text: (q.score > 0 ? '+' : '') + q.score }))));
    const sb = settingsBtn(true); sb.querySelector('span').textContent = t('settings');
    game.append(h('header', { class: 'topbar' },
      h('span', { class: 'mark', html: 'Rummy <em>Tiles</em>' }),
      S.mode !== 'local' ? h('span', { class: 'code', text: v.code }) : null,
      players,
      h('span', { class: 'pool', title: t('pool') }, h('span', { class: 'mini', style: { width: '11px', height: '14px', borderRadius: '2px', background: 'var(--ivory)', display: 'inline-block' } }), String(v.pool)),
      sb, langSeg(),
      h('button', { type: 'button', class: 'btn small ghost', text: t('leave'), onclick: leaveTable })));

    // status + table
    const status = h('div', { class: 'status', role: 'status' });
    const curr = v.players[v.turn];
    if (v.status === 'playing') {
      if (myTurn) {
        status.append(h('span', { class: 'turnflag', text: t('yourTurn') }));
        const st = draftStatusNow();
        if (!p.melded) status.append(h('span', { class: 'meld' + (st.meldValue >= v.meldMin ? ' ok' : ''), text: t('meldNeed', { v: st.meldValue, min: v.meldMin }) }));
        else status.append(h('span', { class: 'meld ok', text: t('melded') }));
      } else if (curr) status.append(h('span', { text: t('waitingFor', { name: curr.name }) }));
      const last = v.log[v.log.length - 1];
      if (last) status.append(h('span', { class: 'logline', text: '· ' + logText(last) }));
    }
    if (S.mode === 'client' && !S.hostSeen) status.append(h('span', { class: 'banner', text: t('hostOffline') }));
    if (S.meIdx < 0) status.append(h('span', { class: 'banner', text: t('spectating') }));
    if (S.mode === 'host' && curr && !curr.bot && !curr.online && curr.id !== S.myId && v.status === 'playing') {
      status.append(h('button', { type: 'button', class: 'btn small', text: t('skipTurn', { name: curr.name }), onclick: () => act({ t: 'skip' }) }));
    }
    const tableWrap = h('section', { class: 'table-wrap' }, status, renderTable(myTurn));
    game.append(tableWrap);

    // dock: actions + your board + tray
    if (S.meIdx >= 0) {
      const al = pos.endsWith('left') ? ' al-left' : pos.endsWith('right') ? ' al-right' : '';
      const dock = h('section', { class: 'dock' + al, 'aria-label': t('boardSettings') });
      const fresh = draftFresh();
      const st = myTurn ? draftStatusNow() : null;
      let playOk = false, hint = '';
      if (myTurn) {
        if (!fresh.size) hint = t('playHintNone');
        else if (!st.allOk) { const b = st.sets.find(x => !x.ok); hint = t('playHintBad') + ': ' + t('r_' + b.reason); }
        else if (!p.melded && !st.oldIntact) hint = t('playHintTouch');
        else if (!p.melded && st.meldValue < v.meldMin) hint = t('playHintMeld', { min: v.meldMin });
        else playOk = true;
      }
      const changed = myTurn && draftChanged();
      const zoom = h('span', { class: 'zoom' },
        h('button', { type: 'button', class: 'btn small icon ghost', 'aria-label': t('zoomOut'), text: '−', onclick: () => setZoom(S.zoomUser / 1.15, true) }),
        h('output', { id: 'zoom-out', text: '100%' }),
        h('button', { type: 'button', class: 'btn small icon ghost', 'aria-label': t('zoomIn'), text: '+', onclick: () => setZoom(S.zoomUser * 1.15, true) }),
        h('button', { type: 'button', class: 'btn small ghost', text: t('zoomFit'), onclick: () => setZoom(1, false) }));
      dock.append(h('div', { class: 'actions' },
        h('span', { class: 'agroup' },
        h('button', { type: 'button', class: 'btn small', id: 'undo', disabled: !S.undo.length, text: t('undo'), onclick: undo }),
        h('button', { type: 'button', class: 'btn small', id: 'reset-turn', disabled: !changed, text: t('resetTurn'), onclick: resetTurn }),
        h('button', { type: 'button', class: 'btn small', id: 'tidy-table', disabled: !myTurn || !TG.toSets(S.draft).table.length, text: t('tidyTable'), onclick: tidyTable })),
        h('span', { class: 'agroup' },
        h('button', { type: 'button', class: 'btn small', id: 'sort-777', text: t('sort777'), onclick: () => sortRack('number') }),
        h('button', { type: 'button', class: 'btn small', id: 'sort-789', text: t('sort789'), onclick: () => sortRack('color') }),
        h('button', { type: 'button', class: 'btn small', id: 'compact', text: t('resetLayout'), onclick: compactRack })),
        h('span', { class: 'agroup' }, zoom),
        h('span', { class: 'agroup main' },
        h('button', { type: 'button', class: 'btn', id: 'draw', disabled: !myTurn || S.pending, text: v.pool ? (changed ? t('drawReset') : t('draw')) : t('pass'), onclick: drawTile }),
        h('button', { type: 'button', class: 'btn primary', id: 'play', disabled: !myTurn || !playOk || S.pending, title: hint || null, text: t('play'), onclick: submitPlay }))));
      // one line that is always there, so the panel never changes height between turns
      dock.append(h('p', { class: 'note dock-hint', 'aria-live': 'polite', text: S.pending ? t('sent') : (myTurn && hint && fresh.size ? hint : '') }));
      dock.append(h('div', { id: 'board-slot', style: { maxWidth: '100%' } }));
      const tray = h('div', { class: 'tray', 'data-tray': '1', 'aria-label': t('tray') }, h('span', { class: 'label', text: t('tray') }));
      if (S.rack && S.rack.overflow.length) S.rack.overflow.forEach(id => tray.append(tileEl(id, '', { kind: 'tray' })));
      else tray.append(h('span', { class: 'note', text: t('trayHint') }));
      dock.append(tray);
      game.append(dock);
    }

    if (v.status === 'ended' && S.endClosed !== v.round && Date.now() >= S.endAt) game.append(renderEnd());
    return game;
  }

  function renderTable(myTurn) {
    const v = S.view;
    const grid = myTurn && S.draft ? S.draft : viewGrid();
    S.shownGrid = grid;
    const dims = stableDims(TG.dims(grid));
    const sets = TG.toSets(grid);
    const fresh = myTurn ? draftFresh() : new Set();
    const last = new Set(v.lastPlay);
    const st = myTurn ? draftStatusNow() : null;
    const tbl = h('div', { class: 'table' + (myTurn ? ' can-drop' : ''), 'data-table': '1' });
    const z = zoomState();
    const g = h('div', { class: 'tgrid', 'data-cols': dims.cols, 'data-rows': dims.rows, style: { '--cols': dims.cols, '--rows': dims.rows, '--ts': (z.ts || 40) + 'px' }, role: 'grid', 'aria-label': t('tableLabel', { c: dims.cols, r: dims.rows }) });
    // a frame behind each set: what touches in a row is one set
    sets.table.forEach((s, i) => {
      const [r, c] = sets.layout[i];
      const bad = st && !st.sets[i].ok;
      g.append(h('div', {
        class: 'tset' + (bad ? ' bad' : st ? ' good' : ''), title: bad ? t('r_' + st.sets[i].reason) : null,
        style: { gridRow: String(r + 1), gridColumn: (c + 1) + ' / span ' + s.length }
      }));
    });
    for (let r = 0; r < dims.rows; r++) {
      for (let c = 0; c < dims.cols; c++) {
        const id = grid[r][c];
        const cell = h('div', { class: 'tcell', 'data-tc': r + ',' + c, style: { gridRow: String(r + 1), gridColumn: String(c + 1) } });
        if (id !== null) cell.append(tileEl(id, (fresh.has(id) ? 'fresh' : '') + (!myTurn && last.has(id) ? ' last' : '') + (myTurn ? '' : ' static'), myTurn ? { kind: 'table' } : null));
        g.append(cell);
      }
    }
    tbl.append(g);
    if (!sets.table.length) tbl.append(h('p', { class: 'table-empty', text: t('emptyTable') }));
    return tbl;
  }

  function renderEnd() {
    const v = S.view;
    const w = v.players[v.winner];
    const isHost = engineMode();
    const rows = v.players.map((q, i) => h('tr', { class: i === v.winner ? 'win' : '' },
      h('td', { text: q.name + (q.id === S.myId ? ' (' + t('you') + ')' : '') }),
      h('td', { class: 'num', text: v.result ? String(v.result[i].left) : '' }),
      h('td', { class: 'num ' + (v.result && v.result[i].delta >= 0 ? 'pos' : 'neg'), text: v.result ? (v.result[i].delta > 0 ? '+' : '') + v.result[i].delta : '' }),
      h('td', { class: 'num', text: String(q.score) })));
    return h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'end-title' },
      h('div', { class: 'dialog' },
        h('span', { class: 'label', text: t('roundOver', { r: v.round }) }),
        h('h2', { id: 'end-title', text: w && w.id === S.myId ? t('youWon') : t('winnerIs', { name: w ? w.name : '?' }) }),
        h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'scores' },
          h('thead', null, h('tr', null, h('th', { text: t('colPlayer') }), h('th', { class: 'num', text: t('colLeft') }), h('th', { class: 'num', text: t('colRound') }), h('th', { class: 'num', text: t('colTotal') }))),
          h('tbody', null, rows))),
        h('div', { class: 'row' },
          isHost ? h('button', { type: 'button', class: 'btn primary', id: 'next-round', text: t('nextRound'), onclick: () => { Host.start(S.G, rand); engineChanged(); } }) : h('span', { class: 'note', text: t('waitHost') }),
          h('span', { class: 'grow' }),
          h('button', { type: 'button', class: 'btn ghost', text: t('close'), onclick: () => { S.endClosed = v.round; render(); } }),
          h('button', { type: 'button', class: 'btn ghost', text: t('backHome'), onclick: () => { if (S.mode === 'local') store.del('rk.local'); leaveTable(); } }))));
  }

  // ---------- settings: tile style, effects, sound, rules, and your board ----------
  const DEVICES = { desktop: { w: 1280, h: 800 }, tablet: { w: 820, h: 1180 }, mobile: { w: 390, h: 844 } };
  const SAMPLE = [0, 1, 2, 3, 17, 18, 19, 30, 31, 32, 45, 46, 104, 8];

  function openSettings() {
    const w = window.innerWidth;
    S.settings = {
      draft: clone(S.config), prefs: clone(S.prefs), device: w < 700 ? 'mobile' : w < 1100 ? 'tablet' : 'desktop',
      confirm: null, notice: '', lastW: S.config.width || 960, lastH: S.config.height || 260
    };
    S.settings.clean = BC.sanitize(S.settings.draft).config;
    renderSettings();
    window.addEventListener('resize', renderPreview);
  }
  function closeSettings() {
    S.settings = null;
    const el = $('#settings-root'); if (el) el.replaceChildren();
    window.removeEventListener('resize', renderPreview);
    applyPrefs(S.prefs);            // undo anything a demo switched on
    render();
  }
  function setDraft(field, value, rebuild) {
    const st = S.settings;
    if (field.startsWith('rowCols.')) st.draft.rowCols[+field.split('.')[1]] = value;
    else st.draft[field] = value;
    const san = BC.sanitize(st.draft);
    st.clean = san.config;
    st.capErr = san.errors.some(e => e.code === 'capacity');
    st.confirm = null; st.notice = '';
    if (rebuild) renderSettings(); else renderSettingsLive();
  }
  function setPref(key, value, rebuild) {
    const st = S.settings;
    st.prefs[key] = value;
    st.prefs = Prefs.sanitize(st.prefs);
    st.notice = '';
    if (rebuild) renderSettings(); else renderSettingsLive();
  }
  function prefsDirty() { return JSON.stringify(Prefs.sanitize(S.settings.prefs)) !== JSON.stringify(S.prefs); }

  /** Play a sample of the effects on the preview, with the levels you are trying. */
  function demoFx() {
    const st = S.settings;
    const stage = $('#s-stage');
    if (!st || !stage) return;
    FX.setLevel(st.prefs.fx); SFX.setEnabled(st.prefs.sound); SFX.setVolume(st.prefs.volume);
    const r = stage.getBoundingClientRect();
    const c = { x: r.left + r.width / 2, y: r.top + r.height * 0.42 };
    void c;
    const tiles = [...stage.querySelectorAll('.board .tile')].slice(0, 6);
    tiles.forEach((el, i) => setTimeout(() => {
      const q = el.getBoundingClientRect();
      if (FX.tier() > 0) el.animate([{ scale: '1' }, { scale: '1.12', filter: 'brightness(1.15)' }, { scale: '1' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.3,1)' });
      FX.P.sparkle(q.left + q.width / 2, q.top + q.height / 2, 7, { k: ['gold', 'rose', 'cyan', 'violet'][i % 4], v0: 30, v1: 120, jx: q.width * 0.3 });
      SFX.pluck(i);
    }, i * 70));
    setTimeout(() => {
      FX.card(t('fxCombo', { n: 5 }), t('fxExtendBig') + ' · ' + t('fxStealTag'), 'gold', 'combo', { x: r.left + r.width / 2, y: r.top + 16 });
      SFX.fanfare();
    }, tiles.length * 70 + 120);
    setTimeout(() => { if (S.settings) { FX.setLevel(S.prefs.fx); SFX.setEnabled(S.prefs.sound); SFX.setVolume(S.prefs.volume); } }, 2800);
  }

  /** Frame-rate cap: 30 / 60 / 90 / 120, with what this screen can actually show. */
  function fpsCtl(pr) {
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': t('sFps'), id: 's-fps' },
      Prefs.FPS.map(n => h('button', { type: 'button', 'aria-pressed': pr.fps === n ? 'true' : 'false', text: String(n), onclick: () => setPref('fps', n, true) })));
    const show = h('input', { type: 'checkbox', id: 's-showfps', checked: pr.showFps });
    show.addEventListener('change', () => setPref('showFps', show.checked));
    const hz = S.displayHz;
    return h('div', { class: 'ctl' },
      h('div', { class: 'ctl-head' }, h('span', { class: 'lbl', text: t('sFps') })),
      seg,
      hz ? h('p', { class: 'note' + (pr.fps > hz ? ' warn' : ''), id: 's-fps-note', text: t(pr.fps > hz ? 'sFpsOver' : 'sFpsScreen', { hz }) }) : null,
      h('label', { class: 'toggle', for: 's-showfps' }, show, t('sShowFps')));
  }

  function rangeCtl(o) {
    const cur = o.get();
    const auto = o.auto && cur === 0;
    const range = h('input', { type: 'range', id: o.id + '-r', min: o.min, max: o.max, step: 1, value: auto ? o.autoVal() : cur, disabled: auto || o.disabled, 'aria-label': o.label });
    const num = h('input', { type: 'number', class: 'num', id: o.id, min: o.min, max: o.max, step: 1, value: auto ? '' : cur, disabled: auto || o.disabled, inputmode: 'numeric', 'aria-describedby': o.id + '-err' });
    const err = h('div', { class: 'err', id: o.id + '-err', 'aria-live': 'polite' });
    range.addEventListener('input', () => { num.value = range.value; num.removeAttribute('aria-invalid'); err.textContent = ''; o.set(+range.value); });
    num.addEventListener('input', () => {
      const raw = num.value.trim();
      const n = Number(raw);
      if (raw === '' || !Number.isFinite(n)) { err.textContent = t('sRange', { min: o.min, max: o.max }); num.setAttribute('aria-invalid', 'true'); return; }
      const c = Math.max(o.min, Math.min(o.max, Math.round(n)));
      if (c !== n) { err.textContent = t('sRange', { min: o.min, max: o.max }); num.setAttribute('aria-invalid', 'true'); }
      else { err.textContent = ''; num.removeAttribute('aria-invalid'); }
      range.value = c;
      o.set(c);
    });
    num.addEventListener('change', () => { num.value = o.get() || range.value; num.removeAttribute('aria-invalid'); err.textContent = ''; });
    const head = h('div', { class: 'ctl-head' }, h('label', { for: o.id, text: o.label }));
    if (o.auto) {
      const cb = h('input', { type: 'checkbox', id: o.id + '-auto', checked: auto });
      cb.addEventListener('change', () => { if (cb.checked) { o.remember(); o.set(0, true); } else o.set(o.autoVal(), true); });
      head.append(h('label', { class: 'toggle', for: o.id + '-auto' }, cb, t('sAuto')));
    } else if (o.note) head.append(h('span', { class: 'note', text: o.note }));
    return h('div', { class: 'ctl' }, head, h('div', { class: 'ctl-line' }, range, num, h('span', { class: 'unit', text: o.unit || '' })), err);
  }

  function renderSettings() {
    const host = $('#settings-root');
    const st = S.settings;
    if (!st) return;
    const d = st.draft, c = st.clean, L = BC.LIMITS, pr = st.prefs;
    const controls = h('div', { class: 'controls', id: 'settings-controls' });
    const prevScroll = $('#settings-controls') ? $('#settings-controls').scrollTop : 0;
    const T = (col, n) => col * 13 + (n - 1);

    // tile style
    const skins = h('div', { class: 'skins', role: 'radiogroup', 'aria-label': t('sSkin'), id: 's-skins' },
      Prefs.SKINS.map(sk => h('button', {
        type: 'button', class: 'skin-card', role: 'radio', 'aria-checked': pr.skin === sk ? 'true' : 'false', 'data-skin': sk,
        onclick: () => setPref('skin', sk, true)
      },
      h('span', { class: 'skin-tiles' }, [T(0, 13), T(1, 7), T(2, 9), T(3, 4), 104].map(id => tileEl(id, 'static', null, sk))),
      h('span', { class: 'skin-name', text: t('skin_' + sk) }))));
    controls.append(h('section', { class: 'group' }, h('h3', { text: t('sSkin') }), skins));

    // effects & sound
    const fxSeg = h('div', { class: 'seg', role: 'group', 'aria-label': t('sFx'), id: 's-fx' },
      Prefs.FX_LEVELS.map(l => h('button', { type: 'button', 'aria-pressed': pr.fx === l ? 'true' : 'false', text: t('fx_' + l), onclick: () => setPref('fx', l, true) })));
    const snd = h('input', { type: 'checkbox', id: 's-sound', checked: pr.sound });
    snd.addEventListener('change', () => setPref('sound', snd.checked, true));
    const vol = h('input', { type: 'range', id: 's-vol', min: 0, max: 100, step: 5, value: Math.round(pr.volume * 100), disabled: !pr.sound, 'aria-label': t('sVolume') });
    vol.addEventListener('input', () => setPref('volume', vol.value / 100));
    controls.append(h('section', { class: 'group' }, h('h3', { text: t('sFxSound') }),
      h('div', { class: 'ctl' }, h('div', { class: 'ctl-head' }, h('span', { class: 'lbl', text: t('sFx') })), fxSeg),
      h('div', { class: 'ctl' }, h('label', { class: 'toggle', for: 's-sound' }, snd, t('sSound')), h('div', { class: 'ctl-line' }, vol)),
      fpsCtl(pr),
      h('div', null, h('button', { type: 'button', class: 'btn small', id: 's-demo', text: t('sDemo'), onclick: demoFx }))));

    // rules for tables you open
    const wr = h('input', { type: 'checkbox', id: 's-wrap', checked: pr.wrap });
    wr.addEventListener('change', () => setPref('wrap', wr.checked));
    controls.append(h('section', { class: 'group' }, h('h3', { text: t('sRules') }), h('label', { class: 'toggle', for: 's-wrap' }, wr, t('wrapRule'))));

    // your board (the rack)
    controls.append(h('h3', { class: 'group-head', text: t('sBoardHead') }));
    controls.append(h('section', { class: 'group' }, h('h3', { text: t('sSize') }),
      rangeCtl({ id: 's-width', label: t('sWidth'), min: L.width[0], max: L.width[1], unit: 'px', auto: true, get: () => d.width, autoVal: () => st.lastW, remember: () => { st.lastW = d.width || st.lastW; }, set: (v, rb) => setDraft('width', v, rb) }),
      rangeCtl({ id: 's-height', label: t('sHeight'), min: L.height[0], max: L.height[1], unit: 'px', auto: true, get: () => d.height, autoVal: () => st.lastH, remember: () => { st.lastH = d.height || st.lastH; }, set: (v, rb) => setDraft('height', v, rb) })));

    const rowsSeg = h('div', { class: 'seg', role: 'group', 'aria-label': t('sRows'), id: 's-rows' },
      Array.from({ length: L.maxRows }, (_, i) => i + 1).map(n => h('button', { type: 'button', 'aria-pressed': c.rows === n ? 'true' : 'false', text: String(n), onclick: () => setDraft('rows', n, true) })));
    const adv = h('input', { type: 'checkbox', id: 's-adv', checked: d.advanced });
    adv.addEventListener('change', () => {
      if (adv.checked) d.rowCols = d.rowCols.map((x, i) => i < c.rows ? c.columns : x);
      setDraft('advanced', adv.checked, true);
    });
    const cells = h('section', { class: 'group' }, h('h3', { text: t('sCells') }),
      h('div', { class: 'ctl' }, h('div', { class: 'ctl-head' }, h('span', { class: 'lbl', text: t('sRows') }), h('span', { class: 'note', text: '≤ ' + L.maxRows })), rowsSeg),
      rangeCtl({ id: 's-cols', label: t('sColumns'), min: L.minColumns, max: L.maxColumns, disabled: c.advanced, note: 'max ' + L.maxColumns, get: () => d.columns, set: v => setDraft('columns', v) }),
      h('label', { class: 'toggle', for: 's-adv' }, adv, t('sAdvanced')));
    if (c.advanced) {
      const rc = h('div', { class: 'rowcols' });
      for (let i = 0; i < c.rows; i++) rc.append(rangeCtl({ id: 's-row' + i, label: t('sRowN', { n: i + 1 }), min: L.minColumns, max: L.maxColumns, get: () => d.rowCols[i], set: v => setDraft('rowCols.' + i, v) }));
      cells.append(rc);
    }
    cells.append(h('div', { class: 'capacity', id: 's-capacity' }));
    controls.append(cells);

    controls.append(h('section', { class: 'group' }, h('h3', { text: t('sTile') }),
      rangeCtl({ id: 's-tile', label: t('sTileSize'), min: L.tileSize[0], max: L.tileSize[1], unit: 'px', get: () => d.tileSize, set: v => setDraft('tileSize', v) }),
      rangeCtl({ id: 's-gap', label: t('sSpacing'), min: L.spacing[0], max: L.spacing[1], unit: 'px', get: () => d.spacing, set: v => setDraft('spacing', v) }),
      rangeCtl({ id: 's-pad', label: t('sPadding'), min: L.padding[0], max: L.padding[1], unit: 'px', get: () => d.padding, set: v => setDraft('padding', v) })));

    const posGrid = h('div', { class: 'posgrid', role: 'group', 'aria-label': t('sPosition'), id: 's-pos' },
      BC.POSITIONS.map(p => h('button', { type: 'button', 'data-pos': p, 'aria-pressed': c.position === p ? 'true' : 'false', 'aria-label': t('pos_' + p.replace('-', '_')), title: t('pos_' + p.replace('-', '_')), onclick: () => setDraft('position', p, true) })));
    const sw = h('div', { class: 'swatches', id: 's-bg' });
    BC.BACKGROUNDS.filter(b => b !== 'custom').forEach(b => {
      sw.append(h('button', { type: 'button', class: 'swatch board bg-' + b, 'aria-pressed': c.background === b ? 'true' : 'false', 'aria-label': t('bg_' + b), title: t('bg_' + b), onclick: () => setDraft('background', b, true) }));
    });
    const color = h('input', { type: 'color', id: 's-color', value: c.customColor, 'aria-label': t('bg_custom') });
    color.addEventListener('input', () => { d.customColor = color.value; setDraft('background', 'custom'); sw.querySelectorAll('.swatch').forEach(x => x.setAttribute('aria-pressed', 'false')); });
    sw.append(h('label', { class: 'toggle', for: 's-color' }, color, t('bg_custom')));
    const gridCb = h('input', { type: 'checkbox', id: 's-grid', checked: d.grid });
    gridCb.addEventListener('change', () => setDraft('grid', gridCb.checked));
    controls.append(h('section', { class: 'group' }, h('h3', { text: t('sPlace') }),
      h('div', { class: 'ctl' }, h('span', { class: 'lbl', text: t('sPosition') }), posGrid),
      h('div', { class: 'ctl' }, h('span', { class: 'lbl', text: t('sBackground') }), sw),
      h('label', { class: 'toggle', for: 's-grid' }, gridCb, t('sGrid'))));

    const devSeg = h('div', { class: 'seg', role: 'group', 'aria-label': t('sPreview'), id: 's-device' },
      ['desktop', 'tablet', 'mobile'].map(k => h('button', { type: 'button', 'aria-pressed': st.device === k ? 'true' : 'false', text: t('d' + k[0].toUpperCase() + k.slice(1)), onclick: () => { st.device = k; renderSettings(); } })));
    const preview = h('section', { class: 'preview', 'aria-label': t('sPreview') },
      h('div', { class: 'preview-bar' }, h('span', { class: 'label', text: t('sPreview') }), devSeg),
      h('div', { class: 'stage', id: 's-stage' }),
      h('div', { class: 'preview-foot', id: 's-readout' }));

    const panel = h('div', { class: 'settings', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 's-title' },
      h('header', { class: 'settings-head' }, h('h2', { id: 's-title', text: t('sTitle') }), langSeg(),
        h('button', { type: 'button', class: 'btn small ghost', text: t('sCancel'), onclick: closeSettings })),
      h('div', { class: 'settings-body' }, controls, preview),
      h('footer', { class: 'settings-foot', id: 's-foot' }));
    host.replaceChildren(panel);
    controls.scrollTop = prevScroll;
    renderSettingsLive();
  }

  function settingsHand() {
    return S.rack && S.screen === 'game' ? Rack.allTiles(S.rack) : null;
  }
  function renderSettingsLive() {
    const st = S.settings;
    if (!st || !$('#s-foot')) return;
    const c = st.clean, L = BC.LIMITS;
    const cap = BC.capacity(c);
    const hand = settingsHand();
    const impact = hand ? Rack.resizeImpact(S.rack, BC.rowLayout(c)) : null;
    setKids($('#s-capacity'),
      h('span', { class: 'label', text: t('sCapacity') }),
      h('span', { class: 'big', id: 's-cap-label', text: BC.capacityLabel(c) + ' ' + t('sCellsUnit') }),
      h('div', { class: 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(L.maxCells), 'aria-valuenow': String(cap), 'aria-label': t('sCapacity') }, h('i', { style: { width: (cap / L.maxCells * 100) + '%' } })),
      h('span', { class: 'note', text: t('sMax', { max: L.maxCells }) + ' (' + L.maxColumns + ' × ' + L.maxRows + ')' }),
      st.capErr ? h('span', { class: 'err', text: t('sCapErr', { max: L.maxCells }) }) : null,
      impact ? h('span', { class: 'note' + (impact.toTray ? ' warn' : ''), text: t('sHand', { n: impact.total }) + ' · ' + (impact.overCapacity ? t('sOver', { n: impact.overCapacity }) : t('sFits')) }) : null);
    const cols = $('#s-cols'), colsR = $('#s-cols-r');
    if (cols) { cols.disabled = c.advanced; colsR.disabled = c.advanced; }
    renderPreview();
    const foot = $('#s-foot');
    const dirty = !BC.equal(c, S.config) || prefsDirty();
    const items = [];
    if (st.confirm) {
      items.push(h('div', { class: 'confirm', role: 'alertdialog', 'aria-labelledby': 's-confirm-t' },
        h('strong', { id: 's-confirm-t', text: t('sConfirmTitle') }),
        h('span', { text: t('sConfirmBody', { n: st.confirm.toTray }) }),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn primary small', id: 's-confirm-apply', text: t('sConfirmApply'), onclick: () => applySettings(true) }),
          h('button', { type: 'button', class: 'btn small ghost', text: t('sConfirmBack'), onclick: () => { st.confirm = null; renderSettingsLive(); } }))));
    }
    items.push(h('span', { class: 'grow note', id: 's-dirty', text: st.notice || (dirty ? t('sUnsaved') : '') }));
    items.push(h('button', { type: 'button', class: 'btn ghost', id: 's-cancel', text: t('sCancel'), onclick: closeSettings }));
    items.push(h('button', {
      type: 'button', class: 'btn', id: 's-reset', text: t('sReset'), onclick: () => {
        st.draft = clone(BC.DEFAULTS); st.draft.rowCols = BC.DEFAULTS.rowCols.slice(); st.clean = BC.sanitize(st.draft).config;
        st.prefs = clone(Prefs.DEFAULTS); st.confirm = null;
        renderSettings(); st.notice = t('sResetDone'); renderSettingsLive();
      }
    }));
    items.push(h('button', { type: 'button', class: 'btn primary', id: 's-save', disabled: !!st.confirm, text: t('sSave'), onclick: () => applySettings(false) }));
    setKids(foot, items);
  }

  function previewRack(cfg) {
    const layout = BC.rowLayout(cfg);
    if (S.rack && S.screen === 'game') return Rack.resize(S.rack, layout).rack;
    let r = Rack.create(layout);
    SAMPLE.forEach(id => { r = Rack.add(r, id).rack; });
    return r;
  }
  function renderPreview() {
    const st = S.settings;
    const stage = $('#s-stage');
    if (!st || !stage) return;
    const cfg = st.clean, skin = st.prefs.skin;
    const dev = DEVICES[st.device];
    const rack = previewRack(cfg);
    const b = renderBoard(cfg, rack, { availWidth: dev.w - 32, maxHeight: dev.h * 0.62, userZoom: 1, live: false, skin });
    const top = cfg.position.startsWith('top');
    const al = cfg.position.endsWith('left') ? 'flex-start' : cfg.position.endsWith('right') ? 'flex-end' : 'center';
    const T = (c, n) => c * 13 + (n - 1);
    const fakeTable = h('div', { class: 'fake-table' },
      h('div', { class: 'set' }, [5, 6, 7].map(n => tileEl(T(2, n), 'static', null, skin))),
      h('div', { class: 'set' }, [0, 1, 3].map(c => tileEl(T(c, 11), 'static', null, skin))),
      h('div', { class: 'set' }, [12, 13, 1].map(n => tileEl(T(3, n), 'static', null, skin))));
    const dock = h('div', { class: 'dock', style: { alignItems: al } }, b.el);
    if (rack.overflow.length) {
      const tray = h('div', { class: 'tray' }, h('span', { class: 'label', text: t('tray') }));
      rack.overflow.forEach(id => tray.append(tileEl(id, 'static', null, skin)));
      dock.append(tray);
    }
    const device = h('div', { class: 'device', id: 's-device-frame', style: { width: dev.w + 'px', height: dev.h + 'px', gridTemplateRows: top ? '44px auto 1fr' : '44px 1fr auto' } },
      h('div', { class: 'fake-top' }, h('i', { style: { width: '90px' } }), h('i', { style: { width: '60px' } }), h('i', { style: { width: '60px' } })),
      top ? dock : fakeTable, top ? fakeTable : dock);
    stage.replaceChildren(device);
    const m = b.metrics;
    const read = $('#s-readout');
    if (read) setKids(read,
      h('span', null, h('b', { text: BC.capacityLabel(cfg) }), ' ' + t('sCellsUnit')),
      h('span', { text: t('sZoom', { z: Math.round(m.zoom * 100) }) }),
      h('span', { text: t('sTilePx', { px: Math.round(m.tile) }) }),
      h('span', { text: t('sFrame', { w: m.frameW, h: m.frameH }) }),
      m.pans ? h('span', { class: 'note warn', text: t('sPan', { px: BC.LIMITS.minReadableTile }) }) : null);
    const sw = stage.clientWidth - 24, sh = stage.clientHeight - 24;
    const scale = Math.max(0.05, Math.min(sw / dev.w, sh / dev.h, 1));
    Object.assign(device.style, { left: (stage.clientWidth - dev.w * scale) / 2 + 'px', top: (stage.clientHeight - dev.h * scale) / 2 + 'px', transform: 'scale(' + scale + ')' });
  }

  function applySettings(confirmed) {
    const st = S.settings;
    const cfg = BC.sanitize(st.draft).config;
    if (S.rack && S.screen === 'game') {
      const impact = Rack.resizeImpact(S.rack, BC.rowLayout(cfg));
      if (impact.toTray > 0 && !confirmed) { st.confirm = impact; renderSettingsLive(); const b = $('#s-confirm-apply'); if (b) b.focus(); return; }
      pushUndo();
      S.rack = Rack.resize(S.rack, BC.rowLayout(cfg)).rack;
      saveRack();
    }
    S.config = cfg;
    BC.save(storageAdapter, cfg);
    S.prefs = Prefs.sanitize(st.prefs);
    Prefs.save(storageAdapter, S.prefs);
    S.zoomUser = 1;
    closeSettings();
    toast(t('sSaved'));
  }

  // ---------- keyboard ----------
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (S.settings) { closeSettings(); return; }
      if (S.sel) { S.sel = null; render(); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && S.screen === 'game' && !S.settings && !e.target.closest('input')) { e.preventDefault(); undo(); }
  });

  // ---------- boot ----------
  document.body.append(h('div', { id: 'settings-root' }));
  applyPrefs(S.prefs);
  render();
  // how many frames this screen can show (for the FPS setting)
  FX.measureHz().then(hz => { S.displayHz = hz; if (S.settings) renderSettings(); });
  // The open-tables list and the connection state only show on the menu; mid-game they must not redraw the table.
  Net.init(() => { if (S.screen === 'home' || S.screen === 'connecting') render(); });

  // Handle for automated checks (harmless for players).
  window.RKApp = { S, act, startLocal, performDrop, openSettings, applySettings, setDraft, setPref, renderNow, mountBoard, dropTargetAt, engineChanged, applyPrefs, tileEl };
})();
