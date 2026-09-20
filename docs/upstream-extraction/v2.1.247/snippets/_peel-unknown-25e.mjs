/**
 * Phase 5 leftover 247 #25 — resolve plugin-chunk ke binding + /plugin UI wrap.
 */
import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const b246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function allHits(buf, needle) {
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

function asciiSlice(buf, start, end) {
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

function dump(name, text) {
  writeFileSync(`${outDir}/${name}`, text.endsWith('\n') ? text : `${text}\n`)
  console.log('WROTE', name, text.length)
}

function isIdentStart(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 36 || c === 95
}
function isIdent(c) {
  return isIdentStart(c) || (c >= 48 && c <= 57)
}

function extractBraced(buf, bracePos, max = 400000) {
  if (buf[bracePos] !== 123) return null
  let depth = 0
  let i = bracePos
  let inStr = null
  let esc = false
  const limit = Math.min(buf.length, bracePos + max)
  while (i < limit) {
    const c = buf[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === 92) esc = true
      else if (c === inStr) inStr = null
      i++
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      inStr = c
      i++
      continue
    }
    if (c === 123) depth++
    else if (c === 125) {
      depth--
      if (depth === 0) return { start: bracePos, end: i + 1 }
    }
    i++
  }
  return null
}

const u247 = 233803353
const u246 = 231792233

// dump every ke, in 80k before U
function dumpKeCommas(buf, near, ver) {
  const start = Math.max(0, near - 80000)
  const win = asciiSlice(buf, start, near)
  const lines = [`# ${ver} ke, hits before U@${near}`, '']
  let idx = 0
  let n = 0
  while (true) {
    const j = win.indexOf('ke,', idx)
    if (j < 0) break
    n++
    const abs = start + j
    lines.push(`## hit${n} @${abs}`)
    lines.push(asciiSlice(buf, abs - 180, abs + 180))
    lines.push('')
    idx = j + 3
  }
  dump(`gold-25-escape-${ver}-ke-commas.txt`, lines.join('\n'))
}

dumpKeCommas(b247, u247, '247')
dumpKeCommas(b246, u246, '246')

// find enclosing k(()=>{ ... }) or similar module wrapper
function findModuleStart(buf, near) {
  const probes = ['=k(()=>{', '=k(()=>', 'var k=(()=>', '})();']
  const found = []
  for (const p of probes) {
    const hits = allHits(buf, p).filter((i) => i < near && near - i < 500000)
    if (hits.length) found.push({ p, last: hits[hits.length - 1], n: hits.length })
  }
  return found
}
console.log('modstart 247', findModuleStart(b247, u247))
console.log('modstart 246', findModuleStart(b246, u246))

// search ke( usages near plugin list / details
for (const n of [
  'e.map(ke)',
  'ke(e)',
  'ke(n)',
  'ke(t)',
  'ke(_',
  'ke(y)',
  'ke(p)',
  'D(y)',
  'D(p)',
  '.name)}',
  'entry.name',
  'marketplace.name',
  'sanitizeDisplay',
  '_g(',
  '__p(',
  'aJ0',
]) {
  const a = allHits(b246, n).length
  const b = allHits(b247, n).length
  if (a || b) console.log(`${a === b ? 'same' : 'DIFF'} 246=${a} 247=${b} ${JSON.stringify(n)}`)
}

// dump 247 chunk header-ish: first 3k of printable run containing Er
const er = 233787886
dump(
  'gold-25-escape-247-Er-minus20k.txt',
  `# Er-20k\n\n${asciiSlice(b247, er - 20000, er + 80)}\n`,
)

// Find import {...,ke,...} or ke as alias near plugin chunk
const importNeedles = [
  '{ke}',
  '{ke,',
  ',ke}',
  'ke as ',
  ' as ke',
  'ke=_g',
  'ke=__p',
  'ke=a0',
  'ke=sanitize',
]
const lines = ['# import/alias ke', '']
for (const n of importNeedles) {
  const h247 = allHits(b247, n)
  const h246 = allHits(b246, n)
  lines.push(`${h246.length === h247.length ? 'same' : 'DIFF'} 246=${h246.length} 247=${h247.length} ${JSON.stringify(n)}`)
  for (const i of h247.slice(0, 6)) {
    dump(
      `gold-25-escape-import-${n.replace(/[^A-Za-z0-9]+/g, '_')}-${i}.txt`,
      `# 247 @${i}\n\n${asciiSlice(b247, Math.max(0, i - 250), i + 350)}\n`,
    )
  }
}

// Look at /plugin UI: "No plugins installed. Use `/plugin install`"
const uiNeedles = [
  'No plugins installed. Use `/plugin install`',
  'No plugins installed. Use `/plugin',
  "Couldn't refresh marketplace",
  'Showing available marketplaces',
]
for (const n of uiNeedles) {
  const hits = allHits(b247, n)
  lines.push(`UI ${JSON.stringify(n)} hits=${hits.length} ${hits.slice(0, 4)}`)
  for (const [idx, i] of hits.slice(0, 2).entries()) {
    dump(
      `gold-25-escape-ui-${idx}-${n.slice(0, 24).replace(/[^A-Za-z0-9]+/g, '_')}.txt`,
      `# 247 @${i}\n\n${asciiSlice(b247, Math.max(0, i - 1500), i + 2000)}\n`,
    )
  }
}

// display sanitizer official names from local comments: _g __p aJ0 Wwe GPi
for (const n of [
  'function _g(',
  'function __p(',
  'function aJ0(',
  'function Wwe(',
  'function GPi(',
  '_g(e)!==e',
  'function ke(e){return',
]) {
  const h247 = allHits(b247, n)
  const h246 = allHits(b246, n)
  lines.push(`${h246.length === h247.length ? 'same' : 'DIFF'} 246=${h246.length} 247=${h247.length} ${JSON.stringify(n)}`)
  if (h247.length && h247.length <= 8) {
    for (const i of h247) {
      dump(
        `gold-25-escape-disp-${n.replace(/[^A-Za-z0-9]+/g, '_')}-${i}.txt`,
        `# 247 @${i}\n\n${asciiSlice(b247, i, i + 800)}\n`,
      )
    }
  }
}

dump('gold-25-escape-phase5.txt', lines.join('\n'))
console.log('phase5 done')
