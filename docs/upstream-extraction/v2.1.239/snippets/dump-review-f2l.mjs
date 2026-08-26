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

function hits(needle, max = 12) {
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

const jobs = [
  { kw: '$2l(', ctx: 800 },
  { kw: 'await $2l(', ctx: 2500 },
  { kw: 'deferredToolUse:f,', ctx: 4000 },
  { kw: 'function eL(', ctx: 2000 },
  { kw: 'async function eL(', ctx: 2000 },
  { kw: 'deferredToolUse:je', ctx: 1500 },
  { kw: 'deferredToolUse:Q', ctx: 3000 },
]

const lines = []
for (const { kw, ctx } of jobs) {
  const hs = hits(kw)
  lines.push(`\n#### ${JSON.stringify(kw)} count=${hs.length}`)
  for (const i of hs.slice(0, 4)) {
    const start = Math.max(0, i - Math.floor(ctx / 3))
    const end = Math.min(buf.length, i + ctx)
    lines.push(`--- ${i} ---`)
    lines.push(decode(start, end))
  }
}

writeFileSync(join(import.meta.dirname, 'gold-review-f2l.txt'), lines.join('\n'))
console.log('ok')
