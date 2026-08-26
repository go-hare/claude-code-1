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

const needle = Buffer.from('function utn(')
const i = buf.indexOf(needle)
if (i < 0) {
  console.log('MISS')
  process.exit(1)
}
writeFileSync(
  join(import.meta.dirname, 'gold-utn.txt'),
  decode(i, Math.min(buf.length, i + 2800)),
)
console.log('ok', i)
