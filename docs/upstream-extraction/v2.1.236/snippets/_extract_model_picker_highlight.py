#!/usr/bin/env python3
from pathlib import Path

sea = Path("/tmp/official-236/plat/package/claude")
data = sea.read_bytes()
out = Path(
    "/Users/apple/work-py/hare-code/claude-code-1/docs/upstream-extraction/v2.1.236/snippets/hit-model-picker-highlight.txt"
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
lines.append("bullet: #24 key=model-picker-highlight")
lines.append("")

patterns = [
    b"newest model",
    b"highlight only",
    b"/model",
    b"model picker",
    b"ModelPicker",
    b"model-picker",
    b"Select model",
    b"Switch between Claude models",
    b"modelPicker:thisSessionOnly",
    b"Search models",
    b"No models match",
]

lines.append("=== pattern counts ===")
for p in patterns:
    lines.append(f"{p!r}: {data.count(p)}")
lines.append("")

# Exact requested patterns
for label, needle, limit in [
    ("newest model", b"newest model", 10),
    ("highlight only", b"highlight only", 10),
    ("/model", b"/model", 25),
]:
    hits, total = contexts(needle, 200, limit)
    lines.append(f"=== exact '{label}' hits total={total} (showing up to {limit}) ===")
    if not hits:
        lines.append("(none)")
    for i, text in hits:
        lines.append(f"--- offset {i} ---")
        lines.append(text)
        lines.append("")
    lines.append("")

# Related ModelPicker surface (not inventing highlight-only behavior)
for label, needle, limit in [
    ("model picker", b"model picker", 15),
    ("ModelPicker", b"ModelPicker", 15),
    ("model-picker", b"model-picker", 10),
    ("Select model", b"Select model", 5),
    ("Switch between Claude models", b"Switch between Claude models", 5),
    ("modelPicker:thisSessionOnly", b"modelPicker:thisSessionOnly", 10),
]:
    hits, total = contexts(needle, 220, limit)
    lines.append(f"=== related '{label}' hits total={total} ===")
    if not hits:
        lines.append("(none)")
    for i, text in hits:
        lines.append(f"--- offset {i} ---")
        lines.append(text)
        lines.append("")
    lines.append("")

lines.append("=== notes ===")
lines.append(
    "Requested latin1 pattern 'highlight only' has 0 hits in SEA 2.1.236."
)
lines.append(
    "'newest model' hits are skill/docs migration prose (prompt-cache / model-migration), not ModelPicker UI."
)
lines.append(
    "'/model' is abundant (UX copy to switch models, remote-model-picker-unavailable, usage-credits, overload tips)."
)
lines.append(
    "ModelPicker UI strings present: Select model, Search models, effort left/right, thisSessionOnly, No models match."
)
lines.append(
    "No SEA latin1 evidence found for a 'highlight only [newest model]' model-picker mode/string."
)

out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {out}")
for p in [
    b"newest model",
    b"highlight only",
    b"/model",
    b"model picker",
    b"ModelPicker",
]:
    print(f"{p!r}: {data.count(p)}")
