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

const jobs = [
  { kw: 'sdk-upgrade.md', ctx: 800 },
  { kw: '| `upgrade`', ctx: 2500 },
  { kw: 'upgrade python', ctx: 2000 },
  { kw: 'shared/sdk-upgrade.md', ctx: 800 },
  { kw: 'python/sdk-upgrade.md', ctx: 800 },
  { kw: 'xKi', ctx: 1500 },
  { kw: 'getKeybindingFlavor', ctx: 2000 },
  { kw: '===\"readline\"', ctx: 2500 },
  { kw: "==='readline'", ctx: 2500 },
  { kw: '=="readline"', ctx: 2500 },
]

for (const { kw, ctx } of jobs) {
  const needle = Buffer.from(kw)
  let from = 0
  let c = 0
  while (c < 3) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    const start = Math.max(0, i - Math.floor(ctx / 3))
    const end = Math.min(buf.length, start + ctx)
    const safe = kw.replace(/[^\w.-]+/g, '_').slice(0, 40)
    writeFileSync(
      join(import.meta.dirname, `gold-around-${safe}-${c}.txt`),
      `# ${JSON.stringify(kw)} offset=${i}\n\n${decode(start, end)}\n`,
    )
    console.error(`wrote ${safe} #${c} @${i}`)
    c++
    from = i + needle.length
  }
  if (c === 0) console.error(`MISS ${kw}`)
}
