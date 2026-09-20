import { readFileSync, writeFileSync } from 'fs'

const buf247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const buf246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)

function asciiWindow(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function first(buf, needle) {
  return buf.indexOf(Buffer.from(needle))
}

function lastBefore(buf, needle, before) {
  const n = Buffer.from(needle)
  let found = -1
  let from = 0
  while (from < before) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i >= before) break
    found = i
    from = i + 1
  }
  return found
}

function dumpAt(name, buf, i, before, after, which, needle) {
  if (i < 0) {
    console.log('MISS', name, which, JSON.stringify(needle))
    return
  }
  const s = asciiWindow(buf, Math.max(0, i - before), i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# ${which} offset=${i} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', name, which, i)
}

function dump(name, needle, before, after, which = '247') {
  const buf = which === '247' ? buf247 : buf246
  dumpAt(name, buf, first(buf, needle), before, after, which, needle)
}

// #27 — Nq/EL/CL/xWe around y3n
dump('gold-function-EL.txt', 'function EL(', 80, 2500)
dump('gold-function-Nq.txt', 'function Nq(', 80, 2500)
dump('gold-function-CL.txt', 'function CL(', 80, 1500)
dump('gold-function-VRt.txt', 'function VRt(', 80, 800)
dump('gold-function-I8o.txt', 'function I8o(', 80, 2000)
dump('gold-function-xWe.txt', 'function xWe(', 80, 800)
dump('gold-tengu-amber.txt', 'tengu_amber_moleskin', 400, 2000)

// #28 — ly/cy immediately before xt
const xt = first(buf247, 'function xt(ote){let Va=R(18)')
dumpAt(
  'gold-ly-before-xt.txt',
  buf247,
  lastBefore(buf247, 'function ly(', xt),
  40,
  1200,
  '247',
  'function ly( lastBefore xt',
)
dumpAt(
  'gold-cy-before-xt.txt',
  buf247,
  lastBefore(buf247, 'function cy(', xt),
  40,
  800,
  '247',
  'function cy( lastBefore xt',
)
dump('gold-xt-call.txt', 'o(xt,{', 400, 800)
dump('gold-xt-call2.txt', 'xt({displayName', 400, 800)
dump('gold-xt-call3.txt', 'displayName:hE', 200, 800)

// #30
dump('gold-fetchPrStatus-fn.txt', 'function fetchPrStatus', 80, 2000)
dump('gold-ghPrStatus.txt', 'ghPrStatus', 200, 1500)
dump('gold-PR-badge.txt', 'reviewState', 200, 1500)
dump('gold-terminal-focus-pr.txt', 'terminalFocus', 200, 1500)
dump('gold-onFocusChange-pr.txt', 'onFocusChange', 200, 2000)
dump('gold-last-check-min.txt', '60000', 80, 200)

// #31
dump('gold-analyticsDisabled-fn.txt', 'analyticsDisabled', 200, 1500)
dump('gold-CUSTOM-OAUTH-analytics.txt', 'CLAUDE_CODE_CUSTOM_OAUTH_URL', 200, 2000)
dump('gold-force-gateway-analytics.txt', 'forceLoginMethod', 200, 1500)
dump('gold-hs-analytics.txt', 'function hs(', 80, 1500)

// #33
dump('gold-policy-unreadable-fn.txt', 'policy_unreadable_fail_close', 800, 2500)
dump(
  'gold-unable-read-managed.txt',
  'Unable to read managed policy settings.',
  1500,
  2000,
)
dump('gold-failIfHost-fn.txt', 'function failIfHost', 80, 2000)
dump('gold-host-supplied.txt', 'host-supplied', 200, 1500)
dump('gold-HKCU-org.txt', 'HKCU', 200, 1500)
