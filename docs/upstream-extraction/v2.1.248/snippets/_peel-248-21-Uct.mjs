/**
 * #21 pass11 — Uct leftover schema-stderr wrapper + leftover executeHooks host.
 */
import { writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-21-Uct.txt'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = ['# gold-248-21-Uct', `when=${new Date().toISOString()}`, '']

function dump(buf, label, needle, around = 200, cap = 8) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const [i, p] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${i} @${p} ${asciiSlice(buf, p - around, p + needle.length + around)}`,
    )
  }
  lines.push('')
  return hits
}

function dumpFn(buf, label, i, maxLen = 4000) {
  const start = lastFnStartGeneric(buf, i, 8000)
  lines.push(`## ${label} near@${i} fn=${start.name} @${start.i}`)
  if (start.i < 0) {
    lines.push('NO_FN')
    lines.push('')
    return
  }
  const ext = extractFnAt(buf, start.i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(`exact247=${allHits(b247, ext.body).length}`)
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
  }
  lines.push('')
}

dump(b248, '248 Uct(', 'Uct(')
dump(b248, '248 function Uct', 'function Uct')
dump(b247, '247 function Uct', 'function Uct')
dump(b247, '247 Uct(', 'Uct(')

const hits = allHits(b248, 'function Uct')
for (const p of hits) dumpFn(b248, 'Uct', p, 2000)

const call = allHits(b248, 'Uct(Rs')
for (const p of call) dumpFn(b248, 'Uct(Rs caller', p, 3000)

// leftover leftover wrapper
dump(b248, '248 JSON validation failed: ${', 'JSON validation failed: ${')
dump(b247, '247 JSON validation failed', 'JSON validation failed')

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out)
