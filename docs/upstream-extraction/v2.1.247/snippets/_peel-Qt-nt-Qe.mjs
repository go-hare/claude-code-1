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

function findAll(needle, limit = 20) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function dump(name, i, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i)
}

const needles = [
  'if(nt(`${t}@${s}`))return!1;if(Qe(`${t}@${s}`))return!1',
  'async function Qt(e,t,n,o,s=',
  'function Qe(e){',
  'function nt(e){',
  'function QLn(',
  'function jS(',
  'function kB(e){',
]

for (const n of needles) {
  const hits = findAll(n, 8)
  console.log(JSON.stringify(n), hits)
  if (hits[0] !== undefined) {
    dump(
      `gold-dig-${n.slice(0, 24).replace(/[^a-zA-Z0-9]+/g, '-')}.txt`,
      hits[0],
      80,
      1200,
    )
  }
}

// Walk back from Qt call to find nearby function Qe/nt in same region
const qtHits = findAll('async function Qt(e,t,n,o,s=', 4)
if (qtHits[0] !== undefined) {
  dump('gold-dig-Qt-full.txt', qtHits[0], 2000, 800)
}
