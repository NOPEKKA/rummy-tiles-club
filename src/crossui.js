// Crossword screen, shared by Math Crossword and Word Crossword: the 15 × 15 board,
// your rack, placing tiles, effects. app.js owns the menu, lobby, settings and the
// network; it hands this module what it needs (A) and calls onState / renderGame /
// afterRender. K is the game: its rules (M), host (MH) and how its tiles look
// (mathui.js and wordui.js build it).
(function (root) {
  'use strict';
  root.RK = root.RK || {};
  root.RK.CrossUI = function (A, K) {
    const M = K.M, MH = K.MH, FX = root.RK.FX, SFX = root.RK.SFX, STR = root.RK.STR;
    const { S, h, t } = A;
    const $ = (sel, el) => (el || document).querySelector(sel);
    // the game's own wording when it has one: in Word Crossword 'mHintOk' reads 'wHintOk', 'r_gap' reads 'wr_gap'
    const own = k => {
      if (K.pre === 'm') return k;
      const o = k[0] === 'm' ? K.pre + k.slice(1) : K.pre + k;
      return STR.en[o] !== undefined ? o : k;
    };
    const T = (k, v) => t(own(k), v);
    const canHover = () => !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches);

    // this screen's own state; S (shared) holds the view, hand, mode and ids
    const U = {
      turnKey: null, draft: [], order: [], orderKey: null, prevHand: null,
      sel: null, swap: null, picker: null, passArm: 0, zoom: 1, cursor: null,
      mvSeen: null, bannerKey: null, pendingMove: null, pendingBanner: false, dealing: false,
      lastCells: new Set(), flyIds: null, flyBoard: null, flyFrom: -1, dragFrom: null,
      deadline: 0, deadlineTn: null, endAt: 0, endClosed: null, scroll: null, ro: null, ticker: null
    };

    const isMyTurn = () => !!(S.view && S.view.status === 'playing' && S.meIdx >= 0 && S.view.turn === S.meIdx);
    const active = () => S.screen === 'game' && S.gameId === K.id && !!S.view && !S.settings;

    // ---------- rack order (kept per game, survives reloads) ----------
    function loadOrder(key) {
      const o = A.store.json(K.store);
      return o && o.k === key && Array.isArray(o.order) ? o.order.filter(Number.isInteger) : null;
    }
    const saveOrder = () => A.store.set(K.store, JSON.stringify({ k: U.orderKey, order: U.order }));
    const draftIds = () => new Set(U.draft.map(p => p.id));
    const rackIds = () => { const d = draftIds(); return U.order.filter(id => !d.has(id)); };

    // ---------- state from the host ----------
    function reset() {
      Object.assign(U, { turnKey: null, draft: [], sel: null, swap: null, picker: null, cursor: null, mvSeen: null, bannerKey: null, pendingMove: null, pendingBanner: false, dealing: false, lastCells: new Set(), flyIds: null, flyBoard: null, prevHand: null, endAt: 0, endClosed: null, deadline: 0, deadlineTn: null, scroll: null });
      stopTicker();
    }

    function onState() {
      const v = S.view;
      if (!v) { A.render(); return; }
      S.meIdx = v.players.findIndex(p => p.id === S.myId);
      const hand = S.hand || [];
      const first = U.mvSeen === null;
      // rack order: keep yours, drop what left, add what came in at the end
      const ok = v.code + ':' + v.round;
      if (U.orderKey !== ok) { U.orderKey = ok; U.order = loadOrder(ok) || []; U.prevHand = null; }
      const inHand = new Set(hand);
      U.order = U.order.filter(id => inHand.has(id));
      hand.forEach(id => { if (U.order.indexOf(id) < 0) U.order.push(id); });
      const prev = U.prevHand ? new Set(U.prevHand) : null;
      const fresh = hand.filter(id => prev && !prev.has(id));
      if (fresh.length && !first) U.flyIds = new Set(fresh);
      U.prevHand = hand.slice();
      saveOrder();

      // a new turn starts with an empty draft; the same turn keeps it (minus anything gone)
      const turnKey = v.code + ':' + v.round + ':' + v.tn;
      if (U.turnKey !== turnKey) { U.turnKey = turnKey; U.draft = []; U.sel = null; U.swap = null; U.picker = null; U.cursor = null; U.passArm = 0; S.pending = false; }
      else U.draft = U.draft.filter(p => inHand.has(p.id) && !v.board[p.c]);

      const mv = v.lastMove;
      const mvKey = mv ? v.code + ':' + v.round + ':' + mv.tn + ':' + mv.k : '';
      if (mvKey !== U.mvSeen) {
        U.mvSeen = mvKey;
        if (mv && mv.k === 'deal') { U.lastCells = new Set(); U.dealing = true; U.flyIds = new Set(hand); }   // a fresh deal always flies in
        else if (mv && mv.k === 'play') U.lastCells = new Set(mv.cs);
        if (mv && mv.k !== 'deal' && !first) {
          U.pendingMove = mv;
          if (mv.k === 'play' && mv.p !== S.meIdx) { U.flyBoard = new Set(mv.cs.map(c => v.board[c] && v.board[c][0])); U.flyFrom = mv.p; }
        }
        if (v.status === 'ended' && !first) { U.endAt = Date.now() + 2400; setTimeout(A.render, 2450); }
      }
      if (isMyTurn() && U.bannerKey !== turnKey) { U.bannerKey = turnKey; U.pendingBanner = true; }

      // turn timer: the host sends what is left; count down locally
      if (v.status === 'playing' && v.rules.turnSec && v.timeLeft >= 0) {
        const dl = Date.now() + v.timeLeft;
        if (U.deadlineTn !== v.tn || Math.abs(dl - U.deadline) > 1500) { U.deadline = dl; U.deadlineTn = v.tn; }
      } else { U.deadline = 0; U.deadlineTn = null; }

      const screen = v.status === 'lobby' ? 'lobby' : 'game';
      const key = JSON.stringify([v.code, v.v, v.status, v.players.map(p => (p.online ? 1 : 0) + p.name), hand, S.meIdx, screen]);
      if (key === S.lastStateKey && S.screen === screen && !U.pendingMove && !U.pendingBanner && !U.dealing) return;
      S.lastStateKey = key;
      S.screen = screen;
      A.render();
    }

    // ---------- your move ----------
    function evalDraft() {
      if (!U.draft.length || !S.view) return null;
      const open = U.draft.filter(p => !p.s);
      if (open.length) return { ok: false, reason: 'need_choice', bad: open.map(p => p.c) };
      return M.evaluatePlay(S.view.board, U.draft);
    }
    function place(id, c, sym) {
      if (!isMyTurn()) { A.toast(t('notYourTurn'), true); return false; }
      if (S.pending) return false;
      if (S.view.board[c]) { A.toast(T('cellTaken'), true); return false; }
      const moving = U.draft.find(p => p.id === id);
      const other = U.draft.find(p => p.c === c);
      if (other && other.id !== id) {
        if (moving) other.c = moving.c;                       // two of your tiles swap places
        else U.draft = U.draft.filter(p => p !== other);      // a rack tile replaces it; that one goes back
      }
      if (moving) moving.c = c;
      else { const f = M.tile(id).face; U.draft.push({ c, id, s: sym || (M.needsChoice(f) ? null : f) }); }
      U.sel = null; U.swap = null;
      const d = U.draft.find(p => p.id === id);
      U.picker = d.s === null ? c : null;
      U.justPlaced = id;
      SFX.place(U.draft.length);
      A.render();
      return true;
    }
    function toRack(id, slot) {
      U.draft = U.draft.filter(p => p.id !== id);
      if (U.picker !== null && !U.draft.some(p => p.c === U.picker)) U.picker = null;
      if (slot !== undefined) moveInRack(id, slot);
      U.sel = null;
      SFX.place(2);
      A.render();
    }
    function moveInRack(id, slot) {
      const d = draftIds();
      const vis = U.order.filter(x => !d.has(x) && x !== id);
      vis.splice(Math.min(slot, vis.length), 0, id);
      U.order = vis.concat(U.order.filter(x => d.has(x) && x !== id));
      saveOrder();
    }
    function recall() { if (!U.draft.length) return; U.draft = []; U.picker = null; U.sel = null; A.render(); }
    function shuffle() {
      const d = draftIds();
      const vis = M.shuffle(U.order.filter(x => !d.has(x)), A.rand);
      U.order = vis.concat(U.order.filter(x => d.has(x)));
      saveOrder(); SFX.whoosh(); A.render();
    }
    function sortRack() {
      const d = draftIds();
      U.order = U.order.filter(x => !d.has(x)).sort(M.byFace).concat(U.order.filter(x => d.has(x)));
      saveOrder(); A.render();
    }
    function play() {
      const ev = evalDraft();
      if (!ev || !ev.ok || S.pending || !isMyTurn()) return;
      U.picker = null; U.cursor = null;
      A.act({ t: 'play', ps: U.draft.map(p => ({ c: p.c, id: p.id, s: p.s })), v: S.view.tn });
    }
    function startSwap() {
      if (!isMyTurn() || S.view.bag < MH.DEFAULT_RULES.swapMin) return;
      U.draft = []; U.picker = null; U.sel = null; U.cursor = null; U.swap = new Set();
      A.render();
    }
    function doSwap() {
      if (!U.swap || !U.swap.size) return;
      const ids = [...U.swap];
      U.swap = null;
      A.act({ t: 'swap', ids, v: S.view.tn });
    }
    function pass() {
      if (!isMyTurn() || S.pending) return;
      if (Date.now() - U.passArm > 3000) { U.passArm = Date.now(); A.render(); setTimeout(() => { if (U.passArm && Date.now() - U.passArm >= 3000) { U.passArm = 0; A.render(); } }, 3050); return; }
      U.passArm = 0;
      U.draft = [];
      A.act({ t: 'pass', v: S.view.tn });
    }
    /** The host said no: shake the line that's wrong. */
    function deny() {
      const ev = evalDraft();
      const els = ev && ev.bad ? ev.bad.map(c => $('[data-mc="' + c + '"]')) : [...document.querySelectorAll('.mtile.draft')];
      FX.deny(els);
    }

    // ---------- typing (Word Crossword on a keyboard) ----------
    // Click an empty square for a cursor (click again to turn it), type letters, Backspace takes one back.
    function inLine(c, d, k) {
      const [r, col] = M.rc(c);
      const r2 = d ? r + k : r, c2 = d ? col : col + k;
      return r2 >= 0 && r2 < M.SIZE && c2 >= 0 && c2 < M.SIZE ? M.at(r2, c2) : -1;
    }
    /** From c, the first square along d without a board tile (c itself counts), or −1 off the edge. */
    function freeFrom(c, d, dirSign) {
      while (c >= 0 && S.view.board[c]) c = inLine(c, d, dirSign);
      return c;
    }
    function setCursor(c) {
      if (U.cursor && U.cursor.c === c) U.cursor = { c, d: 1 - U.cursor.d };
      else U.cursor = { c, d: U.cursor ? U.cursor.d : 0 };
      U.sel = null; U.picker = null;
      A.render();
    }
    function typeLetter(ch) {
      if (S.pending) return;
      const cur = U.cursor;
      const c = freeFrom(cur.c, cur.d, 1);
      if (c < 0) return;
      const under = U.draft.find(p => p.c === c);
      if (under && cur.end) return;                          // the line is full
      const nxt = inLine(c, cur.d, 1), nf = nxt >= 0 ? freeFrom(nxt, cur.d, 1) : -1;
      const advance = () => { U.cursor = nf >= 0 ? { c: nf, d: cur.d } : { c, d: cur.d, end: true }; };
      if (under && under.s === ch) { advance(); A.render(); return; }   // typing over the same letter just moves on
      const ids = rackIds();
      let id = ids.find(x => M.tile(x).face === ch), sym;
      if (id === undefined) { id = ids.find(x => M.needsChoice(M.tile(x).face)); sym = ch; }
      if (id === undefined) { A.toast(T('mNoTile', { s: ch }), true); return; }
      if (under) U.draft = U.draft.filter(p => p !== under);   // the one typed over goes back to the rack
      advance();
      place(id, c, sym);
    }
    function typeBack() {
      const cur = U.cursor;
      // the tile just before the cursor (skipping board tiles); at the end of a line, the one under it
      let c;
      if (cur.end && U.draft.some(p => p.c === cur.c)) c = cur.c;
      else { c = inLine(cur.c, cur.d, -1); while (c >= 0 && S.view.board[c]) c = inLine(c, cur.d, -1); }
      const d = c >= 0 ? U.draft.find(p => p.c === c) : null;
      if (!d) { if (U.draft.length) toRack(U.draft[U.draft.length - 1].id); return; }
      U.cursor = { c, d: cur.d };
      toRack(d.id);
    }
    function moveCursor(dr, dc) {
      const cur = U.cursor;
      const d = dr ? 1 : 0;
      const [r, c] = M.rc(cur.c);
      const r2 = Math.max(0, Math.min(M.SIZE - 1, r + dr)), c2 = Math.max(0, Math.min(M.SIZE - 1, c + dc));
      U.cursor = { c: cur.d === d ? M.at(r2, c2) : cur.c, d };
      A.render();
    }

    // ---------- drawing ----------
    function tileEl(id, sym, cls, src) {
      const tl = M.tile(id), look = K.tile(id, sym);
      const el = h('div', {
        class: 'mtile ' + look.cls + (look.text.length >= 3 ? ' w3' : look.text.length === 2 ? ' w2' : '') + (cls ? ' ' + cls : ''),
        'data-mt': id, role: 'img', 'aria-label': look.label
      }, h('span', { class: 'mt-s', text: look.text }), tl.pts ? h('span', { class: 'mt-p', text: String(tl.pts) }) : null);
      if (src) el.dataset.src = src;
      return el;
    }

    function renderBoard() {
      const v = S.view, my = isMyTurn();
      const draftAt = new Map(U.draft.map(p => [p.c, p]));
      const ev = my ? evalDraft() : null;
      const bad = new Set(ev && !ev.ok && ev.bad ? ev.bad : []);
      const good = new Set();
      if (ev && ev.ok) ev.lines.forEach(L => L.cells.forEach(c => good.add(c)));
      const cur = my && U.cursor ? U.cursor : null;
      const g = h('div', { class: 'mboard' + (my ? ' mine' : '') + (U.sel || (K.typing && canHover()) ? ' placing' : '') + (U.cs >= 38 ? ' roomy' : ''), role: 'grid', 'aria-label': T('mBoard'), style: U.cs ? { '--cs': U.cs + 'px' } : null });
      const empty = M.isEmpty(v.board);
      for (let c = 0; c < M.CELLS; c++) {
        const pr = M.premium(c), pk = pr ? K.PREM[pr] : null;
        const b = v.board[c], d = draftAt.get(c);
        const cell = h('div', {
          class: 'mcell' + (pk ? ' ' + pk[0] : '') + (bad.has(c) ? ' bad' : good.has(c) ? ' good' : '') + (pr === '*' && empty ? ' start' : '') + (cur && cur.c === c ? ' cursor' : ''),
          'data-mc': c, role: 'gridcell'
        });
        if (b) cell.append(tileEl(b[0], b[1], 'onb' + (U.lastCells.has(c) ? ' last' : '')));
        else if (d) cell.append(tileEl(d.id, d.s, 'draft' + (d.s ? '' : ' open') + (U.picker === c ? ' picking' : ''), 'draft'));
        else if (pr === '*') cell.append(h('span', { class: 'pl star', 'aria-hidden': 'true', text: '★' }));
        else if (pk) cell.append(h('span', { class: 'pl', 'aria-hidden': 'true' }, h('b', { text: '×' + pk[1] }), h('small', { text: pk[2] ? T('mEq') : T('mTileShort') })));
        if (cur && cur.c === c) cell.append(h('span', { class: 'mcur d' + cur.d, 'aria-hidden': 'true', text: cur.d ? '↓' : '→' }));
        g.append(cell);
      }
      return g;
    }

    function renderRack() {
      const ids = rackIds();
      const rack = h('div', { class: 'mrack' + (U.swap ? ' swapping' : ''), 'data-rack': '1', 'aria-label': T('mRack'), style: { '--slots': String(M.RACK) } });
      for (let i = 0; i < M.RACK; i++) {
        const id = ids[i];
        const slot = h('div', { class: 'mslot', 'data-ms': i });
        if (id !== undefined) slot.append(tileEl(id, null, (U.sel && U.sel.id === id ? 'sel' : '') + (U.swap && U.swap.has(id) ? ' swapsel' : ''), 'rack'));
        rack.append(slot);
      }
      return rack;
    }

    function logText(e) {
      const v = S.view;
      const p = v.players[e.p];
      const name = p ? (p.id === S.myId ? t('you') : p.name) : '';
      if (e.k === 'play') return T(e.bg ? 'mlog_bingo' : 'mlog_play', { name, eq: e.eq || '', n: e.sc });
      return T('mlog_' + e.k, { name, n: e.n || 0 });
    }

    function timerText(ms) {
      const s = Math.max(0, Math.ceil(ms / 1000));
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function statusLine() {
      const v = S.view, my = isMyTurn(), cur = v.players[v.turn];
      const st = h('div', { class: 'mstatus', role: 'status' });
      if (v.status === 'playing') {
        if (U.deadline) st.append(h('span', { class: 'mtimer', 'data-timer': '1', text: timerText(U.deadline - Date.now()) }));
        if (my) {
          st.append(h('span', { class: 'turnflag', text: t('yourTurn') }));
          const ev = evalDraft();
          let hint = '', cls = '';
          if (K.ready && !K.ready()) hint = T('mLoading');
          else if (U.swap) hint = T('mSwapHint');
          else if (!ev) hint = M.isEmpty(v.board) ? T('mHintFirst') : U.cursor ? T('mHintType') : T('mHintEmpty');
          else if (ev.ok) { hint = T('mHintOk', { eq: ev.main, n: ev.score }) + (ev.lines.length > 1 ? ' · ' + T('mOkLines', { n: ev.lines.length }) : '') + (ev.bingo ? ' · BINGO' : ''); cls = ' ok'; }
          else if (ev.reason === 'need_choice') hint = T('mHintChoice');
          else {
            hint = (ev.text ? ev.text + ' — ' : '') + T('r_' + ev.reason) + (ev.reason === 'eq_false' && ev.values ? ' (' + ev.values.join(' ≠ ') + ')' : '');
            cls = ' bad';
          }
          st.append(h('span', { class: 'mcheck' + cls, id: 'm-check', text: hint }));
        } else if (cur) {
          st.append(h('span', { text: cur.bot ? T('mThinking', { name: cur.name }) : t('waitingFor', { name: cur.name }) }));
          const last = v.log[v.log.length - 1];
          if (last) st.append(h('span', { class: 'logline', text: '· ' + logText(last) }));
        }
      }
      if (S.mode === 'client' && !S.hostSeen) st.append(h('span', { class: 'banner', text: t('hostOffline') }));
      if (S.meIdx < 0) st.append(h('span', { class: 'banner', text: t('spectating') }));
      if (S.mode === 'host' && cur && !cur.bot && !cur.online && cur.id !== S.myId && v.status === 'playing') {
        st.append(h('button', { type: 'button', class: 'btn small', text: t('skipTurn', { name: cur.name }), onclick: () => A.act({ t: 'skip' }) }));
      }
      return st;
    }

    function renderSide() {
      const v = S.view;
      const log = h('ol', { class: 'mlog', 'aria-label': T('mLog') }, v.log.slice().reverse().map(e => h('li', { class: e.bg ? 'bingo' : '', text: logText(e) })));
      const legend = h('div', { class: 'mlegend' },
        [['pe3', 'mLegE3'], ['pe2', 'mLegE2'], ['pt3', 'mLegT3'], ['pt2', 'mLegT2']].map(([c, k]) => h('span', { class: 'lg' }, h('i', { class: c }), T(k))));
      const rules = h('ul', { class: 'mrules' }, ['mRule1', 'mRule2', 'mRule3', 'mRule4'].map(k => h('li', { text: T(k) })));
      return h('aside', { class: 'mside' },
        h('section', { class: 'mcard' }, h('span', { class: 'label', text: T('mLog') }), v.log.length ? log : h('p', { class: 'note', text: '—' })),
        h('section', { class: 'mcard' }, h('span', { class: 'label', text: T('mLegend') }), legend, rules));
    }

    function renderDock() {
      const v = S.view, my = isMyTurn();
      const ev = my ? evalDraft() : null;
      const canPlay = !!(ev && ev.ok) && !S.pending;
      const bagLow = v.bag < MH.DEFAULT_RULES.swapMin;
      let actions;
      if (U.swap) {
        actions = h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', id: 'm-swap-cancel', text: T('mSwapCancel'), onclick: () => { U.swap = null; A.render(); } }),
          h('button', { type: 'button', class: 'btn primary', id: 'm-swap-go', disabled: !U.swap.size, text: T('mSwapGo', { n: U.swap.size }), onclick: doSwap }));
      } else {
        const armed = U.passArm && Date.now() - U.passArm < 3000;
        actions = h('div', { class: 'actions' },
          h('span', { class: 'agroup' },
            h('button', { type: 'button', class: 'btn small', id: 'm-recall', disabled: !U.draft.length, text: T('mRecall'), onclick: recall }),
            h('button', { type: 'button', class: 'btn small', id: 'm-shuffle', text: T('mShuffle'), onclick: shuffle }),
            h('button', { type: 'button', class: 'btn small', id: 'm-sort', text: T('mSort'), onclick: sortRack })),
          h('span', { class: 'agroup main' },
            h('button', { type: 'button', class: 'btn', id: 'm-swap', disabled: !my || S.pending || bagLow, title: bagLow ? T('r_swap_low') : null, text: T('mSwap'), onclick: startSwap }),
            h('button', { type: 'button', class: 'btn' + (armed ? ' armed' : ''), id: 'm-pass', disabled: !my || S.pending, text: armed ? T('mPassArm') : T('mPass'), onclick: pass }),
            h('button', { type: 'button', class: 'btn primary', id: 'm-play', disabled: !my || !canPlay, text: canPlay ? T('mPlayPts', { n: ev.score }) : T('mPlay'), onclick: play })));
      }
      return h('section', { class: 'mdock', 'aria-label': T('mRack') }, renderRack(), actions,
        h('p', { class: 'note dock-hint', 'aria-live': 'polite', text: S.pending ? t('sent') : '' }));
    }

    function renderPicker() {
      const d = U.draft.find(p => p.c === U.picker);
      if (!d) { U.picker = null; return null; }
      const f = M.tile(d.id).face, blank = f === '?';
      return h('div', { class: 'mpicker' + (blank ? ' blank' : ''), role: 'dialog', 'aria-label': T(blank ? 'mPickBlank' : 'mPickDual') },
        h('div', { class: 'mp-head' }, h('span', { text: T(blank ? 'mPickBlank' : 'mPickDual') }),
          h('button', { type: 'button', class: 'btn small ghost', id: 'm-pick-back', text: T('mBackToRack'), onclick: () => toRack(d.id) })),
        h('div', { class: 'mp-grid' }, M.options(f).map(s => h('button', {
          type: 'button', class: 'mp-opt' + (d.s === s ? ' on' : '') + K.optCls(s), 'data-sym': s, text: K.show(s),
          onclick: () => { d.s = s; U.picker = null; SFX.pluck(3); A.render(); }
        }))));
    }

    function renderEnd() {
      const v = S.view;
      const w = v.players[v.winner];
      const rows = v.players.map((q, i) => h('tr', { class: i === v.winner ? 'win' : '' },
        h('td', { text: q.name + (q.id === S.myId ? ' (' + t('you') + ')' : '') }),
        h('td', { class: 'num', text: v.result ? String(v.result[i].left) : '' }),
        h('td', { class: 'num ' + (v.result && v.result[i].delta >= 0 ? 'pos' : 'neg'), text: v.result ? (v.result[i].delta > 0 ? '+' : '') + v.result[i].delta : '' }),
        h('td', { class: 'num', text: String(q.score) }),
        h('td', { class: 'num', text: String(q.wins) })));
      const host = A.engineMode();
      return h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'end-title' },
        h('div', { class: 'dialog' },
          h('span', { class: 'label', text: T('mGameOver', { r: v.round }) }),
          h('h2', { id: 'end-title', text: v.winner < 0 ? T('mDraw') : w && w.id === S.myId ? T('mYouWon') : t('winnerIs', { name: w ? w.name : '?' }) }),
          h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'scores' },
            h('thead', null, h('tr', null, h('th', { text: t('colPlayer') }), h('th', { class: 'num', text: T('mColLeft') }), h('th', { class: 'num', text: T('mColAdj') }), h('th', { class: 'num', text: T('mColScore') }), h('th', { class: 'num', text: T('mColWins') }))),
            h('tbody', null, rows))),
          h('div', { class: 'row' },
            host ? h('button', { type: 'button', class: 'btn primary', id: 'm-rematch', text: T('mRematch'), onclick: () => { MH.start(S.G, A.rand, Date.now()); A.engineChanged(); } }) : h('span', { class: 'note', text: t('waitHost') }),
            h('span', { class: 'grow' }),
            h('button', { type: 'button', class: 'btn ghost', text: t('close'), onclick: () => { U.endClosed = v.round; A.render(); } }),
            h('button', { type: 'button', class: 'btn ghost', text: t('backHome'), onclick: () => { if (S.mode === 'local') A.store.del('rk.local'); A.leaveTable(); } }))));
    }

    function renderGame() {
      const v = S.view;
      const wrap = $('.mboard-wrap');
      if (wrap) U.scroll = { l: wrap.scrollLeft, t: wrap.scrollTop };
      const game = h('div', { class: 'mgame game-' + K.id });
      const players = h('div', { class: 'players' });
      v.players.forEach((q, i) => players.append(h('div', { class: 'pchip' + (i === v.turn && v.status === 'playing' ? ' turn' : '') + (q.id === S.myId ? ' me' : ''), 'data-p': i },
        h('span', { class: 'dot' + (q.online ? '' : ' off') }),
        h('span', { class: 'nm', text: q.name }),
        q.id === S.myId ? h('span', { class: 'chip', text: t('you') }) : null,
        h('span', { class: 'ct score', text: String(q.score) }),
        q.wins ? h('span', { class: 'ct wins', title: T('mWins', { n: q.wins }), text: '★' + q.wins }) : null)));
      const sb = A.settingsBtn(true); sb.querySelector('span').textContent = t('settings');
      game.append(h('header', { class: 'topbar' },
        h('span', { class: 'mark', html: K.mark }),
        S.mode !== 'local' ? h('span', { class: 'code', text: v.code }) : null,
        players,
        h('span', { class: 'pool', title: T('mBag') }, h('span', { class: 'bagicon', 'aria-hidden': 'true' }), String(v.bag)),
        sb, A.langSeg(),
        h('button', { type: 'button', class: 'btn small ghost', text: t('leave'), onclick: A.leaveTable })));

      const boardWrap = h('div', { class: 'mboard-wrap' }, renderBoard());
      const zoomBtn = h('button', { type: 'button', class: 'btn small mzoom', id: 'm-zoom', 'aria-label': T('mZoom'), text: U.zoom === 1 ? '⤢' : U.zoom + '×', onclick: () => { U.zoom = U.zoom === 1 ? 1.5 : U.zoom === 1.5 ? 2 : 1; A.render(); } });
      const playCol = h('div', { class: 'mplay' }, statusLine(), h('div', { class: 'mboard-box' }, boardWrap, zoomBtn), S.meIdx >= 0 ? renderDock() : null);
      game.append(h('div', { class: 'mmain' }, playCol, renderSide()));
      const pk = U.picker !== null && isMyTurn() ? renderPicker() : null;
      if (pk) game.append(pk);
      if (v.status === 'ended' && U.endClosed !== v.round && Date.now() >= U.endAt) game.append(renderEnd());
      return game;
    }

    // ---------- after each draw: fit, motion, effects ----------
    function fitBoard() {
      const wrap = $('.mboard-wrap'), b = $('.mboard');
      if (!wrap || !b) return;
      const avail = Math.min(wrap.clientWidth, wrap.clientHeight);
      const cs = Math.max(18, Math.floor((avail - 6) / 15.4));
      const px = Math.floor(cs * U.zoom);
      if (px === U.cs && b.style.getPropertyValue('--cs') === px + 'px') return;
      U.cs = px;
      b.style.setProperty('--cs', px + 'px');
      b.classList.toggle('roomy', px >= 38);   // room for the small 'eq' / 'tile' words on bonus squares
    }
    function snap() {
      const m = new Map();
      document.querySelectorAll('.mgame .mtile[data-mt]').forEach(el => { const r = el.getBoundingClientRect(); if (r.width) m.set(+el.dataset.mt, r); });
      return m;
    }
    const chipRect = p => { const el = $('.pchip[data-p="' + p + '"]'); return el ? el.getBoundingClientRect() : null; };
    function flip(before) {
      const deal = U.dealing; U.dealing = false;
      const fly = U.flyIds; U.flyIds = null;
      const flyBoard = U.flyBoard; U.flyBoard = null;
      const chip = flyBoard ? chipRect(U.flyFrom) : null;
      const from = U.dragFrom; U.dragFrom = null;
      const bagEl = $('.mgame .pool');
      const bag = bagEl ? bagEl.getBoundingClientRect() : null;
      let n = 0, m = 0;
      // measure everything first, then animate: reading a rect after starting an animation forces a style pass per tile
      const items = [];
      document.querySelectorAll('.mgame .mtile[data-mt]').forEach(el => { const r = el.getBoundingClientRect(); if (r.width) items.push([el, r]); });
      items.forEach(([el, r]) => {
        const id = +el.dataset.mt;
        const b = from && from.id === id ? from.rect : before.get(id);
        if (b && !(deal && fly && fly.has(id))) {
          const dx = b.left + b.width / 2 - (r.left + r.width / 2), dy = b.top + b.height / 2 - (r.top + r.height / 2), s = b.width / r.width;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.03) return;
          el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ')' }, { transform: 'none' }], { duration: Math.min(480, 180 + Math.hypot(dx, dy) * 0.4), easing: 'cubic-bezier(.2,.85,.25,1.08)' });
          return;
        }
        const inRack = !!el.closest('.mrack');
        let src = null, delay = 0;
        if (inRack && fly && fly.has(id) && bag) { src = bag; delay = (n++) * (deal ? 55 : 80); }
        else if (!inRack && flyBoard && flyBoard.has(id) && chip) { src = chip; delay = (m++) * 70; }
        if (!src) return;
        const dx = src.left + src.width / 2 - (r.left + r.width / 2), dy = src.top + src.height / 2 - (r.top + r.height / 2);
        el.animate([
          { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.4) rotate(-12deg)', opacity: 0 },
          { transform: 'translate(' + (dx * 0.35) + 'px,' + (dy * 0.35 - 30) + 'px) scale(1.1) rotate(4deg)', opacity: 1, offset: 0.55 },
          { transform: 'none', opacity: 1 }
        ], { duration: 500, delay, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'backwards' });
        if (inRack) setTimeout(() => SFX.deal(n), delay);
      });
      if (deal) FX.hold(n * 55 + 500);
    }

    function cellRect(c) { const el = $('[data-mc="' + c + '"]'); return el ? el.getBoundingClientRect() : null; }
    function boardRect() { const b = $('.mboard'); return b ? b.getBoundingClientRect() : null; }
    function anchor() { const r = boardRect(); return r ? { x: r.left + r.width / 2, y: r.top + Math.min(r.height * 0.18, 90) } : { x: innerWidth / 2, y: 120 }; }

    /** "+24" rising from the middle of the tiles just placed. */
    function scorePop(cells, n, big) {
      const rs = cells.map(cellRect).filter(Boolean);
      if (!rs.length) return;
      const x = rs.reduce((a, r) => a + r.left + r.width / 2, 0) / rs.length, y = Math.min.apply(null, rs.map(r => r.top));
      const e = h('div', { class: 'mscore-pop' + (big ? ' big' : ''), text: '+' + n, style: { left: x + 'px', top: y + 'px' } });
      document.body.append(e);
      if (FX.tier() === 0) { setTimeout(() => e.remove(), 900); return; }
      const a = e.animate([
        { transform: 'translate(-50%, 0) scale(.6)', opacity: 0 },
        { transform: 'translate(-50%, -22px) scale(1.15)', opacity: 1, offset: 0.25 },
        { transform: 'translate(-50%, -40px) scale(1)', opacity: 1, offset: 0.7 },
        { transform: 'translate(-50%, -64px) scale(.95)', opacity: 0 }
      ], { duration: 1500, easing: 'cubic-bezier(.2,.8,.2,1)' });
      a.onfinish = () => e.remove();
    }

    function playMove(mv) {
      const v = S.view;
      const who = v.players[mv.p];
      const mine = mv.p === S.meIdx;
      FX.note('m-' + mv.k, mv.sc);
      if (mv.k === 'play') {
        const d0 = mine ? 0 : 450;
        mv.cs.forEach((c, i) => setTimeout(() => {
          const r = cellRect(c);
          const el = $('[data-mc="' + c + '"] .mtile');
          if (el && FX.tier() > 0) el.animate([{ scale: '1' }, { scale: '1.18' }, { scale: '1' }], { duration: 360, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
          if (r) FX.P.sparkle(r.left + r.width / 2, r.top + r.height / 2, 5, { k: 'gold', v0: 20, v1: 90 });
          SFX.place(i);
        }, d0 + i * 70));
        const done = d0 + mv.cs.length * 70 + 120;
        setTimeout(() => { scorePop(mv.cs, mv.sc, mv.sc >= 40 || mv.bg); SFX.chime(Math.min(6, mv.cs.length + 1)); }, done);
        const eq = mv.eq || '';
        if (mv.bg) setTimeout(() => {
          FX.card(T('mfxBingo'), '+' + M.BINGO + ' · ' + eq, 'gold', 'win', anchor(), true);
          SFX.fanfare();
          const r = boardRect(); if (r) FX.P.confetti({ left: r.left, right: r.right, top: r.top }, 90);
        }, done + 150);
        else if (mv.sc >= 40) setTimeout(() => { FX.card(T('mfxBig', { n: mv.sc }), eq, 'violet', 'combo', anchor()); SFX.sparkle(); }, done + 150);
        else if (mv.ln >= K.crossMin) setTimeout(() => FX.card(T('mfxCross', { n: mv.ln }), '+' + mv.sc + ' · ' + eq, 'cyan', 'group4', anchor()), done + 150);
        FX.hold(done + 700);
        return done + 500;
      }
      if (mv.k === 'timeout') {
        FX.card(T('mfxTimeout'), who ? (mine ? t('you') : who.name) : '', 'rose', 'wrap', anchor());
        SFX.buzz();
        return 800;
      }
      if (mv.k === 'swap') {
        const el = $('.pchip[data-p="' + mv.p + '"]');
        if (el && FX.tier() > 0) el.animate([{ scale: '1' }, { scale: '1.08' }, { scale: '1' }], { duration: 380 });
        SFX.whoosh();
        return 300;
      }
      return 200;
    }

    function runPendingFx() {
      let wait = 0;
      if (U.pendingMove) { const mv = U.pendingMove; U.pendingMove = null; wait = playMove(mv); }
      if (U.justPlaced !== undefined) {
        const id = U.justPlaced; U.justPlaced = undefined;
        const el = $('.mtile.draft[data-mt="' + id + '"]');
        if (el) { const r = el.getBoundingClientRect(); FX.P.sparkle(r.left + r.width / 2, r.top + r.height / 2, 4, { k: 'gold', v0: 20, v1: 70 }); }
        const ev = evalDraft();
        if (ev && ev.ok) { SFX.chime(3); FX.note('m-valid', ev.score); }
      }
      if (U.pendingBanner) {
        U.pendingBanner = false;
        setTimeout(() => { if (isMyTurn()) FX.turnBanner(t('turnBanner'), T('mTurnSub')); }, Math.max(wait, FX.busyFor()));
      }
      const v = S.view;
      if (v.status === 'ended' && !U.wonShown && Date.now() >= U.endAt && U.endClosed !== v.round) {
        U.wonShown = v.code + ':' + v.round;
        if (v.winner === S.meIdx && S.meIdx >= 0) FX.victory(boardRect());
      }
      if (v.status !== 'ended') U.wonShown = null;
    }

    function placePicker() {
      const pk = $('.mpicker');
      if (!pk) return;
      const r = cellRect(U.picker);
      if (!r) return;
      const w = pk.offsetWidth, hh = pk.offsetHeight;
      let x = r.left + r.width / 2 - w / 2, y = r.bottom + 8;
      if (y + hh > innerHeight - 8) y = r.top - hh - 8;
      x = Math.max(8, Math.min(innerWidth - w - 8, x));
      y = Math.max(8, y);
      pk.style.left = x + 'px'; pk.style.top = y + 'px';
    }

    function stopTicker() { clearInterval(U.ticker); U.ticker = null; }
    function tick() {
      const left = U.deadline - Date.now();
      document.querySelectorAll('[data-timer]').forEach(el => {
        el.textContent = timerText(left);
        el.classList.toggle('low', left <= 10000);
      });
    }

    function afterRender(before) {
      fitBoard();
      const wrap = $('.mboard-wrap');
      if (wrap) {
        if (U.scroll) { wrap.scrollLeft = U.scroll.l; wrap.scrollTop = U.scroll.t; }
        else if (U.zoom > 1) { wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2; wrap.scrollTop = (wrap.scrollHeight - wrap.clientHeight) / 2; }
        if (window.ResizeObserver) {
          if (!U.ro) U.ro = new ResizeObserver(() => fitBoard());
          U.ro.disconnect(); U.ro.observe(wrap);
        }
      }
      if (FX.tier() > 0) flip(before);
      else { U.dealing = false; U.flyIds = null; U.flyBoard = null; U.dragFrom = null; }
      placePicker();
      runPendingFx();
      if (U.deadline && S.view.status === 'playing') { if (!U.ticker) U.ticker = setInterval(tick, 250); tick(); }
      else stopTicker();
    }

    // ---------- pointer: drag a tile, or tap to pick and tap to put ----------
    const D = { p: null, a: null, ghost: null, raf: 0, x: 0, y: 0, pace: null, hover: null, hoverKey: '' };
    function targetAt(x, y) {
      const el = document.elementFromPoint(x, y);
      if (!el || !el.closest('.mgame')) return null;
      const cell = el.closest('.mcell[data-mc]');
      if (cell) return { kind: 'cell', c: +cell.dataset.mc, el: cell };
      const slot = el.closest('.mslot[data-ms]');
      if (slot) return { kind: 'slot', i: +slot.dataset.ms, el: slot };
      const rack = el.closest('.mrack, .mdock');
      if (rack) return { kind: 'rack', el: rack };
      return null;
    }
    function clearHover() { if (D.hover && D.hover.el) D.hover.el.classList.remove('drop', 'drop-bad'); D.hover = null; }
    function showHover(tgt) {
      clearHover();
      if (!tgt) return;
      D.hover = tgt;
      const bad = tgt.kind === 'cell' && (!!S.view.board[tgt.c] || !isMyTurn());
      tgt.el.classList.add(bad ? 'drop-bad' : 'drop');
    }
    function dropOn(id, src, tgt) {
      if (!tgt) return false;
      if (tgt.kind === 'cell') return place(id, tgt.c);
      if (tgt.kind === 'slot') {
        if (src === 'draft') { toRack(id, tgt.i); return true; }
        moveInRack(id, tgt.i); A.render(); return true;
      }
      if (tgt.kind === 'rack' && src === 'draft') { toRack(id); return true; }
      return false;
    }
    function frame(now) {
      D.raf = 0;
      if (!D.a || !D.ghost) return;
      if (!D.pace(now)) { D.raf = requestAnimationFrame(frame); return; }
      D.ghost.style.transform = 'translate3d(' + D.x + 'px,' + D.y + 'px,0) translate(-50%,-60%) rotate(-3deg) scale(1.12)';
      const tgt = targetAt(D.x, D.y);
      const k = tgt ? tgt.kind + (tgt.c !== undefined ? tgt.c : tgt.i !== undefined ? tgt.i : '') : '';
      if (k !== D.hoverKey) { D.hoverKey = k; showHover(tgt); }
      // a zoomed board scrolls when you drag near its edge
      const wrap = $('.mboard-wrap');
      if (wrap && U.zoom > 1) {
        const r = wrap.getBoundingClientRect();
        if (D.x > r.left && D.x < r.right && D.y > r.top && D.y < r.bottom) {
          if (D.x < r.left + 36) wrap.scrollLeft -= 10; else if (D.x > r.right - 36) wrap.scrollLeft += 10;
          if (D.y < r.top + 36) wrap.scrollTop -= 10; else if (D.y > r.bottom - 36) wrap.scrollTop += 10;
        }
      }
    }
    function tapTile(id, src) {
      if (src === 'rack') {
        if (U.swap) { if (U.swap.has(id)) U.swap.delete(id); else U.swap.add(id); SFX.pick(); A.render(); return; }
        U.sel = U.sel && U.sel.id === id ? null : { id };
        if (U.sel) { SFX.pick(); U.cursor = null; }
        A.render();
        return;
      }
      // a tile you put down this turn: choice tiles reopen their picker, others go back to the rack
      const d = U.draft.find(p => p.id === id);
      if (!d) return;
      if (U.sel) { const s = U.sel.id; U.sel = null; place(s, d.c); return; }
      if (M.needsChoice(M.tile(id).face)) { U.picker = U.picker === d.c ? null : d.c; A.render(); return; }
      toRack(id);
    }
    document.addEventListener('pointerdown', e => {
      if (!active() || (e.button !== undefined && e.button !== 0)) return;
      const el = e.target.closest('.mtile[data-src]');
      if (!el) return;
      e.preventDefault();
      D.p = { id: +el.dataset.mt, src: el.dataset.src, el, x0: e.clientX, y0: e.clientY, pid: e.pointerId };
    });
    window.addEventListener('pointermove', e => {
      const p = D.p;
      if (p && !D.a && e.pointerId === p.pid && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) >= 6) {
        if (U.swap) { D.p = null; return; }
        const r = p.el.getBoundingClientRect();
        const g = p.el.cloneNode(true);
        g.classList.add('drag-ghost'); g.classList.remove('sel', 'last', 'picking');
        g.style.width = r.width + 'px'; g.style.height = r.height + 'px'; g.style.setProperty('--tw', r.width + 'px');
        g.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0) translate(-50%,-60%) rotate(-3deg) scale(1.12)';
        document.body.append(g);
        p.el.classList.add('lifting');
        D.a = p; D.ghost = g; D.p = null; D.hoverKey = ''; D.pace = FX.pacer();
        U.sel = null; U.picker = null;
        SFX.pick();
      }
      if (!D.a || e.pointerId !== D.a.pid) return;
      e.preventDefault();
      D.x = e.clientX; D.y = e.clientY;
      if (!D.raf) D.raf = requestAnimationFrame(frame);
    }, { passive: false });
    function end(e, cancel) {
      const a = D.a, p = D.p;
      D.p = null;
      if (a) {
        const tgt = cancel ? null : targetAt(e.clientX, e.clientY);
        clearHover();
        U.dragFrom = { id: a.id, rect: D.ghost.getBoundingClientRect() };
        D.ghost.remove(); D.ghost = null; D.a = null;
        D.dropAt = Date.now();     // the browser follows a mouse drag with a click on the shared parent: ignore it
        a.el.classList.remove('lifting');
        if (!dropOn(a.id, a.src, tgt)) { U.dragFrom = null; A.render(); }
        return;
      }
      if (p && !cancel && e.pointerId === p.pid) tapTile(p.id, p.src);
    }
    window.addEventListener('pointerup', e => { if (D.a || D.p) end(e, false); });
    window.addEventListener('pointercancel', e => { if (D.a || D.p) end(e, true); });
    // taps on empty cells and rack slots (taps on tiles are handled above)
    document.addEventListener('click', e => {
      if (!active() || e.target.closest('.mtile, button, .mpicker') || Date.now() - (D.dropAt || 0) < 350) return;
      const cell = e.target.closest('.mcell[data-mc]');
      if (cell && U.sel) { place(U.sel.id, +cell.dataset.mc); return; }
      if (cell && K.typing && isMyTurn() && !U.swap && !S.view.board[+cell.dataset.mc] && canHover()) { setCursor(+cell.dataset.mc); return; }
      const slot = e.target.closest('.mslot[data-ms]');
      if (slot && U.sel) { moveInRack(U.sel.id, +slot.dataset.ms); U.sel = null; A.render(); return; }
      if (U.picker !== null && !e.target.closest('.mpicker')) { U.picker = null; A.render(); }
    });

    function onKey(e) {
      if (!active()) return false;
      if (e.key === 'Escape') {
        if (U.picker !== null) U.picker = null;
        else if (U.swap) U.swap = null;
        else if (U.sel) U.sel = null;
        else if (U.cursor) U.cursor = null;
        else return true;
        A.render();
        return true;
      }
      if (e.target && e.target.closest && e.target.closest('input, button, textarea, select')) return false;   // Enter on a button is that button's
      if (K.typing && isMyTurn() && !U.swap && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const ch = e.key && e.key.length === 1 ? e.key.toUpperCase() : '';
        const open = U.picker !== null ? U.draft.find(p => p.c === U.picker) : null;
        if (open && ch >= 'A' && ch <= 'Z') { open.s = ch; U.picker = null; SFX.pluck(3); A.render(); return true; }
        if (U.cursor) {
          if (ch >= 'A' && ch <= 'Z') { typeLetter(ch); return true; }
          if (e.key === 'Backspace') { typeBack(); return true; }
          const arrows = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
          if (arrows[e.key]) { moveCursor(arrows[e.key][0], arrows[e.key][1]); return true; }
        }
      }
      if (e.key === 'Enter' && !e.repeat) { if (U.swap) doSwap(); else play(); return true; }
      if (e.key === 'Backspace' && U.draft.length) { toRack(U.draft[U.draft.length - 1].id); return true; }
      return false;
    }

    // ---------- menu art: a few tiles fanned out ----------
    function menuFan() {
      const pick = f => { for (let i = 0; i < M.TILE_COUNT; i++) if (M.tile(i).face === f) return i; return 0; };
      return h('div', { class: 'menu-fan mfan', 'aria-hidden': 'true' }, K.fan.map((f, i) => {
        const e = tileEl(pick(f), f, 'static');
        e.style.setProperty('--i', String(i - (K.fan.length - 1) / 2));
        return e;
      }));
    }

    return { onState, renderGame, afterRender, snap, reset, deny, onKey, menuFan, tileEl, evalDraft, place, toRack, play, setCursor, U };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
