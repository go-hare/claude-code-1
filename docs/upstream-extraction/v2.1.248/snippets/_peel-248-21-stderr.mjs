/**
 * #21 pass9 — official leftover stderr vs Eve; np next to mK; executeHooks note site.
 */
import { writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-21-stderr.txt'
const b248 = loadSea(EXE_248)
const lines = ['# gold-248-21-stderr', `when=${new Date().toISOString()}`, '']

function dump(needle, around = 220, cap = 8) {
  const hits = allHits(b248, needle)
  lines.push(`## ${needle} hits=${hits.length}`)
  for (const [i, p] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${i} @${p} ${asciiSlice(b248, p - around, p + needle.length + around)}`,
    )
  }
  lines.push('')
  return hits
}

for (const n of [
  'JSON validation failed: ${',
  'stderr:`JSON validation failed',
  'stderr: `JSON validation failed',
  'stderr:`${',
  'validationError}',
  'JSON validation failed: ${validationError}',
  'JSON validation failed: ${httpValidationError}',
  'var Eve=',
  'Eve="',
  'function za(',
  'np=',
]) {
  dump(n)
}

// window around leftover-ish parseHookOutput validationError return
const hits = allHits(b248, 'JSON validation failed: ${')
for (const p of hits) {
  const start = lastFnStartGeneric(b248, p, 8000)
  lines.push(`## fn near JSON validation failed @${p} ${start.name} @${start.i}`)
  const ext = extractFnAt(b248, start.i, 4000)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  }
  lines.push('')
}

// np immediately before mK
lines.push('## 400 before mK @186238762')
lines.push(asciiSlice(b248, 186238400, 186238900))
lines.push('')

// za definition used by mK — search backwards from mK
const mk = 186238762
const zaHits = []
let i = Math.max(0, mk - 200000)
const needle = Buffer.from('function za(')
while (i < mk) {
  const k = b248.indexOf(needle, i)
  if (k < 0 || k >= mk) break
  zaHits.push(k)
  i = k + needle.length
}
lines.push(`## function za( before mK count=${zaHits.length} last=${zaHits.at(-1)}`)
if (zaHits.at(-1) != null) {
  const ext = extractFnAt(b248, zaHits.at(-1), 1500)
  lines.push(`len=${ext.len} sha=${ext.sha}`)
  lines.push(ext.body || JSON.stringify(ext))
}
lines.push('')

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out)
