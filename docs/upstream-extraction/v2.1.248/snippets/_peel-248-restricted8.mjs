/**
 * densable 2.1.248 #1 — remaining restricted callees (vi / Wdt / k3t / gue / Hbt / v2e).
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

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-restricted-pass5',
  `exe=${EXE_248}`,
  `bytes=${buf.length}`,
  `when=${new Date().toISOString()}`,
  '',
]

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(label, i, maxLen = 16000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpHits(label, needle, around = 160, cap = 6) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(buf, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

const vi = buf.indexOf(
  Buffer.from('--restricted confines the file tools to the working directory'),
)
dumpAround('vi-str', vi, 400, 200)
// JS copy (not string table)
const viJs = allHits(
  buf,
  '--restricted confines the file tools to the working directory',
).filter(i => i > 170000000)
for (const i of viJs.slice(0, 3)) {
  dumpAround(`vi-js@${i}`, i, 500, 200)
  // walk back to function
  const win = asciiSlice(buf, i - 800, i + 200)
  const fn = win.lastIndexOf('function ')
  lines.push(`### vi-fn-win @${i} fnRel=${fn}`)
  lines.push(win.slice(Math.max(0, fn), fn + 500))
  lines.push('')
}

const wdt = buf.indexOf(
  Buffer.from('--restricted only sends files from inside it'),
)
dumpAround('wdt-str', wdt, 400, 200)
const wdtJs = allHits(
  buf,
  '--restricted only sends files from inside it',
).filter(i => i > 170000000)
for (const i of wdtJs.slice(0, 3)) {
  dumpAround(`wdt-js@${i}`, i, 600, 200)
}

dumpHits('k3t-restricted-wipe', 'g(""),c7e(!0)', 220, 4)
dumpHits('k3t-t0', 't0("--restricted")||O2()', 220, 4)
dumpHits('gue-assign', 'var gue=', 80, 8)
dumpHits('Hbt-assign', 'var Hbt=', 80, 8)
dumpHits('gue-eq', 'gue="', 80, 8)
dumpHits('Hbt-eq', 'Hbt="', 80, 8)
dumpHits('v2e-near-Nnt', 'v2e', 80, 4)
dumpHits('enablesCodeExecution-true', 'enablesCodeExecution:!0', 180, 20)
dumpHits(
  'setMode-restricted',
  'if(t.restricted)return{ok:!1,error:RSe}',
  200,
  4,
)

const c7e = buf.indexOf(
  Buffer.from(
    'function c7e(e){n().host.launchOptions.replaceRestrictedSession(e)}',
  ),
)
dumpFn('c7e', c7e, 200)

const zin = buf.indexOf(
  Buffer.from('function zin(n,e){return e&&!n.restricted?{...n,restricted:!0}:n}'),
)
dumpFn('zin', zin, 200)

writeFileSync(`${outDir}/gold-248-restricted-pass5.txt`, lines.join('\n'))
console.log('wrote', `${outDir}/gold-248-restricted-pass5.txt`, 'lines', lines.length)
