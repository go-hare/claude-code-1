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

for (const n of ['O4n=', ',O4n=', 'O4n=', 'nYn=', ',nYn=', 'nYn=']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 15))
  for (const i of hits.slice(0, 4)) console.log('  ', i, ascii(i, i + 40))
}

// var block near sA
console.log('\n==== before sA 2k ====')
console.log(ascii(215248000, 215251200).slice(-800))
