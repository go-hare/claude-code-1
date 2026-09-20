import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const base = 'docs/upstream-extraction/v2.1.247/snippets/'

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

function extractFrom(offset, max = 800) {
  let i = offset
  let depth = 0
  let seen = false
  while (i < offset + max && i < buf.length) {
    if (buf[i] === 123) {
      depth++
      seen = true
    } else if (buf[i] === 125) {
      depth--
      if (seen && depth === 0) return ascii(offset, i + 1)
    }
    i++
  }
  return ascii(offset, Math.min(offset + max, buf.length))
}

const needles = [
  'function He(',
  'function nI(',
  'function Bc(',
  ' as He,',
  ' as nI,',
  ' as Bc,',
  ' as He}',
  ' as nI}',
  ' as Bc}',
  'as He,',
  'as nI,',
  'as Bc,',
  '$3o(e,nI())',
  'Z3o(e,nI())',
  'Bc(s.stderr',
  'bp($l(Bc(',
  'JVb as',
  'Pzd as',
  'function m(){return o.O_RDONLY',
  'O_NOFOLLOW|o.O_NONBLOCK',
  'O_RDONLY|d()',
  'O_RDONLY|nI()',
]

for (const n of needles) {
  const hits = allHits(n)
  const win = hits.filter(i => i > 206000000 && i < 216000000)
  console.log('\n====', JSON.stringify(n), 'count', hits.length, 'win', win.length)
  for (const i of (win.length ? win : hits).slice(0, 12)) {
    console.log(i, ascii(i - 80, i + 160).replace(/\n/g, '\\n'))
  }
}
