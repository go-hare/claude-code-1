import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  extractFnAt,
} from './_peel-248-na-helpers.mjs'

const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-16-yu-li.txt'
const b = loadSea(EXE_248)
const lines = ['# gold-248-16-yu-li3', `when=${new Date().toISOString()}`, '']

function catalog(needle, max = 40) {
  const n = Buffer.from(needle)
  const rows = []
  let i = 0
  while (i < b.length && rows.length < max) {
    const k = b.indexOf(n, i)
    if (k < 0) break
    rows.push({ i: k, preview: asciiSlice(b, k, k + 120) })
    i = k + n.length
  }
  return rows
}

for (const needle of [
  'function Yu(',
  'function ZZ(',
  'function Zg(',
  'function Li(',
  'function se(',
  'function Wo(',
]) {
  const rows = catalog(needle, 80)
  lines.push(`## catalog ${needle} count<=${rows.length}`)
  for (const r of rows) {
    const keep =
      r.preview.includes('return') &&
      (r.preview.includes('Map') ||
        r.preview.includes('Set') ||
        r.preview.includes('60000') ||
        r.preview.includes('blur') ||
        r.preview.includes('href') ||
        r.preview.includes('children') ||
        r.preview.includes('unique') ||
        r.preview.includes('[...]') ||
        r.preview.includes('new Set') ||
        r.preview.includes('filter') ||
        r.preview.includes('min') ||
        r.preview.includes('Math') ||
        r.preview.includes('interval') ||
        r.preview.includes('focus') ||
        r.preview.includes('presence') ||
        r.preview.includes('??') ||
        /return \d/.test(r.preview))
    if (keep || needle === 'function ZZ(' || needle === 'function Zg(') {
      lines.push(`@${r.i} ${r.preview}`)
    }
  }
  lines.push('')
}

// dump likely Yu interval: search 60000 near function Yu
const yuHits = catalog('function Yu(', 30)
for (const r of yuHits) {
  const win = asciiSlice(b, r.i, r.i + 200)
  if (
    win.includes('60000') ||
    win.includes('blur') ||
    win.includes('focus') ||
    win.includes('??') ||
    win.includes('Math.min') ||
    win.includes('Math.max')
  ) {
    const ext = extractFnAt(b, r.i, 800)
    lines.push(`## Yu-cand @${r.i} len=${ext.len}`)
    lines.push(ext.body ?? win)
    lines.push('')
  }
}

// Li that takes Map+Set
const liHits = catalog('function Li(', 40)
for (const r of liHits) {
  const win = asciiSlice(b, r.i, r.i + 220)
  if (win.includes('Map') || win.includes('.has') || win.includes('new Map')) {
    const ext = extractFnAt(b, r.i, 800)
    lines.push(`## Li-cand @${r.i} len=${ext.len}`)
    lines.push(ext.body ?? win)
    lines.push('')
  }
}

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out, 'bytes', lines.join('\n').length)
