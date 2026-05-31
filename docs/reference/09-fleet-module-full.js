var dw4 = R(() => {
  iH()
  ;(Fw4 = p(q_(), 1)), (_A = p(PH(), 1))
})
var XC6 = {}
f_(XC6, {
  summarizeEvent: () => Gj4,
  stateBucket: () => TC6,
  spawnOrigin: () => ZE_,
  sortJobs: () => XE_,
  seedLastJobs: () => MhO,
  rollupJobColor: () => fj4,
  repoGroupLabel: () => Zj4,
  repoGroup: () => _1q,
  pruneMap: () => i4q,
  pickIcon: () => kj4,
  parseQuery: () => Aj4,
  parsePrRef: () => PE_,
  parseDispatch: () => a4q,
  needsRespawn: () => K1q,
  mountFleetView: () => chO,
  labelReplaceFrame: () => zj4,
  jobMatchesPr: () => r4q,
  jobMatchesFrame: () => o4q,
  jobMatchesCwd: () => zC6,
  jobLabel: () => DC6,
  isSelfDriving: () => fC6,
  isLoopJob: () => GE_,
  glyphColor: () => z1q,
  formatJobAge: () => q1q,
  fleetTitle: () => $j4,
  flattenDetail: () => sl,
  extractRepoCwd: () => Y1q,
  effectiveStateSortOrder: () => fE_,
  effectiveSortOrder: () => JC6,
  doneCapForRows: () => Yj4,
  deriveBand: () => g2H,
  deriveActivity: () => YC6,
  childStatusColor: () => $1q,
  buildPrRefRe: () => AC6,
  applyFleetViewHostWindowsEnv: () => dhO,
  actionableStatus: () => Wj4,
  _resetRemountCachesForTesting: () => DhO,
  FleetView: () => Vj4,
  AUTO_RELAUNCH_UNFOCUSED_MS: () => OC6,
  AUTO_RELAUNCH_MIN_INTERVAL_MS: () => Tj4,
  AUTO_RELAUNCH_ENV_KEY: () => n4q,
})
function i4q(H, _) {
  let q
  for (let K of H.keys()) if (!_.has(K)) (q ??= new Map(H)).delete(K)
  return q ?? H
}
function OhO(H) {
  return n9(Math.max(0, Date.now() - Date.parse(H.state.createdAt)), {
    mostSignificantOnly: !0,
  })
}
function q1q(H, _) {
  let q = Date.now()
  if (_ != null && _ > q) return `in ${n9(_ - q, { mostSignificantOnly: !0 })}`
  return OhO(H)
}
function DC6(H, _ = !1) {
  if (H.name) return H.name.replace(c4q, '').replace(/\s+/g, ' ').trim()
  let q = 25,
    K = D1(H.intent)
      .replace(c4q, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
  if (K.length === 0) {
    if (_) return 'current session'
    if (H.template === 'bg' && H.state === 'working') return 'new session'
    return H.template.replace(c4q, '').replace(/\s+/g, ' ').trim()
  }
  let O = K.length > 3 ? `${K.slice(0, 3).join(' ')}\u2026` : K.join(' ')
  if (a_(O) <= q) return O
  let T = '',
    z = 0
  for (let $ of vb_(O)) {
    let Y = a_($)
    if (z + Y > q - 1) break
    ;(T += $), (z += Y)
  }
  return `${T}\u2026`
}
function ThO(H, _) {
  let q = uTH.c(12),
    K = rq(),
    O
  if (q[0] !== H || q[1] !== _)
    (O = { label: H, hasName: _, fired: !1 }),
      (q[0] = H),
      (q[1] = _),
      (q[2] = O)
  else O = q[2]
  let T = U8.useRef(O),
    [z, $] = U8.useState(null),
    Y,
    A
  if (q[3] !== K || q[4] !== H || q[5] !== _)
    (Y = () => {
      if (T.current.fired || T.current.hasName || !_) {
        T.current = { label: H, hasName: _, fired: T.current.fired }
        return
      }
      let j = T.current.label
      T.current = { label: H, hasName: !0, fired: !0 }
      let J = Math.max(A0H(j), A0H(H))
      if (J === 0) return
      $({ old: j, n: 1 })
      let M = 1,
        D = Math.max(16, Math.floor(360 / J)),
        f = null,
        X = () => {
          if (((M = M + 1), M >= J)) $(null), (f = null)
          else $({ old: j, n: M }), (f = K.setTimeout(X, D))
        }
      return (
        (f = K.setTimeout(X, D)),
        () => {
          f?.(), $(null)
        }
      )
    }),
      (A = [K, H, _]),
      (q[3] = K),
      (q[4] = H),
      (q[5] = _),
      (q[6] = Y),
      (q[7] = A)
  else (Y = q[6]), (A = q[7])
  if ((U8.useLayoutEffect(Y, A), !z)) return null
  let w
  if (q[8] !== z.n || q[9] !== z.old || q[10] !== H)
    (w = zj4(z.old, H, z.n)),
      (q[8] = z.n),
      (q[9] = z.old),
      (q[10] = H),
      (q[11] = w)
  else w = q[11]
  return w
}
function zj4(H, _, q) {
  let K = vb_(H),
    O = vb_(_),
    T = O.slice(0, Math.min(q, O.length)).join(''),
    z = Math.max(a_(H), a_(_)),
    $ = a_(T),
    Y = ''
  for (let A of K.slice(q)) {
    let w = a_(A)
    if ($ + w > z) break
    ;(Y += A), ($ += w)
  }
  return { display: T + Y + ' '.repeat(z - $), newLen: T.length }
}
function zhO(H) {
  let _ = H.children
  if (!_?.length) return 0
  let q = _.filter(K => K.kind !== 'frame')
  if (q.length > 1) return a_(`${q.length} PRs`)
  if (q.length === 1) {
    let K = Xj4(q[0])
    return a_(K !== void 0 ? `PR #${K}` : 'PR')
  }
  return a_(_.length > 1 ? `${_.length} ${x$H}` : x$H)
}
function $hO(H, _, q) {
  let K = Math.max(_hO, ...H.map(z => a_(q1q(z, _(z))))),
    O = Math.min(
      40,
      Math.max(
        12,
        ...H.map(
          z => a_(DC6(z.state, z.id === q)) + (bR8(z.state.color) ? 2 : 0),
        ),
      ),
    ),
    T = Math.max(0, ...H.map(z => zhO(z.state)))
  return { age: K, label: O, prefix: KhO + O, artifact: T }
}
function YC6(H, _) {
  let q = QkH(H.state)
  if (q && H.tempo !== 'active' && !(q === 'success' && fC6(H))) return q
  let K = H.children?.filter(z => z.kind !== 'frame')
  if (
    _ &&
    H.tempo !== 'active' &&
    H.template === cqH.name &&
    K?.length &&
    K.every(z => _.get(z.href)?.state === 'MERGED')
  )
    return 'success'
  let O = H.tempo === 'active' ? 1 : 5,
    T = Date.now() - Date.parse(H.updatedAt)
  if (T < O * 3 * 60000) return 'flowing'
  if (T < O * 15 * 60000) return 'slowing'
  return 'stuck'
}
function g2H(H, _) {
  if (_ === 'busy') return 'active'
  if (HD(H) && !(QkH(H.state) === 'success' && fC6(H))) return 'completed'
  if (H.tempo === 'blocked' || _ === 'waiting') return 'blocked'
  return 'active'
}
function $j4(H) {
  return H > 0 ? `${H} awaiting input \xB7 claude agents` : 'claude agents'
}
function Yj4(H) {
  return pY(Math.floor(H / 5), YhO, AhO)
}
function TC6(H, _, q) {
  if (q === 'busy') return 'working'
  if (H.activity === 'failure') return 'done'
  if (H.activity === 'stopped') return 'done'
  if (q === 'waiting') return 'blocked'
  if (
    !fC6(H.state) &&
    H.state.children?.some(O => {
      let T = _?.get(O.href)
      if (T?.state !== 'OPEN') return !1
      let z = lO6(T)
      return z === 'error' || (z === 'warning' && T.review !== 'APPROVED')
    })
  )
    return 'review'
  if (H.activity === 'success') return 'done'
  if (H.state.tempo === 'blocked') return 'blocked'
  return 'working'
}
function K1q(H) {
  let _ = QkH(H.state)
  return (_ === 'failure' || _ === 'stopped') && HD(H) && !Z1H(H)
}
function Aj4(H) {
  let _,
    q,
    K,
    O,
    T,
    z = []
  for (let $ of H.trim().split(/\s+/)) {
    let Y = $.toLowerCase()
    if (Y.startsWith('a:')) _ = Y.slice(2) || void 0
    else if (Y.startsWith('s:')) q = Y.slice(2) || void 0
    else if (Y.startsWith('o:')) K = Y.slice(2)
    else if (PE_($)) O = PE_($)
    else if (lIH($)) T = lIH($)
    else z.push($)
  }
  return {
    template: _,
    state: q,
    output: K,
    pr: O,
    frame: T,
    text: z.join(' ').toLowerCase(),
  }
}
function PE_(H) {
  let _ = H.trim()
  if (/\s/.test(_)) return null
  return (/^#(\d+)$/.exec(_) ?? /\/pull\/(\d+)(?!\d)/.exec(_))?.[1] ?? null
}
function AC6(H) {
  return new RegExp(`/pull/${H}(?!\\d)`)
}
function r4q(H, _, q = AC6(_)) {
  return (
    !!H.children?.some(K => K.id === _ || q.test(K.href)) ||
    Object.values(H.output ?? {}).some(K => q.test(K))
  )
}
function zC6(H, _) {
  let q = Bs.relative(_, ZE_(H))
  return q.split(/[/\\]/, 1)[0] !== '..' && !Bs.isAbsolute(q)
}
function o4q(H, _) {
  return (
    !!H.children?.some(q => q.kind === 'frame' && lIH(q.href) === _) ||
    Object.values(H.output ?? {}).some(q =>
      q.split(/\s+/).some(K => lIH(K) === _),
    )
  )
}
function a4q(H, _, q = {}, K = []) {
  let O = H.trim()
  if (J2H() && O.startsWith('!')) {
    let D = O.slice(1).trim()
    return { template: cqH, intent: '', matched: !!D, exec: D }
  }
  let T = O.toLowerCase()
  if (T.startsWith('a:') || T.startsWith('s:') || T.startsWith('o:'))
    return null
  let z,
    $,
    Y,
    A = Object.keys(q),
    w = O.replace(/(?:^|\s)@(\S+)/g, (D, f) => {
      let X = f.toLowerCase(),
        P = _.find(Z => Z.name.toLowerCase() === X)
      if (P) return (z ??= P), ''
      let G = K.find(Z => Z.name.toLowerCase() === X)
      if (G) return (Y ??= G.name), ''
      let W = A.find(Z => Z.toLowerCase() === X)
      if (W) return ($ ??= q[W]), ''
      return D
    }).trim(),
    j = w.search(/\s/),
    J = (j < 0 ? w : w.slice(0, j)).toLowerCase(),
    M = z ? void 0 : _.find(D => D.name.toLowerCase() === J)
  if (M)
    return {
      template: M,
      intent: j < 0 ? '' : w.slice(j + 1).trim(),
      matched: !0,
      cwd: $,
      routine: Y,
    }
  if (z) return { template: z, intent: w, matched: !0, cwd: $, routine: Y }
  return { template: cqH, intent: w, matched: !1, cwd: $, routine: Y }
}
function s4q(H, _, q) {
  c('tengu_bg_agent_action', {
    action: H,
    source: 'fleet',
    jobSessionId: _.sessionId,
    agent: _.template,
    jobState: _.state,
    tempo: _.tempo,
    ...q,
    ...!1,
  })
}
function JhO(H, _, q) {
  return [
    {
      key: 'x',
      label: 'stop',
      bands: ['active', 'blocked'],
      run: async K => {
        _(K.id)
        let O = new Date().toISOString(),
          T = q(
            z =>
              z.map($ =>
                $.id === K.id && !HD($.state)
                  ? {
                      ...$,
                      state: {
                        ...$.state,
                        state: 'stopped',
                        detail: 'stopped',
                        tempo: 'idle',
                        updatedAt: O,
                        firstTerminalAt: $.state.firstTerminalAt ?? O,
                      },
                      activity: 'stopped',
                    }
                  : $,
              ),
            void 0,
            K.id,
          )
        try {
          let z = await XTH(K.id, K.state)
          if (!z.confirmed)
            throw (
              (uH('fleet_view_stop_job', 'kill_unconfirmed'),
              new wC6(z.error ?? 'worker may still be running'))
            )
          c('tengu_bg_agent_action', {
            action: 'stop',
            source: 'fleet',
            jobSessionId: K.state.sessionId,
          }),
            SH('fleet_view_stop_job')
          let $ = b4(K.id),
            Y = await o7($)
          if (Y && !HD(Y))
            await iO($, {
              ...Y,
              state: 'stopped',
              detail: 'stopped',
              tempo: 'idle',
              updatedAt: O,
              firstTerminalAt: Y.firstTerminalAt ?? O,
            })
        } finally {
          T?.(), H()
        }
      },
    },
    {
      key: 'x',
      label: 'delete',
      bands: ['completed'],
      run: async K => {
        let O = q(Y => Y.filter(A => A.id !== K.id), K.id),
          T = !1,
          z,
          $
        try {
          let Y = await dqH(K.id, { force: !0 })
          if (((T = Y.removed), (z = Y.keptWorktree), ($ = Y.keptReason), !T))
            throw (
              (uH('fleet_view_delete_job', 'delete_unconfirmed'),
              new wC6(Y.error ?? 'worker may still be running'))
            )
        } finally {
          O?.(), H()
        }
        if (T)
          SH('fleet_view_delete_job'),
            c('tengu_bg_agent_action', {
              action: 'delete',
              source: 'fleet',
              jobSessionId: K.state.sessionId,
            })
        if (z)
          return `Worktree ${$ === 'branch_mismatch' ? 'is on a different branch' : 'could not be removed'} \u2014 kept at ${z}`
      },
    },
  ]
}
function jC6(...H) {
  return S8_(...H).catch(_ => ({
    ok: !1,
    error: `Couldn't respawn \u2014 ${LH(_)}`,
    alive: !1,
  }))
}
function MhO(H) {
  O1q = XE_(H.map(_ => ({ ..._, activity: YC6(_.state) })))
}
function DhO() {
  $C6.clear(), e4q.clear(), H1q.clear(), Dj4.clear()
}
function T1q() {
  return fjH()
}
function fhO() {
  let H = T1q()
  return [...H, ...[...H].reverse()]
}
function XhO() {
  return T1q()[4]
}
function PhO() {
  return T1q()[1]
}
function z1q(H, _, q) {
  if ((_ === 'success' || _ === 'failure' || _ === 'stopped') && QkH(H.state))
    return { color: WhO(_), dim: !1 }
  if (q === 'busy' || q === 'shell') return { color: void 0, dim: !1 }
  if (H.tempo === 'blocked' || q === 'waiting')
    return { color: 'warning', dim: !1 }
  return { color: void 0, dim: !0 }
}
function WhO(H) {
  switch (H) {
    case 'success':
      return 'success'
    case 'failure':
      return 'error'
    case 'stopped':
      return 'inactive'
  }
}
function fj4(H, _) {
  let q = H,
    K = H ? (iw4[H] ?? 0) : 0
  for (let O of _) {
    if (O.color === void 0 || WE_(O)) continue
    let T = iw4[O.color] ?? 0
    if (T > K) (q = O.color), (K = T)
  }
  return q
}
function WE_(H) {
  return H.row.kind === 'frame'
}
function Xj4(H) {
  let _ = PE_(H.href)
  if (_ !== null) return Number(_)
  return /^\d+$/.test(H.id) ? Number(H.id) : void 0
}
function $1q(H) {
  let _ = lO6(H)
  return _ === 'error' ? 'warning' : _
}
function GhO(H) {
  return [...H].sort((_, q) => q.sortRank - _.sortRank)
}
function Wj4(H) {
  if (H.state === 'MERGED') return [{ text: 'merged', color: 'merged' }]
  if (H.state === 'CLOSED') return [{ text: 'closed', color: 'inactive' }]
  let _ = [],
    { failed: q, pending: K, passed: O } = H.checks,
    T = q + K + O
  if (q > 0) _.push({ text: `${__.cross} ${q}/${T}`, color: 'error' })
  else if (K > 0) _.push({ text: `${O}/${T}`, color: 'warning' })
  else if (T > 0) _.push({ text: __.tick, color: 'success' })
  switch (H.review) {
    case 'APPROVED':
      _.push({ text: 'approved', color: 'success' })
      break
    case 'CHANGES_REQUESTED':
      _.push({ text: __.cross, color: 'error' })
      break
    case 'REVIEW_REQUIRED':
      _.push({ text: 'needs review', color: void 0 })
      break
    case null:
      break
  }
  if (_.length === 0) _.push({ text: H.state.toLowerCase(), color: $1q(H) })
  return _
}
function aw4(H, _) {
  return GhO(
    H.map(q => {
      if (q.kind === 'frame')
        return {
          row: q,
          prNumber: void 0,
          label: q.id,
          status: [],
          diffStat: void 0,
          color: 'claude',
          sortRank: 0,
        }
      let K = _.get(q.href),
        O = K ? lO6(K) : void 0
      return {
        row: q,
        prNumber: K?.number ?? Xj4(q),
        label: K?.title ?? '',
        status: K ? Wj4(K) : [],
        diffStat:
          K && K.state !== 'MERGED' && K.state !== 'CLOSED'
            ? { additions: K.additions, deletions: K.deletions }
            : void 0,
        color: K ? $1q(K) : void 0,
        sortRank: K?.state === 'OPEN' && O ? (ZhO[O] ?? 0) : 0,
      }
    }),
  )
}
function ZE_(H) {
  if (H.originCwd) return H.originCwd
  let _ = H.cwd.match(/^(.+?)[/\\]\.claude[/\\]worktrees[/\\]/)
  return _ ? _[1] : H.cwd
}
function _1q(H) {
  let _ = ZE_(H)
  return T$(_) ?? _
}
function Zj4(H) {
  return cL(H)
}
function JC6(H) {
  return H.sortOrder ?? Date.parse(H.createdAt)
}
function fE_(H, _) {
  return (
    H.stateSortOrder ??
    Date.parse(_ === 'done' ? (H.firstTerminalAt ?? H.updatedAt) : H.updatedAt)
  )
}
function XE_(H) {
  return [...H].sort((_, q) => JC6(_.state) - JC6(q.state))
}
function Gj4(H) {
  try {
    let _ = B_(H)
    if (_.type === 'assistant') {
      let q = _.message?.content ?? [],
        K = q.find(T => T.type === 'text')?.text
      if (K) return K
      let O = q.find(T => T.type === 'tool_use' && T.name !== d$)
      if (O) {
        let T = O.input?.description
        if (O.name === 'REPL' && typeof T === 'string' && T) return `REPL ${T}`
        return Pe8(O.name, O.input)
      }
    }
    if (_.type === 'user') {
      let q = _.message?.content,
        K = typeof q === 'string' ? q : q?.find(T => T.type === 'text')?.text,
        O = K
          ? Rj4(K)
              .split(`
`)
              .find(T => T.trim())
              ?.trim()
          : void 0
      if (O) return `> ${O}`
      if (Array.isArray(q)) {
        let T = q.find(z => z.type === 'tool_result' && z.is_error)
        if (T) {
          let z =
            typeof T.content === 'string'
              ? T.content
              : T.content?.find($ => $.type === 'text')?.text
          if (z) return `\u2717 ${U5(z)}`
        }
      }
    }
  } catch {}
  return null
}
function Rj4(H) {
  return H.replace(
    /<(system-reminder|task-notification)>[\s\S]*?(<\/\1>|$)/g,
    ' ',
  )
}
function sl(H) {
  return Rj4(D5(H))
    .replace(/<\/?[\w-]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function sw4(H) {
  let _ = uTH.c(8),
    { value: q } = H,
    K,
    O,
    T
  if (_[0] !== q) {
    let $ = q.split(/(\*\*.+?\*\*|\+\+.+?\+\+|`[^`]+`)/g)
    ;(K = V),
      (O = !0),
      (T = $.map(RhO)),
      (_[0] = q),
      (_[1] = K),
      (_[2] = O),
      (_[3] = T)
  } else (K = _[1]), (O = _[2]), (T = _[3])
  let z
  if (_[4] !== K || _[5] !== O || _[6] !== T)
    (z = y_.createElement(K, { dimColor: O }, T)),
      (_[4] = K),
      (_[5] = O),
      (_[6] = T),
      (_[7] = z)
  else z = _[7]
  return z
}
function RhO(H, _) {
  let q = H.match(/^(?:\*\*|\+\+|`)(.+?)(?:\*\*|\+\+|`)$/)
  return q ? y_.createElement(V, { key: _, bold: !0 }, q[1]) : H
}
function Lj4(H) {
  return Bs.join(_0(H.cwd), `${H.sessionId}.jsonl`)
}
function GE_(H) {
  let _ = q => q?.trim().toLowerCase().startsWith('/loop') ?? !1
  return _(H.intent) || _(H.initialPrompt)
}
function fC6(H) {
  return (
    H.routine !== void 0 ||
    (H.inFlight?.kinds.includes('session_cron') ?? !1) ||
    GE_(H)
  )
}
function kj4(H, _, q) {
  if (_ && H.tempo !== 'active' && q === void 0) return D3_
  if (q === 'busy' || q === 'shell') return null
  if (GE_(H)) return PhO()
  return XhO()
}
function LhO() {
  let H = uTH.c(1),
    [, _] = nO(120),
    q
  if (H[0] === Symbol.for('react.memo_cache_sentinel')) (q = fhO()), (H[0] = q)
  else q = H[0]
  let K = q
  return K[Math.floor(_ / 120) % K.length]
}
async function khO(H) {
  let _ = 0,
    q = [],
    K = 7,
    O = /"timestamp":"([^"]+)"/,
    T = Oj4.createInterface({
      input: qj4.createReadStream(H, { encoding: 'utf-8' }),
      crlfDelay: 1 / 0,
    })
  for await (let A of T) {
    if (!A.includes('"subtype":"scheduled_task_fire"')) continue
    let w = A.match(O)
    if (!w) continue
    let j = Date.parse(w[1])
    if (!Number.isFinite(j)) continue
    if ((_++, q.push(j), q.length > K)) q.shift()
  }
  if (q.length < 2) return { count: _, nextAt: null }
  let z = []
  for (let A = 1; A < q.length; A++) z.push(q[A] - q[A - 1])
  z.sort((A, w) => A - w)
  let $ = z[Math.floor(z.length / 2)],
    Y = q.at(-1) + $
  if (Y <= Date.now()) return { count: _, nextAt: null }
  return { count: _, nextAt: Y }
}
async function VhO(H, _ = 1) {
  try {
    let { content: q } = await XZ(Lj4(H.state), 16384),
      K = q
        .split(`
`)
        .map(Gj4)
        .filter(T => T !== null)
    return K.filter((T, z) => T !== K[z - 1])
      .slice(-_)
      .join(`
`)
      .trim()
  } catch {
    return ''
  }
}
function NhO(H) {
  let _ = H.trim()
  if (/\s/.test(_)) return null
  if (/^https?:\/\//.test(_)) return _
  let q = oN(_)
  return Bs.isAbsolute(q) ? MC6.pathToFileURL(q).href : null
}
function vhO(H) {
  let _ = []
  for (let q of H.matchAll(/(?:^|\s)[aso]:/gi)) {
    let K = q.index + q[0].length
    _.push([K - 2, K])
  }
  return _
}
function yhO(H, _) {
  let q = []
  for (let K of H.matchAll(/(?:^|\s)@(\S+)/g)) {
    if (!_.has(K[1].toLowerCase())) continue
    let O = K.index + K[0].length
    q.push([O - K[1].length - 1, O])
  }
  return q
}
function hhO(H, _, q) {
  return H.replace(/[@/]\S*$/, () => `${_}${q} `)
}
function Y1q(H, _, q = []) {
  let K = new Set(q.map(T => T.name.toLowerCase())),
    O = Object.keys(_)
  for (let T of H.matchAll(/(?:^|\s)@(\S+)/g)) {
    let z = T[1].toLowerCase()
    if (K.has(z)) continue
    let $ = O.find(Y => Y.toLowerCase() === z)
    if ($) return _[$]
  }
  return
}
function l4q(H) {
  return { kind: 'agent', name: H.name, description: U5(H.description) }
}
function ShO(H, _) {
  if (H === _ || _.length === 0) return H
  let q = new Set(H.map(K => K.name.toLowerCase()))
  return [...H, ..._.filter(K => !q.has(K.name.toLowerCase()))]
}
function Hj4(H) {
  let _ = b_().agentLastUsed ?? {}
  return H.slice().sort((q, K) => {
    let O = _[q.name] ?? 0,
      T = _[K.name] ?? 0
    if (O !== T) return T - O
    return q.name.localeCompare(K.name)
  })
}
function ChO(H, _, q, K, O, T, z) {
  let $ = T7(H, ' ').toLowerCase(),
    Y = $.startsWith('/'),
    A = H.match(/(?:^|\s)@(\S*)$/),
    w = A?.[1]?.toLowerCase(),
    j = A && Y1q(H.slice(0, -A[0].length), K, _) !== void 0,
    J = new Set(_.map(Z => Z.name.toLowerCase())),
    M = Object.keys(K).filter(Z => !J.has(Z.toLowerCase()) && !/\s/.test(Z)),
    D =
      w === void 0
        ? []
        : [
            ...Hj4(_)
              .filter(Z => Z.name.toLowerCase().startsWith(w))
              .map(l4q),
            ...q
              .filter(Z => Z.name.toLowerCase().startsWith(w))
              .sort((Z, L) => Z.name.localeCompare(L.name)),
            ...(j
              ? []
              : M.filter(Z => Z.toLowerCase().startsWith(w))
                  .sort((Z, L) => Z.localeCompare(L))
                  .map(Z => ({ kind: 'repo', name: Z, description: K[Z] }))),
          ],
    f = H.match(/(?:^|\s)\/(\S*)$/),
    X = f?.[1]?.toLowerCase(),
    P =
      X === void 0
        ? []
        : O.filter(Z => Z.name.toLowerCase().startsWith(X)).sort((Z, L) =>
            Z.name.localeCompare(L.name),
          ),
    G = Y
      ? []
      : [
          ..._.filter(Z => Z.name.toLowerCase().startsWith($))
            .sort((Z, L) => Z.name.localeCompare(L.name))
            .map(l4q),
          ...q
            .filter(Z => Z.name.toLowerCase().startsWith($))
            .sort((Z, L) => Z.name.localeCompare(L.name)),
          ...M.filter(Z => Z.toLowerCase().startsWith($))
            .sort((Z, L) => Z.localeCompare(L))
            .map(Z => ({ kind: 'repo', name: Z, description: K[Z] })),
          ...O.filter(Z => Z.name.toLowerCase().startsWith($)).sort((Z, L) =>
            Z.name.localeCompare(L.name),
          ),
        ],
    W =
      !T || T.exec !== void 0
        ? []
        : A
          ? D
          : f
            ? P
            : z && !H
              ? Hj4(_).map(l4q)
              : !T.matched && $ && !H.includes(' ')
                ? G
                : []
  return {
    firstWord: $,
    isSlashQuery: Y,
    atMatch: A !== null,
    slashMatch: f !== null,
    templateNames: J,
    repoNames: M,
    suggestions: W,
  }
}
function IhO({
  job: H,
  status: _,
  isPending: q,
  deleteArmed: K,
  onBack: O,
  onAttach: T,
  onReply: z,
  isTerminalFocused: $,
  childRows: Y,
  replyDrafts: A,
  replyError: w,
  onReplyError: j,
  renaming: J,
}) {
  U8.useEffect(() => s4q('peek', H.state), [])
  let M = Date.parse(H.state.updatedAt),
    [D, f] = U8.useState(() => Date.now())
  N4(() => f(Date.now()), D - M < 60000 ? 1000 : 30000)
  let X = n9(Math.max(0, D - M), { mostSignificantOnly: !0 }),
    P = U8.useRef(!1),
    G = U8.useRef(null)
  TB(G, !0)
  let W = A.get(H.id) ?? '',
    [Z, L] = U8.useState(pR(W) === 'bash' ? 'bash' : 'prompt'),
    k = U8.useRef(Z),
    v = pH => {
      ;(k.current = pH), L(pH)
    },
    E = Z === 'bash',
    h =
      H.state.tempo === 'blocked' && !H.state.block?.questions
        ? H.state.suggestedReply
        : void 0,
    C = _9H(),
    I = M_(pH => pH.settings.voice?.mode ?? 'hold'),
    b = rq(),
    m = U8.useRef(null),
    S = U8.useRef('idle'),
    x = U8.useRef(!1)
  U8.useEffect(
    () => () => {
      m.current?.(), (m.current = null)
    },
    [],
  )
  let {
    query: U,
    queryRef: g,
    setQuery: Q,
    cursorOffset: l,
    setCursorOffset: d,
    handleKeyDown: r,
    handlePaste: a,
  } = EG({
    isActive: !0,
    multiline: !0,
    backspaceExitsOnEmpty: !1,
    initialQuery: Vh(W),
    onExit: () => {
      if (P.current) return
      let pH = g.current.trim()
      if (!pH && k.current === 'prompt') {
        ;(P.current = !0), T()
        return
      }
      if (!pH) return
      let gH = KcH(pH, k.current),
        eH = k.current
      ;(P.current = !0), Q(''), v('prompt'), j(null), A.delete(H.id)
      let H_ = () => {
        if (g.current === '') A.set(H.id, gH), Q(pH)
        if (k.current === 'prompt') v(eH)
      }
      z(gH)
        .then(
          $_ => {
            if ($_) H_(), j($_)
          },
          $_ => {
            H_(), j(LH($_))
          },
        )
        .finally(() => {
          P.current = !1
        })
    },
    onCancel: O,
    onSpaceOnEmpty: E
      ? void 0
      : C && I !== 'tap'
        ? () => {
            m.current?.(),
              (m.current = b.setTimeout(() => {
                if (((m.current = null), S.current !== 'idle' || x.current))
                  return
                if (g.current.trim() !== '') return
                O()
              }, Pj4))
          }
        : O,
    onTabOnEmpty:
      h && !E
        ? () => {
            Q(h),
              c('tengu_prompt_suggestion', {
                outcome: 'accepted',
                source: 'fleetview_peek',
              })
          }
        : void 0,
  })
  U8.useEffect(() => {
    let pH = KcH(U, Z)
    if (pH) A.set(H.id, pH)
    else A.delete(H.id)
  }, [U, Z, H.id, A])
  let s = U8.useRef(null)
  s.current = {
    cursorOffset: l,
    setInputWithCursor: (pH, gH) => {
      Q(pH), d(gH)
    },
    insert: () => {},
    submit: () => {},
  }
  let _H = sS6({
      setInputValueRaw: Q,
      inputValueRef: g,
      insertTextRef: s,
      enableDoubleTapSubmit: !1,
    }),
    HH = P0(pH => pH.voiceState),
    t = P0(pH => pH.voiceWarmingUp)
  ;(S.current = HH),
    (x.current = t),
    U8.useEffect(() => {
      if (HH !== 'idle' && m.current) m.current(), (m.current = null)
    }, [HH])
  let jH = M_(pH => pH.settings.prefersReducedMotion ?? !1),
    KH = HH === 'recording' && !jH,
    { handleKeyDown: qH } = tS6({
      voiceHandleKeyEvent: _H.handleKeyEvent,
      voiceCancelRecording: _H.cancelRecording,
      stripTrailing: _H.stripTrailing,
      resetAnchor: _H.resetAnchor,
      isActive: (I !== 'tap' || U.trim().length > 0) && !E && !J,
      inputValueRef: g,
    }),
    OH = Y.map(pH => pH.row.href),
    zH = pH =>
      OH.some(gH => {
        let eH = pH.indexOf(gH)
        return (
          eH >= 0 &&
          !/\w/.test(pH[eH + gH.length] ?? '') &&
          pH.length - gH.length < 16
        )
      }),
    $H = H.state.needs
      ? []
      : Object.entries(H.state.output ?? {}).filter(([, pH]) => !zH(pH)),
    TH = H.state.tempo === 'blocked' ? H.state.block?.questions : void 0,
    YH = TH ? 2 + (TH[0]?.options.length ?? 0) + 1 : 0,
    { rows: MH, columns: AH } = K8(),
    DH = 8,
    fH = U
      ? Q1(
          U,
          `
`,
        )
      : 0,
    GH = Math.ceil(
      Math.max(
        1,
        a_(sl(H.state.needs ?? '')),
        a_(sl(H.state.detail)),
        ...$H.map(([, pH]) => a_(sl(pH))),
      ) / Math.max(40, AH - 6),
    ),
    JH = k86()
      ? Math.min(
          GH,
          Math.max(
            ow4,
            MH - DH - Math.min(Y.length, rw4) - YH - fH - (w ? 1 : 0) - 1,
          ),
        )
      : ow4,
    RH =
      $H.length * JH +
      (TH ? YH : H.state.needs ? JH : 0) +
      fH +
      (w ? 1 : 0) +
      1,
    VH = Math.max(rw4, MH - DH - RH),
    NH = Y.slice(0, VH),
    dH = Y.length - NH.length,
    mH = Math.max(0, ...$H.map(([pH]) => a_(pH))),
    cH = Y.length > 0 || $H.length > 0 || !!H.state.needs,
    tH = 5,
    { color: K_ } = z1q(H.state, H.activity, _)
  return y_.createElement(
    y_.Fragment,
    null,
    y_.createElement(
      B,
      {
        ref: G,
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: E ? 'bashBorder' : void 0,
        borderDimColor: !E,
        paddingX: 1,
        minHeight: tH,
        width: '100%',
        tabIndex: 0,
        autoFocus: !0,
        onKeyDownCapture: qH,
        onKeyDown: pH => {
          if (pH.key !== ' ' && m.current) m.current(), (m.current = null)
          if (J) return
          if (k.current === 'prompt') {
            if (pH.key === 'right' && !pH.shift && !g.current) {
              if ((pH.preventDefault(), P.current)) return
              ;(P.current = !0), T()
              return
            }
            if (OJ_(pH.key) && !g.current) {
              pH.preventDefault(), v('bash')
              return
            }
            if (!g.current) {
              let gH = Qw4(pH.key, TH)
              if (gH) {
                pH.preventDefault(), Q(gH), d(gH.length)
                return
              }
            }
          } else if (pH.name === 'backspace' && !g.current) {
            pH.preventDefault(), v('prompt')
            return
          }
          r(pH)
        },
        onPaste: J ? void 0 : a,
      },
      !cH &&
        y_.createElement(
          B,
          { maxHeight: JH, overflowY: 'hidden' },
          y_.createElement(
            V,
            { wrap: 'wrap' },
            y_.createElement(V, { color: K_ }, X),
            ' ',
            sl(H.state.detail),
          ),
        ),
      NH.length > 0 &&
        y_.createElement(
          B,
          { flexDirection: 'column' },
          NH.map(pH =>
            y_.createElement(
              B,
              { key: pH.row.href },
              y_.createElement(
                B,
                { flexGrow: 1, width: 0 },
                y_.createElement(
                  V,
                  { wrap: 'truncate' },
                  pH.prNumber !== void 0
                    ? y_.createElement(LEH, {
                        number: pH.prNumber,
                        url: pH.row.href,
                        color: pH.color,
                        underline: !1,
                      })
                    : y_.createElement(
                        V,
                        { color: pH.color, dimColor: !WE_(pH) },
                        WE_(pH) ? x$H : 'PR',
                      ),
                  pH.label
                    ? y_.createElement(
                        y_.Fragment,
                        null,
                        ' ',
                        y_.createElement(G9, { url: pH.row.href }, pH.label),
                      )
                    : null,
                ),
              ),
              pH.diffStat &&
                pH.diffStat.additions + pH.diffStat.deletions > 0 &&
                y_.createElement(
                  B,
                  { flexShrink: 0, paddingLeft: 1 },
                  y_.createElement(
                    G9,
                    { url: `${pH.row.href}/files` },
                    y_.createElement(EB, {
                      added: pH.diffStat.additions,
                      removed: pH.diffStat.deletions,
                    }),
                  ),
                ),
              y_.createElement(
                B,
                { flexShrink: 0, paddingLeft: 1 },
                pH.status.map((gH, eH) =>
                  y_.createElement(
                    y_.Fragment,
                    { key: eH },
                    eH > 0 && y_.createElement(V, null, ' '),
                    y_.createElement(
                      V,
                      { color: gH.color, dimColor: !gH.color },
                      gH.text,
                    ),
                  ),
                ),
              ),
            ),
          ),
          dH > 0 &&
            y_.createElement(
              B,
              { paddingLeft: 2 },
              y_.createElement(V, { dimColor: !0 }, '\u2026 ', dH, ' more'),
            ),
        ),
      $H.length > 0 &&
        y_.createElement(
          B,
          { flexDirection: 'column', marginTop: NH.length > 0 ? 1 : 0 },
          $H.map(([pH, gH]) =>
            y_.createElement(
              B,
              { key: pH },
              $H.length > 1 &&
                y_.createElement(
                  B,
                  { width: mH + 2, flexShrink: 0 },
                  y_.createElement(V, { dimColor: !0 }, pH),
                ),
              y_.createElement(
                B,
                { flexGrow: 1, width: 0, maxHeight: JH, overflowY: 'hidden' },
                y_.createElement(
                  V,
                  { wrap: 'wrap' },
                  y_.createElement(V, { color: K_ }, X),
                  ' ',
                  y_.createElement(sw4, { value: sl(gH) }),
                ),
              ),
            ),
          ),
        ),
      TH
        ? y_.createElement(
            B,
            { marginTop: Y.length > 0 ? 1 : 0 },
            y_.createElement(gw4, { questions: TH, ageLabel: X, ageColor: K_ }),
          )
        : H.state.needs
          ? y_.createElement(
              B,
              {
                marginTop: Y.length > 0 ? 1 : 0,
                maxHeight: JH,
                overflowY: 'hidden',
              },
              y_.createElement(
                V,
                { wrap: 'wrap' },
                y_.createElement(V, { color: K_ }, X),
                ' ',
                y_.createElement(sw4, { value: sl(H.state.needs) }),
              ),
            )
          : null,
      y_.createElement(B, { flexGrow: 1 }),
      y_.createElement(
        B,
        { marginTop: 1 },
        y_.createElement(lv, {
          query: U,
          cursorOffset: l,
          onCursorOffsetChange: d,
          placeholder:
            C && (HH !== 'idle' || t)
              ? ''
              : TH
                ? `press 1-${TH[0]?.options.length ?? 2} or type your answer`
                : h && !E
                  ? h
                  : 'reply',
          prefix: E ? '!' : __.pointer,
          prefixColor: E ? 'bashBorder' : void 0,
          prefixDim: !U.trim(),
          dimRange: _H.interimRange
            ? [_H.interimRange.start, _H.interimRange.end]
            : void 0,
          cursorChar: KH ? y_.createElement(Nj4, null) : void 0,
          isFocused: !J,
          isTerminalFocused: $,
          width: '100%',
          borderless: !0,
        }),
      ),
      w &&
        y_.createElement(
          V,
          { color: 'error', dimColor: !0, wrap: 'truncate' },
          w,
        ),
    ),
    y_.createElement(
      B,
      { paddingLeft: 2 },
      C && t && !J
        ? y_.createElement(Dq_, null)
        : C && HH !== 'idle' && !J
          ? y_.createElement(PE6, { voiceState: HH })
          : y_.createElement(
              V,
              { dimColor: !0 },
              J
                ? y_.createElement(
                    Y6,
                    null,
                    y_.createElement(z_, {
                      chord: 'enter',
                      action: 'save',
                      format: { keyCase: 'lower' },
                    }),
                    y_.createElement(z_, {
                      chord: 'escape',
                      action: 'cancel',
                      format: { keyCase: 'lower' },
                    }),
                  )
                : y_.createElement(
                    Y6,
                    null,
                    E &&
                      y_.createElement(
                        V,
                        { color: 'bashBorder' },
                        '! for shell mode',
                      ),
                    (U.trim() || (!E && !q)) &&
                      y_.createElement(z_, {
                        chord: 'enter',
                        action: U.trim()
                          ? 'send'
                          : K1q(H.state)
                            ? 'resume'
                            : 'open',
                        format: { keyCase: 'lower' },
                      }),
                    y_.createElement(z_, {
                      chord: U.trim() || E ? 'escape' : ' ',
                      action: 'close',
                      format: { keyCase: 'lower' },
                    }),
                    C && I !== 'tap' && !E && !U.trim()
                      ? y_.createElement(V, null, 'hold space to speak')
                      : null,
                    y_.createElement(z_, {
                      chord: 'ctrl+x',
                      action: K ? 'confirm' : 'delete',
                    }),
                  ),
            ),
    ),
  )
}
function bhO(H, _, q) {
  let K = H.slice(_, _ + 1) || ' ',
    O = H.slice(_ + 1),
    T = kn(H.slice(0, _), q - a_(K) - (O ? 1 : 0))
  return y_.createElement(
    y_.Fragment,
    null,
    y_.createElement(V, null, T),
    y_.createElement(V, { inverse: !0 }, K),
    y_.createElement(V, null, O),
  )
}
function xhO(H) {
  let _ = uTH.c(76),
    {
      job: q,
      isFocused: K,
      isOrigin: O,
      logTail: T,
      status: z,
      cols: $,
      loopKickCount: Y,
      age: A,
      childRows: w,
      renaming: j,
      deleteArmed: J,
      attaching: M,
    } = H,
    D,
    f,
    X,
    P
  if (
    _[0] !== M ||
    _[1] !== w ||
    _[2] !== J?.justKilled ||
    _[3] !== q.activity ||
    _[4] !== q.state ||
    _[5] !== z
  ) {
    X = QkH(q.state.state)
    let TH, YH, MH
    if (_[10] !== w || _[11] !== q.activity || _[12] !== q.state || _[13] !== z)
      ({ color: YH, dim: MH } = z1q(q.state, q.activity, z)),
        (TH = z === 'busy' ? YH : fj4(YH, w)),
        (_[10] = w),
        (_[11] = q.activity),
        (_[12] = q.state),
        (_[13] = z),
        (_[14] = TH),
        (_[15] = YH),
        (_[16] = MH)
    else (TH = _[14]), (YH = _[15]), (MH = _[16])
    ;(D = TH),
      (f = D === YH && MH),
      (P = M ? void 0 : J?.justKilled ? D3_ : kj4(q.state, X, z)),
      (_[0] = M),
      (_[1] = w),
      (_[2] = J?.justKilled),
      (_[3] = q.activity),
      (_[4] = q.state),
      (_[5] = z),
      (_[6] = D),
      (_[7] = f),
      (_[8] = X),
      (_[9] = P)
  } else (D = _[6]), (f = _[7]), (X = _[8]), (P = _[9])
  let G = P,
    W = q.state.output?.result,
    Z
  if (_[17] !== W) (Z = W ? NhO(W) : null), (_[17] = W), (_[18] = Z)
  else Z = _[18]
  let L = Z,
    k = L ? void 0 : W,
    v = X !== 'success' ? T || void 0 : void 0,
    E =
      O && K
        ? q.state.tempo === 'blocked'
          ? q.state.needs
          : X === 'failure'
            ? q.state.detail
            : void 0
        : void 0,
    h
  if (
    _[19] !== K ||
    _[20] !== O ||
    _[21] !== q.state ||
    _[22] !== v ||
    _[23] !== E ||
    _[24] !== X ||
    _[25] !== k
  )
    (h =
      O && K
        ? E
          ? `${sl(E)} \xB7 ${__.arrowRight}`
          : Z1H(q.state) && q.state.detail
            ? `${sl(q.state.detail)} \xB7 ${__.arrowRight} to return`
            : `${__.arrowRight} to return`
        : X === 'success'
          ? sl(k || q.state.detail)
          : (q.state.tempo === 'active' && sl(v ?? '')) ||
            sl(
              (q.state.tempo === 'blocked' && q.state.needs) || q.state.detail,
            )),
      (_[19] = K),
      (_[20] = O),
      (_[21] = q.state),
      (_[22] = v),
      (_[23] = E),
      (_[24] = X),
      (_[25] = k),
      (_[26] = h)
  else h = _[26]
  let C = h,
    I
  if (_[27] !== O || _[28] !== q.state)
    (I = DC6(q.state, O)), (_[27] = O), (_[28] = q.state), (_[29] = I)
  else I = _[29]
  let b = I,
    m = bR8(q.state.color) ? MW[q.state.color] : void 0,
    S = ThO(b, !!q.state.name),
    x,
    U,
    g
  if (_[30] !== w)
    (x = w.filter(WE_)),
      (U = w.filter(mhO)),
      (g = U.find(uhO) ?? U.at(-1) ?? x.at(-1)),
      (_[30] = w),
      (_[31] = x),
      (_[32] = U),
      (_[33] = g)
  else (x = _[31]), (U = _[32]), (g = _[33])
  let Q = g,
    l = $.label + 2,
    d = !K,
    r = f || (D === void 0 && !K),
    a
  if (_[34] !== G)
    (a = G ?? y_.createElement(LhO, null)), (_[34] = G), (_[35] = a)
  else a = _[35]
  let s
  if (_[36] !== D || _[37] !== r || _[38] !== a)
    (s = y_.createElement(V, { color: D, dimColor: r }, a)),
      (_[36] = D),
      (_[37] = r),
      (_[38] = a),
      (_[39] = s)
  else s = _[39]
  let _H
  if (
    _[40] !== $.label ||
    _[41] !== L ||
    _[42] !== K ||
    _[43] !== b ||
    _[44] !== j ||
    _[45] !== S ||
    _[46] !== m
  )
    (_H =
      m && !j
        ? y_.createElement(
            yj,
            { color: m, bold: K, padded: !0 },
            L ? y_.createElement(G9, { url: L }, b) : b,
          )
        : j
          ? bhO(j.draft, j.cursor, $.label)
          : S
            ? y_.createElement(
                y_.Fragment,
                null,
                y_.createElement(
                  V,
                  { dimColor: !K },
                  S.display.slice(0, S.newLen),
                ),
                y_.createElement(
                  V,
                  { dimColor: !0 },
                  S.display.slice(S.newLen),
                ),
              )
            : L
              ? y_.createElement(G9, { url: L }, b)
              : b),
      (_[40] = $.label),
      (_[41] = L),
      (_[42] = K),
      (_[43] = b),
      (_[44] = j),
      (_[45] = S),
      (_[46] = m),
      (_[47] = _H)
  else _H = _[47]
  let HH
  if (_[48] !== s || _[49] !== _H || _[50] !== d)
    (HH = y_.createElement(V, { dimColor: d, wrap: 'truncate' }, s, ' ', _H)),
      (_[48] = s),
      (_[49] = _H),
      (_[50] = d),
      (_[51] = HH)
  else HH = _[51]
  let t
  if (_[52] !== HH || _[53] !== l)
    (t = y_.createElement(B, { width: l, flexShrink: 0 }, HH)),
      (_[52] = HH),
      (_[53] = l),
      (_[54] = t)
  else t = _[54]
  let jH
  if (_[55] !== M || _[56] !== J || _[57] !== Y || _[58] !== C)
    (jH = y_.createElement(
      B,
      { flexGrow: 1, width: 0, paddingLeft: 2 },
      M
        ? y_.createElement(
            V,
            { dimColor: !0, wrap: 'truncate' },
            'opening\u2026',
          )
        : J
          ? y_.createElement(
              V,
              { color: 'error', wrap: 'truncate' },
              J.justKilled
                ? 'stopped \xB7 ctrl+x again to delete'
                : 'ctrl+x again to delete',
            )
          : y_.createElement(
              V,
              { dimColor: !0, wrap: 'truncate' },
              C,
              Y !== void 0 && Y > 0 ? ` \xD7${Y}` : '',
            ),
    )),
      (_[55] = M),
      (_[56] = J),
      (_[57] = Y),
      (_[58] = C),
      (_[59] = jH)
  else jH = _[59]
  let KH
  if (
    _[60] !== Q ||
    _[61] !== $.artifact ||
    _[62] !== x ||
    _[63] !== K ||
    _[64] !== U
  )
    (KH =
      $.artifact > 0
        ? y_.createElement(
            B,
            { width: $.artifact + 2, flexShrink: 0, paddingLeft: 2 },
            U.length > 1
              ? y_.createElement(
                  V,
                  null,
                  y_.createElement(
                    V,
                    { color: Q?.color, dimColor: !K || !Q?.color },
                    U.length,
                  ),
                  y_.createElement(V, { dimColor: !0 }, ' PRs'),
                )
              : U.length === 1
                ? Q?.prNumber !== void 0
                  ? y_.createElement(LEH, {
                      number: Q.prNumber,
                      url: Q.row.href,
                      color: Q.color,
                      dimColor: !K,
                      underline: !1,
                    })
                  : y_.createElement(V, { dimColor: !K }, 'PR')
                : Q
                  ? y_.createElement(
                      G9,
                      { url: Q.row.href },
                      y_.createElement(
                        V,
                        { color: 'claude' },
                        x.length > 1 && `${x.length} `,
                        x$H,
                      ),
                    )
                  : null,
          )
        : null),
      (_[60] = Q),
      (_[61] = $.artifact),
      (_[62] = x),
      (_[63] = K),
      (_[64] = U),
      (_[65] = KH)
  else KH = _[65]
  let qH = $.age + 2,
    OH
  if (_[66] !== A)
    (OH = y_.createElement(V, { dimColor: !0 }, A)), (_[66] = A), (_[67] = OH)
  else OH = _[67]
  let zH
  if (_[68] !== qH || _[69] !== OH)
    (zH = y_.createElement(
      B,
      { width: qH, flexShrink: 0, paddingLeft: 2, justifyContent: 'flex-end' },
      OH,
    )),
      (_[68] = qH),
      (_[69] = OH),
      (_[70] = zH)
  else zH = _[70]
  let $H
  if (_[71] !== t || _[72] !== jH || _[73] !== KH || _[74] !== zH)
    ($H = y_.createElement(B, null, t, jH, KH, zH)),
      (_[71] = t),
      (_[72] = jH),
      (_[73] = KH),
      (_[74] = zH),
      (_[75] = $H)
  else $H = _[75]
  return $H
}
function uhO(H) {
  return H.color !== void 0
}
function mhO(H) {
  return !WE_(H)
}
function Vj4({
  onAction: H,
  initialJobId: _,
  enteredViaLeftArrow: q,
  initialQuery: K,
  initialCollapsed: O,
  initialError: T,
  initialGroupMode: z,
  cwdFilter: $,
  dispatchDefaults: Y,
}) {
  let A = rq(),
    [w, j] = U8.useState(O1q),
    J = U8.useRef(null)
  J.current = w
  let [M, D] = U8.useState([]),
    [f, X] = U8.useState({}),
    [P, G] = U8.useState(() => t4q),
    W = U8.useRef(P)
  ;(W.current = P),
    U8.useEffect(() => {
      if (t4q.size) return
      UR7().then(Z_ => {
        if (Z_.size)
          (W.current = Z_), G(l6 => (l6.size ? new Map([...Z_, ...l6]) : Z_))
      })
    }, []),
    U8.useEffect(() => {
      BR7(P)
    }, [P])
  let Z = U8.useRef(0),
    [L, k] = U8.useState(() => new Map(wj4)),
    v = U8.useRef(L)
  v.current = L
  let E = S_(),
    h = _1q({ cwd: E }),
    [C, I] = U8.useState(E)
  U8.useEffect(() => {
    let Z_ = !1
    return (
      x$(E).then(l6 => {
        if (!Z_ && l6 !== E) I(l6)
      }),
      () => {
        Z_ = !0
      }
    )
  }, [E])
  let b = $ && !zC6({ cwd: C }, $) ? $ : C,
    [m, S] = U8.useState(() => new Map(e4q)),
    [x, U] = U8.useState(E),
    [g, Q] = U8.useState(() => $C6.get(E) ?? {})
  U8.useEffect(() => {
    if ($C6.has(E)) return
    let Z_ = !1
    return (
      MtK(E).then(l6 => {
        if (($C6.set(E, l6), !Z_ && Object.keys(l6).length > 0)) Q(l6)
      }),
      () => {
        Z_ = !0
      }
    )
  }, [E])
  let l = sq([...(w ?? []), ...M].map(Z_ => ZE_(Z_.state)))
      .sort()
      .join('\x00'),
    d = U8.useMemo(() => {
      let Z_ = { ...g }
      for (let l6 of l ? l.split('\x00') : []) {
        let U6 = Bs.basename(l6)
        if (U6 && !/\s/.test(U6) && Z_[U6] === void 0) Z_[U6] = l6
      }
      return Z_
    }, [g, l]),
    [r, a] = U8.useState(() => new Map(H1q)),
    [s, _H] = U8.useState(() => new Map(Dj4)),
    [HH, t] = U8.useState(0),
    [jH, KH] = U8.useState(null),
    [qH, OH] = U8.useState(!1),
    zH = U8.useRef(new Map()),
    [$H, TH] = U8.useState(null),
    [YH, MH] = U8.useState(!1),
    [AH, DH] = U8.useState(!1),
    [fH, GH] = U8.useState(!1),
    JH = () => H({ type: 'done' }),
    [RH, VH] = U8.useState(!1),
    NH = fC(VH, JH),
    [dH, mH] = U8.useState(null),
    [cH, tH] = U8.useState(null),
    K_ = U8.useRef(cH)
  K_.current = cH
  let pH = U8.useRef(null),
    gH = U8.useRef(null),
    eH = () => {
      mH(null), qA(''), (pH.current = null), (gH.current = null)
    },
    [H_, $_] = U8.useState(() => z ?? b_().fleetViewGroupMode ?? 'state'),
    oH = U8.useRef(H_)
  oH.current = H_
  let [E_, w_] = U8.useState(() => new Set(O)),
    O_ = U8.useRef(E_)
  O_.current = E_
  let [v_, I_] = U8.useState(() => new Set()),
    V_ = Z_ =>
      w_(l6 => {
        let U6 = new Set(l6)
        if (U6.has(Z_)) U6.delete(Z_)
        else
          U6.add(Z_),
            I_(f8 =>
              f8.has(Z_) ? new Set([...f8].filter(pq => pq !== Z_)) : f8,
            )
        return U6
      }),
    sH = U8.useRef(null),
    R_ = U8.useRef(null),
    u_ = U8.useRef(void 0),
    Q_ = p$()
  U8.useEffect(() => {
    if (Q_) Z.current = 0
  }, [Q_])
  let r_ = M_(Z_ => Z_.autoUpdaterResult?.status === 'success'),
    { columns: w6, rows: t_ } = K8(),
    s_ = Yj4(t_),
    BH = U8.useRef(Date.now()),
    o = U8.useRef(!1),
    XH = w6 >= 120 ? 1 : 0,
    kH = U8.useRef(null),
    QH = U8.useRef(null),
    bH = U8.useRef(null)
  TB(bH, w !== null && !qH)
  let EH = _9H(),
    IH = M_(Z_ => Z_.settings.voice?.mode ?? 'hold'),
    UH = U8.useRef(null),
    j_ = U8.useRef('idle'),
    P_ = U8.useRef(!1)
  U8.useEffect(
    () => () => {
      UH.current?.(), (UH.current = null)
    },
    [],
  )
  let M6 = () => {
      if (!u_.current) return
      a6(!1),
        OH(Z_ => {
          if (!Z_ && u_.current) sH.current = u_.current.id
          return !Z_
        })
    },
    [D6, Y8] = U8.useState(() =>
      J2H() && K?.startsWith('!') ? 'bash' : 'prompt',
    ),
    m6 = U8.useRef(D6),
    L8 = Z_ => {
      ;(m6.current = Z_), Y8(Z_)
    },
    {
      query: G6,
      queryRef: p8,
      setQuery: yq,
      cursorOffset: Z6,
      setCursorOffset: j6,
      handleKeyDown: E8,
      handlePaste: g6,
    } = EG({
      initialQuery: J2H() && K?.startsWith('!') ? K.slice(1) : K,
      isActive: !qH && dH === null && cH === null,
      multiline: !0,
      onExit: () => {},
      onCancel: w === null ? NH : void 0,
      onSpaceOnEmpty: () => {
        if (m6.current === 'bash') return
        if (EH && IH !== 'tap')
          UH.current?.(),
            (UH.current = A.setTimeout(() => {
              if (((UH.current = null), j_.current !== 'idle' || P_.current))
                return
              if (p8.current.trim() !== '') return
              M6()
            }, Pj4))
        else M6()
      },
    }),
    Fq = U8.useRef({}),
    h7 = U8.useRef(1),
    $4 = U8.useRef(null)
  $4.current = {
    cursorOffset: Z6,
    setInputWithCursor: (Z_, l6) => {
      yq(Z_), j6(l6)
    },
    insert: () => {},
    submit: () => {},
  }
  let u5 = sS6({
      setInputValueRaw: yq,
      inputValueRef: p8,
      insertTextRef: $4,
      enableDoubleTapSubmit: !1,
      isActive: !qH && dH === null && cH === null,
    }),
    Tq = P0(Z_ => Z_.voiceState),
    M3 = P0(Z_ => Z_.voiceWarmingUp)
  ;(j_.current = Tq),
    (P_.current = M3),
    U8.useEffect(() => {
      if (Tq !== 'idle' && UH.current) UH.current(), (UH.current = null)
    }, [Tq])
  let { handleKeyDown: E7 } = tS6({
      voiceHandleKeyEvent: u5.handleKeyEvent,
      voiceCancelRecording: u5.cancelRecording,
      stripTrailing: u5.stripTrailing,
      resetAnchor: u5.resetAnchor,
      isActive:
        (IH !== 'tap' || G6.trim().length > 0) &&
        D6 !== 'bash' &&
        !qH &&
        dH === null &&
        cH === null,
      inputValueRef: p8,
    }),
    kK = M_(Z_ => Z_.settings.prefersReducedMotion ?? !1),
    uA = Tq === 'recording' && !kK
  U8.useEffect(() => {
    if (Tq !== 'recording') et9()
  }, [Tq])
  let $5 = () => (m6.current === 'bash' ? `!${p8.current}` : p8.current)
  VO(
    () => {
      let Z_ = $5(),
        l6 = [...O_.current]
      Z_ || l6.length ? DS6(C, { q: Z_, collapsed: l6 }) : K34(C)
    },
    300,
    [G6, D6, E_, C],
  ),
    U8.useEffect(
      () =>
        en(() => {
          let Z_ = $5(),
            l6 = [...O_.current]
          if (Z_ || l6.length) q34(C, { q: Z_, collapsed: l6 })
        }),
      [C, p8],
    )
  let [mO, b3] = U8.useState(T ?? null),
    {
      query: pj,
      queryRef: qj,
      setQuery: qA,
      cursorOffset: r4,
      handleKeyDown: $1,
      handlePaste: az,
    } = EG({
      isActive: dH !== null,
      backspaceExitsOnEmpty: !1,
      onExit: () => {
        let Z_ = pH.current,
          l6 = gH.current,
          U6 = qj.current.trim()
        if ((eH(), !Z_ || !U6)) return
        if (l6) {
          D(f8 =>
            f8.map(pq =>
              pq.id !== Z_
                ? pq
                : {
                    ...pq,
                    state: {
                      ...pq.state,
                      name: U6,
                      intent: U6,
                      updatedAt: new Date().toISOString(),
                    },
                  },
            ),
          ),
            Zp8(l6, { action: 'rename', name: U6 })
              .then(() => {
                SH('fleet_view_rename_job')
              })
              .catch(f8 => {
                N(`[fleetview] peer rename failed: ${f8}`),
                  uH('fleet_view_rename_job', 'peer_uds_failed'),
                  b3("Couldn't rename \u2014 that session isn't responding"),
                  D(pq =>
                    pq.map(I9 =>
                      I9.id === Z_ && I9.state.name === U6
                        ? {
                            ...I9,
                            state: {
                              ...I9.state,
                              updatedAt: new Date(0).toISOString(),
                            },
                          }
                        : I9,
                    ),
                  )
              })
          return
        }
        ;(m5.current = ++o5.current),
          j(f8 =>
            f8
              ? f8.map(pq =>
                  pq.id === Z_
                    ? { ...pq, state: { ...pq.state, name: U6 } }
                    : pq,
                )
              : f8,
          ),
          NjH(Z_, U6, 'user').then(f8 => {
            if (f8) {
              SH('fleet_view_rename_job')
              return
            }
            b3(
              "Couldn't rename \u2014 the job may have been removed or its state file is unwritable.",
            ),
              uH('fleet_view_rename_job', 'sync_name_failed'),
              j(pq =>
                pq
                  ? pq.map(I9 =>
                      I9.id === Z_ && I9.state.name === U6
                        ? { ...I9, state: { ...I9.state, name: void 0 } }
                        : I9,
                    )
                  : pq,
              )
          })
      },
      onCancel: eH,
    }),
    V$ = m.get(E) ?? tw4,
    _1 = Y1q(G6, d, V$),
    GO = _1 ?? x,
    sz = m.get(GO) ?? tw4,
    _z = U8.useMemo(() => ShO(sz, V$), [sz, V$]),
    dK = r.get(GO) ?? r.get(E) ?? ew4,
    t$ = s.get(GO) ?? s.get(E) ?? ew4,
    VJ = D6 === 'bash' ? null : PE_(G6),
    NJ = VJ ? AC6(VJ) : void 0,
    vT = VJ || /\s/.test(G6.trim()) ? null : lIH(G6.trim()),
    WK = Z_ => !$ || zC6(Z_.state, $),
    e$ = VJ
      ? (w ?? []).find(Z_ => WK(Z_) && r4q(Z_.state, VJ, NJ))?.id
      : vT
        ? (w ?? []).find(Z_ => WK(Z_) && o4q(Z_.state, vT))?.id
        : void 0,
    b1 = U8.useMemo(
      () => (e$ ? null : a4q(D6 === 'bash' ? `!${G6}` : G6, _z, d, t$)),
      [D6, e$, G6, _z, d, t$],
    ),
    yT = D6 === 'bash' || b1?.exec !== void 0,
    N$ = !!(b1?.intent || b1?.routine || b1?.matched),
    x3 = !!(
      b1 &&
      (b1.intent ||
        b1.routine ||
        b1.matched ||
        b1.cwd !== void 0 ||
        b1.exec !== void 0)
    ),
    qz = U8.useRef(b1)
  qz.current = b1
  let [u3, n] = U8.useState([]),
    [WH, aH] = U8.useState(null),
    Y_ = U8.useCallback(
      Z_ => {
        c('tengu_bg_agent_action', { action: `fleetview_update_${Z_}` }),
          Jv6()
            .then(l6 => {
              if (Z_ === 'auto' && Date.now() - JZ() < OC6) return
              return cPH({
                launcher: l6,
                args: ['agents', ...($ ? ['--cwd', $] : []), ...XtK()],
                env: {
                  [Xw_]: '1',
                  ...(Z_ === 'auto' && { [n4q]: String(Date.now()) }),
                },
                preSpawn: () =>
                  process.stdout.write(
                    D_.dim(`
Switching from ${{ ISSUES_EXPLAINER: 'report the issue at https://github.com/anthropics/claude-code/issues', PACKAGE_URL: '@anthropic-ai/claude-code', README_URL: 'https://code.claude.com/docs/en/overview', VERSION: '2.1.153', FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues', BUILD_TIME: '2026-05-27T20:03:21Z', GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2' }.VERSION} to latest\u2026

`),
                  ),
              })
            })
            .catch(l6 => {
              if ((hH(l6), Z_ === 'manual'))
                b3(`Couldn't switch to the latest build \u2014 ${LH(l6)}`)
            })
      },
      [$],
    )
  N4(
    () => {
      let Z_ = Number(process.env[n4q]) || 0
      if (Date.now() - Z_ < Tj4) return
      if (Date.now() - JZ() < OC6) return
      Y_('auto')
    },
    r_ && !Q_ ? OC6 : null,
  )
  let [l_, a6] = U8.useState(!1),
    [j8, Eq] = U8.useState(0),
    [Sq, S7] = U8.useState(null)
  U8.useEffect(() => {
    if (G6) a6(!1)
  }, [G6]),
    U8.useEffect(() => {
      Eq(0)
    }, [G6, l_, GO])
  let [z6, Mq] = U8.useReducer(Z_ => Z_ + 1, 0),
    f9 = U8.useMemo(
      () => ChO(G6, _z, t$, d, dK, b1, l_),
      [G6, _z, t$, d, dK, b1, l_, z6],
    ),
    {
      firstWord: M9,
      isSlashQuery: X9,
      atMatch: J1,
      slashMatch: D3,
      templateNames: Y4,
      repoNames: _4,
      suggestions: HK,
    } = f9,
    z3 = Z_ => {
      S7(null)
      let l6 = Z_.kind === 'skill' ? '/' : '@'
      yq(J1 || D3 ? hhO(G6, l6, Z_.name) : `${l6}${Z_.name} `)
    },
    q4 = () =>
      (Sq ? HK.find(Z_ => `${Z_.kind}:${Z_.name}` === Sq) : void 0) ??
      HK[Math.min(j8, HK.length - 1)],
    Y5 = U8.useRef(!1),
    r3 = U8.useRef(new Set()),
    yY = U8.useRef(new Map()),
    pO = Z_ => {
      return (
        (m5.current = ++o5.current),
        yY.current.set(Z_, (yY.current.get(Z_) ?? 0) + 1),
        () => {
          m5.current = ++o5.current
          let l6 = (yY.current.get(Z_) ?? 1) - 1
          if (l6 <= 0) yY.current.delete(Z_)
          else yY.current.set(Z_, l6)
        }
      )
    },
    [tz, KT] = U8.useState(null),
    Aw = U8.useRef(null),
    KA = (Z_, l6 = !1, U6, f8) => {
      let pq =
        Z_ === null ? null : { id: Z_, justKilled: l6, group: U6, sortKey: f8 }
      ;(Aw.current = pq), KT(pq)
    }
  VO(() => KA(null), tz ? 2000 : null, [tz])
  let o5 = U8.useRef(0),
    m5 = U8.useRef(0),
    ez = U8.useCallback(async () => {
      let Z_ = ++o5.current,
        [l6, U6] = await Promise.all([W1H(), ztK()]),
        f8 = rf8(hH7(l6, U6.records), U6.shorts)
          .filter(o3 => !r3.current.has(o3.id))
          .map(o3 => ({ ...o3, activity: YC6(o3.state, W.current) }))
      if (Z_ <= m5.current) return
      ;(m5.current = Z_),
        j(o3 => {
          let L5 =
              o3 && yY.current.size > 0
                ? new Map(
                    o3
                      .filter(w5 => yY.current.has(w5.id))
                      .map(w5 => [w5.id, w5]),
                  )
                : null,
            aK = XE_(L5 ? f8.map(w5 => L5.get(w5.id) ?? w5) : f8)
          if (
            o3 &&
            o3.length === aK.length &&
            o3.every(
              (w5, p3) =>
                w5.id === aK[p3].id &&
                w5.state.updatedAt === aK[p3].state.updatedAt &&
                w5.state.state === aK[p3].state.state &&
                w5.state.pinned === aK[p3].state.pinned &&
                w5.activity === aK[p3].activity,
            )
          )
            return o3
          return aK
        })
      let pq = f8.filter(o3 => g2H(o3.state) !== 'completed'),
        I9 = await Promise.all(pq.map(async o3 => [o3.id, await VhO(o3)]))
      X(o3 => {
        let L5 = Object.fromEntries(I9),
          aK = Object.keys(o3)
        if (aK.length === I9.length && aK.every(w5 => o3[w5] === L5[w5]))
          return o3
        return L5
      })
      let v9 = f8.filter(o3 => GE_(o3.state))
      if (v9.length > 0) {
        let L5 = (
          await Promise.all(
            v9.map(async aK => {
              let w5 = Lj4(aK.state)
              try {
                let p3 = await Kj4.stat(w5)
                return [aK.state.sessionId, p3.mtimeMs, w5]
              } catch {
                return null
              }
            }),
          )
        )
          .filter(aK => aK !== null)
          .filter(([aK, w5]) => {
            let p3 = v.current.get(aK)
            return !p3 || p3.mtimeMs !== w5
          })
        if (L5.length > 0) {
          let aK = await Promise.all(
            L5.map(async ([w5, p3, vJ]) => {
              try {
                let OA = await khO(vJ)
                return [w5, { mtimeMs: p3, ...OA }]
              } catch {
                return null
              }
            }),
          )
          k(w5 => {
            let p3 = !1,
              vJ = new Map(w5)
            for (let OA of aK) if (OA) vJ.set(OA[0], OA[1]), (p3 = !0)
            return p3 ? vJ : w5
          })
        }
      }
      let q1 = sq(
          f8.flatMap(
            o3 =>
              o3.state.children
                ?.filter(L5 => L5.kind !== 'frame')
                .map(L5 => L5.href) ?? [],
          ),
        ),
        Kz = q1.filter(o3 => {
          let L5 = W.current.get(o3)?.state
          return L5 !== 'MERGED' && L5 !== 'CLOSED'
        }),
        y$ = Date.now(),
        h2 = y$ - Z.current >= uw4(mQH(), y$ - JZ())
      if (Kz.length > 0 && h2) {
        Z.current = y$
        let o3 = G_('tengu_fleetview_pr_batch', !0)
        ;(async () => {
          let L5
          if (o3) {
            let aK = await mR7(Kz)
            ;(L5 = aK.statuses),
              await Promise.all(
                aK.unbatched.map(async w5 => L5.set(w5, await sk8(w5))),
              )
          } else
            L5 = new Map(
              await Promise.all(Kz.map(async aK => [aK, await sk8(aK)])),
            )
          G(aK => {
            let w5 = !1
            for (let [vJ, OA] of L5) {
              let bD = aK.get(vJ)
              if (
                bD?.state !== OA?.state ||
                bD?.title !== OA?.title ||
                bD?.review !== OA?.review ||
                bD?.checks.passed !== OA?.checks.passed ||
                bD?.checks.failed !== OA?.checks.failed ||
                bD?.checks.pending !== OA?.checks.pending ||
                bD?.additions !== OA?.additions ||
                bD?.deletions !== OA?.deletions
              ) {
                w5 = !0
                break
              }
            }
            if (!w5) return aK
            let p3 = new Map(aK)
            for (let [vJ, OA] of L5)
              if (OA !== null || !aK.has(vJ)) p3.set(vJ, OA)
            return p3
          })
        })()
      }
      if (m5.current === Z_) {
        let o3 = new Set(f8.map(aK => aK.state.sessionId)),
          L5 = new Set(q1)
        k(aK => i4q(aK, o3)), G(aK => i4q(aK, L5))
      }
    }, []),
    t9 = U8.useMemo(
      () =>
        JhO(
          () => void ez(),
          Z_ => {
            sH.current = Z_
          },
          (Z_, l6, U6) => {
            if (((m5.current = ++o5.current), l6)) r3.current.add(l6)
            let f8 = U6 ? pO(U6) : void 0
            return (
              j(pq => (pq ? Z_(pq) : pq)),
              l6 || f8
                ? () => {
                    if (l6) (m5.current = ++o5.current), r3.current.delete(l6)
                    f8?.()
                  }
                : void 0
            )
          },
        ),
      [ez],
    )
  U8.useEffect(() => {
    N('[PERF:bg-remount-end]'), SH('screen_fleet_view')
  }, []),
    U8.useEffect(() => () => void f$9(), [])
  let A5 = U8.useRef(null)
  U8.useEffect(() => () => A5.current?.(), []), N4(ez, 2000)
  let [v$, gW] = U8.useState(() => jj4),
    OZ = U8.useRef(v$)
  OZ.current = v$
  let NL = U8.useRef(Jj4)
  N4(() => {
    dhH()
      .then(Z_ => {
        let l6 = new Map(
          Z_.filter(f8 => f8.sessionId && f8.status).map(f8 => [
            f8.sessionId,
            f8.status,
          ]),
        )
        for (let f8 of l6.keys()) N2.current.delete(f8)
        let U6 = s6q()
        if (U6 && Z_.some(f8 => f8.sessionId === U6.sessionId))
          WtK(U6.sessionId)
        for (let f8 of iX.current)
          if (l6.get(f8) === 'busy') iX.current.delete(f8)
        gW(f8 =>
          f8.size === l6.size && [...l6].every(([pq, I9]) => f8.get(pq) === I9)
            ? f8
            : l6,
        ),
          (NL.current = Date.now())
      })
      .catch(() => {})
  }, 500)
  let N2 = U8.useRef(new Set()),
    iX = U8.useRef(new Set()),
    TZ = U8.useRef(new Map()),
    hY = Z_ => {
      let { sessionId: l6, resumeSessionId: U6 } = Z_
      if (Z1H(Z_)) return Z_.tempo === 'active' ? 'busy' : void 0
      if (iX.current.has(U6 ?? l6)) return 'busy'
      if (u3.some(pq => pq.state.sessionId === l6)) return 'busy'
      let f8 = v$.get(Z_.resumeSessionId ?? l6)
      if (f8) return f8
      if (N2.current.has(l6)) return 'busy'
      return
    },
    tE = !1,
    [, vL] = U8.useState(0),
    Dm = Date.now(),
    M1 = U8.useMemo(
      () => new Set((w ?? []).filter(Z_ => GE_(Z_.state)).map(Z_ => Z_.id)),
      [w],
    ),
    a5 = (w ?? []).some(Z_ => {
      if (!M1.has(Z_.id)) return !1
      let l6 = L.get(Z_.state.sessionId)?.nextAt
      return l6 != null && l6 > Dm && l6 - Dm < 60000
    })
  N4(() => vL(Z_ => Z_ + 1), a5 ? 1000 : w?.length ? 30000 : null),
    U8.useEffect(() => {
      ez()
    }, [ez]),
    U8.useEffect(() => {
      Wy6(b, !0, Y)
    }, [b, Y]),
    U8.useEffect(() => {
      if (Mj4) return
      W1H()
        .catch(() => [])
        .then(Z_ => {
          let l6 = !1
          if (
            (O6(U6 => {
              let f8 = U6.agentLastUsed ?? {},
                pq = { ...f8 }
              for (let I9 of Z_) {
                if (I9.state.template === cqH.name) continue
                if (f8[I9.state.template] !== void 0) continue
                let v9 = Date.parse(I9.state.createdAt)
                if (Number.isNaN(v9)) continue
                if (v9 > (pq[I9.state.template] ?? 0))
                  (pq[I9.state.template] = v9), (l6 = !0)
              }
              if (!l6) return U6
              return { ...U6, agentLastUsed: pq }
            }),
            l6)
          )
            Mq()
        })
    }, []),
    U8.useEffect(() => {
      let Z_ = !1
      if (!m.has(GO))
        JtK(GO)
          .catch(() => [])
          .then(l6 => {
            if (Z_) return
            e4q.set(GO, l6),
              S(U6 => (U6.has(GO) ? U6 : new Map(U6).set(GO, l6)))
          })
      if (!r.has(GO))
        IX(GO)
          .catch(() => [])
          .then(l6 => {
            if (Z_) return
            let U6 = l6
              .filter(f8 => !f8.isHidden && !eCH(f8))
              .map(f8 => ({
                kind: 'skill',
                name: f8.name,
                description: U5(f8.description ?? ''),
              }))
            H1q.set(GO, U6),
              a(f8 => (f8.has(GO) ? f8 : new Map(f8).set(GO, U6)))
          })
      return () => {
        Z_ = !0
      }
    }, [GO])
  let { addNotification: o4 } = A7(),
    H$ = _jH()
  mL6(H$, !0, Z_ => o4(uL6(Z_))),
    pL6(H$),
    U8.useLayoutEffect(() => {
      let Z_ = J5.get(process.stdout)
      if (!Z_) return
      return (
        (Z_.onHyperlinkClick = l6 => {
          if (l6.startsWith('file:'))
            try {
              eMH(MC6.fileURLToPath(l6))
            } catch {}
          else f4(l6)
        }),
        () => {
          Z_.onHyperlinkClick = void 0
        }
      )
    }, [])
  let {
      template: Ay,
      state: nH,
      output: T_,
      pr: q6,
      frame: P8,
      text: e8,
    } = b1
      ? {
          template: void 0,
          state: void 0,
          output: void 0,
          pr: void 0,
          frame: void 0,
          text: '',
        }
      : Aj4(G6),
    Q9 = q6 ? AC6(q6) : void 0,
    K4 = tE ? [...(w ?? []), ...M] : (w ?? []),
    g1 = $ ? K4.filter(Z_ => zC6(Z_.state, $)) : K4,
    OT = g1.filter(Z_ => {
      if (Ay && !Z_.state.template.toLowerCase().startsWith(Ay)) return !1
      if (q6 && !r4q(Z_.state, q6, Q9)) return !1
      if (P8 && !o4q(Z_.state, P8)) return !1
      if (
        T_ !== void 0 &&
        !Object.values(Z_.state.output ?? {}).some(l6 =>
          l6.toLowerCase().includes(T_),
        )
      )
        return !1
      if (
        nH &&
        !Z_.state.state.toLowerCase().startsWith(nH) &&
        !g2H(Z_.state).startsWith(nH) &&
        !lw4[TC6(Z_, W.current, hY(Z_.state))].toLowerCase().startsWith(nH)
      )
        return !1
      if (e8) {
        if (
          ![
            Z_.state.name,
            Z_.state.intent,
            Z_.state.detail,
            ...Object.values(Z_.state.output ?? {}),
          ]
            .join(' ')
            .toLowerCase()
            .includes(e8)
        )
          return !1
      }
      return !0
    }),
    Kj = u3.filter(Z_ => !OT.some(l6 => l6.id === Z_.id)),
    Oj = Kj.length > 0 ? XE_([...Kj, ...OT]) : OT,
    EY = H_ === 'state',
    ID = new Map(
      Oj.map(Z_ => [
        Z_.id,
        Z_.state.pinned
          ? 'pinned'
          : tz?.id === Z_.id && tz.group
            ? tz.group
            : EY
              ? TC6(Z_, W.current, hY(Z_.state))
              : _1q(Z_.state),
      ]),
    ),
    Bj = [...Oj].sort((Z_, l6) => {
      let U6 = ID.get(Z_.id),
        f8 = ID.get(l6.id)
      if (U6 === 'pinned' || f8 === 'pinned')
        return (U6 === 'pinned' ? 0 : 1) - (f8 === 'pinned' ? 0 : 1)
      if (EY) {
        let pq = cw4.indexOf(U6) - cw4.indexOf(f8),
          I9 = v9 =>
            tz?.id === v9.id && tz.sortKey !== void 0
              ? tz.sortKey
              : fE_(v9.state, U6)
        return pq !== 0
          ? pq
          : I9(l6) - I9(Z_) ||
              l6.state.createdAt.localeCompare(Z_.state.createdAt)
      }
      if (U6 === h && f8 !== h) return -1
      if (f8 === h && U6 !== h) return 1
      return U6.localeCompare(f8)
    }),
    yL = 1 / 0
  if (EY && !v_.has('done')) {
    let Z_ = Bj.filter(l6 => ID.get(l6.id) === 'done')
    if (Z_.length >= s_ + nw4) {
      let l6 = pq => fE_(pq.state, 'done'),
        U6 = l6(Z_[s_ - 1]),
        f8 = s_
      while (f8 < Z_.length && U6 - l6(Z_[f8]) < whO) f8++
      if (
        Z_.length - f8 >= nw4 &&
        Math.max(
          Z_.findIndex(pq => pq.id === _),
          Z_.findIndex(pq => pq.id === e$),
        ) < f8
      )
        yL = f8
    }
  }
  let f3 = [],
    v2 = 0
  for (let Z_ = 0; Z_ < Bj.length; Z_++) {
    let l6 = Bj[Z_],
      U6 = ID.get(l6.id),
      f8 = ZE_(l6.state)
    if (Z_ === 0 || U6 !== ID.get(Bj[Z_ - 1].id)) {
      let pq = EY || U6 === 'pinned' || U6 === h ? b : f8
      f3.push({ kind: 'header', origin: pq, group: U6 })
    }
    if (U6 === 'done' && v2++ >= yL) continue
    f3.push({ kind: 'job', job: l6, origin: f8, group: U6 })
  }
  let RF = v2 > yL ? v2 - yL : 0
  if (RF > 0) {
    if (
      (f3.push({ kind: 'fold', origin: b, group: 'done', hidden: RF }),
      !o.current)
    )
      (o.current = !0),
        c('tengu_fleetview_fold_shown', {
          done_count: v2,
          hidden_count: RF,
          k: s_,
          terminal_rows: t_,
        })
  }
  let hL = new Map()
  for (let Z_ of Bj) {
    let l6 = ID.get(Z_.id)
    hL.set(l6, (hL.get(l6) ?? 0) + 1)
  }
  if (E_.size > 0)
    f3 = f3.filter(Z_ => Z_.kind === 'header' || !E_.has(Z_.group))
  function rG(Z_) {
    return f3.findIndex(l6 => l6.kind === 'job' && l6.job.id === Z_)
  }
  let SY = f3[1]?.kind === 'job' && f3[1].origin === E ? 1 : 0,
    eE =
      new Set(f3.filter(Z_ => Z_.kind === 'header').map(Z_ => Z_.group)).size >
      1,
    ww = U8.useRef(f3)
  ww.current = f3
  let m3 = f3[HH],
    VK = m3?.kind === 'job' ? m3.job : void 0
  u_.current = VK
  let gTH = U8.useMemo(
    () => xH(process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE),
    [],
  )
  qjH(gTH ? null : $j4(e6(g1, Z_ => g2H(Z_.state, hY(Z_.state)) === 'blocked')))
  let oG = sH.current ?? VK?.id ?? m3?.group
  U8.useEffect(() => {
    if (Aw.current !== null && Aw.current.id === sH.current) return
    KA(null)
  }, [oG])
  let ds = U8.useMemo(
      () => (VK?.state.children ? aw4(VK.state.children, P) : []),
      [VK, P],
    ),
    fm = m3?.origin ?? b,
    cs = m3?.group ?? h
  U8.useEffect(() => {
    U(Z_ => (Z_ === fm ? Z_ : fm))
  }, [fm]),
    U8.useLayoutEffect(() => {
      if (R_.current) {
        let l6 = f3.findIndex(
          U6 => U6.kind === 'header' && U6.group === R_.current,
        )
        if (l6 >= 0 && l6 !== HH) t(l6)
        if (l6 < 0) R_.current = null
        return
      }
      if (!sH.current) return
      let Z_ = rG(sH.current)
      if (Z_ < 0) {
        sH.current = null
        return
      }
      if (Z_ !== HH)
        N(
          `[FV-poll] follow re-pin moved focus: was=${HH} now=${Z_} followId=${sH.current}`,
        ),
          t(Z_)
    })
  let wy = $hO(
    Bj,
    Z_ => (M1.has(Z_.id) ? L.get(Z_.state.sessionId)?.nextAt : null),
    _,
  )
  U8.useEffect(() => {
    if (u3.length === 0 || !w) return
    let Z_ = u3.filter(U6 => w.some(f8 => f8.id === U6.id))
    if (Z_.length === 0) return
    let l6 = new Set(Z_.map(U6 => U6.id))
    for (let U6 of Z_) {
      let f8 = U6.state.sessionId
      N2.current.add(f8), A.setTimeout(() => N2.current.delete(f8), 30000)
    }
    if (
      (n(U6 => U6.filter(f8 => !l6.has(f8.id))),
      sH.current && l6.has(sH.current))
    ) {
      let U6 = ww.current.findIndex(
        f8 => f8.kind === 'job' && f8.job.id === sH.current,
      )
      if (U6 >= 0) t(U6)
    }
  }, [u3, w])
  let jy = U8.useRef(!0),
    Jy = U8.useRef(null),
    Xm = b1 === null
  U8.useEffect(() => {
    if (jy.current) {
      jy.current = !1
      return
    }
    if (Y5.current) {
      Y5.current = !1
      return
    }
    if ((b3(null), aH(null), !Xm)) {
      if (Jy.current) {
        if (sH.current === Jy.current) (sH.current = null), t(SY)
        Jy.current = null
      }
      return
    }
    if (((R_.current = null), e$)) {
      ;(Jy.current = e$), (sH.current = e$)
      let Z_ = rG(e$)
      if (Z_ >= 0) t(Z_)
      return
    }
    ;(Jy.current = null), (sH.current = null), t(SY)
  }, [G6]),
    U8.useEffect(() => {
      t(Z_ => pY(Z_, 0, Math.max(0, f3.length - 1)))
    }, [f3.length])
  let EL = U8.useRef(null)
  U8.useEffect(() => {
    if (e$) {
      EL.current = null
      return
    }
    if (!x3) {
      let pq = EL.current
      if (((EL.current = null), pq)) {
        ;(R_.current = null), (sH.current = pq)
        let I9 = ww.current.findIndex(
          v9 => v9.kind === 'job' && v9.job.id === pq,
        )
        if (I9 >= 0) t(I9)
      }
      return
    }
    let Z_ = ww.current[HH]
    if (Z_?.kind === 'job' && EL.current === null) EL.current = Z_.job.id
    let l6 = pq => ww.current.findIndex(I9 => I9.kind === 'header' && pq(I9)),
      U6 = -1,
      f8 = null
    if (EY) f8 = 'working'
    else if (_1) {
      if (((U6 = l6(pq => pq.origin === _1 && pq.group !== 'pinned')), U6 >= 0))
        f8 = ww.current[U6].group
    } else if (Z_?.kind === 'job')
      if (Z_.group === 'pinned')
        f8 =
          ww.current.find(
            I9 =>
              I9.kind === 'header' &&
              I9.origin === Z_.origin &&
              I9.group !== 'pinned',
          )?.group ?? null
      else f8 = Z_.group
    else if (Z_?.kind === 'header') {
      if (Z_.group !== 'pinned') (f8 = Z_.group), (U6 = HH)
    }
    if (U6 < 0) return
    if (((sH.current = null), (R_.current = f8), U6 !== HH)) t(U6)
  }, [x3, EY, _1])
  let BI = (() => {
      if (!x3 || e$) return null
      if (EY) return 'working'
      if (_1)
        return (
          f3.find(
            U6 =>
              U6.kind === 'header' && U6.origin === _1 && U6.group !== 'pinned',
          )?.group ?? null
        )
      let Z_ = f3[HH]
      if (Z_?.kind === 'job') {
        if (Z_.group === 'pinned')
          return (
            f3.find(
              U6 =>
                U6.kind === 'header' &&
                U6.origin === Z_.origin &&
                U6.group !== 'pinned',
            )?.group ?? null
          )
        return Z_.group
      }
      if (Z_?.kind === 'header') return Z_.group === 'pinned' ? null : Z_.group
      return null
    })(),
    My =
      qH &&
      (Bj.length === 0 ||
        (m3 !== void 0 && m3.kind !== 'job') ||
        (m3 === void 0 && (sH.current === null || rG(sH.current) < 0)))
  U8.useEffect(() => {
    if (My) OH(!1)
  }, [My]),
    U8.useLayoutEffect(() => {
      if (!QH.current || HH === jH) return
      let l6 = ww.current[HH]?.kind === 'header' && HH > 0 ? -1 : 0
      kH.current?.scrollToElement(QH.current, l6)
    }, [HH, jH])
  let _$ = U8.useRef(0)
  U8.useEffect(() => {
    if (_$.current >= 2 || w === null) return
    _$.current++
    let Z_ = () => {
      t(SY)
      let U6 = ww.current[SY]
      if (U6?.kind === 'job') (sH.current = U6.job.id), (R_.current = null)
      else if (U6?.kind === 'header')
        (sH.current = null), (R_.current = U6.group)
    }
    if (!_) {
      ;(_$.current = 2), Z_()
      return
    }
    let l6 = ww.current.findIndex(U6 => U6.kind === 'job' && U6.job.id === _)
    if (l6 >= 0) (_$.current = 2), t(l6), (sH.current = _)
    else if (_$.current >= 2) Z_()
  }, [w, _, SY])
  let LF = (Z_, l6, U6 = !1) => {
      if (!l6) return
      if (l6.state.backend === 'peer') {
        b3(
          "Can't stop or delete \u2014 this session is running in another terminal",
        )
        return
      }
      let f8 = g2H(l6.state),
        pq = t9.find(q1 => q1.key === Z_ && q1.bands.includes(f8))
      if (!pq) return
      let I9 = (q1, Kz) => {
        if (Kz instanceof wC6)
          N(`[FleetView] action '${q1}' unconfirmed: ${LH(Kz)}`, {
            level: 'warn',
          })
        else if (_7(Kz))
          N(`[FleetView] action '${q1}' fs failure (${Kz.code}): ${LH(Kz)}`, {
            level: 'error',
          })
        else hH(Kz)
        b3(`Couldn't ${q1} \u2014 ${LH(Kz)}`)
      }
      if (Z_ === 'x' && !U6 && Aw.current?.id !== l6.id) {
        let q1 = t9.find(Kz => Kz.label === 'stop')
        if (
          (KA(
            l6.id,
            pq.label === 'stop',
            ID.get(l6.id),
            fE_(l6.state, ID.get(l6.id)),
          ),
          q1)
        )
          Promise.resolve(q1.run(l6)).catch(Kz => {
            KA(null), I9(q1.label, Kz)
          })
        return
      }
      KA(null)
      let v9 = Z_ === 'x' ? (t9.find(q1 => q1.label === 'delete') ?? pq) : pq
      Promise.resolve(v9.run(l6)).then(
        q1 => {
          if (q1) b3(q1)
        },
        q1 => I9(v9.label, q1),
      )
    },
    Dy = Z_ => {
      if (!Z_ || cH !== null) return
      if (u3.some(U6 => U6.id === Z_.id)) return
      if (Z_.state.backend === 'peer') {
        b3("Can't attach \u2014 this session is running in another terminal"),
          SH('fleet_view_open')
        return
      }
      tH(Z_.id), b3(null)
      let l6 =
        Date.now() - NL.current < 1500 &&
        OZ.current.get(Z_.state.resumeSessionId ?? Z_.state.sessionId) !==
          void 0
          ? !0
          : void 0
      ;(K_.current = Z_.id),
        jC6(Z_.id, { knownState: Z_.state, knownAlive: l6 }).then(U6 => {
          if (K_.current !== Z_.id) return
          if ((tH(null), U6.ok || U6.alive))
            H({
              type: 'open',
              job: Z_,
              query: qz.current === null ? void 0 : p8.current,
              collapsed: [...O_.current],
              groupMode: oH.current,
              jobs: J.current,
              loopKicks: v.current,
              statuses: OZ.current,
              statusesTs: NL.current,
              prStatuses: W.current,
              respawnResult: U6,
            })
          else uH('fleet_view_open', 'respawn_failed'), b3(U6.error)
        })
    },
    Kn = (Z_, l6) => {
      let U6 = f3.length
      if (U6 === 0) return 0
      if (x3 && (EY || _1)) return Z_
      let f8 = x3
          ? I9 => I9?.kind !== 'header' || I9.group === 'pinned'
          : qH
            ? I9 => I9?.kind !== 'job'
            : null,
        pq = (Z_ + l6 + U6) % U6
      if (f8) while (pq !== Z_ && f8(f3[pq])) pq = (pq + l6 + U6) % U6
      return pq
    },
    xM = U8.useRef(new Map()),
    pf = U8.useRef(new Map()),
    Bf = U8.useRef(null),
    SL = U8.useRef([]),
    HS = U8.useCallback(() => {
      let Z_ = Array.from(xM.current),
        l6 = Array.from(pf.current)
      if (
        (xM.current.clear(),
        pf.current.clear(),
        Z_.length === 0 && l6.length === 0)
      )
        return Promise.resolve()
      return vH7(() =>
        Promise.all([
          ...Z_.map(([U6, f8]) => VH7(b4(U6), f8)),
          ...l6.map(([U6, f8]) => NH7(b4(U6), f8)),
        ]),
      )
        .then(() => {
          SH('fleet_view_reorder_job')
        })
        .catch(U6 => {
          hH(U6),
            b3(`Couldn't save order \u2014 ${LH(U6)}`),
            uH('fleet_view_reorder_job', 'write_sort_order_failed')
        })
    }, [])
  U8.useEffect(
    () => () => {
      Bf.current?.(), HS()
    },
    [HS],
  )
  let QW = Z_ => {
      let l6 = f3[HH],
        U6 = f3[HH + Z_]
      if (l6?.kind !== 'job' || U6?.kind !== 'job' || l6.group !== U6.group)
        return
      let f8 = l6.job,
        pq = U6.job
      if (u3.some(L5 => L5.id === f8.id || L5.id === pq.id)) return
      if (f8.state.backend === 'peer' || pq.state.backend === 'peer') return
      b3(null)
      let I9 = EY && l6.group !== 'pinned',
        v9 = I9 ? L5 => fE_(L5, l6.group) : JC6,
        q1 = v9(f8.state),
        Kz = v9(pq.state),
        y$ = new Map()
      if (q1 === Kz) {
        let L5 = new Set(u3.map(p3 => p3.id)),
          aK = 0
        for (let p3 of f3)
          if (p3.kind === 'job' && p3.group === l6.group && !L5.has(p3.job.id))
            y$.set(p3.job.id, aK++)
        let w5 = y$.get(f8.id)
        y$.set(f8.id, y$.get(pq.id)), y$.set(pq.id, w5)
      } else y$.set(f8.id, Kz), y$.set(pq.id, q1)
      ;(sH.current = f8.id), (m5.current = ++o5.current)
      let h2 = I9 ? 'stateSortOrder' : 'sortOrder'
      j(L5 =>
        L5
          ? XE_(
              L5.map(aK => {
                let w5 = y$.get(aK.id)
                return w5 === void 0
                  ? aK
                  : { ...aK, state: { ...aK.state, [h2]: w5 } }
              }),
            )
          : L5,
      )
      let o3 = I9 ? pf : xM
      for (let [L5, aK] of y$) o3.current.set(L5, aK), SL.current.push(pO(L5))
      Bf.current?.(),
        (Bf.current = A.setTimeout(() => {
          ;(Bf.current = null), (m5.current = ++o5.current)
          let L5 = SL.current
          ;(SL.current = []),
            HS().finally(() => {
              for (let aK of L5) aK()
              ez()
            })
        }, 100))
    },
    On = Z_ => {
      if (Z_.key !== ' ' && UH.current) UH.current(), (UH.current = null)
      let l6 = () => {
        Z_.preventDefault(), Z_.stopImmediatePropagation()
      }
      if (dH !== null) {
        if ((l6(), Z_.ctrl && Z_.key === 'c')) {
          eH()
          return
        }
        if (Z_.key === 'up' || Z_.key === 'down') return
        $1(Z_)
        return
      }
      if (cH !== null) {
        if ((l6(), Z_.ctrl && Z_.key === 'c')) tH(null)
        return
      }
      if (Z_.ctrl && Z_.key === 'c') {
        if ((l6(), YH || AH)) {
          MH(!1), DH(!1)
          return
        }
        if (p8.current) yq('')
        if (m6.current === 'bash') L8('prompt')
        NH()
        return
      }
      if (Z_.key === 'escape') {
        if ((l6(), qH)) OH(!1)
        else if (YH) MH(!1)
        else if (AH) DH(!1)
        else if (l_) a6(!1)
        else if (p8.current) yq('')
        else if (m6.current === 'bash') L8('prompt')
        else if (Aw.current) KA(null)
        else JH()
        return
      }
      if (
        YH &&
        Z_.key !== '?' &&
        Z_.key !== 'up' &&
        Z_.key !== 'down' &&
        !(Z_.ctrl && (Z_.key === 'p' || Z_.key === 'n'))
      )
        MH(!1)
      if (
        Z_.shift &&
        (Z_.key === 'up' || Z_.key === 'down') &&
        HK.length === 0 &&
        !qH
      ) {
        l6(), QW(Z_.key === 'up' ? -1 : 1)
        return
      }
      if (Z_.ctrl && Z_.key === 'r') {
        if ((l6(), !VK || u3.some(U6 => U6.id === VK.id))) return
        if (VK.state.backend === 'peer' && !VK.state.sock) return
        ;(pH.current = VK.id),
          (gH.current =
            VK.state.backend === 'peer' ? (VK.state.sock ?? null) : null),
          qA(VK.state.name ?? ''),
          mH(VK.id)
        return
      }
      if (Z_.ctrl && Z_.key === 's') {
        l6(), (sH.current = VK?.id ?? null), (R_.current = null), KA(null)
        let U6 = oH.current === 'directory' ? 'state' : 'directory'
        $_(U6),
          O6(f8 =>
            f8.fleetViewGroupMode === U6
              ? f8
              : { ...f8, fleetViewGroupMode: U6 },
          )
        return
      }
      if (Z_.ctrl && Z_.key === 'g' && !qH) {
        l6()
        let U6 = ZV(p8.current)
        if (U6.content !== null && U6.content !== p8.current) yq(U6.content)
        if (U6.error) b3(U6.error)
        return
      }
      if (Z_.ctrl && Z_.key === 't') {
        if ((l6(), !VK || u3.some(I9 => I9.id === VK.id))) return
        if (VK.state.backend === 'peer') {
          b3("Can't pin a session that's running in another terminal"),
            SH('fleet_view_pin_toggle')
          return
        }
        let U6 = VK.id,
          f8 = !VK.state.pinned
        if (((sH.current = U6), f8))
          w_(I9 => {
            if (!I9.has('pinned')) return I9
            let v9 = new Set(I9)
            return v9.delete('pinned'), v9
          })
        ;(m5.current = ++o5.current),
          j(
            I9 =>
              I9?.map(v9 =>
                v9.id === U6
                  ? { ...v9, state: { ...v9.state, pinned: f8 } }
                  : v9,
              ) ?? I9,
          )
        let pq = pO(U6)
        yH7(U6, f8)
          .then(() => {
            SH('fleet_view_pin_toggle')
          })
          .catch(I9 => {
            hH(I9),
              b3(`Couldn't ${f8 ? 'pin' : 'unpin'} \u2014 ${LH(I9)}`),
              uH('fleet_view_pin_toggle', 'pin_write_failed'),
              ez()
          })
          .finally(pq)
        return
      }
      if (Z_.key === 'up' || (Z_.ctrl && Z_.key === 'p')) {
        if ((l6(), HK.length > 0)) {
          S7(null), Eq(U6 => Math.max(0, U6 - 1))
          return
        }
        if (
          Z_.key === 'up' &&
          !qH &&
          p8.current.includes(`
`)
        ) {
          E8(Z_)
          return
        }
        b3(null),
          KH(null),
          t(U6 => {
            let f8 = Kn(U6, -1),
              pq = f3[f8]
            if (pq?.kind === 'job')
              (sH.current = pq.job.id), (R_.current = null)
            else if (pq?.kind === 'header')
              (sH.current = null), (R_.current = pq.group)
            else (sH.current = null), (R_.current = null)
            return f8
          })
        return
      }
      if (Z_.key === 'down' || (Z_.ctrl && Z_.key === 'n')) {
        if ((l6(), HK.length > 0)) {
          S7(null), Eq(U6 => Math.min(HK.length - 1, U6 + 1))
          return
        }
        if (
          Z_.key === 'down' &&
          !qH &&
          p8.current.includes(`
`)
        ) {
          E8(Z_)
          return
        }
        b3(null),
          KH(null),
          t(U6 => {
            let f8 = Kn(U6, 1),
              pq = f3[f8]
            if (pq?.kind === 'job')
              (sH.current = pq.job.id), (R_.current = null)
            else if (pq?.kind === 'header')
              (sH.current = null), (R_.current = pq.group)
            else (sH.current = null), (R_.current = null)
            return f8
          })
        return
      }
      if (qH && Z_.ctrl && Z_.key === 'x') {
        if ((l6(), VK && u3.some(U6 => U6.id === VK.id))) return
        LF('x', VK)
        return
      }
      if (qH) return
      if (Z_.key === 'tab') {
        if ((l6(), !p8.current && m6.current === 'prompt' && _z.length > 0))
          a6(U6 => !U6)
        else if (HK.length > 0) z3(q4())
        return
      }
      if (
        Z_.key === 'right' &&
        !Z_.shift &&
        !p8.current &&
        m6.current === 'prompt' &&
        !qH
      ) {
        l6(), Dy(VK)
        return
      }
      if ((Z_.meta || Z_.superKey) && Z_.key >= '1' && Z_.key <= '9') {
        l6()
        let U6 = Number(Z_.key),
          f8 = f3.find(
            pq => pq.kind === 'job' && pq.origin === fm && --U6 === 0,
          )
        if (f8?.kind === 'job') Dy(f8.job)
        return
      }
      if (Z_.key === 'return') {
        if (!Z_.shift && (Z_.meta || p8.current[Z6 - 1] === '\\')) {
          E8(Z_)
          return
        }
        l6()
        let U6 = m6.current === 'bash' ? '!' : p8.current.trim().toLowerCase(),
          f8 = () => {
            ;(Y5.current = !0),
              yq(''),
              DS6(C, { q: '', collapsed: [...O_.current] })
          }
        if (U6 === '/exit' || U6 === '/quit' || Yv6.includes(U6)) {
          f8(), JH()
          return
        }
        if (HK.length > 0) {
          z3(q4()), a6(!1)
          return
        }
        let pq = p8.current,
          I9 = m6.current === 'bash',
          v9 = pq === G6 && !I9 ? b1 : a4q(I9 ? `!${pq}` : pq, _z, d, t$)
        if (v9?.intent || v9?.routine || v9?.matched) {
          let q1 = $d(v9.intent, Fq.current)
          if (!v9.routine && !v9.matched && q1.trim().length < qhO) {
            b3(null), aH('Too short \u2014 describe the task')
            return
          }
          let Kz = Z_.shift,
            y$ = v9.cwd ?? x,
            h2 = s6q(),
            L5 =
              !Object.values(Fq.current).some(Uf => Uf.type === 'image') &&
              q1.length <= hkH &&
              !q1.includes(`
`),
            aK =
              !!h2 &&
              h2.ready &&
              !v9.matched &&
              !v9.routine &&
              y$ === h2.cwd &&
              L5,
            w5 = aK ? h2.sessionId : _j4.randomUUID(),
            p3 = w5.slice(0, 8)
          ;(sH.current = p3), (Y5.current = !0)
          let vJ = v9.matched && !v9.exec ? v9.template.name : null,
            OA = Fq.current,
            bD = v9.exec ? $d(v9.exec, OA) : void 0,
            rX = {
              id: p3,
              state: tHH({
                template: bD
                  ? { name: 'exec', description: '' }
                  : v9.routine
                    ? { name: v9.routine, description: '' }
                    : v9.template,
                intent: bD ?? q1,
                sessionId: w5,
                cwd: y$,
                originCwd: y$,
              }),
              activity: 'flowing',
            }
          n(Uf => [...Uf, rX])
          let FI = pq,
            An = m6.current,
            E2 = EL.current,
            wn = R_.current
          ;(EL.current = null),
            (R_.current = null),
            yq(''),
            L8('prompt'),
            DS6(C, { q: '', collapsed: [...O_.current] }),
            (Fq.current = {})
          let xD = Uf => {
            n(mV => {
              let aG = mV.filter(Ff => Ff.id !== p3)
              if (!p8.current && aG.length === 0)
                (Y5.current = !0),
                  (Fq.current = OA),
                  (EL.current = E2),
                  (R_.current = wn),
                  L8(An),
                  yq(FI),
                  MH(!1)
              return aG
            }),
              b3(Uf)
          }
          ;(bD
            ? PtK(bD, w5, y$)
            : aK
              ? ZtK(q1)
              : DtK(q1, OA, p3).then(Uf =>
                  Xy6(v9.template, Uf, w5, y$, v9.routine, Y),
                )
          ).then(
            Uf => {
              if (aK) Wy6(b, !1, Y)
              if (!Uf.ok) return xD(Uf.error)
              if ((fqH(), aK && Uf.jobId !== p3))
                (sH.current = Uf.jobId),
                  (rX = {
                    ...rX,
                    id: Uf.jobId,
                    state: { ...rX.state, sessionId: Uf.sessionId },
                  }),
                  n(mV => mV.map(aG => (aG.id === p3 ? rX : aG)))
              if (aK) {
                let mV = Uf.sessionId
                iX.current.add(mV),
                  A.setTimeout(() => iX.current.delete(mV), 30000)
              }
              if (vJ) {
                let mV = !1
                if (
                  (O6(aG => {
                    let Ff = Date.now(),
                      gI = aG.agentLastUsed?.[vJ]
                    if (gI !== void 0 && Ff - gI < 60000) return aG
                    return (
                      (mV = !0),
                      {
                        ...aG,
                        agentLastUsed: {
                          ...(aG.agentLastUsed ?? {}),
                          [vJ]: Ff,
                        },
                      }
                    )
                  }),
                  mV)
                )
                  Mq()
              }
              if (Kz)
                tH(rX.id),
                  H({
                    type: 'open',
                    job: rX,
                    collapsed: [...O_.current],
                    groupMode: H_,
                    jobs: J.current,
                    loopKicks: v.current,
                    statuses: OZ.current,
                    statusesTs: NL.current,
                    prStatuses: W.current,
                    freshDispatch: !0,
                  })
              else if ((ez(), !aK))
                A5.current?.(), (A5.current = GH7(p3, () => void ez()))
            },
            Uf => {
              if (aK) Wy6(b, !1, Y)
              xD(LH(Uf))
            },
          )
        } else if (!v9?.cwd && v9?.exec === void 0)
          if (m3?.kind === 'fold')
            (R_.current = null),
              (sH.current = null),
              I_(q1 => new Set(q1).add(m3.group)),
              c('tengu_fleetview_fold_expand', {
                hidden_count: m3.hidden,
                ms_since_mount: Date.now() - BH.current,
              })
          else if (m3?.kind === 'header')
            (R_.current = m3.group), (sH.current = null), V_(m3.group)
          else Dy(VK)
        return
      }
      if (Z_.ctrl && Z_.key === 'x') {
        if ((l6(), HK.length > 0)) return
        if (!x3 && m3?.kind === 'header' && $n.length > 0) {
          if (
            ((R_.current = m3.group),
            (sH.current = null),
            Aw.current?.id !== m3.group)
          ) {
            KA(m3.group)
            return
          }
          KA(null)
          for (let U6 of $n) {
            if (u3.some(f8 => f8.id === U6.id)) continue
            LF('x', U6, !0)
          }
          return
        }
        if (VK && u3.some(U6 => U6.id === VK.id)) return
        LF('x', VK)
        return
      }
      if (
        (Z_.ctrl && Z_.key,
        Z_.key === '?' && p8.current === '' && m6.current === 'prompt')
      ) {
        l6(),
          MH(U6 => !U6),
          c('tengu_bg_agent_action', { action: 'help_toggled' })
        return
      }
      if (J2H() && OJ_(Z_.key) && !p8.current && m6.current === 'prompt') {
        l6(), L8('bash')
        return
      }
      if (Z_.name === 'backspace' && !p8.current && m6.current === 'bash') {
        l6(), L8('prompt')
        return
      }
      E8(Z_)
    },
    { handleKeyDown: QTH, handlePaste: fy } = P76({
      handleKeyDown: On,
      onPaste: Z_ => {
        let l6 = Z_.replace(
            /\r\n|\r/g,
            `
`,
          ),
          U6 = jjH(l6)
        if (l6.length > hkH || U6 > 2) {
          let f8 = h7.current++
          ;(Fq.current[f8] = { id: f8, type: 'text', content: l6 }),
            g6(new JkH($cH(f8, U6)))
          return
        }
        g6(new JkH(l6))
      },
      onImagePaste: (Z_, l6, U6, f8, pq) => {
        let I9 = h7.current++
        ;(Fq.current[I9] = {
          id: I9,
          type: 'image',
          content: Z_,
          mediaType: l6 ?? 'image/png',
          filename: U6,
          dimensions: f8,
          sourcePath: pq,
        }),
          g6(new JkH(z76(I9)))
      },
    }),
    kF = Z_ => {
      if (dH !== null) {
        az(Z_)
        return
      }
      if (YH) MH(!1)
      fy(Z_)
    }
  if (w === null)
    return y_.createElement(B, {
      tabIndex: 0,
      autoFocus: !0,
      onKeyDown: E8,
      onPaste: kF,
    })
  let Tn =
      HK.length > 0
        ? y_.createElement(
            B,
            { paddingLeft: 2, marginBottom: 1 },
            y_.createElement(UkH, {
              suggestions: HK.map(Z_ => ({
                id: `${Z_.kind}:${Z_.name}`,
                displayText:
                  Z_.kind === 'skill' ? `/${Z_.name}` : `@${Z_.name}`,
                description: `${EhO[Z_.kind]} \xB7 ${Z_.description}`,
              })),
              selectedSuggestion: Math.min(j8, HK.length - 1),
              maxColumnWidth: 35,
              noPad: !0,
              hoveredId: Sq,
              onHoverChange: S7,
              onSelect: Z_ => {
                let l6 = HK[Z_]
                if (l6) z3(l6), a6(!1)
              },
            }),
          )
        : null,
    VF = Bj.some(Z_ => Z_.id === _),
    P9H = y_.createElement(
      B,
      { flexDirection: 'column', gap: 1 },
      y_.createElement(
        V,
        { dimColor: !0 },
        VF
          ? `Press ${__.arrowRight} to return to your session anytime. Type a task below to dispatch a session alongside it. Sessions keep running even after you close the terminal${q ? ' \u2014 run `claude agents` to manage them' : ''}.`
          : 'Type a task below to start a background session. It keeps running even after you close this terminal.',
      ),
      y_.createElement(
        V,
        { dimColor: !0 },
        'Try: paste a PR or issue URL \xB7 "investigate why test/auth.test.ts is flaky" \xB7 "address the review comments on #1234"',
      ),
    ),
    NF = !N$ && b1?.cwd !== void 0,
    vF = new Set([
      ...Y4,
      ...t$.map(Z_ => Z_.name.toLowerCase()),
      ..._4.map(Z_ => Z_.toLowerCase()),
    ]),
    yF = yT ? [] : yhO(G6, vF),
    dW = yT
      ? []
      : b1?.matched && M9 === b1.template.name.toLowerCase()
        ? [[0, M9.length], ...yF]
        : X9
          ? [[0, M9.length], ...yF]
          : [...vhO(G6), ...yF],
    y2 = !!VK && u3.some(Z_ => Z_.id === VK.id),
    Pm = e6(K4, Z_ => {
      let l6 = TC6(Z_, W.current, hY(Z_.state))
      return l6 === 'blocked' || l6 === 'working'
    }),
    zn = N$ ? 'create' : VK && K1q(VK.state) ? 'resume' : 'open',
    $n =
      m3?.kind === 'header' ? Bj.filter(Z_ => ID.get(Z_.id) === m3.group) : [],
    { version: dTH, cwd: UI } = P6_(),
    uM = Zi(Y?.model ?? F7()),
    Tj = uPH(
      !!UI && GO !== E && GO !== C ? cL(GO) : UI,
      Math.max(w6 - 11 - (uM ? a_(uM) + 3 : 0), 10),
    )
  return y_.createElement(
    B,
    {
      ref: bH,
      flexDirection: 'column',
      flexGrow: 1,
      tabIndex: 0,
      autoFocus: !0,
      onKeyDownCapture: E7,
      onKeyDown: QTH,
      onPaste: kF,
      onWheel: Z_ => {
        if (qH) return
        Z_.preventDefault(), kH.current?.scrollBy(Z_.deltaY > 0 ? 3 : -3)
      },
    },
    y_.createElement(
      EU,
      {
        ref: kH,
        flexGrow: 1,
        flexDirection: 'column',
        paddingTop: 1,
        stickyScroll: !0,
      },
      y_.createElement(
        B,
        { gap: 2, marginBottom: 1 },
        w6 >= 70 && y_.createElement(tc, null),
        y_.createElement(
          B,
          { flexDirection: 'column' },
          y_.createElement(
            V,
            null,
            y_.createElement(V, { bold: !0 }, 'Claude Code'),
            ' ',
            y_.createElement(V, { dimColor: !0 }, 'v', dTH),
          ),
          y_.createElement(
            V,
            { dimColor: !0 },
            [uM, Tj].filter(Boolean).join(' \xB7 '),
          ),
          y_.createElement(
            V,
            { dimColor: !0 },
            y_.createElement(
              Y6,
              null,
              `${e6(g1, Z_ => g2H(Z_.state, hY(Z_.state)) === 'blocked')} awaiting input`,
              `${e6(g1, Z_ => g2H(Z_.state, hY(Z_.state)) === 'active')} working`,
              `${e6(g1, Z_ => g2H(Z_.state, hY(Z_.state)) === 'completed')} completed`,
            ),
          ),
        ),
      ),
      f3.map((Z_, l6) => {
        let U6 = l6 === HH,
          f8 = Z_.kind === 'header' ? (x3 ? Z_.group === BI : U6) : !x3 && U6,
          pq = !x3 && U6 && l6 !== jH ? 'userMessageBackground' : void 0,
          I9 = () => {
            if (l6 === HH || (qH && Z_.kind !== 'job')) return
            if (Z_.kind === 'job') (sH.current = Z_.job.id), (R_.current = null)
            else if (Z_.kind === 'header')
              (sH.current = null), (R_.current = Z_.group)
            else (sH.current = null), (R_.current = null)
            b3(null), KH(l6), t(l6)
          }
        if (Z_.kind === 'header') {
          let q1 = !x3 && eE && Z_.group === cs,
            Kz = hL.get(Z_.group) ?? 0,
            y$ = E_.has(Z_.group)
          return y_.createElement(
            B,
            {
              key: `h:${Z_.group}`,
              ref: U6 ? QH : void 0,
              marginTop: l6 > 0 ? 1 : 0,
              backgroundColor: pq,
              onMouseEnter: G6 || qH ? void 0 : I9,
              onClick: () => {
                I9(), (R_.current = Z_.group), (sH.current = null), V_(Z_.group)
              },
            },
            y_.createElement(
              V,
              { bold: q1 || f8, dimColor: !f8 },
              Z_.group === 'pinned'
                ? 'Pinned'
                : EY
                  ? lw4[Z_.group]
                  : uPH(Zj4(Z_.group), Math.max(w6 - 10, 10)),
              y$ &&
                y_.createElement(
                  y_.Fragment,
                  null,
                  ' ',
                  y_.createElement(V, { dimColor: !0 }, Kz),
                ),
            ),
          )
        }
        if (Z_.kind === 'fold')
          return y_.createElement(
            B,
            {
              key: `f:${Z_.group}`,
              ref: U6 ? QH : void 0,
              paddingLeft: XH,
              backgroundColor: pq,
              onMouseEnter: G6 || qH ? void 0 : I9,
              onClick: () => {
                I9(),
                  I_(q1 => new Set(q1).add(Z_.group)),
                  c('tengu_fleetview_fold_expand', {
                    hidden_count: Z_.hidden,
                    ms_since_mount: Date.now() - BH.current,
                    via_click: !0,
                  })
              },
            },
            y_.createElement(
              V,
              { dimColor: !f8 },
              '\u2026 ',
              Z_.hidden,
              ' more',
            ),
          )
        let v9 = Z_.job
        return y_.createElement(
          B,
          {
            key: v9.id,
            ref: U6 ? QH : void 0,
            width: '100%',
            paddingLeft: XH,
            backgroundColor: pq,
            onMouseEnter: G6 || qH ? void 0 : I9,
            onClick: q1 => {
              if (q1.hyperlinkUrl) return q1.allowDefault()
              I9(), Dy(v9)
            },
          },
          y_.createElement(xhO, {
            job: v9,
            isFocused: U6,
            isOrigin: v9.id === _,
            logTail: f[v9.id],
            cols: wy,
            status: hY(v9.state),
            loopKickCount: M1.has(v9.id)
              ? L.get(v9.state.sessionId)?.count
              : void 0,
            age: q1q(
              v9,
              M1.has(v9.id) ? L.get(v9.state.sessionId)?.nextAt : void 0,
            ),
            childRows: v9.state.children ? aw4(v9.state.children, P) : [],
            renaming: dH === v9.id ? { draft: pj, cursor: r4 } : void 0,
            deleteArmed:
              tz && (tz.id === v9.id || tz.id === Z_.group)
                ? { justKilled: tz.justKilled }
                : void 0,
            attaching: cH === v9.id,
          }),
        )
      }),
      Bj.every(Z_ => Z_.id === _) &&
        !G6 &&
        y_.createElement(B, { paddingLeft: 2, marginTop: 1 }, P9H),
      Bj.length === 0 &&
        !!G6 &&
        !b1 &&
        y_.createElement(
          B,
          { paddingLeft: 2 },
          y_.createElement(V, { dimColor: !0 }, 'no sessions match'),
        ),
    ),
    y_.createElement(
      B,
      { flexShrink: 0, flexDirection: 'column', marginTop: 1 },
      y_.createElement(
        B,
        {
          position: 'absolute',
          marginTop: -1,
          height: 1,
          width: '100%',
          paddingLeft: 2,
          paddingRight: 1,
          flexDirection: 'column',
          alignItems: 'flex-end',
          justifyContent: 'flex-end',
          overflow: 'hidden',
        },
        y_.createElement(DE6, null),
      ),
      Tn,
      y_.createElement(
        B,
        {
          flexDirection: 'column',
          borderStyle: 'round',
          borderLeft: !1,
          borderRight: !1,
          borderColor: yT ? 'bashBorder' : void 0,
          borderDimColor: !yT,
        },
        y_.createElement(lv, {
          query: G6,
          cursorOffset: Z6,
          onCursorOffsetChange: j6,
          placeholder:
            yT || (EH && (Tq !== 'idle' || M3))
              ? ''
              : 'start a task in the background',
          prefix: D6 === 'bash' ? '!' : b1 ? __.pointer : void 0,
          prefixDim: !N$ && !yT,
          prefixColor: yT ? 'bashBorder' : void 0,
          highlights: dW,
          dimRange: u5.interimRange
            ? [u5.interimRange.start, u5.interimRange.end]
            : void 0,
          cursorChar: uA ? y_.createElement(Nj4, null) : void 0,
          isFocused: !qH && dH === null,
          isTerminalFocused: Q_,
          width: '100%',
          borderless: !0,
        }),
      ),
    ),
    YH && !qH
      ? y_.createElement(phO, {
          focusedPinned: VK?.state.pinned ?? !1,
          canReorder: !!VK && (!EY || (VK.state.pinned ?? !1)),
          canRename:
            !!VK && !y2 && !(VK.state.backend === 'peer' && !VK.state.sock),
          canPin: !!VK && !y2,
          canMention: _z.length + t$.length + Object.keys(d).length > 0,
          altOpenCount: Math.min(
            9,
            e6(f3, Z_ => Z_.kind === 'job' && Z_.origin === fm),
          ),
        })
      : AH && !qH
        ? y_.createElement(FhO, { job: VK })
        : y_.createElement(
            B,
            { flexShrink: 0, paddingLeft: 2, height: 1 },
            RH
              ? y_.createElement(
                  V,
                  { dimColor: !0 },
                  'Press Ctrl-C again to exit',
                  Pm > 0 && ` \xB7 ${Pm} ${N6(Pm, 'agent')} will keep running`,
                )
              : dH !== null
                ? y_.createElement(
                    V,
                    { dimColor: !0 },
                    y_.createElement(
                      Y6,
                      null,
                      y_.createElement(z_, {
                        chord: 'enter',
                        action: 'save',
                        format: { keyCase: 'lower' },
                      }),
                      y_.createElement(z_, {
                        chord: 'escape',
                        action: 'cancel',
                        format: { keyCase: 'lower' },
                      }),
                    ),
                  )
                : tz
                  ? y_.createElement(
                      V,
                      { dimColor: !0 },
                      y_.createElement(z_, {
                        chord: 'ctrl+x',
                        action: 'confirm',
                      }),
                    )
                  : mO
                    ? y_.createElement(
                        V,
                        { color: 'error', wrap: 'truncate-end' },
                        mO,
                      )
                    : EH && M3
                      ? y_.createElement(Dq_, null)
                      : EH && Tq !== 'idle'
                        ? y_.createElement(PE6, { voiceState: Tq })
                        : WH
                          ? y_.createElement(V, { dimColor: !0 }, WH)
                          : !qH && HK.length === 0
                            ? y_.createElement(
                                V,
                                { dimColor: !0 },
                                y_.createElement(
                                  Y6,
                                  null,
                                  Y && y_.createElement(Bw4, { defaults: Y }),
                                  ((VK && !y2) || N$) &&
                                    !NF &&
                                    !yT &&
                                    y_.createElement(z_, {
                                      chord: 'enter',
                                      action: zn,
                                      format: { keyCase: 'lower' },
                                    }),
                                  m3?.kind === 'header' &&
                                    G6 === '' &&
                                    y_.createElement(z_, {
                                      chord: 'enter',
                                      action: E_.has(m3.group)
                                        ? 'expand'
                                        : 'collapse',
                                      format: { keyCase: 'lower' },
                                    }),
                                  m3?.kind === 'fold' &&
                                    G6 === '' &&
                                    y_.createElement(z_, {
                                      chord: 'enter',
                                      action: 'show all',
                                      format: { keyCase: 'lower' },
                                    }),
                                  VK &&
                                    G6 === '' &&
                                    !yT &&
                                    w6 >= 55 &&
                                    y_.createElement(z_, {
                                      chord: ' ',
                                      action: 'reply',
                                      format: { keyCase: 'lower' },
                                    }),
                                  EH &&
                                    IH !== 'tap' &&
                                    G6 === '' &&
                                    !yT &&
                                    w6 >= 55
                                    ? y_.createElement(
                                        V,
                                        null,
                                        'hold space to speak',
                                      )
                                    : null,
                                  w6 >= 80 &&
                                    (VK && !y2 && G6 === ''
                                      ? y_.createElement(z_, {
                                          chord: 'ctrl+x',
                                          action: 'delete',
                                        })
                                      : !x3 && $n.length > 0
                                        ? y_.createElement(z_, {
                                            chord: 'ctrl+x',
                                            action: 'delete all',
                                          })
                                        : null),
                                  yT
                                    ? y_.createElement(
                                        V,
                                        { color: 'bashBorder' },
                                        '! for shell mode',
                                      )
                                    : G6 !== ''
                                      ? y_.createElement(z_, {
                                          chord: 'escape',
                                          action: 'clear',
                                          format: { keyCase: 'lower' },
                                        })
                                      : y_.createElement(
                                          V,
                                          null,
                                          '? for shortcuts',
                                        ),
                                ),
                              )
                            : null,
          ),
    y_.createElement(ME6, {
      isUpdating: fH,
      onChangeIsUpdating: GH,
      showSuccessMessage: !0,
      verbose: !1,
    }),
    qH &&
      VK &&
      y_.createElement(
        B,
        {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          flexDirection: 'column',
          opaque: !0,
        },
        y_.createElement(IhO, {
          key: VK.id,
          job: VK,
          renaming: dH !== null,
          replyDrafts: zH.current,
          replyError: $H?.id === VK.id ? $H.error : null,
          onReplyError: Z_ => TH(Z_ ? { id: VK.id, error: Z_ } : null),
          status: hY(VK.state),
          isPending: y2,
          deleteArmed:
            tz?.id === VK.id ? { justKilled: tz.justKilled } : void 0,
          onBack: () => OH(!1),
          onAttach: () => {
            OH(!1), Dy(VK)
          },
          childRows: ds,
          onReply: async Z_ => {
            let l6 = pO(VK.id),
              U6 = VK.state.resumeSessionId ?? VK.state.sessionId
            iX.current.add(U6),
              A.setTimeout(() => iX.current.delete(U6), 30000),
              j(I9 => {
                if (!I9?.some(v9 => v9.id === VK.id)) return I9
                return I9.map(v9 => {
                  if (v9.id !== VK.id) return v9
                  let q1 = y8_(v9.state, Z_)
                  return { ...v9, state: q1, activity: YC6(q1) }
                })
              })
            let f8,
              pq = !1
            try {
              if (
                ((f8 = await My6(VK.id, Z_, VK.state)),
                f8 === h8_ && pR(Z_) === 'prompt')
              ) {
                let I9 = await jC6(VK.id, {
                  knownState: VK.state,
                  initialPrompt: Z_,
                })
                ;(pq = !I9.ok), (f8 = I9.ok ? null : I9.error)
              }
              if (f8) iX.current.delete(U6)
            } finally {
              l6()
            }
            if (f8 === null)
              SH('fleet_view_reply'), fqH(), TZ.current.delete(U6)
            else if (f8 === o6q) SH('fleet_view_reply'), TZ.current.delete(U6)
            else {
              if (pq) N(`[fleetview] peek-reply respawn failed: ${f8}`)
              let I9 = TZ.current.get(U6),
                v9 = Date.now()
              if (I9 !== void 0 && v9 - I9 < jhO)
                e_('fleet_view_reply', 'retry_of_recent_failure')
              else if (f8 === h8_)
                e_('fleet_view_reply', 'not_running_no_respawn')
              else if (pq) uH('fleet_view_reply', 'respawn_failed')
              else if (AtK(f8)) e_('fleet_view_reply', 'daemon_restarting')
              else uH('fleet_view_reply', 'send_failed')
              TZ.current.set(U6, v9)
            }
            return ez(), f8
          },
          isTerminalFocused: Q_,
        }),
      ),
  )
}
function Nj4() {
  let H = uTH.c(2),
    [, _] = f76(),
    q
  if (H[0] !== _)
    (q = _ ? y_.createElement(V, { color: _.hex }, _.char) : null),
      (H[0] = _),
      (H[1] = q)
  else q = H[1]
  return q
}
function phO(H) {
  let _ = uTH.c(7),
    {
      focusedPinned: q,
      canReorder: K,
      canRename: O,
      canPin: T,
      canMention: z,
      altOpenCount: $,
    } = H,
    Y
  if (
    _[0] !== $ ||
    _[1] !== z ||
    _[2] !== T ||
    _[3] !== O ||
    _[4] !== K ||
    _[5] !== q
  ) {
    let A = []
    if (K) A.push(`shift+${__.arrowUp + __.arrowDown} to reorder`)
    if (O) A.push('ctrl+r to rename')
    if ((A.push('ctrl+s to switch views'), z)) A.push('@ to mention')
    if (T) A.push(`ctrl+t to ${q ? 'unpin' : 'pin to top'}`)
    if ($ > 0) A.push(`alt+1${$ > 1 ? `-${$}` : ''} to open`)
    A.push('esc to quit'), A.push('? to close')
    let w = []
    for (let j = 0; j < A.length; j = j + 2, j) w.push(A.slice(j, j + 2))
    ;(Y = y_.createElement(
      B,
      { flexShrink: 0, paddingX: 2, flexDirection: 'row', gap: 4 },
      w.map(BhO),
    )),
      (_[0] = $),
      (_[1] = z),
      (_[2] = T),
      (_[3] = O),
      (_[4] = K),
      (_[5] = q),
      (_[6] = Y)
  } else Y = _[6]
  return Y
}
function BhO(H, _) {
  return y_.createElement(B, { key: _, flexDirection: 'column' }, H.map(UhO))
}
function UhO(H) {
  return y_.createElement(V, { key: H, dimColor: !0 }, H)
}
function FhO(H) {
  let _ = uTH.c(43),
    { job: q } = H,
    K
  if (_[0] !== q)
    (K = q ? Date.parse(q.state.updatedAt) : 0), (_[0] = q), (_[1] = K)
  else K = _[1]
  let O = K,
    [T, z] = U8.useState(ghO),
    $
  if (_[2] === Symbol.for('react.memo_cache_sentinel'))
    ($ = () => z(Date.now())), (_[2] = $)
  else $ = _[2]
  if ((N4($, !q ? null : T - O < 60000 ? 1000 : 30000), !q)) {
    let x
    if (_[3] === Symbol.for('react.memo_cache_sentinel'))
      (x = y_.createElement(
        B,
        { flexShrink: 0, paddingX: 2 },
        y_.createElement(V, { dimColor: !0 }, 'no job focused'),
      )),
        (_[3] = x)
    else x = _[3]
    return x
  }
  let Y = q.state,
    A = Math.max(0, T - O),
    w
  if (_[4] !== A)
    (w = n9(A, { mostSignificantOnly: !0 })), (_[4] = A), (_[5] = w)
  else w = _[5]
  let j = w,
    J
  if (_[6] === Symbol.for('react.memo_cache_sentinel'))
    (J = y_.createElement(V, { dimColor: !0 }, 'backend ')), (_[6] = J)
  else J = _[6]
  let M
  if (_[7] !== Y.backend)
    (M = y_.createElement(V, null, J, Y.backend)),
      (_[7] = Y.backend),
      (_[8] = M)
  else M = _[8]
  let D
  if (_[9] === Symbol.for('react.memo_cache_sentinel'))
    (D = y_.createElement(V, { dimColor: !0 }, 'dir ')), (_[9] = D)
  else D = _[9]
  let f
  if (_[10] !== q.id) (f = b4(q.id)), (_[10] = q.id), (_[11] = f)
  else f = _[11]
  let X
  if (_[12] !== f)
    (X = y_.createElement(V, null, D, f)), (_[12] = f), (_[13] = X)
  else X = _[13]
  let P
  if (_[14] === Symbol.for('react.memo_cache_sentinel'))
    (P = y_.createElement(V, { dimColor: !0 }, 'cwd ')), (_[14] = P)
  else P = _[14]
  let G = Y.worktreePath ?? Y.cwd,
    W
  if (_[15] !== G)
    (W = y_.createElement(V, null, P, G)), (_[15] = G), (_[16] = W)
  else W = _[16]
  let Z
  if (_[17] !== W || _[18] !== M || _[19] !== X)
    (Z = y_.createElement(B, { flexDirection: 'column' }, M, X, W)),
      (_[17] = W),
      (_[18] = M),
      (_[19] = X),
      (_[20] = Z)
  else Z = _[20]
  let L
  if (_[21] !== q.id || _[22] !== Y.backend)
    (L =
      Y.backend === 'daemon'
        ? y_.createElement(
            V,
            null,
            y_.createElement(V, { dimColor: !0 }, 'shell '),
            'claude attach ',
            q.id,
          )
        : null),
      (_[21] = q.id),
      (_[22] = Y.backend),
      (_[23] = L)
  else L = _[23]
  let k
  if (_[24] === Symbol.for('react.memo_cache_sentinel'))
    (k = y_.createElement(V, { dimColor: !0 }, 'session ')), (_[24] = k)
  else k = _[24]
  let v
  if (_[25] !== Y.sessionId)
    (v = y_.createElement(V, null, k, Y.sessionId)),
      (_[25] = Y.sessionId),
      (_[26] = v)
  else v = _[26]
  let E
  if (_[27] === Symbol.for('react.memo_cache_sentinel'))
    (E = y_.createElement(V, { dimColor: !0 }, 'version ')), (_[27] = E)
  else E = _[27]
  let h
  if (_[28] !== Y.cliVersion)
    (h =
      Y.cliVersion === void 0
        ? y_.createElement(V, { dimColor: !0 }, '\u2014')
        : Y.cliVersion ===
            {
              ISSUES_EXPLAINER:
                'report the issue at https://github.com/anthropics/claude-code/issues',
              PACKAGE_URL: '@anthropic-ai/claude-code',
              README_URL: 'https://code.claude.com/docs/en/overview',
              VERSION: '2.1.153',
              FEEDBACK_CHANNEL:
                'https://github.com/anthropics/claude-code/issues',
              BUILD_TIME: '2026-05-27T20:03:21Z',
              GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
            }.VERSION
          ? Y.cliVersion
          : y_.createElement(
              y_.Fragment,
              null,
              y_.createElement(V, { color: 'warning' }, Y.cliVersion),
              y_.createElement(
                V,
                { dimColor: !0 },
                ' \xB7 current ',
                {
                  ISSUES_EXPLAINER:
                    'report the issue at https://github.com/anthropics/claude-code/issues',
                  PACKAGE_URL: '@anthropic-ai/claude-code',
                  README_URL: 'https://code.claude.com/docs/en/overview',
                  VERSION: '2.1.153',
                  FEEDBACK_CHANNEL:
                    'https://github.com/anthropics/claude-code/issues',
                  BUILD_TIME: '2026-05-27T20:03:21Z',
                  GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
                }.VERSION,
              ),
            )),
      (_[28] = Y.cliVersion),
      (_[29] = h)
  else h = _[29]
  let C
  if (_[30] !== h)
    (C = y_.createElement(V, null, E, h)), (_[30] = h), (_[31] = C)
  else C = _[31]
  let I
  if (_[32] === Symbol.for('react.memo_cache_sentinel'))
    (I = y_.createElement(V, { dimColor: !0 }, 'updated ')), (_[32] = I)
  else I = _[32]
  let b
  if (_[33] !== j)
    (b = y_.createElement(V, null, I, j, ' ago')), (_[33] = j), (_[34] = b)
  else b = _[34]
  let m
  if (_[35] !== L || _[36] !== v || _[37] !== C || _[38] !== b)
    (m = y_.createElement(B, { flexDirection: 'column' }, L, v, C, b)),
      (_[35] = L),
      (_[36] = v),
      (_[37] = C),
      (_[38] = b),
      (_[39] = m)
  else m = _[39]
  let S
  if (_[40] !== Z || _[41] !== m)
    (S = y_.createElement(
      B,
      { flexShrink: 0, paddingX: 2, flexDirection: 'row', gap: 4 },
      Z,
      m,
    )),
      (_[40] = Z),
      (_[41] = m),
      (_[42] = S)
  else S = _[42]
  return S
}
function ghO() {
  return Date.now()
}
function QhO(H) {
  let _ = uTH.c(3),
    { children: q } = H
  if (k86()) {
    let K
    if (_[0] === Symbol.for('react.memo_cache_sentinel'))
      (K = cw_()), (_[0] = K)
    else K = _[0]
    let O
    if (_[1] !== q)
      (O = y_.createElement(ME_, { mouseTracking: K }, q)),
        (_[1] = q),
        (_[2] = O)
    else O = _[2]
    return O
  }
  return q
}
function dhO() {
  if (n_() === 'windows')
    process.env.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT ??= '1'
}
async function chO(H, _) {
  HC6(),
    KC6(),
    ftK(_?.dispatchExtraArgs ?? []),
    c('tengu_bg_agent_action', { action: 'list_open' })
  let q = []
  function K() {
    let f
    while ((f = process.stdin.read()) !== null) {
      if ((typeof f === 'string' ? Buffer.from(f, 'utf8') : f).includes(3)) {
        process.emit('SIGINT')
        return
      }
      q.push(f)
    }
  }
  process.stdin.on('readable', K)
  let O = _?.cwdFilter ? await x$(Bs.resolve(_.cwdFilter)) : void 0,
    T = pw4(_?.dispatchDefaults)
  H7(GtK), H7(tL6('claude agents'))
  let z = H,
    $ = process.env.CLAUDE_AGENTS_SELECT,
    Y = !!$
  delete process.env.CLAUDE_AGENTS_SELECT
  let A = await T34(await x$(S_())),
    w = A?.q || void 0,
    j = A?.collapsed
  fS6()
  let J, M, D
  process.stdin.off('readable', K)
  while (q.length) process.stdin.unshift(q.pop())
  for (;;) {
    let f = await new Promise(Z => {
        z.render(
          y_.createElement(
            QhO,
            null,
            y_.createElement(
              AM,
              {
                initialState: D && {
                  ...D,
                  notifications: { current: null, queue: [] },
                },
                onChangeAppState: ({ newState: L }) => {
                  D = L
                },
              },
              y_.createElement(
                w96,
                null,
                y_.createElement(
                  MD,
                  null,
                  y_.createElement(Vj4, {
                    onAction: Z,
                    initialJobId: $,
                    enteredViaLeftArrow: Y,
                    initialQuery: w,
                    initialCollapsed: j,
                    initialError: J,
                    initialGroupMode: M,
                    cwdFilter: O,
                    dispatchDefaults: T,
                  }),
                ),
              ),
            ),
          ),
        )
      }),
      X = k86()
    if (X && f.type === 'open') J5.get(process.stdout)?.handoffAltScreen()
    if (n_() === 'windows' && f.type === 'open')
      J5.get(process.stdout)?.handoffRawMode()
    if (!X) z.render(null)
    if ((z.unmount(), (J = void 0), f.type === 'done')) break
    if (n_() === 'windows' && process.stdin.isTTY)
      EN(process.stdin, !0), process.stdin.ref()
    let P = X ? en(() => void process.stdout.write(YC())) : () => {}
    ;($ = f.job.id),
      (w = f.query),
      (j = f.collapsed),
      (M = f.groupMode),
      (O1q = f.jobs),
      (wj4 = f.loopKicks),
      (jj4 = f.statuses),
      (Jj4 = f.statusesTs),
      (t4q = f.prStatuses),
      (Mj4 = !0)
    let G = Date.now(),
      W =
        f.respawnResult ??
        (await jC6(
          f.job.id,
          f.freshDispatch
            ? void 0
            : {
                knownState: f.job.state,
                knownAlive:
                  Date.now() - f.statusesTs < 1500 &&
                  f.statuses.get(
                    f.job.state.resumeSessionId ?? f.job.state.sessionId,
                  ) !== void 0
                    ? !0
                    : void 0,
              },
        ))
    if (
      (N(
        `[FV-attach] respawnJob ${f.job.id}: ok=${W.ok} alive=${!W.ok && W.alive} err=${W.ok ? '' : W.error}`,
      ),
      W.ok || W.alive)
    ) {
      s4q('attach', f.job.state, {
        jobId: f.job.id,
        attachShort: W.short ?? f.job.id,
      }),
        process.stdout.write(zf(Sw.SET_TITLE_AND_ICON, DC6(f.job.state, !0)))
      let Z = Date.now(),
        L = E =>
          wtK(E, { alreadyInAlt: X }).catch(h => {
            return (
              hH(h),
              uH('job_attach', 'threw'),
              { kind: 'error', msg: `Couldn't attach \u2014 ${LH(h)}` }
            )
          }),
        k = await L(W.short ?? f.job.id),
        v = !1
      if (k.kind === 'error' && k.orphaned && !Z1H(f.job.state)) {
        let E = await jC6(f.job.id, { force: !0, knownState: f.job.state })
        if (E.ok || E.alive) (v = !0), (k = await L(E.short ?? f.job.id))
        else k = { kind: 'error', msg: E.error }
      }
      if (k.kind === 'error' && !k.ended)
        if (((J = k.msg), v && k.orphaned))
          e_('fleet_view_open', 'recovered_then_crashed')
        else
          uH('fleet_view_open', v ? 'orphan_recovery_failed' : 'attach_failed')
      else {
        if (k.msg) J = k.msg
        SH('fleet_view_open')
      }
      s4q('detach', f.job.state, { attachDurationMs: Date.now() - Z }),
        N(
          `[FV-attach] attachJob returned after ${Date.now() - G}ms \u2014 remounting list`,
        )
    } else (J = W.error), uH('fleet_view_open', 'respawn_failed')
    if ((o9_(), X)) process.stdout.write(BwH())
    ;(z = await cj_({ exitOnCtrlC: !1 })), N('[PERF:bg-remount-start]'), P()
  }
}
var uTH,
  _j4,
  qj4,
  Kj4,
  Bs,
  y_,
  U8,
  Oj4,
  MC6,
  _hO = 3,
  qhO = 4,
  KhO = 2,
  OC6 = 3600000,
  Tj4 = 21600000,
  n4q = 'CLAUDE_AGENTS_AUTO_RELAUNCHED_AT',
  c4q,
  cw4,
  lw4,
  YhO = 3,
  AhO = 10,
  nw4 = 3,
  whO = 60000,
  jhO = 30000,
  wC6,
  O1q = null,
  wj4,
  jj4,
  Jj4 = 0,
  t4q,
  Mj4 = !1,
  $C6,
  e4q,
  H1q,
  Dj4,
  iw4,
  rw4 = 8,
  ow4 = 5,
  Pj4 = 500,
  ZhO,
  EhO,
  tw4,
  ew4
var PC6 = R(() => {
  F4()
  k9()
  tmH()
  J_()
  bP()
  OPH()
  Av6()
  sHq()
  mT()
  A7q()
  w7q()
  A9()
  Mc()
  NNH()
  Pq()
  DR_()
  AW6()
  PJ_()
  WE6()
  hOH()
  Yd()
  We8()
  lK()
  c3()
  O1H()
  LqH()
  jx()
  _o8()
  wcH()
  Lf8()
  PqH()
  U9()
  Rf8()
  Gh_()
  eS6()
  N4q()
  uSH()
  jM8()
  tq6()
  bkH()
  Qj_()
  O96()
  t2()
  lQ()
  O4()
  SN()
  lLH()
  Cw()
  iH()
  t6q()
  GKq()
  Ly_()
  YY()
  gB()
  H8q()
  Ry6()
  A6()
  i6()
  N_()
  Ku()
  NO()
  Q4q()
  zu()
  i8()
  V0()
  d4q()
  xd()
  sA()
  B5()
  F3()
  n6()
  Dq()
  lH()
  c_()
  W_()
  fq()
  iq()
  zO()
  mX_()
  JK()
  EkH()
  zR()
  W6()
  oN_()
  mq()
  X1()
  k_H()
  $9()
  LI()
  oW()
  Wv_()
  HkH()
  nj()
  i_()
  R8()
  lV()
  utH()
  Uw4()
  dw4()
  ;(uTH = p(q_(), 1)),
    (_j4 = require('crypto')),
    (qj4 = require('fs')),
    (Kj4 = require('fs/promises')),
    (Bs = require('path')),
    (y_ = p(PH(), 1)),
    (U8 = p(PH(), 1)),
    (Oj4 = require('readline')),
    (MC6 = require('url'))
  c4q = /[\x00-\x08\x0E-\x1F\x7F-\x9F]/g
  ;(cw4 = ['review', 'blocked', 'working', 'done']),
    (lw4 = {
      review: 'Ready for review',
      blocked: 'Needs input',
      working: 'Working',
      done: 'Completed',
    })
  wC6 = class wC6 extends Error {
    constructor(H) {
      super(H)
      this.name = 'FleetActionUnconfirmedError'
    }
  }
  wj4 = new Map()
  ;(jj4 = new Map()),
    (t4q = new Map()),
    ($C6 = new Map()),
    (e4q = new Map()),
    (H1q = new Map()),
    (Dj4 = new Map())
  iw4 = { error: 2, warning: 1 }
  ZhO = { error: 3, warning: 2, success: 1 }
  ;(EhO = {
    agent: 'background',
    repo: 'repo',
    skill: 'skill',
    routine: 'routine',
  }),
    (tw4 = []),
    (ew4 = [])
})
function A1q() {
  return Promise.all([
    Promise.resolve().then(() => (iH(), $x)),
    Promise.resolve().then(() => (PC6(), XC6)),
  ])
}
async function vj4(H, _) {
  let q = W1H().catch(() => [])
  await g3(yG(), 2000, 'flush timeout').catch(() => {})
  let K = setInterval(() => {}, 1073741824)
  GX_(),
    J5.get(process.stdout)?.unmount(),
    await new Promise(w => setImmediate(w)),
    bL8(),
    (process.env.CLAUDE_AGENTS_SELECT = H)
  let [
    { createRoot: O },
    { mountFleetView: T, seedLastJobs: z, applyFleetViewHostWindowsEnv: $ },
  ] = await (_ ?? A1q())
  $()
  let Y = await O({ exitOnCtrlC: !1 })
  clearInterval(K)
  let A = await g3(q, 50, 'listJobs seed').catch(() => null)
  if (A !== null) z(A)
  N('[PERF:bg-leftarrow-mounted]'),
    await T(Y),
    await O7(0, 'other', { suppressResumeHint: !0 }),
    process.exit(0)
}
var yj4 = R(() => {
  t2()
  YY()
  lH()
  pT()
  YK()
})
async function Sj4(H, _, q, K, O, T, z) {
  N('[PERF:bg-leftarrow-start]')
  let $ = Vy6(H, '')
  if ($ !== null && M2H())
    return 'Cannot open agents \u2014 session persistence is disabled, so this conversation cannot be backgrounded.'
  if ($ && !$.name && z) ($.name = z), ($.nameSource = 'auto')
  let Y = $ ?? { intent: '' },
    A = A1q(),
    w = hj4.randomUUID(),
    j = Fz(),
    J = Boolean(j && !j.enteredExisting),
    M,
    D
  try {
    ;({ short: M, jobDir: D } = await A8q(w, {
      ...Y,
      cwd: j?.worktreePath ?? A8(),
      worktree: J
        ? {
            path: j.worktreePath,
            branch: j.worktreeBranch,
            hookBased: j.hookBased ?? !1,
            originCwd: j.originalCwd,
          }
        : void 0,
      sessionPermissionRules:
        (O.session?.length ?? 0) > 0 || (T.session?.length ?? 0) > 0
          ? { allow: [...(O.session ?? [])], deny: [...(T.session ?? [])] }
          : void 0,
      memoryToggledOff: wS() || void 0,
    }))
  } catch (X) {
    return `Cannot open agents \u2014 ${X instanceof Error ? X.message : String(X)}`
  }
  c('tengu_open_agents_via_left', { was_empty: $ === null })
  let f = kG()
  if (f)
    await g3(f.flush(), 2000, 'bridge flush').catch(() => {}),
      f.teardown({ skipArchive: !0 })
  if (
    (ky6(Y, null, _, q, K, O, T, 'left_arrow', H, {
      providedSessionId: w,
      extraEnv: VjH(
        f?.bridgeSessionId,
        f?.getLastSequenceNum(),
        f?.outboundOnly,
      ),
    }).then(X => {
      if (!X.ok)
        Ej4.rm(D, { recursive: !0, force: !0 }).catch(() => {}),
          hH(Error(`background spawn failed: ${X.error}`))
    }),
    G_('tengu_bg_leftarrow_inprocess', !0))
  )
    try {
      return await vj4(M, A)
    } catch (X) {
      hH(X)
    }
  return cPH({ args: ['agents'], env: { CLAUDE_AGENTS_SELECT: M } })
}
var hj4, Ej4
var Cj4 = R(() => {
  J_()
  _l()
  Ny_()
  YY()
  i6()
  N_()
  lH()
  W6()
  Wv_()
  YK()
  u0()
  M8q()
  yj4()
  ;(hj4 = require('crypto')), (Ej4 = require('fs/promises'))
})
function Ij4() {
  let H = AS() ?? _0(A8())
  return Fq_.join(H, h_(), 'mcp-tasks')
}
function bj4(H) {
  return Fq_.join(Ij4(), `mcp-task-${H}.meta.json`)
}
async function xj4(H, _) {
  let q = bj4(H)
  await r7().mkdir(Fq_.dirname(q)), await r7().write(q, CH(_))
}
async function uj4(H) {
  let _ = bj4(H)
  try {
    await r7().delete(_)
  } catch (q) {
    if (_7(q)) return
    throw q
  }
}
async function mj4() {
  let H = Ij4(),
    _
  try {
    _ = await r7().list(H)
  } catch (K) {
    if (_7(K)) return []
    throw K
  }
  let q = []
  for (let K of _) {
    if (!K.endsWith('.meta.json')) continue
    try {
      let O = await r7().read(Fq_.join(H, K))
      q.push(B_(O))
    } catch (O) {
      N(`listMcpTaskMetadata: skipping ${K}: ${String(O)}`)
    }
  }
  return q
}
var Fq_
var pj4 = R(() => {
  J_()
  BR()
  lH()
  W_()
  nj()
  i_()
  Fq_ = require('path')
})
async function RE_(H) {
  try {
    await uj4(H)
  } catch (_) {
    N(`removeMcpTaskMetadata failed: ${String(_)}`)
  }
}
function w1q(H) {
  return H === 'completed' || H === 'failed' || H === 'cancelled'
}
function ohO(H, _, q) {
  let K = j1q.get(H)
  if (!K)
    (K = new Map()),
      j1q.set(H, K),
      H.setNotificationHandler(E0H, O => {
        j1q.get(H)?.get(O.params.taskId)?.(
          O.params.status,
          O.params.statusMessage,
        )
      })
  return (
    K.set(_, q),
    () => {
      K.delete(_)
    }
  )
}
function Uj4(H) {
  let q = `MCP task ${H.mcpTaskId.slice(0, 8)} (${H.serverName}/${H.toolName}) ${H.status}.`,
    K =
      H.status === 'completed'
        ? (H.resultText ?? '')
        : H.status === 'failed'
          ? `Task failed: ${H.statusMessage ?? 'no detail'}`
          : 'Task was cancelled by the server.'
  return `<${HO}>
<${CJ}>${H.registryId}</${CJ}>
<${Gw}>${H.status}</${Gw}>
<${Vz}>${wO(q)}</${Vz}>
<result>
${wO(K)}
</result>
</${HO}>`
}
function ahO(H) {
  return shO(H).catch(_ => hH(_))
}
async function shO({
  client: H,
  taskRegistry: _,
  taskState: q,
  pollIntervalMs: K,
}) {
  let { id: O, mcpTaskId: T, serverName: z, toolName: $ } = q,
    Y = q.mcpStatus,
    A = q.statusMessage
  xj4(O, {
    taskId: O,
    serverName: z,
    toolName: $,
    mcpTaskId: T,
    pollIntervalMs: K,
    spawnedAt: q.startTime,
    toolUseId: q.toolUseId,
  }).catch(f => N(`writeMcpTaskMetadata ${O}: ${String(f)}`))
  let w = (f, X) => {
      if (f === Y && X === A) return
      if (w1q(Y) && !w1q(f)) return
      ;(Y = f),
        (A = X),
        _.update(O, P => ({ ...P, mcpStatus: f, statusMessage: X }))
    },
    j = ohO(H, T, w),
    J = Math.min(Math.max(K ?? lhO, nhO), ihO),
    M = 0,
    D
  try {
    while (!w1q(Y)) {
      if (Y === 'input_required')
        try {
          await H.experimental.tasks.getTaskResult(T, kS)
        } catch (X) {
          N(`mcp task ${T} getTaskResult during input_required: ${X}`)
        }
      if ((await r6(J), _.get(O)?.status === 'killed')) {
        H.experimental.tasks
          .cancelTask(T)
          .catch(X => N(`mcp task ${T} cancel after kill: ${X}`)),
          RE_(O)
        return
      }
      try {
        let X = await H.experimental.tasks.getTask(T)
        ;(M = 0), w(X.status, X.statusMessage)
      } catch (X) {
        if ((M++, N(`mcp task ${T} poll failed: ${X}`), M >= rhO)) {
          ;(Y = 'failed'),
            (A = `Task polling failed repeatedly: ${String(X)}`),
            (D = 'poll_failed_repeatedly')
          break
        }
      }
    }
    let f
    if (Y === 'completed')
      try {
        let P = (
            (await H.experimental.tasks.getTaskResult(T, kS)).content ?? []
          )
            .map(W => (W.type === 'text' ? W.text : `[${W.type}]`))
            .join(`
`),
          G = await eL_(P)
        f = typeof G === 'string' ? G : P
      } catch (X) {
        ;(Y = 'failed'),
          (A = `Failed to fetch task result: ${String(X)}`),
          (D = 'result_fetch_failed')
      }
    if (_.get(O)?.status === 'killed') {
      H.experimental.tasks
        .cancelTask(T)
        .catch(X => N(`mcp task ${T} cancel after kill: ${X}`)),
        RE_(O)
      return
    }
    if (Y === 'completed') SH('mcp_task_complete')
    else if (Y === 'cancelled') uH('mcp_task_complete', 'cancelled_by_server')
    else uH('mcp_task_complete', D ?? 'failed')
    _.update(O, X => ({
      ...X,
      status: Y === 'completed' ? 'completed' : 'failed',
      mcpStatus: Y,
      statusMessage: A,
      endTime: Date.now(),
      notified: !0,
    })),
      RE_(O),
      oO({
        value: Uj4({
          registryId: O,
          mcpTaskId: T,
          serverName: z,
          toolName: $,
          status: Y,
          resultText: f,
          statusMessage: A,
        }),
        mode: 'task-notification',
        priority: 'next',
      })
  } finally {
    j()
  }
}
async function J1q(H) {
  if (!JG6()) return
  let _
  try {
    _ = await mj4()
  } catch (q) {
    uH('mcp_task_restore', 'list_failed'),
      N(`restoreMcpTasks list failed: ${String(q)}`)
    return
  }
  for (let q of _)
    thO(q, H).catch(K => N(`restoreMcpTasks ${q.taskId}: ${String(K)}`))
  SH('mcp_task_restore')
}
async function thO(H, { taskRegistry: _, getMcpClients: q }) {
  let K = {
    ...J2(H.taskId, 'mcp_task', `${H.serverName}/${H.toolName}`, H.toolUseId),
    type: 'mcp_task',
    status: 'running',
    serverName: H.serverName,
    toolName: H.toolName,
    mcpTaskId: H.mcpTaskId,
    mcpStatus: 'working',
    statusMessage: 'reconnecting\u2026',
    pollIntervalMs: H.pollIntervalMs,
    startTime: H.spawnedAt,
  }
  _.register(K)
  let O = Date.now() + Bj4,
    T,
    z
  while (Date.now() < O) {
    if (_.get(H.taskId)?.status === 'killed') {
      RE_(H.taskId)
      return
    }
    let $ = q().find(Y => Y.name === H.serverName)
    if ($?.type === 'connected') {
      T = $.client
      break
    }
    if (
      $?.type === 'failed' ||
      $?.type === 'disabled' ||
      $?.type === 'needs-auth'
    ) {
      z = `server '${H.serverName}' is ${$.type}`
      break
    }
    await r6(500)
  }
  if (!T) {
    ;(z ??= `server '${H.serverName}' did not connect within ${Bj4 / 1000}s`),
      _.update(H.taskId, $ => ({
        ...$,
        status: 'failed',
        mcpStatus: 'failed',
        statusMessage: z,
        endTime: Date.now(),
        notified: !0,
      })),
      RE_(H.taskId),
      oO({
        value: Uj4({
          registryId: H.taskId,
          mcpTaskId: H.mcpTaskId,
          serverName: H.serverName,
          toolName: H.toolName,
          status: 'failed',
          statusMessage: `Could not reconnect after resume: ${z}`,
        }),
        mode: 'task-notification',
        priority: 'next',
      })
    return
  }
  ahO({
    client: T,
    taskRegistry: _,
    taskState: K,
    pollIntervalMs: H.pollIntervalMs,
  })
}
var lhO = 2000,
  nhO = 100,
  ihO = 60000,
  rhO = 10,
  Bj4 = 30000,
  j1q
var Fj4 = R(() => {
  nf()
  B3()
  $2()
  lH()
  W6()
  pj4()
  Hk_()
  f$()
  Sh()
  A6()
  cd8()
  j1q = new WeakMap()
})
function M1q(H) {
  try {
    HEO(ehO(H))
  } catch (_) {
    hH(_)
  }
}
function ehO(H) {
  let _ = [],
    q = new Map(),
    K = new Set()
  for (let O of H)
    if (O.type === 'assistant') {
      let T = O.message.content
      if (!Array.isArray(T)) continue
      let z = Date.parse(O.timestamp)
      for (let $ of T) {
        if ($.type !== 'tool_use') continue
        let Y = gj4($.input) ? $.input : {}
        if ($.name === iP) _.push({ toolUseId: $.id, input: Y, createdAt: z })
        else if ($.name === uC) {
          if (typeof Y.id === 'string') K.add(Y.id)
        }
      }
    } else if (O.type === 'user') {
      let T = O.message.content
      if (!Array.isArray(T)) continue
      let z = O.toolUseResult
      if (!gj4(z)) continue
      for (let $ of T)
        if ($.type === 'tool_result' && !$.is_error) q.set($.tool_use_id, z)
    }
  return { calls: _, results: q, deletedCronIds: K }
}
function HEO({ calls: H, results: _, deletedCronIds: q }) {
  if (!bh()) return
  let K = Date.now(),
    O = PJH(),
    T = new Set(MZ().map($ => $.id)),
    z = 0
  for (let $ of H) {
    let Y = _.get($.toolUseId)
    if (!Y || typeof Y.id !== 'string') continue
    if (Y.durable === !0) continue
    if (q.has(Y.id) || T.has(Y.id)) continue
    let A = $.input.cron,
      w = $.input.prompt
    if (typeof A !== 'string' || typeof w !== 'string') continue
    let j = Y.recurring !== !1
    if (j) {
      if (O.recurringMaxAgeMs !== 0 && K - $.createdAt >= O.recurringMaxAgeMs)
        continue
    } else {
      let J = v16(A, $.createdAt, Y.id, O)
      if (J === null || J < K) continue
    }
    gWH({ id: Y.id, cron: A, prompt: w, createdAt: $.createdAt, recurring: j }),
      z++
  }
  if (z > 0) Pn(!0), N(`resume: resurrected ${z} session cron task(s)`)
}
function gj4(H) {
  return typeof H === 'object' && H !== null
}
var Qj4 = R(() => {
  J_()
  fB()
  AD_()
  Nx()
  lH()
  W6()
})
function WC6(H) {
  if (IZ()) return
  if (CT()) return jT()
  if (Hh(H.teamContext)) {
    let _ = H.teamContext.leadAgentId
    return H.teamContext.teammates[_]?.name || 'team-lead'
  }
  return
}
function qEO(H) {
  let _ = H.startsWith('mcp__')
  return {
    name: H,
    userFacingName: () => (_ ? `${H} (MCP)` : H),
    renderToolUseMessage: () => H,
    isMcp: _,
  }
}
function dj4({
  enabled: H,
  isLoading: _,
  focusedInputDialog: q,
  onSubmitMessage: K,
  requestDialog: O,
}) {
  let T = K,
    z = u1(),
    $ = qq(),
    Y = ZM(),
    A = M_(f => f.inbox.messages.length),
    w = xHH(),
    j = Q2H.useRef(new Set()),
    J = Q2H.useCallback(async () => {
      if (!H) return
      let f = z.getState(),
        X = WC6(f)
      if (!X) return
      let P = await HhH(X, f.teamContext?.teamName)
      if (P.length === 0) return
      if (
        (N(`[InboxPoller] Found ${P.length} unread message(s)`), CT() && Yz_())
      )
        for (let x of P) {
          let U = JsH(x.text)
          if (U && x.from === 'team-lead')
            if (
              (N(
                `[InboxPoller] Received plan approval response from team-lead: approved=${U.approved}`,
              ),
              U.approved)
            ) {
              let g = U.permissionMode ?? 'default'
              $(Q => ({
                ...Q,
                toolPermissionContext: uz(Q.toolPermissionContext, {
                  type: 'setMode',
                  mode: _i(g),
                  destination: 'session',
                }),
              })),
                N(
                  `[InboxPoller] Plan approved by team lead, exited plan mode to ${g}`,
                )
            } else
              N(
                `[InboxPoller] Plan rejected by team lead: ${U.feedback || 'No feedback provided'}`,
              )
          else if (U)
            N(
              `[InboxPoller] Ignoring plan approval response from non-team-lead: ${x.from}`,
            )
        }
      let G = () => {
          a0_(X, f.teamContext?.teamName)
        },
        W = [],
        Z = [],
        L = [],
        k = [],
        v = [],
        E = [],
        h = [],
        C = [],
        I = [],
        b = []
      for (let x of P) {
        let U = HZ_(x.text),
          g = _hH(x.text),
          Q = yD6(x.text),
          l = _Z_(x.text),
          d = MfH(x.text),
          r = zI(x.text),
          a = CD6(x.text),
          s = bD6(x.text),
          _H = qhH(x.text)
        if (U) W.push(x)
        else if (g) Z.push(x)
        else if (Q) L.push(x)
        else if (l) k.push(x)
        else if (d) v.push(x)
        else if (r) E.push(x)
        else if (a) h.push(x)
        else if (s) C.push(x)
        else if (_H) I.push(x)
        else b.push(x)
      }
      if (W.length > 0 && Hh(f.teamContext)) {
        N(`[InboxPoller] Found ${W.length} permission request(s)`)
        let x = f.teamContext?.teamName
        for (let g of W) {
          let Q = HZ_(g.text)
          if (!Q) continue
          if (j.current.has(Q.request_id)) continue
          j.current.add(Q.request_id)
          let l = Z4(Ba(), Q.tool_name) ?? qEO(Q.tool_name),
            { dialog: d, descriptor: r } = sfH({
              tool: l,
              input: Q.input,
              description: Q.description,
              toolUseID: Q.tool_use_id,
              permissionResult: { behavior: 'ask', message: Q.description },
              assistantMessage: kf({ content: '' }),
              theme: 'dark',
              workerBadge: { name: Q.agent_id, color: g.color ?? 'cyan' },
              toolPermissionContext: f.toolPermissionContext,
            })
          O(d, r).then(a => {
            switch ((j.current.delete(Q.request_id), a.behavior)) {
              case 'allow':
                FD6(
                  Q.agent_id,
                  {
                    decision: 'approved',
                    resolvedBy: 'leader',
                    updatedInput: a.updatedInput,
                    permissionUpdates: a.permissionUpdates,
                  },
                  Q.request_id,
                  x,
                )
                return
              case 'deny':
                FD6(
                  Q.agent_id,
                  {
                    decision: 'rejected',
                    resolvedBy: 'leader',
                    feedback: a.feedback,
                  },
                  Q.request_id,
                  x,
                )
                return
              case 'cancelled':
                FD6(
                  Q.agent_id,
                  { decision: 'rejected', resolvedBy: 'leader' },
                  Q.request_id,
                  x,
                )
                return
            }
          })
        }
        let U = HZ_(W[0]?.text ?? '')
        if (U && !_ && !q)
          J8H(
            {
              message: `${U.agent_id} needs permission for ${U.tool_name}`,
              notificationType: 'worker_permission_prompt',
            },
            w,
          )
      }
      if (Z.length > 0 && CT()) {
        N(`[InboxPoller] Found ${Z.length} permission response(s)`)
        for (let x of Z) {
          let U = _hH(x.text)
          if (!U) continue
          if (To7(U.request_id))
            if (
              (N(
                `[InboxPoller] Processing permission response for ${U.request_id}: ${U.subtype}`,
              ),
              U.subtype === 'success')
            )
              WsH({
                requestId: U.request_id,
                decision: 'approved',
                updatedInput: U.response?.updated_input,
                permissionUpdates: U.response?.permission_updates,
              })
            else
              WsH({
                requestId: U.request_id,
                decision: 'rejected',
                feedback: U.error,
              })
        }
      }
      if (L.length > 0 && Hh(f.teamContext)) {
        N(`[InboxPoller] Found ${L.length} sandbox permission request(s)`)
        let { mode: x, isBypassPermissionsModeAvailable: U } =
            f.toolPermissionContext,
          g = KF_(x, U),
          Q = f.teamContext?.teamName
        async function l(r) {
          switch (g) {
            case 'allow':
              return !0
            case 'deny':
              return !1
            case 'classify':
              return Sz6(
                r,
                void 0,
                [],
                Ba(),
                f.toolPermissionContext,
                new AbortController().signal,
              )
            case 'ask':
              return null
          }
        }
        let d = []
        for (let r of L) {
          let a = yD6(r.text)
          if (!a) continue
          if (!a.hostPattern?.host) {
            N(
              '[InboxPoller] Invalid sandbox permission request: missing hostPattern.host',
            )
            continue
          }
          let s = await l(a.hostPattern.host)
          if (s !== null) {
            N(
              `[InboxPoller] Auto-resolving sandbox request ${a.requestId} (mode=${x}, allow=${s})`,
            ),
              gD6(a.workerName, a.requestId, a.hostPattern.host, s, Q)
            continue
          }
          d.push({
            requestId: a.requestId,
            workerId: a.workerId,
            workerName: a.workerName,
            workerColor: a.workerColor,
            host: a.hostPattern.host,
            createdAt: a.createdAt,
          })
        }
        if (d.length > 0) {
          $(a => ({
            ...a,
            workerSandboxPermissions: {
              ...a.workerSandboxPermissions,
              queue: [...a.workerSandboxPermissions.queue, ...d],
            },
          }))
          let r = d[0]
          if (r && !_ && !q)
            J8H(
              {
                message: `${r.workerName} needs network access to ${r.host}`,
                notificationType: 'worker_permission_prompt',
              },
              w,
            )
        }
      }
      if (k.length > 0 && CT()) {
        N(`[InboxPoller] Found ${k.length} sandbox permission response(s)`)
        for (let x of k) {
          let U = _Z_(x.text)
          if (!U) continue
          if (Yo7(U.requestId))
            N(
              `[InboxPoller] Processing sandbox permission response for ${U.requestId}: allow=${U.allow}`,
            ),
              Ao7({ requestId: U.requestId, host: U.host, allow: U.allow }),
              $(g => ({ ...g, pendingSandboxRequest: null }))
        }
      }
      if (h.length > 0 && CT()) {
        N(`[InboxPoller] Found ${h.length} team permission update(s)`)
        for (let x of h) {
          let U = CD6(x.text)
          if (!U) {
            N(
              `[InboxPoller] Failed to parse team permission update: ${x.text.substring(0, 100)}`,
            )
            continue
          }
          if (!U.permissionUpdate?.rules || !U.permissionUpdate?.behavior) {
            N(
              '[InboxPoller] Invalid team permission update: missing permissionUpdate.rules or permissionUpdate.behavior',
            )
            continue
          }
          N(
            `[InboxPoller] Applying team permission update: ${U.toolName} allowed in ${U.directoryPath}`,
          ),
            N(
              `[InboxPoller] Permission update rules: ${CH(U.permissionUpdate.rules)}`,
            ),
            $(g => {
              let Q = uz(g.toolPermissionContext, {
                type: 'addRules',
                rules: U.permissionUpdate.rules,
                behavior: U.permissionUpdate.behavior,
                destination: 'session',
              })
              return (
                N(
                  `[InboxPoller] Updated session allow rules: ${CH(Q.alwaysAllowRules.session)}`,
                ),
                { ...g, toolPermissionContext: Q }
              )
            })
        }
      }
      if (C.length > 0 && CT()) {
        N(`[InboxPoller] Found ${C.length} mode set request(s)`)
        for (let x of C) {
          if (x.from !== 'team-lead') {
            N(
              `[InboxPoller] Ignoring mode set request from non-team-lead: ${x.from}`,
            )
            continue
          }
          let U = bD6(x.text)
          if (!U) {
            N(
              `[InboxPoller] Failed to parse mode set request: ${x.text.substring(0, 100)}`,
            )
            continue
          }
          let g = KN(U.mode)
          N(`[InboxPoller] Applying mode change from team-lead: ${g}`),
            $(d => ({
              ...d,
              toolPermissionContext: uz(d.toolPermissionContext, {
                type: 'setMode',
                mode: _i(g),
                destination: 'session',
              }),
            }))
          let Q = f.teamContext?.teamName,
            l = jT()
          if (Q && l) _eH(Q, l, g)
        }
      }
      if (I.length > 0 && Hh(f.teamContext)) {
        N(
          `[InboxPoller] Found ${I.length} plan approval request(s), auto-approving`,
        )
        let x = f.teamContext?.teamName,
          U = _i(f.toolPermissionContext.mode),
          g = U === 'plan' ? 'default' : U
        for (let Q of I) {
          let l = qhH(Q.text)
          if (!l) continue
          let d = {
            type: 'plan_approval_response',
            requestId: l.requestId,
            approved: !0,
            timestamp: new Date().toISOString(),
            permissionMode: g,
          }
          gT(
            Q.from,
            { from: gz, text: CH(d), timestamp: new Date().toISOString() },
            x,
          )
          let r = AX6(Q.from, f)
          if (r)
            re7(
              r,
              {
                type: 'plan_approval_response',
                requestId: l.requestId,
                approved: !0,
                timestamp: new Date().toISOString(),
                permissionMode: g,
              },
              Y,
            )
          N(
            `[InboxPoller] Auto-approved plan from ${Q.from} (request ${l.requestId})`,
          ),
            b.push(Q)
        }
      }
      if (v.length > 0 && CT()) {
        N(`[InboxPoller] Found ${v.length} shutdown request(s)`)
        for (let x of v) b.push(x)
      }
      if (E.length > 0 && Hh(f.teamContext)) {
        N(`[InboxPoller] Found ${E.length} shutdown approval(s)`)
        for (let x of E) {
          let U = zI(x.text)
          if (!U) continue
          if (U.paneId && U.backendType)
            (async () => {
              try {
                await atH()
                let Q = await wa(),
                  d = await KEH(U.backendType)?.killPane(U.paneId, !Q)
                N(`[InboxPoller] Killed pane ${U.paneId} for ${U.from}: ${d}`)
              } catch (Q) {
                N(`[InboxPoller] Failed to kill pane for ${U.from}: ${Q}`)
              }
            })()
          let g = U.from
          if (g && f.teamContext?.teammates) {
            let Q = Object.entries(f.teamContext.teammates).find(
              ([, l]) => l.name === g,
            )?.[0]
            if (Q) {
              let l = f.teamContext?.teamName
              if (l) TEH(l, { agentId: Q, name: g })
              let { notificationMessage: d } = l
                ? await LMH(l, Q, g, 'shutdown')
                : { notificationMessage: `${g} has shut down.` }
              $(r => {
                if (!r.teamContext?.teammates) return r
                if (!(Q in r.teamContext.teammates)) return r
                let { [Q]: a, ...s } = r.teamContext.teammates,
                  _H = { ...r.tasks }
                for (let [HH, t] of Object.entries(_H))
                  if (wD(t) && t.identity.agentId === Q)
                    _H[HH] = { ...t, status: 'completed', endTime: Date.now() }
                return {
                  ...r,
                  tasks: _H,
                  teamContext: { ...r.teamContext, teammates: s },
                  inbox: {
                    messages: [
                      ...r.inbox.messages,
                      {
                        id: D1q.randomUUID(),
                        from: 'system',
                        text: CH({ type: 'teammate_terminated', message: d }),
                        timestamp: new Date().toISOString(),
                        status: 'pending',
                      },
                    ],
                  },
                }
              }),
                N(`[InboxPoller] Removed ${g} (${Q}) from teamContext`)
            }
          }
          b.push(x)
        }
      }
      if (b.length === 0) {
        G()
        return
      }
      let m = b
          .map(x => {
            let U = x.color ? ` color="${x.color}"` : '',
              g = x.summary ? ` summary="${x.summary}"` : '',
              Q = x.text
            return `<${eW} teammate_id="${x.from}"${U}${g}>
${Q}
</${eW}>`
          })
          .join(`

`),
        S = () => {
          $(x => ({
            ...x,
            inbox: {
              messages: [
                ...x.inbox.messages,
                ...b.map(U => ({
                  id: D1q.randomUUID(),
                  from: U.from,
                  text: U.text,
                  timestamp: U.timestamp,
                  status: 'pending',
                  color: U.color,
                  summary: U.summary,
                })),
              ],
            },
          }))
        }
      if (!_ && !q) {
        if ((N('[InboxPoller] Session idle, submitting immediately'), !T(m)))
          N('[InboxPoller] Submission rejected, queuing for later delivery'),
            S()
      } else N('[InboxPoller] Session busy, queuing for later delivery'), S()
      G()
    }, [H, _, q, T, $, w, z, Y, O])
  Q2H.useEffect(() => {
    if (!H) return
    if (_ || q) return
    let f = z.getState()
    if (!WC6(f)) return
    let P = f.inbox.messages.filter(L => L.status === 'pending'),
      G = f.inbox.messages.filter(L => L.status === 'processed')
    if (G.length > 0) {
      N(
        `[InboxPoller] Cleaning up ${G.length} processed message(s) that were delivered mid-turn`,
      )
      let L = new Set(G.map(k => k.id))
      $(k => ({
        ...k,
        inbox: { messages: k.inbox.messages.filter(v => !L.has(v.id)) },
      }))
    }
    if (P.length === 0) return
    N(`[InboxPoller] Session idle, delivering ${P.length} pending message(s)`)
    let W = P.map(L => {
      let k = L.color ? ` color="${L.color}"` : '',
        v = L.summary ? ` summary="${L.summary}"` : ''
      return `<${eW} teammate_id="${L.from}"${k}${v}>
${L.text}
</${eW}>`
    }).join(`

`)
    if (T(W)) {
      let L = new Set(P.map(k => k.id))
      $(k => ({
        ...k,
        inbox: { messages: k.inbox.messages.filter(v => !L.has(v.id)) },
      }))
    } else N('[InboxPoller] Submission rejected, keeping messages queued')
  }, [H, _, q, T, $, z])
  let M = H && !!WC6(z.getState())
  N4(() => void J(), M ? _EO : null)
  let D = Q2H.useRef(!1)
  Q2H.useEffect(() => {
    if (!H) return
    if (D.current) return
    if (WC6(z.getState())) (D.current = !0), J()
  }, [H, J, z])
}
var D1q,
  Q2H,
  _EO = 1000
var cj4 = R(() => {
  B3()
  eQ()
  iH()
  S0_()
  i8()
  PI()
  p9()
  RG()
  lH()
  Ku8()
  B8()
  K0()
  gP()
  YDH()
  i_()
  Bc()
  oc()
  OhH()
  KV()
  iG_()
  Pf()
  Yz()
  Kk()
  LW()
  ZsH()
  ;(D1q = require('crypto')), (Q2H = p(PH(), 1))
})
function ij4(H) {
  let _ = lj4.c(7),
    {
      autoConnectIdeFlag: q,
      ideToInstallExtension: K,
      setDynamicMcpConfig: O,
      setShowIdeOnboarding: T,
      setIDEInstallationState: z,
    } = H,
    $,
    Y
  if (_[0] !== q || _[1] !== K || _[2] !== O || _[3] !== z || _[4] !== T)
    ($ = () => {
      if (F8()) return
      if (N7() && !K) return
      let A = function (J) {
          if (!J) return
          if (
            !(
              (b_().autoConnectIde ||
                q ||
                HL() ||
                process.env.CLAUDE_CODE_SSE_PORT ||
                K ||
                xH(process.env.CLAUDE_CODE_AUTO_CONNECT_IDE)) &&
              !cK(process.env.CLAUDE_CODE_AUTO_CONNECT_IDE)
            )
          )
            return
          O(f => {
            if (f?.ide) return f
            return {
              ...f,
              ide: {
                type: J.url.startsWith('ws:') ? 'ws-ide' : 'sse-ide',
                url: J.url,
                ideName: J.name,
                authToken: J.authToken,
                ideRunningInWindows: J.ideRunningInWindows,
                scope: 'dynamic',
              },
            }
          })
        },
        w = CK()
      return (
        yM7(
          A,
          K,
          () => T(!0),
          j => z(j),
          w.signal,
        ),
        () => {
          w.abort(), ZM7()
        }
      )
    }),
      (Y = [q, K, O, T, z]),
      (_[0] = q),
      (_[1] = K),
      (_[2] = O),
      (_[3] = z),
      (_[4] = T),
      (_[5] = $),
      (_[6] = Y)
  else ($ = _[5]), (Y = _[6])
  nj4.useEffect($, Y)
}
var lj4, nj4
var rj4 = R(() => {
  J_()
  GA()
  F3()
  n6()
  c_()
  AD()
  ;(lj4 = p(q_(), 1)), (nj4 = p(PH(), 1))
})
function sj4(H) {
  let _ = oj4.c(14),
    { onBackgroundSession: q, isLoading: K } = H,
    O = u1(),
    T = ZM(),
    [z, $] = aj4.useState(!1),
    Y = fC($, q, OEO),
    A
  if (_[0] !== O || _[1] !== Y || _[2] !== K || _[3] !== T)
    (A = () => {
      if (xH(process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS)) return
      let Z = O.getState()
      if (sc8(Z)) {
        if ((EeH(T), !b_().hasUsedBackgroundTask)) O6(KEO)
      } else if (xH('false') && K) Y()
    }),
      (_[0] = O),
      (_[1] = Y),
      (_[2] = K),
      (_[3] = T),
      (_[4] = A)
  else A = _[4]
  let w = A,
    j = M_(sc8),
    J
  if (_[5] === Symbol.for('react.memo_cache_sentinel'))
    (J = xH('false')), (_[5] = J)
  else J = _[5]
  let M = J,
    D
  if (_[6] !== j || _[7] !== K)
    (D = !F8() && (j || (M && K))), (_[6] = j), (_[7] = K), (_[8] = D)
  else D = _[8]
  let f
  if (_[9] !== D)
    (f = { context: 'Task', isActive: D }), (_[9] = D), (_[10] = f)
  else f = _[10]
  _8('task:background', w, f)
  let X = v1('task:background', 'Task', 'ctrl+b'),
    P = Q8.terminal === 'tmux' && X === 'ctrl+b' ? 'ctrl+b ctrl+b' : X
  if (!K || !z) return null
  let G
  if (_[11] === Symbol.for('react.memo_cache_sentinel'))
    (G = { keyCase: 'lower' }), (_[11] = G)
  else G = _[11]
  let W
  if (_[12] !== P)
    (W = nIH.createElement(
      B,
      { paddingLeft: 2 },
      nIH.createElement(
        V,
        { dimColor: !0 },
        nIH.createElement(z_, { chord: P, action: 'background', format: G }),
      ),
    )),
      (_[12] = P),
      (_[13] = W)
  else W = _[13]
  return W
}
function KEO(H) {
  return H.hasUsedBackgroundTask ? H : { ...H, hasUsedBackgroundTask: !0 }
}
function OEO() {}
var oj4, nIH, aj4
var tj4 = R(() => {
  J_()
  wcH()
  iH()
  kq()
  g0()
  i8()
  PI()
  Va()
  n6()
  d3()
  c_()
  Pq()
  ;(oj4 = p(q_(), 1)), (nIH = p(PH(), 1)), (aj4 = p(PH(), 1))
})
function ej4(H, _) {
  if (_.kind === 'clear') {
    if (!H.has(_.toolUseId)) return H
    let O = new Map(H)
    return O.delete(_.toolUseId), O
  }
  let q = H.get(_.toolUseId)
  if (_.kind === 'background_hint' && q?.kind === _.kind) return H
  let K = new Map(H)
  return K.set(_.toolUseId, _), K
}
function HJ4(H, _) {
  if (H.size === 0) return H
  let q = null
  for (let K of H.keys())
    if (_.has(K)) {
      if (q === null) q = new Map(H)
      q.delete(K)
    }
  return q ?? H
}
function qJ4({
  plan: H,
  sessionId: _,
  taskId: q,
  setMessages: K,
  readFileState: O,
  memorySelector: T,
  sessionEnvVars: z,
  getAppState: $,
  isolationLatch: Y,
  onQueryEvent: A,
}) {
  U$('ultraplan-choice')
  let w = qq(),
    j = ZM()
  async function J(I) {
    switch (I) {
      case 'here':
        oO({
          value: [
            'Ultraplan approved in browser. Here is the plan:',
            '',
            '<ultraplan>',
            H,
            '</ultraplan>',
            '',
            'The user approved this plan in the remote session. Give them a brief summary, then start implementing.',
          ].join(`
`),
          mode: 'task-notification',
        })
        break
      case 'fresh': {
        let b = h_(),
          m = await ZC6.stat(BT()).then(
            () => !0,
            () => !1,
          )
        for await (let S of VV_({
          setMessages: K,
          readFileState: O,
          memorySelector: T,
          sessionEnvVars: z,
          getAppState: $,
          setAppState: w,
          isolationLatch: Y,
        }))
          A(S)
        if (m)
          K(S => [
            ...S,
            y3(
              `Previous session saved \xB7 resume with: claude --resume ${b}`,
              'suggestion',
            ),
          ])
        mw({
          value: `Here is the approved implementation plan:

${H}

Implement this plan.`,
          mode: 'prompt',
        })
        break
      }
      case 'cancel': {
        let b = _J4.join(nw(), `${J66()}-ultraplan.md`)
        await ZC6.writeFile(b, H, { encoding: 'utf-8' }),
          K(m => [
            ...m,
            y3(`Ultraplan rejected \xB7 Plan saved to ${Q5(b)}`, 'suggestion'),
          ])
        break
      }
    }
    j.update(q, b =>
      b.status !== 'running'
        ? b
        : { ...b, status: 'completed', endTime: Date.now() },
    ),
      w(b =>
        b.ultraplanPendingChoice
          ? {
              ...b,
              ultraplanPendingChoice: void 0,
              ultraplanSessionUrl: void 0,
            }
          : b,
      ),
      xu(_)
  }
  let { rows: M, columns: D } = K8(),
    f = Math.min(TEO, Math.max(1, Math.floor(M / 2) - zEO)),
    X = gq_.useMemo(
      () =>
        Rh(H, Math.max(1, D - 4), 'wrap').split(`
`),
      [H, D],
    ),
    P = Math.max(0, X.length - f),
    [G, W] = gq_.useState(0)
  gq_.useEffect(() => W(I => Math.min(I, P)), [P])
  let Z = X.length > f
  function L(I) {
    if (!Z) return
    W(b => Math.max(0, Math.min(b + I, P)))
  }
  function k(I) {
    if (!I.ctrl || I.meta) return
    let b = Math.max(1, Math.floor(f / 2))
    if (I.key === 'd') I.preventDefault(), L(b)
    else if (I.key === 'u') I.preventDefault(), L(-b)
  }
  function v(I) {
    I.preventDefault(), L(I.deltaY > 0 ? 3 : -3)
  }
  let E = X.slice(G, G + f).join(`
`),
    h = G > 0,
    C = G < P
  return PF.createElement(
    b6,
    {
      title: 'Ultraplan approved',
      subtitle: 'How should the plan be implemented?',
      onCancel: () => {},
      isCancelActive: !1,
      hideInputGuide: !0,
    },
    PF.createElement(
      B,
      { flexDirection: 'column', marginBottom: 1, onKeyDown: k, onWheel: v },
      PF.createElement(
        B,
        { flexDirection: 'column', marginBottom: 1 },
        PF.createElement(V, null, E),
        Z &&
          PF.createElement(
            V,
            { dimColor: !0 },
            h ? __.arrowUp : ' ',
            C ? __.arrowDown : ' ',
            ' ',
            G + 1,
            '\u2013',
            Math.min(G + f, X.length),
            ' of',
            ' ',
            X.length,
            ' \xB7 ctrl+u/ctrl+d to scroll',
          ),
      ),
      PF.createElement(s6, {
        options: [
          {
            label: 'Implement here',
            value: 'here',
            description: 'Inject plan into the current conversation',
          },
          {
            label: 'Start new session',
            value: 'fresh',
            description: 'Clear conversation and start with only the plan',
          },
          {
            label: 'Cancel',
            value: 'cancel',
            description: "Don't implement \u2014 save plan and return",
          },
        ],
        onChange: I => void J(I),
      }),
    ),
  )
}
var ZC6,
  _J4,
  PF,
  gq_,
  TEO = 24,
  zEO = 11
var KJ4 = R(() => {
  k9()
  PI()
  J_()
  oR6()
  wf()
  U9()
  iH()
  i8()
  C4()
  f$()
  B8()
  A2()
  VA()
  Sv()
  KQH()
  nK()
  g9()
  ;(ZC6 = require('fs/promises')),
    (_J4 = require('path')),
    (PF = p(PH(), 1)),
    (gq_ = p(PH(), 1))
})
function OJ4({setMessages:H,setIsLoading:_,resetLoadingState:q,setAbortController:K,onBackgroundQuery:O}){let T=M_((w)=>w.foregroundedTaskId),z=M_((w)=>w.foregroundedTaskId?w.tasks[w.foregroundedTaskId]:void 0),$=qq(),Y=Qq_.useRef(0),A=Qq_.useCallback(()=>{if(T){$((w)=>{let j=w.foregroundedTaskId;if(!j)return w;let J=w.tasks[j];if(!J)return{...w,foregroundedTaskId:void 0};return{...w,foregroundedTaskId:void 0,tasks:{...w.tasks,[j]:{...J,isBackgrounded:!0}}}}),H([]),q(),K(null);return}O()},[T,$,H,q,K,O]);return Qq_.useEffect(()=>{if(!T){Y.current=0;return}if(!z||z.type!=="local_agent"){$((j)=>({...j,foregroundedTaskId:void 0})),q(),Y.current=0;return}let w=z.messages??[];if(w.length!==Y.current)Y.current=w.length,H([...w]);if(z.status==="running"){let j=z.abortController;if(j?.signal.aborted){$((J)=>{if(!J.foregroundedTaskId)return J;let M=J.tasks[J.foregroundedTaskId];if(!M)return{...J,foregroundedTaskId:void 0};return{...J,foregroundedTaskId:void 0,tasks:{...J.tasks,[J.foregroundedTaskId]:{...M,isBackgrounded:!0}}}}),q(),K(null),Y.current=0;return}if(_(!0),j)K(j)}else $((j)=>
