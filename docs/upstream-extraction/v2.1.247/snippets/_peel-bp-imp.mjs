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

for (const n of ['as bp,', 'as bp}', 'as $l,', 'as $l}', 'bp as ', '$l as ']) {
  const hits = allHits(n).filter(i => i > 215180000 && i < 215258000)
  console.log(n, hits)
  for (const i of hits) console.log('  ', ascii(i - 60, i + 30))
}

// global as bp in 214-216
for (const n of ['as bp,', 'as $l,']) {
  const hits = allHits(n)
  console.log('all', n, hits.slice(0, 8))
  for (const i of hits.slice(0, 4)) console.log('  ', i, ascii(i - 50, i + 20))
}
