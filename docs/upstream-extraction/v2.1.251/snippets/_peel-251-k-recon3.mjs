/**
 * densable 2.1.251 SEA peel recon3 — #33 imports, #44 qe, #51 Ld/kr, $Y fke.
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const buf = loadSea()
const lines = []
const log = s => {
  lines.push(s)
  console.log(s)
}

function dumpHits(needle, cap = 8, win = 100) {
  const hits = allHits(buf, needle)
  log(`${JSON.stringify(needle)} hits=${hits.length}`)
  for (const i of hits.slice(0, cap)) {
    const fn = lastFnStartGeneric(buf, i, 12000)
    log(
      `  @${i} lastFn=${fn.name}@${fn.i} | ${asciiSlice(buf, i - 30, i + win).replace(/\s+/g, ' ')}`,
    )
  }
}

function extractAt(i, maxLen = 8000) {
  const fn = extractFnAt(buf, i, maxLen)
  log(
    `extract @${i} miss=${!!fn.miss || !!fn.missEnd} len=${fn.len ?? 0} sha=${fn.sha ?? '-'}`,
  )
  if (fn.body) log(fn.body)
  else log((fn.preview || '').slice(0, 500))
  log('---')
  return fn
}

log('=== uo chunk import preamble ===')
log(asciiSlice(buf, 204648000, 204651650))
log('\n=== L() start neighborhood ===')
log(asciiSlice(buf, 204651500, 204651750))

log('\n=== import {_  / {g  / {J near 2046xx ===')
for (const n of [
  'import{_,',
  'import{g,',
  'import{J,',
  ',_}',
  ',g}',
  ',J}',
  '{_,g,',
  '{g,_',
  'as _}',
  'as g}',
  'as J}',
]) {
  dumpHits(n, 6, 80)
}

log('\n=== telemetry _ / g pair ===')
extractAt(179407606, 400)
extractAt(179407669, 400)
extractAt(179407748, 400)

log('\n=== J logger candidates ===')
extractAt(179949342, 600)
extractAt(183504031, 800)
extractAt(179913092, 200)

log('\n=== J("info" callers ===')
dumpHits('J("info"', 15, 90)
dumpHits('J("info","bg_worker_ctty"', 5, 80)

log('\n=== _("bg_worker_ctty") and g("bg_worker_ctty" ===')
dumpHits('_("bg_worker_ctty")', 5, 40)
dumpHits('g("bg_worker_ctty"', 5, 40)
dumpHits('tengu_feature_ok', 5, 60)
dumpHits('function _(e,u){s("tengu_feature_ok"', 3, 80)

log('\n=== import of _ g from feature chunk ===')
dumpHits('tengu_feature_sad', 5, 80)
dumpHits('export{_,g,', 8, 80)
dumpHits('export{_,', 10, 80)
dumpHits('export{g,', 8, 80)

log('\n=== #44 gRt qe bug command ===')
extractAt(210227259, 400)
dumpHits('function qe(', 8, 90)
dumpHits('async function qe(', 8, 90)
dumpHits('name:"bug"', 5, 160)
dumpHits('TG(p)', 8, 80)
dumpHits('TG(e)', 8, 80)
dumpHits('has been disabled via', 8, 80)

log('\n=== n() /bug neighborhood ===')
{
  const i = buf.indexOf(Buffer.from('m==="share"?"/share":"/bug"'))
  log(`n share/bug @${i}`)
  log(asciiSlice(buf, i - 200, i + 120))
}

log('\n=== #51 Ld kr Iln ===')
extractAt(185963190, 400)
extractAt(185970495, 400)
{
  const i = buf.indexOf(Buffer.from('function Iln({viewingAgentTaskId:'))
  log(`Iln @${i}`)
  if (i >= 0) extractAt(i, 800)
}

log('\n=== $Y fke goe zS ===')
dumpHits('function fke(', 6, 90)
dumpHits('function zS(', 6, 80)
dumpHits('goe=new Set', 5, 80)
dumpHits('goe.has', 5, 80)

log('\n=== DVt HA import line ===')
log(asciiSlice(buf, 184277640, 184277780))

log('\n=== zy rNt ===')
extractAt(184310921, 200)

log('\n=== t8n italic class head ===')
log(asciiSlice(buf, 183514842, 183517540))

const out = join(__dir, '_peel-251-k-recon3.txt')
writeFileSync(out, lines.join('\n'), 'utf8')
console.error('wrote', out)
