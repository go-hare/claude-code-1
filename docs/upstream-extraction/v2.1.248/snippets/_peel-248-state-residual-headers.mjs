/**
 * Peel official 248: header latches / promptCache1hEligible / isRemoteMode
 * vs n() bags — residual STATE dig.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXE =
  process.env.OFFICIAL_248_EXE ??
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const out = join(__dirname, 'gold-248-state-residual-headers.txt')

const buf = readFileSync(EXE)
const text = buf.toString('latin1')

const lines = [
  '# gold-248-state-residual-headers',
  `exe=${EXE}`,
  `bytes=${buf.length}`,
  '',
]

function allHits(needle) {
  const hits = []
  let i = 0
  while (true) {
    const j = text.indexOf(needle, i)
    if (j < 0) break
    hits.push(j)
    i = j + needle.length
  }
  return hits
}

function peelAt(offset, len = 400) {
  const slice = text.slice(offset, offset + len)
  const sha = createHash('sha256').update(slice).digest('hex').slice(0, 16)
  return { slice, sha, len: slice.length }
}

function reportNeedle(needle, max = 8) {
  const hits = allHits(needle)
  lines.push(`## needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, max)) {
    const start = Math.max(0, h - 80)
    const { slice, sha } = peelAt(start, 520)
    lines.push(`@${h} sha=${sha}`)
    lines.push(slice.replace(/\r/g, '\\r').replace(/\n/g, '\\n'))
    lines.push('')
  }
}

for (const n of [
  'promptCache1hEligible',
  'afkModeHeaderLatched',
  'fastModeHeaderLatched',
  'cacheEditingHeaderLatched',
  'HeaderLatched',
  'as getIsRemoteMode',
  'function On(){',
  'replaceIsRemoteMode',
  'isRemoteMode()',
  'n().host.',
  'promptCache1hAllowlist',
]) {
  reportNeedle(n, 6)
}

// Peel On() near host wrappers (~17856xxxx)
for (const h of allHits('function On(){').slice(0, 20)) {
  if (h > 178500000 && h < 178600000) {
    const { slice, sha } = peelAt(h, 280)
    lines.push(`## On host-window @${h} sha=${sha}`)
    lines.push(slice)
    lines.push('')
  }
}

// Peel eligible near qe/requestLatches
for (const h of allHits('promptCache1hEligible')) {
  const { slice, sha } = peelAt(Math.max(0, h - 120), 600)
  lines.push(`## eligible-ctx @${h} sha=${sha}`)
  lines.push(slice)
  lines.push('')
}

writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`wrote ${out} lines=${lines.length}`)
