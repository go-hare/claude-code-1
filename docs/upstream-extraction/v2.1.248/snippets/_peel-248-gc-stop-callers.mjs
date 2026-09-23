/**
 * Find official callers of stopRemote / archiveRemote (not the method def).
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
  '# gold-248-gc-stop-callers',
  `when=${new Date().toISOString()}`,
  '',
]

for (const n of [
  'stopRemote',
  'archiveRemote',
  'interruptRemoteSession',
  'archiveRemoteSession',
  'fleet_view_stop_session',
  'fleet_view_archive_session',
  'tengu_bg_agent_action',
]) {
  const hits = allHits(buf, n)
  lines.push(`## ${JSON.stringify(n)} hits=${hits.length}`)
  for (const i of hits.slice(0, 12)) {
    lines.push(`@${i}`)
    lines.push(asciiSlice(buf, i - 160, i + n.length + 200))
    lines.push('')
  }
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-gc-stop-callers.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-gc-stop-callers.txt')
