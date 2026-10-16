// Network: claude.ai `room` for live messages, `user` for stable ids.
// The host's page is the server. Hands travel encrypted per player
// (ECDH P-256 → AES-GCM), so only the host and the owner can read a hand.
(function (root) {
  'use strict';

  const TOPICS = { hello: 'rk.hello', act: 'rk.act', state: 'rk.state', err: 'rk.err' };

  const b64 = buf => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  const Crypto = {
    kp: null, pub: null, cache: new Map(),
    get ok() { return !!(root.crypto && root.crypto.subtle); },
    async init() {
      if (!this.ok || this.kp) return;
      this.kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
      this.pub = b64(await crypto.subtle.exportKey('raw', this.kp.publicKey));
    },
    async keyFor(theirPub) {
      if (this.cache.has(theirPub)) return this.cache.get(theirPub);
      const p = (async () => {
        const pk = await crypto.subtle.importKey('raw', unb64(theirPub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
        return crypto.subtle.deriveKey({ name: 'ECDH', public: pk }, this.kp.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      })();
      this.cache.set(theirPub, p);
      return p;
    },
    async seal(theirPub, text) {
      const key = await this.keyFor(theirPub);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
      return { iv: b64(iv), ct: b64(ct) };
    },
    async open(theirPub, box) {
      const key = await this.keyFor(theirPub);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
      return new TextDecoder().decode(pt);
    }
  };

  // A key for this tab that survives reloads of the tab (sessionStorage), so two tabs of one
  // account are two players, and a reload keeps your seat.
  function tabKey() {
    if (typeof root.__RK_TAB === 'string' && /^[a-z0-9]{6}$/.test(root.__RK_TAB)) return root.__RK_TAB;   // test hook
    let k = null;
    try { k = sessionStorage.getItem('rk.tab'); } catch (e) {}
    if (!k || !/^[a-z0-9]{6}$/.test(k)) {
      k = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
      try { sessionStorage.setItem('rk.tab', k); } catch (e) {}
    }
    return k;
  }
  const TAB_RE = /^[a-z0-9]{6}$/;

  const Net = {
    TOPICS, Crypto,
    tab: tabKey(),
    room: null, user: null, myId: null, myPeer: null,
    state: 'init',            // 'init' | 'on' | 'off'
    reason: '',               // why it is off: 'no-config' | 'artifact-off' | 'fb-auth' | 'fb-error'
    transport: '',            // 'room' (claude.ai) | 'firebase'
    canWrite: null,           // null = unknown
    lobby: [],                // open tables seen in lobby presence
    table: null,              // the named room we are in
    listeners: [],

    async init(onChange) {
      const cl = root.claude;
      if (!cl || typeof cl.use !== 'function') {
        // Outside claude.ai (e.g. GitHub Pages): use Firebase when the page has a project config.
        const FB = root.RK && root.RK.NetFB;
        if (FB && FB.hasConfig(root.RK_FIREBASE)) { await FB.attach(this, root.RK_FIREBASE, onChange); return; }
        this.state = 'off'; this.reason = 'no-config'; onChange(); return;
      }
      this.transport = 'room';
      try {
        const [room, user] = await Promise.all([cl.use('room'), cl.use('user')]);
        this.room = room; this.user = user;
        if (!room) { this.state = 'off'; this.reason = 'artifact-off'; onChange(); return; }
        if (user) this.myId = await user.id();
        await Crypto.init();
        room.onPeers(ch => {
          const me = ch.peers.find(p => p.sameTab);
          if (me) this.myPeer = me.peer;
          const seen = new Map();
          ch.peers.forEach(p => {
            const pr = p.presence || {};
            if (typeof pr.tbl === 'string' && /^[a-z0-9]{4}$/.test(pr.tbl) && !p.sameTab) {
              seen.set(pr.tbl, { code: pr.tbl, host: String(pr.hn || '').slice(0, 16), n: Number(pr.n) || 1, st: pr.st === 'playing' ? 'playing' : pr.st === 'ended' ? 'ended' : 'lobby' });
            }
          });
          this.lobby = [...seen.values()];
          onChange();
        }, () => { this.state = 'off'; onChange(); });
        this.state = 'on';
      } catch (e) {
        this.state = 'off';
      }
      onChange();
    },

    /** Rejoin as the tab you played in before (claude.ai rooms; a Firebase sign-in is per tab already). */
    adoptTab(k) {
      if (this.transport === 'firebase' || !TAB_RE.test(k || '')) return;
      this.tab = k;
      try { sessionStorage.setItem('rk.tab', k); } catch (e) {}
    },
    /** Our player id: the account (msg.by, which the platform vouches for) plus this tab's key. */
    selfId() {
      const base = this.myId || (this.myPeer ? 'p:' + this.myPeer : null);
      return base ? base + '~' + this.tab : null;
    },
    /**
     * Who sent this, as a player id. The account part comes from the platform and can't be faked;
     * the tab part is the sender's own claim, so one account can only ever speak for its own tabs.
     */
    senderId(msg) {
      const base = msg.by || ('p:' + msg.peer);
      const d = msg.data && typeof msg.data === 'object' ? msg.data : null;
      if (d && typeof d.h === 'string' && d.h.startsWith(base + '~')) return d.h;      // the host's state / replies
      const tab = (d && d.tab) || (msg.presence && msg.presence.tab);
      return base + '~' + (TAB_RE.test(tab || '') ? tab : '?');
    },

    async announceTable(info) {
      if (!this.room) return;
      const ann = info ? JSON.stringify([info.code, info.host, info.n, info.st]) : '';
      if (ann === this._ann) return;          // unchanged: don't wake every page in the lobby
      this._ann = ann;
      try { await this.room.presence(info ? { tbl: info.code, hn: info.host, n: info.n, st: info.st } : { tbl: null, hn: null, n: null, st: null }); } catch (e) { /* presence is best-effort */ }
    },

    async joinTable(code, handlers) {
      if (!this.room) throw new Error('no_room');
      await this.leaveTable();
      const t = await this.room.join('rk-' + code);
      this.table = t;
      try { await t.presence({ tab: this.tab }); } catch (e) { /* best-effort */ }
      const offs = [];
      Object.keys(handlers).forEach(k => {
        if (TOPICS[k]) offs.push(t.on(TOPICS[k], handlers[k], e => handlers.error && handlers.error(e)));
      });
      if (handlers.peers) offs.push(t.onPeers(handlers.peers, e => handlers.error && handlers.error(e)));
      if (handlers.connection) offs.push(t.onConnection(handlers.connection));
      this.listeners = offs;
      return t;
    },

    async leaveTable() {
      this.listeners.forEach(off => { try { off(); } catch (e) {} });
      this.listeners = [];
      if (this.table) { try { await this.table.leave(); } catch (e) {} }
      this.table = null;
    },

    async send(topic, data) {
      if (!this.table) throw Object.assign(new Error('no_room'), { code: 'no_room' });
      if (topic === 'hello' || topic === 'act') data = Object.assign({}, data, { tab: this.tab });
      if (topic === 'err') data = Object.assign({}, data, { h: this.selfId() });
      return this.table.emit(TOPICS[topic], data);
    }
  };

  root.RK = root.RK || {};
  root.RK.Net = Net;
})(typeof globalThis !== 'undefined' ? globalThis : this);
