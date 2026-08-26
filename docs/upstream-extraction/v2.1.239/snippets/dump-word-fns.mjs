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

const needles = [
  'forwardWord(){',
  'forwardWord(){',
  '.forwardWord=',
  'backwardWord(){',
  'killWord(){',
  'backwardKillWord(){',
  'Qp.prototype.forwardWord',
  'forwardWord:function',
  'this.forwardWord',
  'killWord:function',
]

// also search compact: forwardWord(){let
for (const kw of [
  'forwardWord(){',
  'backwardWord(){',
  'killWord(){',
  'backwardKillWord(){',
  '.forwardWord=function',
  'forwardWord(){let',
  'function(e){let t=this.offset',
]) {
  const needle = Buffer.from(kw)
  let from = 0
  let c = 0
  while (c < 5) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    const start = Math.max(0, i - 200)
    const end = Math.min(buf.length, i + 2200)
    const safe = kw.replace(/[^\w.-]+/g, '_').slice(0, 30)
    writeFileSync(
      join(import.meta.dirname, `gold-wordfn-${safe}-${c}.txt`),
      `# ${JSON.stringify(kw)} offset=${i}\n\n${decode(start, end)}\n`,
    )
    console.error(`HIT ${kw} #${c} @${i}`)
    c++
    from = i + Math.max(1, needle.length)
  }
  if (c === 0) console.error(`MISS ${kw}`)
}
