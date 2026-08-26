from pathlib import Path

BIN = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-214/package/claude.exe")
OUT = Path(r"D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.214/batch-a-security.extract.md")
data = BIN.read_bytes()


def to_text(chunk: bytes) -> str:
    out = []
    for c in chunk:
        if 32 <= c < 127 or c in (9, 10, 13):
            out.append(chr(c))
        else:
            out.append("\\x{:02x}".format(c))
    return "".join(out)


def find_all(needle: bytes, maxn: int = 50, min_off: int = 0):
    i = min_off
    pos = []
    while len(pos) < maxn:
        j = data.find(needle, i)
        if j < 0:
            break
        pos.append(j)
        i = j + 1
    return pos


def dump(off: int, before: int = 800, after: int = 2500) -> str:
    a = max(0, off - before)
    b = min(len(data), off + after)
    return to_text(data[a:b])


# Broad keyword scan for Batch A themes
needles = [
    b"single-segment",
    b"any-depth",
    b"cwd-only",
    b"dir/**",
    b"**/",
    b"permission rule",
    b"matchPermission",
    b"pathPattern",
    b"glob pattern",
    b"isAbsolute",
    b"Edit(",
    b"Write(",
    b"Read(",
    b"Bash(",
    b"file_redirect",
    b"too-complex",
    b"fd-variable",
    b"Close-fd",
    b"Redirect has multiple",
    b"10000",
    b"10_000",
    b"10000 characters",
    b"very long",
    b"command length",
    b"subscript",
    b"parameter_expansion",
    b"[[",
    b"zsh",
    b"inert",
    b"help",
    b"man ",
    b"command_name",
    b"read-only",
    b"readOnly",
    b"isReadOnly",
    b"docker",
    b"podman",
    b"--url",
    b"--connection",
    b"--identity",
    b"remote",
    b"daemon",
    b"pkill",
    b"self",
    b"process.pid",
    b"magic-file",
    b"files-from",
    b"--magic-file",
    b"--files-from",
    b"file -m",
    b"PowerShell",
    b"powershell",
    b"PS5",
    b"5.1",
    b"bypass",
    b"fail-closed",
    b"fail closed",
    b"always prompt",
    b"alwaysPrompt",
    b"permission check",
    b"parseFlags",
    b"dangerousFlags",
    b"matchRulePattern",
    b"normalizePattern",
    b"segment",
    b"prefixMatch",
    b"wildcard",
    b"/**",
    b"toolPermission",
    b"checkPermissions",
    b"bashPermissions",
    b"powershellPermissions",
    b"pathValidation",
    b"hook if",
    b"if:",
    b"matcher",
    b"PermissionRule",
    b"ruleType",
    b"behavior",
    b"ask",
    b"deny",
    b"allow",
]

report = []
report.append("# densable 2.1.214 Batch A — security permission surfaces (binary dump)\n")
report.append(f"Binary: `{BIN}` size={len(data)}\n")
report.append("## Keyword hit map (first offsets)\n")
for n in needles:
    pos = find_all(n, maxn=8, min_off=200_000_000)
    if not pos:
        pos = find_all(n, maxn=5)
    report.append(f"- `{n.decode('utf-8','replace')}`: {pos[:8]}")

# Targeted high-value dumps
targets = [
    ("#3 fd redirect fail-closed", b"Redirect uses", 1500, 4000),
    ("#3 file_redirect", b"file_redirect", 800, 2500),
    ("#3 d6i redirect ops map", b"d6i", 200, 800),
    ("#4 10000 char", b"10000", 600, 1500),
    ("#5 subscript", b"subscript", 800, 2500),
    ("#5 zsh [[", b"[[ ]]", 800, 2000),
    ("#5 inert", b"inert", 800, 2000),
    ("#6 help man", b'"help"', 500, 1500),
    ("#6 man command", b'"man"', 500, 1500),
    ("#14 docker connection", b"--connection", 1000, 3000),
    ("#14 docker identity", b"--identity", 1000, 3000),
    ("#14 podman remote", b"podman", 1000, 3000),
    ("#14 --url docker", b'"--url"', 800, 2500),
    ("#16 pkill", b"pkill", 1000, 3000),
    ("#45 magic-file", b"magic", 500, 1500),
    ("#45 files-from", b"files-from", 500, 1500),
    ("#45 --files-from", b"--files-from", 500, 1500),
    ("#2 PowerShell permission", b"PowerShell", 800, 2500),
    ("#2 powershellPermissions", b"powershell", 800, 2500),
    ("#1/** pattern", b"/**", 300, 800),
    ("fail-closed reason", b"fail-closed", 800, 2000),
    ("fail closed reason2", b"fail closed", 800, 2000),
    ("too-complex", b"too-complex", 1000, 3000),
    ("read only auto", b"read-only", 800, 2000),
    ("always prompt", b"always prompt", 800, 2000),
    ("command too long", b"too long", 800, 2000),
    ("characters now", b"characters", 500, 1500),
]

report.append("\n## Targeted dumps (min_off prefer high JS)\n")
for label, needle, before, after in targets:
    # Prefer high offset hits
    pos = find_all(needle, maxn=10, min_off=220_000_000)
    if not pos:
        pos = find_all(needle, maxn=8, min_off=180_000_000)
    if not pos:
        pos = find_all(needle, maxn=5)
    report.append(f"\n### {label}\nneedle=`{needle}` hits={pos[:10]}\n")
    for off in pos[:3]:
        report.append(f"\n#### offset {off}\n```js\n{dump(off, before, after)}\n```\n")

OUT.write_text("\n".join(report), encoding="utf-8")
print("wrote", OUT, "bytes", OUT.stat().st_size)
