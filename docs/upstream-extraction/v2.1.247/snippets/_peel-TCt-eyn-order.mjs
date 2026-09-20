import { readFileSync } from 'fs'
const t = readFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-20-jes-fn.txt',
  'utf8',
)
for (const k of ['eYn', 'tYn', 'A3a', 'hs(', 'P=h', 'Z4n', 'adminDir', 'X4n']) {
  let from = 0
  let n = 0
  while (n < 4) {
    const i = t.indexOf(k, from)
    if (i < 0) break
    console.log('\n====', k, i, '====')
    console.log(t.slice(Math.max(0, i - 50), i + 160))
    from = i + k.length
    n++
  }
}
