/**
 * #21 pass7 — wwt unique formatter + callers + leftover host.
 * wwt: `${hook} hook output invalid: ${schema}` — not Swt parse.
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

const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-21-wwt.txt'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = [
  '# gold-248-21-wwt',
  `when=${new Date().toISOString()}`,
  'contract=wwt unique 248 hook+schema row copy; find callers + leftover host',
  '',
]

function dump(buf, label, needle, around = 220, cap = 12) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const [i, p] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${i} @${p} ${asciiSlice(buf, p - around, p + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

function dumpFn(buf, label, i, maxLen = 12000) {
  const start = lastFnStartGeneric(buf, i, 16000)
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
  return ext
}

// wwt itself
dumpFn(b248, 'wwt', 186237955, 2000)

// callers
for (const n of [
  'wwt(',
  'wwt(e',
  'function wwt',
  'hook output invalid: ',
  'hook failed to run',
  'function olt',
  'Eve.length',
  'startsWith(Eve)',
]) {
  dump(b248, `248 ${n}`, n)
}

for (const n of ['wwt(', 'function olt', 'hook output invalid: ']) {
  const hits = allHits(b248, n)
  for (const p of hits) dumpFn(b248, `caller ${n}`, p, 14000)
}

// neighbors after kwt / before olt
lines.push('# window after kwt / wwt / olt')
lines.push(asciiSlice(b248, 186236662, 186236662 + 4500))
lines.push('')

// 247 equivalents
for (const n of [
  'hook output invalid',
  'hook failed to run',
  'function wwt',
  'startsWith(Eve)',
  'Hook JSON output validation failed',
]) {
  dump(b247, `247 ${n}`, n, 160, 6)
}

// leftover-ish: lastEmittedDetail / onClassified from earlier window
dump(b248, '248 lastEmittedDetail', 'lastEmittedDetail')
dump(b248, '248 onClassified', 'onClassified')
dump(b247, '247 lastEmittedDetail', 'lastEmittedDetail')

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out, 'lines', lines.length)
