// Build the game from src/ into:
//   docs/index.html        GitHub Pages site (loads docs/firebase-config.js for online play)
//   dist/rummy-tiles.html  the claude.ai Artifact page (online play through claude.ai rooms)
//   dist/test.html         the Artifact page wrapped in a doctype, for local checks
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = f => readFileSync(join(here, 'src', f), 'utf8');
const order = ['config.js', 'prefs.js', 'rack.js', 'rules.js', 'tablegrid.js', 'moveinfo.js', 'host.js', 'mathrules.js', 'mathbot.js', 'mathhost.js', 'i18n.js', 'skins.js', 'sfx.js', 'fx.js', 'net.js', 'netfb.js', 'mathui.js', 'app.js'];
const js = order.map(f => `// ---- ${f} ----\n${src(f)}`).join('\n');
if (js.includes('</script')) throw new Error('script would close early');
const page = src('template.html')
  .replace('/*@CSS*/', () => src('style.css'))
  .replace('/*@JS*/', () => js);

// claude.ai Artifact
mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist', 'rummy-tiles.html'), page);
const head = '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';
writeFileSync(join(here, 'dist', 'test.html'), head + '</head><body>' + page + '</body></html>');

// GitHub Pages: same page, plus the Firebase config script before the game script
mkdirSync(join(here, 'docs'), { recursive: true });
const site = page.replace('<div id="app"></div>', '<div id="app"></div>\n<script src="firebase-config.js"></script>');
writeFileSync(join(here, 'docs', 'index.html'),
  head + '<meta name="description" content="Two tile games for 2–4 players: Rummikub-style Rummy and Math Crossword. Play friends online or practise against bots.">'
  + '<meta name="theme-color" content="#163a33"><style>html{color-scheme:dark}</style></head><body>' + site + '</body></html>\n');
const cfgPath = join(here, 'docs', 'firebase-config.js');
if (!existsSync(cfgPath)) writeFileSync(cfgPath, readFileSync(join(here, 'firebase-config.example.js'), 'utf8'));
writeFileSync(join(here, 'docs', '.nojekyll'), '');
console.log('built', (page.length / 1024).toFixed(1) + ' KiB');
