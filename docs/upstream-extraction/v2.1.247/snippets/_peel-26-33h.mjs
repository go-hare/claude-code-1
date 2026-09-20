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

// #27 helpers around I8o @ 215404809
const i8o = first(buf247, 'function I8o(')
dumpAt(
  'gold-C3n-before-I8o.txt',
  buf247,
  lastBefore(buf247, 'function C3n(', i8o),
  40,
  800,
  '247',
  'function C3n( lastBefore I8o',
)
dumpAt(
  'gold-_3n-before-I8o.txt',
  buf247,
  lastBefore(buf247, 'function _3n(', i8o),
  40,
  800,
  '247',
  'function _3n( lastBefore I8o',
)
dump('gold-function-C3n.txt', 'function C3n(', 40, 800)
dump('gold-function-_3n.txt', 'function _3n(', 40, 800)
dump('gold-function-Nm.txt', 'function Nm(', 40, 400)
dump('gold-var-TL.txt', 'var TL=', 40, 200)
dump('gold-I8o-block.txt', 'function I8o(e){if(!Nm())return', 200, 3500)
dump(
  'gold-EL-246.txt',
  'function sL(e,t,n=',
  80,
  2500,
  '246',
)

// #28 — preview helper in same module as xt
dump('gold-xt-call-body.txt', 'o(xt,{displayName', 400, 1200)
dump('gold-xt-call-body2.txt', ',body:', 80, 400)
dump('gold-function-ly-preview2.txt', 'function ly(e){let', 40, 800)
dump('gold-function-ly-replace.txt', 'function ly(e){return e.replace', 40, 800)
dump('gold-function-ly-slice.txt', 'function ly(e){return', 40, 600)
dump('gold-function-cy-display.txt', 'function cy(e){if(!e)', 40, 600)
dump('gold-function-cy-trim.txt', 'function cy(e){return', 40, 600)

// UserCrossSessionMessage caller — search near 231306649 for cross-session
dump('gold-cross-session-xt.txt', 'cross-session-message', 200, 2000)
dump('gold-UserCross-fn2.txt', 'function zf(', 40, 400)

// #30 PR badge — search JS function near persistPrStatusCache
dump('gold-persistPrStatus.txt', 'persistPrStatusCache', 1500, 2500)
dump('gold-loadPrStatus.txt', 'loadPrStatusCache', 800, 2000)
dump('gold-function-usePr.txt', 'function usePrStatus(', 80, 2500)
dump('gold-lastFetch.txt', 'lastFetch', 200, 1500)
dump('gold-refocus-pr.txt', 'refocus', 200, 1500)
dump('gold-focused-pr.txt', 'wasFocused', 200, 1500)
dump('gold-terminalFocused.txt', 'isTerminalFocused', 200, 2000)

// #31 analytics off from startup
dump('gold-isAnalyticsDisabled-js.txt', 'function hs(){', 40, 800)
dump('gold-analytics-startup.txt', 'analytics_disabled', 400, 2000)
dump(
  'gold-CUSTOM-OAUTH-fn.txt',
  'CLAUDE_CODE_CUSTOM_OAUTH_URL&&',
  400,
  1500,
)
dump('gold-forceLogin-analytics.txt', 'forceLoginMethod==="gateway"', 400, 1500)
dump('gold-forceLogin-analytics2.txt', 'forceLoginMethod==="gateway"', 400, 1500)
dump('gold-getSettings-force.txt', '?.forceLoginMethod', 400, 1500)

// #33 function body around policy_unreadable
dump(
  'gold-policy-unreadable-js.txt',
  'policy_unreadable_fail_close',
  2500,
  800,
)
dump(
  'gold-could-not-be-read-js.txt',
  'could not be read',
  200,
  800,
)
dump(
  'gold-admin-managed-unreadable.txt',
  'administrator',
  200,
  800,
)
