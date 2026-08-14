# densable 2.1.232 #43 — Bash input redirections (`< file`)

## Changelog

> Bash input redirections (`< file`) are now permission-checked like their argument spellings on all platforms

## `auS` gold (path constraints)

After process-substitution guard and output-redirect deny/safety:

```js
// AST path: DNf maps output ops; input ops not in redirections list
// then explicit loop:
if (o) for (let A of o) {
  if (A.op !== "<" || A.target === "/dev/null") continue
  let T = v(A.target, "read", "Input redirection from")
  if (T !== void 0) return T
}
// ...
// later ask-path (IRr = validatePath read):
if (o) for (let h of o) {
  if (h.op !== "<" || h.target === "/dev/null") continue
  let {allowed, resolvedPath:y, decisionReason:b} = IRr(h.target, t, r, "read")
  if (!g) {
    let v = b?.type==="other"||b?.type==="safetyCheck" ? b.reason
      : b?.type==="rule"
        ? `Input redirection from '${HRr(y)}' was blocked by a deny rule.`
        : `Input redirection from '${HRr(y)}' was blocked. For security, Claude Code may only read files in the allowed working directories for this session.`
    if (b?.type==="rule") return {behavior:"deny", message:v, decisionReason:b}
    // suggestions: lkt(rZ(y)) session Read rule when b===undefined
    d.push({behavior:"ask", message:v, blockedPath:y, decisionReason:b, ...})
  }
}
```

## Notes

- Only `op === "<"` file targets (not `<<` / `<<<` / `<&` fd).
- `/dev/null` skipped.
- Dangerous net/UNC/shell-expansion on redirects still fail-closed earlier via `hasDangerousRedirection`.
- Local: `validateInputRedirections` + AST branch in `checkPathConstraints`.
