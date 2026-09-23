/**
 * Peel _G argv construction (o/r/i) + surrounding launch helpers.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  extractFnAt,
  allHits,
} from './_peel-248-na-helpers.mjs'

const b = loadSea(EXE_248)
const out = [`when=${new Date().toISOString()}`]

function dumpHits(label, needle, max = 8) {
  const hits = allHits(b, needle)
  out.push(`\n## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, max)) {
    out.push(`- @${h} ${asciiSlice(b, h - 80, h + 200).replace(/\n/g, ' ')}`)
  }
  return hits
}

function dumpFnAt(label, i, maxLen = 12000) {
  out.push(`\n## ${label} @${i}`)
  const ext = extractFnAt(b, i, maxLen)
  if (ext.body) {
    out.push(`len=${ext.len} sha=${ext.sha}`)
    out.push(ext.body)
  } else {
    out.push(JSON.stringify(ext).slice(0, 400))
    out.push(asciiSlice(b, i, i + Math.min(maxLen, 4000)))
  }
  return ext
}

const gHits = dumpHits('async function _G(', 'async function _G(')
for (const h of gHits.slice(0, 2)) dumpFnAt('_G', h, 20000)

const eCall = allHits(b, 'E(o,[o,...r,...i],s,m)')
for (const h of eCall) {
  out.push(`\n## _G window 3k before E @${h}`)
  out.push(asciiSlice(b, h - 3000, h + 700))
}

dumpHits('let{cmd:o', 'let{cmd:o')
dumpHits('{cmd:o,prefixArgs:r}', '{cmd:o,prefixArgs:r}')
dumpHits('prefixArgs:r', 'prefixArgs:r')
dumpHits('function WE(', 'function WE(')
dumpHits('WL(e)', 'WL(e)')
dumpHits('function WL(', 'function WL(')

// In _G body look for how o,r,i assigned — search nearby for "let o=" or destructure
out.push('\n## fixed window around _G start')
if (gHits[0]) {
  out.push(asciiSlice(b, gHits[0], gHits[0] + 3500))
}

const weHits = allHits(b, 'function WE(')
for (const h of weHits.slice(0, 3)) dumpFnAt('WE', h, 5000)

const wlHits = allHits(b, 'function WL(')
for (const h of wlHits.slice(0, 3)) dumpFnAt('WL', h, 5000)

// Search for pattern used right before E in same chunk: typically
// let{cmd:o,prefixArgs:r}=WL(...) or similar
dumpHits('cmd:o,prefixArgs', 'cmd:o,prefixArgs')
dumpHits('...r,...i', '...r,...i')
dumpHits('let i=e.args', 'let i=e.args')
dumpHits('i=e.args', 'i=e.args')
dumpHits('r=e.', 'prefixArgs')

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/_peel-248-E-C-argv-out.txt',
  out.join('\n'),
)
console.log('wrote argv peel', out.length)
