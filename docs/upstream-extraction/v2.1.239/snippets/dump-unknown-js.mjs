import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

function dump(kw, before = 200, after = 700) {
  const hits = []
  const b = Buffer.from(kw)
  let i = -1
  while ((i = buf.indexOf(b, i + 1)) !== -1 && hits.length < 4) {
    const slice = printable(
      buf.slice(Math.max(0, i - before), i + after).toString('utf8'),
    )
    const jsish = /return"|function |if\(|=>|const |let /.test(slice)
    hits.push({ i, jsish, slice })
  }
  return { kw, hits }
}

const keys = [
  'weekly limit resets',
  'monthly spend limit',
  'function stripBom',
  'stripBom(',
  'posix_spawn',
  'no agent named',
  '(untitled)',
  'organization policy',
  'out-of-credits',
  'spend-limit',
  'CLAUDE_CODE_RETRY_WATCHDOG',
  'own name',
  'application/vnd.amazon.eventstream',
  'HTTPS_PROXY',
  'removed worktree',
  'config.worktree',
  'worktreeConfig',
  'inference_geo',
  'data-residency',
  '1.1*',
  '*1.1',
]

let out = ''
for (const kw of keys) {
  const { hits } = dump(kw)
  out += `\n######## ${JSON.stringify(kw)} n=${hits.length} ########\n`
  for (const h of hits) {
    if (!h.jsish && hits.some(x => x.jsish)) continue
    out += `\n--- @${h.i} jsish=${h.jsish} ---\n${h.slice}\n`
  }
}

writeFileSync(new URL('./gold-unknown-js.txt', import.meta.url), out)
console.log('wrote', out.length)
