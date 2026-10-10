/** densable 2.1.289 `IZ` bandWindow (SEA ~208782194). */
function IZ(h) {
  let { budget: v, settledBudget: M, treeRows: N } = h,
    X = Math.max(0, v),
    he = N > X,
    be = he ? Math.max(0, X - 1) : X
  return {
    windowRows: be,
    hasCue: he,
    maxOffset: Math.max(0, N - be),
    bodyRows: Math.max(0, M - 1),
  }
}
