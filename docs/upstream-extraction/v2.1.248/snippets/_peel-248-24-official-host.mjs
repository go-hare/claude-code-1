/**
 * #24 headershelper-401 — extract official 248 host around
 * `re-running headersHelper` (~207115285) + unique vs 247.
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
const lines = [
  '# gold-248-24-official-host',
  `# when=${new Date().toISOString()}`,
  '',
]

const b248 = loadSea(EXE_248)
lines.push(`# SEA248 size=${b248.length} path=${EXE_248}`)
let b247 = null
if (existsSync(EXE_247)) {
  b247 = loadSea(EXE_247)
  lines.push(`# SEA247 size=${b247.length} path=${EXE_247}`)
} else {
  lines.push('# SEA247 missing')
}
lines.push('')

function dumpHits(tag, needle, buf = b248, cap = 12, around = 220) {
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

function dumpWin(tag, i, before = 400, after = 800) {
  lines.push(`## ${tag} @${i}`)
  lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

function dumpFn(tag, i, maxLen = 16000) {
  const fn = lastFnStartGeneric(b248, i + 20, 8000)
  lines.push(`## ${tag} lastFn name=${fn.name} start=${fn.i} hit=${i}`)
  const ex = extractFnAt(b248, fn.i > 0 ? fn.i : i, maxLen)
  if (!ex.body) {
    lines.push(`MISS ${JSON.stringify(ex)}`)
    lines.push('')
    return { fn, ex }
  }
  lines.push(`len=${ex.len} sha=${ex.sha}`)
  lines.push(ex.body)
  lines.push('')
  return { fn, ex }
}

// ---- needles ----
const hitsRerun = dumpHits('#24 re-running headersHelper', 're-running headersHelper')
dumpHits('#24 session credential rejected', 'session credential rejected')
dumpHits('#24 refresh token stored', 'refresh token stored')
dumpHits('#24 collateral_rejoin', 'collateral_rejoin')
dumpHits('#24 reauth_retry', 'reauth_retry')
dumpHits('#24 stale_refused', 'stale_refused')
dumpHits('#24 reauthDecisionSinkForTest', 'reauthDecisionSinkForTest')
dumpHits('#24 mcp_headers_helper', 'mcp_headers_helper', b248, 12, 160)
dumpHits('#24 OAuth discovery', 'OAuth discovery')
dumpHits('#24 falling into OAuth', 'falling into OAuth')
dumpHits('#24 Authorization already', 'Authorization already')
dumpHits('#24 already gave', 'already gave')
dumpHits('#24 headersHelper supplies', 'headersHelper supplies')
dumpHits('#24 skip discovery', 'skip discovery')
dumpHits('#24 skip OAuth', 'skip OAuth')
dumpHits('#24 skipOAuth', 'skipOAuth')
dumpHits('#24 hasAuthorization', 'hasAuthorization')
dumpHits('#24 authorizationHeader', 'authorizationHeader')

// Authorization + headersHelper proximity in JS region
{
  const hh = allHits(b248, 'headersHelper')
  const js = hh.filter(p => p > 180000000 && p < 220000000)
  lines.push(`## headersHelper JS-region 180-220M count=${js.length}`)
  for (const p of js.slice(0, 40)) {
    const win = asciiSlice(b248, p - 180, p + 280)
    const interesting =
      /Authorization|authProvider|discover|401|oauth|OAuth|retry|re-run/i.test(
        win,
      )
    if (interesting) {
      lines.push(`- @${p} ${win}`)
    }
  }
  lines.push('')
}

// Unique 248 vs 247 headersHelper windows in JS
if (b247) {
  const n248 = allHits(b248, 'headersHelper')
  const n247 = allHits(b247, 'headersHelper')
  lines.push(
    `## headersHelper counts 248=${n248.length} 247=${n247.length} delta=${n248.length - n247.length}`,
  )
  const js248 = n248.filter(p => p > 180000000 && p < 220000000)
  const js247 = n247.filter(p => p > 180000000 && p < 220000000)
  lines.push(`## headersHelper JS 180-220M 248=${js248.length} 247=${js247.length}`)

  const wins248 = js248.map(p => asciiSlice(b248, p - 80, p + 200))
  const wins247 = js247.map(p => asciiSlice(b247, p - 80, p + 200))
  const set247 = new Set(wins247)
  let uniq = 0
  for (const [i, w] of wins248.entries()) {
    if (!set247.has(w)) {
      uniq++
      if (uniq <= 20) {
        lines.push(`## UNIQUE-248 headersHelper JS #${uniq} @${js248[i]}`)
        lines.push(w)
        lines.push('')
      }
    }
  }
  lines.push(`## UNIQUE-248 headersHelper JS windows=${uniq}`)
  lines.push('')
}

// Primary host: fo @ ~207108764 / hit 207115285
{
  const hit = hitsRerun.find(p => p > 207100000 && p < 207200000) ?? 207115285
  dumpWin('#24 fo-401-before-2k', hit, 2200, 200)
  dumpWin('#24 fo-401-core', hit, 200, 1800)
  dumpFn('#24 fo-fn', hit, 28000)
}

// Secondary host Lt @ 207256960
{
  const hit = hitsRerun.find(p => p > 207200000) ?? 207256960
  dumpWin('#24 Lt-401-core', hit, 200, 1600)
  dumpFn('#24 Lt-fn', hit, 12000)
}

// Compare 247 window at same needle
if (b247) {
  const h247 = allHits(b247, 're-running headersHelper')
  lines.push(`## 247 re-running headersHelper hits=${h247.join(',')}`)
  for (const p of h247) {
    if (p < 180000000) continue
    lines.push(`## 247 401-core @${p}`)
    lines.push(asciiSlice(b247, p - 200, p + 1800))
    lines.push('')
    const fn = lastFnStartGeneric(b247, p + 20, 8000)
    lines.push(`## 247 lastFn name=${fn.name} start=${fn.i}`)
    const win248 = asciiSlice(b248, 207115285 - 200, 207115285 + 1800)
    const win247 = asciiSlice(b247, p - 200, p + 1800)
    lines.push(`## 247vs248 401-core sha248=${sha(win248)} sha247=${sha(win247)} eq=${win248 === win247}`)
    lines.push('')
  }

  const s248 = allHits(b248, 'session credential rejected')
  const s247 = allHits(b247, 'session credential rejected')
  lines.push(
    `## session credential rejected 248=${s248.length} 247=${s247.length}`,
  )
}

// authProvider + headersHelper nearby in connect
{
  const needles = [
    'Successfully retrieved',
    'authProvider',
    'ClaudeAuthProvider',
    'getMcpServerHeaders',
    'headers.Authorization',
    'Authorization:',
  ]
  for (const n of needles) {
    dumpHits(`#24 connect ${n}`, n, b248, 8, 140)
  }
}

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out, 'bytes', lines.join('\n').length)
