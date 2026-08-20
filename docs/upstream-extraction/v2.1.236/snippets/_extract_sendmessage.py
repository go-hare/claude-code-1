#!/usr/bin/env python3
from pathlib import Path

sea = Path("/tmp/official-236/plat/package/claude")
data = sea.read_bytes()
out = Path(
    "/Users/apple/work-py/hare-code/claude-code-1/docs/upstream-extraction/v2.1.236/snippets/hit-sendmessage-malformed-tag.txt"
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


lines = []
lines.append("SEA: /tmp/official-236/plat/package/claude")
lines.append("version check: 2.1.236 (via --version)")
lines.append("")

patterns = [
    b"malformed closing tag",
    b"summary field",
    b"SendMessage",
    b"closing tag",
    b"malformed tag",
    b"Malformed closing",
    b"SendMessageTool",
    b"summaryField",
    b"summary_field",
]
lines.append("=== pattern counts ===")
for p in patterns:
    lines.append(f"{p!r}: {data.count(p)}")
lines.append("")

# Exact requested patterns first
for label, needle in [
    ("malformed closing tag", b"malformed closing tag"),
    ("summary field", b"summary field"),
]:
    hits, total = contexts(needle, 200, 20)
    lines.append(f"=== exact '{label}' hits total={total} ===")
    if not hits:
        lines.append("(none)")
    for i, text in hits:
        lines.append(f"--- offset {i} ---")
        lines.append(text)
        lines.append("")
    lines.append("")

# closing tag contexts (related)
hits, total = contexts(b"closing tag", 220, 30)
lines.append(f"=== 'closing tag' hits total={total} ===")
for i, text in hits:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")

# SendMessage contexts filtered for nearby keywords
needle = b"SendMessage"
start = 0
interesting = []
while True:
    i = data.find(needle, start)
    if i < 0:
        break
    lo = max(0, i - 280)
    hi = min(len(data), i + 420)
    text = printable(data[lo:hi])
    low = text.lower()
    if any(
        k in low
        for k in (
            "malformed",
            "closing tag",
            "summary field",
            "summary",
            "tag",
            "</",
        )
    ):
        interesting.append((i, text))
    start = i + 1

lines.append(
    f"=== SendMessage contexts with nearby tag/malformed/summary: {len(interesting)} / {data.count(b'SendMessage')} ==="
)
for i, text in interesting[:60]:
    lines.append(f"--- SendMessage@{i} ---")
    lines.append(text)
    lines.append("")

# Also dump a few raw SendMessageTool contexts
hits, total = contexts(b"SendMessageTool", 220, 20)
lines.append(f"=== SendMessageTool hits total={total} ===")
for i, text in hits:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")

out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {out}")
print("exact malformed closing tag:", data.count(b"malformed closing tag"))
print("exact summary field:", data.count(b"summary field"))
print("SendMessage:", data.count(b"SendMessage"))
print("closing tag:", data.count(b"closing tag"))
print("interesting SendMessage contexts:", len(interesting))
