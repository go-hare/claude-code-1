#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BIN = String.raw`C:\Users\Administrator\AppData\Local\Temp\official-239\package\claude.exe`
const buf = readFileSync(BIN)

// Render LF as \n, CR as \r, tab as \t, other non-printables as .
function decode(start, end) {
  let s = ''
  for (let i = start; i < end && i < buf.length; i++) {
    const b = buf[i]
    if (b === 0x0a) s += '\\n'
    else if (b === 0x0d) s += '\\r'
    else if (b === 0x09) s += '\\t'
    else if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b)
    else s += '\u00b7'
  }
  return s
}
function hits(needle, max = 20) {
  const n = Buffer.from(needle)
  const out = []
  let i = 0
  while (out.length < max) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    out.push(j)
    i = j + 1
  }
  return out
}

const lines = []
for (const [kw, back, ctx] of [
  ['async function tpw', 100, 4200],
  ['function _hS', 200, 3600],
  ['function bpr', 200, 200],
])
{
  const hs = hits(kw)
  lines.push(`\n#### ${kw} count=${hs.length} [${hs.join(',')}]`)
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`)
    const txt = decode(Math.max(0, i - back), Math.min(buf.length, i + ctx))
    for (let k = 0; k < txt.length; k += 170) lines.push(txt.slice(k, k + 170))
  }
}
writeFileSync(join(import.meta.dirname, 'gold-rv-esc.txt'), lines.join('\n'))
console.log('wrote', lines.length)
