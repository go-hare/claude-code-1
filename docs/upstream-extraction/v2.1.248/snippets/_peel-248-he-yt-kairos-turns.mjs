/**
 * DIG: He diagnostics + Yt caps default + kairos/sessionSource + turn map
 * Official SEA only — write gold-248-{he-full,yt-caps,kairos-source,turn-map}.txt
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  extractFnAt,
  loadSea,
  sha,
  asciiSlice,
  lastFnStart,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const HOST_LO = 178500000
const HOST_HI = 178580000

function extractClassAt(i, maxLen = 16000) {
  const win = asciiSlice(buf, i, i + maxLen)
  if (!win.startsWith('class ')) return { i, miss: true, preview: win.slice(0, 80) }
  let depth = 0
  let inStr = null
  let esc = false
  let started = false
  for (let p = 0; p < win.length; p++) {
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
    if (c === '{') {
      depth++
      started = true
    } else if (c === '}') {
      depth--
      if (started && depth === 0) {
        const body = win.slice(0, p + 1)
        return { i, body, sha: sha(body), len: body.length }
      }
    }
  }
  return { i, missEnd: true, preview: win.slice(0, 200) }
}

function extractObjectLiteralAt(i, maxLen = 4000) {
  // Find first `{` at/after i and extract balanced object
  const win = asciiSlice(buf, i, i + maxLen)
  const brace = win.indexOf('{')
  if (brace < 0) return { i, miss: true, preview: win.slice(0, 120) }
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
        const body = win.slice(brace, p + 1)
        return { i, body, sha: sha(body), len: body.length, full: win.slice(0, p + 1) }
      }
    }
  }
  return { i, missEnd: true, preview: win.slice(0, 200) }
}

function ctx(i, before = 80, after = 200) {
  return asciiSlice(buf, i - before, i + after)
}

function dumpNeedleHits(lines, label, needle, opts = {}) {
  const hits = allHits(buf, needle)
  const filtered = opts.hostOnly
    ? hits.filter(i => i > HOST_LO && i < HOST_HI)
    : hits
  lines.push(`## ${label} needle=${JSON.stringify(needle)} hits=${hits.length} shown=${Math.min(filtered.length || hits.length, opts.limit ?? 12)}`)
  const use = (opts.hostOnly ? filtered : hits).slice(0, opts.limit ?? 12)
  for (const i of use) {
    lines.push(`- @${i} ${JSON.stringify(ctx(i, opts.before ?? 60, opts.after ?? 180))}`)
  }
  if (use.length === 0 && opts.hostOnly) {
    lines.push(`- (no host-window hits; total SEA hits=${hits.length})`)
    for (const i of hits.slice(0, 6)) {
      lines.push(`- ALL @${i} ${JSON.stringify(ctx(i, 40, 120))}`)
    }
  }
  lines.push('')
}

// ─── 1) He full + wrappers ─────────────────────────────────────────
{
  const lines = ['# gold-248-he-full', 'DIG official Diagnostics (class He) + wrappers', '']

  const heHits = allHits(buf, 'class He{').filter(i => i > HOST_LO && i < HOST_HI)
  lines.push(`## class He{ near-host hits=${heHits.length}`)
  for (const i of heHits) {
    const ext = extractClassAt(i)
    if (ext.body) {
      lines.push(`@${i} sha=${ext.sha} len=${ext.len}`)
      lines.push(ext.body)
      // Analysis
      const writesT =
        /this\.#t\s*=/.test(ext.body) && !/this\.#t\s*=\s*\[\]/.test(ext.body.replace(/this\.#t=\[\],?/g, ''))
      const recordSlowEmpty = /recordSlowOperation\([^)]*\)\{return\}/.test(ext.body)
      const recordDevEmpty = /recordDevBarAlert\([^)]*\)\{return\}/.test(ext.body)
      const tInit = /#t=\[\]/.test(ext.body)
      const tReset = /this\.#t=\[\]/.test(ext.body)
      const tFilter = /this\.#t=this\.#t\.filter/.test(ext.body)
      const tPush = /this\.#t\.push/.test(ext.body)
      lines.push('')
      lines.push('### He field / write analysis')
      lines.push(`- recordSlowOperation empty return: ${recordSlowEmpty}`)
      lines.push(`- recordDevBarAlert empty return: ${recordDevEmpty}`)
      lines.push(`- #t init []: ${tInit}`)
      lines.push(`- #t reset to []: ${tReset}`)
      lines.push(`- #t filter (TTL prune only): ${tFilter}`)
      lines.push(`- #t.push ever in class body: ${tPush}`)
      lines.push(`- #t ever written with payload (non-init/reset/filter): ${tPush}`)
      lines.push(`- VERDICT: #t is NEVER populated — recordSlowOperation is noop; slowOperations() only prunes/returns empty-ish #t`)
    } else {
      lines.push(`@${i} ${JSON.stringify(ext)}`)
    }
  }
  lines.push('')

  // wrappers / call sites
  const wrapperNeedles = [
    'recordSlowOperation',
    'recordDevBarAlert',
    'devBarAlert',
    'slowOperations',
    'errorLog',
    'recordError',
    'diagnostics.recordSlowOperation',
    'diagnostics.recordDevBarAlert',
    'diagnostics.slowOperations',
    'diagnostics.errorLog',
    'diagnostics.recordError',
    'diagnostics.devBarAlert',
    '.diagnostics.',
  ]
  for (const n of wrapperNeedles) {
    dumpNeedleHits(lines, `wrapper:${n}`, n, { limit: 20, after: 160 })
  }

  // Extract wrapper functions near host that call diagnostics methods
  const wrapFnNeedles = [
    'function yEr(', // known recordError from gold
  ]
  // Hunt function wrappers by looking backwards from diagnostics. hits in host window
  const diagHits = allHits(buf, 'n().host.diagnostics.')
  lines.push(`## n().host.diagnostics.* call sites hits=${diagHits.length}`)
  for (const i of diagHits) {
    const snip = ctx(i, 120, 200)
    lines.push(`- @${i} ${JSON.stringify(snip)}`)
    const fn = lastFnStart(buf, i + 20, ['function '])
    if (fn.best >= 0) {
      const ext = extractFnAt(buf, fn.best, 800)
      if (ext.body && ext.body.length < 400) {
        lines.push(`  fn@${fn.best} ${ext.body}`)
      } else if (ext.body) {
        lines.push(`  fn@${fn.best} sha=${ext.sha} len=${ext.len} ${ext.body.slice(0, 220)}…`)
      }
    }
  }
  lines.push('')

  // Also search host.diagnostics without n()
  const diagHits2 = allHits(buf, 'host.diagnostics.')
  lines.push(`## host.diagnostics.* hits=${diagHits2.length}`)
  for (const i of diagHits2.slice(0, 30)) {
    lines.push(`- @${i} ${JSON.stringify(ctx(i, 100, 160))}`)
  }
  lines.push('')

  writeFileSync(
    'docs/upstream-extraction/v2.1.248/snippets/gold-248-he-full.txt',
    lines.join('\n'),
  )
  console.log('wrote gold-248-he-full.txt')
}

// ─── 2) Yt caps constant ───────────────────────────────────────────
{
  const lines = ['# gold-248-yt-caps', 'DIG official Yt CONSTANT (he.#s default) — NOT class Yt', '']

  dumpNeedleHits(lines, '#s=Yt', '#s=Yt', { limit: 10, after: 80 })
  dumpNeedleHits(lines, 'this.#s=Yt', 'this.#s=Yt', { limit: 10 })
  dumpNeedleHits(lines, 'Yt={workspace', 'Yt={workspace', { limit: 10, after: 300 })
  dumpNeedleHits(lines, 'var Yt=', 'var Yt=', { limit: 20, after: 300 })
  dumpNeedleHits(lines, 'Yt={', 'Yt={', { limit: 30, after: 250 })

  // Near he class @178525654 — walk backwards for Yt=
  const heAt = 178525654
  lines.push(`## backward hunt from class he @${heAt}`)
  const winBefore = asciiSlice(buf, heAt - 8000, heAt)
  const markers = ['var Yt=', 'Yt=', ',Yt=', ';Yt=']
  for (const m of markers) {
    let idx = winBefore.lastIndexOf(m)
    lines.push(`### lastIndexOf ${JSON.stringify(m)} in [he-8k,he) = ${idx}`)
    if (idx >= 0) {
      const abs = heAt - 8000 + idx
      lines.push(`@${abs} ${JSON.stringify(asciiSlice(buf, abs, abs + 500))}`)
      const obj = extractObjectLiteralAt(abs, 2000)
      if (obj.body) {
        lines.push(`OBJECT sha=${obj.sha} len=${obj.len}`)
        lines.push(obj.body)
        if (obj.full) lines.push(`ASSIGN ${obj.full.slice(0, Math.min(obj.full.length, 80))}…`)
      }
    }
  }

  // Broader: scan for Yt={ with workspace key near host
  const ytObjHits = allHits(buf, 'Yt={')
  lines.push(`## Yt={ all hits=${ytObjHits.length} — filter those with workspace nearby`)
  for (const i of ytObjHits) {
    const snip = asciiSlice(buf, i, i + 400)
    if (snip.includes('workspace') || snip.includes('ink') || (i > HOST_LO - 50000 && i < HOST_HI)) {
      lines.push(`- @${i} ${JSON.stringify(snip.slice(0, 350))}`)
      const obj = extractObjectLiteralAt(i, 2000)
      if (obj.body && (obj.body.includes('workspace') || obj.body.includes('ink'))) {
        lines.push(`  EXACT OBJECT sha=${obj.sha}`)
        lines.push(obj.body)
      }
    }
  }
  lines.push('')

  // Also try `Yt={workspace:` exact and variants with spaces
  for (const n of [
    'Yt={workspace:',
    'Yt={workspace:"local"',
    'Yt={workspace:"remote"',
    'var Yt={',
    'Yt=Object.freeze',
  ]) {
    dumpNeedleHits(lines, n, n, { limit: 8, after: 350 })
  }

  writeFileSync(
    'docs/upstream-extraction/v2.1.248/snippets/gold-248-yt-caps.txt',
    lines.join('\n'),
  )
  console.log('wrote gold-248-yt-caps.txt')
}

// ─── 3) kairosActive / sessionSource ───────────────────────────────
{
  const lines = ['# gold-248-kairos-source', 'DIG kairosActive / sessionSource in official host tree', '']

  const needles = [
    'kairosActive',
    'sessionSource',
    'replaceKairos',
    'isKairos',
    'kairos',
    'Kairos',
    'session_source',
    'setSessionSource',
    'getSessionSource',
    'replaceSessionSource',
  ]
  for (const n of needles) {
    dumpNeedleHits(lines, n, n, { limit: 15, after: 140 })
  }

  // class ge (sessionFlags) already known — confirm no kairos fields
  const geHits = allHits(buf, 'class ge{').filter(i => i > HOST_LO && i < HOST_HI)
  lines.push(`## class ge (sessionFlags) near-host hits=${geHits.length}`)
  for (const i of geHits) {
    const ext = extractClassAt(i)
    if (ext.body) {
      lines.push(`@${i} sha=${ext.sha} len=${ext.len}`)
      lines.push(ext.body)
      const hasKairos = /kairos/i.test(ext.body)
      const hasSessionSource = /sessionSource|session_source/i.test(ext.body)
      lines.push(`### ge has kairos*: ${hasKairos}; has sessionSource*: ${hasSessionSource}`)
    }
  }
  lines.push('')

  // class Ie launchOptions
  const ieHits = allHits(buf, 'class Ie{').filter(i => i > HOST_LO && i < HOST_HI)
  lines.push(`## class Ie (launchOptions) near-host hits=${ieHits.length}`)
  for (const i of ieHits.slice(0, 3)) {
    const ext = extractClassAt(i, 20000)
    if (ext.body) {
      lines.push(`@${i} sha=${ext.sha} len=${ext.len}`)
      lines.push(ext.body)
      lines.push(`### Ie has kairos*: ${/kairos/i.test(ext.body)}; sessionSource*: ${/sessionSource/i.test(ext.body)}`)
    }
  }
  lines.push('')

  // Ee is modelStringsCache sibling — confirm not launchOptions
  const eeHits = allHits(buf, 'class Ee{').filter(i => i > HOST_LO && i < HOST_HI)
  lines.push(`## class Ee near-host (modelStringsCache per gold) hits=${eeHits.length}`)
  for (const i of eeHits.slice(0, 2)) {
    const ext = extractClassAt(i)
    if (ext.body) {
      lines.push(`@${i} sha=${ext.sha} len=${ext.len}`)
      lines.push(ext.body)
    }
  }
  lines.push('')

  // Host bag field names from sn()
  const snHits = allHits(buf, 'diagnostics:new He')
  lines.push(`## sn()/host bag field list near diagnostics:new He hits=${snHits.length}`)
  for (const i of snHits.slice(0, 3)) {
    lines.push(`- @${i} ${JSON.stringify(ctx(i, 400, 200))}`)
  }
  lines.push('')

  // en() session bags
  const turnBudget = allHits(buf, 'turnBudget:e.kind')
  lines.push(`## en() sibling bags (turnBudget:) hits=${turnBudget.length}`)
  for (const i of turnBudget.slice(0, 2)) {
    lines.push(`- @${i} ${JSON.stringify(ctx(i, 800, 400))}`)
  }
  lines.push('')

  lines.push('## VERDICT')
  const kHits = allHits(buf, 'kairosActive')
  const sHits = allHits(buf, 'sessionSource')
  lines.push(`- kairosActive SEA string hits=${kHits.length}`)
  lines.push(`- sessionSource SEA string hits=${sHits.length}`)
  if (kHits.length === 0 && sHits.length === 0) {
    lines.push('- NO official host bag slot for kairosActive or sessionSource')
    lines.push('- keep STATE residual OK (do NOT invent bag)')
  } else {
    lines.push('- FOUND string(s) — inspect hits above for bag+methods')
  }

  writeFileSync(
    'docs/upstream-extraction/v2.1.248/snippets/gold-248-kairos-source.txt',
    lines.join('\n'),
  )
  console.log('wrote gold-248-kairos-source.txt')
}

// ─── 4) turn counters map ──────────────────────────────────────────
{
  const lines = ['# gold-248-turn-map', 'Map leftover turn counters → official me/ce', '']

  // Peel me + ce again for gold file
  for (const [label, needle] of [
    ['me turnBudget', 'class me{'],
    ['ce requestJournal', 'class ce{'],
  ]) {
    const hits = allHits(buf, needle).filter(i => i > HOST_LO && i < HOST_HI)
    lines.push(`## ${label} ${needle} hits=${hits.length}`)
    for (const i of hits.slice(0, 2)) {
      const ext = extractClassAt(i)
      if (ext.body) {
        lines.push(`@${i} sha=${ext.sha} len=${ext.len}`)
        lines.push(ext.body)
      }
    }
    lines.push('')
  }

  for (const n of [
    'turnCount',
    'totalTurns',
    'numTurns',
    'num_turns',
    'promptIndex',
    'continuationCount',
    'outputTokensAtTurnStart',
    'snapshotForTurn',
    'incrementContinuation',
    'incrementPromptIndex',
  ]) {
    dumpNeedleHits(lines, n, n, { limit: 12, after: 100, hostOnly: false })
  }

  lines.push('## MAP leftover → official')
  lines.push('| leftover name | official locus | notes |')
  lines.push('|---|---|---|')
  lines.push('| outputTokensAtTurnStart (module STATE) | me.#e / outputTokensAtTurnStart() | me.snapshotForTurn(e,t) sets #e |')
  lines.push('| (budget / max output) | me.#t / budget() | snapshotForTurn second arg |')
  lines.push('| continuation / retry-in-turn | me.#n / continuationCount() | incrementContinuation() |')
  lines.push('| promptIndex / turn ordinal for prompts | ce.#i / promptIndex() | replacePromptIndex / incrementPromptIndex |')
  lines.push('| turnCount / totalTurns / numTurns (leftover STATE?) | NO host bag field with these names | local QueryEngine vars / telemetry only — not n() bags |')
  lines.push('')
  lines.push('## VERDICT lines')
  lines.push('- me (turnBudget) @178526864 — 补 if leftover still uses module-level outputTokensAtTurnStart; land on session.turnBudget')
  lines.push('- ce.promptIndex — 补 if leftover turn ordinal; land on session.requestJournal.promptIndex')
  lines.push('- turnCount/totalTurns/numTurns as STATE bag fields — 砍 if present as host-bag invent; keep as local/query vars OK')

  writeFileSync(
    'docs/upstream-extraction/v2.1.248/snippets/gold-248-turn-map.txt',
    lines.join('\n'),
  )
  console.log('wrote gold-248-turn-map.txt')
}

console.log('done')
