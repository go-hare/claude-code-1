import {
  loadSea,
  allHits,
  asciiSlice,
  extractFnAt,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()

// Find write path that sets softWrap from qv's E array — search near Su / writeLine
const needles = [
  'id(di.',
  'id(ce[',
  'id(E[',
  'id(u[',
  'Ao|',
  '|Ao',
  'ContinuationElidedSep',
  'swBits[',
  'softWrap[',
]

const lo = 189600000
const hi = 189800000

for (const n of needles) {
  const hits = allHits(buf, n).filter(h => h >= lo && h <= hi)
  console.log(n, hits.length, hits.slice(0, 6).join(','))
}

// Extract the ink-text write block that uses qv — around 189710928
const start = 189709500
console.log('\n=== ink-text render block ===')
console.log(asciiSlice(buf, start, start + 4500))

// Find function that assigns softWrap bits when writing wrapped lines
const assignHits = allHits(buf, 'softWrap[')
for (const h of assignHits) {
  if (h < lo || h > hi) continue
  const s = asciiSlice(buf, h - 80, h + 200)
  if (s.includes('=') && (s.includes('id(') || s.includes('Ao') || s.includes('di.'))) {
    console.log('\nASSIGN @', h)
    console.log(asciiSlice(buf, h - 200, h + 400))
  }
}
