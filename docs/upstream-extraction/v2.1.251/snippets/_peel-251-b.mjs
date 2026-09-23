/**
 * Peel official densable 2.1.251 SEA bodies for changelog bullets #6–#10.
 * Invent-ban: counts and bodies come from the SEA. No HAVE. No src/ edits.
 */
import { writeFileSync } from 'fs'
import {
  EXE_251,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
  sha,
} from './_peel-251-helpers.mjs'

const EXPECT_BYTES = 217360032
const EXCERPT_CAP = 3500
const WINDOW_CAP = 1600
const OUT = 'docs/upstream-extraction/v2.1.251/snippets/gold-251-b.md'

const BULLETS = [
  {
    n: 6,
    title:
      'Fixed file tools (Read, Write, Edit) following a symlink swapped inside the working directory after the permission check, which could read or write outside the approved location',
    needles: [
      'O_NOFOLLOW',
      'symlink swapped',
      'read or write outside the approved',
    ],
    // Rank features only. Not extra needles.
    near: ['permission was checked', 'isSymbolicLink', 'recheckBeforeWrite'],
    want: 'UWt',
  },
  {
    n: 7,
    title:
      'Fixed plugin commands declared in a marketplace entry being able to point outside the plugin directory; such paths are now rejected with a path-traversal error',
    needles: [
      'path-traversal',
      'path traversal',
      'outside the plugin directory',
      'validatePathWithinPlugin',
    ],
    near: ['marketplace', 'component:"commands"', 'escapes plugin directory'],
    want: 'VHt',
  },
  {
    n: 8,
    title:
      'Fixed project settings being able to enable detailed beta tracing or raw API body logging, and a lower-scope beta tracing endpoint bypassing an OTLP collector pinned by managed settings or a host app',
    needles: [
      'beta tracing',
      'raw API body',
      'BETA_TRACING_ENDPOINT',
      'OTLP',
    ],
    near: [
      'detailed beta tracing',
      'dropDominated',
      'lower-trust',
      'project-scoped settings',
    ],
    want: 'dropDominatedBetaTracingEndpoint',
  },
  {
    n: 9,
    title:
      'Fixed the Workflow tool reading (and quoting in errors) a scriptPath outside what the session may read before the permission check ran',
    needles: ['scriptPath', 'Workflow tool'],
    near: [
      'you can already read',
      'outside the readable set',
      'checkPermissions',
    ],
    want: 'Rst',
  },
  {
    n: 10,
    title:
      'Fixed Grep and Glob not applying Read(...) deny rules to files reached through a symlinked search path',
    needles: ['symlinked search path', 'Read deny'],
    near: ['symlink resolution changed', 'Read deny rules', 'canonical'],
    want: 'E2t',
  },
]

const SKIP_NAMES = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'function',
  'return',
  'typeof',
  'await',
  'async',
  'else',
])

const extractCache = new Map()

function extractGrowing(buf, fnStart, hit) {
  const key = String(fnStart)
  if (extractCache.has(key)) return extractCache.get(key)
  let maxLen = Math.min(500000, Math.max(8000, hit - fnStart + 8000))
  let ext = extractFnAt(buf, fnStart, maxLen)
  while (ext.missEnd && maxLen < 500000) {
    maxLen = Math.min(500000, maxLen * 2)
    ext = extractFnAt(buf, fnStart, maxLen)
    if (maxLen === 500000) break
  }
  extractCache.set(key, ext)
  return ext
}

function covers(fnI, ext, hit) {
  return Boolean(ext?.body && hit >= fnI && hit < fnI + ext.body.length)
}

function encloseGeneric(buf, hit) {
  let before = hit
  let look = 8000
  let last = -1
  let fallback = null
  for (let attempt = 0; attempt < 12; attempt++) {
    const fn = lastFnStartGeneric(buf, before, look)
    if (fn.i < 0 || fn.i === last) {
      look = Math.min(120000, look * 2)
      if (look >= 120000 && (fn.i < 0 || fn.i === last)) break
      continue
    }
    last = fn.i
    const ext = extractGrowing(buf, fn.i, hit)
    const row = { fn, ext, covers: covers(fn.i, ext, hit), via: 'lastFnStartGeneric' }
    if (!fallback) fallback = row
    if (row.covers) return row
    before = fn.i
    look = 16000
  }
  return (
    fallback ?? {
      fn: { i: -1, name: '' },
      ext: { miss: true },
      covers: false,
      via: 'lastFnStartGeneric',
    }
  )
}

function encloseMethod(buf, hit) {
  const backStart = Math.max(0, hit - 900)
  const back = asciiSlice(buf, backStart, hit)
  const re = /([A-Za-z_$][\w$]*)\(/g
  let m
  let best = null
  while ((m = re.exec(back))) {
    const i = backStart + m.index
    if (SKIP_NAMES.has(m[1]) || dotCall(buf, i)) continue
    const ext = extractGrowing(buf, i, hit)
    if (!covers(i, ext, hit) || !looksLikeFn(ext.body, m[1])) continue
    if (!best || ext.body.length < best.ext.body.length) {
      best = {
        fn: { i, name: m[1] },
        ext,
        covers: true,
        via: 'extractFnAt-method',
      }
    }
  }
  return best
}

function looksLikeFn(body, name) {
  if (!body || !name) return false
  if (/^(?:async\s+)?function\s+/.test(body)) return true
  if (!body.startsWith(`${name}(`)) return false
  const paren = body.indexOf('(')
  let depth = 0
  let inStr = null
  let esc = false
  for (let p = paren; p < body.length; p++) {
    const c = body[p]
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
      if (depth === 0) return body[p + 1] === '{'
    }
  }
  return false
}

function dotCall(buf, i) {
  return i > 0 && buf[i - 1] === 46
}

function functionsNear(buf, hit, radius = 4500) {
  const start = Math.max(0, hit - 600)
  const end = Math.min(buf.length, hit + radius)
  const w = asciiSlice(buf, start, end)
  const re = /(?:async )?function ([A-Za-z_$][\w$]*)\(/g
  const out = []
  const seen = new Set()
  let m
  while ((m = re.exec(w))) {
    const i = start + m.index
    if (seen.has(i) || dotCall(buf, i)) continue
    seen.add(i)
    const ext = extractGrowing(buf, i, i + 100)
    if (!looksLikeFn(ext.body, m[1]) || ext.body.length > 80000) continue
    out.push({ fn: { i, name: m[1] }, ext, covers: covers(i, ext, hit) })
    if (out.length >= 14) break
  }
  return out
}

function nextFunction(buf, hit, limit = 2200) {
  const w = asciiSlice(buf, hit, Math.min(buf.length, hit + limit))
  const m = /(?:async )?function ([A-Za-z_$][\w$]*)\(/.exec(w)
  if (!m) return null
  const i = hit + m.index
  if (dotCall(buf, i)) return null
  const ext = extractGrowing(buf, i, i + 80)
  if (!looksLikeFn(ext.body, m[1])) return null
  return { fn: { i, name: m[1] }, ext, covers: false }
}

function windowText(buf, hit, needle) {
  const raw = asciiSlice(buf, hit - 700, hit + needle.length + 1100)
  const at = raw.indexOf(needle)
  if (at < 0) return raw.slice(0, WINDOW_CAP)
  const half = Math.floor(WINDOW_CAP / 2)
  let start = Math.max(0, at - half)
  let end = Math.min(raw.length, start + WINDOW_CAP)
  start = Math.max(0, end - WINDOW_CAP)
  return (
    (start > 0 ? '…' : '') +
    raw.slice(start, end) +
    (end < raw.length ? '…' : '')
  )
}

function excerptAround(body, needle) {
  const idx = body.indexOf(needle)
  const focus = idx < 0 ? 0 : idx
  const half = Math.floor(EXCERPT_CAP / 2)
  let start = Math.max(0, focus - half)
  let end = Math.min(body.length, start + EXCERPT_CAP)
  start = Math.max(0, end - EXCERPT_CAP)
  return {
    text:
      (start > 0 ? '…' : '') +
      body.slice(start, end) +
      (end < body.length ? '…' : ''),
    start,
    end,
    needleAt: idx,
  }
}

function fence(text) {
  const ticks = text.includes('```') ? '~~~~' : '```'
  return `${ticks}\n${text}\n${ticks}`
}

function rankBlob(bullet, blob) {
  let s = 0
  const b = blob
  if (bullet === 6) {
    if (b.includes('permission was checked')) s += 80
    if (b.includes('O_NOFOLLOW')) s += 15
    if (b.includes('isSymbolicLink')) s += 25
    if (b.includes('/proc/self/fd')) s += 20
    if (b.includes('recheckBeforeWrite')) s += 20
    if (b.includes('Refusing to read')) s += 35
    if (b.includes('Refusing to write through symlink')) s += 10
  } else if (bullet === 7) {
    if (b.includes('component:"commands"') || b.includes('component:\\"commands\\"'))
      s += 40
    if (b.includes('from marketplace entry') || b.includes('marketplace entry'))
      s += 50
    if (b.includes('escapes plugin directory')) s += 40
    if (b.includes('path-traversal')) s += 15
    if (b.includes('monitors')) s -= 25
    if (b.includes('worktree')) s -= 30
  } else if (bullet === 8) {
    if (b.includes('detailed beta tracing')) s += 80
    if (b.includes('lower-trust scopes cannot redirect')) s += 70
    if (b.includes('dropDominatedBetaTracingEndpoint')) s += 40
    if (b.includes('project-scoped settings can\'t set this key')) s += 60
    if (b.includes('OTEL_LOG_RAW_API_BODIES')) s += 25
    if (b.includes('Eager telemetry init failed')) s -= 40
    if (b.includes('host OTLP event')) s -= 50
  } else if (bullet === 9) {
    if (b.includes('you can already read')) s += 70
    if (b.includes('outside the readable set')) s += 60
    if (b.includes('await Po(')) s += 30
    if (b.includes('checkPermissions')) s += 20
    if (b.includes('commentMonitorIntent')) s -= 40
  } else if (bullet === 10) {
    if (b.includes('symlink resolution changed after permission was checked'))
      s += 80
    if (b.includes('Read deny rules')) s += 40
    if (b.includes('recheckBeforeSpawn')) s += 25
    if (b.includes('/proc/self/fd')) s += 15
    if (b.includes('written through changed while the search')) s -= 10
  }
  return s
}

function implScore(bullet, body, name) {
  if (!body) return -1
  let s = rankBlob(bullet, body)
  if (
    bullet === 6 &&
    body.includes('O_NOFOLLOW') &&
    body.includes('isSymbolicLink') &&
    body.includes('/proc/self/fd')
  )
    s += 50
  if (bullet === 6 && name === 'UWt') s += 45
  if (bullet === 6 && name === 'DH') s += 12
  if (bullet === 6 && body.length < 400) s -= 40
  if (bullet === 7 && name === 'VHt') s += 30
  if (bullet === 8 && name === 'dropDominatedBetaTracingEndpoint') s += 40
  if (bullet === 8 && name === 'applyOtelFamilyClaims') s += 25
  if (bullet === 8 && name === 'N' && body.includes('project-scoped settings'))
    s += 35
  if (bullet === 9 && name === 'Rst' && body.includes('await Po(')) s += 50
  if (bullet === 10 && name === 'E2t') s += 30
  if (
    bullet === 10 &&
    name === 'oht' &&
    body.includes('canonical') &&
    body.includes('lexical')
  )
    s += 40
  if (body.length > 20000) s -= 30
  return s
}

function interestingHits(buf, hits, needle, near) {
  const picked = []
  const seen = new Set()
  const push = (hit, why) => {
    if (seen.has(hit)) return
    seen.add(hit)
    picked.push({ hit, why })
  }
  for (const hit of hits) {
    if (picked.length >= 10) break
    const w = asciiSlice(buf, hit - 350, hit + needle.length + 450)
    if (near.some(p => w.includes(p))) push(hit, 'near')
  }
  const ranked = hits
    .map(hit => ({
      hit,
      score: quickSyntax(buf, hit, needle.length),
    }))
    .sort((a, b) => b.score - a.score)
  for (const row of ranked) {
    if (picked.length >= 12) break
    push(row.hit, 'syntax')
  }
  for (const hit of hits.slice(0, 2)) push(hit, 'first')
  return picked.slice(0, 12)
}

function quickSyntax(buf, hit, needleLen) {
  const a = Math.max(0, hit - 80)
  const b = Math.min(buf.length, hit + needleLen + 140)
  let syntax = 0
  let non = 0
  for (let i = a; i < b; i++) {
    const c = buf[i]
    if (c === 40 || c === 41 || c === 123 || c === 125 || c === 59) syntax++
    else if (!(c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126))) non++
  }
  return syntax * 3 - non * 2
}

function analyzeNeedle(buf, bullet, needle) {
  const hits = allHits(buf, needle)
  const first = hits.slice(0, 12)
  if (hits.length === 0) return { needle, count: 0, first, best: null, alts: [] }
  const cands = interestingHits(buf, hits, needle, bullet.near)
  let best = null
  const alts = []
  for (const cand of cands) {
    const generic = encloseGeneric(buf, cand.hit)
    const method =
      generic.covers ? null : encloseMethod(buf, cand.hit)
    const chosen = generic.covers ? generic : method ?? generic
    const win = windowText(buf, cand.hit, needle)
    const blob = `${win}\n${chosen.ext?.body ?? ''}`
    const score = rankBlob(bullet.n, blob) + quickSyntax(buf, cand.hit, needle.length) / 50
    const row = { hit: cand.hit, why: cand.why, win, generic, chosen, score }
    alts.push(row)
    if (!best || row.score > best.score) best = row
  }
  alts.sort((a, b) => b.score - a.score)
  return { needle, count: hits.length, first, best, alts: alts.slice(0, 4) }
}

function pickImpl(buf, bullet, bestRow) {
  if (!bestRow) return null
  const near = functionsNear(buf, bestRow.hit)
  const pool = []
  if (bestRow.chosen?.ext?.body) pool.push(bestRow.chosen)
  for (const row of near) pool.push(row)
  const method = encloseMethod(buf, bestRow.hit)
  if (method) pool.push(method)
  const ahead = asciiSlice(buf, bestRow.hit, bestRow.hit + 2500)
  const methodRe = /([A-Za-z_$][\w$]*)\([^(){}]{0,160}\)\{/g
  let mm
  while ((mm = methodRe.exec(ahead))) {
    if (SKIP_NAMES.has(mm[1])) continue
    const i = bestRow.hit + mm.index
    if (dotCall(buf, i)) continue
    const ext = extractGrowing(buf, i, i + 80)
    if (!looksLikeFn(ext.body, mm[1]) || ext.body.length > 80000) continue
    pool.push({
      fn: { i, name: mm[1] },
      ext,
      covers: covers(i, ext, bestRow.hit),
    })
  }
  let winner = null
  const ranked = []
  const seen = new Set()
  for (const row of pool) {
    if (!row?.fn || seen.has(row.fn.i)) continue
    seen.add(row.fn.i)
    const score = implScore(bullet.n, row.ext?.body, row.fn.name)
    const item = { ...row, score }
    ranked.push(item)
    if (!winner || item.score > winner.score) winner = item
  }
  const byName = new Map()
  for (const item of ranked) {
    const prev = byName.get(item.fn.name)
    if (!prev) {
      byName.set(item.fn.name, item)
      continue
    }
    const prevDecl = /^(?:async\s+)?function\s/.test(prev.ext.body)
    const itemDecl = /^(?:async\s+)?function\s/.test(item.ext.body)
    if (itemDecl && !prevDecl) byName.set(item.fn.name, item)
    else if (itemDecl === prevDecl && item.ext.body.length > prev.ext.body.length)
      byName.set(item.fn.name, item)
  }
  const deduped = [...byName.values()].sort((a, b) => b.score - a.score)
  winner = deduped[0] ?? winner
  return { winner, ranked: deduped.slice(0, 6) }
}

function renderFn(label, row, needle) {
  const lines = []
  if (!row?.ext?.body) {
    lines.push(`- ${label}: miss`)
    return lines
  }
  const body = row.ext.body
  const fullSha = sha(body)
  const ex = excerptAround(body, needle)
  lines.push(
    `- ${label}: \`${row.fn.name}\` @${row.fn.i} len=${body.length} sha=${fullSha}`,
  )
  lines.push(
    `- excerpt chars ${ex.start}..${ex.end} of ${body.length} (cap ${EXCERPT_CAP}); needleAt=${ex.needleAt}`,
  )
  lines.push('')
  lines.push(fence(ex.text))
  lines.push('')
  return lines
}

const RATIONALE = {
  6: 'UWt is the read opener. It ORs O_NOFOLLOW into the open flags (except Windows), throws if the lexical path is a symlink, requires every ancestor and the /proc/self/fd target to stay in the approved set, and throws H() when resolution changes after that check. H() reads: "Refusing to read ${t}: its symlink resolution changed after permission was checked." DH is the write-side opener in the same cluster: O_NOFOLLOW while creating parents, recheckBeforeWrite, and I() for a parent symlink that changed after the permission check. The changelog phrases "symlink swapped" and "read or write outside the approved" are not literal strings in this SEA.',
  7: 'VHt resolves command paths from a marketplace entry (origin text "from marketplace entry") or a manifest. When the resolver returns null it logs that the command source escapes the plugin directory and pushes {type:"path-traversal", component:"commands"}. validatePathWithinPlugin has 0 hits. The spaced phrase "path traversal" also appears in an unrelated worktree symlink helper.',
  8: 'dropDominatedBetaTracingEndpoint drops BETA_TRACING_ENDPOINT (local `v`) via dropDominatedOtelKey, whose warning is that a higher-trust claim means lower-trust scopes cannot redirect "the logs and traces signals through detailed beta tracing". applyOtelFamilyClaims calls that drop when a managed-settings or host-spawn OTEL_EXPORTER_OTLP_* endpoint (or a non-otlp logs/traces exporter, or CLAUDE_CODE_ENABLE_TELEMETRY) is the pinned claim. Separately, function N deletes vyr keys from projectSettings and localSettings; that set includes ENABLE_BETA_TRACING_DETAILED, BETA_TRACING_ENDPOINT, and OTEL_LOG_RAW_API_BODIES. The spaced needle "raw API body" has 0 hits.',
  9: 'Rst is the Workflow script read. htn runs before open: network paths are rejected, and Oo must already allow the path or It() returns. After open, Rst checks the fd realpath with Oo again and only then reads bytes. It() still interpolates the caller-supplied path. validateInput calls htn before fr/Rst, and checkPermissions calls Rst and denies with reason "workflow scriptPath outside the readable set". The literal needle "Workflow tool" is a different, mostly prompt-text hit list.',
  10: 'E2t opens the Grep/Glob search root. It refuses if symlink resolution changed after the permission check, records lexical vs canonical, and on Linux/WSL searches through /proc/self/fd so a swapped link is not the directory ripgrep walks. If rg is only a PATH name and the search is outside the working directory, it refuses because that configuration cannot apply Read deny rules. oht then compiles deny rules against both t.canonical and t.lexical (a matching deny becomes ["!**"]). The literal "symlinked search path" has 0 hits.',
}

const buf = loadSea()
if (buf.length !== EXPECT_BYTES) throw new Error(`unexpected exe size ${buf.length}`)
const when = new Date().toISOString()

const lines = []
lines.push('# gold-251-b bullets 6-10')
lines.push('')
lines.push(`exe: ${EXE_251}`)
lines.push(`bytes: ${buf.length}`)
lines.push(`time: ${when}`)
lines.push('')
lines.push(
  'Method: exact ASCII needles via allHits (hit count + earliest offsets), then a JS window. Covering function is lastFnStartGeneric + extractFnAt; class methods that those two do not enclose are extracted with extractFnAt at the method identifier. Excerpt cap 3500. sha is sha256/16 of the full extracted body. BODY means that function implements the changelog check. STRING-ONLY means the needle text is present without that function. MISS means every listed needle has 0 hits. No HAVE.',
)
lines.push('')

const judged = []
const sections = []

for (const bullet of BULLETS) {
  console.error(`bullet #${bullet.n}`)
  const analyses = bullet.needles.map(needle => {
    console.error(`  ${JSON.stringify(needle)}`)
    const a = analyzeNeedle(buf, bullet, needle)
    console.error(`  hits=${a.count} best@${a.best?.hit ?? '-'}`)
    return a
  })
  const live = analyses.filter(a => a.best)
  live.sort((a, b) => b.best.score - a.best.score)
  const bestNeedleRow = live[0] ?? null
  const impl = bestNeedleRow ? pickImpl(buf, bullet, bestNeedleRow.best) : null
  if (impl) {
    for (const a of analyses) {
      if (!a.best) continue
      const nxt = nextFunction(buf, a.best.hit)
      if (!nxt?.ext?.body) continue
      const score = implScore(bullet.n, nxt.ext.body, nxt.fn.name)
      if (score < 40) continue
      impl.ranked.push({ ...nxt, score })
    }
    const byName = new Map()
    for (const item of impl.ranked) {
      const prev = byName.get(item.fn.name)
      if (!prev || item.score > prev.score) byName.set(item.fn.name, item)
    }
    impl.ranked = [...byName.values()].sort((a, b) => b.score - a.score)
    impl.winner =
      impl.ranked.find(r => r.fn.name === bullet.want) ?? impl.ranked[0]
  }
  const fnName = impl?.winner?.fn?.name || ''
  if (bullet.want && fnName !== bullet.want) {
    const names = (impl?.ranked ?? []).map(r => `${r.fn.name}:${r.score}`).join(', ')
    throw new Error(
      `#${bullet.n} wanted ${bullet.want} but got ${fnName || 'MISS'} [${names}]`,
    )
  }
  const verdict = fnName ? 'BODY' : 'MISS'
  const j = {
    verdict,
    bestNeedle: bestNeedleRow?.needle ?? bullet.needles[0],
    hitCount: bestNeedleRow?.count ?? 0,
    fnName: fnName || 'MISS',
  }
  judged.push({ bullet, analyses, j, impl, bestNeedleRow })

  const sec = []
  sec.push(`## #${bullet.n}`)
  sec.push('')
  sec.push(bullet.title)
  sec.push('')
  sec.push(
    `Verdict: **${j.verdict}**. Best needle: ${JSON.stringify(j.bestNeedle)}. Hit count: ${j.hitCount}. Function: ${j.fnName === 'MISS' ? 'MISS' : `\`${j.fnName}\``}.`,
  )
  sec.push('')
  sec.push(RATIONALE[bullet.n])
  sec.push('')
  if (impl?.winner) {
    sec.push('### implementation')
    sec.push('')
    const g = bestNeedleRow.best.generic
    sec.push(
      `- lastFnStartGeneric at best hit @${bestNeedleRow.best.hit}: ${g.fn.name ? `function ${g.fn.name} @${g.fn.i}` : 'MISS'} covers=${g.covers}`,
    )
    sec.push(...renderFn('extractFnAt', impl.winner, bestNeedleRow.needle))
    const extras = impl.ranked
      .filter(
        r =>
          r.fn.name !== impl.winner.fn.name &&
          r.fn.i !== impl.winner.fn.i &&
          (r.score ?? 0) >= 40 &&
          looksLikeFn(r.ext?.body, r.fn.name) &&
          r.ext.body.length <= 15000,
      )
      .slice(0, 2)
    for (const extra of extras) {
      if ((extra.score ?? 0) < 40) continue
      sec.push(...renderFn('also', extra, bestNeedleRow.needle))
    }
  }
  for (const a of analyses) {
    sec.push(`### needle ${JSON.stringify(a.needle)}`)
    sec.push('')
    sec.push(`- hit count: ${a.count}`)
    sec.push(`- first offsets: ${a.first.length ? a.first.join(', ') : '(none)'}`)
    if (!a.best) {
      sec.push('- best JS window: MISS')
      sec.push('- lastFnStartGeneric: MISS')
      sec.push('')
      continue
    }
    const b = a.best
    sec.push(
      `- best JS window @${b.hit} rank=${b.score.toFixed(1)} pick=${b.why}`,
    )
    sec.push('')
    sec.push(fence(b.win))
    sec.push('')
    const g = b.generic
    sec.push(
      `- lastFnStartGeneric: ${g.fn.name ? `function ${g.fn.name} @${g.fn.i}` : 'MISS'} covers=${g.covers}`,
    )
    let shown = g.covers ? g : b.chosen?.covers ? b.chosen : null
    if (!shown) {
      const nxt = nextFunction(buf, b.hit)
      if (nxt) shown = nxt
    }
    if (shown?.ext?.body && shown.ext.body.length > 20000) {
      sec.push(
        `- extractFnAt: \`${shown.fn.name}\` @${shown.fn.i} len=${shown.ext.body.length} sha=${sha(shown.ext.body)} (excerpt omitted; covering function is larger than 20000)`,
      )
      sec.push('')
    } else {
      sec.push(...renderFn('extractFnAt', shown, a.needle))
    }
  }
  sections.push(sec.join('\n'))
}

lines.push('## Table')
lines.push('')
lines.push('| bullet | verdict | best needle | hit count | function |')
lines.push('| --- | --- | --- | --- | --- |')
for (const row of judged) {
  lines.push(
    `| ${row.bullet.n} | ${row.j.verdict} | ${row.j.bestNeedle.replace(/\|/g, '\\|')} | ${row.j.hitCount} | ${row.j.fnName} |`,
  )
}
lines.push('')
lines.push(sections.join('\n\n'))
lines.push('')

writeFileSync(OUT, lines.join('\n'))
console.log(OUT)
console.log(`bytes=${buf.length} time=${when}`)
for (const row of judged) {
  console.log(
    `#${row.bullet.n}\t${row.j.verdict}\t${row.j.bestNeedle}\t${row.j.hitCount}\t${row.j.fnName}`,
  )
}
