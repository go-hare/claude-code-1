import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

const nme = 214521154
const head = asciiWindow(buf, nme - 40000, nme)
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-nme-40k.txt',
  head,
)

const hits = []
let idx = 0
while (hits.length < 20) {
  const i = head.indexOf('as XX', idx)
  if (i < 0) break
  hits.push(head.slice(Math.max(0, i - 80), i + 40))
  idx = i + 5
}
console.log('as XX hits', hits.length, hits)

const xxCall = head.lastIndexOf('XX(')
console.log('last XX( in 40k', xxCall)

// also search {namespace:"pluginRegistry",file:e} factory module exports
const fac = 207948145
const facHead = asciiWindow(buf, fac - 500, fac + 200)
console.log('factory-ctx', facHead)

// Find `XX=function` or `var XX=` or export alias of pluginRegistry helper
for (const n of [
  'pluginRegistry:(e)=>({namespace:"pluginRegistry",file:e})',
  'XX=(e,t)',
  'function XX(e,t){return',
]) {
  const i = buf.indexOf(Buffer.from(n))
  console.log(n, i)
}

// Search unique: return{namespace:"pluginRegistry",file:e}
const ret = buf.indexOf(Buffer.from('return{namespace:"pluginRegistry",file:'))
console.log('return-key', ret)
if (ret >= 0) console.log(asciiWindow(buf, ret - 150, ret + 120))
