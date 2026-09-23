/**
 * Pass 6 — Unt / Yr / Xe / v2e / A2e / code-running tool names.
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
  '# gold-248-restricted-unt',
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

function dumpFn(label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpHits(label, needle, around = 120, cap = 8) {
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

dumpHits('function Unt', 'function Unt(')
dumpHits('Unt()', 'Unt()')
dumpHits('var Yr=', 'var Yr=')
dumpHits('Yr="', 'Yr="')
dumpHits('var Xe=', 'var Xe=')
dumpHits('Xe="', 'Xe="')
dumpHits('var Nt=', 'var Nt=')
dumpHits('Nt="', 'Nt="')
dumpHits('var Xo=', 'var Xo=')
dumpHits('Xo="', 'Xo="')
dumpHits('var Yo=', 'var Yo=')
dumpHits('Yo="', 'Yo="')
dumpHits('var v2e=', 'var v2e=')
dumpHits('v2e=[', 'v2e=[')
dumpHits('var A2e=', 'var A2e=')
dumpHits('A2e=[', 'A2e=[')
dumpHits('var bgt=', 'var bgt=')
dumpHits('bgt=', 'bgt=')
dumpHits('var P9n=', 'var P9n=')
dumpHits('P9n=', 'P9n=')
dumpHits('u2t=', 'u2t=')
dumpHits('var bb=', 'var bb=')

for (const name of ['Unt', 'Nnt', 'Fnt']) {
  const i = buf.indexOf(Buffer.from(`function ${name}(`))
  dumpFn(name, i, 4000)
}

// search for arrays that look like code-running tools
dumpHits('Bash PowerShell REPL list', '["Bash"')
dumpHits('BASH_TOOL_NAME restricted', 'BASH_TOOL_NAME')
dumpHits('PowerShellTool restricted', 'PowerShell')
dumpHits('REPL_TOOL_NAME', 'REPL_TOOL_NAME')

// leftover-like: tools that run commands
dumpHits('run commands or code', 'run commands or code')
dumpHits('code-running tools', 'code-running tools')

// extract around first Unt()
const untCall = buf.indexOf(Buffer.from('Nnt(Unt(),Fnt(U))'))
dumpAround('Nnt-Unt-call', untCall, 200, 80)
{
  const fn = lastFnStartGeneric(buf, untCall, 2000)
  lines.push(`### caller=${fn.name} @${fn.i}`)
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-restricted-unt.txt',
  lines.join('\n'),
)
console.log('WROTE unt chars=', lines.join('\n').length)
