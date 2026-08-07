# densable 2.1.216 #13 — Bash `&&` list / negation redirects

## Changelog

> Fixed Bash command permission checking for compound statements with redirects inside `&&` lists or negations

## densable gold (SEA 2.1.216)

### `$uu` peel last leaf

```js
function $uu(e){
  let t=null
  for(let r of e.children){
    if(!r||r.type==="!"||r.type==="comment"||Sto.has(r.type))continue
    t=r
  }
  if(!t)return null
  if(t.type==="list"||t.type==="negated_command")return $uu(t)
  if(!Duu.has(t.type)&&!exg.has(t.type))return t
  return null
}
```

Sets:

- `Duu` = command|pipeline|list|negated_command|declaration_command|unset_command
- `exg` = test_command|redirected_statement
- `Sto` = && || | ; & |& newline

When `$uu` returns a non-null leaf, densable `mS(leaf)` → too-complex (e.g. subshell / compound under list+redirect).

### `uxg` redirected_statement

1. Collect file_redirect / heredoc vs body (`Duu` types).
2. If body is list|negated_command and `$uu` finds unanalyzable leaf → too-complex.
3. Walk body with densable scope rules:
   - exact `A && B` (3 children, middle `&&`): walk A, **snapshot scope**, walk B; redirects use post-A Map.
   - other list: walk whole list; redirect scope = current `r`.
   - pipeline / nested redirected_statement: walk; scope = `r`.
   - else: **pre-body snapshot** then walk body (redirects do not see body assignments).
4. Expand redirects with that scope; attach to last command (or empty argv command).

### Related permission layer

`dWg` / `lco` (pathValidation) already local via `validateOutputRedirections` + process-substitution ask (207). This item is the **AST** attach/scope fix so permission sees correct redirect targets on `A && B > out` / `! cmd > out`.

## Local port

| densable | local |
|----------|-------|
| `$uu` | `peelRedirectBodyLeaf` in `src/utils/bash/ast.ts` |
| `Duu`∪`exg` | `REDIRECT_BODY_TYPES` |
| `uxg` | `walkRedirectedStatement` rewrite |
| redirect `$FOO` | `walkFileRedirect` accepts `simple_expansion` + `concatenation` via `walkArgument` |

## Tests

`src/utils/bash/__tests__/listNegationRedirect.216.test.ts`

## Residuals

- densable `hasUnquotedGlob` field on SimpleCommand not ported (downstream unused).
- densable `jMe` / empty-pipeline `true` inject already partially local under pipeline.
