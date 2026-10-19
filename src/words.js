// Loads Word Crossword's word list, once. The Artifact build carries it inside the
// page; GitHub Pages keeps it in words.js next to the page and fetches it only
// when someone plays this game. Either way it is gzip in base64 (see build.mjs).
(function (root) {
  'use strict';
  const W = { state: 'idle', error: null };
  let job = null;

  function script(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { s.remove(); reject(new Error('words_fetch')); };
      document.head.append(s);
    });
  }
  async function gunzip(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('words_old');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
    return new Uint8Array(await out.arrayBuffer());
  }

  /** Resolves once the word list is in WordRules (straight away if it already is). */
  W.load = function () {
    const R = root.RK.WordRules;
    if (R.hasDict()) { W.state = 'ready'; return Promise.resolve(true); }
    if (job) return job;
    W.state = 'loading'; W.error = null;
    job = (async () => {
      if (!root.RK.WORDS_B64) await script(root.RK_WORDS_URL || 'words.js');
      const b64 = root.RK.WORDS_B64;
      if (!b64) throw new Error('words_fetch');
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      R.setDict(R.unpack(await gunzip(bytes)));
      root.RK.WORDS_B64 = null;          // the packed list is all we keep
      W.state = 'ready';
      return true;
    })().catch(e => { W.state = 'error'; W.error = (e && e.message) || 'words_fetch'; job = null; throw e; });
    return job;
  };

  root.RK = root.RK || {};
  root.RK.Words = W;
})(typeof globalThis !== 'undefined' ? globalThis : this);
