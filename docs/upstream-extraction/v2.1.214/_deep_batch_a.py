from pathlib import Path

data = Path(
    r"C:/Users/Administrator/AppData/Local/Temp/official-214/package/claude.exe"
).read_bytes()
base = Path(
    r"D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.214/snippets"
)
base.mkdir(exist_ok=True)


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


needles = [
    b"Jru",
    b"K0e",
    b"Ohu",
    b"function Ohu",
    b"e.length>Jru",
    b"e.length>K0e",
    b".length>Jru",
    b".length>K0e",
    b"length>Jru",
    b"length>K0e",
    b"Jru=",
    b"K0e=",
    b">Jru",
    b">K0e",
    b"Command too long",
    b"too long for",
    b"always prompt",
    b"requires approval",
    b"cannot be auto",
    b"auto-allowed",
    b"isReadOnly",
    b"commandIsReadOnly",
    b"--magic-file",
    b"magic-file",
    b"--files-from",
    b"files-from",
    b'"file":{',
    b"file:{",
    b'"man":{',
    b"man:{",
    b'"help":{',
    b"help:{",
    b"CLAUDE_PID",
    b"refusing to run",
    b"matches the Claude",
    b"Narrow the pattern",
    b"oGr=",
    b"function aQn",
    b"aQn=",
    b"--connection",
    b"--identity",
    b"--remote",
    b"podman",
    b"PowerShell 5.1",
    b"ConstrainedLanguage",
    b"LanguageMode",
    b"FullLanguage",
    b"PSParser",
    b"CommandAst",
    b"subscript",
    b"test_command",
    b"binary_expression",
    b"inert",
    b"reason:\"Command",
    b"kind:\"too-complex\"",
    b"safeFlags",
    b"file ",
    b'"-m"',
    b'"-f"',
    b"READ_ONLY",
    b"readOnlyValidation",
]

report = []
for n in needles:
    pos = find_all(n, 12, 230_000_000)
    if not pos:
        pos = find_all(n, 6)
    if pos:
        report.append(f"{n!r}: {pos[:10]}")

(base / "needle_hits.txt").write_text("\n".join(report), encoding="utf-8")
print("hits", len(report))
for line in report:
    print(line[:200])

dumps = {
    "Jru_region": (234163339, 200, 10000),
    "reason_Command_big": (234209961, 3000, 10000),
    "K0e_big": (234959298, 3000, 12000),
    "Ohu_big": (234970613, 2000, 8000),
    "aQn_oGr": (234246000, 800, 4000),
    "CLAUDE_PID": (data.find(b"CLAUDE_PID", 235000000), 800, 5000),
    "K2g_pkill": (data.find(b"function K2g", 235000000), 100, 5000),
    "safeFlags_block": (234227662, 200, 12000),
    "reason_Command_ps": (237727568, 2500, 10000),
    "ps51_big": (237731950, 3000, 12000),
    "constrained_big": (237713766, 2500, 10000),
    "sma_big": (233299049, 2000, 12000),
    "subscript_tree": (234115759, 2000, 8000),
    "path_o1d_zw_hqe": (240803892, 50, 3500),
    "auto_allowed_big": (234217787, 2500, 10000),
    "readOnlyValidation_big": (246995908, 1000, 12000),
}

for name, (off, b, a) in dumps.items():
    if off is None or off < 0:
        print("skip", name)
        continue
    txt = to_text(data[max(0, off - b) : min(len(data), off + a)])
    (base / f"{name}.js.txt").write_text(txt, encoding="utf-8")
    print("wrote", name, off, len(txt))
