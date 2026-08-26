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

const lines = []
const start = 326864000
const end = 326878500
const txt = decode(start, end)
lines.push(`### region ${start}..${end}`)
for (let k = 0; k < txt.length; k += 180) lines.push(txt.slice(k, k + 180))

writeFileSync(join(import.meta.dirname, 'gold-rv-turnloop.txt'), lines.join('\n'))
console.log('wrote', lines.length)
