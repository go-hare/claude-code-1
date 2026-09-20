import { readFileSync, writeFileSync } from 'fs'

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

console.log('==== _577 export aGb ====')
const exp = buf.indexOf(Buffer.from(' as aGb'))
console.log(exp, ascii(exp - 120, exp + 20))

console.log('\n==== function that is J4n near _577 ====')
// typical _577 around 2080-2090 or 2100
for (const n of [
  'folder_is_home',
  'folder_is_root',
  'folder_holds_config',
  'function aGb',
]) {
  console.log(n, allHits(n).slice(0, 5))
}

const home = buf.indexOf(Buffer.from('folder_is_home'), 200000000)
console.log('\ncode around first folder_is_home after 200m')
const hits = allHits('folder_is_home')
for (const i of hits) {
  if (i > 210000000 && i < 215274000) {
    console.log(i, ascii(i - 200, i + 80))
  }
}

console.log('\n==== oe() un() near 210533 ====')
for (const n of ['function oe(){', 'function un(){', 'function ne(){']) {
  const hits2 = allHits(n).filter(i => i > 210520000 && i < 210535000)
  console.log(n, hits2)
  for (const i of hits2) console.log(ascii(i, i + 250))
}
