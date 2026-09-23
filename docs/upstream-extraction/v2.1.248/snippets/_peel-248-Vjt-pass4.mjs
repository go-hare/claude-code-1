import { appendFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['', '# --- pass4 En On Pc Se ---', '']

function peelAt(i, maxLen = 8000) {
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`@${i} sha=${ext.sha} len=${ext.len}`)
    lines.push(ext.body.length > 3000 ? ext.body.slice(0, 3000) + '…' : ext.body)
  } else {
    lines.push(`@${i} MISS ${asciiSlice(buf, i, i + 250)}`)
  }
  lines.push('')
}

function near(label, needle, lo = 179400000, hi = 179600000, n = 4) {
  const hits = allHits(buf, needle)
  const nearHits = hits.filter(i => i > lo && i < hi)
  lines.push(
    `## ${label} needle=${JSON.stringify(needle)} near=${nearHits.length} total=${hits.length}`,
  )
  for (const i of (nearHits.length ? nearHits : hits).slice(0, n)) peelAt(i)
}

near('async En', 'async function En(')
near('function En', 'function En(')
near('async On', 'async function On(')
near('function On', 'function On(')
near('Pc home', 'Pc={home:')
near('t4t', 'function t4t(')
near('userSettings return', 'userSettings(){return')
near('layer user', 'layer:"user"')
near('layer user2', "layer:'user'")

for (const i of allHits(buf, 'namespace:"settings"').filter(
  j => j > 179400000 && j < 179520000,
).slice(0, 12)) {
  lines.push(`## settings-ns @${i}`)
  lines.push(asciiSlice(buf, i - 100, i + 220))
  lines.push('')
}

// Pc full object near first hit
const pc = allHits(buf, 'Pc={home:')[0]
if (pc !== undefined) {
  lines.push('## Pc full ascii')
  lines.push(asciiSlice(buf, pc, pc + 400))
  lines.push('')
}

appendFileSync(
  new URL('./gold-248-Vjt-T-O-seed.txt', import.meta.url),
  lines.join('\n'),
)
console.log('pass4', lines.length)
