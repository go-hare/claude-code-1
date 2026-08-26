import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

function findAll(needle, from = 0, max = 8) {
  const hits = []
  let i = from
  const n = Buffer.from(needle)
  while (hits.length < max) {
    i = buf.indexOf(n, i)
    if (i < 0) break
    hits.push(i)
    i += n.length
  }
  return hits
}

function dump(label, i, before = 80, after = 700) {
  if (i < 0) return `\n==== ${label} MISS ====\n`
  return (
    `\n==== ${label} ${i} ====\n` +
    printable(buf.slice(Math.max(0, i - before), i + after).toString('utf8')) +
    '\n'
  )
}

let out = ''

out += dump('function xZv', buf.indexOf(Buffer.from('function xZv('), 306_900_000))
out += dump('p=()=>e.rateLimitType', buf.indexOf(Buffer.from('p=()=>e.rateLimitType'), 306_900_000))
out += dump('function VH(', buf.indexOf(Buffer.from('function VH('), 300_000_000))
out += dump('function Wgt(', buf.indexOf(Buffer.from('function Wgt('), 300_000_000))
out += dump('function cSe(', buf.indexOf(Buffer.from('function cSe('), 300_000_000))

const needles = [
  'Strip leading ./',
  'leading ./',
  'keep the ./',
  'startsWith("./")&&',
  'e.startsWith("./")',
  'dirPortion.startsWith("./")',
  'replace(/^\\.\\//',
  'slice(2)',
  'UTF-8 BOM',
  'utf8 BOM',
  'stripBom',
  'feff',
  'FEFF',
  '\\uFEFF',
  'parseFrontmatter',
  'frontmatter',
  'voiceEnabled',
  'voice.enabled',
  'VoiceModeNotice',
  'sanitizeSessionTitle',
  'no agent named',
  'own name',
  'ListAgents',
  'CLAUDE_CODE_RETRY_WATCHDOG',
  'out-of-credits',
  'out_of_credits',
  'spend-limit',
  'spend_limit',
  'application/vnd.amazon.eventstream',
  'Working directory "',
  'no longer exists. Please restart',
  'Please restart Claude from an existing directory',
  'HTTPS_PROXY',
  'fromNodeProviderChain',
  'getAwsSdkProxyRequestHandler',
]

for (const kw of needles) {
  const hits = findAll(kw)
  out += `\n#### needle ${JSON.stringify(kw)} hits=${hits.length} ${hits.slice(0, 5).join(',')}\n`
  if (hits[0] !== undefined) out += dump(kw, hits[0], 40, 500)
}

writeFileSync(new URL('./gold-unknown-round2.txt', import.meta.url), out)
console.log('wrote', out.length)
