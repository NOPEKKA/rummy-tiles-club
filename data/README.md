# Word list

`enable1.txt` is ENABLE (Enhanced North American Benchmark Lexicon) by Alan Beale and M. Cooper, placed in the public domain.
Copy taken 2026-10-19 from https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt
(172,823 words, SHA-256 `3f16130220645692ed49c7134e24a18504c2ca55b3c012f7290e3e77c63b1a89`).

Word Crossword uses the 168,551 words of 2–15 letters. `npm run build` packs them into a DAWG
(`tools/dawg.cjs`) and writes `docs/words.js`; the Artifact build carries the same data inside the page.
ENABLE has no QI or ZA (they came later in other lists), but has XU, JO, KA and the like.
