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
  { kw: 'function iqe(', ctx: 2500 },
  { kw: 'async function iqe(', ctx: 2500 },
  { kw: 'iqe()', ctx: 1800 },
  { kw: 'skills-sync veto', ctx: 1500 },
  { kw: 'syncClaudeAiSkills', ctx: 2000 },
  { kw: 'function T4r(', ctx: 3500 },
  { kw: 'async function T4r(', ctx: 3500 },
  { kw: 'function Tli(', ctx: 2500 },
  { kw: 'async function Tli(', ctx: 2500 },
  { kw: 'expectPeerPid', ctx: 1800 },
  { kw: 'noFollowSymlink', ctx: 1800 },
  { kw: 'function Qei(', ctx: 2500 },
  { kw: 'function ELe(', ctx: 1500 },
  { kw: 'function g0m(', ctx: 1500 },
  { kw: 'function w0m(', ctx: 1500 },
]

const lines = []
for (const { kw, ctx } of jobs) {
  const hs = hits(kw, 8)
  lines.push(`\n#### ${JSON.stringify(kw)} count=${hs.length} [${hs.join(',')}]`)
  for (const i of hs.slice(0, 3)) {
    lines.push(`--- ${i} ---`)
    lines.push(decode(Math.max(0, i - Math.floor(ctx / 4)), Math.min(buf.length, i + ctx)))
  }
}

writeFileSync(join(import.meta.dirname, 'gold-review-239-overall.txt'), lines.join('\n'))
console.log('ok', lines.length)
