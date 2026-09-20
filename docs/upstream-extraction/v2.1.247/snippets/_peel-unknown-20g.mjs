import { readFileSync, writeFileSync } from 'fs'

const buf247 = readFileSync(
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

function allHits(buf, needle, from = 0, to = buf.length) {
  const n = Buffer.from(needle)
  const hits = []
  let i = from
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0 || j >= to) break
    hits.push(j)
    i = j + n.length
    if (hits.length > 30) break
  }
  return hits
}

function dumpAround(name, pos, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# pos=${pos}\n\n${asciiWindow(buf247, Math.max(0, pos - before), pos + after)}\n`,
  )
  console.log('OK', name, pos)
}

const start = 235400000
const end = 235571600
const needles = [
  'async function ki(',
  'function ki(',
  'function ki(e,',
  'async function ki(e,',
  'perFileMs',
  'totalMs',
  'workspaceDiff',
  'skippedLarge',
  'perFileStats',
  'kind:"working-tree"',
  'get_workspace_diff',
]

console.log('=== in initReplBridge module window ===')
for (const n of needles) {
  const hits = allHits(buf247, n, start, end)
  console.log(hits.length, JSON.stringify(n), hits)
}

// also search a bit earlier
for (const n of ['async function ki(', 'function ki(e,t,n)', 'function ki(e,t)', 'perFileMs']) {
  const hits = allHits(buf247, n, 235200000, 235580000)
  console.log('wide', hits.length, JSON.stringify(n), hits)
}

const kiAnt = buf247.indexOf(Buffer.from('ki(a,n,t)'))
dumpAround('gold-20-ki-def-back.txt', kiAnt, 30000, 500)

// dump all perFileMs
const pf = allHits(buf247, 'perFileMs')
console.log('perFileMs all', pf)
pf.forEach((i, idx) => {
  dumpAround(`gold-20-perFileMs-${idx}.txt`, i, 1500, 2500)
})

// timeout constants near get_workspace_diff case
const ye = buf247.indexOf(Buffer.from('ye(W(o.signal)'))
dumpAround('gold-20-ye-full.txt', ye, 8000, 2000)
