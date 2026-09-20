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

const i8o = first(buf247, 'function I8o(e){if(!Nm())return')
dumpAt(
  'gold-Nm-before-I8o.txt',
  buf247,
  lastBefore(buf247, 'function Nm(', i8o),
  40,
  600,
  '247',
  'function Nm( lastBefore I8o',
)
dump('gold-function-Nm2.txt', 'function Nm(){', 40, 400)
dump('gold-var-TL-500.txt', 'var TL=500000', 40, 200)
dump('gold-TL-const.txt', ',TL=500000', 40, 200)

// #28 preview + caller
dump('gold-xt-body-prop.txt', 'body:ry', 400, 800)
dump('gold-xt-body-prop2.txt', ',body:', 80, 400)
dump('gold-UserCross-call-xt.txt', 'o(xt,{displayName', 800, 1500)
dump('gold-fallback-peer.txt', 'fallbackLabel:"peer"', 400, 800)
dump('gold-fallback-teammate.txt', 'fallbackLabel:"teammate"', 400, 800)

// ly in same module as xt — search near 231300179
const xt = first(buf247, 'function xt(ote){let Va=R(18)')
for (const needle of [
  'function ly(e){',
  'function ly(ry)',
  'function ly(t){',
  'ly=e=>',
]) {
  dumpAt(
    `gold-ly-scan-${needle.replace(/[^a-z]/g, '')}.txt`,
    buf247,
    lastBefore(buf247, needle, xt),
    40,
    800,
    '247',
    needle + ' lastBefore xt',
  )
}

// #31 helpers
dump('gold-function-Gd.txt', 'function Gd(){return Io(Un())', 80, 400)
dump('gold-function-sy.txt', 'function sy(){return Gd()', 80, 400)
dump('gold-function-IP.txt', 'function IP(){return c.CLAUDE_CODE_CUSTOM_OAUTH_URL', 80, 400)
dump('gold-function-hu.txt', 'function hu(){return DP()', 80, 600)
dump('gold-function-ie.txt', 'function ie(){', 40, 400)
dump('gold-function-Zi.txt', 'function Zi(){', 40, 400)
dump('gold-function-Pt.txt', 'function Pt(){', 40, 400)
dump('gold-function-Bt.txt', 'function Bt(){', 40, 400)
dump('gold-function-Io.txt', 'function Io(e){', 40, 400)
dump('gold-function-Un.txt', 'function Un(){', 40, 400)
dump(
  'gold-hu-246.txt',
  'function hu(){return',
  80,
  400,
  '246',
)

// #30 fetchPrStatus JS
dump('gold-await-fetchPr.txt', 'await $t()', 80, 200)
dump('gold-fetchPrStatus-js.txt', 'fetchPrStatus()', 400, 2000)
dump('gold-prStatusFooter.txt', 'prStatusFooterEnabled', 400, 2000)
dump('gold-subscribeFocus-js.txt', 'subscribeTerminalFocus(', 400, 2000)

// #33 JS
dump(
  'gold-policy-unreadable-code.txt',
  'return{valid:!1,reason:"policy_unreadable_fail_close"',
  2000,
  1500,
)
dump(
  'gold-policy-unreadable-code2.txt',
  'reason:"policy_unreadable_fail_close"',
  2000,
  1500,
)
dump(
  'gold-could-not-be-read-code.txt',
  'could not be read")',
  800,
  1500,
)
