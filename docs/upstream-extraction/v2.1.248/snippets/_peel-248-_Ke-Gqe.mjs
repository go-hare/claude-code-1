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
const lines = ['# gold-248-_Ke-Gqe-parent', '']

function extractClassAt(i, maxLen = 20000) {
  const win = asciiSlice(buf, i, i + maxLen)
  if (!win.startsWith('class ')) return null
  let d = 0
  let st = false
  let inS = null
  let esc = false
  for (let p = 0; p < win.length; p++) {
    const c = win[p]
    if (inS) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inS) inS = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inS = c
      continue
    }
    if (c === '{') {
      d++
      st = true
    } else if (c === '}') {
      d--
      if (st && d === 0) return win.slice(0, p + 1)
    }
  }
  return null
}

for (const [label, i] of [
  ['_Ke', 179162866],
  ['Gqe', 179527369],
  ['z', 179527519],
  ['$pn', 179527115],
]) {
  const ext = extractFnAt(buf, i, 12000)
  lines.push(`## ${label} @${i}`)
  if (ext.body) {
    lines.push(`sha=${ext.sha} len=${ext.len}`)
    lines.push(ext.body)
  } else {
    lines.push(asciiSlice(buf, i, i + 3000))
  }
  lines.push('')
}

for (const n of [
  'class Ut{',
  'function uo(',
  'async function uo(',
  'backendView',
  'function Yv(',
]) {
  const hits = allHits(buf, n).filter(i => i > 178800000 && i < 180200000)
  lines.push(`## ${n} near-prime hits=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    if (n.startsWith('class ')) {
      const b = extractClassAt(i)
      if (b) {
        lines.push(`@${i} sha=${sha(b)} len=${b.length}`)
        lines.push(b.length > 5000 ? b.slice(0, 5000) + '…' : b)
      } else {
        lines.push(`@${i} ${asciiSlice(buf, i, i + 400)}`)
      }
    } else if (n.includes('function ')) {
      const ext = extractFnAt(buf, i, 6000)
      if (ext.body) {
        lines.push(`@${i} sha=${ext.sha} len=${ext.len}`)
        lines.push(
          ext.body.length > 3500 ? ext.body.slice(0, 3500) + '…' : ext.body,
        )
      }
    } else {
      lines.push(
        `@${i} ${asciiSlice(buf, Math.max(0, i - 100), i + 500)}`,
      )
    }
    lines.push('')
  }
}

// callers of Gqe(
const gqeCall = allHits(buf, 'Gqe(').filter(i => i > 179000000 && i < 180000000)
lines.push(`## Gqe( callers near prime ${gqeCall.length}`)
for (const i of gqeCall.slice(0, 15)) {
  lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 60), i + 120)}`)
}

writeFileSync(new URL('./gold-248-_Ke-Gqe-parent.txt', import.meta.url), lines.join('\n'))
console.log('wrote', lines.length)
