/**
 * Pass 2 — restricted callees at JS offsets (not string-table).
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  allHits,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-restricted-callees',
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

function dumpHits(label, needle, around = 140, cap = 10) {
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

// file-tool cwd lock (JS, not string table)
const cwdJs = buf.indexOf(
  Buffer.from(
    '--restricted confines the file tools to the working directory.',
  ),
)
dumpAround('cwd-js', cwdJs, 800, 200)
{
  const fn = lastFnStartGeneric(buf, cwdJs, 8000)
  lines.push(`### cwd js fn name=${fn.name} @${fn.i}`)
  dumpFn('cwd-js-fn', fn.i, 16000)
}

// attachment clamp JS
const attJs = buf.indexOf(
  Buffer.from('--restricted only sends files from inside it'),
)
dumpAround('att-js', attJs, 900, 250)
{
  const fn = lastFnStartGeneric(buf, attJs, 8000)
  lines.push(`### att js fn name=${fn.name} @${fn.i}`)
  dumpFn('att-js-fn', fn.i, 16000)
}

// apply restricted session
dumpHits('V(d.config.restricted)', 'V(d.config.restricted)')
dumpHits('replaceRestrictedSession', 'replaceRestrictedSession')
dumpHits('restrictedSession()', 'restrictedSession()')
dumpHits('function c7e', 'function c7e(')
dumpHits('function zin', 'function zin(')
dumpHits('function dae', 'function dae(')
dumpHits('function Wdt', 'function Wdt(')
dumpHits('t.restricted||=O2()', 't.restricted||=O2()')

const c7e = buf.indexOf(Buffer.from('function c7e(e){'))
dumpFn('c7e', c7e, 400)
dumpAround('c7e-win', c7e, 200, 400)

const zin = buf.indexOf(Buffer.from('function zin(n,e){'))
dumpFn('zin', zin, 400)
const dae = buf.indexOf(Buffer.from('function dae(n){'))
dumpFn('dae', dae, 2000)
dumpAround('dae-win', dae, 80, 800)

const wdt = buf.indexOf(Buffer.from('async function Wdt(e,n){'))
dumpFn('Wdt', wdt, 4000)

// D2n callers
dumpHits('D2n(', 'D2n(')
dumpHits('RSe', 'RSe')

// tool strip
dumpHits('Nnt(', 'function Nnt(')
const nnt = buf.indexOf(Buffer.from('function Nnt(e,t){'))
dumpFn('Nnt', nnt, 2000)
dumpAround('Nnt-win', nnt, 200, 400)

// look for restricted tool filter helpers
dumpHits('code running tools list', 'PowerShell')
dumpHits('v2e', 'v2e')
dumpHits('A2e', 'A2e')
dumpHits('gue=', 'gue=')
dumpHits('Hbt=', 'Hbt=')

// settings ignore
dumpHits('setAllowedSettingSources restricted', 'restricted')
dumpHits('settingSources restricted', '.restricted')
dumpHits(
  'userSettings projectSettings localSettings skip',
  'userSettings',
)
dumpHits('allowedSettingSources=[]', 'allowedSettingSources')
dumpHits('replaceAllowedSettingSources', 'replaceAllowedSettingSources')
dumpHits('settingSources', 'settingSources')

// look near eagerLoadSettings / restricted sources
dumpHits('eagerLoadSettings_end restricted', 'eagerLoadSettings_end')
dumpHits('--restricted eager', '--restricted')

// how tools option interacts
dumpHits('tools names them impl', 'unless --tools')
dumpHits('restricted tools filter', 'restricted&&_s')
dumpHits('_s(t,{name:Yr})', '_s(t,{name:')

// cloud refuse function
const cloud = buf.indexOf(
  Buffer.from(
    'Error: --restricted cannot be enforced in a cloud, remote-environment or ssh session',
  ),
)
dumpAround('cloud-js', cloud, 600, 200)
{
  const fn = lastFnStartGeneric(buf, cloud, 8000)
  lines.push(`### cloud fn name=${fn.name} @${fn.i}`)
  dumpFn('cloud-fn', fn.i, 8000)
}

// extraArgs class
const sr = buf.indexOf(Buffer.from('#t=["--restricted"]'))
dumpAround('sr-extraArgs', sr, 200, 600)

// mb() path-in-cwd helper used by attachment + file tools
dumpHits('function mb(', 'function mb(')
dumpHits('!mb(s,n)', '!mb(')
dumpHits('function lV(', 'function lV(')
dumpHits('function uqe(', 'function uqe(')

writeFileSync(`${outDir}/gold-248-restricted-callees.txt`, lines.join('\n'))
console.log(
  'WROTE gold-248-restricted-callees.txt chars=',
  lines.join('\n').length,
)
