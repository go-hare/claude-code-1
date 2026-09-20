import { readFileSync, writeFileSync } from 'fs'

const buf247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const buf246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
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
  return s
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

function dump(name, buf, start, end, extra = '') {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# ${extra}\n# start=${start} end=${end}\n\n${asciiWindow(buf, start, end)}\n`,
  )
  console.log('OK', name, end - start)
}

// 246 hunk module around ls-tree 233201741
const ls246 = 233201741
dump('gold-20-246-45-window.txt', buf246, ls246 - 4000, ls246 + 12000, '246 hunk module')

// find 246 export near this
for (const n of [
  'export{Yt as',
  'async function Yt(',
  'async function Yt(t,n',
  'async function Yt(t,n,i',
  'return{diff:null}',
  'perFileMs',
  'totalMs',
]) {
  const hits = allHits(buf246, n, ls246 - 8000, ls246 + 20000)
  console.log('246', JSON.stringify(n), hits)
}

// 247 Yt exact start
dump('gold-20-yt-fn.txt', buf247, 235255974, 235258220, '247 async function Yt complete')

// 246 equivalent of return{diff:null} near hunk module
const diffNull = allHits(buf246, 'return{diff:null}')
console.log('246 return{diff:null}', diffNull)
for (const [idx, pos] of diffNull.entries()) {
  dump(`gold-20-246-diffnull-${idx}.txt`, buf246, pos - 400, pos + 200)
}

// ye helpers
dump('gold-20-ye-0.txt', buf247, 210570367, 210571200, 'function ye 0')
dump('gold-20-ye-1.txt', buf247, 210617660, 210618800, 'function ye 1')

// imports at start of jn module - find Version before 210639111
const ver = buf247.lastIndexOf(Buffer.from('// Version: 2.1.247'), 210639111)
console.log('jn module version', ver)
dump('gold-20-jn-mod-start.txt', buf247, ver, ver + 2500)

// search ht= and kt= as imports: U2a as ht was _45. For jn module:
const jnStart = ver > 0 ? ver : 210500000
const importBlock = asciiWindow(buf247, jnStart, jnStart + 4000)
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-20-jn-imports.txt',
  importBlock,
)
console.log('jn imports written', importBlock.slice(0, 400))

// compare 247 vs 246 Yt first 200 chars after async function Yt
const y247 = buf247.indexOf(Buffer.from('async function Yt(t,n,i=bt)'))
const y246a = buf246.indexOf(Buffer.from('async function Yt(t,n,i=bt)'))
const y246b = buf246.indexOf(Buffer.from('async function Yt(t,n)'))
const y246c = buf246.indexOf(Buffer.from('async function Yt(t,n,i)'))
console.log('Yt sig 247', y247, '246 i=bt', y246a, '246 tn', y246b, '246 tni', y246c)

// 246 function that returns {diff:{stats
const shape = allHits(buf246, 'diff:{stats:')
console.log('246 diff:{stats:', shape)
const shape247 = allHits(buf247, 'diff:{stats:')
console.log('247 diff:{stats:', shape247)

// host methods used: q(t) Y2a
const y2a = allHits(buf247, 'Y2a as q')
console.log('Y2a as q', y2a)

// $2a as A - getCwd/gitRoot?
const a2a = allHits(buf247, '$2a as A')
console.log('$2a as A', a2a)

// Z2a as Q - get base ref
const z2a = allHits(buf247, 'Z2a as Q')
console.log('Z2a as Q', z2a)
