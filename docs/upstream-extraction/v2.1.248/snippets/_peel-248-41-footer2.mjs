/**
 * Peel official 248 eDt / Wen / uJt / nge for #41 footer wiring.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const lines = ['# gold-248-41-footer-peel2', '']

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

function dumpFn(label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(b248, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpHits(label, needle, around = 90, cap = 10) {
  const hits = allHits(b248, needle)
  lines.push(`## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [idx, off] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${off} ${asciiSlice(b248, off - around, off + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

// nge + y5e already known
dumpFn('#41 y5e-interval', 203023444, 800)
dumpFn('#41 nge-usePrStatus', b248.indexOf(Buffer.from('function nge(d,C=!0)')), 1200)

// eDt fetch used by nge
dumpHits('#41 function eDt', 'function eDt')
dumpHits('#41 async function eDt', 'async function eDt')
dumpHits('#41 eDt(', 'eDt(')
const edt = lastFnStartGeneric(
  b248,
  b248.indexOf(Buffer.from('fetchPrStatus:()=>eDt(H)')),
  50,
)
lines.push(`## eDt lastFn near nge ${JSON.stringify(edt)}`)

// find function eDt definition
{
  const hits = allHits(b248, 'function eDt')
  for (const off of hits) dumpFn(`#41 eDt@${off}`, off, 6000)
}

// Wen isDirectApiEnabled
dumpHits('#41 function Wen', 'function Wen')
dumpHits('#41 Wen()', 'Wen()')
{
  const hits = allHits(b248, 'function Wen(')
  for (const off of hits.slice(0, 6)) dumpFn(`#41 Wen@${off}`, off, 800)
}

// uJt REST
dumpFn('#41 uJt', 184548939, 8000)
dumpAround('#41 uJt-win', 184548939, 200, 2500)

// JE / oJt
dumpHits('#41 function JE', 'function JE()')
dumpHits('#41 new dXe', 'new dXe')
dumpFn('#41 JE', b248.indexOf(Buffer.from('function JE(){return oJt.of')), 200)

// ege fallback used beside nge
dumpHits('#41 function ege', 'function ege')
{
  const hits = allHits(b248, 'function ege')
  for (const off of hits.slice(0, 4)) dumpFn(`#41 ege@${off}`, off, 800)
}

// FY footer uses nge
dumpAround('#41 FY-nge-call', b248.indexOf(Buffer.from('Ct=nge(ge,Yt)')), 200, 400)

// bump.emit callers (push / gh pr)
dumpHits('#41 .bump.emit', '.bump.emit')
dumpHits('#41 bump.emit()', 'bump.emit()')

writeFileSync(`${outDir}/gold-248-41-footer-peel2.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-41-footer-peel2.txt`, 'chars', lines.join('\n').length)
