// Host engine for the word crossword: crosshost.js with this game's rules and bot.
(function (root) {
  'use strict';
  const M = (root.RK && root.RK.WordRules) || require('./wordrules.js');
  const Bot = (root.RK && root.RK.WordBot) || require('./wordbot.js');
  const CrossHost = (root.RK && root.RK.CrossHost) || require('./crosshost.js');
  const api = CrossHost(M, Bot, 'word');
  root.RK = root.RK || {};
  root.RK.WordHost = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
