// Firebase transport: the same calls as the claude.ai room (net.js), carried by
// Realtime Database paths instead. Used when the page runs outside claude.ai
// (GitHub Pages) and window.RK_FIREBASE holds a project config.
//
//   rk/lobby/{code}              open tables, removed when the host disconnects
//   rk/rooms/{code}/host         uid of the table's host (only the host may write state)
//   rk/rooms/{code}/state        public state + per-player sealed hands (host writes)
//   rk/rooms/{code}/hello/{uid}  "I'm here", with name and public key (each player writes their own)
//   rk/rooms/{code}/acts/{id}    moves sent to the host; the host reads then deletes them
//   rk/rooms/{code}/err/{uid}    why the host refused your move
//   rk/rooms/{code}/presence/{uid}  online flag, removed on disconnect
//
// Anonymous sign-in gives every player a uid the security rules can trust, so
// "who sent this" can't be faked (the job msg.by does in the claude.ai room).
(function (root) {
  'use strict';
  const SDK_VERSION = '10.12.2';
  const CODE_RE = /^[a-z0-9]{4}$/;

  async function loadSdk() {
    if (root.__RK_FB_SDK) return root.__RK_FB_SDK;          // tests inject a stand-in
    const base = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/';
    const mods = await Promise.all(['firebase-app.js', 'firebase-auth.js', 'firebase-database.js'].map(f => import(base + f)));
    return Object.assign({}, ...mods);
  }

  function hasConfig(cfg) {
    return !!(cfg && typeof cfg === 'object' && typeof cfg.apiKey === 'string' && cfg.apiKey && !/^YOUR|^PASTE/i.test(cfg.apiKey) && typeof cfg.databaseURL === 'string' && /^https:\/\//.test(cfg.databaseURL));
  }

  // Firebase rejects undefined and drops nulls; send plain JSON.
  const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));

  /** Turn `Net` (net.js) into a Firebase-backed transport. */
  async function attach(Net, cfg, onChange) {
    let fb, app, db, uid;
    try {
      fb = await loadSdk();
      app = fb.initializeApp(cfg, 'rummy-tiles');
      // One player per TAB: session persistence keeps the sign-in for reloads of this tab only.
      // (Shared persistence makes a second tab replace the first tab's player, and the host's
      // writes then get refused.)
      const auth = fb.initializeAuth && fb.browserSessionPersistence
        ? fb.initializeAuth(app, { persistence: fb.browserSessionPersistence })
        : fb.getAuth(app);
      if (auth.authStateReady) await auth.authStateReady();
      if (!auth.currentUser) await fb.signInAnonymously(auth);
      uid = auth.currentUser && auth.currentUser.uid;
      if (!uid) throw Object.assign(new Error('no uid'), { code: 'auth' });
      db = fb.getDatabase(app);
    } catch (e) {
      Net.state = 'off';
      Net.reason = /auth|admin-restricted|operation-not-allowed|configuration/i.test(String(e && (e.code || e.message))) ? 'fb-auth' : 'fb-error';
      console.warn('Firebase unavailable:', e && (e.code || e.message));
      onChange();
      return;
    }
    const R = p => fb.ref(db, 'rk/' + p);
    Net.transport = 'firebase';
    Net.myId = uid; Net.myPeer = uid;
    await Net.Crypto.init();

    // open tables (everyone sees the lobby)
    fb.onValue(R('lobby'), snap => {
      const all = snap.val() || {}, list = [], now = Date.now();
      Object.keys(all).forEach(code => {
        const x = all[code];
        if (!CODE_RE.test(code) || !x || x.uid === uid) return;
        if (typeof x.ts === 'number' && now - x.ts > 6 * 3600e3) return;   // forgotten tables
        list.push({ code, host: String(x.host || '').slice(0, 16), n: Number(x.n) || 1, st: x.st === 'playing' ? 'playing' : x.st === 'ended' ? 'ended' : 'lobby' });
      });
      Net.lobby = list;
      onChange();
    }, () => { Net.lobby = []; onChange(); });

    let code = null, isHost = false, hostUid = null, offs = [], lobbyOn = false;

    Net.selfId = () => uid;
    Net.senderId = msg => msg.by;

    let lastAnn = '', lastAnnAt = 0;
    Net.announceTable = async info => {
      if (!info) { if (lobbyOn && code) { lobbyOn = false; lastAnn = ''; try { await fb.remove(R('lobby/' + code)); } catch (e) {} } return; }
      if (!CODE_RE.test(info.code)) return;
      // only write when something changed (or every 10 min to keep the entry fresh): every write wakes every menu
      const ann = JSON.stringify([info.code, info.host, info.n, info.st]);
      if (ann === lastAnn && Date.now() - lastAnnAt < 600e3) return;
      lastAnn = ann; lastAnnAt = Date.now();
      try {
        const r = R('lobby/' + info.code);
        if (!lobbyOn) { lobbyOn = true; fb.onDisconnect(r).remove(); }
        await fb.set(r, { uid, host: String(info.host || '').slice(0, 16), n: info.n, st: info.st, ts: fb.serverTimestamp() });
      } catch (e) { /* the lobby is best-effort */ }
    };

    Net.joinTable = async (c, handlers) => {
      await Net.leaveTable();
      if (!CODE_RE.test(c)) throw Object.assign(new Error('bad code'), { code: 'invalid_argument' });
      code = c;
      const room = p => R('rooms/' + code + (p ? '/' + p : ''));
      // The host is whoever brings the host-side handlers. Claim the table, or confirm it is ours.
      isHost = !!(handlers.hello || handlers.act);
      const cur = (await fb.get(room('host'))).val();
      if (isHost) {
        if (cur && cur !== uid) { code = null; throw Object.assign(new Error('table taken'), { code: 'taken' }); }
        if (!cur) await fb.set(room('host'), uid);
        hostUid = uid;
      } else hostUid = cur || null;

      const msgFrom = (data, by) => ({ data, by, peer: by, isMe: by === uid, sameTab: by === uid, kind: 'viewer', guest: false });
      const pres = room('presence/' + uid);
      fb.onDisconnect(pres).remove();
      await fb.set(pres, { on: true, ts: fb.serverTimestamp() });

      if (!isHost) offs.push(fb.onValue(room('host'), s => { hostUid = s.val() || null; }));
      if (handlers.state) {
        offs.push(fb.onValue(room('state'), s => {
          const v = s.val();
          if (v && hostUid) handlers.state(msgFrom(v, hostUid));
        }, e => handlers.error && handlers.error({ code: 'not_permitted', message: String(e) })));
      }
      if (handlers.err) {
        let first = true;   // the first read is whatever was left from before: ignore it
        offs.push(fb.onValue(room('err/' + uid), s => {
          if (first) { first = false; return; }
          const v = s.val();
          if (v) handlers.err(msgFrom(Object.assign({}, v, { to: uid }), hostUid));
        }));
      }
      if (handlers.hello) {
        const onHello = s => { const v = s.val(); if (v && v.d) handlers.hello(msgFrom(v.d, s.key)); };
        offs.push(fb.onChildAdded(room('hello'), onHello));
        offs.push(fb.onChildChanged(room('hello'), onHello));
      }
      if (handlers.act) {
        offs.push(fb.onChildAdded(room('acts'), s => {
          const v = s.val();
          fb.remove(s.ref || room('acts/' + s.key)).catch(() => {});
          if (v && typeof v.by === 'string' && v.d) handlers.act(msgFrom(v.d, v.by));
        }));
      }
      if (handlers.peers) {
        offs.push(fb.onValue(room('presence'), s => {
          const ids = Object.keys(s.val() || {});
          const peers = ids.map(id => ({ peer: id, by: id, isMe: id === uid, sameTab: id === uid, kind: 'viewer', guest: false, presence: {} }));
          handlers.peers({ peers, joined: peers, left: [], updated: [] });
        }));
      }
      if (handlers.connection) {
        offs.push(fb.onValue(fb.ref(db, '.info/connected'), s => handlers.connection(!!s.val())));
      }
      return true;
    };

    Net.leaveTable = async () => {
      offs.forEach(off => { try { off(); } catch (e) {} });
      offs = [];
      if (code) {
        try { await fb.remove(R('rooms/' + code + '/presence/' + uid)); } catch (e) {}
        if (isHost) await Net.announceTable(null);
      }
      code = null; isHost = false; hostUid = null;
    };

    Net.send = async (topic, data) => {
      if (!code) throw Object.assign(new Error('no_room'), { code: 'no_room' });
      const room = p => R('rooms/' + code + '/' + p);
      const ts = fb.serverTimestamp();
      try {
        if (topic === 'state') return await fb.set(room('state'), plain(data));
        if (topic === 'hello') return await fb.set(room('hello/' + uid), { d: plain(data), ts });
        if (topic === 'act') return await fb.push(room('acts'), { by: uid, d: plain(data), ts });
        if (topic === 'err') {
          const to = data && data.to;
          if (typeof to !== 'string' || /[.#$[\]/]/.test(to)) return;
          const d = plain(data); delete d.to;
          return await fb.set(room('err/' + to), Object.assign(d, { ts }));
        }
      } catch (e) {
        throw Object.assign(new Error(String(e && e.message)), { code: /permission/i.test(String(e && (e.code || e.message))) ? 'not_permitted' : 'upstream_error' });
      }
    };

    Net.state = 'on';
    onChange();
  }

  root.RK = root.RK || {};
  root.RK.NetFB = { attach, hasConfig, SDK_VERSION };
})(typeof globalThis !== 'undefined' ? globalThis : this);
