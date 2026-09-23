/**
 * Peel official x/a key table around fleet_view_stop_job / archive.
 */
import { writeFileSync } from 'fs'
import { EXE_248, asciiSlice, loadSea } from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-gc-stop-x',
  `when=${new Date().toISOString()}`,
  '',
]

function dump(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

dump('before-stop-job', 192191400, 0, 900)
dump('archive-key-hunt', 192193200, 0, 900)
dump('bands-active', 192191200, 0, 400)

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-gc-stop-x.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-gc-stop-x.txt')
