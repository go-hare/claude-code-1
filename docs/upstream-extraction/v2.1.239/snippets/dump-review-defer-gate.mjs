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
  { kw: 'No deferred tool marker found', ctx: 800 },
  { kw: 'function SLm(', ctx: 2000 },
  { kw: 'SLm()', ctx: 1800 },
  { kw: 'deferredToolUse:f', ctx: 2500 },
  { kw: 'let f=await $2l', ctx: 2000 },
  { kw: 'f=await $2l', ctx: 2000 },
  { kw: 'async function $2l', ctx: 2500 },
  { kw: 'function $2l', ctx: 2500 },
  { kw: 'deferredToolUse:Q,', ctx: 2200 },
  { kw: 'orphanedPermission:ne', ctx: 2200 },
  { kw: 'new _3y({', ctx: 2500 },
  { kw: 'tail-scan window', ctx: 400 },
]

const lines = []
for (const { kw, ctx } of jobs) {
  const hs = hits(kw)
  lines.push(`\n#### ${JSON.stringify(kw)} count=${hs.length} [${hs.join(',')}]`)
  if (hs.length === 0) continue
  for (const i of hs.slice(0, 3)) {
    const start = Math.max(0, i - Math.floor(ctx / 4))
    const end = Math.min(buf.length, i + ctx)
    lines.push(`--- ${i} ---`)
    lines.push(decode(start, end))
  }
}

writeFileSync(join(import.meta.dirname, 'gold-review-defer-gate.txt'), lines.join('\n'))
console.log('ok', lines.length)
