// Effects. Two kinds:
//  * marks — set highlights, labels and tile pops drawn INSIDE the table grid by the app
//    (ctx.markSet / ctx.markTile), so they stay locked to their tiles while the table
//    zooms or scrolls;
//  * free effects — soft particles, arc trails and confetti on one canvas, plus the
//    glass headline card and the turn pill.
// Levels: full, lite (fewer particles, no punch), off. prefers-reduced-motion caps at lite.
(function (root) {
  'use strict';
  const SFX = () => root.RK.SFX;
  let level = 'full';
  const mq = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const canAnim = typeof Element !== 'undefined' && !!Element.prototype.animate;
  function tier() {
    if (level === 'off' || !canAnim) return 0;
    if (level === 'lite' || (mq && mq.matches)) return 1;
    return 2;
  }
  const log = [];
  function note(k, d) { log.push({ k, d: d === undefined ? null : d, t: Date.now() }); if (log.length > 300) log.splice(0, log.length - 300); }
  const timers = new Set();
  function at(ms, fn) { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); }
  let busyUntil = 0;
  const hold = ms => { busyUntil = Math.max(busyUntil, Date.now() + ms); };
  const busyFor = () => Math.max(0, busyUntil - Date.now());
  const mid = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  const TONE = { gold: '#ffc94d', violet: '#b98cff', cyan: '#5cc8ff', mint: '#49e3a6', rose: '#ff5d7a' };

  // ---- layer ----
  let layer = null;
  function L() {
    if (!layer || !layer.isConnected) {
      layer = document.createElement('div');
      layer.id = 'fx-layer'; layer.setAttribute('aria-hidden', 'true');
      document.body.append(layer);
    }
    return layer;
  }

  // ---- particles, trails and confetti on one canvas ----
  const P = (() => {
    let cv = null, ctx = null, raf = 0, last = 0;
    const parts = [], trails = [], SPR = {};
    const COL = { gold: '255,201,77', rose: '255,93,122', cyan: '92,200,255', violet: '185,140,255', silver: '230,234,255', mint: '73,227,166', white: '255,255,255' };
    const RAINBOW = ['gold', 'rose', 'cyan', 'violet', 'mint'];
    function spr(k) {
      if (SPR[k]) return SPR[k];
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.25, 'rgba(' + COL[k] + ',.85)'); gr.addColorStop(1, 'rgba(' + COL[k] + ',0)');
      g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
      return (SPR[k] = c);
    }
    function size() {
      if (!cv) return;
      const d = Math.min(2, root.devicePixelRatio || 1);
      cv.width = root.innerWidth * d; cv.height = root.innerHeight * d;
      cv.style.width = root.innerWidth + 'px'; cv.style.height = root.innerHeight + 'px';
      if (ctx) ctx.setTransform(d, 0, 0, d, 0, 0);
    }
    function ensure() {
      if (cv && cv.isConnected) return !!ctx;
      cv = document.createElement('canvas'); cv.className = 'fx-canvas';
      L().append(cv); ctx = cv.getContext('2d'); size();
      root.addEventListener('resize', size);
      return !!ctx;
    }
    const rnd = (a, b) => a + Math.random() * (b - a);
    function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }
    /** Soft sparkles: small, few, drifting up a little. */
    function sparkle(x, y, n, o) {
      if (tier() === 0 || !ensure()) return;
      o = o || {};
      n = Math.max(1, Math.round(n * (tier() === 2 ? 1 : 0.4)));
      for (let i = 0; i < n && parts.length < 900; i++) {
        const a = rnd(0, Math.PI * 2), sp = rnd(o.v0 || 30, o.v1 || 140);
        const k = (o.k === 'rainbow' || !COL[o.k]) ? RAINBOW[Math.floor(Math.random() * RAINBOW.length)] : o.k;
        parts.push({ type: 'dot', k, x: x + rnd(-(o.jx || 0), o.jx || 0), y: y + rnd(-(o.jy || 0), o.jy || 0), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.up || 40), g: o.g || 0, drag: 3, t: 0, ttl: rnd(o.l0 || 320, o.l1 || 640), s: rnd(o.s0 || 2.5, o.s1 || 5) });
      }
      kick();
    }
    /** Confetti: little rotating paper slips falling across an area. */
    function confetti(rect, n) {
      if (tier() === 0 || !ensure()) return;
      n = Math.round(n * (tier() === 2 ? 1 : 0.35));
      const cols = ['#ffc94d', '#ff5d7a', '#5cc8ff', '#b98cff', '#49e3a6', '#ffffff'];
      for (let i = 0; i < n; i++) {
        parts.push({ type: 'paper', col: cols[i % cols.length], x: rnd(rect.left, rect.right), y: rect.top - rnd(0, 120), vx: rnd(-40, 40), vy: rnd(40, 140), g: 160, drag: 0.6, t: 0, ttl: rnd(1800, 2800), w: rnd(5, 9), h: rnd(8, 13), rot: rnd(0, 6.28), vr: rnd(-6, 6), sway: rnd(0, 6.28) });
      }
      kick();
    }
    /** A glowing line that draws itself along an arc from a to b. */
    function arc(a, b, color, dur, delay) {
      if (tier() === 0 || !ensure()) return;
      const lift = Math.min(110, Math.hypot(b.x - a.x, b.y - a.y) * 0.45);
      trails.push({ a, b, m: { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - lift }, color, dur, t0: performance.now() + (delay || 0) });
      kick();
    }
    const qp = (tr, k) => { const u = 1 - k; return { x: u * u * tr.a.x + 2 * u * k * tr.m.x + k * k * tr.b.x, y: u * u * tr.a.y + 2 * u * k * tr.m.y + k * k * tr.b.y }; };
    function tick(now) {
      raf = 0;
      let dt = now - last; last = now;
      if (dt > 250) { parts.length = 0; trails.length = 0; }
      dt = Math.max(0, Math.min(dt, 40)); const ds = dt / 1000;
      ctx.clearRect(0, 0, root.innerWidth, root.innerHeight);
      // trails
      ctx.globalCompositeOperation = 'lighter';
      for (let i = trails.length - 1; i >= 0; i--) {
        const tr = trails[i], e = (now - tr.t0) / tr.dur;
        if (e < 0) continue;
        if (e > 1.6) { trails.splice(i, 1); continue; }
        const head = Math.min(1, e), tail = Math.max(0, e - 0.55);
        ctx.lineCap = 'round';
        for (let pass = 0; pass < 2; pass++) {
          ctx.beginPath();
          let first = true;
          for (let k = tail; k <= head + 1e-6; k += 0.04) { const p = qp(tr, Math.min(k, head)); if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y); }
          ctx.strokeStyle = tr.color; ctx.globalAlpha = (pass ? 0.95 : 0.35) * (e > 1 ? Math.max(0, 1 - (e - 1) / 0.6) : 1);
          ctx.lineWidth = pass ? 2.5 : 9; ctx.stroke();
        }
        if (e <= 1 && Math.random() < 0.6) { const p = qp(tr, head); parts.push({ type: 'dot', k: 'violet', x: p.x, y: p.y, vx: rnd(-20, 20), vy: rnd(-20, 20), g: 0, drag: 3, t: 0, ttl: 380, s: rnd(2, 4) }); }
      }
      // particles
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.t += dt;
        if (p.t >= p.ttl) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
        const d = Math.max(0, 1 - p.drag * ds);
        p.vx *= d; p.vy = p.vy * d + p.g * ds; p.x += p.vx * ds; p.y += p.vy * ds;
        if (p.type === 'paper') { p.rot += p.vr * ds; p.x += Math.sin(p.t * 0.004 + p.sway) * 0.6; }
      }
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i], f = p.t / p.ttl;
        if (p.type === 'dot') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85;
          const s = p.s * (1 - f * 0.5);
          ctx.drawImage(spr(p.k), p.x - s * 2, p.y - s * 2, s * 4, s * 4);
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = f > 0.8 ? (1 - f) / 0.2 : 1;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.t * 0.01 + p.sway));
          ctx.fillStyle = p.col; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
        }
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      if (parts.length || trails.length) raf = requestAnimationFrame(tick);
    }
    return { sparkle, confetti, arc, get live() { return parts.length + trails.length; } };
  })();

  // ---- glass cards ----
  const ICON = {
    combo: '<rect x="3" y="7" width="7" height="10" rx="2"/><rect x="9" y="5" width="7" height="12" rx="2"/><rect x="15" y="7" width="6" height="10" rx="2"/>',
    steal: '<path d="M4 16c3-7 9-10 16-9"/><path d="M16 4l4 3-3 4"/><circle cx="5" cy="17" r="1.6"/>',
    extend: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>',
    wrap: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 4v4h-4"/>',
    group4: '<circle cx="8" cy="8" r="2.4"/><circle cx="16" cy="8" r="2.4"/><circle cx="8" cy="16" r="2.4"/><circle cx="16" cy="16" r="2.4"/>',
    joker: '<path d="M12 3l2.2 6.3L21 12l-6.8 2.7L12 21l-2.2-6.3L3 12l6.8-2.7z"/>',
    long: '<path d="M3 12h15"/><path d="M14 7l5 5-5 5"/><path d="M6 8v8M10 8v8"/>',
    meld: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    win: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M9 20h6"/>'
  };
  let cardEl = null;
  /** A glass card at the top of the table: icon, title, optional detail line. */
  function card(text, sub, tone, icon, anchor, big) {
    note('headline', text);
    if (!canAnim) return;
    if (cardEl && cardEl.isConnected) cardEl.remove();
    const e = document.createElement('div');
    e.className = 'fx-card' + (big ? ' big' : '');
    e.style.setProperty('--acc', TONE[tone] || TONE.gold);
    e.innerHTML = '<span class="fx-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICON[icon] || ICON.combo) + '</svg></span><span class="fx-txt"><b></b><small></small></span>';
    e.querySelector('b').textContent = text;
    e.querySelector('small').textContent = sub || '';
    e.style.left = anchor.x + 'px'; e.style.top = anchor.y + 'px';
    L().append(e); cardEl = e;
    const still = tier() === 0;
    const dur = big ? 3200 : 2100;
    const a = e.animate(still ? [{ transform: 'translate(-50%, 0)', opacity: 0 }, { transform: 'translate(-50%, 0)', opacity: 1, offset: 0.1 }, { transform: 'translate(-50%, 0)', opacity: 1, offset: 0.85 }, { transform: 'translate(-50%, 0)', opacity: 0 }] : [
      { transform: 'translate(-50%, 14px) scale(.94)', opacity: 0 },
      { transform: 'translate(-50%, -2px) scale(1.02)', opacity: 1, offset: 0.1 },
      { transform: 'translate(-50%, 0) scale(1)', opacity: 1, offset: 0.16 },
      { transform: 'translate(-50%, 0) scale(1)', opacity: 1, offset: 0.85 },
      { transform: 'translate(-50%, -8px) scale(.98)', opacity: 0 }
    ], { duration: dur, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
    a.onfinish = () => e.remove();
  }

  /** "Your turn": a small glass pill under the top bar. */
  let pillEl = null;
  function turnBanner(text, sub) {
    note('turn');
    if (!canAnim) return;
    if (pillEl && pillEl.isConnected) pillEl.remove();
    const e = document.createElement('div');
    e.className = 'turn-banner'; e.setAttribute('role', 'status');
    e.innerHTML = '<span class="tb-dot"></span><span class="tb-body"><b class="tb-text"></b><span class="tb-sub"></span></span>';
    e.querySelector('.tb-text').textContent = text;
    e.querySelector('.tb-sub').textContent = sub || '';
    document.body.append(e); pillEl = e;
    const still = tier() === 0;
    const a = e.animate(still ? [{ transform: 'translate(-50%, 0)', opacity: 0 }, { transform: 'translate(-50%, 0)', opacity: 1, offset: 0.08 }, { transform: 'translate(-50%, 0)', opacity: 1, offset: 0.88 }, { transform: 'translate(-50%, 0)', opacity: 0 }] : [
      { transform: 'translate(-50%, -16px) scale(.96)', opacity: 0 },
      { transform: 'translate(-50%, 2px) scale(1.01)', opacity: 1, offset: 0.09 },
      { transform: 'translate(-50%, 0) scale(1)', opacity: 1, offset: 0.14 },
      { transform: 'translate(-50%, 0) scale(1)', opacity: 1, offset: 0.88 },
      { transform: 'translate(-50%, -10px) scale(.98)', opacity: 0 }
    ], { duration: 2600, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
    a.onfinish = () => e.remove();
    SFX().turn();
  }

  /** A gentle "camera punch" on the table for big moves. */
  function punch(el) {
    if (tier() < 2 || !el) return;
    el.animate([{ scale: '1' }, { scale: '1.012', offset: 0.35 }, { scale: '1' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  /** A soft coloured glow behind the table. */
  function wash(rect, color, dur) {
    if (tier() < 2 || !rect) return;
    const e = document.createElement('div');
    e.className = 'fx-wash';
    e.style.cssText = 'left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;--acc:' + color;
    L().append(e);
    const a = e.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: dur || 1200, easing: 'ease-out' });
    a.onfinish = () => e.remove();
  }

  /** The host refused a move: the bad sets give a short shake. */
  function deny(els) {
    note('deny');
    (els || []).forEach(el => el && el.animate && el.animate([{ translate: '0' }, { translate: '-4px' }, { translate: '4px' }, { translate: '-2px' }, { translate: '0' }], { duration: 280 }));
    SFX().buzz();
  }

  function pickHeadline(mv, t) {
    const parts = [];
    const st = (mv.st || []).length;
    if (mv.win) parts.push({ text: t('fxWin'), tone: 'gold', icon: 'win', pr: 9 });
    if (mv.jk) parts.push({ text: t('fxJoker'), tone: 'violet', icon: 'joker', pr: 8 });
    else if (st) parts.push({ text: t('fxSteal', { n: st }), tone: 'violet', icon: 'steal', pr: 7 });
    if (mv.n >= 6) parts.push({ text: t('fxMega', { n: mv.n }), tone: 'gold', icon: 'combo', pr: 6.5 });
    if (mv.lg >= 7) parts.push({ text: t('fxLong', { n: mv.lg }), tone: 'gold', icon: 'long', pr: 6 });
    if (mv.wr) parts.push({ text: t('fxWrap'), tone: 'cyan', icon: 'wrap', pr: 5 });
    if (mv.g4) parts.push({ text: t('fxGroup4'), tone: 'mint', icon: 'group4', pr: 4 });
    if (mv.n >= 4 && mv.n < 6) parts.push({ text: t('fxCombo', { n: mv.n }), tone: 'gold', icon: 'combo', pr: 3 });
    if (mv.m) parts.push({ text: t('fxMeld', { n: mv.m }), tone: 'mint', icon: 'meld', pr: 2 });
    if (mv.ext && !parts.length && mv.n >= 2) parts.push({ text: t('fxExtendBig'), tone: 'cyan', icon: 'extend', pr: 1 });
    if (!parts.length) return null;
    parts.sort((a, b) => b.pr - a.pr);
    return { text: parts[0].text, tone: parts[0].tone, icon: parts[0].icon, sub: parts.slice(1, 3).map(p => p.text).join(' · ') };
  }

  /**
   * A finished move, on every screen.
   * ctx: { isMe, added, extended:[[ids]], stolenSets:[[ids]], freshSets:[[ids]],
   *        tileRect(id), beforeRect(id), kind(id),
   *        markTile(id, cls, delay), markSet(ids, cls, label, tone, delay), markChip(p),
   *        tableRect(), gridEl(), t(key, vars) }
   */
  function playMove(mv, ctx) {
    if (!mv) return;
    note('move:' + mv.k, mv);
    if (mv.k === 'draw') {
      if (!ctx.isMe) { ctx.markChip(mv.p); SFX().whoosh(); }
      return;
    }
    if (mv.k !== 'play') return;
    const S = SFX();
    hold(900);
    const added = ctx.added.slice().sort((a, b) => { const A = ctx.tileRect(a), B = ctx.tileRect(b); return A && B ? (A.top - B.top) || (A.left - B.left) : 0; });
    const base = ctx.isMe ? 40 : 460;   // others' tiles fly in first

    // stolen tiles: a violet arc from where they were
    (mv.st || []).forEach((id, i) => {
      const a = ctx.beforeRect(id), b = ctx.tileRect(id), d = i * 120;
      note('steal', id);
      if (a && b) P.arc(mid(a), mid(b), TONE.violet, 520, d);
      ctx.markTile(id, 'fx-steal', d + 380);
      at(d, () => S.steal());
      at(d + 520, () => { const r = ctx.tileRect(id); if (r) { const c = mid(r); P.sparkle(c.x, c.y, 14, { k: 'violet', v0: 40, v1: 160 }); } });
    });
    // laid tiles: each pops in place with a few sparkles and a rising note
    const step = Math.max(34, Math.min(80, 640 / Math.max(1, added.length)));
    added.forEach((id, i) => {
      ctx.markTile(id, 'fx-pop', base + i * step);
      at(base + i * step, () => {
        const r = ctx.tileRect(id);
        if (r) { const c = mid(r); P.sparkle(c.x, c.y, 7, { k: ctx.kind(id), v0: 30, v1: 120, jx: r.width * 0.3, jy: r.height * 0.3 }); }
        S.pluck(i);
      });
    });
    const after = base + added.length * step + 100;
    // sets that grew: a light runs along the frame, with a small chip label
    (ctx.extended || []).forEach((ids, j) => {
      const plus = ids.filter(id => ctx.added.includes(id)).length;
      ctx.markSet(ids, 'fx-extend', plus ? ctx.t('fxExtend', { n: plus }) : '', 'cyan', after + j * 120);
      if (j === 0) at(after, () => S.sparkle());
      note('extend');
    });
    (ctx.stolenSets || []).forEach(ids => ctx.markSet(ids, 'fx-stolen', ctx.t('fxStealTag'), 'violet', after));
    (ctx.freshSets || []).forEach(ids => ctx.markSet(ids, 'fx-new', '', 'mint', after));

    const big = mv.n >= 6 || mv.lg >= 9 || mv.jk;
    if (big && !mv.win) at(after - 40, () => { note('big'); punch(ctx.gridEl()); wash(ctx.tableRect(), TONE.gold, 1300); S.boom(); });
    if (mv.wr) note('wrap');
    if (mv.g4) note('group4');
    const h = pickHeadline(mv, ctx.t);
    hold(after + (h ? 2200 : 500) + (mv.win ? 1600 : 0));
    if (h) at(after + 40, () => {
      const r = ctx.tableRect();
      // bottom of the table area: the spare row is empty, so no tiles are covered
      if (r) card(h.text, h.sub, h.tone, h.icon, { x: r.left + r.width / 2, y: r.bottom - (mv.win ? 100 : 76) }, !!mv.win);
      if (!big && !mv.win && h.tone !== 'violet') S.fanfare();
    });
    if (mv.win) at(after + 120, () => victory(ctx.tableRect()));
  }

  function victory(rect) {
    note('win');
    SFX().win();
    if (!rect) return;
    wash(rect, TONE.gold, 2200);
    P.confetti({ left: rect.left, right: rect.right, top: rect.top }, 160);
    at(500, () => P.confetti({ left: rect.left, right: rect.right, top: rect.top }, 90));
  }

  function setLevel(l) { level = l === 'lite' || l === 'off' ? l : 'full'; document.documentElement.dataset.fx = level; }
  function clear() { busyUntil = 0; timers.forEach(clearTimeout); timers.clear(); }

  root.RK = root.RK || {};
  root.RK.FX = { setLevel, tier, log, note, busyFor, hold, TONE, P, card, turnBanner, punch, wash, deny, playMove, victory, pickHeadline, clear };
})(typeof globalThis !== 'undefined' ? globalThis : this);
