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

function findAll(needle, limit = 12) {
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

const needles = [
  'function tZ(',
  'async function tZ(',
  'function eZ(',
  'async function eZ(',
  'var tZ=',
  'var eZ=',
  'tZ=async',
  'eZ=async',
  'tZ=memoize',
  'eZ=memoize',
  'async tZ(',
  'async eZ(',
]

for (const n of needles) {
  const hits = findAll(n, 8)
  console.log(n, hits)
  for (const i of hits) {
    const win = asciiWindow(buf, i, i + 350)
    // skip if looks like unrelated minified
    console.log('  ', i, win.slice(0, 180).replace(/\n/g, ' '))
  }
}

// marketplace-specific unique strings near getMarketplace
for (const n of [
  'not found in configuration. Available marketplaces',
  'Cache corrupted or missing for marketplace',
  'Failed to load marketplace "',
  'has a relative source path',
]) {
  const hits = findAll(n, 3)
  console.log('STR', JSON.stringify(n), hits)
  if (hits[0] >= 0) {
    writeFileSync(
      `docs/upstream-extraction/v2.1.247/snippets/gold-dig-mkt-${hits[0]}.txt`,
      `# ${n} @${hits[0]}\n\n${asciiWindow(buf, hits[0] - 800, hits[0] + 600)}\n`,
    )
  }
}
