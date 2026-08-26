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

function hits(needle, max = 40) {
  const n = Buffer.from(needle)
  const out = []
  let i = 0
  while (out.length < max) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    out.push(j)
    i = j + 1
  }
  return out
}

const lines = []
for (const kw of ['deferred_tool_use', 'hook_deferred_tool', 'tool_deferred', 'permissionDecision', 'Valid types are: allow']) {
  const hs = hits(kw)
  lines.push(`\n#### ${kw} count=${hs.length}`)
  for (const i of hs) {
    lines.push(`--- ${i} ---`)
    // wrap into 200-char chunks so grep output stays readable
    const txt = decode(Math.max(0, i - 900), Math.min(buf.length, i + 900))
    for (let k = 0; k < txt.length; k += 180) lines.push(txt.slice(k, k + 180))
  }
}

writeFileSync(join(import.meta.dirname, 'gold-rv-defer-tight.txt'), lines.join('\n'))
console.log('wrote', lines.length)
