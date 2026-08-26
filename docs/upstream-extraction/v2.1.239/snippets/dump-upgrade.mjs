#!/usr/bin/env node
// Dump the full SEA /claude-api upgrade markdown + nearby path/register strings.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BIN = String.raw`C:\Users\Administrator\AppData\Local\Temp\official-239\package\claude.exe`
const buf = readFileSync(BIN)
const marker = Buffer.from('# Upgrading the `anthropic` Python SDK')
const off = buf.indexOf(marker)
if (off < 0) {
  console.error('upgrade heading not found')
  process.exit(1)
}

function decode(start, end) {
  let s = ''
  for (let i = start; i < end && i < buf.length; i++) {
    const b = buf[i]
    if (b === 0x09) s += '\t'
    else if (b === 0x0a) s += '\n'
    else if (b === 0x0d) s += '\r'
    else if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b)
    else if (b === 0xe2 && buf[i + 1] === 0x86 && buf[i + 2] === 0x92) {
      s += '→'
      i += 2
    } else s += '.'
  }
  return s
}

const before = decode(Math.max(0, off - 4000), off)
const after = decode(off, Math.min(buf.length, off + 80000))
const out = join(import.meta.dirname, 'gold-upgrade-full.txt')
writeFileSync(out, `# offset=${off}\n\n## BEFORE\n\n${before}\n\n## AFTER\n\n${after}\n`)
console.error(`wrote ${out} before=${before.length} after=${after.length}`)

for (const kw of [
  'shared/python-sdk-upgrade.md',
  'python-sdk-upgrade',
  'upgrade.md',
  'sdk-upgrade',
  '`upgrade`',
  'upgrade python',
  'CLAUDE_API_SUBCOMMANDS',
  'anthropic.Timeout',
]) {
  const needle = Buffer.from(kw)
  let n = 0
  let from = 0
  const offs = []
  while (n < 8) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    offs.push(i)
    n++
    from = i + needle.length
  }
  console.error(`${JSON.stringify(kw)} hits=${n} offs=${offs.join(',')}`)
}
