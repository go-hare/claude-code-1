/**
 * Peel official Ie wrappers + gc.loadRemote body + listRemoteSessions.
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
  '# gold-248-ie-remote2',
  `exe=${EXE_248}`,
  `when=${new Date().toISOString()}`,
  '',
]

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpHits(label, needle, around = 180, cap = 8) {
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

function dumpFn(label, needle, maxLen = 12000) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const i of hits.slice(0, 3)) {
    const ext = extractFnAt(buf, i, maxLen)
    lines.push(`@${i} len=${ext.len ?? ''} sha=${ext.sha ?? ''}`)
    lines.push(ext.body ?? JSON.stringify(ext))
    lines.push('')
  }
}

dumpAround('ie-class-178534988', 178534988, 20, 3200)
dumpAround('wrappers-178553200', 178553200, 0, 900)
dumpAround('wrappers-178565000', 178565000, 0, 2200)
dumpAround('loadRemote-192140121', 192140121, 80, 2800)
dumpAround('setRemoteWanted-192267700', 192267700, 80, 400)
dumpAround('Z-simpleWantsRemote-192274680', 192274680, 0, 800)

dumpHits('function Yk(', 'function Yk(')
dumpHits('function c7e(', 'function c7e(')
dumpHits('function Ads(', 'function Ads(')
dumpHits('restrictedSession()', 'restrictedSession()')
dumpHits('replaceRestrictedSession', 'replaceRestrictedSession')
dumpHits('listRemoteSessions', 'listRemoteSessions')
dumpHits('function WKe(', 'function WKe(')
dumpHits('function Gu(', 'function Gu(')
dumpHits('function Vu(', 'function Vu(')
dumpHits('function Dh(', 'function Dh(')
dumpHits('KEn as ', 'KEn as ')
dumpHits('YEn as ', 'YEn as ')
dumpHits('Yk as ', 'Yk as ')
dumpHits('c7e as ', 'c7e as ')

dumpFn('Yk', 'function Yk(')
dumpFn('c7e', 'function c7e(')
dumpFn('WKe', 'function WKe(')
dumpFn('Vu', 'function Vu(')
dumpFn('Dh', 'function Dh(')

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-ie-remote2.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-ie-remote2.txt', lines.length)
