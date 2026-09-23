/**
 * #21 pass10 — official leftover executeHooks validationError stderr + np near rA.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-21-exec.txt'
const b248 = loadSea(EXE_248)
const lines = ['# gold-248-21-exec', `when=${new Date().toISOString()}`, '']

function dump(needle, around = 260, cap = 10) {
  const hits = allHits(b248, needle)
  lines.push(`## ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [i, p] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${i} @${p} ${asciiSlice(b248, p - around, p + needle.length + around)}`,
    )
  }
  lines.push('')
  return hits
}

for (const n of [
  'JSON validation failed',
  'stderr:validationError',
  'stderr:r.validationError',
  'stderr:o',
  'validationError:o',
  'outcome:"non_blocking_error"',
  'outcome:"error"',
  'var np=',
  'np=80',
  'np=120',
  'np=200',
  'np=240',
  'np=800',
]) {
  dump(n, 180, 6)
}

// window around leftover executeHooks noteHookFailure caller
lines.push('## caller window @186308200')
lines.push(asciiSlice(b248, 186307800, 186309200))
lines.push('')

// leftover parse → attachment stderr near Owt / lIe
lines.push('## leftover lIe+Owt callers of validationError as stderr')
const hits = allHits(b248, 'validationError')
let n = 0
for (const p of hits) {
  if (p < 186250000 || p > 186320000) continue
  const win = asciiSlice(b248, p - 80, p + 160)
  if (win.includes('stderr') || win.includes('non_blocking')) {
    lines.push(`- @${p} ${win}`)
    n++
    if (n >= 20) break
  }
}
lines.push('')

// np assignments in 186.2-186.3M
const npNeedle = Buffer.from('np=')
let i = 186200000
const npHits = []
while (i < 186250000) {
  const k = b248.indexOf(npNeedle, i)
  if (k < 0 || k >= 186250000) break
  npHits.push(k)
  i = k + 3
}
lines.push(`## np= in 186.2-186.25M count=${npHits.length}`)
for (const p of npHits.slice(0, 20)) {
  lines.push(`- @${p} ${asciiSlice(b248, p - 40, p + 40)}`)
}
lines.push('')

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out, 'npHits', npHits.length)
