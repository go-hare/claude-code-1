/**
 * Peel official stickyBetas / GRe / Pvt storage site.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXE =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const out = join(__dirname, 'gold-248-stickyBetas-parent.txt')
const text = readFileSync(EXE, 'latin1')
const lines = ['# gold-248-stickyBetas-parent', `bytes=${text.length}`, '']

function hits(n) {
  const h = []
  let i = 0
  while (true) {
    const j = text.indexOf(n, i)
    if (j < 0) break
    h.push(j)
    i = j + n.length
  }
  return h
}

function peel(off, len = 500) {
  const s = text.slice(off, off + len)
  return {
    sha: createHash('sha256').update(s).digest('hex').slice(0, 16),
    s,
  }
}

for (const n of [
  'stickyBetas',
  'clearBetaHeaderLatches',
  'function Pvt(',
  'rejected:new Set',
  'sent:new Set',
  'markStickyBeta',
  'stickyBetas.sent',
  'stickyBetas.rejected',
]) {
  const h = hits(n)
  lines.push(`## ${JSON.stringify(n)} hits=${h.length}`)
  for (const o of h.slice(0, 6)) {
    const start = Math.max(0, o - 100)
    const { sha, s } = peel(start, 550)
    lines.push(`@${o} sha=${sha}`)
    lines.push(s.replace(/\n/g, '\\n'))
    lines.push('')
  }
}

// Near Pvt body
for (const o of hits('function Pvt(')) {
  if (o > 178500000 && o < 178600000) {
    const { sha, s } = peel(o, 400)
    lines.push(`## Pvt host-window @${o} sha=${sha}`)
    lines.push(s)
    lines.push('')
  }
}

writeFileSync(out, lines.join('\n'))
console.log('wrote', out)
