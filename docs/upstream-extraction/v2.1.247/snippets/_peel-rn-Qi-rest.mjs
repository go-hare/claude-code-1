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
console.log('==== rn @210739222 ====')
console.log(ascii(210739180, 210739400))
console.log('\n==== Qi rest ====')
console.log(ascii(210740396, 210741140))
console.log('\n==== Ne rest ====')
console.log(ascii(210739335, 210740100))
console.log('\n==== Or rest ====')
console.log(ascii(210559553, 210561200))
console.log('\n==== nt Ie ====')
console.log(ascii(210559400, 210559560))
