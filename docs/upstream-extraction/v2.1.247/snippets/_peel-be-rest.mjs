import { readFileSync } from 'fs'
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
console.log(ascii(210534511, 210535450))
console.log('\n==== an uZb ====')
const i = buf.indexOf(Buffer.from('uZb as an'))
console.log(i, i > 0 ? ascii(i - 80, i + 20) : '')
const asUzb = buf.indexOf(Buffer.from(' as uZb'))
console.log('as uZb', asUzb, asUzb > 0 ? ascii(asUzb - 40, asUzb + 15) : '')
