/**
 * densable 2.1.248 #1 — extract O2 / Yk / D2n / parse / env / cwd / tools.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-restricted-bodies',
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

function findFn(name) {
  const n = `function ${name}(`
  const i = buf.indexOf(Buffer.from(n))
  return i
}

// --- O2 ---
const o2 = buf.indexOf(Buffer.from('function O2(){return Me(process.env.CLAUDE_CODE_RESTRICTED)}'))
dumpFn('O2', o2, 200)
dumpAround('O2-win', o2, 400, 400)

// Me used by O2
const meNear = lastFnStartGeneric(buf, o2, 8000)
lines.push(`### lastFn before O2 name=${meNear.name} @${meNear.i}`)
const meHits = allHits(buf, 'function Me(')
lines.push(`## function Me( hits=${meHits.length}`)
for (const i of meHits.slice(0, 6)) {
  dumpFn(`Me@${i}`, i, 2000)
  dumpAround(`Me-win@${i}`, i, 80, 200)
}

// --- Yk / isRestrictedSession ---
const ykAlias = buf.indexOf(Buffer.from('Yk as isRestrictedSession'))
dumpAround('Yk-export', ykAlias, 200, 200)
const ykHits = allHits(buf, 'function Yk(')
lines.push(`## function Yk( hits=${ykHits.length}`)
for (const i of ykHits) {
  dumpFn(`Yk@${i}`, i, 8000)
  dumpAround(`Yk-win@${i}`, i, 80, 400)
}

// also Yk() call sites that matter
dumpHits('Yk() call', 'Yk()&&{CLAUDE_CODE_RESTRICTED')
dumpHits('Yk() any', 'Yk()')

// --- D2n / RSe ---
const rse = buf.indexOf(Buffer.from('var RSe="bypassPermissions not supported in restricted mode"'))
dumpAround('RSe-win', rse, 80, 800)
const d2n = buf.indexOf(Buffer.from('function D2n(e){'))
dumpFn('D2n', d2n, 4000)
dumpAround('D2n-win', d2n, 200, 1200)

// --- argv parse ---
const argv = buf.indexOf(Buffer.from('if(s==="--restricted"){t.restricted=!0;continue}'))
dumpAround('argv-parse', argv, 600, 400)
const argvFn = lastFnStartGeneric(buf, argv, 4000)
lines.push(`### argv fn name=${argvFn.name} @${argvFn.i}`)
dumpFn('argv-fn', argvFn.i, 12000)

// --- env fold ---
const env = buf.indexOf(
  Buffer.from(
    'd.config.restricted||=["1","true","yes","on"].includes((process.env.CLAUDE_CODE_RESTRICTED??"").toLowerCase().trim())',
  ),
)
dumpAround('env-fold', env, 400, 400)
const envFn = lastFnStartGeneric(buf, env, 8000)
lines.push(`### env fn name=${envFn.name} @${envFn.i}`)
dumpFn('env-fn', envFn.i, 16000)

// --- commander options ---
const opt1 = buf.indexOf(
  Buffer.from(
    '.option("--restricted","Restricted mode: removes the built-in tools that run commands or code',
  ),
)
dumpAround('opt-main', opt1, 200, 600)
const opt2 = buf.indexOf(
  Buffer.from('.option("--restricted","Start dispatched sessions in restricted mode")'),
)
dumpAround('opt-dispatch', opt2, 200, 400)

// --- spawn env ---
const spawn = buf.indexOf(Buffer.from('Yk()&&{CLAUDE_CODE_RESTRICTED:"1"}'))
dumpAround('spawn-env', spawn, 500, 300)
const spawnFn = lastFnStartGeneric(buf, spawn, 6000)
lines.push(`### spawn fn name=${spawnFn.name} @${spawnFn.i}`)
dumpFn('spawn-fn', spawnFn.i, 12000)

// --- file tool cwd lock ---
const cwd = buf.indexOf(
  Buffer.from('--restricted confines the file tools to the working directory'),
)
dumpAround('cwd-lock', cwd, 400, 300)
const cwdFn = lastFnStartGeneric(buf, cwd, 6000)
lines.push(`### cwd fn name=${cwdFn.name} @${cwdFn.i}`)
dumpFn('cwd-fn', cwdFn.i, 12000)

// --- attachment clamp ---
const att = buf.indexOf(
  Buffer.from('--restricted only sends files from inside it'),
)
dumpAround('attachment', att, 400, 300)
const attFn = lastFnStartGeneric(buf, att, 6000)
lines.push(`### att fn name=${attFn.name} @${attFn.i}`)
dumpFn('att-fn', attFn.i, 12000)

// --- tool strip ---
dumpHits('removes built-in', 'removes the built-in tools')
dumpHits('WebFetch unless', 'WebFetch unless')
dumpHits('restricted tools', 'restricted&&')
dumpHits('code-running', 'code-running')
dumpHits('PowerShell, REPL', 'PowerShell, REPL')

// look for restricted tool filter
for (const needle of [
  'e.restricted',
  'config.restricted',
  '.restricted?',
  'n.restricted',
  't.restricted',
  'restrictedTools',
  'isRestrictedSession',
]) {
  dumpHits(`scan ${needle}`, needle, 80, 6)
}

// settings ignore
dumpHits('ignores user, project', 'ignores user, project')
dumpHits('setting-sources to pull', 'setting-sources to pull')
dumpHits('restricted setting sources', 'restricted&&!e.settingSources')
dumpHits('restricted sources', 'restricted')

// cloud/ssh
dumpHits(
  'cloud refuse',
  '--restricted cannot be enforced in a cloud, remote-environment or ssh session',
)
dumpHits(
  'cloud create refuse',
  'Cloud sessions cannot be created from a --restricted session',
)

// tools named
dumpHits('unless --tools names', 'unless --tools names them')
dumpHits('restricted tool drop', 'WebFetch')

writeFileSync(`${outDir}/gold-248-restricted-bodies.txt`, lines.join('\n'))
console.log(
  'WROTE gold-248-restricted-bodies.txt chars=',
  lines.join('\n').length,
)
console.log({
  o2,
  ykHits,
  d2n,
  argv,
  env,
  spawn,
  cwd,
  att,
  o2sha: o2 >= 0 ? sha(extractFnAt(buf, o2, 200).body || '') : 'miss',
  yksha: ykHits[0] >= 0 ? sha(extractFnAt(buf, ykHits[0], 8000).body || '') : 'miss',
  d2nsha: d2n >= 0 ? sha(extractFnAt(buf, d2n, 4000).body || '') : 'miss',
})
