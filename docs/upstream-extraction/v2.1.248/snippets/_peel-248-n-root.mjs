import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  extractFnAt,
  loadSea,
  sha,
  asciiSlice,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-n-root', '']

function extractClassAt(i, maxLen = 12000) {
  const win = asciiSlice(buf, i, i + maxLen)
  if (!win.startsWith('class ')) return { i, miss: true, preview: win.slice(0, 80) }
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
        return { i, body, sha: sha(body), len: body.length }
      }
    }
  }
  return { i, missEnd: true, preview: win.slice(0, 200) }
}

for (const n of [
  'function es(',
  'function n(',
  'function Xi(',
  'function en(',
]) {
  const hits = allHits(buf, n)
  lines.push(`## ${n} hits=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    const ext = extractFnAt(buf, i, i > 178500000 && i < 178560000 ? 8000 : 1200)
    if (ext.body && ext.body.length < 3500) {
      lines.push(`@${i} sha=${ext.sha} ${ext.body}`)
    } else if (ext.body) {
      lines.push(`@${i} sha=${ext.sha} len=${ext.len} ${ext.body.slice(0, 400)}…`)
    } else {
      lines.push(`@${i} ${JSON.stringify(ext)}`)
    }
  }
  lines.push('')
}

const classNeedles = [
  'class re{',
  'class ge{',
  'class ae{',
  'class le{',
  'class ye{',
  'class de{',
  'class fe{',
  'class me{',
  'class Ee{',
  'class He{',
  'class ne{',
  'class Pe{',
  'class be{',
  'class Me{',
  'class ke{',
  'class oe{',
  'class ie{',
  'class se{',
  'class ue{',
  'class Ae{',
  'class we{',
  'class xe{',
  'class ce{',
  'class pe{',
  'class Te{',
  'class he{',
  'class Le{',
  'class Se{',
  'class Ce{',
  'class Re{',
  'class Zt{',
]

for (const n of classNeedles) {
  const hits = allHits(buf, n).filter(i => i > 178500000 && i < 178560000)
  lines.push(`## ${n} near-host hits=${hits.length} ${hits.slice(0, 6).join(',')}`)
  for (const i of hits.slice(0, 2)) {
    const ext = extractClassAt(i, 16000)
    if (ext.body) {
      lines.push(`@${i} sha=${ext.sha} len=${ext.len}`)
      lines.push(ext.body)
    } else {
      lines.push(`@${i} ${JSON.stringify(ext)}`)
    }
  }
  lines.push('')
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-n-root.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-n-root.txt lines', lines.length)
