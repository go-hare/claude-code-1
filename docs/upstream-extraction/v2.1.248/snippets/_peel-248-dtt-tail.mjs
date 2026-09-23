import { readFileSync } from 'fs'
const b = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe',
)
const n = Buffer.from('process_exit:"Automatic continue cancelled')
const i = b.indexOf(n)
console.log(i)
let s = ''
for (let j = i; j < i + 400 && j < b.length; j++) {
  const c = b[j]
  s += c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126) ? String.fromCharCode(c) : '.'
}
console.log(s)
