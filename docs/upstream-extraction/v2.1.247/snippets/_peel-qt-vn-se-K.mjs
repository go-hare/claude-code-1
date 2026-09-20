import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

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

console.log('==== se @210535697 ====')
console.log(ascii(210535650, 210536050))

console.log('\n==== ie rest ====')
console.log(ascii(210535993, 210537800))
writeFileSync(`${outDir}/gold-forged-ie-wide.txt`, ascii(210535993, 210538200))

console.log('\n==== gn rest ====')
console.log(ascii(210533599, 210534400))

console.log('\n==== qt search ====')
for (const n of [
  'async function qt(',
  'function qt(e,n,t)',
  ' as qt}',
  'qt as ',
  'junction',
]) {
  const hits = allHits(n)
  console.log(n, hits.filter(i => i > 210500000 && i < 210565000).slice(0, 6))
}

const junc = allHits('junction')
for (const i of junc.filter(i => i > 210550000 && i < 210556000)) {
  console.log('junc', i, ascii(i - 80, i + 200))
}

console.log('\n==== vn in to ====')
const vnCall = buf.indexOf(Buffer.from('m=vn();if(!H(m))'))
console.log('vn call', vnCall)
// who is vn imported as
console.log(ascii(210500000, 210501400))

console.log('\n==== K list for Rn ====')
for (const n of ['var K=', 'K=["CLAUDE_CONFIG_DIR"', 'K=["CLAUDE_']) {
  console.log(n, allHits(n).slice(0, 5))
  for (const i of allHits(n).slice(0, 2)) console.log(ascii(i, i + 200))
}

console.log('\n==== function se(e){return near 210535 ====')
console.log(ascii(210535680, 210535780))

console.log('\n==== Mn count ====')
for (const n of ['function Mn(e,n)', 'Mn=(e,n)', 'function Mn(e)']) {
  console.log(n, allHits(n).slice(0, 4))
}

console.log('\n==== se(e){return e.endsWith or isAbs ====')
const se2 = 210535697
console.log(ascii(se2, se2 + 80))
