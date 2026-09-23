import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-SKn-primer', '']

function extractClassAt(i, maxLen = 12000) {
  const win = asciiSlice(buf, i, i + maxLen)
  if (!win.startsWith('class ')) return { miss: true, preview: win.slice(0, 80) }
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

for (const n of [
  'class SKn{',
  'class SKn ',
  'e.primer=new SKn',
  'primer=new SKn',
  '.primer=',
  'this.primer',
]) {
  const hits = allHits(buf, n)
  lines.push(`## needle=${JSON.stringify(n)} hits=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 100), i + 600)}`)
    lines.push('')
  }
}

for (const n of ['class SKn{', 'class SKn ']) {
  for (const i of allHits(buf, n).slice(0, 3)) {
    const ext = extractClassAt(i)
    lines.push(`## FULL @${i}`)
    if (ext.body) {
      lines.push(`sha=${ext.sha} len=${ext.len}`)
      lines.push(ext.body)
    } else {
      lines.push(JSON.stringify(ext))
    }
    lines.push('')
  }
}

writeFileSync(new URL('./gold-248-SKn-primer.txt', import.meta.url), lines.join('\n'))
console.log('wrote gold-248-SKn-primer.txt')
