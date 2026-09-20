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

for (const n of [
  'function Ai(',
  'function te(',
  'function oe(',
  'async function Ei(',
  'function Si(',
  'function ee(',
]) {
  const hits = allHits(n).filter(i => i > 210480000 && i < 210750000)
  console.log(n, hits)
  for (const i of hits.slice(0, 2)) console.log(ascii(i, i + 350))
}

// to @ from earlier dump ~ object format
const toHits = allHits('async function to(e,n,t)')
console.log('async function to', toHits)
for (const i of toHits.filter(i => i > 210540000 && i < 210570000)) {
  writeFileSync(`${outDir}/gold-forged-X4n-to.txt`, ascii(i, i + 12000))
  console.log('wrote to', i, ascii(i, i + 200))
}

// Kt rest
writeFileSync(`${outDir}/gold-forged-Kt-wide.txt`, ascii(210725289, 210729400))

// env: find getters object that has Uc
const ucGet = allHits('LEGACY_BUNDLE:()=>Uc')
console.log('schema', ucGet)
// search function Uc in 206500000-207300000 excluding zod
const ucs = allHits('function Uc(')
console.log('function Uc(', ucs)
for (const i of ucs) {
  const s = ascii(i, i + 120)
  if (s.includes('process.env') || s.includes('boolean') || s.includes('LEGACY')) {
    console.log('cand', i, s)
  }
}

// maybe Uc is const from env map
const ucEq = allHits('Uc=Z(')
console.log('Uc=Z(', ucEq)
const ucBool = allHits('Uc=He(')
console.log('Uc=He', ucBool)

// getEnvBoolean pattern
for (const n of [
  'function He(e){return process.env',
  'process.env.CLAUDE_CODE_LEGACY_BUNDLE',
]) {
  console.log(n, allHits(n).slice(0, 5))
  for (const i of allHits(n).slice(0, 2)) console.log(ascii(i, i + 150))
}

// V. object - import V from env
const vImp = allHits('V.CLAUDE_CODE_LEGACY_BUNDLE')
console.log('V.LEGACY', vImp)
console.log(ascii(vImp[0] - 200, vImp[0] + 80))

// how V is imported in TCt module
const tctImp = buf.lastIndexOf(Buffer.from('import{'), 215247900)
console.log('\nTCt import window last import before gXo')
console.log(ascii(215240000, 215248000).slice(-1500))
