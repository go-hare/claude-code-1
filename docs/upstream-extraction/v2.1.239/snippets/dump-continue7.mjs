import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const needles = [
  'function MFn(',
  'function ALe(',
  'setRegisteredName',
  'registeredName',
  'You are sending to yourself',
  'message to yourself',
  'your own name',
  'own session',
  'a message to yourself',
  'No agent named',
  'function DHm(',
  'Please restart Claude from an existing directory',
  'The startup directory',
  'Current working directory does not exist',
  'crash dump',
  'removed worktree',
  'config.worktree.lock',
  'bareGitRepo',
  'HEAD + objects',
  'existsSync',
  'posix_spawn ENOENT',
  'falling back',
  'getProjectRoot()',
  'worktreeinclude',
  'middle truncate',
  'ellipsis',
  '1.1\\xd7',
  'US-only inference',
  'us_only_inference',
  'data-residency',
]

const chunks = []
for (const n of needles) {
  const hits = []
  let from = 0
  const needle = Buffer.from(n)
  while (hits.length < 5) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    hits.push(i)
    from = i + needle.length
  }
  chunks.push(`#### ${JSON.stringify(n)} ${hits.length} [${hits.join(', ')}]`)
  for (const i of hits) {
    chunks.push(`\n==== ${n} ${i} ====`)
    chunks.push(
      printable(buf.slice(Math.max(0, i - 200), i + 900).toString('utf8')),
    )
  }
  chunks.push('')
}

writeFileSync(new URL('./gold-continue7.txt', import.meta.url), chunks.join('\n'))
console.log('ok', chunks.length)
