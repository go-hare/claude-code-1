#!/usr/bin/env node
// Extract a region around a keyword with whitespace normalization for readable JS.
// Usage: node extract-readable.mjs <keyword> [context-bytes=8000]
import { readFileSync } from 'node:fs'
const BIN = String.raw`C:\Users\Administrator\AppData\Local\Temp\pkg-latest\package\claude.exe`
const [kw, ctxArg] = process.argv.slice(2)
const ctx = Number(ctxArg || 8000)
const buf = readFileSync(BIN)
const kwBuf = Buffer.from(kw, 'utf8')
const i = buf.indexOf(kwBuf)
if (i < 0) {
  console.error('not found')
  process.exit(1)
}
const start = Math.max(0, i - Math.floor(ctx / 2))
const end = Math.min(buf.length, start + ctx)
let s = ''
for (let j = start; j < end; j++) {
  const b = buf[j]
  if (b === 0x09) s += ' '
  else if (b === 0x0a) s += '\n'
  else if (b === 0x0d) continue
  else if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b)
  else s += ' '
}
console.log(`# offset=${i} (0x${i.toString(16)})\n`)
console.log(s.replace(/[ ]{2,}/g, ' '))
