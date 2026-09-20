import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function ascii(start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

const base = 'docs/upstream-extraction/v2.1.247/snippets/'
writeFileSync(base + 'gold-forged-V.txt', ascii(210541503, 210542200))
console.log('==== V ====')
console.log(ascii(210541503, 210542200))

console.log('\n==== J4n as @212820547 ====')
console.log(ascii(212820480, 212821100))

console.log('\n==== function before J4n export ====')
const i = 212820547
console.log(ascii(i - 400, i + 80))

writeFileSync(base + 'gold-forged-mXo.txt', ascii(215274686, 215275400))
console.log('\n==== mXo ====')
console.log(ascii(215274686, 215275500))

console.log('\n==== oe un ne near pn ====')
console.log(ascii(210533900, 210534280))
