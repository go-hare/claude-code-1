/**
 * densable 2.1.248 — HARD re-dig kairosActive behavioral equivalents.
 * Official SEA = contract. Do NOT invent bags.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-kairosActive-redig',
  `when=${new Date().toISOString()}`,
  `exe=${EXE_248}`,
  'contract=official SEA — do NOT invent n() sibling bags',
  '',
]

function section(title) {
  lines.push(`## ${title}`)
}

function dumpHits(needle, max = 12, ctx = 160) {
  const hits = allHits(buf, needle)
  lines.push(`### needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const i of hits.slice(0, max)) {
    lines.push(
      `@${i} ${asciiSlice(buf, Math.max(0, i - ctx), i + needle.length + ctx)}`,
    )
    lines.push('')
  }
  return hits
}

// ─── 1) Direct + behavioral needles ─────────────────────────────────
section('1) SEA string needles')
const needles = [
  'kairosActive',
  'getKairosActive',
  'setKairosActive',
  'replaceKairosActive',
  'is_assistant_mode',
  'assistant_mode',
  'isAssistantMode',
  'setKairos',
  'markAssistantForced',
  'assistantForced',
  'tengu_kairos',
  'tengu_kairos_assistant',
  'tengu_kairos_brief',
  'tengu_kairos_ready',
  'userMsgOptIn',
  'replaceUserMsgOptIn',
  'brief mode',
  'Brief mode',
  '--assistant',
  'assistant mode',
  'isKairosActive',
  'kairos_active',
  'KairosActive',
]
for (const n of needles) dumpHits(n, 8, 140)

// ─── 2) Export alias hunt ───────────────────────────────────────────
section('2) Export alias hunt (get/set Kairos / assistant)')
const aliasNeedles = [
  'as getKairosActive',
  'as setKairosActive',
  'as isAssistantMode',
  'as getIsAssistantMode',
  'as setIsAssistantMode',
  'as markAssistantForced',
  'KairosActive',
  'getKairos',
  'setKairos',
]
for (const n of aliasNeedles) dumpHits(n, 6, 200)

// ─── 3) is_assistant_mode analytics consumers ───────────────────────
section('3) is_assistant_mode call sites (peel nearby fns)')
{
  const hits = allHits(buf, 'is_assistant_mode')
  lines.push(`hits=${hits.length}`)
  for (const i of hits.slice(0, 20)) {
    // walk back to nearest function start
    const back = asciiSlice(buf, Math.max(0, i - 800), i + 200)
    const m = [...back.matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(/g)]
    const last = m[m.length - 1]
    lines.push(
      `@${i} nearestFn=${last ? last[1] : '?'} ctx=${asciiSlice(buf, Math.max(0, i - 220), i + 180)}`,
    )
    lines.push('')
  }
}

// ─── 4) Ie LaunchOptions full method list ───────────────────────────
section('4) Ie LaunchOptions method roster @178534988')
{
  const ieStart = buf.indexOf(Buffer.from('class Ie{'))
  // find the known offset from prior gold
  const known = 178534988
  const at = extractFnAt(buf, known - 6, 12000) // "class Ie{" approx
  // better: slice from known class body
  const body = asciiSlice(buf, known, known + 4500)
  lines.push(`@${known} sha=${sha(body)} len=${body.length}`)
  lines.push(body)
  lines.push('')
  // extract method names
  const methods = [...body.matchAll(/([A-Za-z][A-Za-z0-9_]*)\(\)/g)].map(
    m => m[1],
  )
  const uniq = [...new Set(methods)]
  lines.push(`Ie zero-arg methods (${uniq.length}): ${uniq.join(', ')}`)
  const kairosLike = uniq.filter(m =>
    /kairos|assistant|brief|optIn|latch|active/i.test(m),
  )
  lines.push(`kairos/assistant/brief/optIn/latch/active-ish: ${kairosLike.join(', ') || '(none)'}`)
  lines.push('')
}

// ─── 5) ge sessionFlags method roster ───────────────────────────────
section('5) ge sessionFlags method roster @178521439')
{
  const known = 178521439
  const body = asciiSlice(buf, known, known + 3500)
  lines.push(`@${known} sha=${sha(body)}`)
  lines.push(body.slice(0, 2800))
  lines.push('')
  const methods = [...body.matchAll(/([A-Za-z][A-Za-z0-9_]*)\(\)/g)].map(
    m => m[1],
  )
  const uniq = [...new Set(methods)]
  lines.push(`ge zero-arg methods (${uniq.length}): ${uniq.join(', ')}`)
  const kairosLike = uniq.filter(m =>
    /kairos|assistant|brief|optIn|latch|active|source/i.test(m),
  )
  lines.push(`kairos/assistant/brief-ish: ${kairosLike.join(', ') || '(none)'}`)
  lines.push('')
}

// ─── 6) n() / en() / sn() host bag field names ──────────────────────
section('6) host bag field names near launchOptions/sessionFlags')
{
  for (const n of [
    'launchOptions:',
    'sessionFlags:',
    'surfaceCapabilities:',
    'new Ie',
    'new ge',
    'kairos',
    'assistantMode',
    'briefActive',
    'briefOptIn',
  ]) {
    dumpHits(n, 4, 100)
  }
}

// ─── 7) userMsgOptIn interaction with KAIROS / brief / assistant ────
section('7) userMsgOptIn callers + nearby kairos/brief/assistant')
{
  const hits = allHits(buf, 'userMsgOptIn')
  lines.push(`userMsgOptIn hits=${hits.length}`)
  for (const i of hits.slice(0, 25)) {
    const ctx = asciiSlice(buf, Math.max(0, i - 100), i + 200)
    const flag =
      /kairos|assistant|brief|Brief|KAIROS|setKairos|is_assistant/i.test(ctx)
    lines.push(`@${i} kairosNear=${flag} ${ctx}`)
    lines.push('')
  }
}

// ─── 8) tengu_kairos* GB gates — classify vs latch ──────────────────
section('8) tengu_kairos* GrowthBook / gate strings')
{
  const hits = allHits(buf, 'tengu_kairos')
  lines.push(`tengu_kairos* prefix hits=${hits.length}`)
  const names = new Set()
  for (const i of hits) {
    const s = asciiSlice(buf, i, i + 80)
    const m = s.match(/tengu_kairos[A-Za-z0-9_]*/)
    if (m) names.add(m[0])
  }
  lines.push(`unique names: ${[...names].sort().join(', ')}`)
  for (const name of [...names].sort()) {
    dumpHits(name, 3, 120)
  }
}

// ─── 9) KAIROS feature gate after main / --assistant path ───────────
section('9) --assistant / feature(KAIROS) launch path')
{
  for (const n of [
    '--assistant',
    'assistantForced',
    'markAssistant',
    'KAIROS',
    'feature("KAIROS")',
    "feature('KAIROS')",
    'tengu_kairos_assistant',
  ]) {
    dumpHits(n, 6, 150)
  }
}

// ─── 10) Wrapper functions that return boolean near brief entitlement ─
section('10) Brief entitlement / isBriefEnabled patterns')
{
  for (const n of [
    'isBriefEntitled',
    'isBriefEnabled',
    'BriefTool',
    'SendUserMessage',
    'pewter_owl',
    'getUserMsgOptIn',
    'as getUserMsgOptIn',
    'as setUserMsgOptIn',
  ]) {
    dumpHits(n, 5, 140)
  }
}

// ─── 11) Cross-check: any private field write near setUserMsgOptIn ──
section('11) replaceUserMsgOptIn wrapper + sibling wrappers window')
{
  const hits = allHits(buf, 'function c7(e){n().host.launchOptions.replaceUserMsgOptIn(e)}')
  lines.push(`exact c7 wrapper hits=${hits.length}`)
  for (const i of hits) {
    lines.push(`@${i} WINDOW±600:`)
    lines.push(asciiSlice(buf, Math.max(0, i - 600), i + 600))
    lines.push('')
  }
  // also find any function that sets two launch option flags together
  const dual = allHits(buf, 'replaceUserMsgOptIn')
  for (const i of dual.slice(0, 15)) {
    const ctx = asciiSlice(buf, Math.max(0, i - 250), i + 250)
    if (/replace|kairos|assistant|brief|#h|#m/i.test(ctx)) {
      lines.push(`@${i} dualCtx=${ctx}`)
      lines.push('')
    }
  }
}

// ─── 12) Prove absence: export table scan for Kairos / AssistantMode ─
section('12) Export table substrings around getUserMsgOptIn')
{
  const hits = allHits(buf, 'as getUserMsgOptIn')
  for (const i of hits) {
    lines.push(`@${i} exportWindow:`)
    lines.push(asciiSlice(buf, Math.max(0, i - 400), i + 400))
    lines.push('')
  }
  const hits2 = allHits(buf, 'as setUserMsgOptIn')
  for (const i of hits2) {
    lines.push(`@${i} setExportWindow:`)
    lines.push(asciiSlice(buf, Math.max(0, i - 400), i + 400))
    lines.push('')
  }
}

section('VERDICT')
lines.push('(filled by agent after reading this gold)')

writeFileSync(
  new URL('./gold-248-kairosActive-redig.txt', import.meta.url),
  lines.join('\n'),
)
console.log('wrote gold-248-kairosActive-redig.txt lines=', lines.length)
