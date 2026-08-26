#!/usr/bin/env node
// Find a specific occurrence of a keyword and print N bytes around it as a clean UTF-8 string.
// Usage: node extract-one.mjs <keyword> <occurrence-index> [context-bytes=4096]
import { readFileSync } from 'node:fs'
const BIN = String.raw`C:\Users\Administrator\AppData\Local\Temp\official-239\package\claude.exe`
const [kw, idxArg, ctxArg] = process.argv.slice(2)
const idx = Number(idxArg || 0)
const ctx = Number(ctxArg || 4096)
const buf = readFileSync(BIN)
const kwBuf = Buffer.from(kw, 'utf8')
let from = 0
let i = 0
let off = -1
while (true) {
  const x = buf.indexOf(kwBuf, from)
  if (x < 0) break
  if (i === idx) {
    off = x
    break
  }
  i++
  from = x + 1
}
if (off < 0) {
  console.error('not found at idx', idx)
  process.exit(1)
}
const start = Math.max(0, off - Math.floor(ctx / 2))
const end = Math.min(buf.length, start + ctx)
let s = ''
for (let i = start; i < end; i++) {
  const b = buf[i]
  if (b === 0x09) s += '\t'
  else if (b === 0x0a) s += '\n'
  else if (b === 0x0d) s += '\r'
  else if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b)
  else s += '\x1b'
}
console.log(`# offset=${off} (0x${off.toString(16)})\n\n\`\`\`\n${s}\n\`\`\``)
