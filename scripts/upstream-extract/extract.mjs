#!/usr/bin/env node
// Extract code context around string literals from the official Claude Code binary.
// Usage: node extract.mjs <keyword1> [keyword2 ...] [--out=<file>] [--context=<bytes>] [--overlap]
//
// Finds each occurrence of the keyword (as a UTF-8 substring) in the binary,
// prints surrounding bytes as JS string (best-effort, replacing non-printable
// with \xNN or \uXXXX-style escapes kept readable).

import { readFileSync, writeFileSync, statSync } from 'node:fs'

const BIN = String.raw`C:\Users\Administrator\AppData\Local\Temp\pkg-latest\package\claude.exe`

const args = process.argv.slice(2)
let outFile = null
let context = 4096
let overlap = false
const keywords = []
for (const a of args) {
  if (a.startsWith('--out=')) outFile = a.slice(6)
  else if (a.startsWith('--context=')) context = Number(a.slice(10))
  else if (a === '--overlap') overlap = true
  else keywords.push(a)
}

if (keywords.length === 0) {
  console.error('Usage: extract.mjs <keyword> [...]')
  process.exit(1)
}

const buf = readFileSync(BIN)
console.error(`[bin] size=${buf.length} keywords=[${keywords.join(', ')}]`)

function decodeRegion(start, end) {
  let s = ''
  for (let i = start; i < end && i < buf.length; i++) {
    const b = buf[i]
    if (b === 0x09) s += '\t'
    else if (b === 0x0a) s += '\n'
    else if (b === 0x0d) s += '\r'
    else if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b)
    else s += '\x1b' // mark non-printable
  }
  return s
}

function findAll(kw) {
  const out = []
  const kwBuf = Buffer.from(kw, 'utf8')
  let from = 0
  while (true) {
    const idx = buf.indexOf(kwBuf, from)
    if (idx < 0) break
    out.push(idx)
    from = idx + 1
  }
  return out
}

const blocks = []
const seenRanges = [] // for overlap dedupe

for (const kw of keywords) {
  const offsets = findAll(kw)
  console.error(`[kw] "${kw}" hits=${offsets.length}`)
  let emitted = 0
  for (const off of offsets) {
    const start = Math.max(0, off - Math.floor(context / 2))
    const end = Math.min(buf.length, start + context)
    if (!overlap) {
      // skip if this range overlaps an already-seen range (for same kw)
      const dup = seenRanges.some(([s, e]) => !(end < s || start > e))
      if (dup) continue
      seenRanges.push([start, end])
    }
    const text = decodeRegion(start, end)
    blocks.push({ kw, off, start, end, text })
    emitted++
    if (emitted >= 30) {
      console.error(`[kw] "${kw}" emitted capped at 30`)
      break
    }
  }
  seenRanges.length = 0
}

let out = ''
out += `# Upstream extraction\n\n`
out += `- Binary: ${BIN}\n`
out += `- Size: ${buf.length} bytes\n`
out += `- Keywords: ${keywords.join(', ')}\n`
out += `- Context bytes: ${context}\n`
out += `- Hits total: ${blocks.length}\n\n`

for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i]
  out += `## Block ${i + 1} — keyword="${b.kw}" offset=${b.off} (0x${b.off.toString(16)})\n\n`
  out += '```\n'
  out += b.text
  out += '\n```\n\n'
}

if (outFile) {
  writeFileSync(outFile, out)
  console.error(`[wrote] ${outFile} blocks=${blocks.length}`)
} else {
  process.stdout.write(out)
}
