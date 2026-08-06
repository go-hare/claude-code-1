/**
 * densable 2.1.214 — reconstructed from claude.exe (minified names in comments)
 * Scope: memory frontmatter inline `#` loss + stamp pipeline (#37 / #10)
 * Source offsets ~233050250–233054100 (parse/serialize helpers),
 * ~233098433 (bMe/CBc/cXh), ~234998170 (Zto stampNewMemoryContent)
 */

// J5
function parseYaml(e) {
  return Bun.YAML.parse(e)
}

// SYt
function stringifyYamlDoc(e) {
  return Bun.YAML.stringify(e, null, 2) + '\n'
}

// FYh
const YAML_SPECIAL = /[{}[\]*&#!|>%@`]|: /

// UYh — quote only when full-document parse fails (skills path)
function quoteProblematicValues(e) {
  let t = e.split('\n'),
    r = []
  for (let n of t) {
    let o = n.match(/^([a-zA-Z_-]+):\s+(.+)$/)
    if (o) {
      let [, i, s] = o
      if (!i || !s) {
        r.push(n)
        continue
      }
      if (
        (s.startsWith('"') && s.endsWith('"')) ||
        (s.startsWith("'") && s.endsWith("'"))
      ) {
        r.push(n)
        continue
      }
      if (s.startsWith('[') && s.endsWith(']'))
        try {
          if (Array.isArray(parseYaml(s))) {
            r.push(n)
            continue
          }
        } catch {}
      if (YAML_SPECIAL.test(s)) {
        let a = s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
        r.push(`${i}: "${a}"`)
        continue
      }
    }
    r.push(n)
  }
  return r.join('\n')
}

// BYh — proactive lossy-scalar re-quote (quoteLossyValues path)
function detectAndQuoteLossyFrontmatterValues(e) {
  let quotedKeys = [],
    unprovableKeys = [],
    lines = e.split('\n').map(o => {
      let hadCr = o.endsWith('\r'),
        s = hadCr ? o.slice(0, -1) : o,
        a = s.match(/^([A-Za-z0-9_][A-Za-z0-9_.-]*):[ \t]+(.*)$/)
      if (!a) {
        collectUnprovableHashKeys(s, unprovableKeys)
        return o
      }
      let [, l, c] = a
      if (!l || !c) return o
      let u = c.trimEnd()
      if (u === '') return o
      if (/^["'|>]/.test(u)) {
        collectUnprovableHashKeys(s, unprovableKeys)
        return o
      }
      let d
      try {
        d = parseYaml(u)
      } catch {
        return o
      }
      if (typeof d !== 'string' && d !== null) {
        collectUnprovableHashKeys(s, unprovableKeys)
        return o
      }
      if (
        !(
          (typeof d === 'string' && d !== u) ||
          (d === null && !['null', 'Null', 'NULL', '~'].includes(u))
        )
      )
        return o
      quotedKeys.push(l)
      let f = u.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
      return `${l}: "${f}"${hadCr ? '\r' : ''}`
    })
  return {
    text: quotedKeys.length === 0 ? null : lines.join('\n'),
    quotedKeys,
    unprovableKeys,
  }
}

// xji
function collectUnprovableHashKeys(e, t) {
  let r =
    e.match(/^("(?:[^"\\]|\\.)*"):[ \t]+(.*)$/) ??
    e.match(/^('(?:[^']|'')*'):[ \t]+(.*)$/) ??
    e.match(/^([^\s#][^:\n]*?):[ \t]+(.*)$/)
  if (r === null) return
  let [, n, o] = r
  if (!n || !o) return
  let i = o
    .trimEnd()
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'/g, '')
  if (/^#|[ \t]#/.test(i)) t.push(n)
}

// kX / q0t
const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/
const CLOSED_FRONTMATTER_REGEX =
  /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/

// kji
function asMapping(e) {
  if (e && typeof e === 'object' && !Array.isArray(e)) return e
  return {}
}

// d2c
function emptyMappingHazard(e, t) {
  if (e.trim() !== '' && Object.keys(t).length === 0)
    return 'the frontmatter has no keys (a sequence, scalar, or comment-only document)'
  return
}

// km (subset: quoteLossyValues branch + plain/UYh fallback)
function parseFrontmatter(e, t, r) {
  let n = e.match(FRONTMATTER_REGEX)
  if (!n) return { frontmatter: {}, content: e }
  let o = n[1] || '',
    i = e.slice(n[0].length),
    a = {},
    l,
    c
  if (r?.quoteLossyValues) {
    let f = e.match(CLOSED_FRONTMATTER_REGEX),
      m = f?.[1] ?? ''
    if (o.trim() !== '' || m.trim() !== '') {
      if (f === null || m.trim() !== o.trim())
        c =
          'the closing --- is ambiguous (a value containing "---"?) — part of the block may have read as body'
    }
  }
  let u, d
  if (r?.quoteLossyValues) {
    let f = detectAndQuoteLossyFrontmatterValues(o)
    if (f.unprovableKeys.length > 0)
      u = `an inline '#' in [${f.unprovableKeys.join(', ')}] cannot be preserved by a rewrite`
    if (f.text !== null)
      try {
        let m = asMapping(parseYaml(f.text)),
          g = c ?? u ?? emptyMappingHazard(o, m)
        return {
          frontmatter: m,
          content: i,
          ...(g !== undefined && { rewriteHazard: g }),
        }
      } catch {
        d = `quoting [${f.quotedKeys.join(', ')}] broke the document; a rewrite from the plain parse would drop their inline '#' content`
        let m = t ? ` in ${t}` : ''
        // densable: T(`quoteLossyValues: ${d}${m}`, {level:"warn"})
      }
  }
  try {
    a = asMapping(parseYaml(o))
  } catch {
    try {
      let f = quoteProblematicValues(o).replace(/^\t+/gm, m =>
        '  '.repeat(m.length),
      )
      a = asMapping(parseYaml(f))
    } catch (f) {
      l = f instanceof Error ? f.message : String(f)
      // densable warn Failed to parse YAML frontmatter
    }
  }
  let p = !r?.quoteLossyValues
    ? undefined
    : l !== undefined
      ? (c ?? `the frontmatter failed to parse: ${l}`)
      : (c ?? u ?? d ?? emptyMappingHazard(o, a))
  return {
    frontmatter: a,
    content: i,
    ...(l !== undefined && { parseError: l }),
    ...(p !== undefined && { rewriteHazard: p }),
  }
}

// cXh / bMe / CBc (memory layer) — see memory_frontmatter_hash37.extract.md §3.4–3.5
// Zto(stampNewMemoryContent) calls parse with { quoteLossyValues: true } then:
//   - no rewriteHazard → full CBc serialize with originSessionId + modified ISO
//   - else surgical hRg modified-only or leave content untouched
