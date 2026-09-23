import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  loadSea,
  asciiSlice,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)

function extractAt(i, maxLen = 20000) {
  const win = asciiSlice(buf, i, i + maxLen)
  let depth = 0
  let inStr = null
  let esc = false
  let started = false
  for (let p = 0; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '{') {
      depth++
      started = true
    } else if (c === '}') {
      depth--
      if (started && depth === 0) {
        const body = win.slice(0, p + 1)
        return { body, sha: sha(body), len: body.length }
      }
    }
  }
  return { missEnd: true, preview: win.slice(0, 400) }
}

const lines = ['# gold-248-be-mgt', '']

// Be full already have; wrappers around telemetryHandles
lines.push('## telemetry wrapper cluster')
lines.push(asciiSlice(buf, 178561000, 178562200))
lines.push('')

// find mGt definition
for (const n of [
  'var mGt=',
  'mGt=new',
  'class mGt',
  'mGt=new K',
  'new K(()=>',
  'WeakOwnerCache',
]) {
  const hits = allHits(buf, n)
  lines.push(`## ${n} hits=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    if (i < 178500000 || i > 180500000) continue
    lines.push(`@${i} ${asciiSlice(buf, i - 60, i + 350).replace(/\n/g, ' ')}`)
    lines.push('')
  }
}

// Search invalidateAll near settings host
const hits = allHits(buf, 'invalidateAll')
lines.push(`## invalidateAll near 1785-1792`)
for (const i of hits) {
  if (i < 178500000 || i > 179200000) continue
  lines.push(`@${i} ${asciiSlice(buf, i - 100, i + 200).replace(/\n/g, ' ')}`)
  lines.push('')
}

// Find class that has mergedSettings near ra()
lines.push('## around ra @179035686')
lines.push(asciiSlice(buf, 179034800, 179036400))
lines.push('')

// Look backward for mGt assignment
lines.push('## lookback for mGt before G$')
const g = allHits(buf, 'mGt.of(t.host)')[0]
if (g) {
  lines.push(asciiSlice(buf, g - 2000, g + 100))
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-be-mgt.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-be-mgt.txt')
