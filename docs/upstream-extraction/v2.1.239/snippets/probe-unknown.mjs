import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

function hits(kw, max = 6) {
  const b = Buffer.from(kw)
  const out = []
  let i = -1
  while ((i = buf.indexOf(b, i + 1)) !== -1 && out.length < max) out.push(i)
  return out
}

function slice(i, before, after) {
  return printable(buf.slice(Math.max(0, i - before), i + after).toString('utf8'))
}

const needles = [
  'US-only-inference',
  'us_only_inference',
  'usOnlyInference',
  'data-residency',
  'dataResidency',
  'residencyPremium',
  'inference_geo',
  'fullscreenOffer',
  'tuiOffer',
  'three launches',
  'fullscreenRendererShown',
  'session or weekly',
  'session limit resets',
  'weekly limit resets',
  'monthly spend limit',
  'application/vnd.amazon.eventstream',
  'awsAuthRefresh',
  'Please restart Claude from an existing directory',
  'starting directory',
  'removed worktree',
  'UTF-8 BOM',
  'stripBom',
  'pluginRoot',
  '35;150;7M',
  'voice.enabled',
  'posix_spawn',
  '(untitled)',
  'no agent named',
  'organization policy',
  'truncateMiddle',
  'CLAUDE_CODE_RETRY_WATCHDOG',
  'out-of-credits',
  'config.worktree',
  'worktreeConfig',
  'own name',
  'your own name',
  'this session is named',
  'You are ',
  '.worktreeinclude',
  'keep-alives',
  'PreToolUse',
  'selection:copy',
]

const counts = needles.map(kw => {
  const h = hits(kw, 3)
  return { kw, n: h.length, first: h[0] ?? null }
})

writeFileSync(
  new URL('./probe-unknown-counts.txt', import.meta.url),
  counts.map(c => `${String(c.n).padStart(3)} ${c.first ?? '-'} ${JSON.stringify(c.kw)}`).join('\n'),
)
console.log(counts.filter(c => c.n > 0).length, '/', counts.length, 'hit')
