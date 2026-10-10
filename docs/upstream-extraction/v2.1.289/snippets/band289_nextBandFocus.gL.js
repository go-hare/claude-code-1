/** densable 2.1.289 `gL` nextBandFocus (SEA ~208784252). */
function gL(h) {
  let { focus: v, count: M } = h,
    N = M > 0,
    X = typeof v === 'number',
    he = X && v + 1 < M ? v + 1 : null
  return X ? he : N ? 0 : v === null ? 'band' : null
}
