/**
 * Hunt official D() used by fGt retain / primedFolderListing gates.
 * D() is free function in fGt scope — not a method.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  loadSea,
  asciiSlice,
  sha,
  extractFnAt,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const out =
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-fGt-D-primer.txt'
const lines = ['# gold-248-fGt-D-primer', '']

// Call sites inside fGt band
const callNeedles = [
  '&&D()&&this.primer',
  'return D()?this.folderListings',
  'if(!D())return',
  'D()?this.',
]

for (const n of callNeedles) {
  const hits = allHits(buf, n)
  lines.push(`## call ${JSON.stringify(n)} hits=${hits.length}`)
  for (const i of hits.slice(0, 5)) {
    lines.push(`@${i} ${asciiSlice(buf, i - 40, i + 100).replace(/\n/g, ' ')}`)
  }
  lines.push('')
}

// Patterns for D definition
const defNeedles = [
  'function D(){',
  'function D(){return',
  'var D=',
  'let D=',
  'const D=',
  'D=()=>',
  'D=function',
  ',D=()=>',
  ';D=()=>{',
  'export{D}',
  'export function D',
]

for (const n of defNeedles) {
  const hits = allHits(buf, n)
  // Prefer near settings / before fGt
  const near = hits.filter(i => i > 178400000 && i < 178510000)
  const far = hits.filter(i => i < 178505059).slice(-5)
  lines.push(`## def ${JSON.stringify(n)} total=${hits.length} near=${near.length}`)
  for (const i of [...near.slice(0, 8), ...far]) {
    lines.push(`@${i} ${asciiSlice(buf, i, i + 200).replace(/\n/g, ' ')}`)
  }
  lines.push('')
}

// primer field assignment: .primer= or primer:
lines.push('## primer assignment hunt')
for (const n of [
  '.primer=',
  'primer=',
  'this.primer=',
  '.primer =',
  'ra().primer',
  'fGt).primer',
  'primer:',
]) {
  const hits = allHits(buf, n).filter(i => i > 178000000 && i < 180000000)
  lines.push(`### ${JSON.stringify(n)} bandHits=${hits.length}`)
  for (const i of hits.slice(0, 15)) {
    lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 50), i + 120).replace(/\n/g, ' ')}`)
  }
  lines.push('')
}

// Broader: any "function D()" in whole binary — sample offsets around settings chunk imports
{
  const hits = allHits(buf, 'function D(){')
  lines.push(`## ALL function D(){ count=${hits.length}`)
  // find ones whose body mentions settings-ish or is tiny bool
  for (const i of hits) {
    const peeled = extractFnAt(buf, i, 800)
    if (!peeled.body) continue
    const b = peeled.body
    if (
      b.length < 120 ||
      b.includes('primer') ||
      b.includes('policyWalk') ||
      b.includes('settings') ||
      b.includes('feature(') ||
      /return[!]?0/.test(b) ||
      /return[!]?1/.test(b) ||
      b.includes('return!') ||
      b.includes('return true') ||
      b.includes('return false')
    ) {
      lines.push(`@${i} len=${peeled.len} ${b.slice(0, 300)}`)
    }
  }
  lines.push('')
}

// Maybe D is imported: import{D as ...} or import{...,D,...}
lines.push('## import {D} near fGt lookback 2k')
lines.push(asciiSlice(buf, 178503000, 178505100))
lines.push('')

// Search "D()" definitions via minified single-letter that returns bool near Ft/mGt
lines.push('## tiny bool functions ending before fGt (last 30 function X(){return')
{
  const start = 178480000
  const end = 178505059
  const win = asciiSlice(buf, start, end)
  const re = /function ([A-Za-z_$][\w$]*)\(\)\{return[^}]{0,80}\}/g
  let m
  const found = []
  while ((m = re.exec(win))) {
    found.push({ name: m[1], body: m[0], abs: start + m.index })
  }
  for (const f of found.slice(-40)) {
    lines.push(`@${f.abs} ${f.body}`)
  }
}

writeFileSync(out, lines.join('\n'))
console.log('wrote', out)
