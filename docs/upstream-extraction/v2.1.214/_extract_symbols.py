from pathlib import Path

BIN = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-214/package/claude.exe")
OUT = Path(
    r"D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.214/BATCH_A_SYMBOLS.md"
)
data = BIN.read_bytes()


def to_text(chunk: bytes) -> str:
    return "".join(chr(c) if 32 <= c < 127 or c in (9, 10, 13) else "." for c in chunk)


def find_all(n: bytes, maxn=20, min_off=0):
    i = min_off
    pos = []
    while len(pos) < maxn:
        j = data.find(n, i)
        if j < 0:
            break
        pos.append(j)
        i = j + 1
    return pos


def dump_around(off, before=3000, after=8000):
    a = max(0, off - before)
    b = min(len(data), off + after)
    return to_text(data[a:b])


# From export map: matchesPathRule:()=>hqe
# Search for function definitions / assignments of minified names and full names
symbols = [
    b"matchesPathRule",
    b"function hqe",
    b"hqe=",
    b"hqe=function",
    b"matchingRuleForInput",
    b"function zw",
    b"pathInAllowedWorkingPath",
    b"pathInWorkingPath",
    b"patternWithRoot",
    b"patternWithRootFor",
    b"normalizePatternsToPath",
    b"matchingAllowRuleForAllPaths",
    b"checkWritePermissionForTool",
    b"checkReadable",
    b"readPermissionDecisionForPath",
    b"readWouldBeAutoAllowedForPath",
    b"single segment",
    b"any-depth",
    b"any depth",
    b"behavior===",
    b'behavior:"allow"',
    b'behavior==="allow"',
    b'behavior==="deny"',
    b'behavior==="ask"',
    # bash
    b"function hnu",
    b"function gnu",
    b"function h6i",
    b"d6i=",
    b"d6i={",
    b"too-complex",
    b"history expansion",
    # long cmd
    b"10,000 characters",
    b"too long to analyze",
    b"command is too long",
    b"length>10000",
    b".length>1e4",
    b"MAX_COMMAND_LENGTH",
    b"COMMAND_LENGTH_LIMIT",
    # pkill
    b"pkill",
    b"function ",
    # docker
    b"--connection",
    b"--identity",
    b"podman",
    # file magic
    b"readOnlyValidation",
    b"READ_ONLY_COMMANDS",
    b"--magic-file",
    b"--files-from",
    b"magic-file",
    b"files-from",
    # help man
    b'==="help"',
    b'==="man"',
    b'case"help"',
    # powershell
    b"PowerShell 5.1",
    b"ConstrainedLanguage",
    b"LanguageMode",
    # inert / zsh
    b"inert",
    b"subscript",
    b"parameter_expansion",
    b"glob_qualifier",
]

parts = ["# densable 2.1.214 Batch A symbol-targeted extracts\n\n"]

# First dump the E9i export map region fully
off_map = data.find(b"matchesPathRule:()=>hqe")
parts.append(f"## export map matchesPathRule @ {off_map}\n\n```js\n{dump_around(off_map, 2000, 6000)}\n```\n")

# Search for function hqe definition patterns near high JS
for name in [
    b"function hqe(",
    b"hqe=function(",
    b"hqe=(",
    b",hqe=function",
    b"hqe=Nr(",
    b"hqe=be(",
    b"matchesPathRule=",
    b"function matchesPathRule",
    b"zw=function",
    b"function zw(",
    b",zw=",
    b"matchingRuleForInput=",
]:
    pos = find_all(name, 10, 230_000_000)
    if not pos:
        pos = find_all(name, 5)
    parts.append(f"\n## search `{name}` hits={pos}\n")
    for off in pos[:2]:
        parts.append(f"\n### {off}\n\n```js\n{dump_around(off, 500, 5000)}\n```\n")

# Bash redirect full cluster
for name, off in [
    ("hnu", data.find(b"function hnu(", 234_000_000)),
    ("gnu", data.find(b"function gnu(", 234_000_000)),
    ("h6i", data.find(b"function h6i(", 234_000_000)),
    ("d6i", data.find(b"d6i=", 234_000_000)),
]:
    if off < 0:
        off = data.find(name.encode() if isinstance(name, str) else name)
    parts.append(f"\n## bash {name} @ {off}\n\n```js\n{dump_around(off, 200, 6000)}\n```\n")

# Search permission path matching implementation strings likely in hqe
for n in [
    b"Edit(",
    b"Write(",
    b"Read(",
    b"/**",
    b"startsWith",
    b"pattern.endsWith",
    b'endsWith("/**")',
    b"endsWith('/**')",
    b'endsWith("/**")',
    b'/**")',
    b"split('/')",
    b'split("/")',
    b"double star",
    b"doubleStar",
    b"**/",
    b"relative(",
    b"pathInAllowedWorkingPath",
    b"function r9(",
    b"r9=function",
    b"function K1(",
    b"function xrn(",
    b"function r1d(",
    b"function lIt(",
    b"function cot(",
    b"function zw(",
    b"function hqe(",
    b"hqe(e",
    b"zw(e",
]:
    pos = find_all(n if isinstance(n, bytes) else n.encode(), 8, 240_000_000)
    if pos:
        parts.append(f"\n- `{n}` HI240: {pos[:8]}\n")
        for off in pos[:1]:
            parts.append(f"\n### `{n}` @ {off}\n\n```js\n{dump_around(off, 800, 3500)}\n```\n")

# docker permission check - look for flag lists near --connection high
off = data.find(b"--connection", 234_200_000)
parts.append(f"\n## docker connection high @ {off}\n\n```js\n{dump_around(off, 2500, 7000)}\n```\n")

# pkill high
off = data.find(b"pkill", 235_600_000)
parts.append(f"\n## pkill high @ {off}\n\n```js\n{dump_around(off, 2500, 8000)}\n```\n")
off = data.find(b"pkill", 239_000_000)
parts.append(f"\n## pkill 239m @ {off}\n\n```js\n{dump_around(off, 2500, 8000)}\n```\n")

# readOnlyValidation
off = data.find(b"readOnlyValidation", 246_900_000)
parts.append(f"\n## readOnlyValidation @ {off}\n\n```js\n{dump_around(off, 3000, 10000)}\n```\n")

# help/man
for off in find_all(b'==="help"', 5, 244_900_000):
    parts.append(f"\n## ===help @ {off}\n\n```js\n{dump_around(off, 2000, 6000)}\n```\n")
for off in find_all(b'"man"', 5, 247_000_000):
    parts.append(f"\n## man @ {off}\n\n```js\n{dump_around(off, 2000, 6000)}\n```\n")

# 10000 command length in permission context - search near bash permission
for n in [
    b"e.length>10000",
    b"e.length>=10000",
    b"t.length>10000",
    b"t.length>=10000",
    b"command.length>10000",
    b"command.length>=10000",
    b".length>10000",
    b".length>=10000",
    b"length>1e4",
    b"length>=1e4",
    b">10000?",
    b"10000?",
    b",10000)",
    b"(10000)",
    b"10_000",
    b"1e4",
]:
    pos = find_all(n.encode() if isinstance(n, str) else n, 10, 233_000_000)
    if pos:
        parts.append(f"\n- length needle `{n}`: {pos[:10]}\n")
        for off in pos[:2]:
            parts.append(f"\n### length `{n}` @ {off}\n\n```js\n{dump_around(off, 1000, 3000)}\n```\n")

# PowerShell 5.1 permission
off = data.find(b"PowerShell 5.1", 237_700_000)
parts.append(f"\n## PS 5.1 @ {off}\n\n```js\n{dump_around(off, 3000, 9000)}\n```\n")
off = data.find(b"ConstrainedLanguage", 237_700_000)
parts.append(f"\n## ConstrainedLanguage @ {off}\n\n```js\n{dump_around(off, 3000, 9000)}\n```\n")
off = data.find(b"System.Management.Automation", 233_290_000)
parts.append(f"\n## SMA @ {off}\n\n```js\n{dump_around(off, 3000, 10000)}\n```\n")

# inert / subscript near bash analyzer high
for n in [b"inert", b"subscript", b"[[", b"parameter_expansion", b"word_modifier"]:
    pos = find_all(n, 8, 234_000_000)
    if pos:
        parts.append(f"\n- bashish `{n}`: {pos[:8]}\n")
        for off in pos[:2]:
            parts.append(f"\n### bashish `{n}` @ {off}\n\n```js\n{dump_around(off, 1200, 4000)}\n```\n")

# auto-allowed file flags
off = data.find(b"auto-allowed", 234_200_000)
parts.append(f"\n## auto-allowed @ {off}\n\n```js\n{dump_around(off, 2500, 7000)}\n```\n")
off = data.find(b"auto-allowed", 237_900_000)
parts.append(f"\n## auto-allowed 237 @ {off}\n\n```js\n{dump_around(off, 2500, 7000)}\n```\n")
off = data.find(b"auto-allowed", 238_000_000)
parts.append(f"\n## auto-allowed 238 @ {off}\n\n```js\n{dump_around(off, 2500, 7000)}\n```\n")

OUT.write_text("".join(parts), encoding="utf-8")
print("wrote", OUT, OUT.stat().st_size)
