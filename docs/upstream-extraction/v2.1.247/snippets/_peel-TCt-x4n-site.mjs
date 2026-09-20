import { readFileSync } from 'fs'
const t = readFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-20-jes-fn.txt',
  'utf8',
)
const keys = [
  'X4n',
  'QJb',
  'adminDir',
  'kind:"made"',
  'await using',
  'hardenForDeviceSessions===!0',
]
for (const k of keys) {
  let from = 0
  let n = 0
  while (n < 3) {
    const i = t.indexOf(k, from)
    if (i < 0) break
    console.log('\n====', k, i, '====')
    console.log(t.slice(Math.max(0, i - 100), i + 280))
    from = i + k.length
    n++
  }
  if (n === 0) console.log('MISS', k)
}
