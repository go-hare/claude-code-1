/** densable 2.1.289 `a$` OverflowCue + `i$` overflowCueText (SEA ~208784425). */
var i$ = (h, v) =>
  [h > 0 ? `↑ ${h} more` : '', v > 0 ? `↓ ${v} more` : '']
    .filter(M => M !== '')
    .join(' \xB7 ')
var a$ = h => {
  let v = w(5),
    M
  if (v[0] !== h.above || v[1] !== h.below)
    (M = i$(h.above, h.below)), (v[0] = h.above), (v[1] = h.below), (v[2] = M)
  else M = v[2]
  let N
  if (v[3] !== M)
    (N = e(n, { dimColor: !0, wrap: 'truncate-end', children: M })),
      (v[3] = M),
      (v[4] = N)
  else N = v[4]
  return N
}
