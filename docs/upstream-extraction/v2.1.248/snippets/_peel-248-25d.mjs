/**
 * densable 2.1.248 #25 pass4 — zI in login chunk, qEt full, tr/Hs
 */
import { existsSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const h = createRequire(import.meta.url)('./_peel-248-na-helpers.mjs')
const b248 = h.loadSea(h.EXE_248)
const lines = []
lines.push('# gold-248-25-login-handoff-pass4')
lines.push(`# when=${new Date().toISOString()}`)
lines.push('')

function dumpWin(tag, i, before = 80, after = 400) {
  lines.push(`## ${tag} @${i}`)
  lines.push(h.asciiSlice(b248, i - before, i + after))
  lines.push('')
}

function dumpFn(tag, i, maxLen = 8000) {
  const ex = h.extractFnAt(b248, i, maxLen)
  if (!ex.body) {
    lines.push(`## ${tag} FAIL @${i}`)
    lines.push('')
    return
  }
  lines.push(`## ${tag} @${i} len=${ex.len} sha=${ex.sha}`)
  lines.push(ex.body)
  lines.push('')
}

// login chunk imports + zI near lnr
dumpWin('#25 login-chunk-start', 205715000, 2000, 200)
dumpWin('#25 lnr-before', 205715658, 2500, 200)

// qEt full
dumpWin('#25 qEt-full', 201105981, 200, 2500)
{
  const fn = h.lastFnStartGeneric(b248, 201105981, 2000)
  lines.push(`## qEt lastFn ${fn.name} @${fn.i}`)
}

// function tr( near Hs chunk
{
  const hits = h.allHits(b248, 'function tr(')
  lines.push(`## function tr( hits=${hits.length} ${hits.slice(0, 10)}`)
  for (const off of hits.filter((x) => x > 190000000 && x < 191000000).slice(0, 6)) {
    dumpFn('#25 tr', off, 400)
  }
}

// zI imported into login chunk — search nearby function zI(){ with no args
{
  const hits = h.allHits(b248, 'function zI(){')
  lines.push(`## function zI(){ hits=${hits.length}`)
  for (const off of hits) dumpFn('#25 zI-noarg', off, 300)
}

// IHn consent_pending — related hang?
dumpFn('#25 IHn', 190484440, 2500)

const out = join(here, 'gold-248-25-login-handoff-pass4.txt')
writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`wrote ${out} lines=${lines.length}`)
