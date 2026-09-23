import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-settings-prime-path', '']

function extractClassAt(i, maxLen = 12000) {
  const win = asciiSlice(buf, i, i + maxLen)
  if (!win.startsWith('class ')) return { miss: true }
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
  return { missEnd: true }
}

for (const n of [
  'async function $pn(',
  'function $pn(',
  'async function Gqe(',
  'settingsPrime:',
  'function wKn(',
  'function Vjt(',
  'function Qve(',
  'function Fte(',
]) {
  const hits = allHits(buf, n)
  lines.push(`## ${n} hits=${hits.length}`)
  for (const i of hits.slice(0, 4)) {
    if (n.startsWith('function ') || n.startsWith('async function ')) {
      const ext = extractFnAt(buf, i, 4000)
      if (ext.body) {
        lines.push(`@${i} sha=${ext.sha} len=${ext.len}`)
        lines.push(ext.body.length > 2500 ? ext.body.slice(0, 2500) + '…' : ext.body)
      } else {
        lines.push(`@${i} ${asciiSlice(buf, i, i + 800)}`)
      }
    } else {
      lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 60), i + 400)}`)
    }
    lines.push('')
  }
}

writeFileSync(
  new URL('./gold-248-settings-prime-path.txt', import.meta.url),
  lines.join('\n'),
)
console.log('wrote gold-248-settings-prime-path.txt')
