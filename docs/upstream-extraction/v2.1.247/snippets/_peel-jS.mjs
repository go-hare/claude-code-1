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

const mr = 214541129
const before = asciiWindow(buf, mr - 15000, mr)
const hits = []
let idx = 0
while (hits.length < 10) {
  const i = before.indexOf('jS', idx)
  if (i < 0) break
  hits.push(before.slice(Math.max(0, i - 50), i + 80))
  idx = i + 2
}
console.log('jS-before-MR', hits)

// function jS
let from = 214400000
let n = 0
const needle = Buffer.from('function jS(')
while (n < 10) {
  const i = buf.indexOf(needle, from)
  if (i < 0 || i > 214600000) break
  console.log('fn jS', i, asciiWindow(buf, i, i + 300))
  from = i + 10
  n++
}

from = 214400000
n = 0
const v = Buffer.from('var jS=')
while (n < 8) {
  const i = buf.indexOf(v, from)
  if (i < 0 || i > 214600000) break
  console.log('var jS', i, asciiWindow(buf, i, i + 200))
  from = i + 6
  n++
}

// import as jS near MR
const asJs = [...before.matchAll(/as jS[,}]/g)]
console.log(
  'as jS',
  asJs.map((m) => before.slice(Math.max(0, m.index - 70), m.index + 25)),
)

// YUo / $Ln / fm.system
for (const n of ['function YUo(', 'function $Ln(', 'fm.system=']) {
  const i = buf.indexOf(Buffer.from(n), 214400000)
  console.log(n, i, i > 0 ? asciiWindow(buf, i, i + 220) : '')
}
