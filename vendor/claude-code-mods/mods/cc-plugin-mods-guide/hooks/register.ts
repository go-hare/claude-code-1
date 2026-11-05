// @ts-nocheck — SourceTextModule evaluates this as JS; no TypeScript syntax.
/**
 * densable 2.1.289 cc-plugin-mods-guide hooksModule (`ie`).
 * Gold `h(...)` is the ui.resolve hyperscript. Local `h` matches leftover
 * `uiResolveH` so the VM can draw without a JSX pragma.
 */
function h(type, props, ...childList) {
  if (typeof type === 'function') {
    const next = props == null ? {} : { ...props }
    if (childList.length === 1) next.children = childList[0]
    else if (childList.length > 1) next.children = childList
    return type(next)
  }
  const node = { type }
  if (props && Object.keys(props).length > 0) node.props = props
  if (childList.length > 0) node.children = childList
  return node
}
var j = /^confirm_/
function q(i) {
  let [r] = i,
    e =
      typeof r === 'object' && r !== null ? Reflect.get(r, 'question') : void 0
  if (typeof e !== 'string') return !1
  let [, ...f] = e.split(`

`)
  return f
    .join(`

`)
    .trim()
    .includes(`
`)
}
var V = 6
var X = 256
var Y = 45000
var b = 3
var J = 9604
var Z = 32
var O = 16777216
var tt = 9600
var y = {
  C: 14120791,
  E: 1315860,
  P: 6253434,
  R: 9740464,
  H: 4608352,
  S: 15316044,
  W: 12488284,
  s: 10134445,
  F: 16096779,
  f: 15680580,
  y: 16638023,
  G: 7041664,
}
var z = 16
var rt = 160
var ot = 18
var m = 44
var F = 9
function A(i) {
  let r = new Uint32Array(m * F * b)
  for (let t = 0; t < F; t++) {
    for (let e = 0; e < m; e++) {
      let f = y[i[t + t]?.[e] ?? '.'],
        o = y[i[t + t + 1]?.[e] ?? '.'],
        n = f === void 0 && o === void 0,
        s = f === void 0 && o !== void 0
      r.set(
        [n ? Z : s ? J : tt, (s ? o : f) ?? O, (s ? void 0 : o) ?? O],
        (t * m + e) * b,
      )
    }
  }
  return new Uint8Array(r.buffer).toBase64()
}
var it = (i, r) =>
  Array.from({ length: r }, () => Array.from({ length: i }, () => '.'))
function u(i, r, t) {
  let [e, f] = r,
    o = i[f]
  if (o !== void 0 && e >= 0 && e < o.length) o[e] = t
}
function ft(i, r) {
  let [t, e] = r.end,
    [f, o] = r.start,
    n = Math.abs(t - f),
    s = -Math.abs(e - o),
    l = f < t ? 1 : -1,
    a = o < e ? 1 : -1,
    p = n + s
  for (;;) {
    if (
      (() => {
        u(i, [f, o], r.letter)
        return f === t && o === e
      })()
    )
      return
    let x = 2 * p
    if (x >= s) {
      p += s
      f += l
    }
    if (x <= n) {
      p += n
      o += a
    }
  }
}
function d(i, r, t) {
  let [e, f] = t
  for (let [o, n] of r.entries())
    for (let [s, l] of [...n].entries()) if (l !== '.') u(i, [e + s, f + o], l)
}
var st = [23, 8]
var at = [1, 3]
var lt = [0, 17]
var ht = [26, 15]
var R = [23, 9]
var Ct = [
  [
    '.......................',
    '.....................CC',
    '....................CCC',
    '...................CCC.',
    '...CCCCCCCCCCCCC..CCC..',
    '...CCCCCCCCCCCCC.CCC...',
    '...CCCECCCCCCCECCCC....',
    '...CCCECCCCCCCECCC.....',
    '.CCCCCCCCCCCCCCC.......',
    '.CCCCCCCCCCCCCCC.......',
    '...CCCCCCCCCCCCC.......',
    '...CCCCCCCCCCCCC.......',
    '...C.C.......C.C.......',
    '...C.C.......C.C.......',
  ],
  [
    '.....................CC',
    '....................CCC',
    '...................CCC.',
    '..................CCC..',
    '...CCCCCCCCCCCCC..CC...',
    '...CCCCCCCCCCCCC.CC....',
    '...CCCECCCCCCCECCCC....',
    '...CCCECCCCCCCECCC.....',
    '.CCCCCCCCCCCCCCC.......',
    '.CCCCCCCCCCCCCCC.......',
    '...CCCCCCCCCCCCC.......',
    '...CCCCCCCCCCCCC.......',
    '...C.C.......C.C.......',
    '...C.C.......C.C.......',
  ],
]
var mt = ['GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG']
var dt = [
  'RRSSSSSSSSSSSSSSRR',
  '.RPPPPPPPPPPPPPPH.',
  'RRPPPPPPPPPPPPPPHR',
  '.RPPPPPPPPPPPPPPH.',
  '.RPPPPPPPPPPPPPPH.',
  '..PPPPPPPPPPPPPH..',
]
var ct = [
  ['.ss.', 'ssss', '.ss.'],
  ['.ss.', 'ssss'],
  ['sss.', '.ss.'],
  ['ss'],
  ['s'],
]
var ut = 9
var gt = [
  '....S.............',
  '....S.............',
  '..................',
  '.........S........',
  '.........S........',
  '..................',
  '.............S....',
  '.............S....',
  '....S.............',
  '....S.............',
  '..................',
  '.........S........',
  '.........S........',
  '..................',
  '.............S....',
  '.............S....',
]
var yt = [
  ['..F.y..y.F..', 'FfFfFfFfFfFf'],
  ['y..y.F..F.F.', 'fFfFfFfFfFfF'],
  ['.F..F.F..F.y', 'FfFfFfFfFfFf'],
  ['F.F..F.y..y.', 'fFfFfFfFfFfF'],
  ['.F.y..y.F..F', 'FfFfFfFfFfFf'],
  ['..y.F..F.F..', 'fFfFfFfFfFfF'],
  ['F..F.F..F.y.', 'FfFfFfFfFfFf'],
  ['.F..F.y..y.F', 'fFfFfFfFfFfF'],
  ['F.y..y.F..F.', 'FfFfFfFfFfFf'],
  ['.y.F..F.F..F', 'fFfFfFfFfFfF'],
  ['..F.F..F.y..', 'FfFfFfFfFfFf'],
  ['F..F.y..y.F.', 'fFfFfFfFfFfF'],
  ['.y..y.F..F.F', 'FfFfFfFfFfFf'],
  ['y.F..F.F..F.', 'fFfFfFfFfFfF'],
  ['.F.F..F.y..y', 'FfFfFfFfFfFf'],
  ['..F.y..y.F..', 'fFfFfFfFfFfF'],
]
var Ft = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0]
var Mt = [
  [26, 0],
  [30, 4],
  [34, 8],
  [37, 12],
]
var St = [
  [0, 0, 0],
  [0, 0, 0],
  [1, 1, 0],
  [1, 1, 0],
  [1, 2, 1],
  [2, 3, 1],
  [1, 4, 1],
  [1, 5, 2],
  [0, 6, 2],
  [-1, 7, 2],
  [-1, 8, 3],
  [-1, 8, 3],
  [0, 9, 4],
  [0, 9, 4],
]
var G = [
  [
    [19, 3],
    [35, 9],
  ],
  [
    [19, 3],
    [35, 9],
  ],
  [
    [19, 3],
    [34, 9],
  ],
  [
    [19, 3],
    [33, 9],
  ],
  [
    [19, 3],
    [31, 9],
  ],
  [
    [20, 1],
    [29, 9],
  ],
  [
    [20, 1],
    [28, 9],
  ],
  [
    [20, 1],
    [27, 9],
  ],
  [
    [20, 1],
    [27, 9],
  ],
  [
    [20, 1],
    [27, 9],
  ],
  [
    [20, 1],
    [28, 9],
  ],
  [
    [20, 1],
    [29, 9],
  ],
  [
    [19, 3],
    [31, 9],
  ],
  [
    [19, 3],
    [33, 9],
  ],
  [
    [19, 3],
    [34, 9],
  ],
  [
    [19, 3],
    [35, 9],
  ],
]
function L(i) {
  let r = i % z,
    t = it(m, ot),
    [, e] = R
  d(t, mt, lt)
  d(t, yt[r] ?? [], ht)
  for (let [a, p] of Mt) {
    let c = St[(r + p) % z]
    if (c !== void 0) {
      let [x, H, M] = c,
        C = ct[M] ?? []
      d(t, C, [a + x, e - H - C.length])
    }
  }
  let [f, o] = G[r] ?? G[0]
  ft(t, { start: f, end: o, letter: 'W' })
  d(t, dt, R)
  d(t, [gt[r] ?? ''], st)
  let n = Ct[Ft[r] ?? 0],
    l = r === ut ? n.map(a => a.replaceAll('E', 'C')) : n
  d(t, l, at)
  return t.map(a => a.join(''))
}
function Et(i, r) {
  let t = 0,
    e = 0,
    f = r(rt, () => void o())
  async function o() {
    t += 1
    e = (await i.paint(A(L(t))).catch(() => !1)) ? 0 : e + 1
    if (t >= X || e >= V) {
      f.cancel()
      i.ended()
    }
  }
}
var wt = i =>
  (i.noColor !== void 0 && i.noColor !== '') ||
  i.forceColor === '0' ||
  i.term === 'dumb'
var Pt =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 352 144" width="352" height="144" shape-rendering="crispEdges" role="img"><title>Clawd stirs a steaming pot</title><rect x="0" y="136" width="352" height="8" fill="#6b7280"/><g><rect x="208" y="128" width="8" height="8" fill="#f59e0b"/><rect x="224" y="128" width="8" height="8" fill="#f59e0b"/><rect x="240" y="128" width="8" height="8" fill="#f59e0b"/><rect x="256" y="128" width="8" height="8" fill="#f59e0b"/><rect x="272" y="128" width="8" height="8" fill="#f59e0b"/><rect x="288" y="128" width="8" height="8" fill="#f59e0b"/><rect x="216" y="128" width="8" height="8" fill="#ef4444"/><rect x="232" y="128" width="8" height="8" fill="#ef4444"/><rect x="248" y="128" width="8" height="8" fill="#ef4444"/><rect x="264" y="128" width="8" height="8" fill="#ef4444"/><rect x="280" y="128" width="8" height="8" fill="#ef4444"/><rect x="296" y="128" width="8" height="8" fill="#ef4444"/></g><g><rect x="224" y="120" width="8" height="8" fill="#fde047"/><rect x="256" y="120" width="8" height="8" fill="#fde047"/><rect x="280" y="120" width="8" height="8" fill="#fde047"/></g><g opacity="0.85" transform="translate(0 0)"><g transform="translate(208 48)"><path fill="#9aa3ad" d="M8 0h16v8h-16zM0 8h32v8h-32zM8 16h16v8h-16z"/></g></g><g opacity="0.6" transform="translate(-8 -36)"><g transform="translate(240 48)"><path fill="#9aa3ad" d="M8 0h16v8h-16zM0 8h32v8h-32zM8 16h16v8h-16z"/></g></g><g opacity="0.3" transform="translate(-10 -76)"><g transform="translate(272 48)"><path fill="#9aa3ad" d="M8 0h16v8h-16zM0 8h32v8h-32zM8 16h16v8h-16z"/></g></g><g><g><path fill="none" stroke="#be8e5c" stroke-width="8" stroke-linecap="square" d="M161.0 24.8L273.9 91.2"/></g></g><path fill="#94a0b0" d="M184 72h16v8h-16zM312 72h16v8h-16zM192 80h8v8h-8zM184 88h16v8h-16zM320 88h8v8h-8zM192 96h8v8h-8zM192 104h8v8h-8z"/><path fill="#e9b44c" d="M200 72h112v8h-112z"/><path fill="#5f6b7a" d="M200 80h112v8h-112zM200 88h112v8h-112zM200 96h112v8h-112zM200 104h112v8h-112zM200 112h104v8h-104z"/><path fill="#465160" d="M312 80h8v8h-8zM312 88h8v8h-8zM312 96h8v8h-8zM312 104h8v8h-8zM304 112h8v8h-8z"/><rect x="256" y="64" width="8" height="8" fill="#e9b44c"></rect><g><path fill="#d77757" d="M32 56h104v8h-104zM32 64h104v8h-104zM32 72h104v8h-104zM32 80h104v8h-104zM16 88h120v8h-120zM16 96h120v8h-120zM32 104h104v8h-104zM32 112h104v8h-104zM32 120h8v8h-8zM48 120h8v8h-8zM112 120h8v8h-8zM128 120h8v8h-8zM32 128h8v8h-8zM48 128h8v8h-8zM112 128h8v8h-8zM128 128h8v8h-8z"/><rect x="56" y="72" width="8" height="16" fill="#141414"></rect><rect x="120" y="72" width="8" height="16" fill="#141414"></rect><g><rect x="136" y="80" width="16" height="8" fill="#d77757"/><rect x="136" y="72" width="16" height="8" fill="#d77757"/><rect x="144" y="72" width="16" height="8" fill="#d77757"/><rect x="144" y="64" width="16" height="8" fill="#d77757"/><rect x="152" y="64" width="16" height="8" fill="#d77757"/><rect x="152" y="56" width="16" height="8" fill="#d77757"/><rect x="160" y="56" width="16" height="8" fill="#d77757"/><rect x="160" y="48" width="16" height="8" fill="#d77757"/><rect x="168" y="48" width="16" height="8" fill="#d77757"/><rect x="168" y="40" width="16" height="8" fill="#d77757"/><rect x="176" y="40" width="16" height="8" fill="#d77757"/><rect x="176" y="32" width="16" height="8" fill="#d77757"/></g></g></svg>'
var _t =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 352 144" width="352" height="144" shape-rendering="crispEdges" role="img"><title>Clawd stirs a steaming pot</title><rect x="0" y="136" width="352" height="8" fill="#6b7280"/><g><rect x="208" y="128" width="8" height="8" fill="#f59e0b"/><rect x="224" y="128" width="8" height="8" fill="#f59e0b"/><rect x="240" y="128" width="8" height="8" fill="#f59e0b"/><rect x="256" y="128" width="8" height="8" fill="#f59e0b"/><rect x="272" y="128" width="8" height="8" fill="#f59e0b"/><rect x="288" y="128" width="8" height="8" fill="#f59e0b"/><rect x="216" y="128" width="8" height="8" fill="#ef4444"/><rect x="232" y="128" width="8" height="8" fill="#ef4444"/><rect x="248" y="128" width="8" height="8" fill="#ef4444"/><rect x="264" y="128" width="8" height="8" fill="#ef4444"/><rect x="280" y="128" width="8" height="8" fill="#ef4444"/><rect x="296" y="128" width="8" height="8" fill="#ef4444"/></g><g><rect x="224" y="120" width="8" height="8" fill="#fde047"/><rect x="256" y="120" width="8" height="8" fill="#fde047"/><rect x="280" y="120" width="8" height="8" fill="#fde047"/><animate attributeName="opacity" values="1;0;1" dur=".5s" repeatCount="indefinite"/></g><g opacity="0"><rect x="216" y="120" width="8" height="8" fill="#f59e0b"/><rect x="240" y="120" width="8" height="8" fill="#f59e0b"/><rect x="272" y="120" width="8" height="8" fill="#f59e0b"/><rect x="288" y="120" width="8" height="8" fill="#f59e0b"/><animate attributeName="opacity" values="0;1;0" dur=".5s" repeatCount="indefinite"/></g><g opacity="0"><g transform="translate(208 48)"><path fill="#9aa3ad" d="M8 0h16v8h-16zM0 8h32v8h-32zM8 16h16v8h-16z"/></g><animateTransform attributeName="transform" type="translate" values="0 0;6 -36;-6 -76" dur="2.6s" begin="-0.00s" repeatCount="indefinite" calcMode="spline" keySplines=".3 0 .7 1;.3 0 .7 1"/><animate attributeName="opacity" values="0;.85;.6;0" keyTimes="0;.2;.6;1" dur="2.6s" begin="-0.00s" repeatCount="indefinite"/></g><g opacity="0"><g transform="translate(240 48)"><path fill="#9aa3ad" d="M8 0h16v8h-16zM0 8h32v8h-32zM8 16h16v8h-16z"/></g><animateTransform attributeName="transform" type="translate" values="0 0;-8 -36;8 -76" dur="2.6s" begin="-0.65s" repeatCount="indefinite" calcMode="spline" keySplines=".3 0 .7 1;.3 0 .7 1"/><animate attributeName="opacity" values="0;.85;.6;0" keyTimes="0;.2;.6;1" dur="2.6s" begin="-0.65s" repeatCount="indefinite"/></g><g opacity="0"><g transform="translate(272 48)"><path fill="#9aa3ad" d="M8 0h16v8h-16zM0 8h32v8h-32zM8 16h16v8h-16z"/></g><animateTransform attributeName="transform" type="translate" values="0 0;10 -36;-10 -76" dur="2.6s" begin="-1.30s" repeatCount="indefinite" calcMode="spline" keySplines=".3 0 .7 1;.3 0 .7 1"/><animate attributeName="opacity" values="0;.85;.6;0" keyTimes="0;.2;.6;1" dur="2.6s" begin="-1.30s" repeatCount="indefinite"/></g><g opacity="0"><g transform="translate(296 48)"><path fill="#9aa3ad" d="M8 0h16v8h-16zM0 8h32v8h-32zM8 16h16v8h-16z"/></g><animateTransform attributeName="transform" type="translate" values="0 0;-6 -36;6 -76" dur="2.6s" begin="-1.95s" repeatCount="indefinite" calcMode="spline" keySplines=".3 0 .7 1;.3 0 .7 1"/><animate attributeName="opacity" values="0;.85;.6;0" keyTimes="0;.2;.6;1" dur="2.6s" begin="-1.95s" repeatCount="indefinite"/></g><g><g><path fill="none" stroke="#be8e5c" stroke-width="8" stroke-linecap="square" d="M161.0 24.8L273.9 91.2"/><animateTransform attributeName="transform" type="rotate" values="12 180 36;-13 180 36;12 180 36" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/></g><animateTransform attributeName="transform" type="translate" values="0 0;0 2;0 0;0 2;0 0" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1"/></g><path fill="#94a0b0" d="M184 72h16v8h-16zM312 72h16v8h-16zM192 80h8v8h-8zM184 88h16v8h-16zM320 88h8v8h-8zM192 96h8v8h-8zM192 104h8v8h-8z"/><path fill="#e9b44c" d="M200 72h112v8h-112z"/><path fill="#5f6b7a" d="M200 80h112v8h-112zM200 88h112v8h-112zM200 96h112v8h-112zM200 104h112v8h-112zM200 112h104v8h-104z"/><path fill="#465160" d="M312 80h8v8h-8zM312 88h8v8h-8zM312 96h8v8h-8zM312 104h8v8h-8zM304 112h8v8h-8z"/><rect x="216" y="64" width="8" height="8" fill="#e9b44c" opacity="0"><animate attributeName="opacity" values="0;0;1;0" keyTimes="0;.6;.8;1" dur="1.3s" begin="-0.00s" repeatCount="indefinite"/></rect><rect x="256" y="64" width="8" height="8" fill="#e9b44c" opacity="0"><animate attributeName="opacity" values="0;0;1;0" keyTimes="0;.6;.8;1" dur="1.3s" begin="-0.45s" repeatCount="indefinite"/></rect><rect x="288" y="64" width="8" height="8" fill="#e9b44c" opacity="0"><animate attributeName="opacity" values="0;0;1;0" keyTimes="0;.6;.8;1" dur="1.3s" begin="-0.90s" repeatCount="indefinite"/></rect><g><path fill="#d77757" d="M32 56h104v8h-104zM32 64h104v8h-104zM32 72h104v8h-104zM32 80h104v8h-104zM16 88h120v8h-120zM16 96h120v8h-120zM32 104h104v8h-104zM32 112h104v8h-104zM32 120h8v8h-8zM48 120h8v8h-8zM112 120h8v8h-8zM128 120h8v8h-8zM32 128h8v8h-8zM48 128h8v8h-8zM112 128h8v8h-8zM128 128h8v8h-8z"/><rect x="56" y="72" width="8" height="16" fill="#141414"><animate attributeName="height" values="16;16;0;16;16" keyTimes="0;.55;.58;.62;1" dur="2.6s" repeatCount="indefinite"/></rect><rect x="120" y="72" width="8" height="16" fill="#141414"><animate attributeName="height" values="16;16;0;16;16" keyTimes="0;.55;.58;.62;1" dur="2.6s" repeatCount="indefinite"/></rect><g><rect x="136" y="80" width="16" height="8" fill="#d77757"/><rect x="136" y="72" width="16" height="8" fill="#d77757"/><rect x="144" y="72" width="16" height="8" fill="#d77757"/><rect x="144" y="64" width="16" height="8" fill="#d77757"/><rect x="152" y="64" width="16" height="8" fill="#d77757"/><rect x="152" y="56" width="16" height="8" fill="#d77757"/><rect x="160" y="56" width="16" height="8" fill="#d77757"/><rect x="160" y="48" width="16" height="8" fill="#d77757"/><rect x="168" y="48" width="16" height="8" fill="#d77757"/><rect x="168" y="40" width="16" height="8" fill="#d77757"/><rect x="176" y="40" width="16" height="8" fill="#d77757"/><rect x="176" y="32" width="16" height="8" fill="#d77757"/><animateTransform attributeName="transform" type="rotate" values="2 136 88;-2 136 88;2 136 88" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/></g><animateTransform attributeName="transform" type="translate" values="0 0;0 2;0 0;0 2;0 0" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1"/></g></svg>'
var U = 'How mods work'
var bt = 'Clawd stirs a steaming pot'
var I = 'clawd-cooking'
var Ot = 440
function zt(i, r, t) {
  let { Box: e, Svg: f, Text: o } = i
  return h(
    e,
    { flexDirection: 'column' },
    h(
      e,
      { flexDirection: 'column', marginBottom: 1 },
      h(o, { bold: !0 }, U),
      h(f, { source: t ? Pt : _t, alt: bt, width: Ot, isInteractive: !t }),
    ),
    r,
  )
}
function Tt(i, r, t) {
  let { Box: e, Raster: f, Text: o } = i
  return h(
    e,
    { flexDirection: 'column' },
    h(
      e,
      { flexDirection: 'column', marginBottom: 1 },
      h(o, { bold: !0 }, U),
      h(f, { key: I, columns: m, rows: F, cells: t }),
    ),
    r,
  )
}
var At = 2
var Rt = 60
var B = 36
var Gt = 80
function ie(on) {
  let r = new Map()
  on(
    'ui.render',
    {
      component: 'AskUserQuestion',
      requestId: j,
      props: { metadataSource: 'mod_hot_reload' },
    },
    async (t, e, f) => {
      let o = await f(e)
      if (!(e.component === 'AskUserQuestion' && q(e.props.questions))) return o
      let l = (await t.settings.read()).prefersReducedMotion === !0
      if (e.surface !== 'terminal') return zt(await t.ui.resolve(e), o, l)
      let a = e.viewport?.columns ?? Gt,
        p = e.viewport?.rows ?? B,
        c = a >= m + At && p >= B
      if (
        wt({
          noColor: await t.env.get('NO_COLOR'),
          forceColor: await t.env.get('FORCE_COLOR'),
          term: await t.env.get('TERM'),
        }) ||
        !c
      )
        return o
      let M = l || a < Rt,
        C = e.requestId,
        K = await t.clock.now()
      if (!M && (r.get(C) ?? 0) <= K) {
        r.set(C, K + Y)
        Et(
          {
            paint: async S =>
              (await t.ui.blit({ requestId: C, key: I, cells: S })).deny ===
              void 0,
            ended: () => r.delete(C),
          },
          (S, It) => t.clock.every(S, It),
        )
      }
      return Tt(await t.ui.resolve(e), o, A(L(0)))
    },
  )
}
export function register(on) {
  ie(on)
}
