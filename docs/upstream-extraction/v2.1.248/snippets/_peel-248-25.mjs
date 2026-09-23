/**
 * densable 2.1.248 #25 login-gateway-hang — extract X / DKt / nie / pOe / hn
 * Invent-ban. Gold only. No checklist/board edit.
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
lines.push('# gold-248-25-login-handoff')
lines.push('# densable 2.1.248 #25 login-gateway-hang')
lines.push(`# SEA 226708128 · 247 ${b247 ? 'present' : 'MISS'}`)
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
  lines.push(
    `## ${tag} @${i} len=${ex.len} sha=${ex.sha} bodyHits247=${other}`,
  )
  lines.push(ex.body)
  lines.push('')
  return ex
}

function dumpHits(tag, needle, buf = b248) {
  const a = h.allHits(buf, needle)
  const b = b247 && buf === b248 ? h.allHits(b247, needle).length : 'NA'
  lines.push(`## ${tag} needle=${JSON.stringify(needle)} 248=${a.length} 247=${b}`)
  for (const off of a.filter((x) => x > 170000000).slice(0, 8)) {
    dumpWin(tag, buf, off, 80, 220)
  }
  return a
}

// ---- strings ----
dumpHits('#25 login_handoff', 'login_handoff')
dumpHits('#25 consentHandoffRevealActive', 'consentHandoffRevealActive')
dumpHits('#25 consentHandoffHolds', 'consentHandoffHolds')
dumpHits('#25 consentHandoffSignal', 'consentHandoffSignal')
dumpHits('#25 fireConsentNeededRelease', 'fireConsentNeededRelease')
dumpHits('#25 PKt()', 'PKt()')
dumpHits('#25 function PKt', 'function PKt')
dumpHits('#25 function Ixt', 'function Ixt')
dumpHits('#25 function DKt', 'function DKt')
dumpHits('#25 function nie', 'function nie')
dumpHits('#25 async function*pOe', 'async function*pOe')
dumpHits('#25 refuseInput', 'refuseInput')
dumpHits('#25 cancelFirst', 'cancelFirst')
dumpHits('#25 hideIndexes', 'hideIndexes')
dumpHits('#25 windowAnchorMs', 'windowAnchorMs')
dumpHits('#25 windowMs', 'windowMs')
dumpHits('#25 Yes, I trust these settings', 'Yes, I trust these settings')

// ---- named fns ----
{
  const hits = h.allHits(b248, 'function DKt(){return P().consentHandoffRevealActive}')
  for (const off of hits) dumpFn('#25 DKt', b248, off, 200)
}
{
  const hits = h.allHits(b248, 'function Ixt(){return P().consentHandoffHolds.size>0}')
  for (const off of hits) dumpFn('#25 Ixt', b248, off, 200)
}
{
  const hits = h.allHits(b248, 'function nie(d){return HKt((C,x)=>d(gb,pOe(C,x),{queueBehind:!0}))')
  for (const off of hits) dumpFn('#25 nie', b248, off, 400)
}
{
  const hits = h.allHits(
    b248,
    'async function*pOe(d,C){let x=DKt()?"login_handoff":"default"',
  )
  for (const off of hits) dumpFn('#25 pOe', b248, off, 800)
}
{
  const hits = h.allHits(b248, 'function X(wo){let n=g(63),{settings:f,reveal:yo')
  for (const off of hits) dumpFn('#25 X', b248, off, 14000)
}

// ---- X surroundings: const c, FL, be, ye, hn ----
dumpWin('#25 X-before', b248, 201101609, 2500, 80)
dumpWin('#25 X-after', b248, 201101609 + 3364, 20, 800)

// hn call site already in X; find function hn(
{
  const hits = h.allHits(b248, 'function hn(')
  lines.push(`## function hn( hits=${hits.length} ${hits.slice(0, 12)}`)
  for (const off of hits.filter((x) => x > 190000000 && x < 210000000).slice(0, 6)) {
    dumpFn('#25 hn', b248, off, 6000)
  }
}

// Hi / Is / Hs / qf near dialog
{
  for (const name of ['function Hi(', 'function Is(', 'function Hs(', 'function qf(']) {
    const hits = h.allHits(b248, name)
    lines.push(`## ${name} hits=${hits.length} ${hits.slice(0, 8)}`)
    for (const off of hits.filter((x) => x > 180000000 && x < 210000000).slice(0, 4)) {
      dumpFn(`#25 ${name}`, b248, off, 2000)
    }
  }
}

// ---- registry class + review with handoff ----
{
  const off = 190466122
  dumpWin('#25 DKt-class-before', b248, off, 4000, 80)
  const fn = h.lastFnStartGeneric(b248, 190466937, 8000)
  lines.push(`## #25 review lastFn ${fn.name} @${fn.i}`)
  if (fn.i > 0) dumpFn('#25 review-or-check', b248, fn.i, 14000)
}

{
  const hits = h.allHits(b248, 'function PKt(')
  for (const off of hits) dumpFn('#25 PKt', b248, off, 1500)
}

{
  const hits = h.allHits(b248, 'fireConsentNeededRelease')
  for (const off of hits.filter((x) => x > 190400000 && x < 190500000)) {
    dumpWin('#25 fireConsentNeededRelease-site', b248, off, 200, 400)
    const fn = h.lastFnStartGeneric(b248, off, 6000)
    lines.push(`## fireConsent lastFn ${fn.name} @${fn.i}`)
    if (fn.i > 0) dumpFn('#25 fireConsent-fn', b248, fn.i, 8000)
  }
}

// class G constructor fields
{
  const hits = h.allHits(b248, 'consentHandoffHolds=new Set')
  for (const off of hits) {
    dumpWin('#25 class-G-fields', b248, off, 1500, 400)
    const fn = h.lastFnStartGeneric(b248, off, 4000)
    lines.push(`## class lastFn ${fn.name} @${fn.i}`)
    if (fn.i > 0) dumpFn('#25 class-or-ctor', b248, fn.i, 4000)
  }
}

// 247 leftovers
if (b247) {
  dumpHits('#25 247 login_handoff', 'login_handoff', b247)
  dumpHits('#25 247 consentHandoffRevealActive', 'consentHandoffRevealActive', b247)
  dumpHits('#25 247 Yes, I trust', 'Yes, I trust these settings', b247)
  const hits = h.allHits(b247, 'Yes, I trust these settings')
  for (const off of hits.filter((x) => x > 200000000).slice(0, 3)) {
    const fn = h.lastFnStartGeneric(b247, off, 8000)
    lines.push(`## 247 dialog lastFn ${fn.name} @${fn.i}`)
    if (fn.i > 0) dumpFn('#25 247 dialog', b247, fn.i, 8000)
  }
}

const out = join(here, 'gold-248-25-login-handoff.txt')
writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`wrote ${out} lines=${lines.length}`)
