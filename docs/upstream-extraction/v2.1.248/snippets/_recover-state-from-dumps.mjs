import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir =
  'C:/Users/Administrator/.cursor/projects/d-work-py-claude-claude-code/agent-tools'
const files = readdirSync(dir).filter(f => f.endsWith('.txt'))
let best = null

for (const f of files) {
  const p = join(dir, f)
  const st = statSync(p)
  if (st.size < 50000) continue
  const t = readFileSync(p, 'utf8')
  if (
    !t.includes('surfaceCapabilities.markRemote') &&
    !t.includes('Official On @178580174')
  ) {
    continue
  }
  const start = t.indexOf('import type { BetaMessageStreamParams')
  if (start < 0) continue
  const omit = t.indexOf('[... omitted', start)
  const end = omit > 0 ? omit : Math.min(start + 600000, t.length)
  const slice = t.slice(start, end)
  const hasSessionParam =
    /export function switchSession\(\s*sessionId:\s*SessionId/.test(slice) ||
    slice.includes('export function switchSession(\n  sessionId: SessionId') ||
    slice.includes('export function switchSession(\r\n  sessionId: SessionId')
  const hasMeterParam =
    /export function setMeter\(\s*meter:/.test(slice) ||
    slice.includes('export function setMeter(\n  meter:')
  const broken =
    slice.includes('if (currentId !== sessionId)') && !hasSessionParam
  const score =
    (hasSessionParam ? 1_000_000 : 0) +
    (hasMeterParam ? 500_000 : 0) +
    (broken ? -800_000 : 0) +
    (slice.includes('pa.noteInvalidation') ? 100_000 : 0) +
    (slice.includes('stickyBetas') && slice.includes('LAND cut')
      ? 50_000
      : 0) +
    slice.length
  console.log(
    f,
    'slice',
    slice.length,
    'score',
    score,
    'sessParam',
    hasSessionParam,
    'meter',
    hasMeterParam,
    'broken',
    broken,
  )
  if (!best || score > best.score) {
    best = { f, p, score, start, end, slice }
  }
}

if (!best) {
  console.log('no candidate')
  process.exit(1)
}
console.log('BEST', best.f, best.score)

// Unescape JSON-ish escapes if present (\r\n as two-char sequences)
let body = best.slice
if (body.includes('\\n') && !body.includes('\nexport function')) {
  body = body
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

writeFileSync('docs/upstream-extraction/v2.1.248/snippets/_recovered-state.ts.txt', body)
console.log('wrote recovery preview', body.length)
console.log('head', body.slice(0, 200))
console.log('has switchSession param', /switchSession\(\s*sessionId:/.test(body))
console.log('type State fields sample', body.includes('type State = {'))
