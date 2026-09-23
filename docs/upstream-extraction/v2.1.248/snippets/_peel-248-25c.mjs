/**
 * densable 2.1.248 #25 pass3 — lnr / zI / login onDone / leftover hn
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
lines.push('# gold-248-25-login-handoff-pass3')
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

dumpWin('#25 login-onDone', b248, 205716642, 400, 800)

{
  for (const n of ['function lnr', 'function zI', 'lnr()', 'zI()', 'H0e(', 'function H0e', 'function LKt', 'qEt']) {
    const a = h.allHits(b248, n)
    const b = b247 ? h.allHits(b247, n).length : 'NA'
    lines.push(`## ${n} 248=${a.length} 247=${b}`)
    for (const off of a.filter((x) => x > 190000000 && x < 210000000).slice(0, 5)) {
      dumpWin(n, b248, off, 80, 250)
    }
  }
}

{
  const hits = h.allHits(b248, 'function lnr(')
  for (const off of hits) dumpFn('#25 lnr', b248, off, 2000)
}
{
  const hits = h.allHits(b248, 'function zI(')
  for (const off of hits.filter((x) => x > 200000000 && x < 210000000)) {
    dumpFn('#25 zI', b248, off, 800)
  }
}
{
  const hits = h.allHits(b248, 'function H0e(')
  for (const off of hits) dumpFn('#25 H0e', b248, off, 1500)
}
{
  const hits = h.allHits(b248, 'function LKt(')
  for (const off of hits.filter((x) => x > 180000000 && x < 200000000)) {
    dumpFn('#25 LKt', b248, off, 2000)
  }
}

// ITt screen-reader confirm
dumpFn('#25 ITt', b248, 190618668, 4000)

// leftover 247 login post-auth refresh
if (b247) {
  const hits = h.allHits(b247, 'refreshRemoteManagedSettings')
  lines.push(`## 247 refreshRemoteManagedSettings hits=${hits.length}`)
  for (const off of hits.slice(0, 4)) dumpWin('#25 247 refresh', b247, off, 80, 200)

  const hits2 = h.allHits(b247, 'onConsentNeeded')
  lines.push(`## 247 onConsentNeeded hits=${hits2.length}`)

  const hits3 = h.allHits(b247, 'H0e(')
  lines.push(`## 247 H0e( hits=${hits3.length}`)
}

const out = join(here, 'gold-248-25-login-handoff-pass3.txt')
writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`wrote ${out} lines=${lines.length}`)
