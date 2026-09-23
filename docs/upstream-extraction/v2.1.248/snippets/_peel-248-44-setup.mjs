/**
 * Peel #44 — lastStartFailureDetail setter, znr/dir fallback, r0t /status.
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
const lines = ['# gold-248-44-setup', `# when=${new Date().toISOString()}`, '']

function dump(label, needle, max = 12, before = 160, after = 320) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label}  needle=${JSON.stringify(needle)}  hits=${hits.length}`)
  for (const h of hits.slice(0, max)) {
    lines.push(`- @${h} ${asciiSlice(buf, h - before, h + after)}`)
  }
  if (hits.length > max) lines.push(`- … +${hits.length - max}`)
  lines.push('')
  return hits
}

dump('r0t()', 'function r0t(')
dump('r0t call', 'r0t()')
dump('Kmr()', 'function Kmr(')
dump('Kmr call', 'Kmr()')
dump('Ymr()', 'function Ymr(')
dump('primary_dir_refused', 'primary_dir_refused')
dump('lastStartFailureCause=', 'lastStartFailureCause=')
dump('lastStartFailureDetail', 'lastStartFailureDetail')
dump('znr(', 'function znr(')
dump('znr call', 'znr(')
dump('jnr()', 'function jnr(')
dump('Zmr(', 'function Zmr(')
dump('Wnr(', 'function Wnr(')
dump('cc-socks-${', 'cc-socks-${')
dump('cc-socks-', 'cc-socks-')
dump('XDG_RUNTIME_DIR?', 'XDG_RUNTIME_DIR')
dump('a.XDG_RUNTIME_DIR', 'a.XDG_RUNTIME_DIR')
dump('a.CLAUDE_CODE_TMPDIR', 'a.CLAUDE_CODE_TMPDIR')
dump('a.TMPDIR', 'a.TMPDIR')

// extract functions
for (const [name, needle] of [
  ['r0t', 'function r0t()'],
  ['Kmr', 'function Kmr()'],
  ['Ymr', 'function Ymr()'],
  ['ae', 'function ae(e){let t=s()'],
  ['znr', 'function znr('],
  ['jnr', 'function jnr('],
  ['Zmr', 'function Zmr('],
  ['Wnr', 'async function Wnr('],
]) {
  const hits = allHits(buf, needle)
  for (const h of hits.slice(0, 2)) {
    const ex = extractFnAt(buf, h, 8000)
    lines.push(`## EXTRACT ${name} @${h} len=${ex.len} sha=${ex.sha}`)
    lines.push(ex.body || asciiSlice(buf, h, h + 1500))
    lines.push('')
  }
}

// Who calls r0t — windows around each hit
for (const h of allHits(buf, 'r0t()')) {
  lines.push(`## r0t() site @${h}`)
  lines.push(asciiSlice(buf, h - 400, h + 400))
  const fn = lastFnStartGeneric(buf, h, 4000)
  lines.push(`  lastFn=${fn.name} @${fn.i}`)
  if (fn.i >= 0) {
    const ex = extractFnAt(buf, fn.i, 6000)
    lines.push(`  extract len=${ex.len} sha=${ex.sha}`)
    if (ex.body) lines.push(ex.body.slice(0, 4000))
  }
  lines.push('')
}

// Who calls Kmr
for (const h of allHits(buf, 'Kmr()')) {
  lines.push(`## Kmr() site @${h}`)
  lines.push(asciiSlice(buf, h - 350, h + 350))
  lines.push('')
}

// Find lastStartFailureCause= that is NOT a string literal
const causeHits = allHits(buf, 'lastStartFailureCause=')
for (const h of causeHits) {
  const after = asciiSlice(buf, h, h + 80)
  lines.push(`## cause= after @${h}: ${after}`)
}

// Find lastStartFailureDetail= 
const detHits = allHits(buf, 'lastStartFailureDetail')
for (const h of detHits) {
  lines.push(`## detail win @${h}`)
  lines.push(asciiSlice(buf, h - 80, h + 120))
}

// Unix default path picker — look near znr callers and XDG in uds region 20205xxxx
lines.push('## window @202055800 uds helpers')
lines.push(asciiSlice(buf, 202055800, 202058200))
lines.push('')

lines.push('## window @202066800 path builders')
lines.push(asciiSlice(buf, 202066800, 202068200))
lines.push('')

// Search socket dir ensure near Tn/Un (file in the way / symlink loop)
dump('walk sockets / ensure', 'The sockets path runs through a symlink loop')
dump('not a directory (a regular', 'A component of the sockets path is not a directory')

// Find function that uses Tn or Un (sockets path errors)
const tnHits = allHits(buf, 'throw new Error(Tn)')
const tnHits2 = allHits(buf, 'Error(Tn)')
const unHits = allHits(buf, 'Error(Un)')
lines.push(`## Error(Tn) hits=${tnHits.length + tnHits2.length} Error(Un)=${unHits.length}`)
for (const h of [...tnHits, ...tnHits2, ...unHits]) {
  const fn = lastFnStartGeneric(buf, h, 6000)
  lines.push(`@${h} lastFn=${fn.name} @${fn.i}`)
  if (fn.i >= 0) {
    const ex = extractFnAt(buf, fn.i, 10000)
    lines.push(`len=${ex.len} sha=${ex.sha}`)
    lines.push((ex.body || '').slice(0, 5000))
  } else {
    lines.push(asciiSlice(buf, h - 800, h + 400))
  }
  lines.push('')
}

// also "socket_dir" anywhere
dump('socket_dir', 'socket_dir')

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-44-setup.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-44-setup.txt', lines.length)
