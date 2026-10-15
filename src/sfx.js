// Sound: every effect is synthesised with WebAudio (no files). The context is
// only created after the first tap or key press, as browsers require.
(function (root) {
  'use strict';
  let ac = null, out = null, wet = null, noiseBuf = null, unlocked = false;
  let enabled = true, volume = 0.7;
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];   // major pentatonic steps
  const hz = semis => 523.25 * Math.pow(2, semis / 12);             // from C5

  function boot() {
    if (ac) return ac;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try { ac = new AC(); } catch (e) { return null; }
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 8; comp.attack.value = 0.004; comp.release.value = 0.2;
    out = ac.createGain(); out.gain.value = level();
    out.connect(comp); comp.connect(ac.destination);
    // a short shimmering echo for the magical bits
    const d = ac.createDelay(1); d.delayTime.value = 0.17;
    const fb = ac.createGain(); fb.gain.value = 0.38;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
    wet = ac.createGain(); wet.gain.value = 0.5;
    wet.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(out);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    return ac;
  }
  const level = () => (enabled ? Math.pow(volume, 1.6) * 0.9 : 0);
  function unlock() {
    if (!boot()) return;
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    unlocked = true;
  }
  ['pointerdown', 'keydown', 'touchend'].forEach(ev => root.addEventListener && root.addEventListener(ev, unlock, { capture: true, passive: true }));
  const ready = () => !!ac && unlocked && ac.state === 'running' && enabled && volume > 0;

  function tone(p) {
    if (!ready()) return;
    const t = ac.currentTime + (p.at || 0), a = p.a || 0.005, d = p.d || 0.2, v = p.v || 0.15;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = p.type || 'sine';
    o.frequency.setValueAtTime(p.f, t);
    if (p.f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, p.f2), t + a + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0005, t + a + d);
    let last = g;
    o.connect(g);
    if (p.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = p.lp; g.connect(f); last = f; }
    last.connect(out);
    if (p.send) { const s = ac.createGain(); s.gain.value = p.send; last.connect(s); s.connect(wet); }
    o.start(t); o.stop(t + a + d + 0.05);
  }
  function noise(p) {
    if (!ready()) return;
    const t = ac.currentTime + (p.at || 0), d = p.d || 0.2;
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = p.type || 'bandpass'; f.frequency.setValueAtTime(p.f || 1200, t);
    if (p.f2) f.frequency.exponentialRampToValueAtTime(p.f2, t + d);
    f.Q.value = p.q || 1;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(p.v || 0.1, t + (p.a || 0.01)); g.gain.exponentialRampToValueAtTime(0.0005, t + d);
    src.connect(f); f.connect(g); g.connect(out);
    if (p.send) { const s = ac.createGain(); s.gain.value = p.send; g.connect(s); s.connect(wet); }
    src.start(t); src.stop(t + d + 0.05);
  }

  const S = {
    // a tile lands on the table or in a cell
    place(i) { tone({ f: 330 + (i || 0) * 18, type: 'triangle', d: 0.07, v: 0.16 }); noise({ f: 2600, q: 0.8, d: 0.04, v: 0.06 }); },
    pick() { tone({ f: 600, f2: 760, type: 'sine', d: 0.06, v: 0.05 }); },
    // a set on your table just became legal
    chime(len) { const n = Math.min(5, Math.max(2, len - 1)); for (let i = 0; i < n; i++) tone({ f: hz(PENTA[i + 2]), type: 'sine', at: i * 0.055, d: 0.4, v: 0.1, send: 0.45 }); },
    // one note per tile in a combo, climbing
    pluck(i) { const s = PENTA[Math.min(PENTA.length - 1, i || 0)]; tone({ f: hz(s - 12), type: 'triangle', d: 0.3, v: 0.13, send: 0.3 }); tone({ f: hz(s), type: 'sine', d: 0.18, v: 0.05 }); },
    whoosh(at) { noise({ at: at || 0, f: 500, f2: 2600, q: 1.4, d: 0.32, v: 0.11, a: 0.08 }); },
    sparkle(at) { for (let i = 0; i < 6; i++) tone({ f: hz(PENTA[7 + (i * 3) % 6]), type: 'sine', at: (at || 0) + i * 0.045, d: 0.22, v: 0.045, send: 0.6 }); },
    steal() { tone({ f: 1046, f2: 392, type: 'sawtooth', d: 0.24, v: 0.06, lp: 2400 }); tone({ f: 784, type: 'square', at: 0.16, d: 0.07, v: 0.045, lp: 3000 }); tone({ f: 1175, type: 'square', at: 0.25, d: 0.1, v: 0.045, lp: 3000, send: 0.3 }); },
    boom() { tone({ f: 120, f2: 38, type: 'sine', d: 0.7, v: 0.34 }); noise({ f: 700, f2: 120, type: 'lowpass', d: 0.6, v: 0.16 }); },
    rise(at) { tone({ f: 220, f2: 880, type: 'sawtooth', at: at || 0, a: 0.25, d: 0.15, v: 0.05, lp: 1800, send: 0.4 }); },
    fanfare(at) { [0, 4, 7, 12].forEach((s, i) => tone({ f: hz(s - 12), type: 'square', at: (at || 0) + i * 0.09, d: 0.22, v: 0.06, lp: 2600, send: 0.3 })); tone({ f: hz(0), type: 'triangle', at: (at || 0) + 0.36, d: 0.7, v: 0.1, send: 0.5 }); },
    turn() { tone({ f: hz(7), type: 'sine', d: 0.5, v: 0.12, send: 0.5 }); tone({ f: hz(16), type: 'sine', at: 0.12, d: 0.7, v: 0.1, send: 0.5 }); noise({ f: 5000, q: 2, d: 0.3, v: 0.02, send: 0.6 }); },
    buzz() { tone({ f: 150, type: 'square', d: 0.16, v: 0.07, lp: 800 }); tone({ f: 120, type: 'square', at: 0.09, d: 0.16, v: 0.06, lp: 800 }); },
    deal(i) { tone({ f: 260 + (i % 7) * 22, type: 'triangle', d: 0.05, v: 0.07 }); },
    win() { [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone({ f: hz(s - 12), type: 'triangle', at: i * 0.08, d: 0.5, v: 0.11, send: 0.45 })); [0, 4, 7].forEach(s => tone({ f: hz(s), type: 'sine', at: 0.62, d: 1.4, v: 0.08, send: 0.6 })); },
    setEnabled(on) { enabled = !!on; if (out) out.gain.value = level(); },
    setVolume(v) { volume = Math.max(0, Math.min(1, Number(v) || 0)); if (out) out.gain.value = level(); },
    unlock
  };

  root.RK = root.RK || {};
  root.RK.SFX = S;
})(typeof globalThis !== 'undefined' ? globalThis : this);
