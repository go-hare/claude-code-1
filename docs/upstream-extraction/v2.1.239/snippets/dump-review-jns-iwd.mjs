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

const jobs = [
  { kw: 'yield*JNs(', ctx: 2500 },
  { kw: 'async function JNs(', ctx: 3500 },
  { kw: 'function JNs(', ctx: 3500 },
  { kw: 'yield*H8f(', ctx: 2500 },
  { kw: 'cli_ask_should_query_resolved', ctx: 4000 },
  { kw: 'tool_use ${', ctx: 2000 },
  { kw: 'not found in transcript', ctx: 2000 },
  { kw: 'IWd(e,{requireLiveOwner', ctx: 1500 },
  { kw: 'IWd(e,{requireLiveOwner:mti()', ctx: 1500 },
  { kw: 'requireLiveOwner:mti()', ctx: 2000 },
  { kw: 'await IWd(', ctx: 1800 },
  { kw: 'IWd(e)', ctx: 1500 },
  { kw: 'IWd(t)', ctx: 1500 },
  { kw: 'kind==="token"', ctx: 1800 },
  { kw: 'no capability token', ctx: 1500 },
  { kw: 'function cmp(', ctx: 2500 },
  { kw: 'async function cmp(', ctx: 2500 },
  { kw: 'tool_deferred_unavailable', ctx: 2500 },
  { kw: 'hasHandledDeferred', ctx: 1500 },
  { kw: 'Deferred tool resume: tool_use', ctx: 2000 },
]

const lines = []
for (const { kw, ctx } of jobs) {
  const hs = hits(kw, 8)
  lines.push(`\n#### ${JSON.stringify(kw)} count=${hs.length} [${hs.join(',')}]`)
  if (hs.length === 0) continue
  for (const i of hs.slice(0, 3)) {
    const start = Math.max(0, i - Math.floor(ctx / 4))
    const end = Math.min(buf.length, i + ctx)
    lines.push(`--- ${i} ---`)
    lines.push(decode(start, end))
  }
}

writeFileSync(join(import.meta.dirname, 'gold-review-jns-iwd.txt'), lines.join('\n'))
console.log('wrote', lines.length, 'lines')
