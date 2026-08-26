import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const needles = [
  'The current directory no longer exists',
  "Can't read the current directory",
  'Start Claude Code from an existing directory',
  'Start Claude Code from a different directory',
  'function Llh(',
  'ownWorktrees',
  'function _uh(',
  'function Hg(',
  'function Eke(',
  'function hg(',
  'Hooks: cwd',
  'falling back to original',
  'posix_spawn',
  'ENOENT',
]

const chunks = []
for (const n of needles) {
  const hits = []
  let from = 0
  const needle = Buffer.from(n)
  while (hits.length < 4) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    hits.push(i)
    from = i + needle.length
  }
  chunks.push(`#### ${JSON.stringify(n)} ${hits.length} [${hits.join(', ')}]`)
  for (const i of hits) {
    chunks.push(`\n==== ${n} ${i} ====`)
    chunks.push(
      printable(buf.slice(Math.max(0, i - 400), i + 1600).toString('utf8')),
    )
  }
  chunks.push('')
}

writeFileSync(
  new URL('./gold-continue13.txt', import.meta.url),
  chunks.join('\n'),
)
console.log('ok')
