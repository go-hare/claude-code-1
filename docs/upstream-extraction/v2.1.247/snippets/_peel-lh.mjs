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

const exp = 211612003
console.log('export ctx:\n', asciiWindow(buf, exp - 400, exp + 80))

// find function lh( near export module
const modStartGuess = 211500000
let from = 211000000
let n = 0
const needles = [
  'function lh(e,t){',
  'function lh(e){',
  'function lh(',
  'lh=(e,t)',
  'lh=(e)',
]
for (const needle of needles) {
  from = 206000000
  n = 0
  while (n < 8) {
    const i = buf.indexOf(Buffer.from(needle), from)
    if (i < 0 || i > 214000000) break
    const dist = i - exp
    if (Math.abs(dist) < 2_000_000 || needle.includes('lh(e')) {
      console.log(needle, i, 'distExp', dist)
      console.log(' ', asciiWindow(buf, i, i + 350))
    }
    from = i + needle.length
    n++
  }
}

// also J8 = Oeb = ph from same export list: ph as Oeb
console.log('\n--- J8/ph ---')
from = 206000000
n = 0
while (n < 6) {
  const i = buf.indexOf(Buffer.from('function ph(e,t){'), from)
  if (i < 0 || i > 214000000) break
  console.log('ph', i, asciiWindow(buf, i, i + 300))
  from = i + 10
  n++
}
