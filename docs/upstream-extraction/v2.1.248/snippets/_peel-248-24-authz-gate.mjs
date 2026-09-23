/**
 * #24 pass2 — Authorization-already-set / OAuth fallback / minted helper.
 */
import { existsSync, writeFileSync } from 'fs'
import {
  EXE_248,
  EXE_247,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
  sha,
} from './_peel-248-na-helpers.mjs'

const out =
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-24-official-host.txt'
const prev = []
const lines = [
  '# gold-248-24-official-host',
  `# when=${new Date().toISOString()}`,
  '# pass2 Authorization / OAuth-fallback / minted helper',
  '',
]

const b248 = loadSea(EXE_248)
const b247 = existsSync(EXE_247) ? loadSea(EXE_247) : null
lines.push(`# SEA248=${b248.length} SEA247=${b247 ? b247.length : 'missing'}`)
lines.push('')

function dumpHits(tag, needle, buf = b248, cap = 8, around = 280) {
  const hits = allHits(buf, needle)
  lines.push(`## ${tag} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [i, p] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${i} @${p} ${asciiSlice(buf, p - around, p + needle.length + around)}`,
    )
  }
  lines.push('')
  return hits
}

function dumpFnNear(tag, hit, lookback = 8000, maxLen = 12000) {
  const fn = lastFnStartGeneric(b248, hit + 20, lookback)
  lines.push(`## ${tag} lastFn name=${fn.name} start=${fn.i} hit=${hit}`)
  if (fn.i < 0) {
    lines.push(asciiSlice(b248, hit - 1500, hit + 1500))
    lines.push('')
    return
  }
  const ex = extractFnAt(b248, fn.i, maxLen)
  if (!ex.body) {
    lines.push(`MISS ${JSON.stringify(ex)}`)
    lines.push(asciiSlice(b248, fn.i, fn.i + 2500))
    lines.push('')
    return
  }
  lines.push(`len=${ex.len} sha=${ex.sha}`)
  lines.push(ex.body)
  lines.push('')
}

const needles = [
  'OAuth fallback is disabled when headers.Authorization is set',
  'disabled when headers.Authorization',
  'headers.Authorization is set',
  'Server rejected the Authorization header minted by the configured headersHelper',
  'minted by the configured headersHelper',
  'Authorization header minted',
  'headersHelper (HTTP',
  'function gC(',
  'function Ste(',
  'function YDe(',
  'function XDe(',
  'function Rce(',
]

for (const n of needles) {
  const hits = dumpHits(n, n)
  if (b247) {
    const h247 = allHits(b247, n)
    lines.push(`## 247 ${JSON.stringify(n)} hits=${h247.length} offs=${h247.slice(0, 6).join(',')}`)
    lines.push('')
  }
  for (const p of hits.filter(x => x > 180000000).slice(0, 3)) {
    dumpFnNear(`fn-near ${n.slice(0, 40)}`, p)
  }
}

// Walk JS around the string-table hit @100877134
{
  const hits = allHits(b248, 'disabled when headers.Authorization')
  for (const p of hits) {
    lines.push(`## string-table @${p}`)
    lines.push(asciiSlice(b248, p - 400, p + 800))
    lines.push('')
  }
}

{
  const hits = allHits(b248, 'minted by the configured headersHelper')
  for (const p of hits) {
    lines.push(`## minted-string @${p}`)
    lines.push(asciiSlice(b248, p - 400, p + 800))
    lines.push('')
    if (p > 180000000) dumpFnNear('minted-fn', p, 12000, 16000)
  }
}

// gC / Ste / YDe / XDe bodies in JS
for (const name of ['function gC(', 'function Ste(', 'function YDe(', 'function XDe(', 'function Rce(', 'function Wv(', 'function aE(']) {
  const hits = allHits(b248, name).filter(p => p > 180000000 && p < 210000000)
  lines.push(`## ${name} JS hits=${hits.length} ${hits.slice(0, 8).join(',')}`)
  for (const p of hits.slice(0, 3)) {
    const ex = extractFnAt(b248, p, 2500)
    if (ex.body) {
      lines.push(`## ${name} @${p} len=${ex.len} sha=${ex.sha}`)
      lines.push(ex.body)
      lines.push('')
    } else {
      lines.push(`## ${name} @${p} MISS ${asciiSlice(b248, p, p + 400)}`)
      lines.push('')
    }
  }
}

// Search JS for OAuth fallback / Authorization set
for (const n of [
  'OAuth fallback',
  'oauth fallback',
  'fallback is disabled',
  'headers.Authorization',
  'authorization already',
  'hasAuthHeader',
  'hasStaticAuth',
  'skipIssuer',
  'skip oauth',
]) {
  dumpHits(`js ${n}`, n, b248, 6, 200)
}

writeFileSync(out, [...prev, ...lines].join('\n'))
console.log('WROTE', out, 'lines', lines.length)
