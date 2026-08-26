#!/usr/bin/env node
// Parse the SEA JS string q0y="# Upgrading..." into a real markdown file.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BIN = String.raw`C:\Users\Administrator\AppData\Local\Temp\official-239\package\claude.exe`
const buf = readFileSync(BIN)
const startMark = Buffer.from('# Upgrading the `anthropic` Python SDK')
const off = buf.indexOf(startMark)
if (off < 0) process.exit(1)

// Walk forward until we hit the JS terminator `";var V0y`
const endMark = Buffer.from('";var V0y')
const end = buf.indexOf(endMark, off)
if (end < 0) {
  console.error('end mark not found')
  process.exit(1)
}

const raw = buf.slice(off, end).toString('utf8')
// This region is a JS string body with \r\n \u2192 etc.
const unescaped = raw
  .replace(/\\r\\n/g, '\n')
  .replace(/\\n/g, '\n')
  .replace(/\\r/g, '')
  .replace(/\\`/g, '`')
  .replace(/\\"/g, '"')
  .replace(/\\\\/g, '\\')
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  )

const out = join(
  import.meta.dirname,
  '../../../../src/skills/bundled/claude-api/python/claude-api/sdk-upgrade.md',
)
writeFileSync(out, unescaped.endsWith('\n') ? unescaped : `${unescaped}\n`)
console.error(`wrote ${out} bytes=${unescaped.length}`)
