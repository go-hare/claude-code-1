#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BIN = String.raw`C:\Users\Administrator\AppData\Local\Temp\official-239\package\claude.exe`
const buf = readFileSync(BIN)

function decode(start, end) {
  let s = ''
  for (let i = start; i < end && i < buf.length; i++) {
    const b = buf[i]
    if (b === 0x09) s += '\t'
    else if (b === 0x0a) s += '\n'
    else if (b === 0x0d) s += '\r'
    else if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b)
    else s += '.'
  }
  return s
}

function hits(needle) {
  const n = Buffer.from(needle)
  const out = []
  let i = 0
  while (out.length < 6) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    out.push(j)
    i = j + 1
  }
  return out
}

const jobs = [
  { kw: 'function M2l(', ctx: 3500 },
  { kw: 'function N4g(', ctx: 2000 },
]

const lines = []
for (const { kw, ctx } of jobs) {
  const hs = hits(kw)
  lines.push(`\n#### ${JSON.stringify(kw)} count=${hs.length}`)
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`)
    lines.push(decode(Math.max(0, i - 80), Math.min(buf.length, i + ctx)))
  }
}

writeFileSync(join(import.meta.dirname, 'gold-m2l.txt'), lines.join('\n'))
console.log('ok')
