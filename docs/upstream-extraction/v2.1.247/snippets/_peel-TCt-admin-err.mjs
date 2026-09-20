import { readFileSync } from 'fs'
const t = readFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-20-jes-fn.txt',
  'utf8',
)
const i = t.indexOf('T.reason==="placement"')
console.log(t.slice(i, i + 900))
const y = t.indexOf('yCt')
console.log('\n==== yCt context ====')
console.log(t.slice(Math.max(0, y - 40), y + 80))
const v = t.indexOf('var yCt')
console.log('var yCt', v)
const v2 = t.indexOf('yCt=')
console.log('yCt=', v2, t.slice(v2, v2 + 40))
