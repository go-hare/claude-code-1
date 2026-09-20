import { readFileSync } from 'fs'

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

const lh = 211422617
const before = asciiWindow(buf, lh - 8000, lh + 20)
let idx = 0
let n = 0
while (n < 15) {
  const i = before.lastIndexOf('function xe(')
  // search forward
  const j = before.indexOf('function xe(', idx)
  if (j < 0) break
  console.log('xe', j, before.slice(j, j + 280))
  idx = j + 10
  n++
}

// also function xe(e){return e.every
const every = buf.indexOf(Buffer.from('function xe(e){return e.every'), 211000000)
console.log('xe.every', every, every > 0 ? asciiWindow(buf, every, every + 200) : '')

const every2 = buf.indexOf(Buffer.from('function xe(r){return r.every'), 211000000)
console.log('xe.r.every', every2, every2 > 0 ? asciiWindow(buf, every2, every2 + 200) : '')

// C(e) isValidStoragePathSegment style
const c = buf.indexOf(Buffer.from('function xe(e){return e.every((t)=>'), 211000000)
console.log('xe.every-t', c, c > 0 ? asciiWindow(buf, c, c + 250) : '')
