import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const needles = [
  'function QZs(',
  'function lNr(',
  'function cNr(',
  'function uNr(',
  'QZs(',
  'lNr(',
  'uNr(',
  'recordedCwd',
  'collidesWith',
  'The startup directory',
  'crash dump',
  'no longer exists. Please restart',
  'does not exist. Please',
  'Current working directory',
  'process.chdir',
  'ENOENT: no such file or directory, uv_cwd',
  'uv_cwd',
  'posix_spawn ENOENT',
  'function dme(',
  'CLAUDE_CODE_TMPDIR',
  'three launches',
  'fullscreenOfferShown',
  'tuiOfferCount',
  'offerCount',
  'removed worktree',
  'resume in the current',
  'deleted directory',
  'cd into',
  'dark-ansi',
  '35;150;7M',
  'mouse report',
  'US-only',
  '1.1×',
  '1.1x',
  'usOnlyInference',
  'dataResidencyPremium',
  'truncateMiddle',
  'You are sending to yourself',
  'no agent named',
  'sending to yourself',
  'function DHm(',
  'FEFF',
  'stripBOM',
  'stripBom',
  '\\uFEFF',
  'UTF-8 BOM',
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
      printable(buf.slice(Math.max(0, i - 180), i + 1000).toString('utf8')),
    )
  }
  chunks.push('')
}

writeFileSync(
  new URL('./gold-continue11.txt', import.meta.url),
  chunks.join('\n'),
)
console.log('ok', chunks.length)
