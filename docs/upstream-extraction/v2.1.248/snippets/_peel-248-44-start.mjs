/**
 * Peel #44 — official UDS start failure recording + setup (no invent).
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

const buf = loadSea(EXE_248)
const lines = ['# gold-248-44-start', '']

function dump(label, needle, max = 8, before = 140, after = 280) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label}  hits=${hits.length}  ${JSON.stringify(needle)}`)
  for (const h of hits.slice(0, max)) {
    lines.push(`- @${h} ${asciiSlice(buf, h - before, h + after)}`)
  }
  lines.push('')
  return hits
}

dump('setup_uds', 'setup_uds')
dump('Failed to start messaging', 'Failed to start messaging')
dump('Failed to start messaging socket', 'Failed to start messaging socket')
dump('Skipped: cross-session', '[uds-messaging] Skipped: cross-session messaging gate off')
dump('Zmr(', 'Zmr(')
dump('Wnr(', 'Wnr(')
dump('lastStartFailureCause=', 'lastStartFailureCause=')
dump('socket_dir_refused"', '"socket_dir_refused"')
dump('primary_dir_refused_fell_back"', '"primary_dir_refused_fell_back"')
dump('Failed to set up sockets', 'Failed to set up sockets')
dump('refusing to bind', 'refusing to bind')
dump('mkdir recursive 0700 uds', 'recursive:!0,mode:448')

// Who calls Zmr / Wnr
for (const needle of ['Zmr(', 'Wnr(']) {
  for (const h of allHits(buf, needle)) {
    const fn = lastFnStartGeneric(buf, h, 3000)
    lines.push(`## ${needle} @${h} lastFn=${fn.name} @${fn.i}`)
    lines.push(asciiSlice(buf, h - 200, h + 200))
    if (fn.i >= 0) {
      const ex = extractFnAt(buf, fn.i, 4000)
      lines.push(`extract ${fn.name} len=${ex.len} sha=${ex.sha}`)
      if (ex.body) lines.push(ex.body.slice(0, 2500))
    }
    lines.push('')
  }
}

// Search lastStartFailureCause=e / =t / =o / =i / =d
for (const suf of ['e', 't', 'i', 'd', 'l', 'o', 'n', 'r', 'u', 'p', 'h']) {
  const n = `lastStartFailureCause=${suf}`
  const hits = allHits(buf, n)
  if (hits.length) {
    lines.push(`## var assign ${n} hits=${hits.length}`)
    for (const h of hits) lines.push(`- @${h} ${asciiSlice(buf, h - 80, h + 80)}`)
  }
}

for (const suf of ['e', 't', 'i', 'd', 'l', 'o', 'n', 'r']) {
  const n = `lastStartFailureDetail=${suf}`
  const hits = allHits(buf, n)
  if (hits.length) {
    lines.push(`## var assign ${n} hits=${hits.length}`)
    for (const h of hits) lines.push(`- @${h} ${asciiSlice(buf, h - 80, h + 80)}`)
  }
}

// Official start wrapper around ye — look for socket_dir in 20205-20208
lines.push('## window @202073800 after ye')
lines.push(asciiSlice(buf, 202073800, 202076200))
lines.push('')

// Find export of Zmr / r0t / wZe
dump('export Zmr', 'Zmr,')
dump('export r0t', 'r0t,')
dump('export wZe comma', 'wZe,')

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-44-start.txt',
  lines.join('\n'),
)
console.log('wrote', lines.length)
