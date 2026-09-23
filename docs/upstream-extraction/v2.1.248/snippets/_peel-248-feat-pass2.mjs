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
    let i = Math.max(0, before - 8000)
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

function dumpHits(lines, label, needle, around = 80, cap = 10) {
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
    `# gold-248-feat-${feat}-pass2  ${title}`,
    `exe=${exe}`,
    `bytes=${buf.length}`,
    `when=${new Date().toISOString()}`,
    '',
  ]
}

function writeGold(name, lines) {
  const out = `${outDir}/${name}`
  writeFileSync(out, lines.join('\n'))
  console.log(`WROTE ${out} chars=${lines.join('\n').length}`)
}

// ── #1 unique fns ─────────────────────────────────────────────────────────
{
  const L = header(1, 'pass2 unique restricted fns')
  dumpHits(L, 'function D2n', 'function D2n(')
  dumpHits(L, 'function O2', 'function O2(')
  dumpHits(L, 'function Yk(', 'function Yk(')
  dumpHits(L, 'Yk as isRestrictedSession', 'Yk as isRestrictedSession')
  dumpHits(L, 'isRestrictedSession', 'isRestrictedSession')
  dumpHits(L, 'bypassPermissions not supported in restricted mode', 'bypassPermissions not supported in restricted mode')
  dumpHits(L, 'ignores user, project and local settings files', 'ignores user, project and local settings files')
  dumpHits(L, 'removes the built-in tools that run commands or code', 'removes the built-in tools that run commands or code')
  dumpHits(L, 'confines the file tools', 'confines the file tools')
  dumpHits(L, 'userSettings', 'restricted&&')
  dumpHits(L, 'settingSources restricted', 'restricted?["--restricted"]')
  dumpHits(L, 'function VUn', 'function VUn(')
  dumpHits(L, 'MMt=', 'var MMt=')

  for (const needle of [
    'function D2n(',
    'function O2(',
    'function VUn(',
    'bypassPermissions not supported in restricted mode',
  ]) {
    const hits = allHits(buf, needle)
    for (const [idx, i] of hits.slice(0, 3).entries()) {
      if (needle.startsWith('function ')) dumpFn(L, needle, i, 8000)
      else {
        dumpAround(L, needle, i, 200, 400)
        const near = lastFnStart(i, ['function D2n(', 'function Yk(', 'function O2('])
        if (near.i >= 0) dumpFn(L, `near ${needle}`, near.i, 8000)
      }
    }
  }

  // Yk defs that mention restricted
  const ykHits = allHits(buf, 'function Yk(')
  L.push(`## Yk defs mentioning restricted (${ykHits.length} total)`)
  let ykKept = 0
  for (const i of ykHits) {
    const win = asciiSlice(buf, i, i + 600)
    if (
      win.includes('restricted') ||
      win.includes('O2()') ||
      win.includes('CLAUDE_CODE_RESTRICTED')
    ) {
      dumpFn(L, `Yk-restricted @${i}`, i, 4000)
      ykKept++
      if (ykKept >= 6) break
    }
  }
  L.push(`ykKept=${ykKept}`)
  L.push('')

  // commander option dump around unique help
  const opt = buf.indexOf(
    Buffer.from(
      'Restricted mode: removes the built-in tools that run commands or code',
    ),
  )
  dumpAround(L, 'commander-restricted-help', opt, 200, 900)

  // settings ignore implementation
  dumpHits(L, 'managed settings and --settings still apply', 'managed settings and --settings still apply')
  const ign = buf.indexOf(
    Buffer.from('ignores user, project and local settings files'),
  )
  dumpAround(L, 'ignore-settings-codeish', ign, 80, 80)

  writeGold('gold-248-feat-1-pass2.txt', L)
}

// ── #2 mUt / Ivt / Pu ─────────────────────────────────────────────────────
{
  const L = header(2, 'pass2 cacheTtl mUt Ivt')
  dumpHits(L, 'function mUt', 'function mUt(')
  dumpHits(L, 'mUt(M)', 'mUt(M)')
  dumpHits(L, 'mUt(r)', 'mUt(r)')
  dumpHits(L, 'function Ivt', 'function Ivt(')
  dumpHits(L, 'agentCacheTtlOverride', 'agentCacheTtlOverride')
  dumpHits(L, 'subagentPromptCacheTtl', 'subagentPromptCacheTtl')
  dumpHits(L, 'Pu().optional().describe(\'Prompt cache TTL', "Pu().optional().describe('Prompt cache TTL")

  for (const needle of ['function mUt(', 'function Ivt(']) {
    const hits = allHits(buf, needle)
    for (const [idx, i] of hits.slice(0, 4).entries()) {
      dumpFn(L, `${needle}#${idx}`, i, 4000)
    }
  }
  const schema = buf.indexOf(Buffer.from('experimental:m({cacheTtl:'))
  dumpAround(L, 'agent-schema-experimental', schema, 200, 700)
  writeGold('gold-248-feat-2-pass2.txt', L)
}

// ── #3 register clientLabel ───────────────────────────────────────────────
{
  const L = header(3, 'pass2 clientLabel register')
  dumpHits(L, 't.clientLabel??', 't.clientLabel??')
  dumpHits(L, 'clientLabel??', 'clientLabel??')
  dumpHits(L, 'n.clientLabel=u', 'n.clientLabel=u')
  const reg = buf.indexOf(Buffer.from('t.clientLabel??'))
  dumpAround(L, 'register-clientLabel', reg, 200, 400)
  const near = lastFnStart(reg, ['async function ', 'function '])
  if (near.i >= 0) dumpFn(L, 'fn-register-clientLabel', near.i, 8000)
  writeGold('gold-248-feat-3-pass2.txt', L)
}

// ── #4 doctor/status UI ───────────────────────────────────────────────────
{
  const L = header(4, 'pass2 managed-settings diag UI')
  dumpHits(L, 'Remote managed settings failed to load (', 'Remote managed settings failed to load (')
  dumpHits(L, '/status for details', '/status for details')
  dumpHits(L, 'no remote policy applied', 'no remote policy applied')
  dumpHits(L, 'using cached policy', 'using cached policy')
  dumpHits(L, 'Managed settings (remote):', 'Managed settings (remote):')
  dumpHits(L, 'third_party_provider', 'third_party_provider')
  dumpHits(L, 'custom_base_url', 'custom_base_url')
  dumpHits(L, 'function oIn', 'function oIn(')
  dumpHits(L, 'function WTt', 'function WTt(')
  dumpHits(L, 'ineligible', 'state:"ineligible"')

  for (const needle of [
    'Remote managed settings failed to load (',
    'Managed settings (remote):',
    'function oIn(',
    'function WTt(',
    'function qgn(',
  ]) {
    const hits = allHits(buf, needle)
    for (const [idx, i] of hits.slice(0, 3).entries()) {
      dumpAround(L, `${needle}#${idx}`, i, 150, 500)
      if (needle.startsWith('function ')) dumpFn(L, needle, i, 6000)
      else {
        const near = lastFnStart(i, ['function ', 'async function '])
        if (near.i >= 0 && hits.length <= 6) dumpFn(L, `fn ${needle}#${idx}`, near.i, 6000)
      }
    }
  }
  writeGold('gold-248-feat-4-pass2.txt', L)
}

// ── #5 token scope check ──────────────────────────────────────────────────
{
  const L = header(5, 'pass2 web-setup workflow token check')
  dumpHits(L, 'doesn\'t have the workflow scope', "doesn't have the workflow scope")
  dumpHits(L, 'gh auth token', 'gh auth token')
  dumpHits(L, 'scopes.includes("workflow")', 'scopes.includes("workflow")')
  dumpHits(L, 'includes("workflow")', 'includes("workflow")')
  dumpHits(L, 'has_workflow', 'has_workflow')
  dumpHits(L, 'workflowScope', 'workflowScope')
  dumpHits(L, 'missingWorkflow', 'missingWorkflow')

  const warn = buf.indexOf(Buffer.from("doesn't have the workflow scope"))
  dumpAround(L, 'workflow-warn-code', warn, 400, 200)
  const near = lastFnStart(warn, ['async function ', 'function '])
  if (near.i >= 0) dumpFn(L, 'fn-workflow-check', near.i, 8000)
  writeGold('gold-248-feat-5-pass2.txt', L)
}

// ── #6 usage-credits enterprise billing ───────────────────────────────────
{
  const L = header(6, 'pass2 usage-credits enterprise billing')
  dumpHits(L, 'request more usage from your admin', 'request more usage from your admin')
  dumpHits(L, 'aws_marketplace', 'aws_marketplace')
  dumpHits(L, 'AWS_MARKETPLACE', 'AWS_MARKETPLACE')
  dumpHits(L, 'enterprise_trial', 'enterprise_trial')
  dumpHits(L, 'self_serve', 'self_serve')
  dumpHits(L, 'self-serve', 'self-serve')
  dumpHits(L, 'marketplace_billing', 'marketplace_billing')
  dumpHits(L, 'billing_type', 'billing_type')
  dumpHits(L, 'organization_type', 'organization_type')
  dumpHits(L, 'disabled_reason', 'disabled_reason')
  dumpHits(L, 'limit_increase', 'limit_increase')
  dumpHits(L, 'is_allowed', 'is_allowed')
  dumpHits(L, 'Enterprise organizations', 'Enterprise organizations')
  dumpHits(L, 'billed through', 'billed through')
  dumpHits(L, 'your admin for a higher limit', 'your admin for a higher limit')
  dumpHits(L, 'to request more usage from your admin', 'to request more usage from your admin')

  for (const needle of [
    'request more usage from your admin',
    'aws_marketplace',
    'enterprise_trial',
    'self_serve',
    'Enterprise organizations',
    'billed through',
  ]) {
    const hits = allHits(buf, needle)
    for (const [idx, i] of hits.slice(0, 4).entries()) {
      dumpAround(L, `${needle}#${idx}`, i, 200, 350)
      if (hits.length <= 8) {
        const near = lastFnStart(i, ['function ', 'async function '])
        if (near.i >= 0) dumpFn(L, `fn ${needle}#${idx}`, near.i, 4000)
      }
    }
  }
  writeGold('gold-248-feat-6-pass2.txt', L)
}

// ── #7 same-machine gate ──────────────────────────────────────────────────
{
  const L = header(7, 'pass2 same-machine SendMessage/ListAgents gate')
  dumpHits(L, 'function Po(', 'function Po(')
  dumpHits(L, 'tengu_harbor_kite', 'tengu_harbor_kite')
  dumpHits(L, '[uds-messaging] Skipped: cross-session messaging gate off', '[uds-messaging] Skipped: cross-session messaging gate off')
  dumpHits(L, 'Cross-session messaging is not available in this session', 'Cross-session messaging is not available in this session')
  dumpHits(L, 'function Ye()', 'function Ye()')
  dumpHits(L, 'Le()==="firstParty"', 'Le()==="firstParty"')
  dumpHits(L, 'Messages to sessions on this machine still work', 'Messages to sessions on this machine still work')
  dumpHits(L, 'UDS_INBOX', 'UDS_INBOX')
  dumpHits(L, 'isEnabled(){return true}', 'isEnabled(){return!0}')

  for (const needle of [
    'function Po(',
    '[uds-messaging] Skipped: cross-session messaging gate off',
    'function Ye()',
    'Messages to sessions on this machine still work',
  ]) {
    const hits = allHits(buf, needle)
    for (const [idx, i] of hits.slice(0, 4).entries()) {
      dumpAround(L, `${needle}#${idx}`, i, 150, 400)
      if (needle.startsWith('function ')) dumpFn(L, needle, i, 4000)
      else {
        const near = lastFnStart(i, ['function ', 'async function '])
        if (near.i >= 0 && hits.length <= 6) dumpFn(L, `fn ${needle}#${idx}`, near.i, 5000)
      }
    }
  }
  writeGold('gold-248-feat-7-pass2.txt', L)
}

console.log('PASS2 DONE')
