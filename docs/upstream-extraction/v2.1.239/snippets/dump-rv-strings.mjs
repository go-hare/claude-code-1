#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BIN = String.raw`C:\Users\Administrator\AppData\Local\Temp\official-239\package\claude.exe`
const buf = readFileSync(BIN)

function decode(start, end) {
  let s = ''
  for (let i = start; i < end && i < buf.length; i++) {
    const b = buf[i]
    if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b)
    else s += '.'
  }
  return s
}

function hits(needle, max = 6) {
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
  ['At-a-glance summary', 1200],
  ['Respond with exactly the following', 2600],
  ['The current directory no longer exists', 1400],
  ["Remote Control isn't enabled for this account", 1200],
  ['Your shareable insights report is ready', 1200],
  ['NoDefaultCurrentDirectoryInExePath', 900],
  ["Can't read the current directory", 900],
]

const lines = []
for (const [kw, ctx] of jobs) {
  const hs = hits(kw)
  lines.push(`\n#### ${kw} count=${hs.length}`)
  for (const i of hs.slice(0, 3)) {
    lines.push(`--- ${i} ---`)
    const txt = decode(Math.max(0, i - Math.floor(ctx / 3)), Math.min(buf.length, i + ctx))
    for (let k = 0; k < txt.length; k += 180) lines.push(txt.slice(k, k + 180))
  }
}

writeFileSync(join(import.meta.dirname, 'gold-rv-strings.txt'), lines.join('\n'))
console.log('wrote', lines.length)
