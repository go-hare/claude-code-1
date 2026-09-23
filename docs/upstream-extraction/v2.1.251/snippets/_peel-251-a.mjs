/**
 * densable 2.1.251 SEA peel — changelog bullets #1–#5.
 * Changelog text is an index, not a contract. Verdicts come from exe bytes.
 * Writes gold-251-a.md only.
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  EXE_251,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const outPath = join(dir, 'gold-251-a.md')

const BULLETS = [
  {
    n: 1,
    needles: [
      {
        s: 'PreModelSwitch',
        high: true,
        variants: ['preModelSwitch', 'PreModelSwitchHook'],
      },
      {
        s: 'PostModelSwitch',
        high: true,
        variants: ['postModelSwitch', 'PostModelSwitchHook'],
      },
      { s: 'SessionStart', high: false, variants: ['sessionStart'] },
      {
        s: 'staleness',
        high: true,
        variants: ['sessionStaleness', 'session_staleness'],
      },
      { s: 're-cache', high: true, variants: ['reCache', 're_cache'] },
      { s: 'recache', high: true, variants: ['reCacheCost'] },
      {
        s: 'estimated re-cache',
        high: true,
        variants: ['estimated re-cache cost', 'estimatedRecache'],
      },
    ],
  },
  {
    n: 2,
    needles: [
      {
        s: 'foreground subagent',
        high: true,
        variants: ['foregroundSubagent', 'foreground_subagent'],
      },
      {
        s: 'Remote Control',
        high: false,
        variants: ['remote control', 'remote-control'],
      },
      {
        s: 'tool calls and results',
        high: true,
        variants: ['tool_result', 'parent_tool_use_id'],
      },
      { s: 'task_progress', high: true, variants: ['taskProgress'] },
    ],
  },
  {
    n: 3,
    needles: [
      { s: 'spend_limit', high: true, variants: ['spendLimit', 'spend-limit'] },
      { s: 'Spend limit', high: true, variants: ['spend limit', 'Spend Limit'] },
      { s: 'rate_limits', high: true, variants: ['rateLimits'] },
    ],
  },
  {
    n: 4,
    needles: [
      {
        s: 'prompt_cache',
        high: true,
        variants: ['promptCache', 'prompt-cache'],
      },
      {
        s: 'tokens re-cached',
        high: true,
        variants: ['re-cached', 'tokensRecached'],
      },
      { s: 'hit ratio', high: true, variants: ['hitRatio', 'hit_ratio'] },
      { s: 'warm/cold', high: true, variants: ['warmCold', 'warm-cold'] },
    ],
  },
  {
    n: 5,
    needles: [
      { s: 'respawn', high: true, variants: ['Respawn', '--respawn'] },
      {
        s: 'claude attach',
        high: true,
        variants: ['claude attach ', 'attach '],
      },
      { s: '--resume', high: false, variants: ['--resume '] },
    ],
  },
]

const extractCache = new Map()

function extractGrow(buf, i) {
  if (extractCache.has(i)) return extractCache.get(i)
  const caps = [12000, 40000, 120000]
  let last = null
  for (const cap of caps) {
    last = extractFnAt(buf, i, cap)
    if (last.body) break
  }
  extractCache.set(i, last)
  return last
}

function broadFnStart(buf, before, maxLookback) {
  const start = Math.max(0, before - maxLookback)
  const win = asciiSlice(buf, start, before)
  const re = /(?:async )?function\*? ?([A-Za-z_$][\w$]*)\s*\(/g
  let bestRel = -1
  let name = ''
  let m
  while ((m = re.exec(win))) {
    bestRel = m.index
    name = m[1]
  }
  if (bestRel < 0) return { i: -1, name: '', via: 'function-star' }
  return { i: start + bestRel, name, via: 'function-star' }
}

function fnStartAt(buf, cursor, look) {
  const generic = lastFnStartGeneric(buf, cursor, look)
  const broad = broadFnStart(buf, cursor, look)
  if (broad.i > generic.i) return broad
  return { i: generic.i, name: generic.name, via: 'lastFnStartGeneric' }
}

function jsScore(buf, offset, nlen) {
  const a = Math.max(0, offset - 80)
  const b = Math.min(buf.length, offset + nlen + 80)
  let punct = 0
  let space = 0
  let bad = 0
  const span = Math.max(1, b - a)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) {
      if (c === 32) space++
      if (
        c === 123 ||
        c === 125 ||
        c === 59 ||
        c === 40 ||
        c === 41 ||
        c === 61 ||
        c === 58 ||
        c === 44 ||
        c === 91 ||
        c === 93
      ) {
        punct++
      }
    } else bad++
  }
  if (bad > span * 0.15) return -50
  let s = punct * 2
  const next = buf[offset + nlen] || 0
  const prev = offset > 0 ? buf[offset - 1] : 0
  if (
    next === 40 ||
    next === 58 ||
    next === 44 ||
    next === 125 ||
    next === 93 ||
    next === 61
  ) {
    s += 6
  }
  if (prev === 34 || prev === 39 || prev === 96 || prev === 46) s += 3
  if (space > 18 && punct < 2) s -= 8
  const pre = asciiSlice(buf, Math.max(0, offset - 48), offset)
  if (pre.includes('hook_event_name:"') || pre.includes("hook_event_name:'")) {
    s += 30
  }
  if (pre.includes('claude ') || pre.includes('Usage:')) s += 18
  if (pre.includes('title:"') || pre.includes('title:\'')) s += 8
  return s
}

function topScored(buf, hits, nlen, k) {
  let sample = hits
  if (hits.length > 5000) {
    const step = Math.ceil(hits.length / 3500)
    sample = []
    for (let i = 0; i < hits.length; i += step) sample.push(hits[i])
  }
  const scored = []
  for (const off of sample) scored.push({ off, score: jsScore(buf, off, nlen) })
  scored.sort((a, b) => b.score - a.score || a.off - b.off)
  const out = []
  const seen = new Set()
  for (const row of scored) {
    if (row.score < 0) break
    if (seen.has(row.off)) continue
    seen.add(row.off)
    out.push(row)
    if (out.length >= k) break
  }
  return out
}

function analyzeAt(body, index) {
  let inStr = null
  let esc = false
  let strStart = -1
  for (let p = 0; p < index; p++) {
    const c = body[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      strStart = p
    }
  }
  if (!inStr) return { inString: false, literalLen: 0 }
  let q = index
  esc = false
  for (; q < body.length; q++) {
    const c = body[q]
    if (esc) {
      esc = false
      continue
    }
    if (c === '\\') {
      esc = true
      continue
    }
    if (c === inStr) return { inString: true, literalLen: q - strStart - 1 }
  }
  return { inString: true, literalLen: body.length - strStart }
}

function isStandalone(body, index, needle) {
  const prev = index > 0 ? body[index - 1] : ''
  const next = body[index + needle.length] || ''
  return !/[A-Za-z0-9_$]/.test(prev) && !/[A-Za-z0-9_$]/.test(next)
}

function sitesIn(body, needle) {
  const sites = []
  if (!body) return sites
  let i = 0
  while (i < body.length) {
    const at = body.indexOf(needle, i)
    if (at < 0) break
    const a = analyzeAt(body, at)
    const standalone = isStandalone(body, at, needle)
    const kind =
      standalone && (!a.inString || a.literalLen <= 160) ? 'code' : 'prose'
    sites.push({
      at,
      kind,
      literalLen: a.literalLen,
      inString: a.inString,
      standalone,
    })
    i = at + Math.max(1, needle.length)
  }
  return sites
}

function containsNeedle(body, start, hit, needle) {
  const rel = hit - start
  return (
    rel >= 0 &&
    rel + needle.length <= body.length &&
    body.slice(rel, rel + needle.length) === needle
  )
}

function enclosing(buf, hit, needle) {
  let cursor = hit
  let look = 8000
  const seen = new Set()
  for (let step = 0; step < 16; step++) {
    const start = fnStartAt(buf, cursor, look)
    if (start.i < 0) {
      if (look >= 64000) return null
      look *= 2
      continue
    }
    if (seen.has(start.i)) return null
    seen.add(start.i)
    const ex = extractGrow(buf, start.i)
    if (ex.body && containsNeedle(ex.body, start.i, hit, needle)) {
      return {
        name: start.name,
        at: start.i,
        body: ex.body,
        sha: ex.sha,
        len: ex.len,
        via: start.via,
        incomplete: false,
      }
    }
    if (ex.body) {
      cursor = start.i
      look = 8000
      continue
    }
    cursor = start.i
    look = 8000
  }
  return null
}

function extractArrow(buf, hit, needle) {
  const winStart = Math.max(0, hit - 3500)
  const win = asciiSlice(buf, winStart, Math.min(buf.length, hit + 9000))
  const rel = hit - winStart
  let idx = win.lastIndexOf('m(()=>', rel)
  if (idx < 0) idx = win.lastIndexOf('()=>', rel)
  if (idx < 0) return null
  const paren = win.indexOf('(', idx)
  if (paren < 0) return null
  let depth = 0
  let inStr = null
  let esc = false
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
        if (rel < idx || rel >= p) return null
        const body = win.slice(idx, p + 1)
        if (!body.includes(needle)) return null
        return {
          name: 'arrow',
          at: winStart + idx,
          body,
          sha: sha(body),
          len: body.length,
          via: 'arrow',
          incomplete: false,
        }
      }
    }
  }
  return null
}

function hasFlow(body) {
  return /\b(if|return|switch|throw|for|while|yield)\b|=>/.test(body)
}

function excerptAround(body, focus, cap = 3500) {
  if (!body) return ''
  if (body.length <= cap) return body
  let at = focus ? body.indexOf(focus) : 0
  if (at < 0) at = 0
  const sliceLen = cap - 2
  let a = Math.max(0, at - Math.floor(sliceLen / 2))
  let b = Math.min(body.length, a + sliceLen)
  a = Math.max(0, b - sliceLen)
  return (a > 0 ? '…' : '') + body.slice(a, b) + (b < body.length ? '…' : '')
}

function fence(text) {
  let n = 4
  while (text.includes('`'.repeat(n))) n++
  const f = '`'.repeat(n)
  return `${f}\n${text}\n${f}`
}

function fmtOffsets(hits) {
  if (!hits.length) return '-'
  return hits.slice(0, 8).join(',')
}

function resolveRows(buf, spec) {
  const primary = allHits(buf, spec.s)
  const rows = [
    {
      needle: spec.s,
      kind: 'primary',
      high: spec.high,
      hits: primary,
      of: spec.s,
    },
  ]
  if (primary.length === 0) {
    for (const v of (spec.variants || []).slice(0, 2)) {
      rows.push({
        needle: v,
        kind: 'variant',
        high: spec.high,
        hits: allHits(buf, v),
        of: spec.s,
      })
    }
  }
  return rows
}

function summarizeFn(body, rows) {
  const per = []
  let codeish = 0
  let codeishKinds = 0
  let standaloneHigh = 0
  for (const row of rows) {
    const sites = sitesIn(body, row.needle)
    const codeN = sites.filter(s => s.kind === 'code').length
    const proseN = sites.filter(s => s.kind === 'prose').length
    if (codeN > 0) {
      codeish += codeN
      if (row.high) codeishKinds++
      if (row.high && sites.some(s => s.kind === 'code' && s.standalone)) {
        standaloneHigh++
      }
    }
    per.push({
      needle: row.needle,
      high: row.high,
      codeN,
      proseN,
      first: sites[0] || null,
    })
  }
  return { per, codeish, codeishKinds, standaloneHigh, flow: hasFlow(body) }
}

function rankScore(fn) {
  const body = fn.body || ''
  let score = fn.sum.standaloneHigh * 100 + fn.sum.codeishKinds * 8
  if (body.includes('hook_event_name:"PreModelSwitch"')) score += 90
  if (body.includes('hook_event_name:"PostModelSwitch"')) score += 90
  if (body.includes('permissionBehavior') || body.includes('decision:"block"')) {
    score += 40
  }
  if (
    body.includes('seconds_since_last_response') &&
    body.includes('estimated_cache_write_usd')
  ) {
    score += 80
  }
  if (body.includes('writeSdkMessages') && body.includes('parent_tool_use_id')) {
    score += 70
  }
  if (body.includes('tool_use_result') && body.includes('yield')) score += 75
  if (body.includes('type==="tool_use"') && body.includes('tool_result')) {
    score += 65
  }
  if (body.includes('subtype:"task_progress"') || body.includes("subtype:\"task_progress\"")) {
    score += 20
  }
  if (body.includes('spend_limit:') || body.includes('spend_limit:{')) score += 45
  if (body.includes('title:"Spend limit"')) score += 40
  if (body.includes('prompt_cache:') && body.includes('hit_ratio')) score += 50
  if (body.includes('tokens re-cached') || body.includes('tokens re-cached`')) {
    score += 25
  }
  if (body.includes('first to resume it here')) score += 80
  if (body.includes('Usage: claude respawn')) score += 70
  if (fn.len > 8000) score -= 120
  if (fn.len > 20000) score -= 80
  score -= Math.log2(Math.max(2, fn.len))
  return score
}

function pickBest(cands) {
  const ranked = cands.filter(c => c.body)
  ranked.sort((a, b) => rankScore(b) - rankScore(a) || a.len - b.len)
  return ranked
}

function excerptFocus(fn) {
  const code = fn.sum?.per?.find(p => p.high && p.codeN > 0)
  if (code) return code.needle
  if (fn.body?.includes('first to resume it here')) return 'claude attach'
  if (fn.body?.includes('hook_event_name:"PreModelSwitch"')) return 'PreModelSwitch'
  if (fn.body?.includes('estimated_cache_write_usd')) return 'estimated_cache_write_usd'
  if (fn.body?.includes('tool_use_result')) return 'tool_use_result'
  if (fn.body?.includes('parent_tool_use_id')) return 'parent_tool_use_id'
  if (fn.body?.includes('Spend limit')) return 'Spend limit'
  return fn.anchor || ''
}

function addFn(byAt, fn, hit) {
  if (!fn?.body) return
  let rec = byAt.get(fn.at)
  if (!rec) {
    rec = {
      ...fn,
      anchor: hit?.needle || fn.anchor || '',
      anchorOff: hit?.off ?? fn.at,
      anchorScore: hit?.score ?? 0,
    }
    byAt.set(fn.at, rec)
    return rec
  }
  if (hit?.high && hit.score > rec.anchorScore) {
    rec.anchor = hit.needle
    rec.anchorOff = hit.off
    rec.anchorScore = hit.score
  }
  return rec
}

function harvest(buf, byAt, rows, poolCap) {
  const pool = []
  for (const row of rows) {
    if (!row.hits.length) continue
    const k = row.high ? 4 : 2
    for (const scored of topScored(buf, row.hits, row.needle.length, k)) {
      pool.push({
        off: scored.off,
        score: scored.score,
        needle: row.needle,
        high: row.high,
      })
    }
  }
  pool.sort((a, b) => b.score + (b.high ? 4 : 0) - (a.score + (a.high ? 4 : 0)))
  let tried = 0
  for (const hit of pool) {
    if (tried >= poolCap) break
    tried++
    let fn = enclosing(buf, hit.off, hit.needle)
    if (!fn) fn = extractArrow(buf, hit.off, hit.needle)
    const rec = addFn(byAt, fn, hit)
    if (rec && !rec.sum) rec.sum = summarizeFn(rec.body, rows)
  }
}

function followFieldFns(buf, byAt, rows) {
  const exprs = [...byAt.values()].filter(
    f =>
      f.body.includes('estimated re-cache') ||
      f.body.includes('re-caches') ||
      f.body.includes('seconds_since_last_response'),
  )
  const keys = new Set()
  for (const fn of exprs) {
    const re = /([A-Za-z_][A-Za-z0-9_]{8,}):/g
    let m
    while ((m = re.exec(fn.body))) {
      if (/cache|token|second|warm|ratio|spend/i.test(m[1])) keys.add(m[1])
    }
  }
  const picked = [...keys].slice(0, 5)
  const extraRows = []
  for (const key of picked) {
    const hits = allHits(buf, key)
    extraRows.push({ needle: key, kind: 'follow', high: false, hits, of: key })
    if (hits.length === 0 || hits.length > 80) continue
    for (const scored of topScored(buf, hits, key.length, 3)) {
      const fn = enclosing(buf, scored.off, key)
      if (!fn?.body || fn.len > 6000) continue
      const rec = addFn(byAt, fn, {
        needle: key,
        off: scored.off,
        score: scored.score,
        high: true,
      })
      if (rec) rec.sum = summarizeFn(rec.body, rows)
    }
  }
  return extraRows
}

function judge(n, all, anyHit) {
  if (!anyHit && all.length === 0) return 'MISS'
  if (!all.length) return anyHit ? 'STRING-ONLY' : 'MISS'
  if (n === 1) {
    const run = all.some(
      f =>
        f.body.includes('hook_event_name:"PreModelSwitch"') ||
        f.body.includes('hook_event_name:"PostModelSwitch"'),
    )
    const stale = all.some(
      f =>
        f.body.includes('seconds_since_last_response') &&
        f.body.includes('estimated_cache_write_usd'),
    )
    const map = all.some(
      f =>
        f.body.includes('PreModelSwitch:[') ||
        f.body.includes('PreModelSwitch:[]') ||
        f.body.includes('PreModelSwitch:{}'),
    )
    if (run || stale || map) return 'BODY'
    return 'STRING-ONLY'
  }
  if (n === 2) {
    const filter = all.some(
      f =>
        f.len < 800 &&
        f.body.includes('type==="tool_use"') &&
        f.body.includes('"tool_result"'),
    )
    const forward = all.some(
      f =>
        f.len < 1200 &&
        f.body.includes('writeSdkMessages') &&
        f.body.includes('parent_tool_use_id'),
    )
    const expand = all.some(
      f =>
        f.len < 2500 &&
        f.body.includes('yield') &&
        f.body.includes('tool_use_result'),
    )
    if ((filter && forward) || expand) return 'BODY'
    return 'STRING-ONLY'
  }
  if (n === 3) {
    const bar = all.some(
      f => f.body.includes('Spend limit') && f.body.includes('utilization'),
    )
    const field = all.some(
      f =>
        f.body.includes('spend_limit') &&
        (f.body.includes('rate_limits') || f.body.includes('overage')),
    )
    if (bar || field) return 'BODY'
    return 'STRING-ONLY'
  }
  if (n === 4) {
    const ok = all.some(
      f =>
        f.body.includes('prompt_cache') &&
        (f.body.includes('hit_ratio') ||
          f.body.includes('hitRatio') ||
          f.body.includes('misses')),
    )
    if (ok) return 'BODY'
    return 'STRING-ONLY'
  }
  if (n === 5) {
    const msg = all.some(
      f => f.body.includes('claude attach') && f.body.includes('resume'),
    )
    const cmd = all.some(
      f => f.body.includes('Usage: claude respawn') || f.body.includes('claude respawn'),
    )
    if (msg || cmd) return 'BODY'
    return 'STRING-ONLY'
  }
  return 'STRING-ONLY'
}

function bestNeedleOf(best, rows) {
  if (!best) {
    const hit = rows.find(r => r.hits.length > 0)
    return hit ? hit.needle : 'MISS'
  }
  const codeHigh = best.sum?.per?.find(p => p.high && p.codeN > 0)
  if (codeHigh) return codeHigh.needle
  if (best.anchor) return best.anchor
  const any = best.sum?.per?.find(p => p.codeN + p.proseN > 0)
  return any ? any.needle : 'MISS'
}

function markerLine(body, marker) {
  const sites = sitesIn(body, marker)
  if (!sites.length) return 'ABSENT'
  if (sites.some(s => s.kind === 'code')) return 'CODE'
  return 'PROSE'
}

function noteFor(n, all, rows, bgWindow) {
  if (n === 2) {
    const lines = []
    const filter = all.find(
      f =>
        f.len < 800 &&
        f.body.includes('type==="tool_use"') &&
        f.body.includes('"tool_result"'),
    )
    const gate = all.find(
      f => f.len < 400 && f.body.includes('forwardText') && f.body.includes('bEn('),
    )
    const expand = all.find(
      f =>
        f.len < 2500 &&
        f.body.includes('tool_use_result') &&
        f.body.includes('yield'),
    )
    const forward = all.find(
      f =>
        f.len < 1200 &&
        f.body.includes('writeSdkMessages') &&
        f.body.includes('parent_tool_use_id'),
    )
    const progress = all.find(
      f =>
        f.body.includes('task_progress') &&
        (f.body.includes('tool_uses') || f.body.includes('last_tool_name')),
    )
    lines.push(
      `tool-block filter=${filter ? `${filter.name}@${filter.at}` : 'ABSENT'}`,
    )
    lines.push(`forward gate=${gate ? `${gate.name}@${gate.at}` : 'ABSENT'}`)
    lines.push(
      `frame expand=${expand ? `${expand.name}@${expand.at}` : 'ABSENT'}`,
    )
    lines.push(
      `sdk write=${forward ? `${forward.name}@${forward.at}` : 'ABSENT'}`,
    )
    lines.push(
      `task_progress payload=${progress ? `${progress.name}@${progress.at}` : 'ABSENT'}`,
    )
    lines.push(
      `foreground subagent phrase=${markerLine(all.map(f => f.body).join('\n'), 'foreground subagent')}`,
    )
    if (bgWindow) {
      lines.push('bg-subagent context:')
      lines.push(bgWindow.slice(0, 700))
    }
    const stream = filter && (forward || expand)
    const bgGate = bgWindow.includes('forwardSubagentText')
    lines.push(
      stream
        ? `stream-vs-status: bEn/idt/san/Ce build and write tool_use/tool_result frames (parent_tool_use_id) on the SDK path. task_progress is a separate status payload (counts, last_tool_name).${bgGate ? ' Nested background agent_progress writes are gated by forwardSubagentText.' : ''} The phrase "foreground subagent" is not in these functions.`
        : 'stream-vs-status: no small function both filters tool_use/tool_result and writes or yields those frames. task_progress hits are status-shaped.',
    )
    return lines.join('\n')
  }
  const have = rows.filter(r => r.hits.length > 0).map(r => r.needle)
  const missing = rows.filter(r => r.hits.length === 0).map(r => r.needle)
  const bits = [
    `present=[${have.join(' | ') || '-'}]`,
    `absent=[${missing.join(' | ') || '-'}]`,
  ]
  if (n === 1) {
    const run = all.find(f => f.body.includes('hook_event_name:"PreModelSwitch"'))
    const post = all.find(f => f.body.includes('hook_event_name:"PostModelSwitch"'))
    const stale = all.find(
      f =>
        f.body.includes('seconds_since_last_response') &&
        f.body.includes('estimated_cache_write_usd'),
    )
    bits.push(`PreModelSwitch runner=${run ? `${run.name}@${run.at}` : 'ABSENT'}`)
    bits.push(`PostModelSwitch runner=${post ? `${post.name}@${post.at}` : 'ABSENT'}`)
    bits.push(
      `resume cache fields=${stale ? `${stale.name}@${stale.at}` : 'ABSENT'}`,
    )
  }
  if (n === 5) {
    const msg = all.find(f => f.body.includes('first to resume it here'))
    const cmd = all.find(f => f.body.includes('Usage: claude respawn'))
    bits.push(`resume message=${msg ? `${msg.name}@${msg.at}` : 'ABSENT'}`)
    bits.push(`respawn usage=${cmd ? `${cmd.name}@${cmd.at}` : 'ABSENT'}`)
  }
  return bits.join('\n')
}

function isKeep(fn, n) {
  const body = fn.body || ''
  if (!body || fn.len > 8000) return false
  if (n === 1) {
    return (
      body.includes('hook_event_name:"PreModelSwitch"') ||
      body.includes('hook_event_name:"PostModelSwitch"') ||
      (body.includes('seconds_since_last_response') &&
        body.includes('estimated_cache_write_usd')) ||
      (body.includes('estimated_cache_write_usd') &&
        body.includes('prompt_cache_warm') &&
        fn.len < 2200) ||
      (body.includes('context_tokens') &&
        body.includes('prompt_cache_warm') &&
        fn.len < 500) ||
      (body.includes('PreModelSwitch:[]') && fn.len < 1500)
    )
  }
  if (n === 2) {
    return (
      (body.includes('type==="tool_use"') &&
        body.includes('"tool_result"') &&
        fn.len < 250) ||
      (body.includes('tool_use_result') && body.includes('yield') && fn.len < 2500) ||
      (body.includes('forwardText') && body.includes('bEn(') && fn.len < 400) ||
      (body.includes('writeSdkMessages') &&
        body.includes('parent_tool_use_id') &&
        fn.len < 1200) ||
      (body.includes('subtype:"task_progress"') &&
        body.includes('last_tool_name') &&
        fn.len < 800)
    )
  }
  if (n === 3) {
    return (
      body.includes('title:"Spend limit"') ||
      (body.includes('spend_limit:{') && body.includes('overage'))
    )
  }
  if (n === 4) {
    return (
      (body.includes('prompt_cache:') && body.includes('hit_ratio')) ||
      (body.includes('tokens re-cached') && body.includes('hitRatio'))
    )
  }
  if (n === 5) {
    return (
      body.includes('Usage: claude respawn') ||
      body.includes('first to resume it here') ||
      (body.includes('claude attach') &&
        body.includes('claude logs') &&
        body.includes('claude stop'))
    )
  }
  return false
}

function chooseBest(n, ranked) {
  if (!ranked.length) return null
  if (n === 1) {
    const run = ranked.find(
      f =>
        f.len < 4000 && f.body.includes('hook_event_name:"PreModelSwitch"'),
    )
    if (run) return run
  }
  if (n === 2) {
    const stream = ranked.filter(
      f =>
        (f.body.includes('type==="tool_use"') &&
          f.body.includes('"tool_result"') &&
          f.len < 2000) ||
        (f.body.includes('tool_use_result') &&
          f.body.includes('yield') &&
          f.len < 4000) ||
        (f.body.includes('writeSdkMessages') &&
          f.body.includes('parent_tool_use_id') &&
          f.len < 1200),
    )
    if (stream.length) {
      stream.sort((a, b) => rankScore(b) - rankScore(a) || a.len - b.len)
      return stream[0]
    }
  }
  if (n === 5) {
    const msg = ranked.find(
      f => f.len < 2500 && f.body.includes('first to resume it here'),
    )
    if (msg) return msg
  }
  return ranked[0]
}

function supportList(ranked, best, n) {
  const rest = ranked.filter(f => !best || f.at !== best.at)
  const keep = rest
    .filter(f => isKeep(f, n))
    .sort((a, b) => a.len - b.len)
  const extra = rest.filter(
    f =>
      !isKeep(f, n) &&
      f.len <= 2500 &&
      rankScore(f) > 120 &&
      f.sum?.codeishKinds > 0,
  )
  const out = []
  const seen = new Set()
  for (const fn of [...keep, ...extra]) {
    if (seen.has(fn.at)) continue
    seen.add(fn.at)
    out.push(fn)
    if (out.length >= 6) break
  }
  return out
}

function forceNeedles(buf, byAt, rows, needles) {
  const extra = []
  for (const needle of needles) {
    const hits = allHits(buf, needle)
    extra.push({ needle, kind: 'follow', high: false, hits, of: needle })
    if (hits.length === 0 || hits.length > 800) continue
    for (const scored of topScored(buf, hits, needle.length, 5)) {
      let fn = enclosing(buf, scored.off, needle)
      if (!fn) fn = extractArrow(buf, scored.off, needle)
      if (!fn?.body || fn.len > 8000) continue
      const rec = addFn(byAt, fn, {
        needle,
        off: scored.off,
        score: scored.score + 40,
        high: true,
      })
      if (rec) rec.sum = summarizeFn(rec.body, rows)
    }
  }
  return extra
}

function followCallers(buf, byAt, rows) {
  const names = [...byAt.values()]
    .filter(f => isKeep(f, 2) && f.name && f.name !== 'arrow')
    .map(f => f.name)
  const uniq = [...new Set(names)].slice(0, 8)
  for (const name of uniq) {
    const needle = `${name}(`
    const hits = allHits(buf, needle)
    if (hits.length === 0 || hits.length > 40) continue
    for (const scored of topScored(buf, hits, needle.length, 3)) {
      const fn = enclosing(buf, scored.off, needle)
      if (!fn?.body || fn.len > 8000) continue
      const rec = addFn(byAt, fn, {
        needle,
        off: scored.off,
        score: scored.score,
        high: false,
      })
      if (rec) rec.sum = summarizeFn(rec.body, rows)
    }
  }
}

const buf = loadSea()
const when = new Date().toISOString()
const lines = []
lines.push('# gold-251-a bullets 1-5')
lines.push('')
lines.push(`- exe: ${EXE_251}`)
lines.push(`- bytes: ${buf.length}`)
lines.push(`- when: ${when}`)
lines.push(
  '- rule: changelog text is an index, not a contract. BODY only when an extracted JS function body implements the needle behavior. STRING-ONLY when the string is present and control flow is not locked. MISS when needles are absent.',
)
lines.push('')

const table = []

for (const bullet of BULLETS) {
  console.error(`bullet #${bullet.n} scanning`)
  const rows = bullet.needles.flatMap(spec => resolveRows(buf, spec))
  const anyHit = rows.some(r => r.hits.length > 0)
  const byAt = new Map()
  harvest(buf, byAt, rows, 22)
  let followRows = []
  if (bullet.n === 1) {
    followRows = followFieldFns(buf, byAt, rows)
    followRows.push(
      ...forceNeedles(buf, byAt, rows, [
        'hook_event_name:"PreModelSwitch"',
        'hook_event_name:"PostModelSwitch"',
      ]),
    )
  }
  if (bullet.n === 2) {
    followRows = forceNeedles(buf, byAt, rows, [
      'r?.type==="tool_result"',
      'type==="tool_result"',
      'tool_use_result:',
      'parent_tool_use_id!=null',
    ])
    followCallers(buf, byAt, rows)
    followCallers(buf, byAt, rows)
  }
  if (bullet.n === 5) {
    followRows = forceNeedles(buf, byAt, rows, ['Usage: claude respawn'])
  }
  for (const rec of byAt.values()) {
    if (!rec.sum) rec.sum = summarizeFn(rec.body, rows)
  }
  const ranked = pickBest([...byAt.values()])
  const best = anyHit || ranked.length ? chooseBest(bullet.n, ranked) : null
  const support = supportList(ranked, best, bullet.n)
  const all = [best, ...support].filter(Boolean)
  const verdict = judge(bullet.n, all, anyHit)
  const bestNeedle = verdict === 'MISS' ? 'MISS' : bestNeedleOf(best, rows)
  const bestRow = rows.find(r => r.needle === bestNeedle)
  const followRow = followRows.find(r => r.needle === bestNeedle)
  const hitCount = bestRow
    ? bestRow.hits.length
    : followRow
      ? followRow.hits.length
      : 0
  const fnName = best?.name || 'MISS'

  let bgWindow = ''
  if (bullet.n === 2) {
    const bgNeedle = 'bg-subagent nested progress write failed'
    const bgHits = allHits(buf, bgNeedle)
    let bgAt = -1
    let bgScore = -1
    for (const off of bgHits) {
      const score = jsScore(buf, off, bgNeedle.length)
      if (score > bgScore) {
        bgScore = score
        bgAt = off
      }
    }
    if (bgAt >= 0 && bgScore >= 0) {
      bgWindow = asciiSlice(buf, bgAt - 620, bgAt + 40).replace(/\s+/g, ' ')
    }
  }

  table.push({
    n: bullet.n,
    verdict,
    needle: bestNeedle,
    hits: verdict === 'MISS' ? 0 : hitCount,
    fn: verdict === 'MISS' ? 'MISS' : fnName,
  })

  lines.push(`## #${bullet.n}`)
  lines.push('')
  lines.push(`- verdict: ${verdict}`)
  lines.push(`- best needle: ${bestNeedle}`)
  lines.push(`- best needle hits: ${verdict === 'MISS' ? 0 : hitCount}`)
  if (best) {
    lines.push(
      `- function: ${best.name || '?'} @${best.at} len=${best.len} sha=${best.sha} via=${best.via}`,
    )
    lines.push(
      `- anchor: ${best.anchor} @${best.anchorOff} jsScore=${best.anchorScore} rank=${rankScore(best).toFixed(1)}`,
    )
    lines.push(
      `- judge: standaloneHigh=${best.sum.standaloneHigh} codeishKinds=${best.sum.codeishKinds} codeish=${best.sum.codeish} flow=${best.sum.flow}`,
    )
  } else {
    lines.push('- function: MISS')
    lines.push('- sha: NONE')
  }
  lines.push('')
  lines.push('### hit counts')
  lines.push('')
  for (const row of rows) {
    lines.push(
      `- \`${row.needle}\` ${row.kind}${row.kind === 'variant' ? ` of \`${row.of}\`` : ''} high=${row.high} hits=${row.hits.length} first8=${fmtOffsets(row.hits)}`,
    )
  }
  for (const row of followRows) {
    lines.push(
      `- \`${row.needle}\` follow hits=${row.hits.length} first8=${fmtOffsets(row.hits)}`,
    )
  }
  lines.push('')

  if (best?.body) {
    lines.push('### needles inside function')
    lines.push('')
    for (const p of best.sum.per) {
      const rel = p.first
        ? `@${p.first.at} ${p.first.kind} literalLen=${p.first.literalLen} standalone=${p.first.standalone}`
        : 'ABSENT'
      lines.push(`- \`${p.needle}\` code=${p.codeN} prose=${p.proseN} ${rel}`)
    }
    lines.push('')
    lines.push('### excerpt')
    lines.push('')
    lines.push(`fullLen=${best.len} sha=${best.sha} excerptCap=3500`)
    lines.push(fence(excerptAround(best.body, excerptFocus(best), 3500)))
    lines.push('')
  } else if (anyHit) {
    lines.push('### string contexts (no locked function)')
    lines.push('')
    const shown = []
    for (const row of rows) {
      if (!row.hits.length) continue
      const top = topScored(buf, row.hits, row.needle.length, 1)[0]
      if (!top) continue
      shown.push({ ...top, needle: row.needle })
      if (shown.length >= 4) break
    }
    for (const hit of shown) {
      lines.push(`- \`${hit.needle}\` @${hit.off} jsScore=${hit.score}`)
      lines.push(
        fence(
          asciiSlice(buf, hit.off - 160, hit.off + hit.needle.length + 200),
        ),
      )
      lines.push('')
    }
  }

  if (support.length) {
    lines.push('### other extracted functions')
    lines.push('')
    for (const c of support) {
      const names = (c.sum?.per || [])
        .filter(p => p.codeN > 0)
        .map(p => p.needle)
        .join(', ')
      lines.push(
        `- ${c.name || '?'} @${c.at} len=${c.len} sha=${c.sha} via=${c.via} rank=${rankScore(c).toFixed(1)} codeNeedles=[${names || '-'}]`,
      )
      lines.push(fence(excerptAround(c.body, excerptFocus(c), 1600)))
      lines.push('')
    }
  }

  lines.push('### note')
  lines.push('')
  lines.push(noteFor(bullet.n, all, [...rows, ...followRows], bgWindow))
  lines.push('')
  console.error(
    `#${bullet.n} ${verdict} needle=${bestNeedle} hits=${hitCount} fn=${fnName}`,
  )
}

writeFileSync(outPath, lines.join('\n'))
console.log(`wrote ${outPath}`)
console.log('bullet\tverdict\tbest_needle\thit_count\tfunction')
for (const row of table) {
  console.log(`${row.n}\t${row.verdict}\t${row.needle}\t${row.hits}\t${row.fn}`)
}
