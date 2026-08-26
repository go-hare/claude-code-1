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

const keywords = [
  'keybindingFlavor',
  'deleteWORDBefore',
  'deleteWORDAfter',
  'nextWORD',
  'prevWORD',
  'readline',
]
let n = 0
for (const kw of keywords) {
  const needle = Buffer.from(kw)
  let from = 0
  let c = 0
  while (c < 4) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    const start = Math.max(0, i - 1800)
    const end = Math.min(buf.length, i + 1800)
    writeFileSync(
      join(import.meta.dirname, `gold-readline-${kw}-${c}.txt`),
      `# ${kw} offset=${i}\n\n${decode(start, end)}\n`,
    )
    c++
    n++
    from = i + needle.length
  }
  console.error(`${kw} emitted=${c}`)
}
console.error(`total files=${n}`)
