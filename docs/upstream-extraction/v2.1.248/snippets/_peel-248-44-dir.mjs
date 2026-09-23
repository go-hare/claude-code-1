/**
 * Peel #44 socket-dir setup + lastStartFailureDetail setter + /status.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
  lastFnStart,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-44-dir', `# when=${new Date().toISOString()}`, '']

function dump(label, needle, max = 15, before = 120, after = 280) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label}  needle=${JSON.stringify(needle)}  hits=${hits.length}`)
  for (const h of hits.slice(0, max)) {
    lines.push(`- @${h} ${asciiSlice(buf, h - before, h + after)}`)
  }
  if (hits.length > max) lines.push(`- … +${hits.length - max}`)
  lines.push('')
  return hits
}

dump('socket_dir_refused=', 'socket_dir_refused')
dump('lastStartFailureDetail space=', 'lastStartFailureDetail =')
dump('lastStartFailureDetail colon', 'lastStartFailureDetail:')
dump('Failed to set up sockets directory', 'Failed to set up sockets directory')
dump('refusing to bind', 'refusing to bind')
dump('cc-socks', 'cc-socks')
dump('getDefault / sockets path', 'default socket')
dump('XDG first in uds chunk', 'process.env.XDG_RUNTIME_DIR')
dump('os.tmpdir uds', 'tmpdir()')
dump('CLAUDE_CODE_TMPDIR||', 'CLAUDE_CODE_TMPDIR||')
dump('XDG_RUNTIME_DIR||', 'XDG_RUNTIME_DIR||')
dump('isSymbolicLink socket', 'isSymbolicLink')
dump('peerDirOwnerUids', 'peerDirOwnerUids')
dump('Cross-session messaging:', 'Cross-session messaging')
dump('Messaging socket', 'Messaging socket')
dump('Inbox socket', 'Inbox socket')
dump('status messaging', 'messaging socket')
dump('wZe(', 'wZe(')
dump('uFe.of', 'uFe.of')

// Extract wZe at exact function start
const wzeHits = allHits(buf, 'function wZe(e){if(e.startInFlight')
if (wzeHits[0] !== undefined) {
  const ex = extractFnAt(buf, wzeHits[0], 2000)
  lines.push('## EXTRACT wZe FULL')
  lines.push(`i=${wzeHits[0]} len=${ex.len} sha=${ex.sha}`)
  lines.push(ex.body || JSON.stringify(ex))
  lines.push('')
}

// Find function that mentions socket_dir_refused assignment-like
for (const h of allHits(buf, 'socket_dir_refused')) {
  const win = asciiSlice(buf, h - 600, h + 400)
  lines.push(`## socket_dir_refused context @${h}`)
  lines.push(win)
  lines.push('')
  const fn = lastFnStartGeneric(buf, h, 8000)
  lines.push(`  lastFnGeneric name=${fn.name} i=${fn.i}`)
  if (fn.i >= 0) {
    const ex = extractFnAt(buf, fn.i, 14000)
    lines.push(`  extract len=${ex.len} sha=${ex.sha} miss=${ex.miss || ex.missEnd}`)
    if (ex.body && ex.body.includes('socket_dir_refused')) {
      lines.push(ex.body.slice(0, 8000))
    } else {
      lines.push(asciiSlice(buf, fn.i, fn.i + 1500))
    }
  }
  lines.push('')
}

// Default path / runtime dir around 202069031 (X hint)
lines.push('## window @202068400 runtime dir')
lines.push(asciiSlice(buf, 202068400, 202070200))
lines.push('')

// Search functions near X="Point XDG
const xHit = buf.indexOf(Buffer.from('var X="Point XDG_RUNTIME_DIR'))
lines.push(`## var X Point XDG @${xHit}`)
if (xHit >= 0) {
  lines.push(asciiSlice(buf, xHit - 2000, xHit + 2500))
}
lines.push('')

// p_() CLAUDE_CODE_TMPDIR
const pHit = buf.indexOf(Buffer.from('function p_(){let e=a.CLAUDE_CODE_TMPDIR'))
lines.push(`## p_ @${pHit}`)
if (pHit >= 0) {
  const ex = extractFnAt(buf, pHit, 4000)
  lines.push(`len=${ex.len} sha=${ex.sha}`)
  lines.push(ex.body || asciiSlice(buf, pHit, pHit + 2000))
}
lines.push('')

// q9 after p_
const qHit = buf.indexOf(Buffer.from('function q9(e){let r=process.getuid'))
lines.push(`## q9 @${qHit}`)
if (qHit >= 0) {
  const ex = extractFnAt(buf, qHit, 6000)
  lines.push(`len=${ex.len} sha=${ex.sha}`)
  lines.push(ex.body || asciiSlice(buf, qHit, qHit + 2500))
}
lines.push('')

// Look for default uds path builder near cc-socks
for (const h of allHits(buf, 'cc-socks')) {
  lines.push(`## cc-socks @${h}`)
  lines.push(asciiSlice(buf, h - 500, h + 400))
  lines.push('')
}

// /status properties that mention socket / messaging
for (const needle of [
  'label:"Messaging"',
  'label:"Cross-session"',
  'label:"Inbox"',
  'label:"Socket"',
  'Cross-session messaging',
  'wZe(',
]) {
  dump(`scan ${needle}`, needle, 8, 80, 200)
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-44-dir.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-44-dir.txt', lines.length)
