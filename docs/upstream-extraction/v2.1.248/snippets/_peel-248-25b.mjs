/**
 * densable 2.1.248 #25 pass2 — gateway CHn caller, sa/Is/hn, leftover mapping
 */
import { existsSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const h = createRequire(import.meta.url)('./_peel-248-na-helpers.mjs')
const b248 = h.loadSea(h.EXE_248)
const b247 = existsSync(h.EXE_247) ? h.loadSea(h.EXE_247) : null
const lines = []
lines.push('# gold-248-25-login-handoff-pass2')
lines.push(`# when=${new Date().toISOString()}`)
lines.push('')

function dumpWin(tag, buf, i, before = 80, after = 400) {
  if (i < 0) {
    lines.push(`## ${tag} MISS`)
    lines.push('')
    return
  }
  lines.push(`## ${tag} @${i}`)
  lines.push(h.asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(tag, buf, i, maxLen = 8000) {
  const ex = h.extractFnAt(buf, i, maxLen)
  if (!ex.body) {
    lines.push(`## ${tag} FAIL @${i} ${JSON.stringify(ex).slice(0, 220)}`)
    lines.push('')
    return ex
  }
  const other = buf === b248 && b247 ? h.allHits(b247, ex.body).length : 'NA'
  lines.push(`## ${tag} @${i} len=${ex.len} sha=${ex.sha} bodyHits247=${other}`)
  lines.push(ex.body)
  lines.push('')
  return ex
}

// official hn confirm @198978718
dumpFn('#25 hn-confirm', b248, 198978718, 4000)
dumpWin('#25 hn-confirm-full', b248, 198978718, 200, 2000)

// sa / Is from same chunk as X imports
{
  const hits = h.allHits(b248, 'function Is(')
  for (const off of hits) {
    const ex = h.extractFnAt(b248, off, 400)
    if (ex.body && (ex.body.includes('Ky') || ex.body.includes('ed(') || ex.body.length < 80)) {
      dumpFn('#25 Is-cand', b248, off, 400)
    }
  }
}

// extract chunk-zjmyxdw3 around sa,Is,qf,Hs,Hi
dumpWin('#25 Hi-chunk', b248, 190608109, 2500, 400)

// CHn / onConsentNeeded / gateway
{
  const needles = [
    'onConsentNeeded',
    'function CHn',
    'CHn(',
    'consentNeededRelease',
    'LKt(qEt',
    'gateway_cert_mismatch',
  ]
  for (const n of needles) {
    const a = h.allHits(b248, n)
    const b = b247 ? h.allHits(b247, n).length : 'NA'
    lines.push(`## ${n} 248=${a.length} 247=${b}`)
    for (const off of a.filter((x) => x > 170000000).slice(0, 6)) {
      dumpWin(n, b248, off, 120, 350)
    }
  }
}

dumpFn('#25 CHn', b248, 190466202, 400)
{
  const hits = h.allHits(b248, 'function CHn(')
  for (const off of hits) dumpFn('#25 CHn-fn', b248, off, 400)
}

// gateway caller function
{
  const fn = h.lastFnStartGeneric(b248, 205709258, 8000)
  lines.push(`## gateway lastFn ${fn.name} @${fn.i}`)
  if (fn.i > 0) dumpFn('#25 gateway-caller', b248, fn.i, 14000)
  dumpWin('#25 gateway-win', b248, 205709258, 800, 2000)
}

// 247 checkManagedSettings / class G
if (b247) {
  const hits = h.allHits(b247, 'class G{replRequester')
  lines.push(`## 247 class G hits=${hits.length}`)
  for (const off of hits) dumpWin('#25 247 class G', b247, off, 80, 2500)

  const hits2 = h.allHits(b247, 'async function ee(')
  lines.push(`## 247 async function ee( hits=${hits2.length}`)
  for (const off of hits2.filter((x) => x > 200000000).slice(0, 4)) {
    dumpFn('#25 247 ee', b247, off, 2000)
  }

  const hits3 = h.allHits(b247, 'deferred_no_consent_surface')
  lines.push(`## 247 deferred_no_consent_surface hits=${hits3.length}`)
  for (const off of hits3.filter((x) => x > 210000000 && x < 220000000).slice(0, 3)) {
    const fn2 = h.lastFnStartGeneric(b247, off, 4000)
    lines.push(`## 247 deferred lastFn ${fn2.name} @${fn2.i}`)
    if (fn2.i > 0) dumpFn('#25 247 check', b247, fn2.i, 2000)
  }
}

// leftover mapping needles in 248 vs 247 for s_A
{
  const n = 'yield{settings:d,reveal:x}'
  lines.push(`## pOe yield 248=${h.allHits(b248, n).length} 247=${b247 ? h.allHits(b247, n).length : 'NA'}`)
}
{
  const n = 'yield{settings:d}'
  const a = h.allHits(b248, n)
  const b = b247 ? h.allHits(b247, n) : []
  lines.push(`## yield{settings:d} 248=${a.length} 247=${b.length}`)
}

const out = join(here, 'gold-248-25-login-handoff-pass2.txt')
writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`wrote ${out} lines=${lines.length}`)
