#!/usr/bin/env python3
"""Latin1 dig densable SEA 2.1.236 key=usage-credits-row. Invent-ban: quote SEA only."""

from __future__ import annotations

from pathlib import Path

SEA = Path("/tmp/official-236/plat/package/claude")
OUT = Path(
    "/Users/apple/work-py/hare-code/claude-code-1/docs/upstream-extraction/"
    "v2.1.236/snippets/hit-usage-credits-row.txt"
)

data = SEA.read_bytes()


def printable(chunk: bytes) -> str:
    return "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)


def count(needle: bytes | str) -> int:
    if isinstance(needle, str):
        needle = needle.encode("latin1")
    return data.count(needle)


def find_all(needle: bytes | str, limit: int = 500) -> list[int]:
    if isinstance(needle, str):
        needle = needle.encode("latin1")
    out: list[int] = []
    start = 0
    while len(out) < limit:
        i = data.find(needle, start)
        if i < 0:
            break
        out.append(i)
        start = i + 1
    return out


def ctx(offset: int, radius: int = 220, needle_len: int = 0) -> str:
    lo = max(0, offset - radius)
    hi = min(len(data), offset + max(needle_len, 1) + radius)
    return printable(data[lo:hi])


def ratio(text: str) -> float:
    return sum(1 for ch in text if ch != ".") / max(1, len(text))


patterns = ["/usage", "usage-credits", "Team and Enterprise", "0%"]
variants = [
    "Team and Enterprise",
    "team and enterprise",
    "Team & Enterprise",
    "Team/Enterprise",
    "team/enterprise",
    "isTeamOrEnterprise",
    "Team or Enterprise",
    "team or enterprise",
]

lines: list[str] = [
    f"SEA: {SEA}",
    "version: 2.1.236 (Claude Code)",
    "key: usage-credits-row",
    "checklist: /usage usage-credits spend row for Team/Enterprise; capped 0% before spend",
    f"search_patterns: {patterns!r}",
    "",
    "=== pattern counts ===",
]
for p in patterns:
    lines.append(f"{p!r}: {count(p)}")
lines.append("")
lines.append("=== Team/Enterprise string variants ===")
for p in variants:
    lines.append(f"{p!r}: {count(p)}")
lines.append("")

# Best usage-credits windows with team/enterprise/spend nearby
req = [b"team", b"enterprise", b"spend", b"0%", b"capped", b"cap", b"overage"]
uc_hits: list[tuple[int, float, int, str]] = []
for i in find_all("usage-credits", limit=400):
    lo = max(0, i - 350)
    hi = min(len(data), i + 350)
    chunk = data[lo:hi]
    low = chunk.lower()
    score = sum(1 for r in req if r.lower() in low)
    if b"team" in low or b"enterprise" in low or score >= 2:
        text = printable(chunk)
        r = ratio(text)
        if r > 0.7:
            uc_hits.append((score, r, i, text))
uc_hits.sort(key=lambda x: (-x[0], -x[1], x[2]))

lines.append(
    f"=== usage-credits near team/enterprise/spend total_selected={len(uc_hits)} shown={min(10, len(uc_hits))} ==="
)
for score, r, i, text in uc_hits[:10]:
    lines.append(f"--- score={score} ratio={r:.2f} offset={i} ---")
    lines.append(text)
    lines.append("")

# /usage near credits/team
usage_hits: list[tuple[int, float, int, str]] = []
for i in find_all("/usage", limit=400):
    lo = max(0, i - 320)
    hi = min(len(data), i + 320)
    chunk = data[lo:hi]
    low = chunk.lower()
    if any(
        k in low
        for k in [
            b"usage-credits",
            b"team",
            b"enterprise",
            b"spend",
            b"credit",
            b"overage",
        ]
    ):
        text = printable(chunk)
        r = ratio(text)
        if r > 0.75:
            score = sum(
                1
                for k in [b"usage-credits", b"team", b"enterprise", b"spend"]
                if k in low
            )
            usage_hits.append((score, r, i, text))
usage_hits.sort(key=lambda x: (-x[0], -x[1], x[2]))
lines.append(
    f"=== /usage near credits/team/spend selected={len(usage_hits)} shown={min(8, len(usage_hits))} ==="
)
for score, r, i, text in usage_hits[:8]:
    lines.append(f"--- score={score} ratio={r:.2f} offset={i} ---")
    lines.append(text)
    lines.append("")

# literal 0% near usage/credits/spend with printable context
zeros: list[tuple[float, int, str]] = []
for i in find_all("0%", limit=2500):
    lo = max(0, i - 220)
    hi = min(len(data), i + 220)
    chunk = data[lo:hi]
    low = chunk.lower()
    if any(
        k in low
        for k in [
            b"usage",
            b"credit",
            b"spend",
            b"overage",
            b"team",
            b"enterprise",
            b"cap",
        ]
    ):
        text = printable(chunk)
        r = ratio(text)
        if r > 0.78:
            zeros.append((r, i, text))
zeros.sort(key=lambda x: (-x[0], x[1]))
lines.append(
    f"=== 0% near usage/credits/spend selected={len(zeros)} shown={min(12, len(zeros))} ==="
)
for r, i, text in zeros[:12]:
    lines.append(f"--- ratio={r:.2f} offset={i} ---")
    lines.append(text)
    lines.append("")

# also hunt explicit capped / before spend phrasing
extra_needles = [
    "capped at 0%",
    "capped 0%",
    "0% before",
    "before you spend",
    "before spend",
    "spend row",
    "usage credits",
    "monthly spend limit",
    "org_spend_cap_reached",
]
lines.append("=== extra phrase counts ===")
for p in extra_needles:
    lines.append(f"{p!r}: {count(p)}")
lines.append("")

for p in [
    "monthly spend limit",
    "org_spend_cap_reached",
    "isTeamOrEnterprise",
    "Run /usage-credits",
]:
    hits = find_all(p, limit=8)
    lines.append(f"=== '{p}' hits total={count(p)} shown={len(hits)} ===")
    for i in hits:
        lines.append(f"--- offset {i} ---")
        lines.append(ctx(i, radius=200, needle_len=len(p)))
        lines.append("")

OUT.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
print(f"wrote {OUT}")
print("counts:", {p: count(p) for p in patterns})
print("uc_hits", len(uc_hits), "usage_hits", len(usage_hits), "zeros", len(zeros))
