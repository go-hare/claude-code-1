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

// _465 Y import
const yAs = allHits(' as Y}')
  .concat(allHits(' as Y,'))
  .filter(i => i > 210705700 && i < 210720000)
console.log('as Y in _465', yAs)
for (const i of yAs) console.log(ascii(i - 60, i + 15))

console.log('\n==== _465 imports continued ====')
console.log(ascii(210706900, 210708800))

// function Y that returns clear
for (const n of [
  'function Y(e,t){',
  'async function Y(e,t)',
  'function Y(e,t,n)',
]) {
  const hits = allHits(n).filter(i => i > 210400000 && i < 210750000)
  console.log(n, hits)
  for (const i of hits.slice(0, 2)) console.log(ascii(i, i + 400))
}

// ==="clear" definitions
const clear = allHits('==="clear"')
console.log(
  '\nclear',
  clear.filter(i => i > 210400000 && i < 210760000),
)

// Kt in _465
for (const n of ['async function Kt(', 'function Kt(']) {
  const hits = allHits(n).filter(i => i > 210700000 && i < 210750000)
  console.log(n, hits)
  for (const i of hits) {
    writeFileSync(`${outDir}/gold-forged-Kt.txt`, ascii(i, i + 6000))
    console.log(ascii(i, i + 500))
  }
}

// _583 export QJb
console.log('\n==== QJb ====')
const qjb = allHits(' as QJb')
console.log(qjb)
for (const i of qjb) console.log(ascii(i - 80, i + 20))

const qjbFn = allHits('QJb as X4n')
console.log('QJb as X4n', qjbFn)

// find function exported as QJb — look at _583 export
const exp583 = buf.indexOf(Buffer.from('QJb as X4n'))
// the defining export is in _583
const expQ = allHits(' as QJb')
for (const i of expQ) {
  console.log('def', i, ascii(i - 30, i + 15))
}

// mt in TCt module ~215250000
for (const n of ['function mt(', 'mt=function']) {
  const hits = allHits(n).filter(i => i > 215200000 && i < 215270000)
  console.log('mt TCt', n, hits)
  for (const i of hits) console.log(ascii(i, i + 200))
}

// import mt in TCt
const tctStart = 215230000
console.log('\n==== near TCt start / mt import ====')
const mtImp = allHits(' as mt').filter(i => i > 215200000 && i < 215260000)
console.log('as mt', mtImp)
for (const i of mtImp) console.log(ascii(i - 80, i + 20))

// Ezd as mt was in an earlier import: Ezd as mt
console.log('\nEzd as mt', allHits('Ezd as mt'))
for (const i of allHits('Ezd as mt')) console.log(ascii(i - 40, i + 20))

// function L pluralize Ezd
const ezd = allHits(' as Ezd')
console.log('as Ezd', ezd.slice(0, 6))
for (const i of ezd.slice(0, 4)) console.log(ascii(i - 40, i + 15))

// env boolean: search CLAUDE_CODE_LEGACY_BUNDLE in source-like
const envMod = 207203145
// walk to find Uc= 
console.log('\n==== find Uc near env getters ====')
// search "LEGACY_BUNDLE" then function Uc nearby in env impl
for (const n of [
  'LEGACY_BUNDLE",',
  'LEGACY_BUNDLE:',
  'booleanFromEnv',
  'envBoolean',
]) {
  console.log(n, allHits(n).slice(0, 5))
}

// uL cowork getter
const ul = allHits('uL=()=>')
console.log('uL=()=>', ul)
for (const i of ul.slice(0, 2)) console.log(ascii(i, i + 150))

const ul2 = allHits('function uL(')
console.log('function uL', ul2.slice(0, 3))
for (const i of ul2.slice(0, 2)) console.log(ascii(i, i + 200))
