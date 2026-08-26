import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

function dumpAt(label, i, before = 80, after = 900) {
  if (i < 0 || i == null) return `\n==== ${label} MISS ====\n`
  return (
    `\n==== ${label} ${i} ====\n` +
    printable(buf.slice(Math.max(0, i - before), i + after).toString('utf8')) +
    '\n'
  )
}

function findAll(needle, max = 8) {
  const hits = []
  let i = 0
  const n = Buffer.from(needle)
  while (hits.length < max) {
    i = buf.indexOf(n, i)
    if (i < 0) break
    hits.push(i)
    i += n.length
  }
  return hits
}

let out = ''
for (const kw of [
  'GetCallerIdentityCommand',
  'STSClient',
  'checkStsCallerIdentity',
  'Fetching AWS caller identity',
  'new STSClient(',
  'GetCallerIdentity',
  'Please restart Claude from an existing directory',
  'process.chdir',
  'chdir(',
  'ENOENT',
  'this session',
  'your own',
  'You are ',
  'this row is you',
  '(you)',
  'own name',
  'Lists agents you can',
  'in-process subagents',
  '\\\\.\\pipe\\claude-code-',
  'claude-code-',
  'named pipe',
  'cross-session',
  'cross session',
  'function ALe(',
  'function TLe(',
  'startsWith("/")',
  'stripBom',
  'posix_spawn',
  'hook cwd',
]) {
  const hits = findAll(kw)
  out += `\n#### ${JSON.stringify(kw)} ${hits.length} [${hits.join(',')}] \n`
  if (hits[0] !== undefined) {
    // Prefer JS-range hits (>= 300_000_000) when present
    const js = hits.find(h => h >= 300_000_000) ?? hits[0]
    out += dumpAt(kw, js, 100, 800)
  }
}

writeFileSync(new URL('./gold-continue.txt', import.meta.url), out)
console.log('ok', out.length)
