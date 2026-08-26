#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const BIN = String.raw`C:\Users\Administrator\AppData\Local\Temp\official-239\package\claude.exe`
const buf = readFileSync(BIN)

function decode(start, end) {
  let s = ''
  for (let i = start; i < end && i < buf.length; i++) {
    const b = buf[i]
    if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b)
    else if (b === 0x0a) s += '\n'
    else s += '.'
  }
  return s
}

for (const kw of ['function lr(', 'lr=e=>', 'function lr=', 'var lr=']) {
  const n = Buffer.from(kw)
  let from = 0
  let c = 0
  while (c < 3) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    console.log(`\n#### ${kw} @${i}`)
    console.log(decode(Math.max(0, i - 60), i + 350))
    from = i + n.length
    c++
  }
  if (c === 0) console.log(`MISS ${kw}`)
}
