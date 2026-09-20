import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

const OUT = 'docs/upstream-extraction/v2.1.247/snippets'

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

function dump(name, i, before, after) {
  const start = Math.max(0, i - before)
  const text = asciiWindow(buf, start, i + after)
  writeFileSync(`${OUT}/${name}`, `# offset=${i}\n\n${text}\n`)
  console.log('DUMP', name, 'offset', i, 'len', text.length)
  return text
}

function findAll(needle, limit = 40, from = 0, to = buf.length) {
  const n = Buffer.from(needle)
  const hits = []
  let i = from
  while (hits.length < limit) {
    const j = buf.indexOf(n, i)
    if (j < 0 || j > to) break
    hits.push(j)
    i = j + n.length
  }
  return hits
}

function identHits(name, limit = 30) {
  const out = []
  for (const [pat, kind] of [
    [` as ${name},`, 'as-comma'],
    [` as ${name}}`, 'as-brace'],
    [`${name} as `, 'orig-as'],
    [`function ${name}(`, 'fn'],
    [`function ${name}()`, 'fn0'],
    [`var ${name}=`, 'var'],
    [`let ${name}=`, 'let'],
    [`const ${name}=`, 'const'],
    [`${name}=w(`, 'w-init'],
    [`${name}=(()`, 'iife'],
  ]) {
    for (const i of findAll(pat, 8)) {
      out.push({ kind, i, pat, win: asciiWindow(buf, i - 70, i + 90) })
      if (out.length >= limit) return out
    }
  }
  return out
}

const ST = 214539101
const MR = 214541129

console.log('=== $St / MR windows ===')
dump('gold-dig-QLn-dollarSt.txt', ST, 80, 900)
dump('gold-dig-jS-MR.txt', MR, 80, 600)

console.log('\n=== QLn().extend unique ===')
const qlnExtend = findAll('QLn().extend({plugins:Me(wn())})')
console.log('QLn().extend hits', qlnExtend)
for (const i of qlnExtend) {
  console.log(' ', i, asciiWindow(buf, i - 40, i + 80))
}

console.log('\n=== ISt/Zfe/RBo/LSt jS() calls near marketplace ===')
for (const pat of [
  'ISt(r,jS())',
  'ISt(e,jS())',
  'ISt(a,jS())',
  'MR(n,r,jS())',
  'MR(c,a,jS())',
  'MR(s.text,r,jS())',
  'MR(i.text,e,jS())',
  'MR(s,r,jS())',
  'MR(s,e,jS())',
  'MR(i,e,jS())',
]) {
  const hits = findAll(pat, 8, 214000000, 215000000)
  console.log(pat, hits)
}

console.log('\n=== ident QLn ===')
const qlnIds = identHits('QLn')
for (const h of qlnIds) console.log(h.kind, h.i, h.win.replace(/\n/g, ' '))
if (qlnIds[0]) dump('gold-dig-QLn-ident0.txt', qlnIds[0].i, 120, 200)

console.log('\n=== ident jS (all, then filter) ===')
const jsIds = identHits('jS', 40)
for (const h of jsIds) {
  const nearMkt = h.i > 212000000 && h.i < 216000000
  const isCost = h.win.includes('costLedger') || h.win.includes('totalInputTokens')
  console.log(
    h.kind,
    h.i,
    nearMkt ? 'NEAR-MKT' : '',
    isCost ? 'COST' : '',
    h.win.replace(/\n/g, ' ').slice(0, 160),
  )
}

console.log('\n=== marketplace-module imports walking back from $St ===')
const importHits = []
let from = Math.max(0, ST - 400000)
while (importHits.length < 25) {
  const j = buf.indexOf(Buffer.from('import{'), from)
  if (j < 0 || j > ST) break
  importHits.push(j)
  from = j + 7
}
console.log(
  'import{ before $St',
  importHits.map((i) => i),
)
const lastImp = importHits[importHits.length - 1]
if (lastImp != null) {
  dump('gold-dig-QLn-mkt-imports.txt', lastImp, 200, 2500)
}

// Extract last 80k ascii before $St and regex import aliases
const pre = asciiWindow(buf, ST - 80000, ST + 200)
writeFileSync(`${OUT}/gold-dig-QLn-pre80k.txt`, `# $St-80k @${ST}\n\n${pre}\n`)

function aliasIn(text, name) {
  const re = new RegExp(
    `([A-Za-z0-9_$]{1,8}) as ${name}[,}]|[\\{,]${name} as ([A-Za-z0-9_$]{1,8})`,
    'g',
  )
  const hits = []
  for (const m of text.matchAll(re)) {
    hits.push({
      orig: m[1] || name,
      alias: m[2] || name,
      ctx: text.slice(Math.max(0, m.index - 80), m.index + 60),
    })
  }
  return hits
}

console.log('\n=== aliases in $St-80k ===')
for (const name of ['QLn', 'jS', 'wn', 'Me']) {
  const hits = aliasIn(pre, name)
  console.log(name, hits.length)
  for (const h of hits.slice(0, 8)) {
    console.log(' ', h.orig, '->', h.alias, h.ctx.replace(/\n/g, ' '))
  }
}

// Also scan last import cluster more carefully for these names
const impWin = lastImp != null ? asciiWindow(buf, lastImp - 500, lastImp + 4000) : ''
console.log('\n=== last import cluster aliases ===')
for (const name of ['QLn', 'jS', 'wn', 'Me']) {
  console.log(name, aliasIn(impWin, name))
}

console.log('\n=== ident wn / Me near marketplace (212e6-216e6) ===')
for (const name of ['wn', 'Me']) {
  const hits = []
  for (const pat of [
    ` as ${name},`,
    ` as ${name}}`,
    `function ${name}(`,
    `var ${name}=`,
  ]) {
    for (const i of findAll(pat, 20, 212000000, 216000000)) {
      hits.push({ pat, i, win: asciiWindow(buf, i - 60, i + 80) })
    }
  }
  console.log('---', name, hits.length)
  for (const h of hits.slice(0, 12)) {
    console.log(h.pat, h.i, h.win.replace(/\n/g, ' ').slice(0, 150))
  }
}

console.log('\n=== pluginRoot near marketplace schemas ===')
const prHits = findAll('pluginRoot', 20)
for (const i of prHits) {
  const win = asciiWindow(buf, i - 80, i + 120)
  const nearMkt = i > 200000000 && i < 220000000
  if (
    nearMkt ||
    win.includes('QLn') ||
    win.includes('jS') ||
    win.includes('metadata') ||
    win.includes('plugins')
  ) {
    console.log(i, nearMkt ? 'MKT-RANGE' : '', win.replace(/\n/g, ' ').slice(0, 180))
  }
}
const prSchema = prHits.find((i) => {
  const w = asciiWindow(buf, i - 40, i + 80)
  return w.includes('pluginRoot:') || w.includes('pluginRoot:z') || w.includes('pluginRoot: z')
})
if (prSchema != null) dump('gold-dig-QLn-pluginRoot-schema.txt', prSchema, 400, 400)

console.log('\n=== schema error strings ===')
for (const s of [
  'Marketplace name cannot contain control',
  'Invalid marketplace schema from URL',
  'Base directory for bare plugin source',
  'forceRemoveDeletedPlugins',
  'allowCrossMarketplaceDependenciesOn',
]) {
  const hits = findAll(s, 6)
  console.log(JSON.stringify(s), hits)
  if (hits[0] != null) {
    const slug = s.slice(0, 28).replace(/[^a-zA-Z0-9]+/g, '-')
    dump(`gold-dig-QLn-${slug}.txt`, hits[0], 200, 400)
  }
}
