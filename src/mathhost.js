// Host engine for the math crossword: crosshost.js with this game's rules and bot.
(function (root) {
  'use strict';
  const M = (root.RK && root.RK.MathRules) || require('./mathrules.js');
  const Bot = (root.RK && root.RK.MathBot) || require('./mathbot.js');
  const CrossHost = (root.RK && root.RK.CrossHost) || require('./crosshost.js');
  const api = CrossHost(M, Bot, 'math');
  root.RK = root.RK || {};
  root.RK.MathHost = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
