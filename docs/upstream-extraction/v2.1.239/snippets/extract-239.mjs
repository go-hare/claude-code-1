#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const BIN =
  process.env.OFFICIAL_239_BIN ||
  String.raw`C:\Users\Administrator\AppData\Local\Temp\official-239\package\claude.exe`
const outDir = join(import.meta.dirname)

const keywords = process.argv.slice(2)
if (keywords.length === 0) {
  console.error('usage: extract-239.mjs <kw> [...]')
  process.exit(1)
}

const buf = readFileSync(BIN)
const ctx = 2500

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

for (const kw of keywords) {
  const needle = Buffer.from(kw, 'utf8')
  const hits = []
  let from = 0
  while (hits.length < 6) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    hits.push(i)
    from = i + needle.length
  }
  console.error(`[kw] ${JSON.stringify(kw)} hits=${hits.length}${hits.length === 6 ? '+' : ''}`)
  let n = 0
  for (const off of hits) {
    const start = Math.max(0, off - Math.floor(ctx / 2))
    const end = Math.min(buf.length, start + ctx)
    const text = decode(start, end)
    const safe = kw.replace(/[^\w.-]+/g, '_').slice(0, 40)
    const file = join(outDir, `gold-${safe}-${n}.txt`)
    writeFileSync(file, `# offset=${off} (0x${off.toString(16)}) kw=${JSON.stringify(kw)}\n\n${text}\n`)
    console.error(`  wrote ${file}`)
    n++
  }
}
