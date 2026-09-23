/**
 * Peel densable 2.1.248 Gqe/z settings-load-under-prime chain
 * @179527369 / @179527519 and callees kur/Dgn/N/Yl/L/Mgn/Ogn + callers.
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
const lines = [
  '# gold-248-Gqe-z-load',
  '',
  'Official densable 2.1.248 SEA. Settings load under backendReadResetTail + retain.',
  'Leftover names: loadSettingsUnderPrime ≈ Gqe; inner z; Yl → invalidateAll.',
  '',
]

function peelAt(label, i, maxLen = 12000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`sha=${ext.sha} len=${ext.len}`)
    lines.push(ext.body)
  } else {
    lines.push(`EXTRACT_FAIL preview=`)
    lines.push(asciiSlice(buf, i, i + Math.min(maxLen, 4000)))
  }
  lines.push('')
}

function peelNamed(needle, maxLen = 8000, band) {
  let hits = allHits(buf, needle)
  if (band) hits = hits.filter(i => i >= band[0] && i <= band[1])
  lines.push(`## ${needle} hits=${hits.length}${band ? ` band=${band[0]}-${band[1]}` : ''}`)
  for (const i of hits.slice(0, 8)) {
    if (needle.includes('function ')) {
      const ext = extractFnAt(buf, i, maxLen)
      if (ext.body) {
        lines.push(`@${i} sha=${ext.sha} len=${ext.len}`)
        lines.push(ext.body.length > 6000 ? ext.body.slice(0, 6000) + '…' : ext.body)
      } else {
        lines.push(`@${i} ${asciiSlice(buf, i, i + 600)}`)
      }
    } else {
      lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 80), i + 200)}`)
    }
    lines.push('')
  }
}

const band = [179400000, 179600000]

// Known offsets from prior peels
peelAt('Gqe', 179527369, 2000)
peelAt('z', 179527519, 4000)

// Named peels in settings band
for (const n of [
  'async function L(',
  'function L(',
  'function kur(',
  'async function kur(',
  'async function Dgn(',
  'function Dgn(',
  'async function N(',
  'function N(',
  'function Yl(',
  'async function Yl(',
  'function Mgn(',
  'async function Mgn(',
  'function Ogn(',
  'async function Ogn(',
  'function ra(',
]) {
  peelNamed(n, 10000, band)
}

// Broader Yl (known @179035707 area)
peelNamed('function Yl(', 2000)

// Callers of Gqe — definition + any call sites across SEA
{
  const hits = allHits(buf, 'Gqe(')
  lines.push(`## Gqe( all hits=${hits.length}`)
  for (const i of hits) {
    lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 120), i + 160)}`)
    lines.push('')
  }
}

// export surfaces
for (const n of [
  'export{Gqe',
  ',Gqe,',
  ',Gqe}',
  '{Gqe,',
  'Gqe as ',
  'await Gqe(',
  '=Gqe',
  'return Gqe(',
]) {
  const hits = allHits(buf, n)
  lines.push(`## needle ${JSON.stringify(n)} hits=${hits.length}`)
  for (const i of hits.slice(0, 10)) {
    lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 100), i + 180)}`)
    lines.push('')
  }
}

// $pn callers similarly
{
  const hits = allHits(buf, '$pn(')
  lines.push(`## $pn( all hits=${hits.length}`)
  for (const i of hits.slice(0, 20)) {
    lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 120), i + 160)}`)
    lines.push('')
  }
}

// Look for enableConfigs / loadSettings that might call Gqe via renamed import
for (const n of [
  'backendReadResetTail',
  'userLayer:"retain"',
  'userLayer:"retain"',
  "userLayer:'retain'",
]) {
  peelNamed(n, 500)
}

// Dgn / kur near Gqe — find by walking from z body identifiers
for (const n of ['kur(', 'Dgn(', 'await L(', 'Yl(']) {
  const hits = allHits(buf, n).filter(i => i >= 179500000 && i <= 179540000)
  lines.push(`## ${n} near-z band hits=${hits.length}`)
  for (const i of hits.slice(0, 12)) {
    lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 40), i + 100)}`)
  }
  lines.push('')
}

writeFileSync(
  new URL('./gold-248-Gqe-z-load.txt', import.meta.url),
  lines.join('\n'),
)
console.log('wrote gold-248-Gqe-z-load.txt lines=', lines.length)
