/**
 * Peel densable 2.1.289 print/headless task_notification coalesce gold.
 */
import { writeFileSync } from 'fs'
import {
  loadSea,
  asciiSlice,
  extractFnAt,
  allHits,
} from './_peel-289-helpers.mjs'

const buf = loadSea()
const out = []

function save(name, body) {
  const p = new URL(`./${name}`, import.meta.url).pathname
  writeFileSync(p, body)
  out.push(p)
  console.log('wrote', name, body.length)
}

save(
  'gold-289-Kc-print-drain-coalesce@206134754.js',
  asciiSlice(buf, 206134754, 206139400),
)
save(
  'gold-289-Ch@206130032.js',
  `${extractFnAt(buf, 206130032, 2000).body}\n`,
)
save(
  'gold-289-Ph@206129066.js',
  `${extractFnAt(buf, 206129066, 3000).body}\n`,
)
save(
  'gold-289-vh@206130308.js',
  `${extractFnAt(buf, 206130308, 2000).body}\n`,
)
save(
  'gold-289-mut@187407115.js',
  `${extractFnAt(buf, 187407115, 500).body}\n`,
)
save(
  'gold-289-Uf-queueable@187410833.js',
  `${extractFnAt(buf, 187410833, 500).body}\n`,
)
save(
  'gold-289-holdsQueryForFollower@206133282.txt',
  asciiSlice(buf, 206133150, 206133520),
)
save(
  'gold-289-Th-fwt@206130021.txt',
  `${asciiSlice(buf, 206129980, 206130040)}\n${asciiSlice(buf, 180469200, 180469260)}\n`,
)
save(
  'gold-289-coalesce-gate-swirling@206145003.txt',
  asciiSlice(buf, 206144900, 206145120),
)
save(
  'gold-289-Di-emit@181946586.js',
  `${extractFnAt(buf, 181946586, 2000).body}\n`,
)
save(
  'gold-289-gx-strip-output@181946180.js',
  `${extractFnAt(buf, 181946180, 500).body}\n`,
)
save(
  'gold-289-$c-merge-prompts@206128401.js',
  `${extractFnAt(buf, 206128401, 2000).body}\n`,
)
save(
  'gold-289-Fu-tag@179437304.txt',
  asciiSlice(buf, 179437300, 179437380),
)

// noteTurnEnded + owed_call excerpt
save(
  'gold-289-Kc-take-coalesce-core@206135858.txt',
  asciiSlice(buf, 206135858, 206136700),
)
save(
  'gold-289-Kc-noteTurnEnded@206138650.txt',
  asciiSlice(buf, 206138650, 206139100),
)

console.log(JSON.stringify({ files: out, hits: {
  print_task_notification_coalesce: allHits(buf, 'print_task_notification_coalesce'),
  coalesceTaskNotifications: allHits(buf, 'coalesceTaskNotifications'),
  tengu_swirling_meteor: allHits(buf, 'tengu_swirling_meteor'),
}}, null, 2))
