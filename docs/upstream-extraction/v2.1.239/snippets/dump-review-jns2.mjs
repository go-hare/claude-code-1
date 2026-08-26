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
  { kw: 'deferredToolUse:', ctx: 1800 },
  { kw: 'deferredToolUse:Q', ctx: 2000 },
  { kw: 'deferredToolUse:i.deferredToolUse', ctx: 1800 },
  { kw: '!F&&!D&&!Y', ctx: 2000 },
  { kw: 'Input contained only whitespace', ctx: 2200 },
  { kw: 'if(!Ze)', ctx: 0 },
  { kw: 'if(!at){', ctx: 2500 },
  { kw: 'QNs({shouldQuery:Ze', ctx: 2500 },
  { kw: 'QNs({shouldQuery:at', ctx: 2500 },
  { kw: 'IWd(', ctx: 400 },
  { kw: 'function $Ri', ctx: 2000 },
  { kw: 'installPeerReceiptSender', ctx: 1500 },
  { kw: 'peer_idle_notice', ctx: 1800 },
  { kw: 'kind:"token"?', ctx: 1200 },
  { kw: '.kind==="token"', ctx: 800 },
]

const lines = []
for (const { kw, ctx } of jobs) {
  const hs = hits(kw, kw === 'IWd(' ? 20 : 8)
  lines.push(`\n#### ${JSON.stringify(kw)} count=${hs.length} [${hs.slice(0, 12).join(',')}]`)
  if (hs.length === 0 || ctx === 0) continue
  const take = kw === 'IWd(' ? 12 : 3
  for (const i of hs.slice(0, take)) {
    const start = Math.max(0, i - Math.floor(ctx / 5))
    const end = Math.min(buf.length, i + ctx)
    lines.push(`--- ${i} ---`)
    lines.push(decode(start, end))
  }
}

writeFileSync(join(import.meta.dirname, 'gold-review-jns2.txt'), lines.join('\n'))
console.log('wrote', lines.length)
