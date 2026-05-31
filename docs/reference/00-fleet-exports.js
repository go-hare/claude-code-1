)
K0()
M8()
;(mw4 = p(q_(), 1)), (Uq_ = p(PH(), 1))
})
function gw4(H) {
  let _ = Fw4.c(18),
    { questions: q, ageLabel: K, ageColor: O } = H,
    T = q[0]
  if (!T) return null
  let z
  if (_[0] !== O || _[1] !== K)
    (z = _A.createElement(V, { color: O }, K)),
      (_[0] = O),
      (_[1] = K),
      (_[2] = z)
  else z = _[2]
  let $
  if (_[3] === Symbol.for('react.memo_cache_sentinel'))
    ($ = _A.createElement(V, null, ' ')), (_[3] = $)
  else $ = _[3]
  let Y
  if (_[4] !== T.question)
    (Y = _A.createElement(
      B,
      { flexGrow: 1, width: 0 },
      _A.createElement(V, { bold: !0, wrap: 'truncate' }, T.question),
    )),
      (_[4] = T.question),
      (_[5] = Y)
  else Y = _[5]
  let A
  if (_[6] !== q.length)
    (A =
      q.length > 1 &&
      _A.createElement(
        B,
        { flexShrink: 0, paddingLeft: 1 },
        _A.createElement(
          V,
          { dimColor: !0 },
          '+',
          q.length - 1,
          ' more \xB7 enter to open',
        ),
      )),
      (_[6] = q.length),
      (_[7] = A)
  else A = _[7]
  let w
  if (_[8] !== z || _[9] !== Y || _[10] !== A)
    (w = _A.createElement(B, null, z, $, Y, A)),
      (_[8] = z),
      (_[9] = Y),
      (_[10] = A),
      (_[11] = w)
  else w = _[11]
  let j
  if (_[12] !== T.options)
    (j = T.options.map(HhO)), (_[12] = T.options), (_[13] = j)
  else j = _[13]
  let J
  if (_[14] === Symbol.for('react.memo_cache_sentinel'))
    (J = _A.createElement(
      B,
      { paddingLeft: 5 },
      _A.createElement(V, { dimColor: !0 }, 'or type your own answer below'),
    )),
      (_[14] = J)
  else J = _[14]
  let M
  if (_[15] !== w || _[16] !== j)
    (M = _A.createElement(B, { flexDirection: 'column' }, w, j, J)),
      (_[15] = w),
      (_[16] = j),
      (_[17] = M)
  else M = _[17]
  return M
}
function HhO(H, _) {
  return _A.createElement(
    B,
    { key: H.label, paddingLeft: 2 },
    _A.createElement(
      B,
      { width: 3, flexShrink: 0 },
      _A.createElement(V, { dimColor: !0 }, _ + 1, '.'),
    ),
    _A.createElement(
      B,
      { flexGrow: 1, width: 0 },
      _A.createElement(
        V,
        { wrap: 'truncate' },
        H.label,
        H.description &&
          _A.createElement(V, { dimColor: !0 }, ' \xB7 ', H.description),
      ),
    ),
  )
}
function Qw4(H, _) {
  let q = _?.[0]
  if (!q || H < '1' || H > '9') return null
  let K = Number(H) - 1
  return q.options[K]?.label ?? null
}
var Fw4, _A
var dw4 = R(() => {
  iH()
  ;(Fw4 = p(q_(), 1)), (_A = p(PH(), 1))
})
var XC6 = {}
f_(XC6,{summarizeEvent:()=>Gj4,stateBucket:()=>TC6,spawnOrigin:()=>ZE_,sortJobs:()=>XE_,seedLastJobs:()=>MhO,rollupJobColor:()=>fj4,repoGroupLabel:()=>Zj4,repoGroup:()=>_1q,pruneMap:()=>i4q,pickIcon:()=>kj4,parseQuery:()=>Aj4,parsePrRef:()=>PE_,parseDispatch:()=>a4q,needsRespawn:()=>K1q,mountFleetView:()=>chO,labelReplaceFrame:()=>zj4,jobMatchesPr:()=>r4q,jobMatchesFrame:()=>o4q,jobMatchesCwd:()=>zC6,jobLabel:()=>DC6,isSelfDriving:()=>fC6,isLoopJob:()=>GE_,glyphColor:()=>z1q,formatJobAge:()=>q1q,fleetTitle:()=>$j4,flattenDetail:()=>sl,extractRepoCwd:()=>Y1q,effectiveStateSortOrder:()=>fE_,effectiveSortOrder:()=>JC6,doneCapForRows:()=>Yj4,deriveBand:()=>g2H,deriveActivity:()=>YC6,childStatusColor:()=>$1q,buildPrRefRe:()=>AC6,applyFleetViewHostWindowsEnv:()=>dhO,actionableStatus:
