#!/usr/bin/env python3
from pathlib import Path

sea = Path("/tmp/official-236/plat/package/claude")
data = sea.read_bytes()
out = Path(
    "/Users/apple/work-py/hare-code/claude-code-1/docs/upstream-extraction/v2.1.236/snippets/hit-guest-pass-malformed.txt"
)


def printable(chunk: bytes) -> str:
    return "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)


def contexts(needle: bytes, radius: int = 200, limit: int = 40):
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


lines = []
lines.append("SEA: /tmp/official-236/plat/package/claude")
lines.append("version: 2.1.236 (claude --version)")
lines.append("bullet: #15 key=guest-pass-malformed")
lines.append("")

patterns = [
    b"guest-pass",
    b"guest pass",
    b"guestPass",
    b"GuestPass",
    b"spinner tips",
    b"spinner tip",
    b"~/.claude.json",
    b".claude.json",
    b"malformed guest",
    b"guest_pass",
    b"guestPassMalformed",
]

lines.append("=== pattern counts ===")
for p in patterns:
    lines.append(f"{p!r}: {data.count(p)}")
lines.append("")

# Exact requested patterns first
for label, needle in [
    ("guest-pass", b"guest-pass"),
    ("spinner tips", b"spinner tips"),
    ("~/.claude.json", b"~/.claude.json"),
]:
    hits, total = contexts(needle, 200, 30)
    lines.append(f"=== exact '{label}' hits total={total} ===")
    if not hits:
        lines.append("(none)")
    for i, text in hits:
        lines.append(f"--- offset {i} ---")
        lines.append(text)
        lines.append("")
    lines.append("")

# Related guest* / spinner / claude.json
for label, needle in [
    ("guestPass", b"guestPass"),
    ("GuestPass", b"GuestPass"),
    ("guest pass", b"guest pass"),
    ("spinner tip", b"spinner tip"),
    (".claude.json", b".claude.json"),
]:
    hits, total = contexts(needle, 220, 25)
    lines.append(f"=== related '{label}' hits total={total} ===")
    if not hits:
        lines.append("(none)")
    for i, text in hits:
        lines.append(f"--- offset {i} ---")
        lines.append(text)
        lines.append("")
    lines.append("")

out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {out}")
for p in [
    b"guest-pass",
    b"spinner tips",
    b"~/.claude.json",
    b"guestPass",
    b"GuestPass",
    b".claude.json",
]:
    print(f"{p!r}: {data.count(p)}")
