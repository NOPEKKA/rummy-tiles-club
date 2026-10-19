// Build the game from src/ into:
//   docs/index.html        GitHub Pages site (loads docs/firebase-config.js for online play)
//   docs/words.js          the word list for Word Crossword, loaded only when that game is played
//   dist/rummy-tiles.html  the claude.ai Artifact page (online play through claude.ai rooms; word list inside)
//   dist/test.html         the Artifact page wrapped in a doctype, for local checks
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const Dawg = createRequire(import.meta.url)('./tools/dawg.cjs');
const src = f => readFileSync(join(here, 'src', f), 'utf8');
const order = ['config.js', 'prefs.js', 'rack.js', 'rules.js', 'tablegrid.js', 'moveinfo.js', 'host.js',
  'mathrules.js', 'mathbot.js', 'crosshost.js', 'mathhost.js', 'wordrules.js', 'wordbot.js', 'wordhost.js', 'words.js',
  'i18n.js', 'skins.js', 'sfx.js', 'fx.js', 'net.js', 'netfb.js', 'crossui.js', 'mathui.js', 'wordui.js', 'app.js'];
const js = order.map(f => `// ---- ${f} ----\n${src(f)}`).join('\n');
if (js.includes('</script')) throw new Error('script would close early');
const page = src('template.html')
  .replace('/*@CSS*/', () => src('style.css'))
  .replace('/*@JS*/', () => js);

// The word list (ENABLE, public domain): words of 2–15 letters as a packed DAWG,
// stored as four byte planes (packs smaller), gzip, base64. src/words.js unpacks it.
const words = Dawg.clean(readFileSync(join(here, 'data', 'enable1.txt'), 'utf8'), 15);
const dawg = Dawg.pack(Dawg.build(words));
const n = dawg.length, planes = Buffer.alloc(n * 4);
for (let i = 0; i < n; i++) { const v = dawg[i]; planes[i] = v & 255; planes[n + i] = (v >>> 8) & 255; planes[2 * n + i] = (v >>> 16) & 255; planes[3 * n + i] = v >>> 24; }
const b64 = gzipSync(planes, { level: 9 }).toString('base64');
const wordsJs = `// ENABLE word list (public domain): ${words.length} words of 2–15 letters, packed (see tools/dawg.cjs).\n`
  + `(globalThis.RK = globalThis.RK || {}).WORDS_B64 = '${b64}';\n`;
const wordsTag = createHash('sha256').update(b64).digest('hex').slice(0, 10);

// claude.ai Artifact: one file, so the word list goes inside
mkdirSync(join(here, 'dist'), { recursive: true });
const artifact = page.replace('<div id="app"></div>', () => '<div id="app"></div>\n<script>\n' + wordsJs + '</script>');
writeFileSync(join(here, 'dist', 'rummy-tiles.html'), artifact);
const head = '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';
writeFileSync(join(here, 'dist', 'test.html'), head + '</head><body>' + artifact + '</body></html>');

// GitHub Pages: same page, plus the Firebase config script before the game script;
// the word list stays a separate file that only Word Crossword fetches
mkdirSync(join(here, 'docs'), { recursive: true });
const site = page.replace('<div id="app"></div>', () => '<div id="app"></div>\n<script src="firebase-config.js"></script>\n'
  + `<script>window.RK_WORDS_URL = 'words.js?v=${wordsTag}';</script>`);
writeFileSync(join(here, 'docs', 'index.html'),
  head + '<meta name="description" content="Three tile games for 2–4 players: Rummikub-style Rummy, Math Crossword and Word Crossword. Play friends online or practise against bots.">'
  + '<meta name="theme-color" content="#163a33"><style>html{color-scheme:dark}</style></head><body>' + site + '</body></html>\n');
writeFileSync(join(here, 'docs', 'words.js'), wordsJs);
const cfgPath = join(here, 'docs', 'firebase-config.js');
if (!existsSync(cfgPath)) writeFileSync(cfgPath, readFileSync(join(here, 'firebase-config.example.js'), 'utf8'));
writeFileSync(join(here, 'docs', '.nojekyll'), '');
console.log('built', (page.length / 1024).toFixed(1) + ' KiB page, ' + (wordsJs.length / 1024).toFixed(1) + ' KiB word list (' + words.length + ' words)');
