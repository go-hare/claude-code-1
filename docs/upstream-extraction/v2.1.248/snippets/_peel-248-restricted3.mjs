/**
 * Pass 3 — tool-strip, settings-ignore, cwd-lock, V()/c7e apply.
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

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-restricted-pass3',
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

function dumpFn(label, i, maxLen = 20000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpHits(label, needle, around = 160, cap = 8) {
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

// known JS offsets from feat-1
dumpAround('cwd-181746129', 181746129, 900, 250)
{
  const fn = lastFnStartGeneric(buf, 181746129, 12000)
  lines.push(`### cwd fn name=${fn.name} @${fn.i}`)
  dumpFn('cwd-fn-181746129', fn.i, 20000)
}

dumpAround('att-183550610', 183550610, 200, 200)

// V() apply restricted
dumpAround('V-apply', 178181358, 400, 200)
dumpHits('function V(', 'function V(e){')
dumpHits('c7e(', 'c7e(')
dumpHits('replaceRestrictedSession(e)', 'replaceRestrictedSession(')

// look at launchOptions class field #l
dumpAround('launchOptions-restricted', 178535914, 800, 200)

// tool strip: look for restricted + tools
dumpHits('restricted tools default', 'restricted')
dumpHits('codeRunningTools', 'codeRunning')
dumpHits('CODE_RUNNING', 'CODE_RUNNING')
dumpHits('restrictedBuiltins', 'restrictedBuilt')
dumpHits('dropTools', 'dropTools')
dumpHits('filterTools restricted', 'restricted&&')
dumpHits('O2() tools', 'O2()')
dumpHits('Yk() tools', 'Yk()')
dumpHits('n.restricted tools', '.restricted')

// settings
dumpHits('settingSources empty restricted', 'settingSources')
dumpHits('userSettings filter', 'userSettings')
dumpHits('setAllowedSettingSources([', 'setAllowedSettingSources')
dumpHits('allowedSettingSources restricted', 'allowedSettingSources')
dumpHits('restricted sources=[]', 'restricted?[]')
dumpHits('restricted sources 2', 'restricted?[')
dumpHits('ignore user project', 'userSettings","projectSettings","localSettings"')
dumpHits('sources user project local', '["userSettings","projectSettings","localSettings"]')

// --tools interaction
dumpHits('tools names', 'tools names')
dumpHits('explicitTools', 'explicitTools')
dumpHits('named in --tools', 'named in')
dumpHits('tools??[]', 'tools??')
dumpHits('has(Xe)', 't.has(Xe)')
dumpHits('function Fnt', 'function Fnt(')

// D2n caller context
dumpAround('D2n-caller', 191370694, 800, 400)
{
  const fn = lastFnStartGeneric(buf, 191370694, 8000)
  lines.push(`### D2n caller fn name=${fn.name} @${fn.i}`)
}

// file path helper mb
const mbHits = allHits(buf, 'function mb(')
lines.push(`## function mb( hits=${mbHits.length}`)
for (const i of mbHits.slice(0, 8)) {
  dumpFn(`mb@${i}`, i, 4000)
}

const lVHits = allHits(buf, 'function lV(')
lines.push(`## function lV( hits=${lVHits.length}`)
for (const i of lVHits.slice(0, 4)) {
  dumpFn(`lV@${i}`, i, 8000)
}

const uqeHits = allHits(buf, 'function uqe(')
lines.push(`## function uqe( hits=${uqeHits.length}`)
for (const i of uqeHits.slice(0, 4)) {
  dumpFn(`uqe@${i}`, i, 8000)
}

// permission set restricted
dumpAround('perm-set-restricted', 185215803, 200, 300)

// eager settings + restricted
dumpAround('eager-restricted-flag', 92224972, 200, 200)
dumpHits('eagerParse restricted', '--restricted')

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-restricted-pass3.txt',
  lines.join('\n'),
)
console.log('WROTE pass3 chars=', lines.join('\n').length)
