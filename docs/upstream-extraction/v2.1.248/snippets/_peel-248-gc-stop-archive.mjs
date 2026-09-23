/**
 * Peel official gc stopRemote / archiveRemote bodies + leftover callers.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-gc-stop-archive',
  `when=${new Date().toISOString()}`,
  '',
]

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

for (const n of [
  'async stopRemote(',
  'async archiveRemote(',
  'Q.stopRemote(',
  'Q.archiveRemote(',
  '.stopRemote(',
  '.archiveRemote(',
  'function Di(',
  'isArchiving(',
]) {
  const hits = allHits(buf, n)
  lines.push(`## needle ${JSON.stringify(n)} hits=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    if (n.startsWith('function ') || n.startsWith('async ')) {
      const ext = extractFnAt(buf, i, 900)
      lines.push(`@${i} sha=${ext.sha ?? ''} ${ext.body ?? JSON.stringify(ext)}`)
    } else {
      lines.push(`@${i}`)
      lines.push(asciiSlice(buf, i - 220, i + n.length + 280))
    }
  }
  lines.push('')
}

dumpAround('stopRemote-192140740', 192140740, 0, 900)
dumpAround('archiveRemote-192141329', 192141329, 80, 650)
dumpAround('pc-fc-Ah-Th', 192129961, 80, 80)

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-gc-stop-archive.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-gc-stop-archive.txt')
