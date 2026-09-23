/**
 * Pass-2 peel: Ut helpers Pu/Hc/Dde/gKe/ce/Se.state/ge near Ut body.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-_Ke-Ut-uo-helpers', '']

function near(needle, center, radius = 80000, maxHits = 8) {
  return allHits(buf, needle).filter(
    i => Math.abs(i - center) < radius,
  ).slice(0, maxHits)
}

const UT = 179163791

for (const [n, r] of [
  ['function Pu(', 50000],
  ['Pu=', 50000],
  ['function Hc(', 50000],
  ['Hc=', 50000],
  ['function Dde(', 80000],
  ['Dde=', 80000],
  ['gKe=', 80000],
  ['gKe"', 80000],
  ['var ce=', 30000],
  ['ce=', 20000],
  ['Se.state', 100000],
  ['state:(', 100000],
  ['function ge()', 100000],
  ['ge=()', 50000],
  ['function ge(', 30000],
  ['$ue(', 200000],
  ['t4t(', 50000],
  ['Ge(e)', 30000],
  ['function Ge(e)', 50000],
  ['telemetryCode', 30000],
]) {
  const hits = near(n, UT, r)
  lines.push(`## ${JSON.stringify(n)} near Ut hits=${hits.length}`)
  for (const i of hits) {
    const ext =
      n.startsWith('function ') || n.startsWith('async ')
        ? extractFnAt(buf, i, 3000)
        : null
    if (ext?.body) {
      lines.push(`@${i} sha=${ext.sha} len=${ext.len}`)
      lines.push(ext.body.length > 1500 ? ext.body.slice(0, 1500) + '…' : ext.body)
    } else {
      lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 40), i + 350)}`)
    }
    lines.push('')
  }
}

// Look for Ge used as storage error formatter near Ut: Ge(r.error)
{
  const hits = allHits(buf, 'function Ge(e){').filter(
    i => i > 178500000 && i < 180000000,
  )
  lines.push(`## function Ge(e){ wide hits=${hits.length}`)
  for (const i of hits.slice(0, 10)) {
    const ext = extractFnAt(buf, i, 1500)
    lines.push(
      `@${i} ${ext.body ?? asciiSlice(buf, i, i + 200)}`,
    )
    lines.push('')
  }
}

// Se object with .state method
{
  const hits = allHits(buf, '.state=e=>').concat(allHits(buf, 'state(e){')).concat(
    allHits(buf, 'state:(e)'),
  )
  const filtered = hits.filter(i => i > 178500000 && i < 180000000)
  lines.push(`## Se.state patterns hits=${filtered.length}`)
  for (const i of filtered.slice(0, 15)) {
    lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 80), i + 200)}`)
    lines.push('')
  }
}

// gKe string literal near Pe=
{
  const i = 179162742
  lines.push(`## lookback before Pe= for gKe`)
  lines.push(asciiSlice(buf, i - 2000, i + 100))
  lines.push('')
}

writeFileSync(
  new URL('./gold-248-_Ke-Ut-uo-helpers.txt', import.meta.url),
  lines.join('\n'),
)
console.log('wrote helpers', lines.length)
