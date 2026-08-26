import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

function dumpJs(kw, before = 250, after = 800, max = 6) {
  const b = Buffer.from(kw)
  const hits = []
  let i = -1
  while ((i = buf.indexOf(b, i + 1)) !== -1 && hits.length < max) {
    // Prefer bundled JS (high offset)
    if (i < 280_000_000) continue
    hits.push({
      i,
      slice: printable(buf.slice(i - before, i + after).toString('utf8')),
    })
  }
  if (hits.length === 0) {
    i = -1
    while ((i = buf.indexOf(b, i + 1)) !== -1 && hits.length < 2) {
      hits.push({
        i,
        slice: printable(
          buf.slice(Math.max(0, i - before), i + after).toString('utf8'),
        ),
      })
    }
  }
  return hits
}

const keys = [
  'monthly spend limit',
  'budgetExhaustedCopy',
  'session limit resets',
  'also says',
  'formatLimitReached',
  'stripBOM',
  'stripBom',
  '\\uFEFF',
  'startsWith("/")',
  'startsWith(`/`)',
  'You are ',
  'this session',
  'your own name',
  'messaging yourself',
  'vnd.amazon.eventstream',
  'content-type',
  'getAwsSdkProxy',
  'HTTPS_PROXY',
  'Zle.has',
  'spend_limit',
  'org_spend',
  'pluginRoot',
  '**/*',
  'worktreeinclude',
  'ENOENT',
  'cwd was deleted',
  'project root or home',
  'literal `',
  'insights',
]

let out = ''
for (const kw of keys) {
  const hits = dumpJs(kw)
  out += `\n######## ${JSON.stringify(kw)} n=${hits.length} ########\n`
  for (const h of hits) {
    out += `\n--- @${h.i} ---\n${h.slice}\n`
  }
}
writeFileSync(new URL('./gold-unknown-js2.txt', import.meta.url), out)
console.log('wrote', out.length)
