// @ts-nocheck — SourceTextModule evaluates this as JS; no TypeScript syntax.
/**
 * densable 2.1.289 `cc-plugin-mermaid` hooksModule (`Z` / `qe` / `Xt`).
 */
function ye(e, t, n) {
  if (
    (() => {
      e.delete(t)
      return t.length + n.length > 50000
    })()
  )
    return
  e.set(t, n)
  let o = 0
  for (let [i, u] of e) o += i.length + u.length
  for (let [i, u] of e) {
    if (e.size <= 32 && o <= 250000) return
    e.delete(i)
    o -= i.length + u.length
  }
}
var et =
    /[\u1100-\u115F\u231A\u231B\u2329\u232A\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55\u2E80-\u3029\u302E-\u303E\u3041-\u3096\u309B-\u31E3\u31EF-\u3247\u3250-\u4DBF\u4E00-\uA4C6\uA960-\uA97C\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6B\uFF01-\uFF60\uFFE0-\uFFE6\u{16FE0}-\u{16FE3}\u{16FF0}\u{16FF1}\u{17000}-\u{187F7}\u{18800}-\u{18CD5}\u{18D00}-\u{18D08}\u{1AFF0}-\u{1B2FB}\u{1F004}\u{1F0CF}\u{1F18E}\u{1F191}-\u{1F19A}\u{1F200}-\u{1F320}\u{1F32D}-\u{1F335}\u{1F337}-\u{1F37C}\u{1F37E}-\u{1F393}\u{1F3A0}-\u{1F3CA}\u{1F3CF}-\u{1F3D3}\u{1F3E0}-\u{1F3F0}\u{1F3F4}\u{1F3F8}-\u{1F43E}\u{1F440}\u{1F442}-\u{1F4FC}\u{1F4FF}-\u{1F53D}\u{1F54B}-\u{1F54E}\u{1F550}-\u{1F567}\u{1F57A}\u{1F595}\u{1F596}\u{1F5A4}\u{1F5FB}-\u{1F64F}\u{1F680}-\u{1F6C5}\u{1F6CC}\u{1F6D0}-\u{1F6D2}\u{1F6D5}-\u{1F6D7}\u{1F6DC}-\u{1F6DF}\u{1F6EB}\u{1F6EC}\u{1F6F4}-\u{1F6FC}\u{1F7E0}-\u{1F7F0}\u{1F90C}-\u{1F93A}\u{1F93C}-\u{1F945}\u{1F947}-\u{1F9FF}\u{1FA70}-\u{1FA88}\u{1FA90}-\u{1FABD}\u{1FABF}-\u{1FAC5}\u{1FACE}-\u{1FADB}\u{1FAE0}-\u{1FAE8}\u{1FAF0}-\u{1FAF8}\u{20000}-\u{3FFFD}]/u,
  tt =
    // biome-ignore lint/suspicious/noMisleadingCharacterClass: intentional combining range from gold
    /[\u00AD\u0300-\u036F\u0600-\u0605\u06DD\u070F\u08E2\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EBC\u0EC8-\u0ECD\u1AB0-\u1AFF\u1DC0-\u1DFF\u200B-\u200F\u2060-\u2064\u20D0-\u20FF\uFE00-\uFE0F\uFE20-\uFE2F\uFEFF\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/u,
  nt =
    /[\p{Mn}\p{Me}\p{Cf}\p{Cn}\p{Co}\u1160-\u11FF\uD7B0-\uD7FF\u2630-\u2637\u268A-\u268F\u302A-\u302D\u3099\u309A\u31E4\u31E5\u4DC0-\u4DFF\u{16FE4}\u{16FF2}-\u{16FF6}\u{187F8}-\u{187FF}\u{18CFF}\u{18D09}-\u{18DF2}\u{1D300}-\u{1D376}\u{1F6D8}\u{1FA89}-\u{1FA8F}\u{1FABE}\u{1FAC6}-\u{1FACD}\u{1FADC}-\u{1FADF}\u{1FAE9}-\u{1FAEF}]/u,
  ot = /[\u{1F1E6}-\u{1F1FF}]/u
var rt = /[\u200D\u{1F3FB}-\u{1F3FF}]/u,
  Ee = /[\uFE0E\uFE0F]/
var it = /\p{Emoji}/u,
  we = /^[\u0020-\u007E\u00A0-\u00AC\u00AE-\u02FF\u2190-\u22FF\u2500-\u25FC]*$/,
  st = /<br\s*\/?>/i,
  te = /[\p{L}\p{N}_]/u
var ne = 128
function pe(e) {
  if (we.test(e)) return Array.from(e, n => ({ text: n, width: 1 }))
  let t = new Intl.Segmenter(void 0, { granularity: 'grapheme' })
  return Array.from(t.segment(e), ({ segment: n }) => {
    let o = Array.from(n, l => Me(l) ?? 1),
      i = n.codePointAt(0) ?? 0,
      u =
        i >= 8252 &&
        (i < 11264 || i >= 126976) &&
        it.test(String.fromCodePoint(i)),
      r = Ee.test(n) && !Ee.test(n[0] ?? ''),
      s = ot.test(n)
        ? Math.min(o.length, 2)
        : n.includes('\u20E3') || (u && rt.test(n))
          ? 2
          : r
            ? o[0] === 2 || (n.includes('\uFE0F') && i >= 128)
              ? 2
              : 1
            : o.reduce((l, a) => l + a, 0)
    return { text: n, width: s }
  })
}
function Ae(e) {
  return we.test(e) || Array.from(e).every(t => Me(t) !== void 0)
}
function w(e) {
  return pe(e).reduce((t, n) => t + n.width, 0)
}
function _(e) {
  let t = e.trim()
  return (
    t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t
  )
    .split(st)
    .map(i => {
      let u = ''
      for (let r of i) {
        let s = r.codePointAt(0) ?? 0,
          l = s <= 31 || (s >= 127 && s <= 159)
        u += l ? (s === 9 ? ' ' : '') : r
      }
      return u.trim()
    })
}
function z(e, t) {
  if (t.length === 1 && t[0] === e) return 0
  let n = w(e)
  return Array.from(e).every(i => te.test(i)) && n <= 16
    ? n
    : Number.POSITIVE_INFINITY
}
function Me(e) {
  let t = e.codePointAt(0) ?? 0,
    n = t & 127
  if (
    (t >= 2304 &&
      t <= 3407 &&
      (n <= 2 ||
        (n >= 58 && n <= 77 && n !== 61) ||
        (n >= 81 && n <= 87) ||
        n === 98 ||
        n === 99)) ||
    tt.test(e)
  )
    return 0
  return nt.test(e) ? void 0 : et.test(e) ? 2 : 1
}
var U = 1,
  W = 2,
  G = 4,
  X = 8,
  ut = [
    ' ',
    '\u2502',
    '\u2502',
    '\u2502',
    '\u2500',
    '\u2518',
    '\u2510',
    '\u2524',
    '\u2500',
    '\u2514',
    '\u250C',
    '\u251C',
    '\u2500',
    '\u2534',
    '\u252C',
    '\u253C',
  ],
  lt = {
    [U | G]: '\u256F',
    [W | G]: '\u256E',
    [U | X]: '\u2570',
    [W | X]: '\u256D',
  },
  at = {
    solid: { across: '\u2500', down: '\u2502' },
    dotted: { across: '\u2504', down: '\u2506' },
    thick: { across: '\u2501', down: '\u2503' },
  },
  ke = ['solid', 'dotted', 'thick'],
  oe = 400000
function re(e, t) {
  let n = e * t
  return {
    width: e,
    height: t,
    links: new Uint8Array(n),
    styles: new Uint8Array(n),
    rounded: new Uint8Array(n),
    glyphs: Array.from({ length: n }),
  }
}
function H(e, t, n, o = 'solid') {
  let i =
      Math.min(t.x, n.x) >= 0 &&
      Math.min(t.y, n.y) >= 0 &&
      Math.max(t.x, n.x) < e.width &&
      Math.max(t.y, n.y) < e.height,
    u = Math.abs(t.x - n.x) + Math.abs(t.y - n.y) === 1
  if (!i || !u) return
  let r = n.x > t.x ? X : n.x < t.x ? G : n.y > t.y ? W : U,
    s = r === X ? G : r === G ? X : r === W ? U : W,
    l = ke.indexOf(o)
  for (let [a, h] of [
    [t, r],
    [n, s],
  ]) {
    let c = a.y * e.width + a.x
    e.links[c] = (e.links[c] ?? 0) | h
    e.styles[c] = Math.max(e.styles[c] ?? 0, l)
  }
}
function Se(e, t, n) {
  let o = n.x > t.x ? X : n.x < t.x ? G : n.y > t.y ? W : U,
    i = t.y * e.width + t.x
  e.links[i] = (e.links[i] ?? 0) & ~o
}
function q(e, t, n = 'solid') {
  for (let o = 1; o < t.length; o++) {
    let i = t[o - 1],
      u = t[o]
    if (i && u) H(e, i, u, n)
  }
}
function C(e, t, n) {
  if (t.y < 0 || t.y >= e.height) return
  let o = t.x
  for (let i of pe(n)) {
    let u = o >= 0 && o + i.width <= e.width
    if (u && i.width > 0) {
      e.glyphs[t.y * e.width + o] = i.text
      for (let r = 1; r < i.width; r++) {
        e.glyphs[t.y * e.width + o + r] = ''
      }
    } else if (u && o > t.x) {
      let r = t.y * e.width + o - 1
      e.glyphs[r] = (e.glyphs[r] ?? '') + i.text
    }
    o += i.width
  }
}
function J(e, t, n, o) {
  let i = t.x + t.width - 1,
    u = t.y + t.height - 1
  for (let s = t.x; s < i; s++) {
    H(e, { x: s, y: t.y }, { x: s + 1, y: t.y })
    H(e, { x: s, y: u }, { x: s + 1, y: u })
  }
  for (let s = t.y; s < u; s++) {
    H(e, { x: t.x, y: s }, { x: t.x, y: s + 1 })
    H(e, { x: i, y: s }, { x: i, y: s + 1 })
  }
  for (let s = t.y + 1; s < u; s++) {
    for (let l = t.x + 1; l < i; l++) {
      e.glyphs[s * e.width + l] = ' '
    }
  }
  if (o)
    for (let [s, l] of [
      [t.x, t.y],
      [i, t.y],
      [t.x, u],
      [i, u],
    ])
      e.rounded[l * e.width + s] = 1
  let r = t.y + Math.floor((t.height - n.length) / 2)
  n.forEach((s, l) => {
    let a = t.x + Math.floor((t.width - w(s)) / 2)
    C(e, { x: a, y: r + l }, s)
  })
}
function ie(e) {
  let t = []
  for (let n = 0; n < e.height; n++) {
    let o = ''
    for (let i = 0; i < e.width; i++) {
      let u = n * e.width + i,
        r = e.links[u] ?? 0,
        s = at[ke[e.styles[u] ?? 0] ?? 'solid']
      o +=
        e.glyphs[u] ??
        (r === (U | W)
          ? s.down
          : r === (G | X)
            ? s.across
            : ((e.rounded[u] ? lt[r] : void 0) ?? ut[r] ?? ' '))
    }
    t.push(o.trimEnd())
  }
  return t
}
var dt = 1000,
  ct = 64,
  ft = 24
function De(e, t, n) {
  let o = e.direction === 'TD' || e.direction === 'BT',
    i = new Map(e.nodes.map((d, m) => [d.id, m])),
    u = e.edges.map(d => ({ from: i.get(d.from) ?? 0, to: i.get(d.to) ?? 0 })),
    r = e.nodes.map(() => [])
  u.forEach((d, m) => r[d.from]?.push(m))
  let s = u.map(d => d.from === d.to),
    l = new Uint8Array(e.nodes.length)
  for (let d = 0; d < e.nodes.length; d++) {
    Re(d, { outgoing: r, links: u, visited: l, isLoop: s })
  }
  let a = pt(
      e.nodes.length,
      u.filter((d, m) => !s[m]),
    ),
    h = e.nodes.map(() => 0),
    c = e.nodes.map(() => '')
  if (
    (() => {
      e.edges.forEach((d, m) => {
        let g = u[m]?.to ?? 0
        h[g] = (h[g] ?? 0) + 1
        c[g] = d.label === '' ? (c[g] ?? '') : d.label
      })
      return c.some((d, m) => d !== '' && (h[m] ?? 0) > 1)
    })()
  )
    return
  let f = e.nodes.map((d, m) => {
    let g = Math.max(...d.label.map(w)) + 4,
      x = d.label.length + 2,
      M = o ? g : x,
      A = c[m] ?? ''
    return {
      kind: 'box',
      label: d.label,
      isRounded: d.isRounded,
      line: 'solid',
      rank: a[m] ?? 0,
      center: 0,
      breadth: M,
      slot: o && A !== '' ? Math.max(M, w(A) + 2) : M,
      depth: o ? x : g,
      start: 0,
    }
  })
  if (
    u.reduce(
      (d, m, g) => d + (s[g] ? 2 : (a[m.to] ?? 0) - (a[m.from] ?? 0)),
      0,
    ) > dt
  )
    return
  let k = []
  u.forEach((d, m) => {
    let g = e.edges[m],
      x = a[d.to] ?? 0,
      M = d.from
    for (let A = (a[d.from] ?? 0) + 1; A <= x && g && !s[m]; A++) {
      let P = A === x ? d.to : f.length
      if (A !== x)
        f.push({
          kind: 'crossing',
          label: [],
          isRounded: !1,
          line: g.line,
          rank: A,
          center: 0,
          breadth: 1,
          slot: 1,
          depth: 0,
          start: 0,
        })
      k.push({
        kind: 'plain',
        gap: A - 1,
        from: M,
        to: P,
        line: g.line,
        label: A === x ? g.label : '',
        hasHead: g.hasArrow && A === x,
        track: -1,
      })
      M = P
    }
  })
  let E = []
  f.forEach((d, m) => {
    let g = E[d.rank] ?? []
    g.push(m)
    E[d.rank] = g
  })
  let b = f.map(() => []),
    R = f.map(() => [])
  for (let d of k) {
    b[d.to]?.push(d.from)
    R[d.from]?.push(d.to)
  }
  for (let d = 0; d < 4; d++) {
    let m = d % 2 === 0
    for (let g = 1; g < E.length; g++) {
      let x = m ? g : E.length - 1 - g,
        M = E[m ? x - 1 : x + 1] ?? [],
        A = E[x] ?? [],
        P = new Map(M.map((L, B) => [L, B])),
        K = new Map(
          A.map((L, B) => [
            L,
            Ce(((m ? b : R)[L] ?? []).map(Y => P.get(Y) ?? 0)) ?? B,
          ]),
        )
      A.sort((L, B) => (K.get(L) ?? 0) - (K.get(B) ?? 0))
    }
  }
  let N = o ? (t ? 1 : 3) : t ? 0 : 1
  for (let d of E)
    d.forEach((m, g) => {
      let x = f[m],
        M = f[d[g - 1] ?? -1]
      if (x) x.center = M ? M.center + me(M, x, N) : Math.floor(x.slot / 2)
    })
  for (let d = 0; d < 4; d++) {
    let m = d % 2 === 0
    for (let g = 1; g < E.length; g++) {
      let x = m ? g : E.length - 1 - g
      mt(
        (E[x] ?? []).flatMap(M => f[M] ?? []),
        (E[x] ?? []).map(M =>
          Ce(((m ? b : R)[M] ?? []).map(A => f[A]?.center ?? 0)),
        ),
        N,
      )
    }
  }
  let S = Math.min(...f.map(d => d.center - Math.floor(d.slot / 2)))
  for (let d of f) d.center -= S
  let I = Math.max(...f.map(d => d.center - Math.floor(d.slot / 2) + d.slot)),
    ee = u
      .flatMap((d, m) => (s[m] ? [{ link: d, edge: m }] : []))
      .sort(
        (d, m) =>
          (a[d.link.from] ?? 0) -
          (a[d.link.to] ?? 0) -
          ((a[m.link.from] ?? 0) - (a[m.link.to] ?? 0)),
      )
  for (let { link: d, edge: m } of ee) {
    let g = e.edges[m],
      x = {
        kind: 'channel',
        label: [],
        isRounded: !1,
        line: g?.line ?? 'solid',
        rank: -1,
        center: I + 1,
        breadth: 1,
        slot: 1,
        depth: 0,
        start: 0,
      }
    I += 2
    f.push(x)
    k.push(
      {
        kind: 'loopOut',
        gap: a[d.from] ?? 0,
        from: d.from,
        to: f.length - 1,
        line: x.line,
        label: '',
        hasHead: !1,
        track: -1,
      },
      {
        kind: 'loopIn',
        gap: (a[d.to] ?? 0) - 1,
        from: f.length - 1,
        to: d.to,
        line: x.line,
        label: g?.label ?? '',
        hasHead: Boolean(g?.hasArrow),
        track: -1,
      },
    )
  }
  if (o && I > n) return 'too wide'
  let V = new Map(),
    T = 0
  for (let d = -1; d < E.length; d++) {
    let m = (E[d] ?? []).flatMap(D => f[D] ?? []),
      g = d < 0 ? 0 : Math.max(1, ...m.map(D => D.depth))
    for (let D of m) {
      D.depth = D.kind === 'crossing' ? g : D.depth
      D.start = T + Math.floor((g - D.depth) / 2)
    }
    T += g
    let x = k.filter(D => D.gap === d),
      M = d >= 0 && d < E.length - 1
    if (x.length === 0 && !M) continue
    if (!o && T > n) return 'too wide'
    let A = x.length > ct ? void 0 : ht(x, f)
    if (A === void 0) return
    let P = Math.max(0, ...x.map(D => w(D.label))),
      K = o ? 1 : 2,
      L = P === 0 ? 0 : o ? 1 : P + 2,
      B = d < 0 ? T - 1 : T,
      Y = B + 1 + A * K
    V.set(d, { start: B, labelStart: Y, labelSize: L, stride: K })
    T = d === E.length - 1 ? Y : Y + L + (o ? 1 : 2)
  }
  return {
    isVertical: o,
    isFlipped: e.direction === 'BT' || e.direction === 'RL',
    nodes: f,
    segments: k,
    gaps: V,
    rankExtent: T,
    orderExtent: I,
  }
}
function Re(e, t) {
  if (t.visited[e] !== 0) return
  t.visited[e] = 1
  for (let n of t.outgoing[e] ?? []) {
    let o = t.links[n]?.to ?? 0
    if (t.visited[o] === 1) t.isLoop[n] = !0
    else Re(o, t)
  }
  t.visited[e] = 2
}
function pt(e, t) {
  let n = Array.from({ length: e }, () => 0),
    o = Array.from({ length: e }, () => 0),
    i = Array.from({ length: e }, () => [])
  for (let r of t) {
    o[r.to] = (o[r.to] ?? 0) + 1
    i[r.from]?.push(r.to)
  }
  let u = o.flatMap((r, s) => (r === 0 ? [s] : []))
  for (let r = 0; r < u.length; r++) {
    let s = u[r] ?? 0
    for (let l of i[s] ?? [])
      if (
        (() => {
          ;(() => {
            n[l] = Math.max(n[l] ?? 0, (n[s] ?? 0) + 1)
            return (o[l] = (o[l] ?? 0) - 1)
          })()
          return o[l] === 0
        })()
      )
        u.push(l)
  }
  return n
}
function Ce(e) {
  return e.length === 0 ? void 0 : e.reduce((t, n) => t + n, 0) / e.length
}
function me(e, t, n) {
  return Math.ceil((e.slot + t.slot) / 2) + n
}
function mt(e, t, n) {
  let o = []
  e.forEach((u, r) => {
    let s = e[r - 1],
      l = Math.round(t[r] ?? u.center)
    o.push(s ? Math.max(l, (o[r - 1] ?? 0) + me(s, u, n)) : l)
  })
  let i = Array.from({ length: e.length }, () => 0)
  for (let u = e.length - 1; u >= 0; u--) {
    let r = e[u],
      s = e[u + 1],
      l = Math.round(t[u] ?? r?.center ?? 0)
    i[u] = r && s ? Math.min(l, (i[u + 1] ?? 0) - me(r, s, n)) : l
  }
  e.forEach((u, r) => {
    u.center = Math.floor(((o[r] ?? 0) + (i[r] ?? 0)) / 2)
  })
}
function ht(e, t) {
  let n = e.filter(s => t[s.from]?.center !== t[s.to]?.center),
    o = new Map()
  for (let s of n) o.set(s.from, (o.get(s.from) ?? 0) + 1)
  let i = new Map()
  for (let s of n) {
    let l = o.get(s.from) === 1 ? `to ${s.to}` : `from ${s.from}`
    i.set(l, [...(i.get(l) ?? []), s])
  }
  if (i.size > ft) return
  let u = [...i.values()].sort(
      (s, l) =>
        (t[s[0]?.from ?? 0]?.center ?? 0) - (t[l[0]?.from ?? 0]?.center ?? 0),
    ),
    r = 0
  while (u.length > 0) {
    let s = u.findIndex(l =>
      u.every(
        a =>
          a === l ||
          !a.some(h =>
            l.some(
              c =>
                t[h.from]?.center === t[c.to]?.center &&
                h.kind !== 'loopIn' &&
                c.kind !== 'loopOut',
            ),
          ),
      ),
    )
    if (s < 0) return
    for (let l of u.splice(s, 1)[0] ?? []) l.track = r
    r++
  }
  return r
}
function Oe(e, t) {
  let n = new Map(e.nodes.map(i => [i.id, i.label])),
    o = e.groups.map(
      i =>
        `subgraph ${i.title}: ` +
        i.members.map(u => (n.get(u) ?? [u]).join(' ')).join(', '),
    )
  if (o.some(i => w(i) > t)) return
  for (let i of [!1, !0]) {
    let u = De(e, i, t)
    if (!u) return
    if (u === 'too wide') continue
    let r = u.isVertical ? u.orderExtent : u.rankExtent,
      s = u.isVertical ? u.rankExtent : u.orderExtent
    if (r <= t && r * s <= oe) return [...gt(u, r, s), ...o]
  }
  return
}
function gt(e, t, n) {
  let o = re(t, n)
  for (let r of e.nodes) {
    let s = r.center - Math.floor(r.breadth / 2),
      l = O(e, r.start, s),
      a = O(e, r.start + r.depth - 1, s + r.breadth - 1)
    if (r.kind === 'crossing')
      q(
        o,
        Array.from({ length: r.depth }, (h, c) => O(e, r.start + c, r.center)),
        r.line,
      )
    else if (r.kind === 'box')
      J(
        o,
        {
          x: Math.min(l.x, a.x),
          y: Math.min(l.y, a.y),
          width: Math.abs(a.x - l.x) + 1,
          height: Math.abs(a.y - l.y) + 1,
        },
        r.label,
        r.isRounded,
      )
  }
  let i = [],
    u = new Map()
  for (let r of e.segments) {
    let s = e.nodes[r.from],
      l = e.nodes[r.to],
      a = e.gaps.get(r.gap)
    if (!s || !l || !a) continue
    let h = s.start + s.depth - 1,
      c = r.hasHead ? l.start - 1 : l.start,
      f = r.track < 0 ? c : a.start + 1 + r.track * a.stride,
      F = []
    for (let b = h; b <= f && r.kind !== 'loopIn'; b++) {
      F.push(O(e, b, s.center))
    }
    let k = Math.sign(l.center - s.center)
    for (
      let b = s.center + (r.kind === 'loopIn' ? 0 : k);
      b !== l.center + k;
      b += k
    ) {
      F.push(O(e, f, b))
    }
    for (let b = f + 1; b <= c && r.kind !== 'loopOut'; b++) {
      F.push(O(e, b, l.center))
    }
    q(o, F, r.line)
    let E = r.kind === 'loopOut' ? r.to : r.from
    if (r.kind !== 'plain') u.set(E, [...(u.get(E) ?? []), f])
    if (r.hasHead)
      i.push({ at: O(e, c, l.center), toward: O(e, l.start, l.center) })
    if (r.label !== '' && e.isVertical)
      C(o, O(e, a.labelStart, l.center - Math.floor(w(r.label) / 2)), r.label)
    else if (r.label !== '') {
      let b = O(e, a.labelStart, l.center),
        R = O(e, a.labelStart + a.labelSize - 1, l.center)
      C(
        o,
        {
          x:
            Math.min(b.x, R.x) + Math.floor((a.labelSize - w(r.label) - 2) / 2),
          y: b.y,
        },
        ` ${r.label} `,
      )
    }
  }
  for (let [r, [s = 0, l = 0]] of u) {
    let a = e.nodes[r],
      h = []
    for (let c = Math.min(s, l); c <= Math.max(s, l); c++) {
      h.push(O(e, c, a?.center ?? 0))
    }
    q(o, h, a?.line)
  }
  for (let r of i) {
    C(
      o,
      r.at,
      r.toward.x === r.at.x
        ? r.toward.y > r.at.y
          ? '\u25BC'
          : '\u25B2'
        : r.toward.x > r.at.x
          ? '\u25B6'
          : '\u25C0',
    )
    Se(o, r.toward, r.at)
  }
  return ie(o)
}
function O(e, t, n) {
  let o = e.isFlipped ? e.rankExtent - 1 - t : t
  return e.isVertical ? { x: n, y: o } : { x: o, y: n }
}
var xt = /^(?:graph|flowchart)(?:\s+(TD|TB|BT|LR|RL))?$/,
  _e = 'xo<',
  Ft = [
    ['((', '))', !0],
    ['([', '])', !0],
    ['[[', ']]', !1],
    ['[(', ')]', !0],
    ['{{', '}}', !1],
    ['[', ']', !1],
    ['(', ')', !0],
    ['{', '}', !1],
  ],
  bt = 200,
  yt = 400
function Ne(e) {
  let t = xt.exec(e[0] ?? '')
  if (!t) return
  let n = t[1] ?? 'TD',
    o = {
      direction: n === 'BT' || n === 'LR' || n === 'RL' ? n : 'TD',
      nodes: [],
      edges: [],
      groups: [],
    },
    i = {
      chart: o,
      byId: new Map(),
      open: [],
      groupOf: new Map(),
      groupNames: new Set(),
      linked: new Set(),
      hiddenCells: 0,
    }
  for (let s of e.slice(1)) {
    if (s === 'end') {
      if (i.open.pop() === void 0) return
      continue
    }
    if (
      !(s.startsWith('subgraph ')
        ? Et(i, s.slice(9))
        : wt(i, { text: s, position: 0 }))
    )
      return
  }
  let u = o.nodes.some(s => i.groupNames.has(s.id)),
    r = o.nodes.reduce((s, l) => s + z(l.id, l.label), i.hiddenCells)
  return i.open.length > 0 || o.nodes.length === 0 || u || r > ne ? void 0 : o
}
function Et(e, t) {
  let n = t.trim(),
    o = n.indexOf('['),
    i = o > 0 && n.endsWith(']'),
    u = i ? n.slice(0, o).trim() : '',
    r = _(i ? n.slice(o + 1, -1) : n),
    s = Array.from(u).every(a => te.test(a))
  if (n === '' || !s || e.open.length > 0) return !1
  e.hiddenCells += z(u, r)
  let l = { title: r.join(' '), members: [] }
  e.groupNames.add(i ? u : l.title)
  e.chart.groups.push(l)
  e.open.push(l)
  return !0
}
function wt(e, t) {
  let n = Le(e, t)
  while (n !== void 0) {
    if (
      (() => {
        Q(t)
        return t.position >= t.text.length
      })()
    )
      return !0
    let o = Mt(t),
      i = o && Le(e, t)
    if (!o || !i) return !1
    let u = n.length * i.length
    if (e.chart.edges.length + u > yt) return !1
    for (let r of n)
      for (let s of i) {
        let l = `${r} ${s}`
        if (e.linked.has(l)) return !1
        e.linked.add(l)
        e.chart.edges.push({ from: r, to: s, ...o })
      }
    n = i
  }
  return !1
}
function Le(e, t) {
  let n = new Set()
  for (;;) {
    let o = At(e, t)
    if (o === void 0 || n.has(o)) return
    if (
      (() => {
        ;(() => {
          n.add(o)
          return Q(t)
        })()
        return t.text[t.position] !== '&'
      })()
    )
      return Array.from(n)
    t.position++
  }
}
function At(e, t) {
  Q(t)
  let n = t.position
  while (te.test(t.text[t.position] ?? '')) t.position++
  let o = t.text.slice(n, t.position)
  if (o === '') return
  let i = t.text.slice(t.position),
    u = Ft.find(([c]) => i.startsWith(c)),
    r
  if (u) {
    let [c, f] = u,
      F = t.position + c.length,
      k = t.text[F] === '"',
      E = k ? t.text.indexOf('"', F + 1) : F,
      b = E < 0 ? -1 : t.text.indexOf(f, E),
      R = b < 0 ? '' : t.text.slice(F, b),
      N = R.startsWith('/') || R.startsWith('\\'),
      S = k && t.text.slice(E + 1, b).trim() !== ''
    if (b < 0 || N || S) return
    r = _(R)
    t.position = b + f.length
  }
  if (t.text.startsWith(':::', t.position)) return
  let s = e.byId.get(o)
  if (
    s !== void 0 &&
    r !== void 0 &&
    s.label.join(`
`) !==
      r.join(`
`) &&
    s.label.join(`
`) !== o
  )
    return
  if (s && r) {
    s.label = r
    s.isRounded = u?.[2] ?? !1
  } else if (!s) {
    if (e.chart.nodes.length >= bt) return
    let c = { id: o, label: r ?? [o], isRounded: u?.[2] ?? !1 }
    e.byId.set(o, c)
    e.chart.nodes.push(c)
  }
  let a = e.open.at(-1),
    h = e.groupOf.get(o)
  if (a && h && h !== a) return
  if (a && !h) {
    e.groupOf.set(o, a)
    a.members.push(o)
  }
  return o
}
function Mt(e) {
  Q(e)
  let { text: t } = e,
    n = t[e.position],
    o = n === '-' && t[e.position + 1] === '.'
  if (n !== '-' && n !== '=') return
  let i = o ? 'dotted' : n === '=' ? 'thick' : 'solid',
    u = ''
  if (o) {
    if (
      (() => {
        e.position += 2
        return t[e.position] !== '.' && t[e.position] !== '-'
      })()
    ) {
      let s = t.indexOf('.-', e.position)
      if (s < 0) return
      u = t.slice(e.position, s)
      e.position = s
    }
    if (
      (() => {
        se(e, '.')
        return se(e, '-') < 1
      })()
    )
      return
  } else {
    let s = se(e, n)
    if (_e.includes(t[e.position] ?? ' ')) return
    let l = s === 2 && t[e.position] !== '>'
    if (l) {
      let c = t.indexOf(n + n, e.position)
      if (c < 0) return
      u = t.slice(e.position, c)
      e.position = c
    }
    let a = l ? se(e, n) : s,
      h = t[e.position] !== '>'
    if (a < 2 || (h && a < 3)) return
  }
  if (_e.includes(t[e.position] ?? ' ')) return
  let r = t[e.position] === '>'
  if (
    (() => {
      ;(() => {
        e.position += r ? 1 : 0
        return Q(e)
      })()
      return t[e.position] === '|'
    })()
  ) {
    let s = t.indexOf('|', e.position + 1)
    if (s < 0 || u.trim() !== '') return
    u = t.slice(e.position + 1, s)
    e.position = s + 1
  }
  return { label: _(u).join(' ').trim(), line: i, hasArrow: r }
}
function se(e, t) {
  let n = e.position
  while (e.text[e.position] === t) e.position++
  return e.position - n
}
function Q(e) {
  while (e.text[e.position] === ' ' || e.text[e.position] === '\t') e.position++
}
var he = 4
function Pe(e, t) {
  let n = St(e),
    o = Math.max(...e.participants.map(a => a.length)) + 2,
    i = o + 1 + e.steps.reduce((a, h) => a + Te(h), 0)
  if (n.width > t || n.width * i > oe) return
  let u = re(n.width, i),
    r = new Set(),
    s = o + 1,
    l = e.steps.map(a => {
      let h = s
      if (
        (() => {
          s += Te(a)
          return a.kind === 'note'
        })()
      ) {
        let c = ge(a, n, h)
        for (let f = c.y; f < c.y + c.height; f++) {
          for (let F = c.x; F < c.x + c.width; F++) {
            r.add(f * n.width + F)
          }
        }
      }
      return h
    })
  e.participants.forEach((a, h) => {
    let c = n.centers[h] ?? 0,
      f = w(ue(a)) + 4
    J(u, { x: c - Math.floor(f / 2), y: 0, width: f, height: o }, a, !1)
    H(u, { x: c, y: o - 1 }, { x: c, y: o })
    for (let F = o; F < i; F++) {
      if (!r.has(F * n.width + c)) C(u, { x: c, y: F }, '\u2502')
    }
  })
  e.steps.forEach((a, h) => {
    kt(u, a, n, l[h] ?? 0)
  })
  return ie(u)
}
function kt(e, t, n, o) {
  switch (t.kind) {
    case 'frame': {
      let i = `\u2500\u2500 ${t.label} `
      C(e, { x: 0, y: o }, i + '\u2500'.repeat(Math.max(0, n.width - w(i))))
      return
    }
    case 'note': {
      J(e, ge(t, n, o), t.text, !1)
      return
    }
    case 'message': {
      let i = n.centers[t.from] ?? 0,
        u = n.centers[t.to] ?? 0,
        r = o + t.text.length,
        s = t.line === 'dotted' ? '\u2504' : '\u2500'
      if (t.from === t.to) {
        t.text.forEach((f, F) => {
          C(e, { x: i + 2, y: o + F }, f)
        })
        let c = []
        for (let f = i; f <= i + he; f++) {
          c.push({ x: f, y: r })
        }
        for (let f = i + he; f > i; f--) {
          c.push({ x: f, y: r + 1 })
        }
        q(e, c, t.line)
        C(e, { x: i, y: r }, '\u251C')
        C(e, { x: i + 1, y: r + 1 }, Ie(t.head, !1, s))
        return
      }
      let l = Math.min(i, u),
        a = Math.abs(u - i) - 1
      t.text.forEach((c, f) => {
        C(e, { x: l + 1 + Math.floor((a - w(c)) / 2), y: o + f }, c)
      })
      let h = u > i
      C(e, { x: i, y: r }, h ? '\u251C' : '\u2524')
      C(e, { x: l + 1, y: r }, s.repeat(a))
      C(e, { x: h ? u - 1 : u + 1, y: r }, Ie(t.head, h, s))
    }
  }
}
function Ie(e, t, n) {
  switch (e) {
    case 'arrow':
      return t ? '\u25B6' : '\u25C0'
    case 'async':
      return t ? '>' : '<'
    case 'cross':
      return 'x'
    case 'open':
      return n
  }
}
function Te(e) {
  switch (e.kind) {
    case 'frame':
      return 2
    case 'note':
      return e.text.length + 3
    case 'message':
      return e.text.length + (e.from === e.to ? 3 : 2)
  }
}
function ue(e) {
  return e.reduce((t, n) => (w(n) > w(t) ? n : t), '')
}
function ge(e, t, n) {
  let o = t.centers[e.first] ?? 0,
    i = t.centers[e.last] ?? 0,
    u = w(ue(e.text)) + 4,
    r =
      e.placement === 'over' && e.first !== e.last ? Math.max(u, i - o + 5) : u
  return {
    x:
      e.placement === 'left'
        ? o - 1 - r
        : e.placement === 'right'
          ? o + 2
          : Math.floor((o + i) / 2) - Math.floor(r / 2),
    y: n,
    width: r,
    height: e.text.length + 2,
  }
}
function St(e) {
  let t = e.participants.map(l => w(ue(l)) + 4),
    n = {
      gaps: t
        .slice(1)
        .map((l, a) => Math.ceil((t[a] ?? 0) / 2) + Math.ceil(l / 2) + 2),
      leftRoom: Math.floor((t[0] ?? 0) / 2),
      rightRoom: Math.ceil((t.at(-1) ?? 0) / 2),
    },
    o = 0
  for (let l of e.steps) {
    let a = l.kind === 'frame' ? 0 : w(ue(l.text))
    if (l.kind === 'frame') o = Math.max(o, w(l.label) + 6)
    else if (l.kind === 'message' && l.from === l.to)
      j(n, l.from, Math.max(a + 2, he + 1))
    else if (l.kind === 'message')
      Be(n, Math.min(l.from, l.to), Math.max(l.from, l.to), a + 4)
    else if (l.placement === 'left') j(n, l.first - 1, a + 5)
    else if (l.placement === 'right') j(n, l.first, a + 6)
    else if (l.first === l.last) {
      j(n, l.first - 1, Math.ceil((a + 4) / 2) + 1)
      j(n, l.first, Math.ceil((a + 4) / 2) + 1)
    } else {
      Be(n, l.first, l.last, a)
      j(n, l.first - 1, 2)
      j(n, l.last, 2)
    }
  }
  let i = [n.leftRoom]
  for (let l of n.gaps) i.push((i.at(-1) ?? 0) + l)
  let u = Math.max(o, (i.at(-1) ?? 0) + n.rightRoom + 1),
    r = e.steps.flatMap(l =>
      l.kind === 'note' ? [ge(l, { centers: i, width: u }, 0)] : [],
    ),
    s = Math.max(0, ...r.map(l => -l.x))
  return {
    centers: i.map(l => l + s),
    width: Math.max(u + s, ...r.map(l => l.x + s + l.width)),
  }
}
function j(e, t, n) {
  if (t < 0) e.leftRoom = Math.max(e.leftRoom, n)
  else if (t >= e.gaps.length) e.rightRoom = Math.max(e.rightRoom, n)
  else e.gaps[t] = Math.max(e.gaps[t] ?? 0, n + 1)
}
function Be(e, t, n, o) {
  let i = e.gaps.slice(t, n).reduce((u, r) => u + r, 0)
  e.gaps[n - 1] = (e.gaps[n - 1] ?? 0) + Math.max(0, o - i)
}
var Ct = [
    ['-->>', 'dotted', 'arrow'],
    ['->>', 'solid', 'arrow'],
    ['--x', 'dotted', 'cross'],
    ['--)', 'dotted', 'async'],
    ['-->', 'dotted', 'open'],
    ['-x', 'solid', 'cross'],
    ['-)', 'solid', 'async'],
    ['->', 'solid', 'open'],
  ],
  Dt = /^(?:participant|actor)\s+(\S.*)$/,
  He = ' as ',
  Rt = /^note\s+(over|left of|right of)\s+(\S[^:]*):(.*)$/i,
  Ot = /^(?:activate|deactivate)\s+(\S.*)$/,
  We = /^(?:loop|alt|opt|par|critical|break)(?:\s|$)/,
  _t = /^(?:else|and|option)(?:\s|$)/,
  Lt = /[<>:]/,
  Nt = 50,
  It = 400
function ve(e) {
  let t = {
    participants: [],
    steps: [],
    ids: [],
    depth: 0,
    isNumbered: !1,
    hiddenCells: 0,
  }
  for (let i of e.slice(1)) {
    let u = Tt(t, i),
      r = t.ids.length <= Nt && t.steps.length <= It && t.hiddenCells <= ne
    if (!u || !r) return
  }
  if (t.depth !== 0 || t.ids.length === 0) return
  let n = 0,
    o = t.steps.map(i => {
      if (i.kind !== 'message' || !t.isNumbered) return i
      n++
      let [u = '', ...r] = i.text
      return { ...i, text: [`${n}. ${u}`, ...r] }
    })
  return { participants: t.participants, steps: o }
}
function Tt(e, t) {
  if (t === 'autonumber') {
    e.isNumbered = !0
    return !0
  }
  if (t === 'end') {
    e.depth--
    e.steps.push({ kind: 'frame', label: 'end' })
    return e.depth >= 0
  }
  if (We.test(t) || _t.test(t)) {
    e.depth += We.test(t) ? 1 : 0
    e.steps.push({ kind: 'frame', label: _(t).join(' ') })
    return e.depth > 0
  }
  let n = Dt.exec(t)?.[1]
  if (n !== void 0) {
    let u = n.indexOf(He),
      r = u < 0 ? n : n.slice(0, u),
      s = _(u < 0 ? n : n.slice(u + He.length)),
      l = !e.ids.includes(r.trim())
    e.hiddenCells += z(r.trim(), s)
    return l && le(e, r, s) >= 0
  }
  let o = Ot.exec(t)?.[1]
  if (o !== void 0) return e.ids.includes(o.trim())
  let i = Rt.exec(t)
  if (i) {
    let [, u = '', r = '', s = ''] = i,
      l = r.split(',').map(h => le(e, h)),
      a = u.toLowerCase() === 'over'
    if (l.includes(-1) || l.length > (a ? 2 : 1)) return !1
    e.steps.push({
      kind: 'note',
      placement: a ? 'over' : u.toLowerCase() === 'left of' ? 'left' : 'right',
      first: Math.min(...l),
      last: Math.max(...l),
      text: _(s),
    })
    return !0
  }
  return Bt(e, t)
}
function Bt(e, t) {
  let n = t.indexOf(':'),
    o = n < 0 ? '' : t.slice(0, n),
    i = -1,
    u
  for (let f = o.indexOf('-'); f >= 0 && !u; ) {
    u = Ct.find(([F]) => o.startsWith(F, f))
    i = f
    f = o.indexOf('-', f + 1)
  }
  if (!u) return !1
  let [r, s, l] = u,
    a = o.slice(i + r.length).trim(),
    h = le(e, o.slice(0, i)),
    c = le(e, a.startsWith('+') || a.startsWith('-') ? a.slice(1) : a)
  if (h < 0 || c < 0) return !1
  e.steps.push({
    kind: 'message',
    from: h,
    to: c,
    text: _(t.slice(n + 1)),
    line: s,
    head: l,
  })
  return !0
}
function le(e, t, n) {
  let o = t.trim()
  if (o === '' || Lt.test(o)) return -1
  let i = e.ids.indexOf(o)
  if (i >= 0) return i
  e.ids.push(o)
  e.participants.push(n ?? _(o))
  return e.ids.length - 1
}
function Ge(e) {
  let t = []
  for (let n of e.split(`
`)) {
    let o = n.trim()
    if (o.startsWith('%%')) {
      if (o !== '%%') return
      continue
    }
    let i = 0,
      u = !1,
      r = 0
    for (let s = 0; s < o.length; s++) {
      let l = o[s]
      if (l === '"') u = !u
      else if (!u && (l === '[' || l === '(' || l === '{')) i++
      else if (!u && (l === ']' || l === ')' || l === '}'))
        i = Math.max(0, i - 1)
      else if (!u && i === 0 && l === ';') {
        t.push(o.slice(r, s).trim())
        r = s + 1
      }
    }
    t.push(o.slice(r).trim())
  }
  return t.filter(n => n !== '')
}
var $e = 20000,
  Xe = 300
function xe(e, t, n) {
  if (e.length > $e) return
  try {
    let o = Ge(e),
      i = o?.[0] ?? ''
    if (o === void 0 || !o.every(Ae)) return
    let u = i === 'sequenceDiagram' ? ve(o) : void 0,
      r = u ? void 0 : Ne(o),
      s = u ? Pe(u, t) : r && Oe(r, t)
    return s && s.length <= Xe
      ? { kind: u ? 'sequence diagram' : 'flowchart', lines: s }
      : void 0
  } catch {
    n?.()
    return
  }
}
var Pt = /^( {0,3})(`{3,}|~{3,})([^\n]*)$/,
  Ht = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/,
  Wt = /`+/g,
  vt = 2,
  Ue = 60000
function Fe(e, t, n) {
  let o = e.split(`
`),
    i = [],
    u,
    r = e.length
  for (let s = 0; s < o.length; s++) {
    let l = o[s] ?? ''
    if (
      (() => {
        i.push(l)
        return !u
      })()
    ) {
      let S = Pt.exec(l),
        [, I = '', ee = '', V = ''] = S ?? []
      u =
        S && !(ee.startsWith('`') && V.includes('`'))
          ? { indent: I, marker: ee, info: V.trim(), line: s }
          : void 0
      continue
    }
    let a = Ht.exec(l)?.[1] ?? ''
    if (!(a.startsWith(u.marker.charAt(0)) && a.length >= u.marker.length))
      continue
    let c = u
    if (
      (() => {
        u = void 0
        return c.info.toLowerCase() !== 'mermaid'
      })()
    )
      continue
    let f = !1,
      F = xe(
        o
          .slice(c.line + 1, s)
          .map(S => (S.startsWith(c.indent) ? S.slice(c.indent.length) : S))
          .join(`
`),
        t - vt - c.indent.length,
        () => {
          f = !0
        },
      )
    if (!F) {
      n?.(f ? 'threw' : 'kept')
      continue
    }
    let k = 2
    for (let S of F.lines)
      for (let I of S.match(Wt) ?? []) k = Math.max(k, I.length)
    let E = '`'.repeat(k + 1),
      b = [
        `${c.indent}${E}mermaid \xB7 ${F.kind}`,
        ...F.lines.map(S => c.indent + S),
        c.indent + E,
      ],
      R = i.slice(c.line - s - 1),
      N = je(b) - je(R)
    if (N > 0 && r + N > Ue) {
      n?.('kept')
      continue
    }
    n?.('drawn')
    r += N
    i.length -= R.length
    for (let S of b) i.push(S)
  }
  return i.join(`
`)
}
function je(e) {
  return e.reduce((t, n) => t + n.length + 1, 0)
}
var Gt = /^ {0,3}(?:`{3,}|~{3,})[ \t]*mermaid[ \t\r]*$/im,
  $t = 80
function qe(e, t) {
  let n = new Map()
  e(
    'ui.render',
    { component: 'AssistantMessage', surface: 'terminal', props: { text: Gt } },
    (o, i, u) => {
      if (i.component !== 'AssistantMessage') return u(i)
      let r = i.viewport?.columns ?? $t,
        s = `${r}
${i.props.text}`,
        l = n.get(s) ?? Fe(i.props.text, r, t.record)
      ye(n, s, l)
      return l === i.props.text
        ? u(i)
        : u({ ...i, props: { ...i.props, text: l } })
    },
  )
}
function Xt(e) {
  qe(e, {})
}
const mermaidModule = {
  MAX_REWRITTEN_LENGTH: Ue,
  MAX_ROWS: Xe,
  MAX_SOURCE_LENGTH: $e,
  register: Xt,
  registerHooks: qe,
  renderMermaid: xe,
  withDiagrams: Fe,
}
export {
  Ue as MAX_REWRITTEN_LENGTH,
  Xe as MAX_ROWS,
  $e as MAX_SOURCE_LENGTH,
  Xt as register,
  qe as registerHooks,
  xe as renderMermaid,
  Fe as withDiagrams,
  mermaidModule as default,
}
