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

function allHits(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

console.log('==== _837 d as Rld — function d ====')
console.log(ascii(206922800, 206924200))

// find function d before export
console.log('\n==== last function d before 206923614 ====')
let pos = 206923614
while (pos > 206900000) {
  const i = buf.lastIndexOf(Buffer.from('function d('), pos)
  if (i < 0) break
  console.log(i, ascii(i, i + 400))
  if (i < 206923614) break
  pos = i - 1
}

console.log('\n==== _843/string module p/d/s/y ====')
console.log(ascii(206465900, 206466700))

console.log('\n==== let qt= around 210387126 ====')
console.log(ascii(210386900, 210387400))

console.log('\n==== let qt= around 211008191 ====')
console.log(ascii(211007950, 211008400))

console.log('\n==== function qt in 210532000-210556000 ====')
const sliceStart = 210532000
const slice = buf.subarray(sliceStart, 210556000)
const rel = slice.indexOf(Buffer.from('function qt'))
console.log('rel function qt', rel, rel >= 0 ? ascii(sliceStart + rel, sliceStart + rel + 200) : '')
const rel2 = slice.indexOf(Buffer.from('qt=async'))
console.log('rel qt=async', rel2)
const rel3 = slice.indexOf(Buffer.from('qt='))
console.log('first qt= in slice', rel3, rel3>=0 ? ascii(sliceStart+rel3-20, sliceStart+rel3+80) : '')

// count of qt( in to body
console.log('\n==== all qt( 210552-210557 ====')
let from = 210552137
while (from < 210557000) {
  const i = buf.indexOf(Buffer.from('qt('), from)
  if (i < 0 || i > 210557000) break
  console.log(i, ascii(i - 10, i + 60))
  from = i + 3
}
