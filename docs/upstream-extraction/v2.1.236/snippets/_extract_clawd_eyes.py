#!/usr/bin/env python3
from pathlib import Path

sea = Path("/tmp/official-236/plat/package/claude")
data = sea.read_bytes()
out = Path(
    "/Users/apple/work-py/hare-code/claude-code-1/docs/upstream-extraction/v2.1.236/snippets/hit-clawd-eyes.txt"
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
lines.append("bullet: #18 key=clawd-eyes")
lines.append("")

patterns = [
    b"Clawd",
    b"clawd",
    b"CLAWD",
    b"mascot",
    b"Mascot",
    b"iTerm2",
    b"eyes and feet",
    b"eyes and",
    b"and feet",
    b"CLAWD_FRAMES",
    b"drawClawd",
    b"clawd_body",
    b"clawd_background",
    b'id="clawd"',
    b".Mascot",
]

lines.append("=== pattern counts ===")
for p in patterns:
    lines.append(f"{p!r}: {data.count(p)}")
lines.append("")

for label, needle, radius, limit in [
    ("Clawd", b"Clawd", 200, 20),
    ("CLAWD_FRAMES", b"CLAWD_FRAMES", 220, 10),
    ("drawClawd", b"drawClawd", 200, 12),
    ('id="clawd"', b'id="clawd"', 200, 5),
    ("Mascot", b"Mascot", 200, 8),
    (".Mascot", b".Mascot", 200, 8),
    ("clawd_body", b"clawd_body", 180, 12),
    ("clawd_background", b"clawd_background", 180, 8),
    ("iTerm2/Kitty", b"iTerm2/Kitty", 220, 4),
    ("eyes and feet", b"eyes and feet", 200, 5),
    ("Apple_Terminal near clawd theme", b"Apple_Terminal", 260, 6),
]:
    hits, total = contexts(needle, radius, limit)
    lines.append(f"=== '{label}' hits total={total} showing={len(hits)} ===")
    if not hits:
        lines.append("(none)")
    for i, text in hits:
        # Prefer Apple_Terminal hits that also mention clawd_*
        if label.startswith("Apple_Terminal") and b"clawd" not in data[
            max(0, i - 260) : i + 260
        ]:
            continue
        lines.append(f"--- offset {i} ---")
        lines.append(text)
        lines.append("")
    lines.append("")

# Dedicated note on exact requested latin1 patterns
lines.append("=== requested latin1 search patterns ===")
lines.append("Clawd: FOUND (18)")
lines.append("mascot: NOT FOUND (0 lowercase); Mascot FOUND (4)")
lines.append("iTerm2: FOUND (121) — notification channel string etc.; no clawd co-window")
lines.append("eyes and feet: NOT FOUND (0)")
lines.append(
    "Related: welcome-banner ASCII uses theme colors clawd_body/clawd_background;"
)
lines.append(
    "whiteboard waiting UI embeds canvas id=clawd + drawClawd/CLAWD_FRAMES pixel art."
)
lines.append("")

out.write_text("\n".join(lines), encoding="utf-8")
print(f"wrote {out} ({out.stat().st_size} bytes)")
