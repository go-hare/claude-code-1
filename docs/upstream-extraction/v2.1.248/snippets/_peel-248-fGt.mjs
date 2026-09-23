import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  loadSea,
  asciiSlice,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)

function extractAt(i, maxLen = 25000) {
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
  return { missEnd: true, preview: win.slice(0, 500) }
}

const lines = ['# gold-248-fGt', '']
for (const n of ['class fGt{', 'class fGt ', 'function fGt']) {
  const hits = allHits(buf, n)
  lines.push(`## ${n} hits=${hits.length}`)
  for (const i of hits.slice(0, 3)) {
    lines.push(`@${i}`)
    lines.push(JSON.stringify(extractAt(Math.max(0, i - 20), 20000)))
    lines.push('')
  }
}

// Look near invalidateAll @178505706 for class start
lines.push('## lookback class before invalidateAll @178505706')
lines.push(asciiSlice(buf, 178504000, 178506200))

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-fGt.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-fGt.txt')
