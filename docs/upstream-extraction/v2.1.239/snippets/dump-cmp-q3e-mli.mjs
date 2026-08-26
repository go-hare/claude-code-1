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

function hits(needle, max = 8) {
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
  { kw: 'function q3e(', ctx: 2000 },
  { kw: 'function mli(', ctx: 2500 },
  { kw: 'Bun.ant.getPeerPid', ctx: 1800 },
  { kw: 'function TWd', ctx: 800 },
  { kw: 'type:TWd', ctx: 800 },
  { kw: 'Refusing to send: reply target is a symlink', ctx: 400 },
  { kw: 'connected endpoint is not the expected process', ctx: 400 },
]

const lines = []
for (const { kw, ctx } of jobs) {
  const hs = hits(kw)
  lines.push(`\n#### ${JSON.stringify(kw)} count=${hs.length} [${hs.join(',')}]`)
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`)
    lines.push(decode(Math.max(0, i - 80), Math.min(buf.length, i + ctx)))
  }
}

writeFileSync(join(import.meta.dirname, 'gold-cmp-q3e-mli.txt'), lines.join('\n'))
console.log('ok', lines.length)
