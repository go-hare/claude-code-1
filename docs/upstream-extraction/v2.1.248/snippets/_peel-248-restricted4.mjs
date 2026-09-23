/**
 * Pass 4 — tool-strip list, uqe/lV, spawn leftover mapping needles.
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
  '# gold-248-restricted-pass4',
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

function dumpHits(label, needle, around = 180, cap = 8) {
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

// D2n caller
dumpAround('D2n-caller-191370694', 191370694, 900, 250)

// cloud refuse
dumpAround('cloud-191366444', 191366444, 700, 200)

// c7e(xe) in commander action
dumpAround('c7e-xe-191363865', 191363865, 200, 200)

// eagerLoadSettings restricted
dumpAround('eager-189721058', 189721058, 400, 200)
{
  const fn = lastFnStartGeneric(buf, 189721058, 4000)
  lines.push(`### eager fn name=${fn.name} @${fn.i}`)
  dumpFn('eager-fn', fn.i, 4000)
}

// tool strip candidates
dumpHits('restricted tools strip', 'restricted&&')
dumpHits('disallow Bash', 'Bash")')
dumpHits('code running set', 'REPL')
dumpHits('strip WebFetch', 'WebFetch')
dumpHits('restricted default tools', 'restricted?')
dumpHits('toolsToDisallow restricted', 'toolsToDisallow')
dumpHits('baseTools restricted', 'baseTools')
dumpHits('parseBaseTools', 'parseBaseTools')
dumpHits('unless named', 'unless')
dumpHits('codeRunningToolNames', 'codeRunning')
dumpHits('SHELL_TOOLS', 'SHELL_TOOLS')
dumpHits('CODE_TOOLS', 'CODE_TOOLS')
dumpHits('restrictedDenyTools', 'restrictedDeny')
dumpHits('restrictedDefaultDeny', 'restrictedDefault')
dumpHits('Yr=', 'var Yr=')
dumpHits('Xe=', 'var Xe=')

// look near commander action for tool filter after restricted
dumpAround('action-restricted-tools', 191363865, 50, 2500)

// uqe / lV — file permission with restricted
const uqe = buf.indexOf(Buffer.from('function uqe('))
dumpFn('uqe', uqe, 12000)
const lV = buf.indexOf(Buffer.from('function lV('))
dumpFn('lV', lV, 12000)

// mb / Dv already known
const mb = buf.indexOf(
  Buffer.from('function mb(e,t,r){let o=r??Ri(e),u=Array.from(Dv(t))'),
)
dumpFn('mb', mb, 800)
const dv = buf.indexOf(
  Buffer.from('function Dv(e){return new Set([ve(),...e.additionalWorkingDirectories.keys()])}'),
)
dumpFn('Dv', dv, 200)

// HKe
dumpHits('HKe=', 'HKe=')
dumpHits('HKe const', 'HKe="')

// spawn leftover-like
dumpHits('$B()', '$B()')
dumpHits('CLAUDE_CODE_RESTRICTED:"1"', 'CLAUDE_CODE_RESTRICTED:"1"')
dumpHits('XCn(O2()', 'XCn(O2()')

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-restricted-pass4.txt',
  lines.join('\n'),
)
console.log('WROTE pass4 chars=', lines.join('\n').length)
