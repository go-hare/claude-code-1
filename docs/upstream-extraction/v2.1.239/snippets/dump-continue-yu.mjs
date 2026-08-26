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

const offsets = [327188268, 204695720]
const lines = []
for (const i of offsets) {
  lines.push(`--- ${i} ---`)
  lines.push(decode(i - 800, i + 4000))
}
writeFileSync(join(import.meta.dirname, 'gold-continue-yu.txt'), lines.join('\n'))
console.log('done')
