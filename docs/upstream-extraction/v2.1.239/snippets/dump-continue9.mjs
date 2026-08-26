import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const needles = [
  'Hooks: cwd',
  'falling back',
  'hookCwd',
  'safeCwd',
  'posix_spawn',
  'getProjectRoot',
  'function dme(',
  'cwd not found',
  'Please restart Claude',
  'startup directory',
  'does not exist',
  '.worktreeinclude',
  'globstar',
  'sanitizePath',
  'untitled session',
  'truncateMiddle',
  'middle ellipsis',
  '\\u2026',
  'claudeMdExcludes',
  'US-only inference',
  'usOnlyInference',
  '1.1x',
  'data-residency',
  'literal tag',
  'insights',
  'selection:copy',
  '35;150;7M',
  'keep-alives',
  'SessionStart',
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
      printable(buf.slice(Math.max(0, i - 160), i + 800).toString('utf8')),
    )
  }
  chunks.push('')
}

writeFileSync(new URL('./gold-continue9.txt', import.meta.url), chunks.join('\n'))
console.log('ok')
