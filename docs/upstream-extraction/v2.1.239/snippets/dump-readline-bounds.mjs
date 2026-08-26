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

for (const kw of [
  'getReadlineWordBoundaries',
  'killRange(',
  'placeholderStartingAt',
  'placeholderContaining',
  'placeholderEndingAt',
  'snapOutOfPlaceholder',
]) {
  const needle = Buffer.from(kw)
  let from = 0
  let c = 0
  while (c < 2) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    writeFileSync(
      join(import.meta.dirname, `gold-rlb-${kw}-${c}.txt`),
      `# ${kw} offset=${i}\n\n${decode(Math.max(0, i - 400), Math.min(buf.length, i + 2800))}\n`,
    )
    console.error(`HIT ${kw} #${c} @${i}`)
    c++
    from = i + kw.length
  }
  if (c === 0) console.error(`MISS ${kw}`)
}
