#!/usr/bin/env python3
from pathlib import Path

sea = Path("/tmp/official-236/plat/package/claude")
data = sea.read_bytes()
out = Path(
    "/Users/apple/work-py/hare-code/claude-code-1/docs/upstream-extraction/v2.1.236/snippets/hit-fullscreen-blank-band.txt"
)


def printable(chunk: bytes) -> str:
    return "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)


def contexts(needle: bytes, radius: int = 200, limit: int = 50):
    start = 0
    hits = []
    while len(hits) < limit:
        i = data.find(needle, start)
        if i < 0:
            break
        lo = max(0, i - radius)
        hi = min(len(data), i + len(needle) + radius)
        hits.append((i, printable(data[lo:hi])))
        start = i + 1
    return hits, data.count(needle)


patterns = [
    b"blank band",
    b"multi-line prompt",
    b"panes not repainting",
    # nearby variants that may appear in comments / logs
    b"blankBand",
    b"blank_band",
    b"Blank band",
    b"multiline prompt",
    b"multi line prompt",
    b"not repainting",
    b"repainting",
]

lines = []
lines.append("SEA: /tmp/official-236/plat/package/claude")
lines.append("version: 2.1.236 (Claude Code)")
lines.append("key: fullscreen-blank-band")
lines.append(
    'patterns: ["blank band","multi-line prompt","panes not repainting"]'
)
lines.append("")
lines.append("=== pattern counts ===")
counts = {}
for p in patterns:
    c = data.count(p)
    counts[p.decode("latin1")] = c
    lines.append(f"{p!r}: {c}")
lines.append("")

# Exact requested patterns with context
for label, needle in [
    ("blank band", b"blank band"),
    ("multi-line prompt", b"multi-line prompt"),
    ("panes not repainting", b"panes not repainting"),
]:
    hits, total = contexts(needle, 200, 40)
    lines.append(f"=== exact '{label}' hits total={total} ===")
    if not hits:
        lines.append("(none)")
    for i, text in hits:
        lines.append(f"--- offset {i} ---")
        lines.append(text)
        lines.append("")
    lines.append("")

# Related variant contexts
for label, needle in [
    ("not repainting", b"not repainting"),
    ("repainting", b"repainting"),
    ("blankBand", b"blankBand"),
    ("Blank band", b"Blank band"),
]:
    hits, total = contexts(needle, 200, 30)
    if total == 0:
        continue
    lines.append(f"=== '{label}' hits total={total} ===")
    for i, text in hits:
        lines.append(f"--- offset {i} ---")
        lines.append(text)
        lines.append("")
    lines.append("")

out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {out}")
for k, v in counts.items():
    print(f"{k!r}: {v}")
