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

// #31 — helpers in the hu/Gd module @ 208503657
const hu = first(buf247, 'function hu(){return DP()')
dumpAt('gold-hu-module.txt', buf247, hu, 2500, 800, '247', 'hu module')
dump('gold-function-ie-near.txt', 'function ie(){return', 40, 400)
dump('gold-isFirstParty.txt', 'function ie(){return!', 40, 400)
dump('gold-isTelemetry.txt', 'function Zi(){return', 40, 400)

// Search last-before hu for the actual helpers
for (const [name, needle] of [
  ['ie-before-hu', 'function ie(){'],
  ['Zi-before-hu', 'function Zi(){'],
  ['Pt-before-hu', 'function Pt(){'],
  ['Bt-before-hu', 'function Bt(){'],
  ['Io-before-hu', 'function Io('],
  ['Un-before-hu', 'function Un(){'],
]) {
  dumpAt(
    `gold-${name}.txt`,
    buf247,
    lastBefore(buf247, needle, hu),
    40,
    500,
    '247',
    needle + ' lastBefore hu',
  )
}

// #30 — poller class + Vut + focus
dump('gold-Vut.txt', 'var Vut=', 40, 200)
dump('gold-Vut2.txt', 'Vut=6e4', 40, 200)
dump('gold-Vut3.txt', 'Vut=60000', 40, 200)
dump('gold-class-y6.txt', 'class y6{', 80, 2500)
dump('gold-setInputs-pr.txt', 'setInputs({isLoading', 400, 1500)
dump('gold-focused-pr-js.txt', 'this.#t.focused', 400, 1500)
dump('gold-gm-focus.txt', 'function gm(){', 40, 400)

// #33 — start of validateForceLoginOrg
dump(
  'gold-validateForceLoginOrg-js.txt',
  'unix_socket_unreadable_policy',
  2500,
  2500,
)
dump(
  'gold-validateForceLoginOrg-246.txt',
  'unix_socket_unreadable_policy',
  2500,
  2500,
  '246',
)
dump('gold-function-pm.txt', 'function pm(){', 40, 600)
dump('gold-Bt-errors.txt', 'function Bt(){return', 40, 400)
dump('gold-_m-errors.txt', 'function _m(){', 40, 400)

// #27 TL + u3n
dump('gold-u3n.txt', 'function u3n(){', 40, 400)
dump('gold-TL-near-EL.txt', 'o<1e6&&(M8o.has', 200, 200)
dump('gold-var-TL-near.txt', 'var TL=', 40, 80)

// #28 ly/cy in xt module — dump 8k before xt
const xt = first(buf247, 'function xt(ote){let Va=R(18)')
dumpAt('gold-before-xt-8k.txt', buf247, xt, 8000, 100, '247', '8k before xt')
dump('gold-function-cy-name.txt', 'function cy(e){', 40, 400)
dump('gold-function-ly-ws.txt', 'function ly(e){return e.split', 40, 400)
dump('gold-function-ly-trim.txt', 'function ly(e){e=e.trim', 40, 400)
dump('gold-cross-session-xt-call.txt', 'o(xt,{displayName:', 400, 800)
