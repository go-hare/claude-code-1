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

function hits(needle, max = 40) {
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
  { kw: 'deferred_tool_use', ctx: 1400, back: 1400, take: 12 },
  { kw: 'function H8f', ctx: 4000, back: 300, take: 3 },
  { kw: 'hook_deferred_tool', ctx: 1200, back: 1200, take: 12 },
]

const lines = []
for (const { kw, ctx, back, take } of jobs) {
  const hs = hits(kw)
  lines.push(`\n#### ${JSON.stringify(kw)} count=${hs.length} [${hs.slice(0, 30).join(',')}]`)
  if (hs.length === 0 || ctx === 0) continue
  for (const i of hs.slice(0, take)) {
    const start = Math.max(0, i - back)
    const end = Math.min(buf.length, i + ctx)
    lines.push(`--- ${i} ---`)
    lines.push(decode(start, end))
  }
}

writeFileSync(join(import.meta.dirname, 'gold-rv-defer-sites.txt'), lines.join('\n'))
console.log('wrote', lines.length)
