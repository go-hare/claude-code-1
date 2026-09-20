import { readFileSync } from 'fs'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
function ascii(s, e) {
  let out = ''
  for (let j = s; j < e && j < buf.length; j++) {
    const c = buf[j]
    out +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return out
}
const n = Buffer.from('yCt=')
let from = 0
let hits = 0
while (hits < 8) {
  const i = buf.indexOf(n, from)
  if (i < 0) break
  console.log(i, ascii(i - 20, i + 30))
  from = i + 4
  hits++
}
const n2 = buf.indexOf(Buffer.from('var yCt'))
console.log('var yCt', n2, n2 >= 0 ? ascii(n2, n2 + 40) : '')
const n3 = buf.indexOf(Buffer.from('yCt as'))
console.log('yCt as', n3, n3 >= 0 ? ascii(n3 - 20, n3 + 20) : '')
const n4 = buf.indexOf(Buffer.from(' as yCt'))
console.log('as yCt', n4, n4 >= 0 ? ascii(n4 - 40, n4 + 20) : '')
