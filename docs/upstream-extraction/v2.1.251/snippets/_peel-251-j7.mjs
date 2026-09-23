/**
 * Pass 7: ce(s,RP) truncator; D6e clean start; write gold-251-j.md
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  EXE_251,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()
if (buf.length !== 217360032) throw new Error(`SEA ${buf.length}`)

function grow(i, max = 40000) {
  for (const cap of [1500, 4000, 12000, max]) {
    const ex = extractFnAt(buf, i, cap)
    if (ex.body) return { ...ex, at: i }
  }
  return { ...extractFnAt(buf, i, max), at: i }
}

function at(name, i, max = 40000) {
  const ex = grow(i, max)
  if (!ex.body) throw new Error(`MISS ${name} @${i}`)
  return { ...ex, name, at: i }
}

function classAt(name, i, max = 20000) {
  const win = asciiSlice(buf, i, i + max)
  const brace = win.indexOf('{')
  let depth = 0
  let inStr = null
  let esc = false
  for (let p = brace; p < win.length; p++) {
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
        return { name, at: i, body, len: body.length, sha: sha(body) }
      }
    }
  }
  throw new Error(`class missEnd ${name}`)
}

function fence(s) {
  let n = 3
  while (s.includes('`'.repeat(n))) n++
  const t = '`'.repeat(n)
  return `${t}\n${s}\n${t}`
}

function render(row, extra = '') {
  return [
    `### \`${row.name}\` — BODY`,
    '',
    `- offset=${row.at} len=${row.len} sha=${row.sha}${extra ? ` ${extra}` : ''}`,
    '',
    fence(row.body),
    '',
  ].join('\n')
}

const ceBest = { ...at('ce', 178836688), d: Math.abs(178836688 - 181659488) }
console.log('ce utf16-cap', ceBest.at, ceBest.len, ceBest.sha, ceBest.body)

const D6eHits = allHits(buf, 'function D6e(')
console.log(
  'D6e decls',
  D6eHits.map((h) => `${h} ${asciiSlice(buf, h, h + 70)}`),
)

const FNS = {
  vp: at('vp', 188065722),
  tX: at('tX', 188064834),
  IN: at('IN', 185847023),
  MLe: at('MLe', 181896185),
  K: at('K', 179041915),
  rbe: at('rbe', 185848716),
  j8t: at('j8t', 200901033),
  jUe: at('jUe', 200901113),
  Ce: at('Ce', 201165125),
  c$t: at('c$t', 185036528),
  u$t: at('u$t', 185036585),
  cL: at('cL', 185036298),
  D6e: at('D6e', D6eHits.find((h) => Math.abs(h - 185036331) < 20) ?? 185036331),
  _8: at('_8', 185036457),
  F6e: at('F6e', 185036404),
  _Gn: at('_Gn', 185036641),
  xhe: classAt('xhe', 185033617),
  O6e: classAt('O6e', 185035774),
  ao: at('ao', 179108467),
  Ut: at('Ut', 182184813),
  I: at('I', 182186847),
  aV: at('aV', 182184937),
  qhn: at('qhn', 182004789),
  Oo: at('Oo', 193380287),
  htn: at('htn', 193380194),
  iJ: at('iJ', 182137594),
  zl: at('zl', 182137475),
  Ryr: at('Ryr', 182137215),
  _Y: at('_Y', 183343362),
  lyr: at('lyr', 181659488),
  $e: at('$e', 181667953),
  xP: at('xP', 181667670),
  hM: at('hM', 180217949),
  toe: at('toe', 180217980),
  o5: at('o5', 180218041),
  ui: at('ui', 180217756),
  db: at('db', 180217091),
  Fx: at('Fx', 180131955),
  yN: at('yN', 179889190),
  Bdt: at('Bdt', 186056653),
  Qan: at('Qan', 186055955),
}

FNS.ce = ceBest

const E2t = at('E2t', 183343478)
const UWt = at('UWt', 182185287)
const DH = at('DH', 182187516)

const fgHits = allHits(buf, 'foreground subagent')
const procAoHits = allHits(buf, 'ao(`/proc/self/fd').length + allHits(buf, 'ao("/proc/self/fd').length

const lines = []
const say = (s = '') => lines.push(s)

say('# gold-251-j missing pieces #2 #4 #6 #9 #10 #16 #18')
say('')
say(`- exe: ${EXE_251}`)
say(`- bytes: ${buf.length}`)
say(`- when: ${new Date().toISOString()}`)
say(
  '- rule: changelog is an INDEX. Extract ONLY missing callees/branches from locked gold-251-a/b/c. BODY = full extracted JS function/class. MISS = name or requested loop absent. Do not invent a `/proc/self/fd` ancestor walk.',
)
say(
  '- method: `allHits("function NAME")` then `extractFnAt` at the declaration that the locked caller actually invokes (not merely the nearest same-spelling decl). sha is sha256/16 of the full body.',
)
say('')

say('## Compact table')
say('')
say('| # | verdict | extracted | miss |')
say('| --- | --- | --- | --- |')
say(
  `| 2 | BODY | vp tX IN MLe K rbe j8t jUe Ce | foreground-subagent writer (phrase is schema-only) |`,
)
say(`| 4 | BODY | xhe O6e cL c$t u$t D6e _8 F6e _Gn | - |`)
say(
  `| 6 | MISS | ao Ut I aV (UWt/DH already gold; gt=readlink import) | /proc/self/fd ancestor walk |`,
)
say(`| 9 | BODY | qhn Oo htn iJ zl Ryr | - |`)
say(
  `| 10 | BODY | E2t fd walk (lY=readlink import) | /proc/self/fd ancestor walk |`,
)
say(`| 16 | BODY | lyr${ceBest ? ' ce' : ''} $e xP | ${ceBest ? '-' : 'ce 2-arg truncator'} |`)
say(`| 18 | BODY | hM toe o5 ui db Fx yN Bdt Qan | - |`)
say('')

// #2
say('## #2')
say('')
say(
  'Locked callers: `san` @185859343 (`vp`/`tX`/`IN`/`MLe`/`K`/`rbe`), `Ce` @201165125 (`j8t`/`jUe`). Phrase "foreground subagent" is not in a writer body.',
)
say('')
for (const n of ['vp', 'tX', 'IN', 'MLe', 'K', 'rbe', 'j8t', 'jUe', 'Ce']) {
  say(render(FNS[n], n === 'K' ? 'session_id getter (session_id:K() 71 hits)' : ''))
}
say('### foreground subagent phrase — MISS as writer')
say('')
say(`- hits=${fgHits.length} offsets=${fgHits.join(',')}`)
say(
  '- both hits are telemetry schema `.describe(...)` text: "including a foreground subagent cancelled just as it finished". No function writes tool frames under that phrase. The live writer is `Ce` (`parent_tool_use_id!=null` → `writeSdkMessages`).',
)
say('')
say('**#2 verdict:** BODY')
say('')

// #4
say('## #4')
say('')
say(
  'Locked projectors: `oqe` @202996715 and `whn` @185429010 call `c$t`/`u$t`. Live accumulate is `xhe.record` via `O6e`/`cL`/`D6e`.',
)
say('')
for (const n of ['xhe', 'O6e', 'cL', 'c$t', 'u$t', 'D6e', '_8', 'F6e', '_Gn']) {
  say(render(FNS[n], n === 'xhe' ? 'class; hit/miss/expected/cold accumulate' : n === 'O6e' ? 'class; per-session map' : ''))
}
say('**#4 verdict:** BODY')
say('')

// #6
say('## #6')
say('')
say(
  'Locked: `UWt` @182185287 / `DH` @182187516 already have O_NOFOLLOW and a single `readlink` of `/proc/self/fd/${fd}` (`gt` is `import{readlink as gt}from"fs/promises"` @182184232). This peel is the `/proc/self/fd` **ancestor walk**.',
)
say('')
say(
  `- UWt \`ao(\` uses: \`for(let d of ao(t))\` and \`for(let y of ao(t))\` — argument is the user path \`t\`, not an fd path.`,
)
say(
  `- \`ao(\`/proc/self/fd hits=${procAoHits}. No callee is invoked as \`ao(\`/proc/self/fd...)\`.`,
)
say(
  '- DH `for(;;)` walks `L(t)` (dirname of the user path) while creating parents, then uses `/proc/self/fd/${b.fd}` as a stable handle to create children. That is not an ancestor walk of the fd path.',
)
say('')
say(render(FNS.ao, 'symlink-hop collector used by UWt; no /proc/self/fd'))
say(render(FNS.Ut, 'detects /proc/self/fd and /proc/pid/fd leaf paths; no walk'))
say(render(FNS.I))
say(render(FNS.aV))
say('### `/proc/self/fd` ancestor walk — MISS')
say('')
say(
  'No extracted UWt/DH callee walks parents of `/proc/self/fd/${fd}`. `ao` follows `readlinkSync` hops of the user path (cap 64) and never mentions `/proc/self/fd`. Do not invent that loop.',
)
say('')
say('**#6 verdict:** MISS')
say('')

// #9
say('## #9')
say('')
say(
  'Locked: `Rst` @193380425 / `It` @193380027. `htn` calls `qhn` then `Oo`. `Oo` is the tools-readable-set gate.',
)
say('')
for (const n of ['qhn', 'Oo', 'htn', 'iJ', 'zl', 'Ryr']) {
  say(render(FNS[n]))
}
say('**#9 verdict:** BODY')
say('')

// #10
say('## #10')
say('')
say(
  'Locked: `E2t` @183343478 (full body in gold-251-b) and `oht` lexical+canonical deny compile. `lY` is `import{readlink as lY}from"fs/promises"` @183340456 — not a `function lY`.',
)
say('')
say(
  `### E2t fd walk — BODY (inside locked \`E2t\` @${E2t.at} len=${E2t.len} sha=${E2t.sha})`,
)
say('')
{
  const i = E2t.body.indexOf('/proc/self/fd')
  const a = Math.max(0, i - 80)
  const b = Math.min(E2t.body.length, i + 720)
  say(fence(E2t.body.slice(a, b)))
  say('')
}
say(
  '- linux/wsl: `F=await lY(\`/proc/self/fd/${k.fd}\`)` then `spawnCwd` / `target` / `uY` use that fd path. `ao(e)` in the recheck closure is the search-root path, not the fd path.',
)
say('')
say(render(FNS._Y, 'exists-check only; not the fd walk'))
say('### `/proc/self/fd` ancestor walk — MISS')
say('')
say(
  'E2t never calls `ao` on the fd path. Same invent-ban as #6.',
)
say('')
say('**#10 verdict:** BODY (fd readlink+spawn walk present; ancestor-of-fd loop absent)')
say('')

// #16
say('## #16')
say('')
say(
  'Locked: `IMe` @181666523. Re-extract `lyr` @181659488 — gold-251-c already had the full 216-byte body; not truncated.',
)
say('')
say(render(FNS.lyr, 'full body; result-truncated marker present'))
say('- binding: `var RP=4000` @181659466 (cap used by `ce(s,RP)`)')
say('')
say(render(FNS.ce, 'UTF-16-safe slice cap used by lyr; not the later directory-walker ce'))
say(render(FNS.$e))
say(render(FNS.xP))
say('**#16 verdict:** BODY')
say('')

// #18
say('## #18')
say('')
say(
  'Locked: `iJt` @190710208 (`hM().length===0||o5()` && `Bdt` && `Qan()`), `BFt`/`$at` already gold. Peel `hM`/`o5` and Qan origin.',
)
say('')
for (const n of ['hM', 'toe', 'ui', 'o5', 'db', 'Fx', 'yN', 'Bdt', 'Qan']) {
  say(render(FNS[n]))
}
say('**#18 verdict:** BODY')
say('')

say('No checklist/board/HAVE updates.')
say('')

const out = join(dirname(fileURLToPath(import.meta.url)), 'gold-251-j.md')
writeFileSync(out, lines.join('\n'))
console.log('WROTE', out, 'chars', lines.join('\n').length)
for (const [k, v] of Object.entries(FNS)) {
  console.log(`${k}\t@${v.at}\t${v.len}\t${v.sha}`)
}
console.log('UWt', UWt.len, UWt.sha, 'hasProcFd', UWt.body.includes('/proc/self/fd'))
console.log('DH', DH.len, DH.sha, 'hasProcFd', DH.body.includes('/proc/self/fd'))
console.log('E2t', E2t.len, E2t.sha)
