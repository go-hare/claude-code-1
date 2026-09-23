/**
 * Classify dead State fields: bag-only vs g() dual vs KEEP.
 * Peel official wrappers near @17855xxxx for each dead field name / camel getter.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const EXE =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const text = readFileSync(EXE, 'latin1')
const dead = readFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-state-dead-audit-now.txt',
  'utf8',
)
  .split('\n')
  .filter(l => l.startsWith('- '))
  .map(l => l.slice(2).trim())
  // only DEAD section — stop before KEEP g
const deadOnly = []
for (const line of readFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-state-dead-audit-now.txt',
  'utf8',
).split('\n')) {
  if (line.startsWith('## KEEP g')) break
  if (line.startsWith('- ')) deadOnly.push(line.slice(2).trim())
}

function hits(n) {
  const h = []
  let i = 0
  while (true) {
    const j = text.indexOf(n, i)
    if (j < 0) break
    h.push(j)
    i = j + n.length
  }
  return h
}

function nearHost(h) {
  return h.filter(o => o > 178500000 && o < 178600000)
}

const lines = ['# gold-248-state-dead-classify', '']

for (const f of deadOnly) {
  // Look for n()....field or g()?.field patterns
  const needles = [
    `g()?.${f}`,
    `g().${f}`,
    `.${f}()`,
    `${f}()`,
  ]
  const hostHits = nearHost(hits(f))
  let sample = ''
  if (hostHits[0] !== undefined) {
    sample = text.slice(Math.max(0, hostHits[0] - 80), hostHits[0] + 200)
  }
  const hasG =
    text.includes(`g()?.${f}`) ||
    text.includes(`g().${f}`) ||
    /g\(\)\?\.[\w.]*\b/.test(sample) && sample.includes(f)
  const gNeedle = hits(`g()?.${f}`).concat(hits(`g().${f}`))
  const nNeedle = nearHost(hits(`n().`)).length // useless
  // Better: search wrappers containing field name in host window
  let verdict = 'UNKNOWN'
  if (gNeedle.length > 0) verdict = 'KEEP_g'
  else if (hostHits.length > 0 && sample.includes('n().')) verdict = 'LAND_bag'
  else if (hostHits.length === 0 && hits(f).length === 0) verdict = 'KEEP_SEA0'
  else verdict = 'PEEL'

  lines.push(`## ${f} verdict=${verdict} nameHits=${hits(f).length} gHits=${gNeedle.length} hostHits=${hostHits.length}`)
  if (sample) {
    lines.push(sample.replace(/\n/g, '\\n').slice(0, 400))
  }
  lines.push('')
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-state-dead-classify.txt',
  lines.join('\n'),
)
console.log('wrote classify', deadOnly.length, 'fields')
