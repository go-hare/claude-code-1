/**
 * Peel official Ie (launchOptions) + gc.loadRemote / setRemoteWanted / Zs / Te
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-ie-remote',
  `exe=${EXE_248}`,
  `bytes=${buf.length}`,
  `when=${new Date().toISOString()}`,
  '',
]

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpHits(label, needle, around = 160, cap = 8) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(buf, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

// Ie class start near isInteractive + restrictedSession
dumpAround('ie-methods-178535191', 178535191, 200, 2500)
dumpAround('ie-restricted-178535914', 178535914, 200, 2500)
dumpAround('ie-reset-178537925', 178537925, 400, 400)

dumpHits('class Ie{', 'class Ie{')
dumpHits('todoToolsOptIn()', 'todoToolsOptIn()')
dumpHits('replaceTodoToolsOptIn', 'replaceTodoToolsOptIn')
dumpHits('loadRemote(){', 'loadRemote(){')
dumpHits('loadRemote=', 'loadRemote=')
dumpHits('this.loadRemote', 'this.loadRemote')
dumpHits('Zs=!1', 'Zs=!1')
dumpHits('simpleWantsRemote', 'simpleWantsRemote')
dumpHits('setRemoteWanted', 'setRemoteWanted')
dumpHits('remoteListLoaded', 'remoteListLoaded')
dumpHits('remote-pending-', 'remote-pending-')

for (const n of ['loadRemote(){', 'async loadRemote(', 'loadRemote=async']) {
  const hits = allHits(buf, n)
  lines.push(`## extract ${n} hits=${hits.length}`)
  for (const i of hits.slice(0, 4)) {
    const ext = extractFnAt(buf, i, 12000)
    lines.push(`@${i} len=${ext.len} sha=${ext.sha ?? ''}`)
    lines.push(ext.body ?? JSON.stringify(ext))
    lines.push('')
  }
}

// gc.loadRemote as method — search near class gc
const gcHits = allHits(buf, 'class gc{')
lines.push(`## class gc{ @${gcHits}`)
for (const i of gcHits.slice(0, 2)) {
  dumpAround('gc-window', i, 0, 8000)
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-ie-remote.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-ie-remote.txt', lines.length)
