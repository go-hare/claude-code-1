from pathlib import Path

BIN = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-214/package/claude.exe")
OUT = Path(
    r"D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.214/batch-a-security.precise.md"
)
data = BIN.read_bytes()


def to_text(chunk: bytes) -> str:
    # Prefer keeping unicode escapes already present as ascii; replace non-print with .
    out = []
    for c in chunk:
        if 32 <= c < 127 or c in (9, 10, 13):
            out.append(chr(c))
        else:
            out.append(".")
    return "".join(out)


def find_all(needle: bytes, maxn: int = 40, min_off: int = 0):
    i = min_off
    pos = []
    while len(pos) < maxn:
        j = data.find(needle, i)
        if j < 0:
            break
        pos.append(j)
        i = j + 1
    return pos


def dump(off: int, before: int = 1500, after: int = 4500) -> str:
    a = max(0, off - before)
    b = min(len(data), off + after)
    return to_text(data[a:b])


# Expand windows around high-value anchors
anchors = [
    # #1+#44 docs/changelog-like strings
    (202915236, 800, 2500, "any depth @202915236"),
    (218781403, 800, 2500, "any depth @218781403"),
    (237261561, 1500, 4000, "any depth @237261561"),
    (242601993, 1500, 4000, "any depth @242601993"),
    (246809148, 1500, 4000, "any depth @246809148"),
    (246810389, 1500, 4000, "any depth @246810389"),
    (246977461, 1500, 4000, "nested directories"),
    (208635640, 1500, 4000, "src/** cluster"),
    (230841784, 2000, 5000, "PermissionRule"),
    (230821262, 2000, 5000, "ruleContent"),
    (240794079, 2500, 6000, "matchesPath"),
    (249486230, 2500, 6000, "matchPath"),
    (230763209, 2000, 5000, "normalizePermission"),
    (234249220, 2000, 5000, "behavior===allow cluster"),
    (234285783, 2000, 5000, "matcher: cluster"),
    # #3 fd redirect
    (234181844, 2500, 7000, "fd redirect cluster"),
    # #14 docker
    (234246360, 2500, 7000, "docker --connection"),
    (192757152, 1500, 4000, "docker --connection mid"),
    # #16 pkill
    (107859200, 2500, 7000, "pkill mid1"),
    (107860650, 2500, 7000, "pkill mid2"),
    # powershell
    (237731942, 2500, 7000, "Windows PowerShell"),
    (237737695, 2500, 7000, "Windows PowerShell 2"),
    # fail-closed high
    (237306238, 2000, 5000, "fail-closed high"),
]

parts = ["# densable 2.1.214 Batch A precise binary extracts\n"]
for off, before, after, name in anchors:
    parts.append(f"\n## {name} @ {off}\n\n```js\n{dump(off, before, after)}\n```\n")

# Additional searches that often hold the actual logic
extra_needles = [
    b"any depth",
    b"nested directories",
    b"single segment",
    b"single-segment",
    b"only under",
    b"relative to the",
    b"working directory",
    b"prefix match",
    b"matches only",
    b"/** pattern",
    b"trailing /**",
    b"leading **/",
    b"**/dir/**",
    b"dir/**",
    b"path rule",
    b"permission path",
    b"match pattern against",
    b"pattern matches path",
    b"function matchesPath",
    b"matchesPath=",
    b"matchesPath:",
    b"function matchPath",
    b"matchPath=",
    b"ruleContent matches",
    b"content pattern",
    b"tool permission rule",
    b"Bash permission",
    b"commands over",
    b"10,000",
    b"10000",
    b"always prompt",
    b"always ask",
    b"too long to analyze",
    b"command is too long",
    b"length exceeds",
    b"MAX_COMMAND",
    b"COMMAND_LENGTH",
    b"zsh",
    b"subscript",
    b"modifier",
    b"parameter expansion",
    b"not inert",
    b"treated as inert",
    b"inert text",
    b"help command",
    b'"help"',
    b"man path",
    b"unsafe options",
    b"command substitutions",
    b"backslash paths",
    b"docker",
    b"podman",
    b"--connection",
    b"--identity",
    b"DOCKER_HOST",
    b"remote mode",
    b"daemon",
    b"pkill",
    b"self process",
    b"own process",
    b"CLI's own",
    b"process.pid",
    b"magic-file",
    b"files-from",
    b"--magic-file",
    b"--files-from",
    b"read-only",
    b"auto-allowed",
    b"auto allowed",
    b"PowerShell 5.1",
    b"Windows PowerShell",
    b"permission-check bypass",
    b"permission check bypass",
    b"PSParser",
    b"Parser::",
    b"Tokenize",
    b"Ast.",
    b"System.Management.Automation",
]

parts.append("\n# Extra needle hits\n")
for n in extra_needles:
    pos = find_all(n, maxn=12, min_off=180_000_000)
    if not pos:
        pos = find_all(n, maxn=8)
    if pos:
        parts.append(f"- `{n.decode('utf-8','replace')}`: {pos}\n")
        for off in pos[:2]:
            parts.append(f"\n### `{n.decode('utf-8','replace')}` @ {off}\n\n```js\n{dump(off, 1000, 3000)}\n```\n")

OUT.write_text("".join(parts), encoding="utf-8")
print("wrote", OUT, OUT.stat().st_size)
