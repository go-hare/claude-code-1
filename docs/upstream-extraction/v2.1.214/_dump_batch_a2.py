from pathlib import Path

BIN = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-214/package/claude.exe")
OUT = Path(
    r"D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.214/batch-a-security.snippets.md"
)
data = BIN.read_bytes()


def to_text(chunk: bytes) -> str:
    out = []
    for c in chunk:
        if 32 <= c < 127 or c in (9, 10, 13):
            out.append(chr(c))
        else:
            out.append("\\x{:02x}".format(c))
    return "".join(out)


def find_all(needle: bytes, maxn: int = 30, min_off: int = 0):
    i = min_off
    pos = []
    while len(pos) < maxn:
        j = data.find(needle, i)
        if j < 0:
            break
        pos.append(j)
        i = j + 1
    return pos


def dump(off: int, before: int = 1000, after: int = 3000) -> str:
    a = max(0, off - before)
    b = min(len(data), off + after)
    return to_text(data[a:b])


sections = []

# 1+44 path glob / PermissionRule
for label, needle, before, after, min_off in [
    ("PermissionRule", b"PermissionRule", 1200, 3500, 230_000_000),
    ("matchesPath", b"matchesPath", 1500, 4000, 230_000_000),
    ("matchPath", b"matchPath", 1500, 4000, 249_000_000),
    ("permission rules text", b"permission rules", 1000, 3000, 230_000_000),
    ("src/** pattern docs", b"src/**", 800, 2500, 208_000_000),
    ("/**/ patterns", b"/**/", 500, 1500, 208_000_000),
    ("segments.length path", b"segments.length", 1000, 2500, 231_000_000),
    ("picomatch", b"picomatch", 800, 2500, 230_000_000),
    ("ruleValue", b"ruleValue", 1000, 3000, 234_900_000),
    ("checkRule", b"checkRule", 1000, 3000, 238_000_000),
    # bash #3
    ("too-complex redirect", b"too-complex", 500, 2000, 234_000_000),
    ("Redirect uses", b"Redirect uses", 800, 3000, 234_000_000),
    ("hnu function", b"function hnu", 200, 2500, 234_000_000),
    ("gnu function", b"function gnu", 200, 2500, 234_000_000),
    ("h6i function", b"function h6i", 200, 3000, 234_000_000),
    ("d6i map", b"d6i=", 100, 500, 234_000_000),
    ("d6i object", b"d6i={", 100, 500, 0),
    ("file_redirect", b"file_redirect", 500, 2000, 234_000_000),
    # #4 long command
    ("10000 threshold", b"10000", 800, 2000, 234_000_000),
    ("command length 10000 mid", b".length>10000", 500, 1500, 0),
    ("length>=10000", b"length>=10000", 500, 1500, 0),
    ("length > 10000", b"length > 10000", 500, 1500, 0),
    ("e.length>1e4", b"1e4", 300, 800, 230_000_000),
    (">10000", b">10000", 500, 1500, 0),
    (">=10000", b">=10000", 500, 1500, 0),
    # #5 zsh
    ("subscript", b"subscript", 1000, 3000, 230_000_000),
    ("parameter expansion", b"parameter_expansion", 800, 2500, 230_000_000),
    ("inert text", b"inert", 800, 2500, 230_000_000),
    ("[[ comparison", b"[[", 300, 800, 230_000_000),
    ("variable_subscript", b"variable_subscript", 800, 2500, 0),
    ("subscript_expression", b"subscript_expression", 800, 2500, 0),
    # #6 help/man
    ('"help"', b'"help"', 800, 2500, 233_000_000),
    ('"man"', b'"man"', 800, 2500, 233_000_000),
    ("READ_ONLY", b"READ_ONLY", 500, 1500, 233_000_000),
    ("readOnlyCommands", b"readOnly", 500, 1500, 233_000_000),
    ("isReadOnlyCommand", b"isReadOnlyCommand", 800, 2500, 0),
    ("safeCommands", b"safeCommands", 500, 1500, 0),
    # #14 docker
    ("--connection", b"--connection", 1200, 3500, 234_000_000),
    ("--identity", b"--identity", 1200, 3500, 234_000_000),
    ("podman", b"podman", 1200, 3500, 233_000_000),
    ("daemon-redirect flags", b"--url", 800, 2500, 234_000_000),
    ("docker command", b'"docker"', 800, 2500, 233_000_000),
    # #16 pkill
    ("pkill high", b"pkill", 1200, 3500, 230_000_000),
    ("pkill mid", b"pkill", 1200, 3500, 107_800_000),
    ("process.pid self", b"process.pid", 800, 2500, 230_000_000),
    ("pkill -f", b"pkill -f", 800, 2500, 0),
    ("-f pattern", b'"-f"', 500, 1500, 233_000_000),
    # #45 file
    ("magic-file", b"magic-file", 800, 2500, 0),
    ("files-from", b"files-from", 800, 2500, 0),
    ("--magic", b"--magic", 800, 2500, 0),
    ('"file"', b'"file"', 500, 1500, 233_000_000),
    ("magic file", b"magic", 500, 1200, 233_200_000),
    # #2 powershell
    ("PowerShell 5.1", b"5.1", 500, 1500, 237_700_000),
    ("Windows PowerShell", b"Windows PowerShell", 1000, 3000, 237_700_000),
    ("powershell permission", b"powershellPermissions", 1000, 3000, 0),
    ("checkPowerShell", b"checkPowerShell", 800, 2500, 0),
    ("parsePowerShell", b"parsePowerShell", 800, 2500, 0),
    ("PowerShellTool", b"PowerShellTool", 800, 2500, 230_000_000),
    ("PSNativeCommand", b"PSNative", 500, 1500, 0),
    ("EncodedCommand", b"EncodedCommand", 800, 2500, 230_000_000),
    ("bypass", b"bypass", 500, 1500, 237_000_000),
    ("fail-closed", b"fail-closed", 1000, 3000, 237_000_000),
    ("fail closed", b"fail closed", 800, 2500, 230_000_000),
    # additional permission symbols from local codebase likely names
    ("bashSecurity", b"bashSecurity", 500, 1500, 0),
    ("bashPermissions", b"bashPermissions", 500, 1500, 0),
    ("pathValidation", b"pathValidation", 500, 1500, 0),
    ("checkBashPermissions", b"checkBash", 500, 1500, 230_000_000),
    ("permissionMode", b"permissionMode", 500, 1500, 230_000_000),
    ("shouldAutoApprove", b"shouldAutoApprove", 800, 2500, 0),
    ("autoApprove", b"autoApprove", 500, 1500, 230_000_000),
    ("dangerous", b"dangerousFlags", 500, 1500, 0),
    ("FLAG_SPECS", b"FLAG", 200, 500, 234_200_000),
]:
    pos = find_all(needle, maxn=8, min_off=min_off)
    if not pos and min_off:
        pos = find_all(needle, maxn=5, min_off=0)
    sections.append(f"\n## {label}\n\nneedle=`{needle!r}` min_off={min_off} hits={pos[:10]}\n")
    for off in pos[:2]:
        sections.append(f"\n### off {off}\n\n```js\n{dump(off, before, after)}\n```\n")

# Also extract contiguous JS around known good offsets from first dump
known = [
    (234181844, 2000, 5000, "fd-redirect-cluster"),
    (234246360, 2000, 5000, "docker-connection-cluster"),
    (240794079, 2000, 5000, "matchesPath"),
    (249486230, 2000, 5000, "matchPath"),
    (230841784, 2000, 5000, "PermissionRule"),
    (107859200, 2000, 5000, "pkill-mid"),
    (237731942, 2000, 5000, "Windows-PowerShell"),
]
sections.append("\n# Known offset deep dumps\n")
for off, before, after, name in known:
    sections.append(f"\n## {name} @ {off}\n\n```js\n{dump(off, before, after)}\n```\n")

OUT.write_text("\n".join(sections), encoding="utf-8")
print("wrote", OUT, OUT.stat().st_size)
