/**
 * #21 pass8 — rA.noteHookFailure + wwt caller + 247 rA + leftover host.
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

const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-21-rA.txt'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = [
  '# gold-248-21-rA',
  `when=${new Date().toISOString()}`,
  '',
]

function dump(buf, label, needle, around = 240, cap = 10) {
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

function dumpFn(buf, label, i, maxLen = 16000) {
  const start = lastFnStartGeneric(buf, i, 20000)
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

for (const n of [
  'noteHookFailure',
  'clearHookFailure',
  'function rA',
  'var rA=',
  'rA.noteHookFailure',
  'rA.clearHookFailure',
  'rA.emit',
  'hook failed to run',
  'worker-sandbox","elicitation","sandbox"',
]) {
  dump(b248, `248 ${n}`, n)
}

for (const n of [
  'noteHookFailure',
  'clearHookFailure',
  'hook output invalid',
  'hook failed to run',
]) {
  dump(b247, `247 ${n}`, n, 160, 4)
}

// extract wwt caller function — look further back from @186308528
dumpFn(b248, 'caller-loop', 186308400, 20000)

// extract rA IIFE from window
const raAt = allHits(b248, 'noteHookFailure')[0]
if (raAt) {
  lines.push('## rA window @noteHookFailure-4000')
  lines.push(asciiSlice(b248, raAt - 2500, raAt + 1800))
  lines.push('')
  dumpFn(b248, 'around noteHookFailure', raAt, 8000)
}

// extract olt + mK + rA contiguous
const wwtAt = 186237955
lines.push('## contiguous wwt..rA')
lines.push(asciiSlice(b248, wwtAt, wwtAt + 2800))
lines.push('')

// np / za truncate
dump(b248, '248 function mK', 'function mK')
dump(b248, '248 var np=', 'var np=')
dump(b248, '248 ,np)', ',np)')

// leftover-ish emit permission with toolUseID
dump(b248, '248 toolUseID:o', 'toolUseID:o')
dump(b248, '248 toolUseID:', 'toolUseID:')

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out, 'lines', lines.length)
