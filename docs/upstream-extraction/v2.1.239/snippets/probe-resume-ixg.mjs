/**
 * Peel iXg/rXg resume_return call graph + idle vs resume distinction.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const exe = join(process.env.TEMP || '', 'official-239', 'package', 'claude.exe')
const text = readFileSync(exe).toString('latin1')
const lines = []
const log = s => {
  console.log(s)
  lines.push(s)
}

function dump(needle, before = 200, after = 800, max = 5) {
  const hits = []
  let from = 0
  while (hits.length < max) {
    const i = text.indexOf(needle, from)
    if (i < 0) break
    hits.push(
      text
        .slice(Math.max(0, i - before), i + after)
        .replace(/[^\x20-\x7e]/g, '.'),
    )
    from = i + needle.length
  }
  return hits
}

for (const n of [
  'function rXg(',
  'async function rXg(',
  'rXg(nr',
  'iXg(Gm,',
  'IdleReturn',
  'idle-return',
  'idleReturn',
  'tengu_idle_return',
  'tengu_resume_return',
  'Resume from summary',
  'sessionAgeMinutes',
  'Welcome back',
]) {
  const hits = dump(n, 120, 600, 3)
  log(`\n==== ${n} (${hits.length}) ====`)
  for (const h of hits) log(h)
}

writeFileSync(
  'docs/upstream-extraction/v2.1.239/snippets/gold-resume-return-iXg.txt',
  lines.join('\n\n'),
)
log('done')
