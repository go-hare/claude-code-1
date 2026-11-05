// @ts-nocheck — SourceTextModule evaluates this as JS; no TypeScript syntax.
/**
 * densable 2.1.289 `cc-plugin-diff` hooksModule (`Ne` / `ym`).
 */
function h(type, props, ...childList) {
  const flatChildren = childList
    .flat(Infinity)
    .filter(c => c !== null && c !== undefined && c !== false)
  if (typeof type === 'function') {
    const next = props == null ? {} : { ...props }
    if (flatChildren.length === 1) next.children = flatChildren[0]
    else if (flatChildren.length > 1) next.children = flatChildren
    return type(next)
  }
  const node = { type }
  if (props && Object.keys(props).length > 0) node.props = props
  if (flatChildren.length > 0) node.children = flatChildren
  return node
}
var Te = e => (Array.isArray(e) ? e : [])
var $t = 144
var Qr = 23
var Be = 110
var ut = 1
var zt = 8
var Xt = 12
var Jr = 200
var es = 20
var ts = 4194304
var Yt = 1e6
var Vt = 50
var qt = 500
var xt = 400
var yt = 512
var os = 12000
var Zt = 500
var q = 5
var rs = 3
var Fe = 8
var ve = 1
var ht = 20
var ss = 8
var ns = 3
var is = 32000
var as = 5000
var fs = 2000
var ps = 100
var ms = 150
var ls = 20
var ds = 12
function cs(e, o) {
  let r = o
    .flatMap(s => [`@@ -${s.oldStart} +${s.newStart} @@`, ...s.lines])
    .slice(0, xt)
  return {
    path: e,
    text: `The user attached the diff of ${e} from the diff pane to this prompt:
${r.join(`
`)}`,
    lines: r.length,
  }
}
var gt = '(The rest of this diff was cut: it did not fit in the prompt.)'
function us(e, o) {
  if (e.length <= o) return e
  let r = [],
    s = gt.length
  for (let a of e.split(`
`)) {
    let i = a.length + 1
    if (s + i > o) break
    r.push(a)
    s += i
  }
  return r.length > 1
    ? `${r.join(`
`)}
${gt}`
    : void 0
}
var He = [
  '--no-optional-locks',
  '-c',
  'diff.relative=false',
  '-c',
  'core.quotePath=false',
  'diff',
  '--no-ext-diff',
  '--no-textconv',
  '--ignore-submodules=dirty',
  '--submodule=short',
]
var ys = { LC_ALL: 'C', LANGUAGE: '' }
var hs = [
  '--no-renames',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '--raw',
  '-z',
  '-p',
]
var W = '--no-optional-locks'
var gs = e => [`--git-dir=${e.gitDir}`, `--work-tree=${e.toplevel}`]
function Tt(e) {
  let o = xt,
    r = 0
  return {
    hunks: e.map(s => {
      let n = s.lines.slice(0, o)
      o -= n.length
      r += s.lines.length
      return { ...s, lines: n }
    }),
    isTruncated: r > xt,
  }
}
function Qt(e, o) {
  let r = 0,
    s = 0
  for (let d = 0; d < e.length && d < o.length; d++) {
    if (e[d] !== o[d]) break
    if (e[d] === '/') r = d + 1
  }
  let n = r - (r > 0 ? 1 : 0)
  for (let d = 1; e.length - d >= n && o.length - d >= n; d++) {
    let O = e[e.length - d]
    if (O !== o[o.length - d]) break
    if (O === '/') s = d
  }
  let a = d => d.slice(r, Math.max(r, d.length - s)),
    i = `${a(e)} => ${a(o)}`,
    f = r + s > 0,
    l = e.slice(0, r),
    x = e.slice(e.length - s)
  return f ? `${l}{${i}}${x}` : i
}
function Oe(e) {
  let { renamedFrom: o, path: r } = e
  return o === null ? r : Qt(o, r)
}
var Ue = Object.freeze({ hunks: [], isTruncated: !1, isLarge: !1 })
var Jt = Object.freeze({ exitCode: -1, stdout: '', stderr: '' })
async function to(e) {
  let { exitCode: o, stdout: r } = await e([
      W,
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
    ]),
    s = r.trim()
  return o === 0 && s !== '' ? s : 'HEAD'
}
var oo = ['main', 'master']
async function ro(e) {
  let o = async n =>
      (
        await e([
          W,
          'show-ref',
          '--verify',
          '--quiet',
          `refs/remotes/origin/${n}`,
        ])
      ).exitCode === 0,
    r = await e([W, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']),
    s = r.exitCode === 0 ? r.stdout.trim().replace(/^origin\//, '') : ''
  if (s !== '' && (await o(s))) return s
  for (let n of oo) if (await o(n)) return n
  return 'main'
}
var so = e => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(e)
async function no(e, o) {
  let r = [
    await e([W, 'merge-base', 'HEAD', `origin/${o}`]),
    await e([W, 'merge-base', 'HEAD', o]),
  ]
  return {
    candidates: r
      .filter(s => s.exitCode === 0)
      .map(s => s.stdout.trim())
      .filter(so),
    hasNoCommonAncestor: r.some(s => s.exitCode === 1),
  }
}
async function io(e, o) {
  for (let r of [`refs/remotes/origin/${o}`, `refs/heads/${o}`]) {
    let { exitCode: s } = await e([W, 'show-ref', '--verify', '--quiet', r])
    if (s === 0 || s === -1)
      return { kind: 'error', reason: 'merge_base_failed' }
  }
  return { kind: 'none' }
}
async function Ts(e) {
  let [o, r] = await Promise.all([to(e), ro(e)])
  if (o === 'HEAD' || r.startsWith('-')) return { kind: 'none' }
  if (o === r) return { kind: 'head-is-base', baseBranch: r }
  let { candidates: n, hasNoCommonAncestor: a } = await no(e, r),
    [i, f] = n
  if (i === void 0) return a ? { kind: 'none' } : io(e, r)
  let x =
      f !== void 0 &&
      f !== i &&
      (await e([W, 'merge-base', '--is-ancestor', i, f])).exitCode === 0
        ? f
        : i,
    d = await e([W, 'rev-parse', 'HEAD'])
  if (d.exitCode !== 0)
    return { kind: 'error', reason: 'head_rev_parse_failed' }
  return d.stdout.trim() === x
    ? { kind: 'head-is-base', baseBranch: r }
    : { kind: 'merge-base', mergeBase: x, baseBranch: r }
}
async function se(e, o) {
  let r = o.endsWith('/'),
    s = r ? o.slice(0, -1) : o,
    n = await e.walk.kindOf(s)
  return n === 'over-budget'
    ? 'over-budget'
    : n === (r ? 'dir' : 'file')
      ? e.mtimeOf(`${e.base}/${s}`)
      : null
}
async function Ge(e, o) {
  let { sessionStartMs: r } = e.deps,
    s = await Promise.all(o.map(a => se(e.stamps, a)))
  function n(a) {
    if (a === 'over-budget') return 'unlisted'
    return (a ?? Number.POSITIVE_INFINITY) < r ? 'pre-session' : 'session'
  }
  return new Map(o.map((a, i) => [a, n(s[i] ?? null)]))
}
var Se = 'diff --git '
var Ot = /^@@ -(?<old>\d+)(?:,\d+)? \+(?<new>\d+)(?:,\d+)? @@/
var We = e => e.startsWith('+') || e.startsWith('-') || e.startsWith(' ')
var Ke = 3
var ao = (e, o) => e.length * Ke < o || new TextEncoder().encode(e).length < o
var je = (e, o = '\x00') => (e === '' || e.endsWith(o)) && ao(e, ts - Ke)
var $e = e => e.exitCode === 0 && je(e.stdout)
var fo = (e, o) => ({
  oldStart: Number(e?.old),
  newStart: Number(e?.new),
  lines: o,
})
var po = Object.freeze({ hunks: [], isTruncated: !1, isLarge: !0 })
function mo(e) {
  if (e.length > Yt) return po
  let o = e.split(`
`),
    r = o.flatMap((s, n) => (Ot.test(s) ? [n] : []))
  return {
    ...Tt(
      r.map((s, n) =>
        fo(Ot.exec(o[s] ?? '')?.groups, o.slice(s + 1, r[n + 1]).filter(We)),
      ),
    ),
    isLarge: !1,
  }
}
var lo = `${Se}"`
var co = ' U'
function Os(e, o) {
  let r = e.split('\x00'),
    s = r.findIndex((y, E) => E % 2 === 0 && !y.startsWith(':')),
    n = r.slice(0, s).filter((y, E) => E % 2 === 1 && !r[E - 1]?.endsWith(co)),
    a = r[s] === '',
    i = r
      .slice(s + (a ? 1 : 0))
      .join('\x00')
      .split(`
`),
    f = i.flatMap((y, E) => (y.startsWith(Se) ? [E] : [])),
    l = f.filter((y, E) => i[y] !== i[f[E - 1] ?? -1]),
    x = je(
      e,
      `
`,
    ),
    d = l
      .map((y, E) => {
        let S = l[E + 1],
          A = n[E] ?? '',
          b = S === void 0
        return {
          path: A,
          isNamed: i[y]?.startsWith(lo) === !0 || i[y] === `${Se}a/${A} b/${A}`,
          isCut: b && !x,
          text:
            i.slice(y, S).join(`
`) +
            (b
              ? ''
              : `
`),
        }
      })
      .filter(y => !y.isCut || y.text.length > Yt)
  if (
    !(
      s !== -1 &&
      l.length <= n.length &&
      (l.length === n.length || l.length === 0 || !x) &&
      d.every(y => y.isNamed)
    )
  )
    return new Map()
  let _ = new Map(d.map(y => [y.path, mo(y.text)])),
    P = x ? [] : n.slice(d.length)
  return new Map(o.filter(y => !P.includes(y)).map(y => [y, _.get(y) ?? Ue]))
}
var xo = 3
function yo(e, o) {
  let r = [],
    s = { filesCount: 0, linesAdded: 0, linesRemoved: 0 },
    n = e.split('\x00'),
    a = 0
  while (a < n.length) {
    let [i, f, ...l] = (n[a] ?? '').split('\t'),
      x = l.join('\t'),
      d = l.length === 1 && x === '',
      O = d ? (n[a + 1] ?? null) : null,
      _ = d ? (n[a + 2] ?? '') : x
    if (
      (() => {
        a += d ? xo : 1
        return !(i !== void 0 && f !== void 0 && _ !== '')
      })()
    )
      continue
    let y = i === '-' || f === '-',
      E = y ? 0 : Number(i) || 0,
      S = y ? 0 : Number(f) || 0
    if (
      (() => {
        ;(() => {
          ;(() => {
            s.filesCount += 1
            return (s.linesAdded += E)
          })()
          return (s.linesRemoved += S)
        })()
        return r.length < o
      })()
    )
      r.push({
        path: _,
        renamedFrom: O,
        added: E,
        removed: S,
        isBinary: y,
        isUntracked: !1,
        isPreSession: !1,
      })
  }
  return { stats: s, files: r }
}
var ho = new RegExp(
  [
    String.raw`(?<files>\d+) files? changed`,
    String.raw`(?:, (?<added>\d+) insertions?\(\+\))?`,
    String.raw`(?:, (?<removed>\d+) deletions?\(-\))?`,
  ].join(''),
)
function Ss(e) {
  let o = ho.exec(e)?.groups
  if (!o) return null
  return {
    filesCount: Number(o.files),
    linesAdded: Number(o.added ?? 0),
    linesRemoved: Number(o.removed ?? 0),
  }
}
var go = 3
async function Es(e) {
  let o = await e([
      W,
      'status',
      '--porcelain',
      '-z',
      '--untracked-files=all',
      '--no-renames',
      '--ignore-submodules=dirty',
    ]),
    r = o.stdout.split('\x00').filter(s => s !== '')
  return $e(o) ? new Set(r.map(s => s.slice(go))) : null
}
var To = /^refs(?:\/[A-Za-z0-9_@+-][A-Za-z0-9._@+-]*)+$/
var Oo = e =>
  To.test(e) &&
  !e.includes('..') &&
  !e.split('/').some(o => o.endsWith('.lock'))
function So(e, o, r) {
  let s = new Map()
  function n(i) {
    let f = s.get(i)
    if (f === void 0 && s.size >= r) return 'over-budget'
    let x = f ?? e(i === '' ? o : `${o}/${i}`)
    s.set(i, x)
    return x
  }
  async function a(i) {
    let f = i === '' ? [] : i.split('/'),
      l = ''
    for (let [x, d] of f.entries()) {
      let O = n(l)
      if (O === 'over-budget') return 'over-budget'
      let _ = (await O)?.get(d) ?? null
      if (x === f.length - 1) return _
      if (_ !== 'dir') return null
      l = l === '' ? d : `${l}/${d}`
    }
    return 'dir'
  }
  return { kindOf: a }
}
var ze = (e, o, r) => ({
  walk: So(e.entryKindsOf, o, r),
  base: o,
  mtimeOf: e.mtimeOf,
})
async function _s(e, o) {
  let r = ze(e, o.gitDir, yt),
    n = o.commonDir === o.gitDir ? r : ze(e, o.commonDir, yt)
  async function a() {
    let P = await e.run([W, 'rev-parse', '--verify', '--quiet', 'HEAD'])
    return `rev:${P.exitCode === 0 ? P.stdout.trim() : ''}`
  }
  if ((await r.walk.kindOf('HEAD')) !== 'file') return a()
  let i = await e.readFile(`${o.gitDir}/HEAD`).catch(() => ''),
    f = i.startsWith('ref: ') ? i.slice(5).trim() : '',
    l = f !== '',
    x = l && !Oo(f),
    d = x ? await se(r, 'logs/HEAD') : null,
    O = x && typeof d !== 'number',
    _ = l && !x
  return O
    ? a()
    : [
        i,
        await se(r, 'HEAD'),
        _ ? await se(n, f) : d,
        await se(n, 'packed-refs'),
      ].join('|')
}
var Eo = e => e.startsWith('/') || /^[A-Za-z]:[\\/]/.test(e)
var fe = {
  head: 'REBASE_HEAD',
  merge: 'rebase-merge',
  apply: 'rebase-apply',
  rebasing: 'rebasing',
}
var _o = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']
async function Ps(e, o) {
  let r = await e(o),
    s = r?.get(fe.head) === 'file',
    a = s && r?.get(fe.apply) === 'dir' ? await e(`${o}/${fe.apply}`) : null
  return (
    (s && (r?.get(fe.merge) === 'dir' || a?.get(fe.rebasing) === 'file')) ||
    _o.some(f => r?.get(f) === 'file')
  )
}
async function ws(e) {
  let { exitCode: o } = await e([W, 'rev-parse', '--verify', '--quiet', 'HEAD'])
  return o === 1
}
function Rs(e, o) {
  let r = new Map(o.files.map(i => [i.path, i])),
    s = e.files.map(i => {
      let f = r.get(i.path)
      if (!f) return i
      let l = i.isBinary || f.isBinary,
        x = l ? 0 : Math.max(0, i.added + f.added - f.removed)
      return { ...i, added: x, removed: 0, isBinary: l }
    }),
    n =
      e.stats.linesAdded +
      s.reduce((i, f) => i + f.added, 0) -
      e.files.reduce((i, f) => i + f.added, 0)
  return { stats: { ...e.stats, linesAdded: n }, files: s }
}
var Po = 3
async function ks(e) {
  let { exitCode: o, stdout: r } = await e([
      W,
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-dir',
      '--git-common-dir',
    ]),
    s = r
      .split(`
`)
      .filter(l => l !== ''),
    [n = '', a = '', i = ''] = s
  return o === 0 && s.length === Po && s.every(Eo)
    ? { toplevel: n, gitDir: a, commonDir: i }
    : null
}
async function St(e, o) {
  let r = e.run,
    s = await r([...He, o, '--shortstat']),
    n = s.exitCode === 0 ? Ss(s.stdout) : null
  if (n !== null && n.filesCount > qt) return { stats: n, files: [] }
  let i = await r([...He, o, '--numstat', '-z'])
  return $e(i) ? yo(i.stdout, Vt) : null
}
var Xe = (e, o) => e.deps.baseline?.has(o) ?? !0
async function bs(e, o) {
  let r = await Ge(
    e,
    o.map(s => s.path),
  )
  return o.map(s => ({
    ...s,
    isPreSession: r.get(s.path) === 'pre-session' && Xe(e, s.path),
  }))
}
async function As(e) {
  let o = await e([...He, '--numstat', '-z'])
  return $e(o) ? yo(o.stdout, Number.POSITIVE_INFINITY) : null
}
async function wo(e, o, r) {
  let s = o.slice(0, Zt),
    n = await Ge(e, s),
    a = (d, O) => O === 'unlisted' || (O === 'pre-session' && Xe(e, d)),
    i = s.map(d => ({ path: d, isPreSession: a(d, n.get(d)) })),
    l =
      r.scope === 'with-pre-session'
        ? [
            ...i.filter(d => d.isPreSession),
            ...o.slice(Zt).map(d => ({ path: d, isPreSession: !0 })),
          ]
        : []
  return [...i.filter(d => !d.isPreSession), ...l].slice(0, r.slots).map(d => ({
    path: d.path,
    renamedFrom: null,
    added: 0,
    removed: 0,
    isBinary: !1,
    isUntracked: !0,
    isPreSession: d.isPreSession,
  }))
}
async function Ns(e, o) {
  if (o.slots <= 0) return []
  let r = await e.run([
    W,
    'ls-files',
    '-z',
    '--others',
    '--exclude-standard',
    '--full-name',
  ])
  return $e(r)
    ? wo(
        e,
        r.stdout.split('\x00').filter(s => s !== ''),
        o,
      )
    : null
}
function Ro(e) {
  switch (e.kind) {
    case 'merge-base':
      return { kind: 'branch', baseBranch: e.baseBranch, baseRef: e.mergeBase }
    case 'head-is-base':
      return { kind: 'branch', baseBranch: e.baseBranch, baseRef: 'HEAD' }
    case 'none':
      return { kind: 'working-tree', base: 'HEAD' }
  }
}
var pe = (e, o, r) => ({
  repository: e.repository,
  mode: e.mode,
  stats: o.stats,
  files: o.files,
  source: r.source,
  baseRef: r.baseRef,
  isUnborn: r.isUnborn,
  stalePaths: r.stalePaths,
  isUntrackedWithheld: o.isUntrackedWithheld,
})
var ko = Object.freeze({
  stats: Object.freeze({ filesCount: 0, linesAdded: 0, linesRemoved: 0 }),
  files: Object.freeze([]),
})
var _e = (e, o) => ({ ...e, ...o })
function bo(e, o) {
  if (!o) return _e(e, { isUntrackedWithheld: !0 })
  let r = new Set(e.files.map(i => i.path)),
    s = o.filter(i => !r.has(i.path)),
    n = e.stats.filesCount + s.length,
    a = { ...e.stats, filesCount: n }
  return _e(
    { stats: a, files: [...e.files, ...s] },
    { isUntrackedWithheld: !1 },
  )
}
var Ao = e => e.stats.filesCount > qt
async function me(e, o, r) {
  return Ao(o)
    ? _e(o, { isUntrackedWithheld: !1 })
    : bo(o, await Ns(e, { slots: Vt - o.files.length, scope: r }))
}
async function Pe(e) {
  let { run: o } = e
  if (!(await ws(o))) return { kind: 'unavailable' }
  let r = await St(e, '--cached')
  if (!r) return { kind: 'unavailable' }
  let n = r.files.length > 0 ? await As(o) : ko
  if (!n) return { kind: 'unavailable' }
  let a = await me(e, Rs(r, n), 'session-only')
  return {
    kind: 'data',
    data: pe(e, a, {
      source: { kind: 'working-tree', base: 'HEAD' },
      baseRef: '--cached',
      isUnborn: !0,
      stalePaths: n.files.map(i => i.path),
    }),
  }
}
async function Ds(e) {
  let { deps: o, run: r } = e,
    s = await Ts(r)
  if (
    (() => {
      o.onBranchBase(s)
      return s.kind === 'error'
    })()
  )
    return Pe(e)
  let n = Ro(s),
    a = n.kind === 'branch' ? n.baseRef : 'HEAD',
    i = await St(e, a)
  if (i === null && s.kind === 'merge-base') return { kind: 'unavailable' }
  if (!i) return Pe(e)
  return {
    kind: 'data',
    data: pe(e, await me(e, i, 'session-only'), {
      source: n,
      baseRef: a,
      isUnborn: !1,
      stalePaths: [],
    }),
  }
}
var Ms = (e, o) => ({
  deps: e,
  run: e.run,
  repository: e.repository,
  mode: o,
  stamps: ze(e, e.repository.toplevel, yt),
})
var No = Object.freeze({
  source: Object.freeze({ kind: 'working-tree', base: 'HEAD' }),
  baseRef: 'HEAD',
  isUnborn: !1,
  stalePaths: Object.freeze([]),
})
async function Ls(e) {
  let o = await St(e, 'HEAD')
  if (!o) return Pe(e)
  let r = e.mode === 'session',
    s = r ? await bs(e, o.files) : o.files
  return {
    kind: 'data',
    data: pe(
      e,
      await me(
        e,
        { stats: o.stats, files: s },
        r ? 'with-pre-session' : 'session-only',
      ),
      No,
    ),
  }
}
async function Do(e, o) {
  if (await Ps(e.entryKindsOf, e.repository.gitDir))
    return { kind: 'unavailable' }
  let s = Ms(e, o)
  return o === 'branch' ? Ds(s) : Ls(s)
}
var Mo = (e, o) => e.files.filter(r => !r.isUntracked).at(-1)?.path === o.path
function Lo(e) {
  let o = e.hunks.at(-1)
  return o !== void 0 && !e.isTruncated
    ? {
        ...e,
        hunks: [...e.hunks.slice(0, -1), { ...o, lines: [...o.lines, ' '] }],
      }
    : e
}
async function Et(e, o, r) {
  let s = r.filter(
      y =>
        !y.isUntracked &&
        !y.isBinary &&
        y.renamedFrom === null &&
        !o.stalePaths.includes(y.path),
    ),
    n = r.filter(y => !s.includes(y)).map(y => [y.path, Ue])
  if (s.length === 0) return new Map(n)
  let a = 0,
    i = s
      .map(y => y.path)
      .filter((y, E) => {
        a += y.length
        return E === 0 || a <= os
      }),
    { exitCode: f, stdout: l } = await e([
      '--literal-pathspecs',
      ...He,
      ...hs,
      o.baseRef,
      '--',
      ...i,
    ]),
    d = f === 0 ? Os(l, i) : new Map(),
    O = s.filter(y => !d.has(y.path)),
    P = d.size === 0 ? O.map(y => [y.path, null]) : await Et(e, o, O)
  return new Map([
    ...n,
    ...s.flatMap(y => {
      let E = d.get(y.path),
        S = Mo(o, y)
      return E ? [[y.path, S ? E : Lo(E)]] : []
    }),
    ...P,
  ])
}
var _t = Object.freeze(['session', 'uncommitted', 'branch'])
var Pt = Object.freeze({
  base: 'HEAD',
  diffCommand: 'git diff',
  lister: 'git',
  untrackedNoteOf: (e, o) => [
    'New file not yet staged.',
    o
      ? `Run \`git add :/${e}\` to see line counts.`
      : 'Stage it with git add to see line counts.',
  ],
})
async function Cs(e) {
  let o = i => async f => {
      try {
        return await e.run(['git', ...(i ? gs(i) : []), ...f], {
          timeoutMs: as,
          env: ys,
          ...(i && { cwd: i.toplevel }),
        })
      } catch {
        return Jt
      }
    },
    r = await ks(o(null))
  if (!r) return null
  let s = o(r),
    n = null,
    a = i => ({
      run: s,
      repository: r,
      mtimeOf: e.mtimeOf,
      entryKindsOf: e.entryKindsOf,
      sessionStartMs: e.sessionStartMsOf(),
      baseline: i,
      onBranchBase: e.onBranchBase,
    })
  return {
    repository: r,
    baseModes: _t,
    words: Pt,
    fetchDiff: async i => {
      n ??= Es(s)
      return Do(a(await n), i)
    },
    fetchHunks: (i, f) => Et(s, i, f),
    headKeyOf: () => _s({ ...a(null), readFile: e.readFile }, r),
  }
}
var G = (e, o) => e.reduce((r, s) => r + (o(s) ? 1 : 0), 0)
function Io(e, o) {
  let r = e.lines.slice(0, o)
  return {
    oldStart: e.oldStart + G(r, s => !s.startsWith('+')),
    newStart: e.newStart + G(r, s => !s.startsWith('-')),
    lines: e.lines.slice(o),
  }
}
async function Bs(e, o) {
  for (let r of o) {
    let s = await r(e)
    if (s) return s
  }
  return Cs(e)
}
var Fs = new Set()
var Ye = e => e.split('/').at(-1) ?? e
var Co = [
  '/dist/',
  '/build/',
  '/out/',
  '/output/',
  '/node_modules/',
  '/vendor/',
  '/vendored/',
  '/third_party/',
  '/third-party/',
  '/external/',
  '/.next/',
  '/.nuxt/',
  '/.svelte-kit/',
  '/coverage/',
  '/__pycache__/',
  '/.tox/',
  '/venv/',
  '/.venv/',
  '/target/release/',
  '/target/debug/',
  '.generated/',
  '/__snapshots__/',
]
var Bo = Object.freeze([
  /\.min\.[a-z]+$/i,
  /-min\.[a-z]+$/i,
  /\.bundle\.[a-z]+$/i,
  /\.generated\.[a-z]+$/i,
  /\.gen\.[a-z]+$/i,
  /\.auto\.[a-z]+$/i,
  /_generated\.[a-z]+$/i,
  /_gen\.[a-z]+$/i,
  /\.pb\.(?:go|js|ts|py|rb)$/i,
  /_pb2?\.py$/i,
  /\.pb\.h$/i,
  /\.grpc\.[a-z]+$/i,
  /\.swagger\.[a-z]+$/i,
  /\.openapi\.[a-z]+$/i,
  /\.snap$/i,
])
var Fo = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'composer.lock',
  'gemfile.lock',
  'cargo.lock',
  'poetry.lock',
  'pipfile.lock',
  'shrinkwrap.json',
  'npm-shrinkwrap.json',
])
var vo = [
  '.lock',
  '.min.js',
  '.min.css',
  '.min.html',
  '.bundle.js',
  '.bundle.css',
  '.generated.ts',
  '.generated.js',
  '.d.ts',
]
var Ve = e => `/${e.replace(/^\/+/, '')}`
function Ho(e) {
  let o = Ye(e).toLowerCase(),
    r = Ve(e),
    s = vo.some(n => o.endsWith(n))
  return (
    Fo.has(o) || s || Co.some(n => r.includes(n)) || Bo.some(n => n.test(o))
  )
}
var Uo = [
  '/test/',
  '/tests/',
  '/spec/',
  '/specs/',
  '/__tests__/',
  '/__mocks__/',
  '/__snapshots__/',
  '/__fixtures__/',
  '/fixtures/',
  '/testdata/',
]
var Go = Object.freeze([
  /\.test\.[a-z]+$/i,
  /\.spec\.[a-z]+$/i,
  /_test\.[a-z]+$/i,
  /_spec\.[a-z]+$/i,
  /\.snap$/i,
])
function Wo(e) {
  let o = Ye(e),
    r = Ve(e)
  return Uo.some(s => r.includes(s)) || Go.some(s => s.test(o))
}
var Hs = e => Wo(e) || Ho(e)
var Gs = 'Toggle the diff panel showing uncommitted changes'
var Ws = 'diff'
var Ko = e => `base:${e}`
var we = 'open'
var Z = 'diff'
var jo = 'Diff'
var Ks = ['diff', 'cc-plugin-diff']
var js = /refused: it is the built-in \//
var $s =
  "The diff panel couldn't read git state \u2014 git didn't answer; run /diff " +
  'again'
var zs = 'more below (opt+\u2193 to scroll)'
var $o =
  "The diff panel shows git changes \u2014 the current directory isn't in a " +
  'git repository'
var Xs = 'Diff dialog dismissed'
var Ys = 'Diff panel hidden'
var Vs = 'Diff panel shown'
var qs = e =>
  `could not register /diff: ${e}; the diff panel is unavailable this session`
var wt = 'Resize your terminal to at least 110 columns to show the diff panel'
var zo = e =>
  `Untracked files unavailable (${e.words.lister} could not list them); not counted`
var Xo = { name: Ws, description: Gs }
var z = e => typeof e === 'object' && e !== null && !Array.isArray(e)
var Yo = ['Edit', 'Write', 'NotebookEdit']
function Zs(e) {
  let o = e
  return o === void 0 || (o.deny === void 0 && o.isReadOnly !== !0)
}
var Qs = ['Bash', 'PowerShell']
var Js = 'TodoWrite'
function en(e) {
  let o = e.flatMap(s => s.toolUses).findLast(s => s.tool === Js),
    r = Te(o?.input.todos).map(s => (z(s) ? s.status : null))
  return { done: G(r, s => s === 'completed'), total: r.length }
}
var qo = e =>
  Te(e)
    .filter(z)
    .flatMap(o => {
      let { oldStart: r, newStart: s, lines: n } = o
      return typeof r === 'number' && typeof s === 'number' && Array.isArray(n)
        ? [
            {
              oldStart: r,
              newStart: s,
              lines: Te(n).filter(i => typeof i === 'string'),
            },
          ]
        : []
    })
function Zo(e) {
  if (!z(e) || typeof e.filePath !== 'string') return null
  let o = qo(e.structuredPatch),
    r = e.type === 'create'
  if (o.length > 0) {
    let n = o.flatMap(a => a.lines)
    return {
      path: e.filePath,
      hunks: o,
      added: G(n, a => a.startsWith('+')),
      removed: G(n, a => a.startsWith('-')),
      isNewFile: r,
      isTruncated: !1,
    }
  }
  if (!r || typeof e.content !== 'string') return null
  let s = e.content.split(`
`)
  return {
    path: e.filePath,
    hunks: [{ oldStart: 0, newStart: 1, lines: s.map(n => `+${n}`) }],
    added: s.length,
    removed: 0,
    isNewFile: !0,
    isTruncated: !1,
  }
}
var on = e =>
  e.role === 'user' &&
  (e.toolResults === void 0 || e.toolResults.length === 0) &&
  e.text !== ''
var Rt = 30
function rn(e, o) {
  let r = e[0]?.text ?? '',
    n = [...r].length <= Rt ? r : `${[...r].slice(0, Rt - 1).join('')}\u2026`,
    a = e
      .flatMap(l => (l.role === 'assistant' ? l.toolUses : []))
      .map(l => Zo(l.result))
      .filter(l => l !== null),
    i = new Map()
  for (let l of a) {
    let x = i.get(l.path)
    i.set(
      l.path,
      x
        ? {
            path: l.path,
            hunks: [...x.hunks, ...l.hunks],
            added: x.added + l.added,
            removed: x.removed + l.removed,
            isNewFile: x.isNewFile || l.isNewFile,
            isTruncated: !1,
          }
        : l,
    )
  }
  let f = [...i.values()].map(l => ({ ...l, ...Tt(l.hunks) }))
  return { index: o, preview: n, files: f }
}
function Qo(e) {
  let o = e.flatMap((r, s) => (on(r) ? [s] : []))
  return o
    .map((r, s) => rn(e.slice(r, o[s + 1]), s + 1))
    .filter(r => r.files.length > 0)
    .toReversed()
}
function nn(e, o) {
  let { outcome: r, messages: s } = o,
    n = r.kind === 'data',
    a = r.kind === 'unavailable',
    i = n ? r.data : a ? e.data : null
  return {
    ...e,
    isLoading: !1,
    hasSettled: !0,
    isOutsideRepository: r.kind === 'no-repository',
    data: i,
    turns: Qo(s),
    todos: en(s),
  }
}
var ce = new Map()
var er = Object.freeze({
  selectedPath: null,
  source: Object.freeze({ kind: 'current' }),
  turns: Object.freeze([]),
  bodies: ce,
})
var an = e => ({ ...e, ...er })
function fn(e) {
  return e === 'session' || e === 'uncommitted' || e === 'branch' ? e : null
}
function Q(e) {
  let { source: o } = e,
    r = o.kind === 'turn' ? o.index : null
  return e.turns.find(s => s.index === r)
}
var tr = e => ({
  title: `Turn ${e.index}`,
  subtitle: e.preview === '' ? '' : `"${e.preview}"`,
})
function pn(e) {
  let o = Q(e),
    r = e.data?.source,
    s = e.data?.isUnborn === !0,
    n = r?.kind === 'branch'
  function a() {
    switch (!0) {
      case s:
        return { title: 'Staged and new files', subtitle: '(no commits yet)' }
      case n && r?.kind === 'branch':
        return { title: 'Branch changes', subtitle: `(vs ${r.baseBranch})` }
      default:
        return { title: 'Uncommitted changes', subtitle: '(git diff HEAD)' }
    }
  }
  return o ? tr(o) : a()
}
function mn(e, o) {
  let { data: r, words: s } = e
  if (!r)
    return {
      headline: 'Diff unavailable',
      hint:
        `Couldn't read the ${s.diffCommand} \u2014 it will retry on the ` +
        'next change',
    }
  if (o > 0) return null
  if (r.isUntrackedWithheld)
    return { headline: 'No tracked changes', hint: zo(e) }
  if (r.isUnborn)
    return {
      headline: 'No commits yet',
      hint: "Nothing to diff against until the repo's first commit",
    }
  switch (r.mode) {
    case 'uncommitted':
      return { headline: 'No uncommitted changes', hint: null }
    case 'branch':
      if (r.source.kind === 'branch')
        return { headline: `No changes vs ${r.source.baseBranch}`, hint: null }
      return {
        headline: `No changes vs ${r.source.base}`,
        hint:
          'No base branch to compare against \u2014 showing changes vs ' +
          r.source.base,
      }
    case 'session':
      return { headline: 'No changes this session', hint: null }
  }
}
function ln(e, o) {
  let { stats: r, files: s } = e,
    n = o.preSession,
    a = r.filesCount - n.length
  return {
    filesCount: a,
    linesAdded: r.linesAdded - n.reduce((i, f) => i + f.added, 0),
    linesRemoved: r.linesRemoved - n.reduce((i, f) => i + f.removed, 0),
    notShown: Math.max(0, a - (s.length - n.length)),
  }
}
var dn = Object.freeze({
  words: Pt,
  baseModes: _t,
  isLoading: !1,
  hasSettled: !1,
  isOutsideRepository: !1,
  data: null,
  requestedMode: 'session',
  selectedPath: null,
  isNoiseShown: !1,
  isPreSessionShown: !1,
  source: Object.freeze({ kind: 'current' }),
  turns: Object.freeze([]),
  bodies: ce,
  todos: Object.freeze({ done: 0, total: 0 }),
  armedPath: null,
  placement: 'dock',
  isFullscreen: null,
  dialogView: 'list',
  place: Object.freeze({ top: 0, listStart: 0, columns: 0, rows: 0 }),
})
function cn(e, o) {
  let { data: r } = o,
    s = r?.source,
    n = r !== null && o.requestedMode !== r.mode,
    a = e === o.requestedMode,
    i = a && n ? '\u2026' : '',
    f = s?.kind === 'working-tree' ? s.base : o.words.base,
    l = a && !n && r?.mode === 'branch'
  function x() {
    switch (e) {
      case 'session':
        return 'this session'
      case 'uncommitted':
        return `uncommitted (vs ${f})`
      case 'branch':
        if (s?.kind === 'branch') return `branch vs ${s.baseBranch}`
        return l ? `vs ${f} (no base branch)` : 'branch diff'
    }
  }
  return `${x()}${i}`
}
function or(e, o) {
  let r = [...e].sort((i, f) => Oe(i).localeCompare(Oe(f))),
    s = r.filter(i => i.isPreSession),
    n = r.filter(i => !i.isPreSession),
    a = n.filter(i => !Hs(i.path))
  return {
    shown: o === 'shown' ? n : a,
    preSession: s,
    noiseCount: n.length - a.length,
  }
}
var rr = e => ({
  filesCount: e.files.length,
  linesAdded: e.files.reduce((o, r) => o + r.added, 0),
  linesRemoved: e.files.reduce((o, r) => o + r.removed, 0),
  notShown: 0,
})
function un(e, o) {
  return e.data?.isUnborn === !0 && o > 0
    ? 'no commits yet \u2014 showing staged and new files'
    : null
}
var xn = Object.freeze({
  filesCount: 0,
  linesAdded: 0,
  linesRemoved: 0,
  notShown: 0,
})
function sr(e, o) {
  let r = Math.max(0, Math.min(e.place.listStart, o.rows.length - Fe)),
    s = o.rows.slice(r, r + Fe)
  return { shown: s, above: r, below: o.rows.length - r - s.length }
}
var nr = e => (e.kind === 'hunk' ? e.rows : 1)
var X = e => e.filter(o => o !== null)
var kt = 80000
var ir = 1500
var yn = Object.freeze({ chars: kt, nodes: ir })
function xe(e) {
  let o = G(e.lines, f => !f.startsWith('+')),
    r = G(e.lines, f => !f.startsWith('-')),
    s = o === 0,
    n = r === 0,
    a = s ? Math.max(0, e.oldStart - 1) : e.oldStart,
    i = n ? Math.max(0, e.newStart - 1) : e.newStart
  return `@@ -${a},${o} +${i},${r} @@`
}
var qe = e =>
  [xe(e), ...e.lines].join(`
`)
function Ze(e, o) {
  let r = 0,
    s = 0
  for (let n of e.lines) {
    let a = xe({ ...e, lines: e.lines.slice(0, s + 1) })
    if (
      (() => {
        r += 1 + n.length
        return a.length + r > o
      })()
    )
      break
    s += 1
  }
  return { ...e, lines: e.lines.slice(0, s) }
}
var Re = 1e4
function ar(e, o) {
  let [r = ''] = e.lines,
    s = r.slice(0, Math.max(1, o - 1 - xe({ ...e, lines: [r] }).length))
  return /[\uD800-\uDBFF]$/u.test(s) ? s.slice(0, -1) : s
}
function bt(e, o) {
  let r = [],
    s = e,
    n = !1
  while (s.lines.length > 0) {
    let a = Ze(s, o),
      i = a.lines.length === 0,
      f = i ? { ...s, lines: [ar(s, o)] } : a
    r.push(f)
    n ||= i
    s = Io(s, f.lines.length)
  }
  return { hunks: r, isTruncated: n }
}
var fr = 768
var pr = [
  [4352, 4447],
  [11904, 12350],
  [12353, 13311],
  [13312, 19903],
  [19968, 40959],
  [40960, 42191],
  [44032, 55203],
  [63744, 64255],
  [65072, 65103],
  [65280, 65376],
  [65504, 65510],
  [127744, 128591],
  [129280, 129535],
  [131072, 262141],
]
var mr = [
  [768, 879],
  [8203, 8207],
  [65024, 65039],
  [8400, 8447],
]
function J(e) {
  let o = 0
  for (let r of e) {
    let s = r.codePointAt(0) ?? 0,
      n = ([l, x]) => s >= l && s <= x,
      a = s < fr,
      i = !a && mr.some(n),
      f = !a && !i && pr.some(n)
    o += i ? 0 : f ? 2 : 1
  }
  return o
}
function ke(e) {
  let o = 0
  for (let r of e) o += Math.max(1, J(r))
  return o
}
var hn = (e, o) => `${e}${' '.repeat(Math.max(0, o - ke(e)))}`
var be = (e, o) => (e === 1 ? `1 ${o}` : `${e} ${o}s`)
var At = 4
var Qe = e =>
  e
    .replaceAll('\t', ' '.repeat(At))
    .replace(/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, '')
var L = e => Qe(e)
function Je(e, o) {
  if (ke(e) <= o) return e
  let r = [...e],
    s = ''
  for (let n = r.length - 1; n >= 0; n--) {
    let a = `${r[n]}${s}`
    if (ke(a) + 1 > o) break
    s = a
  }
  return `\u2026${s}`
}
function gn(e, o) {
  let r = Math.max(1, o),
    s = [''],
    n = e.split(' ')
  for (let [a, i] of n.entries()) {
    let f = J(i),
      l = J(s[s.length - 1] ?? '')
    if (a !== 0) {
      if (l >= r) {
        s.push('')
        l = 0
      }
      s[s.length - 1] += ' '
      l += 1
    }
    if (f > r) {
      let x = 1 + Math.floor((f - (r - l) - 1) / r)
      if (Math.floor((f - 1) / r) < x) s.push('')
      let d = [...i],
        O = J(s[s.length - 1] ?? '')
      for (let [_, P] of d.entries()) {
        let y = J(P)
        if (O + y <= r) s[s.length - 1] += P
        else {
          s.push(P)
          O = 0
        }
        if (
          (() => {
            O += y
            return O === r && _ < d.length - 1
          })()
        ) {
          s.push('')
          O = 0
        }
      }
      continue
    }
    if (l + f > r && l > 0 && f > 0) s.push('')
    s[s.length - 1] += i
  }
  return s
}
var Nt = e => e.slice(0, 1) + e.slice(1).split('\t').map(Qe).join('\t')
function lr(e, o) {
  let r = [],
    s = 0,
    n = !1,
    a = () => ({ chars: o.chars - s, nodes: o.nodes - r.length })
  for (let i of e) {
    let f = i.lines.filter(We).map(Nt),
      l = bt({ ...i, lines: f }, Re)
    n ||= l.isTruncated
    for (let x of l.hunks) {
      let d = o.chars - s,
        _ = qe(x).length <= d ? x : Ze(x, d)
      if (r.length + 1 > o.nodes || _.lines.length === 0)
        return { sources: r, isTruncated: !0, room: a() }
      let y = qe(_)
      if (
        (() => {
          ;(() => {
            r.push(y)
            return (s += y.length)
          })()
          return _.lines.length < x.lines.length
        })()
      )
        return { sources: r, isTruncated: !0, room: a() }
    }
  }
  return { sources: r, isTruncated: n, room: a() }
}
var dr = e => `ask:${L(e)}`
function V(e, o, r) {
  let { Text: s } = e.ui,
    n = o > 0 && r > 0
  return h(
    s,
    null,
    o > 0 ? h(s, { color: 'diffAddedWord' }, `+${o}`) : '',
    n ? ' ' : '',
    r > 0 ? h(s, { color: 'diffRemovedWord' }, `-${r}`) : '',
  )
}
function et(e, o, r) {
  let { Box: s, Button: n } = e.ui
  return h(
    s,
    { flexDirection: 'row' },
    h(
      n,
      {
        key: o.key,
        plain: !0,
        dimColor: o.isDim,
        ...(o.isAutoFocus ? { autoFocus: !0 } : {}),
        onPress: o.onPress,
      },
      o.label,
    ),
    h(s, { flexGrow: 1 }),
    r,
  )
}
var cr = '\u276F'
function Tn(e, o, r) {
  let { Text: s } = e.ui,
    n = Math.max(es, e.columns - Qr),
    a = o.isSelected ? cr : ' ',
    i = Je(L(o.displayPath), n),
    f = h(s, { dimColor: !0, italic: !0 }, o.note ?? ''),
    x = o.note !== null ? f : V(e, o.added, o.removed)
  return et(
    e,
    {
      key: o.key,
      label: `${a} ${i}`,
      onPress: r,
      isDim: !1,
      isAutoFocus: o.isSelected,
    },
    x,
  )
}
function Y(e, o) {
  let { Text: r } = e.ui
  return h(r, { dimColor: !0, wrap: 'truncate-end' }, o)
}
function ur(e) {
  let { Text: o } = e.ui
  return h(
    o,
    { dimColor: !0, wrap: 'truncate-end' },
    '\u2500'.repeat(Math.max(1, e.columns)),
  )
}
var Dt = e => `file:${L(e.path)}`
var xr = (e, o) => X([e > 0 ? `+${e}` : null, o > 0 ? `-${o}` : null]).join(' ')
function On(e, o, r) {
  let s = hn(
    Je(L(o.displayPath), Math.max(e.columns - Xt, zt)),
    e.columns - xr(o.added, o.removed).length,
  )
  return et(
    e,
    { key: o.key, label: s, onPress: r, isDim: !0, isAutoFocus: !1 },
    V(e, o.added, o.removed),
  )
}
var ie = e => X(e)
function yr(e, o, r) {
  let { Box: s, Text: n } = e.ui
  return h(
    s,
    { flexDirection: 'row', height: 1 },
    ie([
      o &&
        (i =>
          h(
            n,
            { wrap: 'truncate-end' },
            h(n, { bold: !0 }, be(i.filesCount, 'file')),
            ' changed ',
            V(e, i.linesAdded, i.linesRemoved),
          ))(o),
      h(s, { flexGrow: 1 }),
      r,
    ]),
  )
}
function Sn(e, o) {
  let { Box: r, Text: s } = e.ui
  return h(r, { flexDirection: 'row' }, [
    h(
      s,
      { dimColor: !0, wrap: 'truncate-end' },
      Je(L(o.displayPath), Math.max(e.columns - Xt, zt)),
    ),
    h(r, { flexGrow: 1 }),
    V(e, o.added, o.removed),
  ])
}
function hr(e, o, r) {
  let { Button: s } = e.ui,
    n = o === 'list-up'
  return h(
    s,
    {
      key: o,
      plain: !0,
      dimColor: !0,
      action: n ? 'app:diffFileListUp' : 'app:diffFileListDown',
      onPress: () => e.actions.scrollList(n ? -1 : 1),
    },
    r,
  )
}
function gr(e, o) {
  let { Box: r, Text: s, Button: n } = e.ui,
    a = [
      o.isUntracked ? 'untracked' : null,
      o.isTruncated ? 'truncated' : null,
    ].filter(l => l !== null),
    i = a.length === 0 ? '' : ` (${a.join(', ')})`,
    f = h(
      n,
      { key: dr(o.path), onPress: () => e.actions.toggleAsk(o.path) },
      o.isArmed ? 'asked \u2713' : 'ask',
    )
  return h(r, { flexDirection: 'row' }, [
    h(s, { bold: !0, wrap: 'truncate-start' }, Je(L(o.displayPath), e.columns)),
    h(s, { dimColor: !0 }, i),
    h(r, { flexGrow: 1 }),
    ...(o.isAskable ? [f] : []),
  ])
}
function Tr(e, o) {
  let { Select: r } = e.ui,
    { source: s, turns: n } = o
  return n.length > 0
    ? h(r, {
        key: 'source',
        label: 'source',
        options: [
          { value: 'current', label: 'Current' },
          ...n.map(i => ({ value: String(i.index), label: `T${i.index}` })),
        ],
        value: s.kind === 'current' ? 'current' : String(s.index),
        onSelect: i => e.actions.chooseSource(i),
      })
    : null
}
function En(e, o) {
  let { Text: r } = e.ui,
    s = o.subtitle !== ''
  return h(
    r,
    { wrap: 'truncate-end' },
    L(o.title),
    h(r, { dimColor: !0 }, s ? ` ${L(o.subtitle)}` : ''),
  )
}
function _n(e, o) {
  let { todos: r } = o
  if (r.total === 0) return null
  let { Box: s, Text: n } = e.ui,
    a = Math.max(1, Math.min(ls, e.columns - ds)),
    i = Math.round((r.done / r.total) * a)
  return h(
    s,
    { flexDirection: 'row', gap: 1, marginTop: 1 },
    h(
      n,
      null,
      h(n, { color: 'success' }, '\u2588'.repeat(i)),
      h(n, { color: 'inactive' }, '\u2591'.repeat(Math.max(0, a - i))),
    ),
    h(n, { dimColor: !0 }, `${r.done}/${r.total}`),
  )
}
function Mt(e, o, r) {
  let { Box: s, Button: n } = e.ui
  return h(
    s,
    { flexDirection: 'row' },
    h(n, { key: o, plain: !0, dimColor: !0, onPress: r.onPress }, r.label),
  )
}
var Or = 16
var Sr = /^[\p{L}\p{N}._/@+-]+$/u
function Lt(e) {
  if (e.isUntracked) return e.words.untrackedNoteOf(e.path, Sr.test(e.path))
  if (e.isBinary) return ['Binary file - cannot display diff']
  if (e.body === void 0) return ['Loading diff\u2026']
  if (e.body === null) return ['Diff unavailable']
  let { isLarge: o, hunks: r } = e.body,
    s = r.length === 0,
    n = o
      ? 'Large file - diff exceeds 1 MB limit'
      : s
        ? 'No diff content'
        : null
  return n ? [n] : null
}
function Pn(e, o, r) {
  let { Box: s, Text: n, Code: a } = e.ui,
    i = Lt(o),
    f = lr(i ? [] : (o.body?.hunks ?? []), {
      chars: r.chars - L(o.displayPath).length,
      nodes: r.nodes - Or,
    }),
    l = o.body?.isTruncated === !0 || f.isTruncated,
    x = L(o.path).slice(-Re),
    d = l
      ? [
          h(
            n,
            { dimColor: !0, italic: !0 },
            '\u2026 diff truncated (exceeded 400 line limit)',
          ),
        ]
      : [],
    O = (i ?? []).map(y => h(n, { dimColor: !0, italic: !0, wrap: 'wrap' }, y)),
    _ = f.sources.map(y => h(a, { source: y, format: 'diff', path: x }))
  return {
    element: h(s, { flexDirection: 'column' }, [
      gr(e, { ...o, isTruncated: l, isAskable: i === null }),
      ur(e),
      ...(i ? O : _),
      ...d,
    ]),
    room: f.room,
  }
}
var Er = (e, o) => ({
  path: e.path,
  displayPath: Oe(e),
  added: e.added,
  removed: e.removed,
  isUntracked: e.isUntracked,
  isBinary: e.isBinary,
  body: o.bodies.get(e.path),
})
var _r = (e, o) => ({
  words: o.words,
  path: e.path,
  displayPath: e.displayPath,
  isUntracked: e.isUntracked,
  isBinary: e.isBinary,
  body: e.body,
  isArmed: o.armedPath === e.path,
})
var Pr = e => ({
  path: e.path,
  displayPath: e.path,
  added: e.added,
  removed: e.removed,
  isUntracked: !1,
  isBinary: !1,
  body: { hunks: e.hunks, isTruncated: e.isTruncated, isLarge: !1 },
})
function wn(e, o) {
  let { earlier: r } = o,
    { columns: s } = e.place,
    n = o.message.length > 0,
    a = e.isPreSessionShown && r.length > 0,
    i = r.length > ht,
    f = S =>
      String(
        Math.max(
          1,
          S.oldStart + G(S.lines, A => !A.startsWith('+')) - 1,
          S.newStart + G(S.lines, A => !A.startsWith('-')) - 1,
        ),
      ).length + rs
  function l(S, A) {
    let b = Math.max(1, s - f(A)),
      B = A.lines.map(N =>
        Math.max(
          1,
          Math.ceil(J(Qe(N.slice(1).replaceAll('\t', ' '.repeat(At)))) / b),
        ),
      )
    return {
      kind: 'hunk',
      path: S.path,
      hunk: A,
      lineRows: B,
      rows: B.reduce((N, F) => N + F, 0),
    }
  }
  let x = S => bt({ ...S, lines: S.lines.filter(We).map(Nt) }, Re)
  function d(S) {
    let A = _r(S, e),
      b = Lt(A),
      B = (S.body?.hunks ?? []).map(x),
      N = S.body?.isTruncated === !0 || B.some(c => c.isTruncated),
      F = b
        ? b.map(c => ({ kind: 'note', text: c }))
        : B.flatMap(c => c.hunks).map(c => l(S, c))
    return [
      { kind: 'rule', path: S.path },
      { kind: 'name', name: { ...A, isTruncated: N, isAskable: b === null } },
      { kind: 'rule', path: null },
      ...F,
      ...(N ? [{ kind: 'footer' }] : []),
    ]
  }
  let O = S => [...d(S), { kind: 'blank' }],
    _ = () => [
      { kind: 'blank' },
      ...o.message.map(S => ({ kind: 'text', text: L(S) })),
      { kind: 'blank' },
    ],
    P = { kind: 'text', text: `diffs hidden above ${ht} files` },
    y = () => (i ? [P] : r.flatMap(d)),
    E = () => [
      { kind: 'blank' },
      ...r.map(S => ({ kind: 'legend', entry: S })),
      ...y(),
    ]
  return [
    ...(n ? _() : o.rows.flatMap(O)),
    ...X([o.earlierLabel]).map(S => ({ kind: 'toggle', label: S })),
    ...(a ? E() : []),
  ]
}
function ot(e, o) {
  let r = wn(e, o),
    s = sr(e, o),
    n = !o.turn && o.partition.noiseCount > 0,
    a = o.message.length === 0,
    i = a && (o.rows.length > 0 || n),
    f = i
      ? s.shown.length +
        Number(s.above > 0) +
        Number(s.below > 0 || o.totals.notShown > 0) +
        Number(o.isUntrackedNoted) +
        Number(n) +
        2
      : Number(a),
    l = 1 + Number(o.line !== null) + (e.todos.total > 0 ? 2 : 0),
    x = new Map(),
    d = Math.max(0, e.place.rows - ve - l - f),
    O = 0
  for (let P of r) {
    if (P.kind === 'rule' && P.path !== null) x.set(P.path, O)
    O += nr(P)
  }
  let _ = ve + l + 1
  return {
    segments: r,
    extent: O,
    visibleRows: d,
    maxTop: Math.max(0, O - d),
    tops: x,
    listTop: _,
    listEnd: i ? _ + f - 2 : _,
  }
}
function ae(e) {
  let o = Q(e)
  return o
    ? o.files.map(Pr)
    : [...(e.data?.files ?? [])]
        .sort((r, s) => Oe(r).localeCompare(Oe(s)))
        .map(r => Er(r, e))
}
var te = (e, o) =>
  Math.max(
    0,
    Math.min(
      o.length - q,
      Math.max(0, o.indexOf(e.selectedPath ?? '')) - Math.floor(q / 2),
    ),
  )
function kn(e, o) {
  let r = ae(e),
    s = r.map(S => S.path),
    n = r.map(S => Dt(S)),
    a = n.indexOf(o ?? ''),
    i = Math.max(0, s.indexOf(e.selectedPath ?? '')),
    f = te(e, s),
    l = Math.min(s.length, f + q) - 1,
    x = s[a] ?? null,
    d = n[f + a - te({ selectedPath: x }, s)],
    O = i === 0 && a === l,
    _ = i === s.length - 1 && a === f
  return l - f >= 2 && (_ || O)
    ? 'stay'
    : x !== null && d !== void 0
      ? { selectedPath: x, landing: d }
      : null
}
function rt(e, o) {
  let { Box: r } = e.ui,
    s = o.data === null && !o.hasSettled,
    n = h(r, null, Y(e, $o)),
    i = s
      ? (() =>
          wr(e, {
            top: [yr(e, null, null)],
            message: ['Loading diff\u2026'],
            controls: null,
            earlier: null,
            rest: [],
          }))()
      : null
  return o.isOutsideRepository ? n : i
}
function Rr(e, o) {
  let { Box: r, Text: s } = e.ui,
    n = rt(e, o)
  if (n) return n
  let a = Q(o),
    { data: i } = o,
    f = ae(o),
    l = a ? rr(a) : (i?.stats ?? null),
    x = o.source.kind === 'turn',
    d = f.length > q,
    O = f.find(w => w.path === o.selectedPath),
    _ = O ?? f[0],
    P = o.dialogView === 'detail' && O !== void 0,
    y = te(
      o,
      f.map(w => w.path),
    ),
    E = f.slice(y, y + q),
    S = Y(e, ' '),
    A = f.length - y - E.length,
    b = !x && i !== null && i.stats.filesCount > 0 && f.length === 0,
    B = x
      ? 'No file changes in this turn'
      : b
        ? 'Too many files to display details'
        : 'No changes yet',
    N = f.length > 0 ? null : B,
    F =
      l &&
      h(
        s,
        { dimColor: !0, wrap: 'truncate-end' },
        `${be(l.filesCount, 'file')} changed `,
        V(e, l.linesAdded, l.linesRemoved),
      ),
    c = w => (w.isUntracked ? 'untracked' : w.isBinary ? 'Binary file' : null),
    j = w =>
      Tn(
        e,
        {
          key: Dt(w),
          path: w.path,
          displayPath: w.displayPath,
          added: w.added,
          removed: w.removed,
          note: c(w),
          isSelected: w === _,
        },
        () => e.actions.selectFile(w.path),
      )
  function pt(w, K) {
    let dt = w === 'up' ? '\u2191' : '\u2193',
      Gt = be(K, 'file').replace(' ', ' more ')
    return Y(e, ` ${dt} ${Gt}`)
  }
  let re = (w, K) => (K > 0 ? pt(w, K) : S),
    mt = (w, K) => (d ? re(w, K) : null),
    ge = w => [Pn(e, _r(w, o), yn).element],
    Ht = ie([mt('up', y), ...E.map(j), mt('down', A)]),
    Ut = P && O ? ge(O) : Ht,
    Me = N === null ? Ut : [Y(e, N)],
    lt = P
      ? '\u2191/\u2193 to scroll \xB7 Esc to back'
      : '\u2191/\u2193 to select \xB7 Enter to view \xB7 Esc to close'
  return h(
    r,
    { flexDirection: 'column' },
    ie([
      En(e, pn(o)),
      h(r, { height: 1 }),
      F,
      Tr(e, o),
      h(r, { flexDirection: 'column', marginTop: 1, marginBottom: 1 }, Me),
      Y(e, lt),
    ]),
  )
}
function st(e) {
  let o = ae(e),
    r = Q(e) !== void 0 || e.data !== null,
    s = o.length > q,
    n = o.find(_ => _.path === e.selectedPath),
    a = e.dialogView === 'detail' && n !== void 0,
    i = te(
      e,
      o.map(_ => _.path),
    ),
    f = (n?.body?.hunks ?? []).reduce((_, P) => _ + 1 + P.lines.length, 0),
    l = Math.min(o.length - i, q),
    d = o.length === 0 ? 1 : l + (s ? 2 : 0),
    O = a ? 2 + Math.max(1, f) : d
  return 2 + Number(r) + Number(e.turns.length > 0) + 2 + O + 1
}
function bn(e) {
  let { data: o, partition: r, totals: s, empty: n } = e,
    a = n?.hint ?? null
  if (n) return a === null ? [] : [a]
  if (o !== null && o.files.length === 0 && s.filesCount > 0)
    return [
      'Too many changed files to show diff',
      'Per-file diff is skipped above 500 files',
    ]
  return r.shown.length === 0 && r.noiseCount > 0
    ? [
        'Only tests and generated files changed',
        'Tests and generated files are hidden \xB7 click "show" above to view ' +
          'them',
      ]
    : r.shown
}
var kr = 3
function wr(e, o) {
  let { Box: r, Text: s } = e.ui,
    { top: n, controls: a, earlier: i, rest: f } = o,
    l = o.message.flatMap(N => gn(L(N), e.columns)),
    x = l.map(N => h(s, { dimColor: !0 }, N)),
    d = a === null ? [] : [a],
    O = i === null ? [] : [i],
    P = d.length > 0 || O.length === 0 ? d : [h(r, { height: 1 })],
    y = i === null ? 0 : kr,
    E = e.rows - n.length - 1 - y,
    S = Math.floor((E - l.length) / 2)
  if (!(f.length === 0 && E - S - l.length >= d.length))
    return h(r, { flexDirection: 'column' }, [
      ...n,
      h(r, { height: 1 }),
      ...x,
      ...P,
      ...O,
      ...f,
    ])
  let b = S > 0 ? [h(r, { height: S })] : [],
    B = O.map(N =>
      h(r, { flexDirection: 'column', marginTop: 1, paddingBottom: 1 }, N),
    )
  return h(r, { flexDirection: 'column', height: e.rows }, [
    ...n,
    h(r, { height: 1 }),
    h(r, { flexDirection: 'column', height: E, alignItems: 'center' }, [
      ...b,
      ...x,
      ...d,
    ]),
    ...B,
  ])
}
function Ae(e) {
  let { data: o, requestedMode: r } = e,
    s = Q(e),
    n = e.isNoiseShown ? 'shown' : 'hidden',
    a = or(o?.files ?? [], n),
    i = e.isPreSessionShown ? 'hide' : 'show',
    f = s ? rr(s) : o ? ln(o, a) : xn,
    l = s ? null : mn(e, f.filesCount),
    x = s ? [] : bn({ data: o, partition: a, totals: f, empty: l }),
    d = x.flatMap(b => (typeof b === 'string' ? [b] : [])),
    O = s ? s.files.length > 0 : d.length < x.length,
    _ = b => Er(b, e),
    P = s ? s.files.map(Pr) : O ? a.shown.map(_) : [],
    y = s ? [] : a.preSession.map(_),
    E = y.length > 0,
    S = o !== null && !o.isUnborn && (r !== 'session' || o.mode !== 'session'),
    A = s
      ? `Turn ${s.index} "${s.preview}"`
      : S
        ? cn(r, e)
        : un(e, f.filesCount)
  return {
    turn: s,
    partition: a,
    totals: f,
    empty: l,
    line: A === null ? null : L(A),
    rows: P,
    earlier: y,
    earlierLabel: E
      ? `+${be(y.length, 'file')} edited before this session (${i})`
      : null,
    notes: d,
    message: l ? [l.headline, ...d] : O ? [] : d,
    isUntrackedNoted: !s && o?.isUntrackedWithheld === !0 && l === null,
  }
}
function An(e, o) {
  let r = 0,
    s = 0,
    n = 0,
    a = 0
  for (let f of e.lineRows) {
    if (r + f <= o.skip) s += 1
    else if (n < o.take) {
      n += f
      a += 1
    }
    r += f
  }
  let i = Io(e.hunk, s)
  return { ...i, lines: i.lines.slice(0, a) }
}
function Nn(e, o) {
  let { visibleRows: r, maxTop: s } = ot(e, Ae(e)),
    n = Math.abs(o.by),
    a = n >= o.contentRows && o.contentRows > o.bodyRows,
    i = !a && n >= o.bodyRows,
    f = a ? s : i ? Math.max(1, r) : n * ns
  return {
    ...e.place,
    top: Math.max(0, Math.min(s, e.place.top + Math.sign(o.by) * f)),
  }
}
function Dn(e, o, r) {
  let { Box: s, Text: n, Code: a } = e.ui,
    i = [],
    f = o.visibleRows + ss,
    l = Math.max(0, Math.min(r, o.maxTop)),
    x = e.actions.togglePreSession,
    d = 0,
    O = 0,
    _ = 0
  function P(E, S) {
    let A = qe(An(E, S)),
      b = L(E.path)
    _ += A.length
    return _ > kt
      ? h(n, { dimColor: !0, italic: !0 }, '\u2026')
      : h(a, { source: A, format: 'diff', path: b })
  }
  function y(E, S) {
    switch (E.kind) {
      case 'rule':
        return ur(e)
      case 'blank':
        return h(s, { height: 1 })
      case 'name':
        return gr(e, E.name)
      case 'hunk':
        return P(E, S)
      case 'note':
        return h(n, { dimColor: !0, italic: !0, wrap: 'wrap' }, E.text)
      case 'footer':
        return h(
          n,
          { dimColor: !0, italic: !0 },
          '\u2026 diff truncated (exceeded 400 line limit)',
        )
      case 'text':
        return Y(e, E.text)
      case 'toggle':
        return Mt(e, 'presession', { ...E, onPress: x })
      case 'legend':
        return Sn(e, E.entry)
    }
  }
  for (let E of o.segments) {
    let S = nr(E)
    if (d + S > l && O < f) {
      let b = Math.max(0, l - d)
      i.push(y(E, { skip: b, take: f - O }))
      O += S - b
    }
    d += S
  }
  return i
}
function Mn(e, o) {
  let r = Ae(e),
    { listTop: s, listEnd: n } = ot(e, r),
    a = o.pointer?.row ?? -1
  return a >= s && a < n && r.rows.length > Fe
}
function Ln(e, o, r) {
  let { shown: s, above: n, below: a } = sr(o, r),
    { noiseCount: i } = r.partition,
    { notShown: f } = r.totals,
    l = !r.turn && i > 0,
    x = n > 0,
    d = a > 0,
    O = f > 0,
    _ = o.isNoiseShown ? 'hide' : 'show',
    P = X([d ? `${a} ${zs}` : null, O ? `${f} not shown` : null]).join(
      ' \xB7 ',
    ),
    y = b =>
      On(
        e,
        {
          key: Dt(b),
          path: b.path,
          displayPath: b.displayPath,
          added: b.added,
          removed: b.removed,
          note: null,
          isSelected: !1,
        },
        () => e.actions.selectFile(b.path),
      ),
    E = x ? hr(e, 'list-up', `\u2191 ${n} more above`) : null,
    S = d ? hr(e, 'list-down', `\u2193 ${P}`) : O ? Y(e, `\u2026 ${P}`) : null,
    A = l
      ? Mt(e, 'noise', {
          label: `${be(i, 'test')}/generated (${_})`,
          onPress: e.actions.toggleNoise,
        })
      : null
  return ie([E, ...s.map(y), S, r.isUntrackedNoted ? Y(e, zo(o)) : null, A])
}
function br(e, o) {
  let r = Math.max(0, Ae(e).rows.length - Fe)
  return {
    ...e.place,
    listStart: Math.max(0, Math.min(r, Math.min(e.place.listStart, r) + o)),
  }
}
var In = (e, o) => ({
  ...e.place,
  top: ot(e, Ae(e)).tops.get(o) ?? e.place.top,
})
var Ar = e => ({
  ...e,
  columns: Math.max(1, e.columns - ut),
  rows: Math.max(0, e.rows - ve),
})
function Nr(e, o) {
  let { Box: r, Button: s } = e.ui,
    n = rt(e, o)
  if (n) return n
  let a = Ae(o),
    i = a.message.length === 0,
    f = !i && !(o.isPreSessionShown && a.earlier.length > 0),
    l = Ln(e, o, a),
    x = e.actions.togglePreSession,
    d = l.length > 0,
    O = ie([
      yr(
        e,
        a.empty ? null : a.totals,
        h(
          r,
          { flexDirection: 'row' },
          ie([
            Tr(e, o),
            h(
              s,
              {
                key: 'base',
                plain: !0,
                action: 'app:cycleDiffBase',
                onPress: e.actions.cycleBase,
              },
              '',
            ),
          ]),
        ),
      ),
      a.line === null ? null : Y(e, a.line),
      _n(e, o),
    ])
  if (f)
    return wr(e, {
      top: [...O, ...l],
      message: a.message,
      controls: null,
      earlier:
        X([a.earlierLabel]).map(P =>
          Mt(e, 'presession', { label: P, onPress: x }),
        )[0] ?? null,
      rest: [],
    })
  let _ = () =>
    d
      ? h(r, { flexDirection: 'column', marginTop: 1, marginBottom: 1 }, l)
      : h(r, { height: 1 })
  return h(r, { flexDirection: 'column' }, [
    ...O,
    ...(i ? [_()] : []),
    ...Dn(e, ot(o, a), o.place.top),
  ])
}
function Bn(e, o, r) {
  let { Box: s } = e.ui,
    n = r.placement === 'dock',
    a =
      o.isFullscreen !== !1 &&
      r.terminalColumns !== null &&
      r.terminalColumns < Be
  return n
    ? h(
        s,
        { flexDirection: 'column', paddingTop: ve, paddingRight: ut },
        Nr(Ar(e), o),
      )
    : a
      ? h(s, null, Y(e, wt))
      : Rr(e, o)
}
function Mr(e) {
  let o = e.data?.files ?? []
  if (e.placement === 'inline') {
    let n = Q(e) !== void 0,
      a = ae(e).map(l => l.path),
      i = te(e, a),
      f = a.slice(i, i + q)
    return o.filter(l => !n && f.includes(l.path))
  }
  let r = or(o, e.isNoiseShown ? 'shown' : 'hidden'),
    s = e.isPreSessionShown && r.preSession.length <= ht
  return [...r.shown, ...(s ? r.preSession : [])]
}
var Lr = e => o =>
  e.listDir(o).then(
    r => new Map(r.map(s => [s.name, s.kind])),
    () => null,
  )
var Ir = (e, o) =>
  e.fileCheckpointingEnabled !== !1 &&
  !['1', 'true', 'yes', 'on'].includes((o ?? '').trim().toLowerCase())
var Bt = e => e.surface !== 'mobile'
var Ft = e => (e instanceof Error ? e.message : String(e))
var Cr = e => o =>
  e.stat(o).then(
    r => r.mtimeMs,
    () => null,
  )
function Fn(e) {
  let o = e.columns !== null && e.columns < Be
  return e.isOpen ? 'close' : o ? 'too-narrow' : 'open'
}
var Hn = ['merge-base', 'head-is-base', 'none']
var oe = {
  read: 'repl_diff_read',
  tabSwitch: 'repl_tab_switch',
  baseSwitch: 'repl_diff_base_switch',
  baseResolve: 'diff_base_resolve',
  selectionAttach: 'diff_selection_attach',
}
function nt(e) {
  try {
    e().catch(() => {
      return
    })
  } catch {}
}
var Br = ['auto_open', 'manual']
var it = ['under_110', '110_to_143', '144_to_199', '200_plus']
var he = e => ({
  mark: (o, r) => nt(() => e.mark({ feature: o, ...r })),
  shown: (o, r) =>
    nt(() =>
      e.log({
        event: 'tengu_repl_diff_panel_shown',
        props: {
          trigger: { value: o, of: Br },
          terminal_width_bucket: { value: r, of: it },
        },
      }),
    ),
  asked: () => nt(() => e.mark({ feature: oe.selectionAttach, kind: 'ok' })),
})
var Un = ['diff', 'convo']
function Gn(e) {
  let [o, r, s, n] = it,
    a = e ?? 0,
    i = a < Be,
    f = a < $t,
    l = a < Jr
  return i ? o : f ? r : l ? s : n
}
function ym(e) {
  let o = null,
    r = null,
    s = null,
    n = 0,
    a = !1,
    i = null,
    f = !1,
    l = !1,
    x = null,
    d = null,
    O = null,
    _ = null,
    P = !1,
    y = !1,
    E = 0,
    S = 0,
    A = null,
    b = null,
    B = new Set(),
    N = { toplevel: '', headKey: '' },
    F = { cwd: '', isEmpty: !1, epoch: 0 },
    c = dn,
    j = new Map(),
    pt = new Set(),
    re = p => o ?? p,
    mt = p => ({
      run: (m, g) => re(p).run(m, F.cwd === '' ? g : { cwd: F.cwd, ...g }),
      readFile: m => re(p).readFile(m),
      mtimeOf: m => Cr(re(p))(m),
      entryKindsOf: m => Lr(re(p))(m),
      nowMs: () => re(p).now(),
      sessionStartMsOf: () => n,
      onBranchBase: m => {
        let u =
          m.kind === 'error'
            ? { kind: 'sad', reason: m.reason }
            : { kind: 'ok', props: { outcome: { value: m.kind, of: Hn } } }
        if (!pt.has(u.kind)) {
          pt.add(u.kind)
          he(re(p)).mark(oe.baseResolve, u)
        }
      },
    })
  function ge(p) {
    if (r || F.isEmpty) return Promise.resolve(!0)
    s ??= Ht(p).finally(() => {
      s = null
    })
    return s
  }
  async function Ht(p) {
    let m = { isAnswered: !0 },
      g = mt(p),
      { epoch: u } = F,
      T = await Bs(
        {
          ...g,
          run: (H, jt) =>
            g.run(H, jt).catch(Zr => {
              m.isAnswered &&= H[0] !== 'git' || !/\baborted\b/.test(Ft(Zr))
              throw Zr
            }),
        },
        Fs,
      )
    if (u !== F.epoch) return !1
    if (
      (() => {
        ;(() => {
          r ??= T
          return (F.isEmpty = r === null && m.isAnswered)
        })()
        return !T || r !== T
      })()
    )
      return m.isAnswered || r !== null
    zn(p, T)
    let D = fn(
        await p.storeGet(Ko(T.repository.toplevel)).catch(() => {
          return
        }),
      ),
      M = D && T.baseModes.includes(D) ? D : null
    c = {
      ...c,
      words: T.words,
      baseModes: T.baseModes,
      ...(M && { requestedMode: M }),
    }
    return !0
  }
  function Ut() {
    r = null
    F.isEmpty = !1
    F.epoch += 1
    N.toplevel = ''
    N.headKey = ''
    j.get('poll')?.cancel()
    j.delete('poll')
  }
  function Me() {
    return { id: Z, title: jo, holdToasts: !0, closeOnEscape: !0, rows: st(c) }
  }
  function lt(p) {
    let m = st(c)
    if (a && c.isFullscreen === !1 && m !== i) {
      i = m
      p.openPane(Me()).catch(() => {
        return
      })
    }
  }
  function w(p) {
    if (
      (() => {
        lt(p)
        return j.has('redraw')
      })()
    )
      return
    j.set(
      'redraw',
      p.after(ps, () => {
        j.delete('redraw')
        p.invalidate()
      }),
    )
  }
  async function K(p) {
    let { data: m } = c,
      g = r
    if (!m || !g) {
      A = null
      b = null
      B.clear()
      c = { ...c, bodies: ce }
      return !1
    }
    let u = dt(m),
      T = m.baseRef !== b
    if (u !== A) {
      A = u
      B.clear()
    }
    if (T) {
      b = m.baseRef
      c = { ...c, bodies: ce }
      w(p)
    }
    return Gt(p, g, m)
  }
  let dt = p => `${E}|${p.baseRef}`
  async function Gt(p, m, g) {
    let u = dt(g),
      T = Mr(c).filter(H => !B.has(H.path))
    for (let H of T) B.add(H.path)
    let D = await m.fetchHunks(g, T)
    if (A === u && D.size > 0) {
      c = { ...c, bodies: new Map([...c.bodies, ...D]) }
      w(p)
    }
    return [...D.values()].includes(null)
  }
  function jr() {
    let p = r
    if (!p || N.headKey !== '') return
    p.headKeyOf()
      .catch(() => '')
      .then(m => {
        if (r === p && N.headKey === '') N.headKey = m
      })
  }
  function zn(p, m) {
    let g = () => m.headKeyOf().catch(() => '')
    if (N.toplevel === m.repository.toplevel) return
    j.get('poll')?.cancel()
    N.toplevel = m.repository.toplevel
    N.headKey = ''
    j.set(
      'poll',
      p.every(fs, () => {
        if (!a) return
        g().then(u => {
          let T = N.headKey !== '' && u !== N.headKey
          if (
            (() => {
              N.headKey = u
              return T
            })()
          )
            Wt(p)
        })
      }),
    )
  }
  async function Le(p) {
    if (P) {
      y = !0
      return
    }
    P = !0
    let m = he(p),
      g = r,
      u = () =>
        g
          ? g.fetchDiff(c.requestedMode)
          : Promise.resolve({ kind: 'no-repository' })
    try {
      c = { ...c, isLoading: c.data === null }
      let [T, D] = await Promise.all([u(), p.messages().catch(() => [])])
      switch (
        (() => {
          c = nn(c, { outcome: T, messages: D })
          return T.kind
        })()
      ) {
        case 'no-repository':
          break
        case 'unavailable':
          m.mark(oe.read, { kind: 'sad', reason: 'git_diff_failed' })
          break
        case 'data':
          E += 1
          break
      }
      let M = await K(p)
      if (T.kind === 'data')
        m.mark(
          oe.read,
          M ? { kind: 'sad', reason: 'git_hunks_failed' } : { kind: 'ok' },
        )
    } catch (T) {
      m.mark(oe.read, { kind: 'sad', reason: 'git_diff_threw' })
      throw T
    } finally {
      if (
        (() => {
          ;(() => {
            P = !1
            return w(p)
          })()
          return y
        })()
      ) {
        y = !1
        Wt(p)
      }
    }
  }
  function Wt(p) {
    j.get('refresh')?.cancel()
    j.set(
      'refresh',
      p.after(ms, () => {
        j.delete('refresh')
        Le(p)
      }),
    )
  }
  async function $r(p, m) {
    let g = await p.sessionId().catch(() => null)
    if (g !== null && g !== d) {
      d = g
      he(p).shown(m, Gn(x))
    }
  }
  async function zr(p, m) {
    let g = c.isFullscreen === !1
    c = {
      ...c,
      selectedPath: null,
      dialogView: 'list',
      place: { ...c.place, top: 0, listStart: 0 },
    }
    i = g ? st(c) : null
    let u = S
    if (!g)
      await Le(p).catch(() => {
        return
      })
    let T = await p.openPane(
      g ? { ...Me(), focus: !0 } : { id: Z, title: jo, holdToasts: !0 },
    )
    if (z(T) && T.isPlaced === !1) {
      await p.closePane({ id: Z }).catch(() => {
        return
      })
      return !1
    }
    ;(() => {
      a = !0
      return jr()
    })()
    await $r(p, m)
    if (g || S !== u) Le(p)
    return !0
  }
  async function Xr(p) {
    await p.closePane({ id: Z })
    a = !1
  }
  function Yr(p, m) {
    he(p).mark(oe.tabSwitch, {
      kind: 'ok',
      props: { tab: { value: m, of: Un } },
    })
  }
  async function Kt(p) {
    let m = () => a || f
    if (m()) return
    let g = await p.storeGet(we),
      T = g === !0 ? Be : $t
    if (!(g !== !1 && c.isFullscreen === !0 && x !== null && x >= T) || m())
      return
    if (!(await p.isCheckpointing().catch(() => !0)) || m()) return
    await ge(p)
    if (!r || m()) return
    f = !0
    f = await zr(p, 'auto_open')
  }
  async function Vr(p) {
    l = Qo(await p.messages().catch(() => [])).length > 0
    if (l) await Kt(p)
  }
  function ct(p) {
    O = null
    c = { ...c, armedPath: null }
    p.status(void 0)
  }
  let Xn = p => ({
    selectFile: m => {
      let g = c.placement === 'dock'
      c = {
        ...c,
        selectedPath: m,
        dialogView: g ? c.dialogView : 'detail',
        place: g ? In(c, m) : c.place,
      }
      K(p).catch(() => {
        return
      })
      w(p)
    },
    scrollList: m => {
      c = { ...c, place: br(c, m) }
      w(p)
    },
    toggleNoise: () => {
      c = { ...c, isNoiseShown: !c.isNoiseShown }
      K(p)
      w(p)
    },
    togglePreSession: () => {
      c = { ...c, isPreSessionShown: !c.isPreSessionShown }
      K(p)
      w(p)
    },
    cycleBase: () => {
      let { baseModes: m, requestedMode: g } = c,
        u = m[(m.indexOf(g) + 1) % m.length] ?? g
      if (u === g) return
      c = { ...c, requestedMode: u }
      he(p).mark(oe.baseSwitch, {
        kind: 'ok',
        props: { mode: { value: u, of: c.baseModes } },
      })
      let T = c.data?.repository.toplevel
      if (T !== void 0)
        p.storeSet(Ko(T), u).catch(() => {
          return
        })
      Le(p)
      w(p)
    },
    chooseSource: m => {
      let g = Number(m),
        T =
          m !== 'current' && Number.isInteger(g)
            ? { kind: 'turn', index: g }
            : { kind: 'current' }
      c = { ...c, source: T, selectedPath: null, dialogView: 'list' }
      w(p)
    },
    toggleAsk: m => {
      if (O?.path === m) {
        ct(p)
        w(p)
        return
      }
      Yn(p, m)
    },
  })
  function Yn(p, m) {
    O = cs(
      m,
      Q(c)?.files.find(g => g.path === m)?.hunks ??
        c.bodies.get(m)?.hunks ??
        [],
    )
    c = { ...c, armedPath: m }
    p.status(
      `${L(m)} rides your next prompt (press ` + 'asked \u2713 to drop it)',
    )
    w(p)
  }
  async function qr(p) {
    let m = await p.startedAt().catch(() => {
      return
    })
    return typeof m === 'number' ? m : null
  }
  async function Vn(p, m) {
    n = (await qr(p)) ?? (await p.now())
    F.cwd = m
    try {
      await p.registerCommand(Xo)
      o = p
    } catch (g) {
      let u = Ft(g)
      if (!js.test(u)) p.uiLog(qs(L(u)))
    }
  }
  e('session.start', async (p, m, g) => {
    await Vn(
      {
        now: () => p.clock.now(),
        after: (u, T) => p.clock.after(u, T),
        every: (u, T) => p.clock.every(u, T),
        run: (u, T) => p.process.run(u, T),
        stat: u => p.fs.stat(u),
        listDir: u => p.fs.list(u),
        readFile: u => p.fs.read(u),
        storeGet: u => p.store.get(u),
        storeSet: (u, T) => p.store.set(u, T),
        isCheckpointing: async () =>
          Ir(
            await p.settings.read(),
            await p.env.get('CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING'),
          ),
        messages: () => p.session.messages(),
        invalidate: () => p.ui.invalidate('ui.render'),
        status: u => p.ui.status(u),
        uiLog: u => p.ui.log(u),
        openPane: u => p.ui.open(u),
        closePane: u => p.ui.close(u),
        registerCommand: u => p.command.register(u),
        sessionId: () => p.session.id(),
        startedAt: () =>
          p.session.usage().then(u => (z(u) ? u.startedAt : void 0)),
        mark: u => p.telemetry.mark(u),
        log: u => p.telemetry.log(u),
      },
      m.cwd,
    )
    if (o)
      Vr(o).catch(() => {
        return
      })
    return g(m)
  })
  e('ui.render', { component: 'PromptHint' }, (p, m, g) => {
    if (Bt(m)) {
      let { viewport: u } = m,
        T = x === null && u?.columns !== void 0
      if (
        (() => {
          ;(() => {
            x = u?.columns ?? x
            return (c = {
              ...c,
              isFullscreen: u?.isFullscreen ?? c.isFullscreen,
            })
          })()
          return T && l && o
        })()
      )
        Kt(o).catch(() => {
          return
        })
    }
    return g(m)
  })
  e('ui.render', { component: 'Pane' }, async (p, m, g) => {
    if (m.requestId !== Z || !o || !Bt(m)) return g(m)
    let {
      Box: u,
      Text: T,
      Button: D,
      Select: M,
      Code: H,
    } = await p.ui.resolve(m)
    x = m.viewport?.columns ?? x
    let jt = m.props.placement !== c.placement
    if (
      (() => {
        c = {
          ...c,
          placement: m.props.placement,
          place: {
            ...c.place,
            columns: Math.max(1, m.props.bodyColumns - ut),
            rows: m.props.scroll.bodyRows,
          },
        }
        return jt
      })()
    )
      K(o).catch(() => {
        return
      })
    return Bn(
      {
        ui: { Box: u, Text: T, Button: D, Select: M, Code: H },
        actions: Xn(o),
        columns: m.props.bodyColumns,
        rows: m.props.scroll.bodyRows,
      },
      c,
      { placement: m.props.placement, terminalColumns: x },
    )
  })
  e('command.run', { command: 'diff' }, async (p, m, g) => {
    if (!o) return g(m)
    let u = (await ge(o)) || (await ge(o))
    if (!r) return { text: u ? $o : $s }
    let { isFullscreen: T } = m.presentation
    x = m.presentation.columns
    c = { ...c, isFullscreen: T }
    let D = Fn({ isOpen: a, columns: T ? x : null })
    if (D === 'too-narrow') return { text: wt }
    let M = D === 'open'
    if (!(M ? await zr(o, 'manual') : await Xr(o).then(() => !0)))
      return { text: wt }
    if (!T) return M ? {} : { text: Xs }
    Yr(o, M ? 'diff' : 'convo')
    await o.storeSet(we, M).catch(() => {
      return
    })
    return { text: M ? Vs : Ys }
  })
  e('ui.close', { id: Z }, async (p, m, g) => {
    if (
      m.origin.kind === 'person' &&
      c.placement === 'inline' &&
      c.dialogView === 'detail' &&
      o
    ) {
      c = { ...c, dialogView: 'list' }
      w(o)
      i = st(c)
      o.openPane({ ...Me(), focus: !0 }).catch(() => {
        return
      })
      return { deny: 'back to the file list' }
    }
    let T = await g(m),
      D = T.deny === void 0,
      M = D && m.origin.kind === 'person'
    if (D) a = !1
    let H = c.isFullscreen !== !1
    if (M && o && H) {
      Yr(o, 'convo')
      await o.storeSet(we, !1).catch(() => {
        return
      })
    }
    return T
  })
  e('ui.focus', { plugin: Ks }, (p, m, g) => {
    let T =
      c.placement === 'inline' && c.dialogView === 'list' && o
        ? kn(c, m.element)
        : null
    if (T === 'stay') return {}
    if (!T || !o) return g(m)
    c = { ...c, selectedPath: T.selectedPath }
    K(o).catch(() => {
      return
    })
    lt(o)
    o.invalidate()
    return g({ ...m, element: T.landing })
  })
  e('ui.scroll', { requestId: Z }, (p, m, g) => {
    if (!(m.origin.kind === 'person' && c.placement === 'dock') || !o)
      return g(m)
    let T = Mn(c, m)
    c = { ...c, place: T ? br(c, m.by) : Nn(c, m) }
    o.invalidate()
    return {}
  })
  e('command.run', { command: ['clear', 'resume'] }, async (p, m, g) => {
    let u = await g(m)
    if (!o) return u
    let T = m.command === 'resume',
      D = a && !T
    if (a && T)
      await Xr(o).catch(() => {
        return
      })
    ;(() => {
      ;(() => {
        ;(() => {
          ;(() => {
            ;(() => {
              ;(() => {
                ;(() => {
                  Ut()
                  return (f = !1)
                })()
                return (l = !1)
              })()
              return (A = null)
            })()
            return (b = null)
          })()
          return B.clear()
        })()
        return ct(o)
      })()
      return (c = an(c))
    })()
    n = (await qr(o)) ?? (T ? n : await o.now())
    if (D) {
      await $r(o, 'manual')
      await ge(o)
      jr()
      Le(o)
    }
    if (T)
      Vr(o).catch(() => {
        return
      })
    return u
  })
  function qn(p, m, g) {
    let u = Yo.some(H => H === m.tool),
      T = u && g !== void 0 && g.deny === void 0 && g.isError !== !0,
      D = u ? T : Zs(g)
    if (D) S += 1
    if (D && a) Wt(p)
    if (T && m.agentId === void 0)
      Kt(p).catch(() => {
        return
      })
  }
  e('tool.call', { tool: [...Yo, ...Qs] }, async (p, m, g) => {
    let u
    try {
      u = await g(m)
      return u
    } finally {
      if (o) qn(o, m, u)
    }
  })
  e('prompt.submit', async (p, m, g) => {
    let u = O
    if (!o || !u || _ === u) return g(m)
    let T = m.context ?? [],
      D = us(u.text, is - T.reduce((M, H) => M + H.length, 0))
    if (D === void 0) {
      ct(o)
      o.status(`${L(u.path)}'s diff did not fit in the prompt and was dropped`)
      w(o)
      return g(m)
    }
    _ = u
    try {
      let M = await g({ ...m, context: [...T, D] })
      if (M.drop === void 0) {
        if (
          (() => {
            he(o).asked()
            return O === u
          })()
        ) {
          ct(o)
          w(o)
        }
      }
      return M
    } finally {
      _ = null
    }
  })
}
const diffModule = {
  ASK_CUT_NOTE: gt,
  AUTO_OPEN_MIN_COLUMNS: $t,
  BASE_OUTCOMES: Hn,
  BODY_BUDGET: yn,
  BUILTIN_HOLDS_PATTERN: js,
  COMMAND_DESCRIPTION: Gs,
  COMMAND_NAME: Ws,
  COMMAND_SPEC: Xo,
  CONVENTIONAL_DEFAULT_BRANCHES: oo,
  DIALOG_DISMISSED_TEXT: Xs,
  DIALOG_PATH_FLOOR: es,
  DIALOG_PATH_RESERVE: Qr,
  DIFF_LEADING_ARGS: He,
  EDITING_TOOLS: Yo,
  EMPTY_FILE_HUNKS: Ue,
  EMPTY_NUMSTAT: ko,
  FAILED_RUN: Jt,
  FEATURES: oe,
  FILE_FRAME_NODES: Or,
  FILE_HEADER_START: Se,
  FIRST_WIDE_POINT: fr,
  FOOT_ROWS: kr,
  GENERATED_DIRECTORIES: Co,
  GENERATED_FILENAMES: Fo,
  GENERATED_FILENAME_PATTERNS: Bo,
  GENERATED_SUFFIXES: vo,
  GIT_BASE_MODES: _t,
  GIT_CHILD_ENV: ys,
  GIT_TIMEOUT_MS: as,
  GIT_UNANSWERED_TEXT: $s,
  GIT_WORDS: Pt,
  GUTTER_CHROME: rs,
  HEAD_POLL_MS: fs,
  HOST_OUTPUT_CAP_BYTES: ts,
  HUNKS_ARGS: hs,
  HUNK_HEADER: Ot,
  INITIAL_MODEL: dn,
  INSTALLED_BACKEND_PROBES: Fs,
  LARGE_FILE_HUNKS: po,
  MAX_BODY_CHARS: kt,
  MAX_BODY_NODES: ir,
  MAX_CODE_CHARS: Re,
  MAX_DIFF_BYTES: Yt,
  MAX_FILES: Vt,
  MAX_FILES_FOR_DETAILS: qt,
  MAX_LINES_PER_FILE: xt,
  MAX_LISTED_DIRECTORIES: yt,
  MAX_PATHSPEC_CHARS: os,
  MAX_SUMMARY_ROWS: Fe,
  MAX_UNTRACKED_PROBES: Zt,
  MAX_VISIBLE_FILES: q,
  MORE_BELOW_TEXT: zs,
  MOST_UTF8_BYTES: Ke,
  NEW_SESSION_FIELDS: er,
  NOT_IN_REPOSITORY_TEXT: $o,
  NO_BODIES: ce,
  NO_OPTIONAL_LOCKS: W,
  OPEN_MIN_COLUMNS: Be,
  PANEL_HIDDEN_TEXT: Ys,
  PANEL_SHOWN_TEXT: Vs,
  PANE_ID: Z,
  PANE_RIGHT_PAD_COLUMNS: ut,
  PANE_TITLE: jo,
  PANE_TOP_PAD_ROWS: ve,
  PATH_FLOOR: zt,
  PLUGIN_NAMES: Ks,
  POINTER: cr,
  PREVIEW_CHARS: Rt,
  PRE_SESSION_BODY_CAP: ht,
  PROMPT_CONTEXT_MAX_CHARS: is,
  QUOTED_HEADER_START: lo,
  REBASE_MARKS: fe,
  REDRAW_COALESCE_MS: ps,
  REFRESH_DEBOUNCE_MS: ms,
  RENAME_RECORDS: xo,
  REPOSITORY_LINES: Po,
  RESIZE_TERMINAL_TEXT: wt,
  SAFE_PATHSPEC_PATTERN: Sr,
  SAFE_REF_PATTERN: To,
  SCROLL_MARGIN_ROWS: ss,
  SHELL_TOOLS: Qs,
  SHORTSTAT_PATTERN: ho,
  SHOWN_TRIGGERS: Br,
  STATUS_PATH_OFFSET: go,
  STAT_CELLS: Xt,
  STORE_OPEN_KEY: we,
  TABS: Un,
  TAB_WIDTH: At,
  TEST_DIRECTORIES: Uo,
  TEST_FILENAME_PATTERNS: Go,
  TODO_BAR_CELLS: ls,
  TODO_BAR_RESERVE: ds,
  TODO_TOOL: Js,
  TRANSIENT_STATE_FILES: _o,
  UNMERGED_STATUS: co,
  WHEEL_ROWS: ns,
  WIDEST_BUCKET_COLUMNS: Jr,
  WIDE_RANGES: pr,
  WIDTH_BUCKETS: it,
  WORKING_TREE_BASIS: No,
  ZERO_TOTALS: xn,
  ZERO_WIDTH_RANGES: mr,
  afterFetch: nn,
  afterNewSession: an,
  armedAskOf: cs,
  arrayOf: Te,
  askKeyOf: dr,
  backendOf: Bs,
  baseModeOf: fn,
  baseNameOf: Ye,
  baseStoreKeyOf: Ko,
  bodyEntryOf: Er,
  bodyLayoutOf: ot,
  bodyScrolledBy: Nn,
  branchBaseOf: Ts,
  branchSourceOf: Ro,
  branchTier: Ds,
  cellWidth: J,
  chargedWidth: ke,
  codeBlocksOf: lr,
  countOf: G,
  currentBranchOf: to,
  cutHunks: Tt,
  datingsOf: Ge,
  defaultBranchOf: ro,
  detailModelOf: _r,
  detailView: Pn,
  dialogEntriesOf: ae,
  dialogFileRow: Tn,
  dialogFocusOf: kn,
  dialogPane: Rr,
  dialogRowsOf: st,
  dialogTitleOf: pn,
  dialogWindowOf: te,
  diffDataOf: pe,
  diffStat: V,
  dimNote: Y,
  dirtyPathsOf: Es,
  displayPathOf: Oe,
  divider: ur,
  dockPlanOf: Ae,
  drawWindow: Dn,
  drawnFilesOf: Mr,
  drawnLineOf: Nt,
  emptyStateOf: mn,
  entryKindsOf: Lr,
  fetchContextOf: Ms,
  fetchDiff: Do,
  fetchHunks: Et,
  fileEditOf: Zo,
  fileKeyOf: Dt,
  fileRow: On,
  firstLineCut: ar,
  fittedAskTextOf: us,
  gitBackendOf: Cs,
  headKeyOf: _s,
  headerTotalsOf: ln,
  headerView: yr,
  hunkAfter: Io,
  hunkHeaderOf: xe,
  hunkOf: fo,
  hunkSourceOf: qe,
  hunkWindowOf: An,
  hunksOf: qo,
  insetOf: Ar,
  isAbsolutePath: Eo,
  isBodyLine: We,
  isCheckpointing: Ir,
  isGeneratedFile: Ho,
  isLastOfDiff: Mo,
  isNoiseFile: Hs,
  isOnPaneSurface: Bt,
  isPastDetails: Ao,
  isPromptRow: on,
  isRecord: z,
  isSafeRefName: Oo,
  isSha: so,
  isTestFile: Wo,
  isTransient: Ps,
  isUnbornHead: ws,
  isUnderUtf8Ceiling: ao,
  isWheelOverList: Mn,
  isWholeAnswer: $e,
  isWholeListing: je,
  keptOf: X,
  kindWalkOf: So,
  leadingHunkOf: Ze,
  legendRow: Sn,
  listBlockOf: Ln,
  listBodyOf: bn,
  listEdgeButton: hr,
  listRow: et,
  listScrolledBy: br,
  listWindowOf: sr,
  mayHaveWritten: Zs,
  mergeBaseCandidatesOf: no,
  mergedResultOf: _e,
  mergedWithUntracked: bo,
  messageOf: Ft,
  messagePaneOf: wr,
  missingBaseOf: io,
  modeLabelOf: cn,
  mtimeOf: Cr,
  nameRow: gr,
  overlayUnstaged: Rs,
  padEnd: hn,
  paneToggleOf: Fn,
  paneView: Bn,
  parseFileDiff: mo,
  parseFileDiffs: Os,
  parseNumstat: yo,
  parseShortstat: Ss,
  partitionOf: or,
  pickedTurnOf: Q,
  pinnedLeadOf: gs,
  placeAtFile: In,
  placeholderOf: Lt,
  plural: be,
  preludeOf: rt,
  present: ie,
  recorderOf: he,
  register: ym,
  registerFailedTextOf: qs,
  renameDisplayOf: Qt,
  repositoryOf: ks,
  rootedPathOf: Ve,
  safely: nt,
  sanitizeLine: Qe,
  sanitizeName: L,
  segmentRowsOf: nr,
  segmentsOf: wn,
  sidebarPane: Nr,
  sourcePicker: Tr,
  stampIfFile: se,
  stampProbeOf: ze,
  statTextOf: xr,
  statsOf: St,
  subHunksOf: bt,
  tagPreSession: bs,
  titleRow: En,
  todoBar: _n,
  todoProgressOf: en,
  toggleRow: Mt,
  truncateStart: Je,
  turnDiffsOf: Qo,
  turnEntryOf: Pr,
  turnOf: rn,
  turnTitleOf: tr,
  turnTotalsOf: rr,
  unbornNoteOf: un,
  unbornTier: Pe,
  unstagedNumstat: As,
  untrackedFiles: Ns,
  untrackedRowsOf: wo,
  untrackedWithheldTextOf: zo,
  wasDirtyAtStart: Xe,
  widthBucketOf: Gn,
  withClosingLine: Lo,
  withUntracked: me,
  workingTreeTier: Ls,
  wrappedLines: gn,
}
export {
  gt as ASK_CUT_NOTE,
  $t as AUTO_OPEN_MIN_COLUMNS,
  Hn as BASE_OUTCOMES,
  yn as BODY_BUDGET,
  js as BUILTIN_HOLDS_PATTERN,
  Gs as COMMAND_DESCRIPTION,
  Ws as COMMAND_NAME,
  Xo as COMMAND_SPEC,
  oo as CONVENTIONAL_DEFAULT_BRANCHES,
  Xs as DIALOG_DISMISSED_TEXT,
  es as DIALOG_PATH_FLOOR,
  Qr as DIALOG_PATH_RESERVE,
  He as DIFF_LEADING_ARGS,
  Yo as EDITING_TOOLS,
  Ue as EMPTY_FILE_HUNKS,
  ko as EMPTY_NUMSTAT,
  Jt as FAILED_RUN,
  oe as FEATURES,
  Or as FILE_FRAME_NODES,
  Se as FILE_HEADER_START,
  fr as FIRST_WIDE_POINT,
  kr as FOOT_ROWS,
  Co as GENERATED_DIRECTORIES,
  Fo as GENERATED_FILENAMES,
  Bo as GENERATED_FILENAME_PATTERNS,
  vo as GENERATED_SUFFIXES,
  _t as GIT_BASE_MODES,
  ys as GIT_CHILD_ENV,
  as as GIT_TIMEOUT_MS,
  $s as GIT_UNANSWERED_TEXT,
  Pt as GIT_WORDS,
  rs as GUTTER_CHROME,
  fs as HEAD_POLL_MS,
  ts as HOST_OUTPUT_CAP_BYTES,
  hs as HUNKS_ARGS,
  Ot as HUNK_HEADER,
  dn as INITIAL_MODEL,
  Fs as INSTALLED_BACKEND_PROBES,
  po as LARGE_FILE_HUNKS,
  kt as MAX_BODY_CHARS,
  ir as MAX_BODY_NODES,
  Re as MAX_CODE_CHARS,
  Yt as MAX_DIFF_BYTES,
  Vt as MAX_FILES,
  qt as MAX_FILES_FOR_DETAILS,
  xt as MAX_LINES_PER_FILE,
  yt as MAX_LISTED_DIRECTORIES,
  os as MAX_PATHSPEC_CHARS,
  Fe as MAX_SUMMARY_ROWS,
  Zt as MAX_UNTRACKED_PROBES,
  q as MAX_VISIBLE_FILES,
  zs as MORE_BELOW_TEXT,
  Ke as MOST_UTF8_BYTES,
  er as NEW_SESSION_FIELDS,
  $o as NOT_IN_REPOSITORY_TEXT,
  ce as NO_BODIES,
  W as NO_OPTIONAL_LOCKS,
  Be as OPEN_MIN_COLUMNS,
  Ys as PANEL_HIDDEN_TEXT,
  Vs as PANEL_SHOWN_TEXT,
  Z as PANE_ID,
  ut as PANE_RIGHT_PAD_COLUMNS,
  jo as PANE_TITLE,
  ve as PANE_TOP_PAD_ROWS,
  zt as PATH_FLOOR,
  Ks as PLUGIN_NAMES,
  cr as POINTER,
  Rt as PREVIEW_CHARS,
  ht as PRE_SESSION_BODY_CAP,
  is as PROMPT_CONTEXT_MAX_CHARS,
  lo as QUOTED_HEADER_START,
  fe as REBASE_MARKS,
  ps as REDRAW_COALESCE_MS,
  ms as REFRESH_DEBOUNCE_MS,
  xo as RENAME_RECORDS,
  Po as REPOSITORY_LINES,
  wt as RESIZE_TERMINAL_TEXT,
  Sr as SAFE_PATHSPEC_PATTERN,
  To as SAFE_REF_PATTERN,
  ss as SCROLL_MARGIN_ROWS,
  Qs as SHELL_TOOLS,
  ho as SHORTSTAT_PATTERN,
  Br as SHOWN_TRIGGERS,
  go as STATUS_PATH_OFFSET,
  Xt as STAT_CELLS,
  we as STORE_OPEN_KEY,
  Un as TABS,
  At as TAB_WIDTH,
  Uo as TEST_DIRECTORIES,
  Go as TEST_FILENAME_PATTERNS,
  ls as TODO_BAR_CELLS,
  ds as TODO_BAR_RESERVE,
  Js as TODO_TOOL,
  _o as TRANSIENT_STATE_FILES,
  co as UNMERGED_STATUS,
  ns as WHEEL_ROWS,
  Jr as WIDEST_BUCKET_COLUMNS,
  pr as WIDE_RANGES,
  it as WIDTH_BUCKETS,
  No as WORKING_TREE_BASIS,
  xn as ZERO_TOTALS,
  mr as ZERO_WIDTH_RANGES,
  nn as afterFetch,
  an as afterNewSession,
  cs as armedAskOf,
  Te as arrayOf,
  dr as askKeyOf,
  Bs as backendOf,
  fn as baseModeOf,
  Ye as baseNameOf,
  Ko as baseStoreKeyOf,
  Er as bodyEntryOf,
  ot as bodyLayoutOf,
  Nn as bodyScrolledBy,
  Ts as branchBaseOf,
  Ro as branchSourceOf,
  Ds as branchTier,
  J as cellWidth,
  ke as chargedWidth,
  lr as codeBlocksOf,
  G as countOf,
  to as currentBranchOf,
  Tt as cutHunks,
  Ge as datingsOf,
  ro as defaultBranchOf,
  _r as detailModelOf,
  Pn as detailView,
  ae as dialogEntriesOf,
  Tn as dialogFileRow,
  kn as dialogFocusOf,
  Rr as dialogPane,
  st as dialogRowsOf,
  pn as dialogTitleOf,
  te as dialogWindowOf,
  pe as diffDataOf,
  V as diffStat,
  Y as dimNote,
  Es as dirtyPathsOf,
  Oe as displayPathOf,
  ur as divider,
  Ae as dockPlanOf,
  Dn as drawWindow,
  Mr as drawnFilesOf,
  Nt as drawnLineOf,
  mn as emptyStateOf,
  Lr as entryKindsOf,
  Ms as fetchContextOf,
  Do as fetchDiff,
  Et as fetchHunks,
  Zo as fileEditOf,
  Dt as fileKeyOf,
  On as fileRow,
  ar as firstLineCut,
  us as fittedAskTextOf,
  Cs as gitBackendOf,
  _s as headKeyOf,
  ln as headerTotalsOf,
  yr as headerView,
  Io as hunkAfter,
  xe as hunkHeaderOf,
  fo as hunkOf,
  qe as hunkSourceOf,
  An as hunkWindowOf,
  qo as hunksOf,
  Ar as insetOf,
  Eo as isAbsolutePath,
  We as isBodyLine,
  Ir as isCheckpointing,
  Ho as isGeneratedFile,
  Mo as isLastOfDiff,
  Hs as isNoiseFile,
  Bt as isOnPaneSurface,
  Ao as isPastDetails,
  on as isPromptRow,
  z as isRecord,
  Oo as isSafeRefName,
  so as isSha,
  Wo as isTestFile,
  Ps as isTransient,
  ws as isUnbornHead,
  ao as isUnderUtf8Ceiling,
  Mn as isWheelOverList,
  $e as isWholeAnswer,
  je as isWholeListing,
  X as keptOf,
  So as kindWalkOf,
  Ze as leadingHunkOf,
  Sn as legendRow,
  Ln as listBlockOf,
  bn as listBodyOf,
  hr as listEdgeButton,
  et as listRow,
  br as listScrolledBy,
  sr as listWindowOf,
  Zs as mayHaveWritten,
  no as mergeBaseCandidatesOf,
  _e as mergedResultOf,
  bo as mergedWithUntracked,
  Ft as messageOf,
  wr as messagePaneOf,
  io as missingBaseOf,
  cn as modeLabelOf,
  Cr as mtimeOf,
  gr as nameRow,
  Rs as overlayUnstaged,
  hn as padEnd,
  Fn as paneToggleOf,
  Bn as paneView,
  mo as parseFileDiff,
  Os as parseFileDiffs,
  yo as parseNumstat,
  Ss as parseShortstat,
  or as partitionOf,
  Q as pickedTurnOf,
  gs as pinnedLeadOf,
  In as placeAtFile,
  Lt as placeholderOf,
  be as plural,
  rt as preludeOf,
  ie as present,
  he as recorderOf,
  ym as register,
  qs as registerFailedTextOf,
  Qt as renameDisplayOf,
  ks as repositoryOf,
  Ve as rootedPathOf,
  nt as safely,
  Qe as sanitizeLine,
  L as sanitizeName,
  nr as segmentRowsOf,
  wn as segmentsOf,
  Nr as sidebarPane,
  Tr as sourcePicker,
  se as stampIfFile,
  ze as stampProbeOf,
  xr as statTextOf,
  St as statsOf,
  bt as subHunksOf,
  bs as tagPreSession,
  En as titleRow,
  _n as todoBar,
  en as todoProgressOf,
  Mt as toggleRow,
  Je as truncateStart,
  Qo as turnDiffsOf,
  Pr as turnEntryOf,
  rn as turnOf,
  tr as turnTitleOf,
  rr as turnTotalsOf,
  un as unbornNoteOf,
  Pe as unbornTier,
  As as unstagedNumstat,
  Ns as untrackedFiles,
  wo as untrackedRowsOf,
  zo as untrackedWithheldTextOf,
  Xe as wasDirtyAtStart,
  Gn as widthBucketOf,
  Lo as withClosingLine,
  me as withUntracked,
  Ls as workingTreeTier,
  gn as wrappedLines,
  diffModule as default,
}
