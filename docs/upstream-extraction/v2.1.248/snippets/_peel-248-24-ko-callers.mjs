/**
 * #24 pass3 — ko/Yt callers: helperMintsAuthHeader / hasUserAuthHeader / Yo
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
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-24-ko-callers.txt'
const lines = [
  '# gold-248-24-ko-callers',
  `# when=${new Date().toISOString()}`,
  '',
]
const b248 = loadSea(EXE_248)
const b247 = existsSync(EXE_247) ? loadSea(EXE_247) : null
lines.push(`# SEA248=${b248.length}`)
lines.push('')

function dumpHits(tag, needle, cap = 8, around = 240) {
  const hits = allHits(b248, needle)
  lines.push(`## ${tag} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [i, p] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${i} @${p} ${asciiSlice(b248, p - around, p + needle.length + around)}`,
    )
  }
  if (b247) {
    lines.push(`## 247 ${JSON.stringify(needle)} hits=${allHits(b247, needle).length}`)
  }
  lines.push('')
  return hits
}

function dumpFn(tag, i, maxLen = 8000) {
  const fn = lastFnStartGeneric(b248, i + 8, 6000)
  lines.push(`## ${tag} lastFn=${fn.name} start=${fn.i} hit=${i}`)
  const ex = extractFnAt(b248, fn.i > 0 ? fn.i : i, maxLen)
  if (!ex.body) {
    lines.push(`MISS ${asciiSlice(b248, (fn.i > 0 ? fn.i : i) - 200, (fn.i > 0 ? fn.i : i) + 1800)}`)
    lines.push('')
    return
  }
  lines.push(`len=${ex.len} sha=${ex.sha}`)
  lines.push(ex.body)
  lines.push('')
}

for (const n of [
  'helperMintsAuthHeader',
  'hasUserAuthHeader',
  'cliOwnedBearer',
  'useFirstPartyAuth',
  'HEADERS_HELPER_AUTH_REJECTED',
  'AUTH_HEADER_REJECTED',
  'CLI_OWNED_BEARER_REJECTED',
  'mcp_connect_needs_auth',
  'function Tt(',
  'function Yo(',
  'function x6e(',
]) {
  dumpHits(n, n, 8, 200)
}

// call sites of ko( near 207025228
{
  const hits = allHits(b248, 'ko({')
  const near = hits.filter(p => p > 206900000 && p < 207080000)
  lines.push(`## ko({ near-host hits=${near.length} ${near.slice(0, 12).join(',')}`)
  for (const p of near.slice(0, 8)) {
    lines.push(`## ko-call @${p}`)
    lines.push(asciiSlice(b248, p - 400, p + 500))
    lines.push('')
    dumpFn(`ko-caller @${p}`, p, 10000)
  }
}

// helperMintsAuthHeader assignment
{
  const hits = allHits(b248, 'helperMintsAuthHeader:')
  lines.push(`## helperMintsAuthHeader: hits=${hits.length}`)
  for (const p of hits.slice(0, 8)) {
    lines.push(`## assign @${p}`)
    lines.push(asciiSlice(b248, p - 500, p + 400))
    lines.push('')
  }
}

{
  const hits = allHits(b248, 'hasUserAuthHeader:')
  lines.push(`## hasUserAuthHeader: hits=${hits.length}`)
  for (const p of hits.slice(0, 8)) {
    lines.push(`## assign @${p}`)
    lines.push(asciiSlice(b248, p - 400, p + 300))
    lines.push('')
  }
}

// 247 ko equivalent around disabled when headers.Authorization
if (b247) {
  const h = allHits(b247, 'disabled when headers.Authorization')
  for (const p of h.filter(x => x > 180000000)) {
    const fn = lastFnStartGeneric(b247, p + 20, 4000)
    lines.push(`## 247 fn ${fn.name} @${fn.i} hit=${p}`)
    const ex = extractFnAt(b247, fn.i, 4000)
    if (ex.body) {
      lines.push(`len=${ex.len} sha=${ex.sha}`)
      lines.push(ex.body)
    } else {
      lines.push(asciiSlice(b247, p - 200, p + 1600))
    }
    lines.push('')
  }
}

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out, 'bytes', lines.join('\n').length)
