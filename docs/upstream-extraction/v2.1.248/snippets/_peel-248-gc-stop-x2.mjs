/**
 * Hunt official x/a remote branch near gg key handler.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-gc-stop-x2',
  `when=${new Date().toISOString()}`,
  '',
]

function dump(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

for (const n of [
  '["stopRemote"]',
  'stopRemote:',
  'archiveRemote:',
  'Q.stopRemote',
  'd.stopRemote',
  'i.stopRemote',
  'roster.stopRemote',
  '.stopRemote',
  'await Q.stop',
  'key:"a"',
  'label:"archive"',
  "key:\"a\"",
]) {
  const hits = allHits(buf, n)
  lines.push(`## ${JSON.stringify(n)} hits=${hits.length} ${hits.slice(0, 8).join(',')}`)
  for (const i of hits.slice(0, 3)) dump(n, i, 120, 180)
}

dump('cp-full-start', 192191430, 0, 1600)

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-gc-stop-x2.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-gc-stop-x2.txt')
