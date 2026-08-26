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

function hits(needle, max = 10) {
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
  { kw: 'hold-receipt send failed', ctx: 3000 },
  { kw: 'hold-receipt skipped', ctx: 3000 },
  { kw: 'await IWd(', ctx: 2000 },
  { kw: 'await cmp(', ctx: 2000 },
  { kw: 'IWd(e,{requireLiveOwner:s})', ctx: 2000 },
  { kw: 'peerToken', ctx: 1500, around: 327057108 },
]

const lines = []
for (const job of jobs) {
  const kw = job.kw
  const hs = job.around !== undefined ? [job.around] : hits(kw, 8)
  lines.push(`\n#### ${JSON.stringify(kw)} count=${hs.length} [${hs.join(',')}]`)
  for (const i of hs.slice(0, 3)) {
    const ctx = job.ctx ?? 2500
    lines.push(`--- ${i} ---`)
    lines.push(decode(Math.max(0, i - Math.floor(ctx / 3)), Math.min(buf.length, i + ctx)))
  }
}

writeFileSync(join(import.meta.dirname, 'gold-receipt-send2.txt'), lines.join('\n'))
console.log('done')
