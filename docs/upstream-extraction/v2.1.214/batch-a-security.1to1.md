# densable 2.1.214 Batch A — security permission surfaces (1:1 binary extract)

Binary: `C:\Users\Administrator\AppData\Local\Temp\official-214\package\claude.exe`  
Size: `256220832`  
Method: Python dump of printable JS regions (prefer offsets ≥230M).

Companion dumps:
- `D:\work\py\claude\claude-code\docs\upstream-extraction\v2.1.214\snippets\`
- `D:\work\py\claude\claude-code\docs\upstream-extraction\v2.1.214\BATCH_A_SYMBOLS.md`

---

## #1 + #44 — single-segment `dir/**` allow is cwd-only; deny/ask still any-depth; hook `if:` same as allow

### Export names (filesystem permission module)

```js
matchesPathRule:()=>hqe,
matchingRuleForInput:()=>zw,
pathInAllowedWorkingPath:()=>r9,
pathInWorkingPath:()=>K1,
patternWithRoot:()=>xrn,
patternWithRootFor:()=>r1d,
normalizePatternsToPath:()=>lIt,
matchingAllowRuleForAllPaths:()=>cot,
// ...
```
Offset ~`240794079`.

### Core transform `o1d` (single-segment `/**` → leading `/` only for allow)

```js
function o1d(e,t){
  if(e.endsWith("/**")){
    let r=e.slice(0,-3);
    return /[^/]/.test(r)
      ? (r.includes("/") || !t || /^[!#]/.test(r) ? r : "/"+r)
      : "/**"
  }
  return e
}
```
Offset ~`240803954`.

Semantics:
- Input pattern ends with `/**`.
- Strip trailing `/**` → `r`.
- If `r` is non-empty path text **without** `/` (single segment, e.g. `src`), and `t===true` (allow-mode), rewrite to `"/src"` so ignore/glob is **cwd-root anchored**, not any-depth.
- Multi-segment (`foo/bar/**`), empty `/**`, negation `!…` / `#…`, or `t===false` (deny/ask): leave un-anchored / as-is → any-depth.

### Rule index builder `APs` — only allow passes `t=true` into `o1d`

```js
function APs(e,t,r){
  let n = r==="deny" ? e.alwaysDenyRules
        : r==="ask"  ? e.alwaysAskRules
        : null;
  // ...
  f={
    patternMap:m,
    getIg:()=>{
      if(g===void 0||++y>z9y)
        y=1,
        g=Hrn.default().add(Array.from(m.keys(),(_)=>o1d(_, r==="allow")));
      return g
    }
  };
  // ...
}
```
Offset ~`2408040xx`.

| behavior | `o1d(_, r==="allow")` second arg | single-segment `dir/**` |
|----------|----------------------------------|-------------------------|
| allow    | `true`                           | cwd-only (`/dir`)       |
| deny     | `false`                          | any-depth               |
| ask      | `false`                          | any-depth               |

### Matcher `zw` / export `matchingRuleForInput`

```js
function zw(e,t,r,n){
  let o=Ci(e);
  if(Rt()==="windows"&&o.includes("\\")) o=kU(o);
  let i=APs(t,r,n),
      s=Rt()==="windows"&&n!=="allow",
      a=o??At(),
      l=s?ny(a):a;
  for(let[c,{patternMap:u,getIg:d}] of i.entries()){
    let p=c??At(),
        f=eOt(s?ny(p):p,l);
    if(!f||!Hrn.default.isPathValid(f)) continue;
    let m=d().test(f);
    if(m.ignored&&m.rule){
      let g=m.rule.pattern, y=g+"/**";
      if(u.has(y)&&(g.includes("/")||n!=="allow")) return u.get(y)??null;
      if(g.startsWith("/")){
        let _=g.slice(1)+"/**";
        if(u.has(_)) return u.get(_)??null
      }
      return u.get(g)??null
    }
  }
  return null
}
```
Offset ~`240804922`.

Note the recovery branch:
- `u.has(y)&&(g.includes("/")||n!=="allow")`  
  For **allow** + single-segment (no `/` in `g`), do **not** re-expand via bare `g+"/**"` any-depth lookup the same way.

### Session path match `hqe` / export `matchesPathRule` (hook-style / session patterns)

```js
function hqe(e,t){
  let r=Ci(t);
  if(Rt()==="windows"&&r.includes("\\")) r=kU(r);
  let {relativePattern:n, root:o}=xrn(e,"session"),
      i=o1d(n1d(n), !0),   // always allow-mode anchoring
      s=Rt()==="windows",
      a=o??At(),
      l=eOt(s?ny(a):a, s?ny(r):r);
  if(l && Hrn.default.isPathValid(l) && Hrn.default().add(i).test(l).ignored) return !0;
  let c=e.trim(),
      u=!PXi(c)&&!c.endsWith(":*");
  if(c.startsWith("*")||u) return $ce(e,t);
  return !1
}
```
Offset ~`240805449`.

This is the **#44 hook `if:` path**: `o1d(..., true)` always — same as allow, not deny/ask.

### Related helpers

| symbol | export / role |
|--------|----------------|
| `r1d` | `patternWithRootFor` — parse absolute/`~/`/drive roots |
| `xrn` | `patternWithRoot` — `r1d(e, V9y(source))` |
| `n1d` | normalize pattern (collapse `//`, BOM) |
| `cot` | `matchingAllowRuleForAllPaths` — all paths must match allow via `zw(...,"allow")` |
| `r9` | `pathInAllowedWorkingPath` |
| `K1` | `pathInWorkingPath` |
| `Hrn` | ignore package (gitignore-style), used as path rule engine |

Snippet file: `snippets/path_rule_cluster.js.txt`, `snippets/path_o1d_zw_hqe.js.txt`.

---

## #2 — Windows PowerShell 5.1 permission-check bypass

### PS binary / name sets

```js
B9u=new Set(["pwsh","pwsh.exe","powershell","powershell.exe"]);
```
Offset ~`237719920`.

### 5.1 cwd-first command shadowing (explicit string)

```js
d.push({
  behavior:"ask",
  message:`An earlier sub-command writes a file (./${G}.*) that would shadow the later \`${G}\` command under Windows PowerShell 5.1 cwd-first resolution.`
})
```
Offset ~`237731942`.

Logic sketch near that site: walk compound pipeline, accumulate write targets into `V`, then if a later command name/stem is in `V`, force `ask`.

### ConstrainedLanguage / dangerous cmdlets

```js
// New-Object outside ConstrainedLanguage allowlist
return {
  behavior:"ask",
  message:`New-Object instantiates .NET type '${r}' outside the ConstrainedLanguage allowlist`
}
// ForEach-Object -MemberName
// Start-Process -Verb RunAs
// Invoke-Expression
// EncodedCommand
// nested powershell spawn
```
Offsets ~`237713766`–`237717302`, `237710786`+.

### AST parse path (embedded PowerShell)

```powershell
$ast = [System.Management.Automation.Language.Parser]::ParseInput(
    $Command,
    [ref]$tokens,
    [ref]$parseErrors
)
# walks CommandAst / FileRedirectionAst / MemberExpressionAst / ...
```
Offset ~`233299049`.

### PS over-length parser cap

```js
// yrg — PowerShell parser
if(t>d3i) return tnt(e, `Command too long for parsing (${t} bytes). Maximum supported length is ${d3i} bytes.`, "CommandTooLon…")
```
Offset ~`233294712`.

Snippet files: `snippets/ps51_big.js.txt`, `snippets/constrained_big.js.txt`, `snippets/sma_big.js.txt`.

---

## #3 — Bash fd redirect fail-closed

### Redirect op map `d6i`

```js
d6i={
  ">":">",">>":">>","<":"<",
  ">&":">&","<&":"<&",
  ">|":">|","&>":"&>","&>>":"&>>",
  "<<<":"<<<"
}
```
Offset ~`234220518` (module `b0e`).

### Fail-closed checker `hnu` + walker `gnu` + full parse `h6i`

```js
function hnu(e){
  // 1) unparsed bytes between children / trailing → too-complex
  // 2) variable_name → "Redirect uses ${n.text} fd-variable assignment"
  // 3) >&- / <&- followed by word → "Close-fd redirect is followed by a word"
  // 4) >& / <& target starts with "-" → close-fd + hidden arg
  // 5) multiple targets → "Redirect has multiple targets"
  return null // ok
}
function gnu(e){
  if(e.type==="file_redirect"){ let t=hnu(e); if(t) return t }
  for(let t of e.children) if(t){ let r=gnu(t); if(r) return r }
  return null
}
function h6i(e,t,r,n){
  // re-runs hnu first; builds {op,target,fd} or {kind:"too-complex", reason}
  // extra: $(cmd) in target, newline, "!" history expansion, "=" zsh PATH binary,
  // bash `>&` second word-expansion pass, etc.
}
```
Offset cluster ~`234180595`–`234185000`.

Key reason strings (all `kind:"too-complex"`):
- `Redirect has unparsed bytes between children — parser dropped content that shell will see`
- `Redirect has unparsed trailing bytes — parser dropped content that shell will see`
- `Redirect uses ${name} fd-variable assignment — modifies shell variable as side effect`
- `Redirect target after >& or <& starts with - — bash treats the dash as close-fd…`
- `Close-fd redirect is followed by a word — bash passes it to the command as a hidden argument`
- `Redirect has multiple targets — post-redirect args swallowed`
- `Redirect target starts with ! — zsh clobber or history expansion`
- `bash \`>&\` applies a second word-expansion pass to its target…`

Snippet: `snippets/bash_redirect_cluster.js.txt`.

---

## #4 — Bash command >10000 chars always prompt

### Constants

```js
var Jru = 1e4;   // parseCommand / parseCommandRaw hard cap
var K0e = 1e4;   // CE / Shu / Gx / vhu / Uto / zOe / F7u read-only path
// y0e = Symbol("parse-aborted")  // PARSE_ABORTED export
```
`Jru` @ `234163375`; `K0e` @ `234959334`.

### Parse entry (`Qru` exports)

```js
nt(Qru,{
  parseCommandRaw:()=>tJt,
  parseCommand:()=>KJn,
  findCommandNode:()=>_0e,
  extractCommandArguments:()=>xHt,
  PARSE_ABORTED:()=>y0e
});

async function KJn(e){
  if(!e || e.length>Jru) return null;
  // ...
}
async function tJt(e){
  if(!e) return null;
  if(e.length>Jru)
    return N("tengu_tree_sitter_parse_abort",{cmdLength:e.length,panic:!1}), y0e;
  // ...
}
y0e = Symbol("parse-aborted");
```
Offsets `234161432`–`234163684`.

### Analyzer treats abort as too-complex → no auto-allow

```js
if(t===y0e)
  return {
    kind:"too-complex",
    reason:"Parser aborted (timeout, resource limit, or over-length)",
    nodeType:"PARSE_ABORT"
  };
```
Offset ~`234166567`.

### Read-only auto-allow path `F7u` (explicit message)

```js
function F7u(e,t){
  let {command:r}=e;
  if(r.length>K0e)
    return {behavior:"passthrough", message:"Command too long for read-only analysis"};
  // ...
}
```
Offset ~`237940640`.

`behavior:"passthrough"` forces further permission checks / prompt (not auto-allow).

### Other `length>K0e` call sites

| function | effect when `length>K0e` |
|----------|---------------------------|
| `CE` | return `[e]` unsplit (cannot safely split) |
| `Shu` | `null` |
| `Gx` | `[]` |
| `vhu` | `true` (dangerous / unanalyzable) |
| `Uto` | `true` |
| `zOe` | empty redirections analysis |
| `Eys` / sed path | `behavior:"ask"` with over-length reason |

Snippet: `snippets/len_Jru1.js.txt`, `snippets/len_K0e1.js.txt`, `snippets/cmd_too_long_ps.js.txt`.

---

## #5 — zsh `[[ ]]` subscripts / modifiers not inert

### Tree-sitter nodes

Parser builds `subscript` nodes (`234115759`, `234133083`, `234160366`).

### `test_command` / `[[` analysis

```js
if(e.type==="test_command"){
  let o=fnu(e, e.children.some((s)=>s?.type==="[["));
  if(o) return o;
  let i=["[["];
  for(let s of e.children){
    // skip [[ ]] [ ]
    let a=mnu(s,i,t,r,n);
    if(a) return a
  }
  // ...
}
```
Offset ~`234174974`.

### `fnu` — fail-closed on unparsed bytes inside test

```js
function fnu(e,t){
  // child span outside node → too-complex
  // unparsed bytes between children → "Test command has unparsed bytes…"
  // recurse into parenthesized/binary/unary (pnu set)
}
```
Offset `234176649`.

### `mnu` — zsh `$name[expr]` / `$name:mod` in `[[ ]]` operands

```js
function mnu(e,t,r,n,o){
  if(pnu.has(e.type)){
    for(let i=0;i<e.children.length;i++){
      let s=e.children[i];
      if((s.type==="simple_expansion"||s.type==="expansion") && (
        e.children[i+1]?.text.startsWith("[") ||
        /^:[a-zA-Z&]/.test(e.children[i+1]?.text??"") ||
        (s.children.some((l)=>l?.type==="special_variable_name")
          && /^\w*(\[|:[a-zA-Z&])/.test(e.children[i+1]?.text??""))
      ))
        return {
          kind:"too-complex",
          reason:"zsh $name[expr] / $name:mod in [[ ]] operand — recursive eval",
          nodeType:e.type,
          differential:!0
        };
      // recurse
    }
  }
  // operators, regex/extglob with expansions, test_rhs_missing, etc.
}
```
Offset `234177482` / reason string `234177887`.

### Related subscript fail-closed (declarations / integer attr)

```js
reason:`${s[0]} positional '${l}' contains array subscript — zsh/bash evaluate $(cmd) in subscripts`
reason:`${i.name} has integer attribute — assignment arith-evals RHS, executing subscript command substitution`
```
Offsets `234170133`, `234171414`.

Snippet: `snippets/subscript_tree.js.txt`, `snippets/bash_redirect_cluster.js.txt` (history expansion).

---

## #6 — `help` / `man` no longer wrongly auto-approved

Inside read-only allow tables (`Hly` / sibling of `file`/`sed`/`sort`):

```js
man:{
  additionalCommandIsDangerousCallback:(e,t)=>{
    let r=new Set(["-k","-f","--apropos","--whatis"]),
        n=new Set(["-S","-s"]),
        o=!1;
    // detect apropos/whatis modes
    // if command substitution in operand → dangerous
    // if apropos mode and operand starts with "-" → dangerous
    // if NOT whatis-mode and path-like (/ \ ~) → dangerous
    return !1
  },
  safeFlags:{
    "-a":"none","--all":"none","-d":"none",
    "-f":"none","--whatis":"none",
    "-h":"none","-k":"none","--apropos":"none",
    "-w":"none","-S":"string","-s":"string"
  }
},
help:{
  additionalCommandIsDangerousCallback:(e,t)=>
    t.some((r)=> r.includes("/") || r.includes("\\") || r.includes("~") || qm(r)),
  safeFlags:{"-d":"none"}
}
```
Offsets: `man` ~`237948656`, `help` ~`237949404`.

`qm(r)` = command substitution markers (`$(…)` / tracked var placeholders).

Any non-`safeFlags` option or dangerous callback `true` → not auto-allow.

---

## #14 — docker / podman daemon-redirect needs permission

### Flag list + detector

```js
oGr=[
  "-H","-c","-r",
  "--host","--context","--config",
  "--tlscacert","--tlscert","--tlskey",
  "--url","--connection","--identity","--remote",
  "--module","--out"
];
U_g=new Set(oGr.filter((e)=>e.length===2).map((e)=>e[1])); // H,c,r

function aQn(e){
  return e.some((t)=>{
    if(oGr.some((n)=>
      t===n || t.startsWith(`${n}=`) ||
      (n.length===2 && t.length>2 && t.startsWith(n))
    )) return !0;
    let r=t.match(/^-([A-Za-z]+)/)?.[1];
    if(r!==void 0 && r.length>=2){
      for(let n of r) if(U_g.has(n)) return !0
    }
    return !1
  })
}
```
`oGr` @ `234246262`; `aQn` @ `234226009`.

### Wired into docker read-only profiles

```js
lQn={
  "docker logs":{
    safeFlags:{ /* follow/tail/... */ },
    additionalCommandIsDangerousCallback:(e,t)=>aQn(t)
  },
  "docker inspect":{
    safeFlags:{ /* format/type/size */ },
    additionalCommandIsDangerousCallback:(e,t)=>aQn(t)
  }
}
```
Offset ~`234246400`.

Any `--url` / `--connection` / `--identity` / `--remote` / `-H` / etc. → dangerous → permission required.  
Podman docker-shim uses same CLI surface (`podman` string hits @ `233255115`).

Snippet: `snippets/aQn_oGr.js.txt`, `snippets/docker_cluster.js.txt`.

---

## #16 — `pkill -f` self-kill protection (Linux)

### Shell snapshot injects wrapper `K2g`

```js
function K2g(){
  return [
    "unalias pkill 2>/dev/null || true",
    "function pkill {",
    '  if [ -n "${CLAUDE_PID:-}" ] && [ -r "/proc/${CLAUDE_PID}/comm" ]; then',
    // strip option args that take values; build _cc_probe
    '    if command pgrep ${_cc_probe[@]+"${_cc_probe[@]}"} 2>/dev/null | command grep -qx "${CLAUDE_PID}"; then',
    "      printf 'pkill: refusing to run — this pattern matches the Claude CLI process (PID %s). Narrow the pattern, or target your own children with `pkill -P $$ ...`.\\n' \"${CLAUDE_PID}\" >&2",
    "      return 1",
    "    fi",
    "  fi",
    '  command pkill ${1+"$@"}',
    "}"
  ].join("\n")
}
```
Offset ~`235638407` (`function K2g`).

### Injected into snapshot script

```js
let s=K2g();
o+=`
  echo "# Shadow pkill to refuse patterns matching the CLI process" >> "$SNAPSHOT_FILE"
  cat >> "$SNAPSHOT_FILE" << 'PKILL_FUNC_END'
${s}
PKILL_FUNC_END
`;
```
Offset ~`235638438` cluster.

### Env / constants

- `CLAUDE_PID` string hits: `233285298`, `234981286`, `235638498`, …
- Message: `refusing to run` @ `235639145`, `matches the Claude` @ `235639181`, `Narrow the pattern` @ `235639222`.

Snippet: `snippets/K2g_pkill.js.txt`, `snippets/CLAUDE_PID.js.txt`.

---

## #45 — `file -m/--magic-file` and `-f/--files-from` need permission

### Read-only `file` safeFlags **omit** magic/files-from

```js
file:{
  safeFlags:{
    "--brief":"none","-b":"none",
    "--mime":"none","-i":"none",
    "--mime-type":"none","--mime-encoding":"none",
    "--apple":"none","--check-encoding":"none","-c":"none",
    "--exclude":"string","--exclude-quiet":"string",
    "--print0":"none","-0":"none",
    "-F":"string","--separator":"string",
    "--help":"none","--version":"none","-v":"none",
    "--no-dereference":"none","-h":"none",
    "--dereference":"none","-L":"none",
    "--keep-going":"none","-k":"none",
    "--list":"none","-l":"none",
    "--no-buffer":"none","-n":"none",
    "--preserve-date":"none","-p":"none",
    "--raw":"none","-r":"none",
    "-s":"none","--special-files":"none"
    // NOTE: NO "-m", "--magic-file", "-f", "--files-from"
  }
}
```
Offset `237946781`.

Mechanism: `oJt` / safeFlags validator — unknown flags fail read-only auto-allow → permission prompt.  
Compare older/other tools that list `-m`/`-f` as safe (e.g. git/rg elsewhere) — `file` deliberately does not.

Snippet: FILE block in tool dump / `snippets/safeFlags_block.js.txt` region.

---

## Cross-cutting symbol map (Batch A)

| Area | densable symbols | human exports / strings |
|------|------------------|-------------------------|
| path glob | `o1d`, `APs`, `zw`, `hqe`, `xrn`, `r1d`, `n1d`, `cot`, `Hrn` | `matchesPathRule`, `matchingRuleForInput`, `patternWithRoot` |
| bash parse caps | `Jru=1e4`, `K0e=1e4`, `y0e`, `tJt`, `KJn` | `PARSE_ABORTED`, `tengu_tree_sitter_parse_abort` |
| redirects | `hnu`, `gnu`, `h6i`, `d6i`, `g6i` | `kind:"too-complex"` reasons |
| `[[ ]]` | `fnu`, `mnu`, `pnu`, `test_command` | `zsh $name[expr] / $name:mod…` |
| read-only allow | `F7u`, `Bly`, `oJt`, `aQn`, `oGr`, `Hly`/`lQn` | `file`/`man`/`help`/`docker *` tables |
| pkill | `K2g`, `Q2g`, `Z2g` | `CLAUDE_PID`, snapshot `PKILL_FUNC_END` |
| PowerShell | `B9u`, AST `Parser::ParseInput`, shadow check | `Windows PowerShell 5.1 cwd-first resolution` |

---

## Implementation notes for go-hare 1:1

1. **Path allow single-segment**: port `o1d` + `APs.getIg` `r==="allow"` gate + `zw` recovery branch + `hqe` always-`true` for hook/session.
2. **Do not** apply cwd-only to deny/ask.
3. **Bash long command**: dual constants `10000` on parse abort + read-only passthrough.
4. **Redirect / `[[ ]]`**: fail-closed `too-complex` reasons must prompt, never treat as inert text.
5. **file**: ensure `-m/--magic-file/-f/--files-from` absent from safeFlags (or explicit dangerous).
6. **docker**: `oGr` + `aQn` on docker (and podman-as-docker) read-only paths.
7. **pkill**: snapshot wrapper using `CLAUDE_PID` + `pgrep` self-match refuse.
8. **PS 5.1**: compound write→same-name shadow → `ask`; ConstrainedLanguage / dynamic name / encoded command checks.

---

## Raw artifact index

| path | content |
|------|---------|
| `docs/upstream-extraction/v2.1.214/snippets/path_rule_cluster.js.txt` | r9/K1/xrn/o1d/APs/zw/hqe |
| `docs/upstream-extraction/v2.1.214/snippets/bash_redirect_cluster.js.txt` | hnu/gnu/h6i |
| `docs/upstream-extraction/v2.1.214/snippets/len_Jru1.js.txt` | Jru parse abort |
| `docs/upstream-extraction/v2.1.214/snippets/len_K0e1.js.txt` | K0e CE/Shu/vhu |
| `docs/upstream-extraction/v2.1.214/snippets/cmd_too_long_ps.js.txt` | F7u |
| `docs/upstream-extraction/v2.1.214/snippets/K2g_pkill.js.txt` | pkill wrapper |
| `docs/upstream-extraction/v2.1.214/snippets/aQn_oGr.js.txt` | docker flags |
| `docs/upstream-extraction/v2.1.214/snippets/ps51_big.js.txt` | PS 5.1 shadow |
| `docs/upstream-extraction/v2.1.214/BATCH_A_SYMBOLS.md` | broader dumps |
