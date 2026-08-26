from pathlib import Path

BIN = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-214/package/claude.exe")
OUT = Path(
    r"D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.214/BATCH_A_CLEAN.md"
)
data = BIN.read_bytes()


def printable_ratio(b: bytes) -> float:
    if not b:
        return 0.0
    good = sum(1 for c in b if 32 <= c < 127 or c in (9, 10, 13))
    return good / len(b)


def to_text(chunk: bytes) -> str:
    return "".join(chr(c) if 32 <= c < 127 or c in (9, 10, 13) else "." for c in chunk)


def find_all(n: bytes, maxn=30, min_off=0, max_off=None):
    i = min_off
    pos = []
    while len(pos) < maxn:
        j = data.find(n, i)
        if j < 0:
            break
        if max_off is not None and j >= max_off:
            break
        pos.append(j)
        i = j + 1
    return pos


def best_js_window(off: int, back=8000, forward=12000) -> tuple[int, str]:
    """Expand around offset to a high-printable JS-ish span."""
    start = max(0, off - back)
    end = min(len(data), off + forward)
    # shrink to contiguous high-printable region containing off
    # walk left while printable ratio of 256-byte blocks high
    left = off
    while left > start:
        block = data[left - 256 : left]
        if printable_ratio(block) < 0.85:
            break
        left -= 256
    right = off
    while right < end:
        block = data[right : right + 256]
        if printable_ratio(block) < 0.85:
            break
        right += 256
    # clamp
    left = max(start, left)
    right = min(end, right)
    # prefer starting near function
    window = data[left:right]
    rel = off - left
    f = window.rfind(b"function ", max(0, rel - 4000), rel)
    if f >= 0:
        left2 = left + f
    else:
        left2 = left
    return left2, to_text(data[left2:right])


# Unique reason/error strings strongly tied to Batch A
needles = {
    "1+44 docs single segment": b"single segment",
    "1+44 deny/ask": b"deny/ask",
    "1+44 any depth": b"any depth",
    "1+44 cwd>/": b"cwd>/",
    "1+44 <cwd>": b"<cwd>",
    "1+44 matchesPath": b"matchesPath",
    "1+44 matchPath": b"matchPath",
    "1+44 PermissionRule": b"PermissionRule",
    "1+44 ruleContent": b"ruleContent",
    "1+44 prefix match": b"prefix match",
    "3 Redirect uses": b"Redirect uses",
    "3 Close-fd redirect": b"Close-fd redirect",
    "3 multiple targets": b"Redirect has multiple targets",
    "3 trailing bytes": b"parser dropped content that shell will see",
    "3 file_redirect": b"file_redirect",
    "3 history expansion": b"history expansion",
    "4 10,000 characters": b"10,000 characters",
    "4 too long to": b"too long to",
    "4 command too long": b"command too long",
    "5 subscript": b"subscript",
    "5 inert": b"inert",
    "5 zsh": b"zsh",
    "6 help case": b'case"help"',
    "6 ===help": b'==="help"',
    '6 "man"': b'"man"',
    "6 command substitutions": b"command substitutions",
    "6 auto-allowed": b"auto-allowed",
    "14 --connection": b"--connection",
    "14 --identity": b"--identity",
    "14 podman": b"podman",
    "14 DOCKER_": b"DOCKER_",
    "16 pkill": b"pkill",
    "16 own PID": b"own PID",
    "16 claude.exe near pkill": b"claude.exe",
    "2 PowerShell 5.1": b"PowerShell 5.1",
    "2 ConstrainedLanguage": b"ConstrainedLanguage",
    "2 LanguageMode": b"LanguageMode",
    "2 System.Management.Automation": b"System.Management.Automation",
    "45 readOnlyValidation": b"readOnlyValidation",
    "45 READ_ONLY_COMMANDS": b"READ_ONLY_COMMANDS",
    '45 "-m"': b'"-m"',
    "fail-closed hyphen": b"fail-closed",
    "fail closed space": b"fail closed",
}

parts = [
    "# densable 2.1.214 Batch A — cleaned JS extracts\n\n",
    f"Binary `{BIN}` size={len(data)}\n\n",
]

for label, needle in needles.items():
    # Prefer high JS region for code, mid for docs/strings
    pos = find_all(needle, maxn=15, min_off=180_000_000)
    if not pos:
        pos = find_all(needle, maxn=10)
    parts.append(f"\n## {label}\n\nneedle=`{needle!r}` hits={pos[:12]}\n")
    # pick up to 2 highest-quality windows
    scored = []
    for off in pos[:8]:
        start, txt = best_js_window(off, back=6000, forward=10000)
        # score by presence of function/return/const and printable
        score = txt.count("function ") + txt.count("return") + txt.count("=>")
        score += 5 if "too-complex" in txt or "behavior" in txt or "permission" in txt else 0
        scored.append((score, off, start, txt))
    scored.sort(reverse=True)
    for score, off, start, txt in scored[:2]:
        # trim to ~8k chars around needle
        idx = txt.find(needle.decode("utf-8", "replace"))
        if idx < 0:
            snippet = txt[:8000]
        else:
            a = max(0, idx - 2500)
            b = min(len(txt), idx + 5500)
            snippet = txt[a:b]
        parts.append(
            f"\n### hit {off} window_start={start} score={score}\n\n```js\n{snippet}\n```\n"
        )

OUT.write_text("".join(parts), encoding="utf-8")
print("wrote", OUT, OUT.stat().st_size)
