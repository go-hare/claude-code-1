import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  loadSea,
  asciiSlice,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
function extractClassAt(i, maxLen = 8000) {
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
  return { missEnd: true, preview: win.slice(0, 200) }
}

const lines = ['# gold-248-n-hostbags', '']
for (const n of ['class Ue{', 'class _e{', 'class qe{', 'class We{', 'class Ge{', 'class Ne{']) {
  const hits = allHits(buf, n).filter(i => i > 178530000 && i < 178555000)
  lines.push(`## ${n} ${hits[0]}`)
  if (hits[0]) {
    const ext = extractClassAt(hits[0], 6000)
    lines.push(JSON.stringify(ext))
  }
  lines.push('')
}
writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-n-hostbags.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-n-hostbags.txt')
