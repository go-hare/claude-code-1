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
  'hold-receipt',
  'peer_message_status',
  'function afl(',
  'async function afl(',
  'fiw',
  'no capability token',
  'requireLiveOwner&&b7',
  'vetReplyAddress',
  'peer_idle_notice',
  'IWd(e,t)',
]

const lines = []
for (const kw of jobs) {
  const hs = hits(kw, 8)
  lines.push(`\n#### ${JSON.stringify(kw)} count=${hs.length} [${hs.join(',')}]`)
  if (hs.length === 0) continue
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`)
    lines.push(decode(Math.max(0, i - 500), Math.min(buf.length, i + 1500)))
  }
}

writeFileSync(join(import.meta.dirname, 'gold-receipt-iwd.txt'), lines.join('\n'))
console.log('wrote', lines.length, 'lines')
