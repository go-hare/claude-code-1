/**
 * #24 pass4 — how ce/re (hasUserAuthHeader / helperMintsAuthHeader) are set,
 * and whether authProvider is omitted when helper mints Authorization.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-24-ce-re.txt'
const lines = ['# gold-248-24-ce-re', `# when=${new Date().toISOString()}`, '']
const b248 = loadSea(EXE_248)

function dump(tag, i, before, after) {
  lines.push(`## ${tag} @${i}`)
  lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

// window before SSE ko call — where ce/re/me/L are assigned
dump('before-sse-ko', 207051031, 3500, 200)

// function Tt at 207023263
{
  const ex = extractFnAt(b248, 207023263, 4000)
  lines.push(`## Tt @207023263 ${ex.body ? `len=${ex.len} sha=${ex.sha}` : 'MISS'}`)
  lines.push(ex.body || asciiSlice(b248, 207023200, 207024800))
  lines.push('')
}

// Yo oauth fallback near mcp_connect_needs_auth
{
  const hits = allHits(b248, 'mcp_connect_needs_auth')
  for (const p of hits.filter(x => x > 200000000)) {
    const fn = lastFnStartGeneric(b248, p + 8, 4000)
    lines.push(`## needs-auth lastFn=${fn.name} @${fn.i}`)
    const ex = extractFnAt(b248, fn.i > 0 ? fn.i : p - 500, 3500)
    if (ex.body) {
      lines.push(`len=${ex.len} sha=${ex.sha}`)
      lines.push(ex.body)
    } else {
      dump('needs-auth-win', p, 800, 400)
    }
    lines.push('')
  }
}

// Search helper mint flags near get headers
for (const n of [
  'helperMintsAuthHeader=',
  'hasUserAuthHeader=',
  'x6e(',
  'headersHelper&&',
]) {
  const hits = allHits(b248, n).filter(p => p > 206900000 && p < 207080000)
  lines.push(`## ${n} in connect chunk hits=${hits.length}`)
  for (const p of hits.slice(0, 10)) {
    dump(n, p, 180, 220)
  }
}

// authProvider assignment in connect around 20704x
{
  const hits = allHits(b248, 'authProvider').filter(
    p => p > 206980000 && p < 207055000,
  )
  lines.push(`## authProvider in connect ${hits.length}`)
  for (const p of hits.slice(0, 12)) {
    dump('authProvider', p, 160, 200)
  }
}

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out)
