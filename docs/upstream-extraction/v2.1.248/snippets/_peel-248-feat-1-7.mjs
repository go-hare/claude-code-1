import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
mkdirSync(outDir, { recursive: true })
const exe =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const buf = readFileSync(exe)

function asciiSlice(src, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(src.length, end)
  for (let j = a; j < b; j++) {
    const c = src[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function allHits(src, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (i < src.length) {
    const k = src.indexOf(n, i)
    if (k < 0) break
    hits.push(k)
    i = k + n.length
  }
  return hits
}

function extractFnAt(src, i, maxLen = 8000) {
  if (i < 0) return { miss: true }
  const win = asciiSlice(src, i, i + maxLen)
  const paren = win.indexOf('(')
  if (paren < 0) return { i, missEnd: true }
  let depth = 0
  let inStr = null
  let esc = false
  let closeParen = -1
  for (let p = paren; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) {
        closeParen = p
        break
      }
    }
  }
  if (closeParen < 0) return { i, missEnd: true, preview: win.slice(0, 220) }
  const bodyStart = win.indexOf('{', closeParen)
  if (bodyStart < 0) return { i, missEnd: true, preview: win.slice(0, 220) }
  depth = 0
  inStr = null
  esc = false
  for (let p = bodyStart; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const body = win.slice(0, p + 1)
        return { i, body, sha: sha(body), len: body.length }
      }
    }
  }
  return { i, missEnd: true, preview: win.slice(0, 280) }
}

function lastFnStart(before, names) {
  let best = -1
  let name = ''
  for (const n of names) {
    const needle = Buffer.from(n)
    let i = Math.max(0, before - 4000)
    while (i < before) {
      const k = buf.indexOf(needle, i)
      if (k < 0 || k >= before) break
      if (k > best) {
        best = k
        name = n
      }
      i = k + needle.length
    }
  }
  return { i: best, name }
}

function dumpHits(lines, label, needle, around = 80, cap = 12) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label}  needle=${JSON.stringify(needle)}  hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(buf, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

function dumpFn(lines, label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpAround(lines, label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function header(feat, title) {
  return [
    `# gold-248-feat-${feat}  ${title}`,
    `exe=${exe}`,
    `bytes=${buf.length}`,
    `when=${new Date().toISOString()}`,
    '',
  ]
}

function writeGold(feat, lines) {
  const out = `${outDir}/gold-248-feat-${feat}.txt`
  writeFileSync(out, lines.join('\n'))
  console.log(`WROTE ${out} chars=${lines.join('\n').length}`)
}

// ── #1 --restricted / CLAUDE_CODE_RESTRICTED ──────────────────────────────
{
  const L = header(1, '--restricted / CLAUDE_CODE_RESTRICTED')
  const n1 = dumpHits(L, '#1 --restricted', '--restricted')
  dumpHits(L, '#1 CLAUDE_CODE_RESTRICTED', 'CLAUDE_CODE_RESTRICTED')
  dumpHits(L, '#1 option --restricted', 'option("--restricted')
  dumpHits(L, '#1 option --restricted sq', "option('--restricted")
  dumpHits(L, '#1 .option(--restricted', '.option("--restricted')
  dumpHits(L, '#1 restricted=1', 'CLAUDE_CODE_RESTRICTED=1')
  dumpHits(L, '#1 process.env.CLAUDE_CODE_RESTRICTED', 'process.env.CLAUDE_CODE_RESTRICTED')
  dumpHits(L, '#1 ignores user, project', 'ignores user, project')
  dumpHits(L, '#1 user, project and local', 'user, project and local')
  dumpHits(L, '#1 refuse bypassPermissions', 'bypassPermissions')
  dumpHits(L, '#1 restricted mode', 'restricted mode')
  dumpHits(L, '#1 Restricted mode', 'Restricted mode')
  dumpHits(L, '#1 --restricted ', '--restricted ')
  dumpHits(L, '#1 restricted launch', 'restricted launch')
  dumpHits(L, '#1 isRestricted', 'isRestricted')
  dumpHits(L, '#1 setForkRestrictedLaunchConfig', 'setForkRestrictedLaunchConfig')
  dumpHits(L, '#1 forkRestrictedLaunchConfig', 'forkRestrictedLaunchConfig')

  const uniqueNeedles = [
    '--restricted',
    'CLAUDE_CODE_RESTRICTED',
    'CLAUDE_CODE_RESTRICTED=1',
  ]
  for (const needle of uniqueNeedles) {
    const hits = allHits(buf, needle)
    for (const [idx, i] of hits.slice(0, 6).entries()) {
      dumpAround(L, `#1 win ${needle}#${idx}`, i, 200, 400)
      const near = lastFnStart(i, [
        'function ',
        'async function ',
        'function*',
      ])
      if (near.i >= 0) {
        L.push(`### lastFnStart before ${needle}#${idx} name=${near.name} @${near.i}`)
        dumpFn(L, `#1 fn-before ${needle}#${idx}`, near.i, 8000)
      }
    }
  }
  writeGold(1, L)
  console.log('#1 --restricted hits', n1.length)
}

// ── #2 experimental.cacheTtl ──────────────────────────────────────────────
{
  const L = header(2, 'experimental.cacheTtl agent frontmatter')
  dumpHits(L, '#2 experimental.cacheTtl', 'experimental.cacheTtl')
  dumpHits(L, '#2 experimental:{cacheTtl', 'experimental:{cacheTtl')
  dumpHits(L, '#2 "cacheTtl"', '"cacheTtl"')
  dumpHits(L, '#2 cacheTtl:', 'cacheTtl:')
  dumpHits(L, '#2 cacheTtl', 'cacheTtl')
  dumpHits(L, '#2 experimental:', 'experimental:')
  dumpHits(L, '#2 "5m"|"1h" cache', 'cacheTtl:"5m"')
  dumpHits(L, '#2 cacheTtl:"1h"', 'cacheTtl:"1h"')
  dumpHits(L, '#2 prompt cache TTL', 'prompt cache TTL')
  dumpHits(L, '#2 per-agent prompt cache', 'per-agent prompt cache')
  dumpHits(L, '#2 subagent TTL', 'subagent TTL')
  dumpHits(L, '#2 experimental.cache', 'experimental.cache')

  const hits = allHits(buf, 'experimental.cacheTtl')
  const cacheTtlHits = allHits(buf, 'cacheTtl')
  L.push(`## cacheTtl total hits=${cacheTtlHits.length}`)
  L.push('')
  for (const [idx, i] of hits.slice(0, 8).entries()) {
    dumpAround(L, `#2 experimental.cacheTtl#${idx}`, i, 300, 500)
    const near = lastFnStart(i, ['function ', 'async function '])
    if (near.i >= 0) dumpFn(L, `#2 fn-before cacheTtl#${idx}`, near.i, 8000)
  }
  // also extract around unique "cacheTtl:" if experimental.cacheTtl missing
  if (hits.length === 0) {
    const colon = allHits(buf, 'cacheTtl:')
    for (const [idx, i] of colon.slice(0, 8).entries()) {
      dumpAround(L, `#2 cacheTtl:#${idx}`, i, 250, 400)
      const near = lastFnStart(i, ['function ', 'async function '])
      if (near.i >= 0) dumpFn(L, `#2 fn-before cacheTtl:#${idx}`, near.i, 8000)
    }
  }
  writeGold(2, L)
}

// ── #3 --client-label ─────────────────────────────────────────────────────
{
  const L = header(3, 'self-hosted-runner --client-label')
  dumpHits(L, '#3 --client-label', '--client-label')
  dumpHits(L, '#3 SELF_HOSTED_RUNNER_CLIENT_LABEL', 'SELF_HOSTED_RUNNER_CLIENT_LABEL')
  dumpHits(L, '#3 client-label', 'client-label')
  dumpHits(L, '#3 client_label', 'client_label')
  dumpHits(L, '#3 clientLabel', 'clientLabel')
  dumpHits(L, '#3 override the label', 'override the label')
  dumpHits(L, '#3 registers with', 'registers with')

  for (const needle of ['--client-label', 'SELF_HOSTED_RUNNER_CLIENT_LABEL']) {
    const hits = allHits(buf, needle)
    for (const [idx, i] of hits.slice(0, 6).entries()) {
      dumpAround(L, `#3 win ${needle}#${idx}`, i, 250, 500)
      const near = lastFnStart(i, ['function ', 'async function '])
      if (near.i >= 0) dumpFn(L, `#3 fn-before ${needle}#${idx}`, near.i, 8000)
    }
  }
  writeGold(3, L)
}

// ── #4 managed-settings load-fail diagnostics ─────────────────────────────
{
  const L = header(4, 'managed-settings load-fail startup + /doctor /status')
  dumpHits(L, '#4 managed settings failed', 'managed settings failed')
  dumpHits(L, '#4 Failed to load managed', 'Failed to load managed')
  dumpHits(L, '#4 failed to load managed', 'failed to load managed')
  dumpHits(L, '#4 could not load managed', 'could not load managed')
  dumpHits(L, '#4 Couldn\'t load managed', "Couldn't load managed")
  dumpHits(L, '#4 weren\'t fetched', "weren't fetched")
  dumpHits(L, '#4 were not fetched', 'were not fetched')
  dumpHits(L, '#4 third-party provider', 'third-party provider')
  dumpHits(L, '#4 third party provider', 'third party provider')
  dumpHits(L, '#4 custom ANTHROPIC_BASE_URL', 'custom ANTHROPIC_BASE_URL')
  dumpHits(L, '#4 ANTHROPIC_BASE_URL', 'ANTHROPIC_BASE_URL')
  dumpHits(L, '#4 managed settings', 'managed settings')
  dumpHits(L, '#4 Remote settings:', 'Remote settings:')
  dumpHits(L, '#4 Remote managed settings', 'Remote managed settings')
  dumpHits(L, '#4 server-managed settings', 'server-managed settings')
  dumpHits(L, '#4 Server-managed', 'Server-managed')
  dumpHits(L, '#4 why they weren', "why they weren")
  dumpHits(L, '#4 Bedrock/Vertex', 'Bedrock/Vertex')
  dumpHits(L, '#4 settings fail to load', 'settings fail to load')
  dumpHits(L, '#4 settings failed to load', 'settings failed to load')
  dumpHits(L, '#4 load failure', 'load failure')
  dumpHits(L, '#4 Managed settings', 'Managed settings')

  const unique = [
    'Failed to load managed',
    'failed to load managed',
    "weren't fetched",
    'were not fetched',
    'custom ANTHROPIC_BASE_URL',
    'third-party provider',
    'settings failed to load',
    'settings fail to load',
    'Server-managed',
    'server-managed settings',
  ]
  for (const needle of unique) {
    const hits = allHits(buf, needle)
    for (const [idx, i] of hits.slice(0, 4).entries()) {
      dumpAround(L, `#4 win ${needle}#${idx}`, i, 250, 450)
      const near = lastFnStart(i, ['function ', 'async function '])
      if (near.i >= 0 && hits.length <= 8) {
        dumpFn(L, `#4 fn-before ${needle}#${idx}`, near.i, 8000)
      }
    }
  }
  writeGold(4, L)
}

// ── #5 /web-setup workflow scope ──────────────────────────────────────────
{
  const L = header(5, '/web-setup workflow scope warning')
  dumpHits(L, '#5 workflow scope', 'workflow scope')
  dumpHits(L, '#5 lacks the workflow', 'lacks the workflow')
  dumpHits(L, '#5 missing workflow', 'missing workflow')
  dumpHits(L, '#5 Token scopes', 'Token scopes')
  dumpHits(L, '#5 very large repositories', 'very large repositories')
  dumpHits(L, '#5 very large repository', 'very large repository')
  dumpHits(L, '#5 /web-setup', '/web-setup')
  dumpHits(L, '#5 web-setup', 'web-setup')
  dumpHits(L, '#5 gh auth refresh', 'gh auth refresh')
  dumpHits(L, '#5 -s repo,workflow', '-s repo,workflow')
  dumpHits(L, '#5 -s workflow', '-s workflow')
  dumpHits(L, '#5 scopes: workflow', 'scopes: workflow')
  dumpHits(L, '#5 "workflow"', '"workflow"')
  dumpHits(L, '#5 lacks the', 'lacks the')

  for (const needle of [
    'workflow scope',
    'lacks the workflow',
    'very large repositories',
    'very large repository',
    '-s repo,workflow',
  ]) {
    const hits = allHits(buf, needle)
    for (const [idx, i] of hits.slice(0, 6).entries()) {
      dumpAround(L, `#5 win ${needle}#${idx}`, i, 250, 450)
      const near = lastFnStart(i, ['function ', 'async function '])
      if (near.i >= 0) dumpFn(L, `#5 fn-before ${needle}#${idx}`, near.i, 8000)
    }
  }
  writeGold(5, L)
}

// ── #6 /usage-credits Enterprise Marketplace / self-serve / trial ─────────
{
  const L = header(6, '/usage-credits Enterprise AWS Marketplace / self-serve / trial')
  dumpHits(L, '#6 AWS Marketplace', 'AWS Marketplace')
  dumpHits(L, '#6 billed through AWS', 'billed through AWS')
  dumpHits(L, '#6 self-serve Enterprise', 'self-serve Enterprise')
  dumpHits(L, '#6 self-serve', 'self-serve')
  dumpHits(L, '#6 Enterprise trial', 'Enterprise trial')
  dumpHits(L, '#6 enterprise trial', 'enterprise trial')
  dumpHits(L, '#6 /usage-credits', '/usage-credits')
  dumpHits(L, '#6 usage-credits', 'usage-credits')
  dumpHits(L, '#6 ask your admin', 'ask your admin')
  dumpHits(L, '#6 request a higher usage', 'request a higher usage')
  dumpHits(L, '#6 higher usage limit', 'higher usage limit')
  dumpHits(L, '#6 ask their admin', 'ask their admin')
  dumpHits(L, '#6 from their admin', 'from their admin')
  dumpHits(L, '#6 marketplace', 'marketplace')

  for (const needle of [
    'AWS Marketplace',
    'billed through AWS',
    'self-serve Enterprise',
    'Enterprise trial',
    'request a higher usage',
    'higher usage limit',
  ]) {
    const hits = allHits(buf, needle)
    for (const [idx, i] of hits.slice(0, 6).entries()) {
      dumpAround(L, `#6 win ${needle}#${idx}`, i, 250, 450)
      const near = lastFnStart(i, ['function ', 'async function '])
      if (near.i >= 0 && hits.length <= 10) {
        dumpFn(L, `#6 fn-before ${needle}#${idx}`, near.i, 8000)
      }
    }
  }
  writeGold(6, L)
}

// ── #7 SendMessage/ListAgents 3P + telemetry disabled ─────────────────────
{
  const L = header(7, 'SendMessage/ListAgents Bedrock/Vertex/Foundry + telemetry off')
  dumpHits(L, '#7 SendMessage', 'SendMessage')
  dumpHits(L, '#7 ListAgents', 'ListAgents')
  dumpHits(L, '#7 Cross-session messaging', 'Cross-session messaging')
  dumpHits(L, '#7 cross-session messaging', 'cross-session messaging')
  dumpHits(L, '#7 telemetry is disabled', 'telemetry is disabled')
  dumpHits(L, '#7 telemetry disabled', 'telemetry disabled')
  dumpHits(L, '#7 when telemetry', 'when telemetry')
  dumpHits(L, '#7 same machine', 'same machine')
  dumpHits(L, '#7 on the same machine', 'on the same machine')
  dumpHits(L, '#7 Cross-machine messaging is unavailable', 'Cross-machine messaging is unavailable')
  dumpHits(L, '#7 third-party provider or with nonessential', 'third-party provider or with nonessential')
  dumpHits(L, '#7 Bedrock, Vertex, and Foundry', 'Bedrock, Vertex, and Foundry')
  dumpHits(L, '#7 Bedrock, Vertex', 'Bedrock, Vertex')
  dumpHits(L, '#7 isEssentialTrafficOnly', 'isEssentialTrafficOnly')
  dumpHits(L, '#7 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')
  dumpHits(L, '#7 DISABLE_TELEMETRY', 'DISABLE_TELEMETRY')

  for (const needle of [
    'telemetry is disabled',
    'telemetry disabled',
    'on the same machine',
    'Bedrock, Vertex, and Foundry',
    'Cross-session messaging',
    'cross-session messaging',
    'Cross-machine messaging is unavailable',
  ]) {
    const hits = allHits(buf, needle)
    for (const [idx, i] of hits.slice(0, 6).entries()) {
      dumpAround(L, `#7 win ${needle}#${idx}`, i, 250, 450)
      const near = lastFnStart(i, ['function ', 'async function '])
      if (near.i >= 0 && hits.length <= 12) {
        dumpFn(L, `#7 fn-before ${needle}#${idx}`, near.i, 8000)
      }
    }
  }
  writeGold(7, L)
}

console.log('DONE bytes', buf.length)
