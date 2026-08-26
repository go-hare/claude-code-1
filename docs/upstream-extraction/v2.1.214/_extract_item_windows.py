from pathlib import Path

BIN = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-214/package/claude.exe")
OUT = Path(
    r"D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.214/BATCH_A_EXTRACT.md"
)
data = BIN.read_bytes()


def to_text(chunk: bytes) -> str:
    return "".join(chr(c) if 32 <= c < 127 or c in (9, 10, 13) else "." for c in chunk)


def dump(off: int, before: int = 2000, after: int = 6000) -> str:
    a = max(0, off - before)
    b = min(len(data), off + after)
    return to_text(data[a:b])


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


items = []

# Build structured report with best windows per changelog item
windows = [
    (
        "1+44 single-segment dir/** allow cwd-only; deny/ask any-depth; hook if same as allow",
        [
            (202915207, 500, 2500, "docs single segment / any depth"),
            (237261532, 1500, 5000, "runtime single segment logic?"),
            (230841907, 2000, 5000, "deny/ask near PermissionRule"),
            (230825545, 2000, 5000, "prefix match ruleContent"),
            (230598930, 1500, 4000, "prefix match earlier"),
            (240794079, 2500, 7000, "matchesPath"),
            (249486230, 2500, 7000, "matchPath"),
            (246965914, 2000, 5000, "cwd>/ pattern"),
            (246967593, 2000, 5000, "<cwd>"),
            (230859364, 2000, 5000, "cwd>/ near permissions"),
            (234285783, 2000, 5000, "matcher: hook"),
            (208635640, 1500, 4000, "src/** examples"),
        ],
    ),
    (
        "2 Win PowerShell 5.1 permission check bypass",
        [
            (237731942, 2500, 8000, "PowerShell 5.1 cluster"),
            (237737695, 2500, 8000, "PowerShell 5.1 cluster2"),
            (237713766, 2000, 6000, "ConstrainedLanguage"),
            (233299049, 2500, 8000, "System.Management.Automation"),
            (233313505, 2000, 6000, "LanguageMode"),
            (115740792, 2000, 6000, "PS5.1 mid strings"),
        ],
    ),
    (
        "3 Bash fd redirect fail-closed",
        [
            (234181844, 3000, 9000, "fd redirect main"),
            (234184332, 2000, 5000, "history expansion near redirect"),
            (237306238, 2000, 5000, "fail-closed high"),
            (61941263, 1500, 4000, "fail-closed mid"),
        ],
    ),
    (
        "4 Bash command >10000 chars always prompt",
        [
            (234093895, 2500, 6000, "10,000 characters high"),
            (101993131, 2000, 5000, "10,000 characters mid"),
            (254847020, 1500, 4000, "10,000 alt"),
        ],
    ),
    (
        "5 Bash zsh [[ ]] subscript/modifiers not inert",
        [
            (60655312, 2000, 6000, "subscript mid1"),
            (63943401, 2000, 6000, "subscript mid2"),
            (185899882, 2000, 6000, "subscript high-ish"),
            (67832692, 2000, 6000, "inert mid"),
            (80361980, 2000, 5000, "inert mid2"),
            (234184332, 2000, 5000, "history expansion"),
            (191872473, 2000, 5000, "zsh"),
        ],
    ),
    (
        "6 Bash help/man no longer auto-approve wrongly",
        [
            (230041084, 2000, 5000, '"help"'),
            (236109494, 2000, 5000, '"help" 2'),
            (238008475, 2000, 5000, "command substitutions"),
            (234217787, 2000, 5000, "auto-allowed"),
            (237912881, 2000, 5000, "auto-allowed 2"),
        ],
    ),
    (
        "14 docker/podman daemon-redirect needs permission",
        [
            (234246360, 3000, 9000, "docker --connection high"),
            (192757152, 2500, 7000, "docker --connection mid"),
            (233255115, 2500, 7000, "podman"),
            (233248866, 2000, 5000, "DOCKER_"),
            (99716509, 2000, 5000, "podman mid"),
        ],
    ),
    (
        "16 pkill -f self-kill protection Linux",
        [
            (107859200, 3000, 9000, "pkill mid1"),
            (107860650, 3000, 9000, "pkill mid2"),
            (235638438, 2500, 7000, "pkill high"),
            (205829420, 2000, 5000, "pkill 205m"),
            (61965938, 1500, 4000, "own PID"),
        ],
    ),
    (
        "45 file -m/--magic-file and -f/--files-from need permission",
        [
            (234217787, 2500, 7000, "auto-allowed near file?"),
            # search-driven later
        ],
    ),
]

# Also search file-command specific flags more carefully in high JS
for n in [
    b"--magic-file",
    b"--files-from",
    b"magic-file",
    b"files-from",
    b'"-m"',
    b'"--magic',
    b"magicfile",
    b"MAGIC",
    b"file command",
    b"isReadOnlyFile",
    b"readOnlyFile",
    b"READ_ONLY_COMMANDS",
    b"readonly commands",
    b"safeBins",
    b"SAFE_BIN",
    b"commandIsReadOnly",
    b"isCommandReadOnly",
    b"checkReadOnly",
    b"readOnlyValidation",
    b"externalEditable",
    b"EXTERNAL_READONLY",
]:
    pos = find_all(n, 10, 180_000_000) or find_all(n, 8)
    if pos:
        items.append(f"\nFILEFLAG needle `{n}` hits={pos}\n")
        for off in pos[:3]:
            items.append(f"\n### fileflag {n} @ {off}\n\n```js\n{dump(off, 1500, 4000)}\n```\n")

parts = [
    "# densable 2.1.214 Batch A security surfaces — exact binary extracts\n\n",
    f"Binary: `{BIN}` ({len(data)} bytes)\n\n",
    "Method: python dump of printable spans around changelog-correlated offsets.\n",
    "Minified densable symbols are short names; keep call sites + reason strings.\n",
]

for title, wins in windows:
    parts.append(f"\n\n# {title}\n")
    for off, before, after, note in wins:
        parts.append(f"\n## {note} @ {off}\n\n```js\n{dump(off, before, after)}\n```\n")

parts.extend(items)

# Extra targeted for help/man readonly lists and long command
for n in [
    b"10,000 characters",
    b"10000 characters",
    b".length>10000",
    b".length>=10000",
    b"length>10000",
    b"length >= 10000",
    b"MAX_BASH",
    b"COMMAND_TOO_LONG",
    b"too long to",
    b"command too long",
    b'"man"',
    b'"help"',
    b"case \"help\"",
    b"case\"help\"",
    b"===\"help\"",
    b"==='help'",
    b'name==="help"',
    b'cmd==="help"',
    b'command==="help"',
    b'baseCmd==="help"',
    b'bin==="help"',
    b"basename",
    b"pkill",
    b"-f",
    b"SIGKILL",
    b"own process",
    b"claude.exe",
    b"process.argv0",
    b"argv0",
]:
    pos = find_all(n, 8, 220_000_000)
    if pos:
        parts.append(f"\nEXTRA `{n}` HI {pos}\n")
        for off in pos[:2]:
            parts.append(f"\n### EXTRA {n} @ {off}\n\n```js\n{dump(off, 1200, 3500)}\n```\n")

OUT.write_text("".join(parts), encoding="utf-8")
print("wrote", OUT, OUT.stat().st_size)
